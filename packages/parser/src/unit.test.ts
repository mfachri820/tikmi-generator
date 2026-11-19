/** Reader and rules on synthetic data: no template or PJP files needed. */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { definitions2025 as defs } from "./definitions";
import { detect, parseMrWorkbook, type ParsedMr } from "./parse";
import { checkFilename, validateMr } from "./validate";
import { decideFile } from "./acceptance";
import { readXlsx } from "./xlsx";

const period = { posisi: "1 Januari - 31 Desember", dataYear: 2025 };

describe("readXlsx", () => {
  it("reads shared strings, numbers, booleans, errors and a formula's cached 0 (which exceljs's reader drops)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("1 - Asesmen Risiko");
    ws.getCell("A1").value = "teks & <simbol>";
    ws.getCell("A2").value = 12.5;
    ws.getCell("A3").value = true;
    ws.getCell("A4").value = { formula: "A2-A2", result: 0 };
    ws.getCell("A5").value = { formula: "1/0", result: { error: "#DIV/0!" } };
    ws.getCell("A6").value = { richText: [{ text: "kaya " }, { text: "teks" }] };
    const raw = await readXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    const c = raw.sheet("1 - Asesmen Risiko")!.cells;
    expect(c.get("A1")?.value).toBe("teks & <simbol>");
    expect(c.get("A2")?.value).toBe(12.5);
    expect(c.get("A3")?.value).toBe(true);
    expect(c.get("A4")).toMatchObject({ value: 0, isFormula: true, formula: "=A2-A2" });
    expect(c.get("A5")).toMatchObject({ value: "#DIV/0!", isError: true });
    expect(c.get("A6")?.value).toBe("kaya teks");
  });
});

describe("checkFilename", () => {
  it.each([
    ["PT_ABC_LSB_Bundling_3_Self_Asesmen_M_Des2025.xlsx", "mr", 3, null],
    ["PT_Andalusia Antar Benua_LSB_Bundling_3_Self_Asesmen_M_Des2025 - Eliha Mahsuna.xlsx", "mr", 3, null],
    ["Nama_PSP_LSB_Bundling_3_Self_Asesmen_M_Posisi.xlsx", "mr", 3, "Nama_PSP"],
    ["PT_ABC_LSB_Bundling_2_Self_Asesmen_M_Des2025.xlsx", "mr", 3, "Bundling 2"],
    ["PT_ABC_Self_Asesmen_Infrastruktur_TI_Des2025.xlsx", "it", undefined, null],
    ["laporan.pdf", "it", undefined, ".xlsx"],
  ] as const)("%s", (name, kind, bundling, expected) => {
    const r = checkFilename(name, kind, bundling);
    if (expected === null) expect(r).toBeNull();
    else expect(r).toContain(expected);
  });
});

/** A Bundling 3 submission built from the definition: identity, every answer and TKMR filled, nothing at its default. */
async function submission(over: (ws: (name: string) => ExcelJS.Worksheet) => void = () => {}): Promise<ParsedMr> {
  const def = defs.mr[3];
  const wb = new ExcelJS.Workbook();
  const sheets = new Map<string, ExcelJS.Worksheet>();
  const ws = (name: string) => sheets.get(name) ?? sheets.set(name, wb.addWorksheet(name)).get(name)!;
  const s1 = ws(def.pjp.sheets.risiko);
  for (const [row, id] of def.pjp.rows) s1.getCell(`B${row}`).value = id;
  for (const row of def.pjpInputRows.rows) s1.getCell(`H${row}`).value = 10;
  Object.assign(s1.getCell("D4"), { value: "PT Contoh Remitansi" });
  s1.getCell("D5").value = "777000001";
  s1.getCell("D6").value = "Lembaga Selain Bank";
  s1.getCell("D7").value = 3;
  s1.getCell("D8").value = "PSP Utama";
  s1.getCell("D9").value = "1 Januari - 31 Desember";
  s1.getCell("E9").value = 2025;
  const s2 = ws(def.pjp.sheets.tkmr);
  for (const q of def.tkmrQuestions) {
    s2.getCell(`F${q.row}`).value = 4;
    s2.getCell(`G${q.row}`).value = `DOK-${q.row}`;
  }
  const s3 = ws(def.pjp.sheets.permodalan);
  for (const a of ["C7", "C9", "C10"]) s3.getCell(a).value = 1;
  ws(def.pjp.sheets.lamp1);
  over(ws);
  const raw = await readXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
  return parseMrWorkbook(raw, def, detect(raw, defs));
}

