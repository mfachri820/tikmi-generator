import { NOT_AVAILABLE, type ResolvedKpmrAnswer, type WorkbookScoringResult } from "../src";
import { scoringConfig2026 } from "./2026";
import { a2ParameterRows } from "./2026-input-cells";

/**
 * Live values for every formula cell the grid shows on the 2026 template's
 * visible sheets, keyed "Sheet!Address". Each mapping below mirrors the
 * template's own formula (read from the file, noted per block), but the
 * numbers come from the scoring engine -- never from a formula's cached
 * result, which belongs to whichever PJP's file the layout was taken from.
 */

const C2 = "C2. Form PJP LR";
const A2 = "A2. PJP ALL peng";
const KPMR = "B. KPMR 2025";

function range(col: string, from: number, to: number): string[] {
  const cells: string[] = [];
  for (let r = from; r <= to; r++) cells.push(`${col}${r}`);
  return cells;
}

/** C2 total rows, each `SUM(...)` of the listed cells. Listed in dependency order (C25 before C26). */
export const c2TotalCells: [string, string[]][] = [
  ["C18", range("C", 6, 17)],
  ["C25", range("C", 22, 24)],
  ["C26", ["C25"]],
  ["C30", range("C", 28, 29)],
  ["C57", range("C", 34, 56)],
  ["C74", range("C", 62, 70)],
  ["C118", range("C", 80, 117)],
  ["C129", range("C", 127, 128)],
  ["C133", range("C", 131, 132)],
  ["C137", range("C", 135, 136)],
  ["D18", range("D", 6, 17)],
  ["D25", range("D", 22, 24)],
  ["D26", ["D25"]],
  ["D30", range("D", 28, 29)],
  ["D57", range("D", 34, 56)],
  ["D74", range("D", 62, 73)],
  ["D118", range("D", 80, 117)],
];

/** A2 item rows (`$D6*SUMPRODUCT($E7:$E8,$L7:$L8)` etc.): each sums the parameter rows below it, up to the next item row. */
export const a2ItemRows = [6, 9, 12, 18, 22, 25, 28, 33, 37, 40, 43, 47, 50, 56];

/** A2 rekap rows 60-63 (E/Q = category sum, F/R = weighted by D/P, S = R). */
export const a2CategoryRows: Record<string, number> = { TPPU: 60, TPPT: 61, PPSPM: 62, Struktural: 63 };

/** KPMR pillar average rows (`IFERROR(SUM(H5:H11)/COUNTA(H5:H11),0)`), in pillar order; row 46 averages them. */
export const kpmrPillarRows = [12, 22, 34, 39, 44];
export const kpmrOverallRow = 46;

export type SheetCellValue = string | number | null;

export interface SheetCellsInput {
  /** C2 raw C-column values plus `computeC2Derived`'s D shares. */
  c2Values: Record<string, number>;
  scores: WorkbookScoringResult;
  kpmr: ResolvedKpmrAnswer[];
  sandiNama: string;
  /** The PJP's LTDBB total nominal for the data year (active upload), or null when there's no LTDBB data at all -- shown as #N/A like the XLOOKUP. */
  biTotalNominal: number | null;
  hasDataMismatch: boolean;
}

