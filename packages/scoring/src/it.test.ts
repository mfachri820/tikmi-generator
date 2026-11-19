import { describe, expect, it } from "vitest";
import type { ItDefinition } from "./definitions";
import { computeIt } from "./it";
import itJson from "../definitions/2025-it.json";

const def = itJson as unknown as ItDefinition;
const sheet = (name: string) => def.sheets.find((s) => s.name === name)!;

/** Fill column `col` of every scorable row of the given sheets with `score(row)`. */
function fill(names: string[], col: string, score: (r: { row: number; component: string }) => unknown) {
  const m = new Map<string, unknown>();
  for (const n of names) for (const r of sheet(n).rows) if (!r.na) m.set(`${n}!${col}${r.row}`, score(r));
  return m;
}

const PAIRS = ["General", "Penerusan TD", "Penerusan Data"];
const DEFAULT = ["Standar Minimum (SM) General", "Tata Kelola (TK) General", "SM Penerusan TD", "TK Penerusan TD", "SM Penerusan Data", "TK Penerusan Data"];

describe("IT definition (derived from column B)", () => {
  it("has the 7 KK pairs plus the PIP-only Infra SP", () => {
    expect(def.pairs.map((p) => p.key)).toEqual(["General", "PSD-UE", "PSD-APMK", "PSD-Propchan", "Penerusan TD", "Penerusan Data", "TI-SPBI", "Infra SP"]);
    expect(def.sheets.filter((s) => s.pipOnly).map((s) => s.name)).toEqual(["SM Infra SP", "TK Infra SP"]);
  });

  it("takes components from question codes where column B is missing a label (SM PSD-Propchan 1.E)", () => {
    const rows = sheet("SM PSD-Propchan").rows;
    expect(rows.filter((r) => r.component === "1.E" && !r.na)).toHaveLength(11);
    expect(rows.filter((r) => r.component === "1.D" && !r.na).map((r) => r.code)).toEqual(["1.D.1"]);
    expect(def.knownIssues.join(" ")).toContain("SM PSD-Propchan");
  });

  it("does not score explanatory note rows (General 1.F, TK General before 2.F)", () => {
    const notes = def.sheets.flatMap((s) => s.rows.filter((r) => r.note).map((r) => `${s.name}!${r.row}`));
    expect(notes).toEqual(expect.arrayContaining(["Standar Minimum (SM) General!10", "Tata Kelola (TK) General!27"]));
    expect(sheet("Standar Minimum (SM) General").rows.filter((r) => r.component === "1.F" && !r.na).map((r) => r.row)).toEqual([11, 12]);
  });

  it("knows 1.D Kapabilitas Interaksi is empty for the Penerusan sheets", () => {
    for (const n of ["SM Penerusan TD", "SM Penerusan Data"]) {
      const d = sheet(n).rows.filter((r) => r.component === "1.D");
      expect(d.length).toBeGreaterThan(0);
      expect(d.every((r) => r.na)).toBe(true);
    }
  });
});

describe("computeIt", () => {
  it("all 4s: every score is 4; empty pillars are skipped, not #DIV/0!", () => {
    const res = computeIt(def, fill(DEFAULT, "F", () => 4), PAIRS);
    expect(res.self).toMatchObject({ sm: 4, tk: 4, total: 4 });
    expect(res.self.pillars.find((p) => p.code === "1.D")).toMatchObject({ value: null, rows: 0 });
    expect(res.pengawas.total).toBeNull();
    expect(res.warnings).toEqual([]);
  });

  it("pools a pillar's rows across sheets (not an average of sheet averages)", () => {
    // 1.B rows: General has 4, Penerusan TD 9, Penerusan Data 9. Score 5 on General, 2 elsewhere.
    const cells = fill(DEFAULT, "F", (r) => (r.component === "1.B" ? 2 : 3));
    for (const r of sheet("Standar Minimum (SM) General").rows) if (r.component === "1.B") cells.set(`Standar Minimum (SM) General!F${r.row}`, 5);
    const res = computeIt(def, cells, PAIRS);
    const b = res.self.pillars.find((p) => p.code === "1.B")!;
    expect(b.scored).toBe(22);
    expect(b.value).toBeCloseTo((4 * 5 + 18 * 2) / 22, 12);
  });

  it("SM and TK average their pillars; Nilai Keandalan averages SM and TK", () => {
    const cells = fill(DEFAULT, "F", (r) => (r.component.startsWith("1.") ? (r.component === "1.A" ? 5 : 3) : 1));
    const res = computeIt(def, cells, PAIRS);
    const smPillars = res.self.pillars.filter((p) => p.code.startsWith("1.") && p.value !== null);
    expect(res.self.sm).toBeCloseTo(smPillars.reduce((s, p) => s + p.value!, 0) / smPillars.length, 12);
    expect(res.self.tk).toBe(1);
    expect(res.self.total).toBeCloseTo((res.self.sm! + 1) / 2, 12);
  });

  it("treats N/A and blanks as not scored, flags other text, and keeps pengawas separate", () => {
    const cells = fill(DEFAULT, "F", () => "N/A");
    const first = sheet("SM Penerusan TD").rows.find((r) => !r.na)!;
    cells.set(`SM Penerusan TD!F${first.row}`, "lima");
    cells.set(`SM Penerusan TD!I${first.row}`, 2);
    const res = computeIt(def, cells, PAIRS);
    expect(res.self.total).toBeNull();
    expect(res.pengawas.total).toBe(2);
    expect(res.warnings.map((w) => w.code)).toContain("invalid_score");
  });

  it("only applicable sheets count; a blank applicable sheet is flagged", () => {
    const cells = fill(["Standar Minimum (SM) General", "Tata Kelola (TK) General"], "F", () => 5);
    cells.set(`SM PSD-UE!F${sheet("SM PSD-UE").rows[0].row}`, 1);
    const res = computeIt(def, cells, PAIRS);
    expect(res.self.total).toBe(5);
    expect(res.warnings.filter((w) => w.code === "sheet_blank")).toHaveLength(4);
    const withUe = computeIt(def, cells, [...PAIRS, "PSD-UE"]);
    expect(withUe.self.sm).toBeLessThan(5);
  });
});

