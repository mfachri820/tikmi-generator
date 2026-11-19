import type { WorkbookSpec } from "./formula/evaluate";
import { formatAddress, parseAddress } from "./formula/parse";

/**
 * Shapes of the generated, committed definition files in
 * packages/scoring/definitions/ (scripts/gen-definitions.ts).
 */

export interface IndicatorDef {
  /** "I.OPS.1.1" (not unique in every template: see `knownIssues`). */
  id: string;
  /** Sheet-1 row of K..O. */
  row: number;
  /** OPS, LIQ, KEU, CR, CMP, HK, STG, RPT, PK. */
  risk: string;
  /** "I.OPS.1": the Form Penilaian parameter row it averages into. */
  parameter: string;
  /** Column L: the formula as described in the template. */
  label: string;
  /** Column N: the band text. */
  bandText: string;
  mCell: string;
  /** The O cell that rates this indicator; null for an intermediate value (see oKind). */
  oCell: string | null;
  /** Sheet-1 cells M reads (H cells, D8). */
  inputs: string[];
  /** What M computes, for explanations: */
  mKind: "passthrough" | "periodDivisor" | "ratio" | "countRatio" | "count" | "sum" | "minmax" | "choice";
  /**
   * band: O maps M to 1-5 by thresholds. direct: O reads answer cells itself (YA/TIDAK).
   * pairFirst / pairSecond: one O (on the first row) rates two indicators together.
   * intermediate: no rating; another indicator's M reads this M.
   */
  oKind: "band" | "direct" | "pairFirst" | "pairSecond" | "intermediate";
}

export interface InputDeclaration {
  sheet: string;
  /** A1 cells/ranges on that sheet a person types into ("F19:F1452"). Never stored as template constants. */
  ranges: string[];
}

export interface MrDefinition {
  kind: "mr";
  year: number;
  bundling: 2 | 3;
  templateFile: string;
  templateSha256: string | null;
  /** The KK's sheet names (they differ between bundlings, e.g. "2 -Asesmen ..."). */
  sheets: { risiko: string; tkmr: string; permodalan: string; form: string; lamp1: string; dropdown: string };
  visibleSheets: string[];
  spec: WorkbookSpec;
  inputs: InputDeclaration[];
  /** Sheet-1 rows the PJP fills (ID DATA in B, no formula in H). */
  pjpInputRows: { first: number; last: number; rows: number[] };
  /** Sheet-1 rows below the BI block that the pengawas fills for Bank Indonesia (column G says so). */
  pengawasInputRows: { row: number; dataId: string; guide: string }[];
  indicators: IndicatorDef[];
  /** Sheet-1 rows whose H is a VLOOKUP into Sumber BI. */
  biRows: { row: number; dataId: string; label: string }[];
  tkmrQuestions: { row: number; code: string; id: string }[];
  /** The PJP self-assessment template for this bundling: how to recognise a submission and map it onto the KK. */
  pjp: MrPjpTemplate;
  knownIssues: string[];
}

export interface MrPjpTemplate {
  templateFile: string;
  /** Sheet names in the PJP template (they differ from the KK's: "2- Asesmen ...", "3 - Asesmen ..."). */
  sheets: { risiko: string; tkmr: string; permodalan: string; lamp1: string };
  identity: string[];
  /** Sheet-1 rows with an ID DATA: [row, ID DATA, hash of the row's C–F text]. Same rows in the KK. */
  rows: [number, string, string][];
  /** Sheet-1 cells with a formula in the PJP template itself (a formula elsewhere was typed by the PJP). */
  formulaCells: string[];
  /** PJP data rows are one row lower than the KK's; `columns` maps PJP column -> KK column (matched by header). */
  lamp1: { pjpFirstRow: number; pjpLastRow: number; kkRowOffset: number; columns: Record<string, string> };
  /** PJP sheet-3 cell -> KK sheet-3 cell. */
  permodalan: Record<string, string>;
  /** Values the blank PJP template ships with, by KK address (it is pre-filled: D4, every TKMR F = 5, ...). */
  defaults: Record<string, string | number | boolean>;
}

export interface ItRowDef {
  row: number;
  /** "1.B" */
  component: string;
  componentLabel: string;
  /** "1.B.2" when the question text starts with one. */
  code: string | null;
  /** Not scored: a placeholder ("N/A" as question) or, with `note`, an explanatory note row without a question code. */
  na: boolean;
  note?: boolean;
}

export interface ItSheetDef {
  name: string;
  /** Pair key: General, PSD-UE, ..., TI-SPBI, Infra SP. */
  pair: string;
  type: "SM" | "TK";
  rows: ItRowDef[];
  /** Only for PIP (Infra SP): parsed, never applicable to PJP. */
  pipOnly?: boolean;
}

export interface ItDefinition {
  kind: "it";
  year: number;
  templateFile: string;
  templateSha256: string | null;
  pjpTemplateFile: string;
  columns: { nilaiRiil: string; self: string; justifikasi: string; pengawas: string; justifikasiPengawas: string };
  defaultApplicable: string[];
  knownIssues: string[];
  pairs: { key: string; sm: string; tk: string; pipOnly: boolean }[];
  sheets: ItSheetDef[];
  /** Values the blank PJP IT template ships with, by KK address. */
  pjpDefaults: Record<string, string | number | boolean>;
}

/** Every declared input cell of a definition, as "Sheet!A1". */
export function inputCellRefs(def: Pick<MrDefinition, "inputs">): Set<string> {
  const out = new Set<string>();
  for (const d of def.inputs) {
    for (const range of d.ranges) {
      const [a, b] = range.split(":");
      const p = parseAddress(a);
      const q = parseAddress(b ?? a);
      for (let r = p.row; r <= q.row; r++) for (let c = p.col; c <= q.col; c++) out.add(`${d.sheet}!${formatAddress(c, r)}`);
    }
  }
  return out;
}

/**
 * FNV-1a of a row's normalised text (whitespace collapsed, lower case, cells
 * joined by "|"): the fingerprint in `MrPjpTemplate.rows`, compared by the
 * submission parser to tell whether a row is the same template row.
 */
export function rowHash(parts: unknown[]): string {
  const text = parts.map((p) => String(p ?? "").replace(/\s+/g, " ").trim().toLowerCase()).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
