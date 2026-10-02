import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { LTDBB_HEADERS, LtdbbParseError, parseLtdbb } from "./parse";

type Cell = ExcelJS.CellValue;

/** One data row: [date, month, quarter, year, kode, nama, 6 Jumlah/Nilai, 6 Fin, bundling]. */
function dataRow(overrides: Partial<Record<number, Cell>> = {}): Cell[] {
  const row: Cell[] = [
    new Date(Date.UTC(2025, 0, 1)), 1, 1, 2025, 777958119, "Artha Semesta Utama",
    10, 0.5, 20, 1.5, 30, 2.5,
    10, 500_000_000, 20, 1_500_000_000, 30, 2_500_000_000,
    "Bundak 1",
  ];
  for (const [i, v] of Object.entries(overrides)) row[Number(i)] = v as Cell;
  return row;
}

async function workbook(rows: Cell[][], opts: { sheet?: string; headers?: string[] } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Pivot");
  const ws = wb.addWorksheet(opts.sheet ?? "Trx_PJPJKT");
  ws.addRow(opts.headers ?? [...LTDBB_HEADERS]);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const noOverrides = new Map<string, string>();

describe("parseLtdbb", () => {
  it("reads the Fin (Rupiah) columns of each PJP-month row", async () => {
    const { rows, report } = await parseLtdbb(await workbook([dataRow()]), noOverrides);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kode: "777958119",
      year: 2025,
      month: 1,
      finJumlahInc: 10,
      finNilaiInc: 500_000_000,
      finNilaiDom: 2_500_000_000,
      flags: [],
    });
    expect(report).toMatchObject({ rowCount: 1, minDate: "2025-01-01", maxDate: "2025-01-01", kodeCount: 1 });
  });

  it("fails clearly when Trx_PJPJKT is missing", async () => {
    await expect(parseLtdbb(await workbook([dataRow()], { sheet: "Sheet1" }), noOverrides)).rejects.toThrow(
      /Trx_PJPJKT/,
    );
  });

  it("names the column whose header is wrong", async () => {
    const headers = [...LTDBB_HEADERS] as string[];
    headers[13] = "Fin Nilai Incoming";
    const err = await parseLtdbb(await workbook([dataRow()], { headers }), noOverrides).catch((e) => e);
    expect(err).toBeInstanceOf(LtdbbParseError);
    expect(err.message).toMatch(/kolom N/);
    expect(err.message).toMatch(/Fin Nilai Inc/);
  });

  it("ignores surrounding spaces in headers", async () => {
    const headers = LTDBB_HEADERS.map((h) => ` ${h} `);
    await expect(parseLtdbb(await workbook([dataRow()], { headers }), noOverrides)).resolves.toBeTruthy();
  });

  it("parses numbers stored as text with thousand separators", async () => {
    const { rows } = await parseLtdbb(await workbook([dataRow({ 13: "248,294,749,080" })]), noOverrides);
    expect(rows[0].finNilaiInc).toBe(248_294_749_080);
    expect(rows[0].flags).toEqual([]);
  });

  it("derives Fin from Nilai x 1e9 (or Jumlah) when the Fin formula has no cached value", async () => {
    const { rows } = await parseLtdbb(
      await workbook([dataRow({ 12: { formula: "G2" } as Cell, 13: { formula: "H2*10^9" } as Cell })]),
      noOverrides,
    );
    expect(rows[0].finJumlahInc).toBe(10);
    expect(rows[0].finNilaiInc).toBe(500_000_000);
    expect(rows[0].flags).toContain("DERIVED_FROM_NILAI");
  });

  it("flags MISSING_VALUE and uses 0 when both Fin and its source are missing", async () => {
    const { rows } = await parseLtdbb(await workbook([dataRow({ 7: null, 13: null })]), noOverrides);
    expect(rows[0].finNilaiInc).toBe(0);
    expect(rows[0].flags).toContain("MISSING_VALUE");
  });

  it("flags NON_NUMERIC text and uses 0", async () => {
    const { rows } = await parseLtdbb(await workbook([dataRow({ 7: "n/a", 13: "n/a" })]), noOverrides);
    expect(rows[0].finNilaiInc).toBe(0);
    expect(rows[0].flags).toContain("NON_NUMERIC");
  });

  it("keeps non-integer frequencies and negative values, flagging both", async () => {
    const { rows } = await parseLtdbb(await workbook([dataRow({ 12: 212036.755, 15: -5 })]), noOverrides);
    expect(rows[0].finJumlahInc).toBe(212036.755);
    expect(rows[0].flags).toEqual(expect.arrayContaining(["NON_INTEGER_FREQ", "NEGATIVE"]));
  });

  it("flags DATE_MISMATCH when Year/Month disagree with Date", async () => {
    const { rows } = await parseLtdbb(await workbook([dataRow({ 1: 2 })]), noOverrides);
    expect(rows[0].month).toBe(2);
    expect(rows[0].flags).toContain("DATE_MISMATCH");
  });

  it("skips rows without a Kode", async () => {
    const { rows, report } = await parseLtdbb(await workbook([dataRow(), dataRow({ 4: null, 1: 2 })]), noOverrides);
    expect(rows).toHaveLength(1);
    expect(report.skippedNoKode).toBe(1);
  });

  it("applies code overrides by LTDBB name, keeping the original Kode", async () => {
    const overrides = new Map([["Indomarco Prismatama", "777958116"]]);
    const { rows } = await parseLtdbb(
      await workbook([dataRow({ 4: 777930079, 5: "Indomarco Prismatama" }), dataRow({ 4: 777930079, 5: "Indogo Express Remittance" })]),
      overrides,
    );
    expect(rows[0]).toMatchObject({ kode: "777958116", kodeRaw: "777930079", flags: ["CODE_OVERRIDDEN"] });
    expect(rows[1]).toMatchObject({ kode: "777930079", flags: [] });
  });

  it("fails on a PJP-month that appears twice after overrides, listing it", async () => {
    await expect(parseLtdbb(await workbook([dataRow(), dataRow()]), noOverrides)).rejects.toThrow(
      /777958119 2025-01/,
    );
  });
});