describe("blank rows and the as-submitted score", () => {
  it("an applicable sheet left partly blank is reported row by row; pengawas scores clear the unscored list", () => {
    const sheetName = "TK Penerusan TD";
    const rows = sheet(sheetName).rows.filter((r) => !r.na);
    const cells = fill(DEFAULT, "F", () => 4);
    cells.delete(`${sheetName}!F${rows[0].row}`);
    cells.delete(`${sheetName}!F${rows[1].row}`);
    const res = computeIt(def, cells, PAIRS);
    const b = res.breakdown.find((x) => x.sheet === sheetName)!;
    expect(b).toMatchObject({ blank: false, selfBlankRows: [rows[0].row, rows[1].row], unscoredRows: [rows[0].row, rows[1].row] });
    expect(res.unscored).toEqual([{ sheet: sheetName, reason: "blank_rows", rows: [rows[0].row, rows[1].row] }]);
    expect(res.warnings.map((w) => w.code)).toContain("sheet_partial");
    cells.set(`${sheetName}!I${rows[0].row}`, 3);
    cells.set(`${sheetName}!I${rows[1].row}`, 3);
    expect(computeIt(def, cells, PAIRS).unscored).toEqual([]);
  });

  it("the official score uses only applicable sheets; as-submitted covers every filled sheet", () => {
    const cells = fill([...DEFAULT, "SM PSD-UE", "TK PSD-UE", "SM Infra SP"], "F", (r) => (r.component.startsWith("1.") ? 5 : 3));
    for (const r of sheet("SM PSD-UE").rows) if (!r.na) cells.set(`SM PSD-UE!F${r.row}`, 1);
    const res = computeIt(def, cells, PAIRS);
    expect(res.applicable).toEqual(PAIRS);
    expect(res.self.sm).toBe(5);
    expect(res.asSubmitted.pairs).toEqual(["General", "PSD-UE", "Penerusan TD", "Penerusan Data", "Infra SP"]);
    expect(res.asSubmitted.self.sm).toBeLessThan(5);
    // Pengawas scores: also only applicable sheets.
    cells.set(`SM PSD-UE!I${sheet("SM PSD-UE").rows.find((r) => !r.na)!.row}`, 1);
    expect(computeIt(def, cells, PAIRS).pengawas.total).toBeNull();
  });
});

describe("an applicable sheet answered entirely N/A", () => {
  it("has no self-scores: it blocks until the pengawas scores it; N/A on single rows stays legitimate", () => {
    const sheetName = "TK Penerusan TD";
    const cells = fill(DEFAULT, "F", () => 4);
    for (const r of sheet(sheetName).rows) if (!r.na) cells.set(`${sheetName}!F${r.row}`, "N/A");
    const res = computeIt(def, cells, PAIRS);
    expect(res.breakdown.find((b) => b.sheet === sheetName)).toMatchObject({ blank: false, noSelfScores: true, selfBlankRows: [], selfNaRows: sheet(sheetName).rows.filter((r) => !r.na).length });
    expect(res.unscored).toEqual([{ sheet: sheetName, reason: "no_scores", rows: [] }]);
    expect(res.warnings.map((w) => w.code)).toContain("sheet_no_scores");
    cells.set(`${sheetName}!I${sheet(sheetName).rows.find((r) => !r.na)!.row}`, 2);
    expect(computeIt(def, cells, PAIRS).unscored).toEqual([]);
    // One scored row besides N/A: fine.
    const one = fill(DEFAULT, "F", () => 4);
    for (const [i, r] of sheet(sheetName).rows.filter((x) => !x.na).entries()) one.set(`${sheetName}!F${r.row}`, i === 0 ? 4 : "N/A");
    expect(computeIt(def, one, PAIRS).unscored).toEqual([]);
  });
});
