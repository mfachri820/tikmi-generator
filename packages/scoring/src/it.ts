import type { ItDefinition, ItSheetDef } from "./definitions";
import { parseNumericText } from "./formula/values";

/**
 * Nilai Keandalan Infrastruktur TI, computed the way `Rekap Penilaian per PJP`
 * intends but from the definition's row structure (question codes and
 * column-B labels), not from that file's hard-coded ranges:
 *
 * - only the applicable sheet pairs count (deriveItApplicability);
 * - a pillar (component 1.A–1.F, 2.A–2.H) = average of its scored rows across
 *   those sheets, pooled (as AVERAGE(range1; range2; ...) does);
 * - SM = average of the SM pillars that have a value; TK likewise;
 * - Nilai Keandalan = average of SM and TK.
 *
 * Self uses column F, pengawas column I. "N/A" is an answer (not scored);
 * placeholder and note rows never count; a pillar without scored rows is left
 * out instead of giving #DIV/0!. A scorable row the PJP left blank is not
 * silently dropped: it is reported per sheet (`selfBlankRows`) and, while the
 * pengawas has not scored it either (`unscoredRows`), it blocks Final.
 */

export interface ItPillar {
  code: string;
  label: string;
  /** Average of scored rows; null when none. */
  value: number | null;
  /** Rows that had a score / rows that could have one. */
  scored: number;
  rows: number;
}

export interface ItScores {
  sm: number | null;
  tk: number | null;
  total: number | null;
  pillars: ItPillar[];
}

export interface ItComponentBreakdown {
  code: string;
  label: string;
  rows: number;
  self: { value: number | null; scored: number };
  pengawas: { value: number | null; scored: number };
}

export interface ItSheetBreakdown {
  sheet: string;
  pair: string;
  type: "SM" | "TK";
  components: ItComponentBreakdown[];
  /** Rows that can be scored (not placeholders or notes). */
  scorableRows: number;
  /** Scorable rows with no self-score at all (empty; "N/A" is an answer). */
  selfBlankRows: number[];
  /** Of those, the rows the pengawas has not scored either (column I): these block Final. */
  unscoredRows: number[];
  /** Rows the PJP answered "N/A". */
  selfNaRows: number;
  /** Rows with a numeric self-score / pengawas score. */
  selfScored: number;
  pengawasScored: number;
  /** No self-score on any row: the PJP left the sheet blank. */
  blank: boolean;
  /** Not one numeric self-score (every row blank or "N/A"): the sheet would drop out of the average. */
  noSelfScores: boolean;
}

export type ItWarningCode = "sheet_blank" | "sheet_partial" | "sheet_no_scores" | "invalid_score" | "no_applicable_sheets";
export interface ItWarning {
  code: ItWarningCode;
  message: string;
  cell?: string;
  sheet?: string;
}

export interface ItResult {
  applicable: string[];
  self: ItScores;
  pengawas: ItScores;
  breakdown: ItSheetBreakdown[];
  warnings: ItWarning[];
  /**
   * What still blocks Final, by sheet: rows the PJP left empty and the pengawas has not scored ("blank_rows"),
   * or a sheet without any score at all, every answer blank or "N/A", that the pengawas has not scored either
   * ("no_scores"). Empty = nothing blocks Final here.
   */
  unscored: { sheet: string; reason: "blank_rows" | "no_scores"; rows: number[] }[];
  /**
   * For information only: the self-score over every sheet the PJP filled (applicable or not, PIP-only
   * sheets included), so the difference with the official score is visible.
   */
  asSubmitted: { pairs: string[]; self: ItScores };
}

const average = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** A 1–5 score as typed (number or numeric text). "N/A" is an answer without a score; anything else is invalid. */
function readScore(v: unknown): { score: number | null; invalid: boolean } {
  if (isBlank(v)) return { score: null, invalid: false };
  if (typeof v === "number") return v >= 1 && v <= 5 ? { score: v, invalid: false } : { score: null, invalid: true };
  if (typeof v === "string") {
    const t = v.trim();
    if (/^n\/?a$/i.test(t) || t === "-") return { score: null, invalid: false };
    const n = parseNumericText(t);
    return n !== null && n >= 1 && n <= 5 ? { score: n, invalid: false } : { score: null, invalid: true };
  }
  return { score: null, invalid: true };
}

interface Core {
  self: ItScores;
  pengawas: ItScores;
  breakdown: ItSheetBreakdown[];
  warnings: ItWarning[];
}