describe("MR parse and validation (synthetic)", () => {
  it("recognises the template and maps cells onto the KK", async () => {
    const p = await submission();
    expect(p.detection.key).toBe("mr-b3");
    expect(p.cells[`${defs.mr[3].sheets.permodalan}!C8`]).toBe(1);
    expect(p.cells[`${defs.mr[3].sheets.tkmr}!F${defs.mr[3].tkmrQuestions[0].row}`]).toBe(4);
  });

  it("a clean submission has no errors and no default/identity findings", async () => {
    const p = await submission();
    const r = validateMr(p, defs.mr[3], { period, expectedBundling: 3, pjp: { sandi: "777000001", nama: "PT Contoh Remitansi" } });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.map((i) => i.code)).not.toContain("tkmr_self_default");
    expect(r.issues.map((i) => i.code)).not.toContain("identity_default");
  });

  it("flags the template's default D4 as an error and untouched TKMR answers as a warning", async () => {
    const def = defs.mr[3];
    const p = await submission((ws) => {
      ws(def.pjp.sheets.risiko).getCell("D4").value = String(def.pjp.defaults[`${def.sheets.risiko}!D4`]);
      const q = def.tkmrQuestions[0];
      const s2 = ws(def.pjp.sheets.tkmr);
      s2.getCell(`F${q.row}`).value = def.pjp.defaults[`${def.sheets.tkmr}!F${q.row}`] as number;
      for (let r = q.row; r < def.tkmrQuestions[1].row; r++) {
        const d = def.pjp.defaults[`${def.sheets.tkmr}!G${r}`];
        if (d !== undefined) s2.getCell(`G${r}`).value = d as string;
      }
    });
    const r = validateMr(p, def, { period, expectedBundling: 3, pjp: { sandi: "777000001", nama: "PT Contoh Remitansi" } });
    expect(r.issues.find((i) => i.code === "identity_default")).toMatchObject({ severity: "error" });
    expect(r.issues.map((i) => i.code)).not.toContain("d4_mismatch");
    expect(r.issues.find((i) => i.code === "tkmr_self_default")).toMatchObject({ prominent: true, items: [def.tkmrQuestions[0].id] });
    expect(r.noteToPjp).toContain("bawaan template");
  });

  it("flags NA without explanation, out-of-range TKMR scores and blank TKMR scores", async () => {
    const def = defs.mr[3];
    const [q1, q2] = def.tkmrQuestions;
    const row = def.pjpInputRows.rows[0];
    const p = await submission((ws) => {
      ws(def.pjp.sheets.risiko).getCell(`H${row}`).value = "NA";
      ws(def.pjp.sheets.tkmr).getCell(`F${q1.row}`).value = 7;
      ws(def.pjp.sheets.tkmr).getCell(`F${q2.row}`).value = null;
    });
    const r = validateMr(p, def, { period, expectedBundling: 3 });
    const codes = r.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["na_without_explanation", "tkmr_score_invalid", "tkmr_score_blank"]));
    expect(r.issues.find((i) => i.code === "tkmr_score_invalid")).toMatchObject({ severity: "error" });
  });
});

describe("decideFile", () => {
  it("wrong Posisi: active but Perlu Perbaikan; a non-TIKMI file is excluded", async () => {
    const def = defs.mr[3];
    const p = await submission((ws) => {
      ws(def.pjp.sheets.risiko).getCell("D9").value = "1 Januari- 30 Juni";
    });
    const report = validateMr(p, def, { period, expectedBundling: 3 });
    expect(decideFile({ expectedKind: "mr", expectedBundling: 3, parsed: p, report })).toMatchObject({ activatable: true, acceptance: "perlu_perbaikan" });
    expect(decideFile({ expectedKind: "mr", parsed: p, report: { issues: [], counts: { error: 0, warning: 0, info: 0 }, noteToPjp: "" } }).acceptance).toBe("ok");
    expect(decideFile({ expectedKind: "it", parsed: p })).toMatchObject({ activatable: false, excluded: "wrong_kind" });
    expect(decideFile({ expectedKind: "mr", error: new Error("boom") })).toMatchObject({ activatable: false, excluded: "unreadable" });
  });
});
