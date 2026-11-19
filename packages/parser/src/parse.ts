import { rowHash, type ItDefinition, type MrDefinition } from "@tikmi/scoring";
import { findSheetLoose, readXlsx, type CellScalar, type RawSheet, type RawWorkbook } from "./xlsx";

export type TemplateKey = "mr-b2" | "mr-b3" | "it";

export interface TemplateScore {
  key: TemplateKey;
  /** Share of the template's fingerprint rows found in the file (0..1). */
  score: number;
  matched: number;
  total: number;
}

export interface Detection {
  /** Best match, or null when nothing matches well enough (not one of the TIKMI templates). */
  key: TemplateKey | null;
  kind: "mr" | "it" | null;
  scores: TemplateScore[];
}

/** At least this share of fingerprint rows must match for a file to count as that template. */
export const DETECT_THRESHOLD = 0.9;

export type StructureIssueCode =
  | "missing_sheet"
  | "row_text_differs"
  | "row_id_differs"
  | "lamp1_row_differs"
  | "lamp1_column_unknown"
  | "formula_without_value"
  | "error_value";

export interface StructureIssue {
  code: StructureIssueCode;
  /** Address in the PJP's file. */
  cell?: string;
  message: string;
}

export interface TypedFormula {
  /** KK address the value goes to. */
  ref: string;
  /** Address in the PJP's file. */
  source: string;
  formula: string | null;
  value: CellScalar;
}

export interface ParsedMr {
  kind: "mr";
  detection: Detection;
  /** The definition the cells were mapped with (the detected template's). */
  bundling: 2 | 3;
  /** KK input cells ("Sheet!A1" in the KK's own sheet names) -> value. Only non-empty cells. */
  cells: Record<string, CellScalar>;
  identity: {
    namaPsp: CellScalar;
    /** D5 as the PJP's file computed it (VLOOKUP of D4 in the file's own Lamp. PJP). */
    sandi: CellScalar;
    bentukLembaga: CellScalar;
    bundling: CellScalar;
    kategoriPsp: CellScalar;
    posisi: CellScalar;
    tahun: CellScalar;
  };
  typedFormulas: TypedFormula[];
  structure: StructureIssue[];
}

export interface ParsedIt {
  kind: "it";
  detection: Detection;
  cells: Record<string, CellScalar>;
  info: { nama: CellScalar; alamat: CellScalar; pic: CellScalar; kontak: CellScalar };
  typedFormulas: TypedFormula[];
  structure: StructureIssue[];
}

export type ParsedSubmission = ParsedMr | ParsedIt;

export interface Definitions {
  mr: { 2: MrDefinition; 3: MrDefinition };
  it: ItDefinition;
}

const blank = (v: CellScalar | undefined) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function scoreMr(wb: RawWorkbook, def: MrDefinition, key: TemplateKey): TemplateScore {
  const s = findSheetLoose(wb, def.pjp.sheets.risiko);
  const total = def.pjp.rows.length;
  if (!s) return { key, score: 0, matched: 0, total };
  let matched = 0;
  for (const [row, id] of def.pjp.rows) if (String(s.cells.get(`B${row}`)?.value ?? "").trim() === id) matched++;
  return { key, score: matched / total, matched, total };
}

function scoreIt(wb: RawWorkbook, def: ItDefinition): TemplateScore {
  let matched = 0;
  let total = 0;
  for (const sheet of def.sheets) {
    const s = findSheetLoose(wb, sheet.name);
    for (const r of sheet.rows) {
      if (!r.code) continue;
      total++;
      // By component ("2.D."), not the full code: the KK and the PJP template number one question differently (2.D.4 / 2.D.5).
      if (s && String(s.cells.get(`C${r.row}`)?.value ?? "").trim().startsWith(r.code.slice(0, 4))) matched++;
    }
  }
  return { key: "it", score: total ? matched / total : 0, matched, total };
}

