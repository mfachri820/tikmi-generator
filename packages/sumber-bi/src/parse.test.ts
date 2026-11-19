import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildLookup, coverage } from "./lookup";
import { parseSumberBi, SumberBiFormatError } from "./parse";

async function workbook(sheets: Record<string, unknown[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const r of rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseSumberBi", () => {
  it("reads id/ket/idpelapor/amount by header, pads numeric Sandi and derives idx", async () => {
    const xlsx = await workbook({
      Notes: [["anything"]],
      Data: [
        ["ket", "id", "amount", "idpelapor"],
        ["QRIS Issuer Nominal", "R.OPS.1.c.55", 1500, 777961911],
        ["Kredit Kol 1", "R.CR.2.a.1", 7077602193006, "002000000"],
        ["Kredit Kol 1", "R.CR.2.a.1", 99, 2000000],
        ["x", "R.LIQ.3.c.1", "#DIV/0!", "498000000"],
        ["x", "R.LIQ.3.c.2", null, "498000000"],
        ["x", "R.LIQ.3.c.3", 5, "PT X"],
      ],
    });
    const { rows, report } = await parseSumberBi(xlsx, { kind: "1_tahun" });
    expect(report.sheet).toBe("Data");
    expect(rows[0]).toMatchObject({ rowNo: 2, dataId: "R.OPS.1.c.55", idpelapor: "777961911", idx: "R.OPS.1.c.55-777961911", amount: 1500 });
    expect(rows[2].idpelapor).toBe("002000000");
    expect(report.flags).toMatchObject({ DUPLICATE_KEY: 1, NON_NUMERIC_AMOUNT: 1, BLANK_AMOUNT: 1, BAD_PELAPOR: 1 });
    expect(report.distinctDataIds).toBe(5);
  });

  it("uses the file's own idx column when present (and flags disagreement)", async () => {
    const xlsx = await workbook({
      "Sumber BI 1 Tahun": [
        ["id", "ket", "idpelapor", "idx", "amount"],
        ["R.OPS.1.c.48", "k", "116990000", "R.OPS.1.c.48-116000000", 10],
      ],
    });
    const kept = await parseSumberBi(xlsx, { kind: "1_tahun", sheetName: "Sumber BI 1 Tahun" });
    expect(kept.rows[0].idx).toBe("R.OPS.1.c.48-116000000");
    expect(kept.report.flags.IDX_MISMATCH).toBe(1);
    const derived = await parseSumberBi(xlsx, { kind: "1_tahun", sheetName: "Sumber BI 1 Tahun", keepIdx: false });
    expect(derived.rows[0].idx).toBe("R.OPS.1.c.48-116990000");
  });

  it("rejects a file without the expected columns", async () => {
    const xlsx = await workbook({ S: [["kode", "nilai"], ["a", 1]] });
    await expect(parseSumberBi(xlsx, { kind: "6_bulan" })).rejects.toBeInstanceOf(SumberBiFormatError);
  });
});

describe("buildLookup (VLOOKUP exact match)", () => {
  const rows = [
    { rowNo: 2, dataId: "R.A", ket: null, idpelapor: "777000001", idx: "R.A-777000001", amount: 10, amountText: null },
    { rowNo: 3, dataId: "R.A", ket: null, idpelapor: "777000001", idx: "R.A-777000001", amount: 20, amountText: null },
    { rowNo: 4, dataId: "R.B", ket: null, idpelapor: "777000001", idx: "R.B-777000001", amount: null, amountText: null },
    { rowNo: 5, dataId: "R.C", ket: null, idpelapor: "777000002", idx: "R.C-777000002", amount: null, amountText: "NA" },
  ];
  const lookup = buildLookup(rows);

  it("returns the first row in file order, case-insensitively", () => {
    expect(lookup.get("R.A", "777000001")).toEqual({ found: true, value: 10, rowNo: 2 });
    expect(lookup.getByKey("r.a-777000001")).toMatchObject({ value: 10 });
  });

  it("returns 0 for a blank amount and the text for a non-numeric one", () => {
    expect(lookup.get("R.B", "777000001")).toMatchObject({ found: true, value: 0 });
    expect(lookup.get("R.C", "777000002")).toMatchObject({ found: true, value: "NA" });
  });

  it("reports a missing key (the KK's IFERROR makes it \"NA\")", () => {
    expect(lookup.get("R.A", "777000009")).toEqual({ found: false });
  });

  it("lists PJPs without data", () => {
    expect(coverage(rows, ["777000001", "777000003"])).toEqual({ covered: [{ sandi: "777000001", dataIds: 2 }], missing: ["777000003"] });
  });
});