function computeOver(def: ItDefinition, sheets: ItSheetDef[], get: (k: string) => unknown, withWarnings: boolean): Core {
  const warnings: ItWarning[] = [];
  const pool = { self: new Map<string, number[]>(), pengawas: new Map<string, number[]>() };
  const possible = new Map<string, number>();
  const labels = new Map<string, string>();
  const breakdown: ItSheetBreakdown[] = [];

  for (const sheet of sheets) {
    const comps = new Map<string, ItComponentBreakdown>();
    const local = { self: new Map<string, number[]>(), pengawas: new Map<string, number[]>() };
    const selfBlankRows: number[] = [];
    const unscoredRows: number[] = [];
    let scorable = 0;
    let selfScored = 0;
    let pengawasScored = 0;
    let selfNa = 0;
    for (const row of sheet.rows) {
      if (!labels.has(row.component)) labels.set(row.component, row.componentLabel);
      // Listed even when every row is a placeholder (1.D for the Penerusan sheets): shown as an empty pillar.
      if (!possible.has(row.component)) possible.set(row.component, 0);
      if (!comps.has(row.component)) {
        comps.set(row.component, { code: row.component, label: row.componentLabel, rows: 0, self: { value: null, scored: 0 }, pengawas: { value: null, scored: 0 } });
      }
      if (row.na) continue;
      scorable++;
      comps.get(row.component)!.rows++;
      possible.set(row.component, (possible.get(row.component) ?? 0) + 1);
      const selfRef = `${sheet.name}!${def.columns.self}${row.row}`;
      const pengawasRef = `${sheet.name}!${def.columns.pengawas}${row.row}`;
      const selfRaw = get(selfRef);
      if (typeof selfRaw === "string" && /^n\/?a$/i.test(selfRaw.trim())) selfNa++;
      if (isBlank(selfRaw)) {
        selfBlankRows.push(row.row);
        if (isBlank(get(pengawasRef))) unscoredRows.push(row.row);
      }
      for (const [who, ref] of [["self", selfRef], ["pengawas", pengawasRef]] as const) {
        const { score, invalid } = readScore(get(ref));
        if (invalid && withWarnings) warnings.push({ code: "invalid_score", cell: ref, sheet: sheet.name, message: `${sheet.name} ${ref.slice(ref.lastIndexOf("!") + 1)}: "${String(get(ref))}" bukan nilai 1–5 atau N/A.` });
        if (score === null) continue;
        if (who === "self") selfScored++;
        else pengawasScored++;
        for (const m of [local[who], pool[who]]) {
          if (!m.has(row.component)) m.set(row.component, []);
          m.get(row.component)!.push(score);
        }
      }
    }
    for (const c of comps.values()) {
      const s = local.self.get(c.code) ?? [];
      const p = local.pengawas.get(c.code) ?? [];
      c.self = { value: average(s), scored: s.length };
      c.pengawas = { value: average(p), scored: p.length };
    }
    const blank = scorable > 0 && selfBlankRows.length === scorable;
    const noSelfScores = scorable > 0 && selfScored === 0;
    if (withWarnings && blank) warnings.push({ code: "sheet_blank", sheet: sheet.name, message: `Sheet "${sheet.name}" berlaku tetapi tidak diisi PJP.` });
    else if (withWarnings && noSelfScores) warnings.push({ code: "sheet_no_scores", sheet: sheet.name, message: `Sheet "${sheet.name}" berlaku tetapi tidak ada satu pun nilai (semua N/A atau kosong).` });
    else if (withWarnings && selfBlankRows.length) {
      warnings.push({ code: "sheet_partial", sheet: sheet.name, message: `Sheet "${sheet.name}": ${selfBlankRows.length} dari ${scorable} pertanyaan belum dinilai PJP.` });
    }
    breakdown.push({ sheet: sheet.name, pair: sheet.pair, type: sheet.type, components: [...comps.values()], scorableRows: scorable, selfBlankRows, unscoredRows, selfNaRows: selfNa, selfScored, pengawasScored, blank, noSelfScores });
  }

  const scores = (who: "self" | "pengawas"): ItScores => {
    const pillars: ItPillar[] = [...possible.keys()].sort().map((code) => {
      const xs = pool[who].get(code) ?? [];
      return { code, label: labels.get(code) ?? "", value: average(xs), scored: xs.length, rows: possible.get(code) ?? 0 };
    });
    const part = (prefix: string) => average(pillars.filter((p) => p.code.startsWith(prefix) && p.value !== null).map((p) => p.value!));
    const sm = part("1.");
    const tk = part("2.");
    return { sm, tk, total: average([sm, tk].filter((x): x is number => x !== null)), pillars };
  };
  return { self: scores("self"), pengawas: scores("pengawas"), breakdown, warnings };
}

/**
 * The IT recap for the applicable sheet pairs (official: self and pengawas),
 * plus the information-only "as submitted" self-score over every filled sheet.
 */
export function computeIt(def: ItDefinition, cells: Map<string, unknown> | Record<string, unknown>, applicable: string[] = def.defaultApplicable): ItResult {
  const get = cells instanceof Map ? (k: string) => cells.get(k) : (k: string) => cells[k];
  const pairs = new Set(applicable);
  const sheets = def.sheets.filter((s) => pairs.has(s.pair) && !s.pipOnly);
  const core = computeOver(def, sheets, get, true);
  if (!sheets.length) core.warnings.push({ code: "no_applicable_sheets", message: "Tidak ada sheet Infrastruktur TI yang berlaku untuk PJP ini." });

  // Every pair with at least one self-score, applicable or not (PIP-only sheets included).
  const filledPairs = def.pairs
    .map((p) => p.key)
    .filter((key) => def.sheets.some((s) => s.pair === key && s.rows.some((r) => !r.na && readScore(get(`${s.name}!${def.columns.self}${r.row}`)).score !== null)));
  const submitted = computeOver(def, def.sheets.filter((s) => filledPairs.includes(s.pair)), get, false);

  return {
    applicable: sheets.map((s) => s.pair).filter((p, i, a) => a.indexOf(p) === i),
    self: core.self,
    pengawas: core.pengawas,
    breakdown: core.breakdown,
    warnings: core.warnings,
    unscored: core.breakdown.flatMap((b): ItResult["unscored"] => {
      // A sheet with no score at all: cleared once the pengawas scores it (any score in column I).
      if (b.noSelfScores && !b.blank) return b.pengawasScored ? [] : [{ sheet: b.sheet, reason: "no_scores" as const, rows: [] }];
      return b.unscoredRows.length ? [{ sheet: b.sheet, reason: "blank_rows" as const, rows: b.unscoredRows }] : [];
    }),
    asSubmitted: { pairs: filledPairs, self: submitted.self },
  };
}

/** The SM/TK sheets of one pair (for the grid's tabs). */
export function itSheetsOf(def: ItDefinition, pair: string): ItSheetDef[] {
  return def.sheets.filter((s) => s.pair === pair);
}