export function detect(wb: RawWorkbook, defs: Definitions): Detection {
  const scores = [scoreMr(wb, defs.mr[2], "mr-b2"), scoreMr(wb, defs.mr[3], "mr-b3"), scoreIt(wb, defs.it)].sort((a, b) => b.score - a.score);
  const best = scores[0];
  const key = best.score >= DETECT_THRESHOLD ? best.key : null;
  return { key, kind: key ? (key === "it" ? "it" : "mr") : null, scores };
}

function put(cells: Record<string, CellScalar>, typed: TypedFormula[], structure: StructureIssue[], ref: string, sheet: RawSheet, addr: string, templateFormula = false) {
  const c = sheet.cells.get(addr);
  if (!c) return;
  const source = `${sheet.name}!${addr}`;
  if (c.isFormula && c.value === null) {
    structure.push({ code: "formula_without_value", cell: source, message: `${source}: berisi rumus tanpa hasil tersimpan; nilainya tidak dapat dibaca.` });
    return;
  }
  if (c.isError) structure.push({ code: "error_value", cell: source, message: `${source}: berisi nilai error ${String(c.value)}.` });
  if (c.isFormula && !templateFormula) typed.push({ ref, source, formula: c.formula ?? null, value: c.value });
  if (!blank(c.value)) cells[ref] = c.value;
}

export function parseMrWorkbook(wb: RawWorkbook, def: MrDefinition, detection: Detection): ParsedMr {
  const cells: Record<string, CellScalar> = {};
  const typed: TypedFormula[] = [];
  const structure: StructureIssue[] = [];
  const P = def.pjp;
  const K = def.sheets;
  const sheet = (name: string) => {
    const s = findSheetLoose(wb, name);
    if (!s) structure.push({ code: "missing_sheet", message: `Sheet "${name}" tidak ditemukan.` });
    return s;
  };

  const s1 = sheet(P.sheets.risiko);
  const templateFormulas = new Set(P.formulaCells);
  const identity = {
    namaPsp: null as CellScalar,
    sandi: null as CellScalar,
    bentukLembaga: null as CellScalar,
    bundling: null as CellScalar,
    kategoriPsp: null as CellScalar,
    posisi: null as CellScalar,
    tahun: null as CellScalar,
  };
  if (s1) {
    const v = (a: string) => s1.cells.get(a)?.value ?? null;
    Object.assign(identity, { namaPsp: v("D4"), sandi: v("D5"), bentukLembaga: v("D6"), bundling: v("D7"), kategoriPsp: v("D8"), posisi: v("D9"), tahun: v("E9") });
    for (const a of ["D4", "D6", "D7", "D8", "D9", "E9"]) put(cells, typed, structure, `${K.risiko}!${a}`, s1, a);

    const inputRows = new Set(def.pjpInputRows.rows);
    for (const [row, id, hash] of P.rows) {
      const got = String(s1.cells.get(`B${row}`)?.value ?? "").trim();
      if (got !== id) structure.push({ code: "row_id_differs", cell: `${s1.name}!B${row}`, message: `Baris ${row}: ID DATA "${got}" (template: "${id}").` });
      else if (rowHash(["C", "D", "E", "F"].map((c) => s1.cells.get(`${c}${row}`)?.value)) !== hash) {
        structure.push({ code: "row_text_differs", cell: `${s1.name}!C${row}`, message: `Baris ${row} (${id}): teks pertanyaan berbeda dari template.` });
      }
      if (!inputRows.has(row)) continue;
      put(cells, typed, structure, `${K.risiko}!H${row}`, s1, `H${row}`, templateFormulas.has(`H${row}`));
      put(cells, typed, structure, `${K.risiko}!I${row}`, s1, `I${row}`, templateFormulas.has(`I${row}`));
    }
  }

  const s2 = sheet(P.sheets.tkmr);
  if (s2) {
    const maxRow = def.spec.sheets[K.tkmr].maxRow;
    for (let r = 19; r <= maxRow; r++) for (const c of ["F", "G", "H", "I"]) put(cells, typed, structure, `${K.tkmr}!${c}${r}`, s2, `${c}${r}`);
  }

  const s3 = sheet(P.sheets.permodalan);
  if (s3) for (const [from, to] of Object.entries(P.permodalan)) put(cells, typed, structure, `${K.permodalan}!${to}`, s3, from);

  const s4 = sheet(P.sheets.lamp1);
  if (s4) {
    const known = new Set(Object.keys(P.lamp1.columns));
    for (const c of ["E", "F", "G", "H", "I", "J", "K", "L"]) {
      const header = String(s4.cells.get(`${c}4`)?.value ?? "").trim();
      if (header && !known.has(c)) structure.push({ code: "lamp1_column_unknown", cell: `${s4.name}!${c}4`, message: `Lamp1 kolom ${c} "${header}" tidak dikenal.` });
    }
    for (let r = P.lamp1.pjpFirstRow; r <= P.lamp1.pjpLastRow; r++) {
      const kkRow = r + P.lamp1.kkRowOffset;
      for (const [pc, kc] of Object.entries(P.lamp1.columns)) {
        const c = s4.cells.get(`${pc}${r}`);
        if (!c || blank(c.value)) continue;
        put(cells, typed, structure, `${K.lamp1}!${kc}${kkRow}`, s4, `${pc}${r}`);
      }
    }
  }

  return { kind: "mr", detection, bundling: def.bundling, cells, identity, typedFormulas: typed, structure };
}