export function computeSheetCells2026(input: SheetCellsInput): Record<string, SheetCellValue> {
  const { c2Values, scores, kpmr } = input;
  const out: Record<string, SheetCellValue> = {};

  // C2: B2, the D shares, the total rows, and the BI cross-check (G18 XLOOKUP, H18 IF).
  out[`${C2}!B2`] = input.sandiNama;
  const c2 = { ...c2Values };
  for (const [cell, parts] of c2TotalCells) {
    c2[cell] = parts.reduce((sum, part) => sum + (c2[part] ?? 0), 0);
  }
  for (const [cell, value] of Object.entries(c2)) {
    if (cell.startsWith("D") || c2TotalCells.some(([total]) => total === cell)) out[`${C2}!${cell}`] = value;
  }
  out[`${C2}!G18`] = input.biTotalNominal ?? "#N/A";
  out[`${C2}!H18`] = input.hasDataMismatch ? "Perbedaan Data" : "Sesuai";

  // A2: L/O per parameter (`IF(...)` chain / `=L`), then the item subtotals.
  const byRow = new Map(scores.parameters.map((p) => [Number(p.id), p]));
  for (const row of a2ParameterRows) {
    const p = byRow.get(row);
    if (!p) continue;
    out[`${A2}!L${row}`] = p.pjpValue;
    out[`${A2}!O${row}`] = p.pengawasValue;
  }
  const lastParameterRow = Math.max(...a2ParameterRows);
  a2ItemRows.forEach((itemRow, i) => {
    const nextItemRow = a2ItemRows[i + 1] ?? lastParameterRow + 1;
    let pjp = 0;
    let pengawas = 0;
    for (const p of scores.parameters) {
      const row = Number(p.id);
      if (row > itemRow && row < nextItemRow) {
        pjp += p.weight * p.pjpValue;
        pengawas += p.weight * p.pengawasValue;
      }
    }
    out[`${A2}!L${itemRow}`] = pjp;
    out[`${A2}!O${itemRow}`] = pengawas;
  });

  // A2 rekap: E/Q category sums, F = D*E, R = P*Q, S = R; then inherent, KPMR and final rows.
  for (const [category, row] of Object.entries(a2CategoryRows)) {
    const weight = scoringConfig2026.categoryWeights[category];
    const pjp = scores.categoryScores.pjp[category] ?? 0;
    const pengawas = scores.categoryScores.pengawas[category] ?? 0;
    out[`${A2}!E${row}`] = pjp;
    out[`${A2}!F${row}`] = weight * pjp;
    out[`${A2}!Q${row}`] = pengawas;
    out[`${A2}!R${row}`] = weight * pengawas;
    out[`${A2}!S${row}`] = weight * pengawas;
  }
  const rekap: [number, SheetCellValue, SheetCellValue, SheetCellValue][] = [
    [64, scores.inherentScore.pjp, scores.inherentScore.pengawas, scores.inherentScore.pengawas],
    [65, scores.inherentPredikat.pjp, scores.inherentPredikat.pengawas, scores.inherentPredikat.pengawas],
    [67, scores.kpmrOverall.pjp, scores.kpmrOverall.pengawas, scores.kpmrOverall.pengawas],
    [68, scores.kpmrPredikat.pjp, scores.kpmrPredikat.pengawas, scores.kpmrPredikat.pengawas],
    [70, scores.finalIra.pjp, scores.finalIra.pengawasRaw, scores.finalIra.pengawasAdjusted],
    [71, scores.finalIraPredikat.pjp, scores.finalIraPredikat.pengawasRaw, scores.finalIraPredikat.pengawasAdjusted],
  ];
  // A final IRA of NaN is the template's #N/A (no matrix entry, e.g. before any KPMR answers exist).
  const na = (v: SheetCellValue) => (typeof v === "number" && Number.isNaN(v) ? NOT_AVAILABLE : v);
  for (const [row, f, r, s] of rekap) {
    out[`${A2}!F${row}`] = na(f);
    out[`${A2}!R${row}`] = na(r);
    out[`${A2}!S${row}`] = na(s);
  }

  // KPMR: J defaults to H (`=H5`), pillar averages, and the overall average.
  for (const answer of kpmr) {
    const row = answer.pengawasCellRef.split("!")[1].slice(1);
    out[`${KPMR}!J${row}`] = answer.pengawasScore ?? null;
  }
  const pillars = [...new Set(scoringConfig2026.kpmrQuestions.map((q) => q.pillar))];
  pillars.forEach((pillar, i) => {
    const row = kpmrPillarRows[i];
    out[`${KPMR}!H${row}`] = scores.kpmrPillarAverages.pjp[pillar] ?? 0;
    out[`${KPMR}!J${row}`] = scores.kpmrPillarAverages.pengawas[pillar] ?? 0;
  });
  out[`${KPMR}!H${kpmrOverallRow}`] = scores.kpmrOverall.pjp;
  out[`${KPMR}!J${kpmrOverallRow}`] = scores.kpmrOverall.pengawas;

  return out;
}