export function parseItWorkbook(wb: RawWorkbook, def: ItDefinition, detection: Detection): ParsedIt {
  const cells: Record<string, CellScalar> = {};
  const typed: TypedFormula[] = [];
  const structure: StructureIssue[] = [];
  const info = { nama: null as CellScalar, alamat: null as CellScalar, pic: null as CellScalar, kontak: null as CellScalar };
  const inf = findSheetLoose(wb, "Informasi");
  if (!inf) structure.push({ code: "missing_sheet", message: 'Sheet "Informasi" tidak ditemukan.' });
  else {
    const v = (a: string) => inf.cells.get(a)?.value ?? null;
    Object.assign(info, { nama: v("D11"), alamat: v("D13"), pic: v("D15"), kontak: v("D17") });
    for (const a of ["D11", "D13", "D15", "D17"]) put(cells, typed, structure, `Informasi!${a}`, inf, a);
  }
  const { nilaiRiil, self, justifikasi } = def.columns;
  for (const sheet of def.sheets) {
    const s = findSheetLoose(wb, sheet.name);
    if (!s) {
      structure.push({ code: "missing_sheet", message: `Sheet "${sheet.name}" tidak ditemukan.` });
      continue;
    }
    for (const r of sheet.rows) {
      const text = String(s.cells.get(`C${r.row}`)?.value ?? "").trim();
      if (r.code && !text.startsWith(r.code.slice(0, 4))) {
        structure.push({ code: "row_id_differs", cell: `${s.name}!C${r.row}`, message: `${s.name} baris ${r.row}: pertanyaan komponen ${r.code.slice(0, 3)} tidak ditemukan di baris ini.` });
      }
      for (const c of [nilaiRiil, self, justifikasi]) put(cells, typed, structure, `${sheet.name}!${c}${r.row}`, s, `${c}${r.row}`);
    }
  }
  return { kind: "it", detection, cells, info, typedFormulas: typed, structure };
}

export class UnrecognisedTemplateError extends Error {
  constructor(public readonly detection: Detection) {
    super(`Not a TIKMI template (best match ${detection.scores[0]?.key} ${(detection.scores[0]?.score * 100).toFixed(0)}%)`);
    this.name = "UnrecognisedTemplateError";
  }
}

/**
 * Reads a PJP submission, recognises which template it is (by its rows, not
 * its file name or the form's answer), and maps its cells onto the KK.
 * Throws UnrecognisedTemplateError when it is none of the TIKMI templates.
 */
export async function parseSubmission(xlsx: Buffer | ArrayBuffer | Uint8Array, defs: Definitions): Promise<ParsedSubmission> {
  const wb = await readXlsx(xlsx);
  const detection = detect(wb, defs);
  if (!detection.key) throw new UnrecognisedTemplateError(detection);
  if (detection.key === "it") return parseItWorkbook(wb, defs.it, detection);
  return parseMrWorkbook(wb, defs.mr[detection.key === "mr-b2" ? 2 : 3], detection);
}
