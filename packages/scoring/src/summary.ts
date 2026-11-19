import { parseFormula, type Node } from "./formula/parse";
import type { Override } from "./formula/evaluate";
import { isError, type Scalar } from "./formula/values";
import type { MrDefinition } from "./definitions";
import { mrWorkbook, type MrTables } from "./mr";
import type { Workbook } from "./formula/evaluate";

/** Form Penilaian columns C..L, in template order (row 9 headings). */
export const RISKS = [
  { key: "OPS", col: "C", label: "Risiko Operasional" },
  { key: "LIQ", col: "D", label: "Risiko Likuiditas" },
  { key: "KEU", col: "E", label: "Risiko Keuangan" },
  { key: "CR", col: "F", label: "Risiko Kredit" },
  { key: "CMP", col: "G", label: "Risiko Kepatuhan" },
  { key: "PUPT", col: "H", label: "Risiko PU-PT" },
  { key: "HK", col: "I", label: "Risiko Hukum" },
  { key: "STG", col: "J", label: "Risiko Strategis" },
  { key: "RPT", col: "K", label: "Risiko Reputasi" },
  { key: "PK", col: "L", label: "Risiko PK" },
] as const;
export type RiskKey = (typeof RISKS)[number]["key"];
export type Weights = Record<RiskKey, number>;

export const LSB = "Lembaga Selain Bank";
export const LEMBAGA_REMITANSI = "Lembaga Remitansi";
export const POSISI_SETAHUN = "1 Januari - 31 Desember";

export interface MrSettings {
  /** Weights for the assessment's bundling and (mapped) bentuk lembaga, from `weight_sets`. Omitted = the KK's own table. */
  weights?: Weights;
  /** Which Rating M is official (period setting). Unset (2025) = neither is labelled official. */
  officialBasis?: "template" | "validasi_pengawas" | null;
  /** Pengawas PU-PT score for corrected mode (default 3, as the template's constant). */
  puPt?: number;
  /**
   * The assessment's Sandi. D5 is the KK's VLOOKUP of the PJP's own D4, which can be wrong (the template ships
   * with "Bank of America" in D4); the app knows the PJP, so D5 (and with it every BI-sourced row) uses this.
   */
  sandi?: string;
}

export type WarningCode =
  | "bentuk_remitansi"
  | "weights_missing"
  | "d8_d9_mismatch"
  | "risk_no_data"
  | "tkmr_no_data"
  | "tkmr_pengawas_incomplete"
  | "score_out_of_range"
  | "pupt_template_constant";

export interface MrWarning {
  code: WarningCode;
  message: string;
  risk?: RiskKey;
  cell?: string;
}

export interface RiskRow {
  key: RiskKey;
  label: string;
  weight: Scalar;
  /** Row 23: average of the parameter averages (0 when no data: template behaviour). */
  inherent: Scalar;
  inherentPredikat: Scalar;
  /** Row 36 (TKMR Mandiri, column F) and row 52 (TKMR Pengawas, column L). */
  tkmrMandiri: Scalar;
  tkmrPengawas: Scalar;
  /** Rows 39 / 55: 0.5 × inherent + 0.5 × TKMR. */
  composite: Scalar;
  compositePredikat: Scalar;
  compositePengawas: Scalar;
  compositePengawasPredikat: Scalar;
  /** Rows 15–22 that have a value, by parameter prefix ("I.OPS.1"). */
  parameters: { parameter: string; cell: string; value: Scalar }[];
}

export interface RatingM {
  score: Scalar;
  predikat: Scalar;
}

export interface MrModeResult {
  /** Every formula cell of the KK, evaluated ("Sheet!A1"). */
  cells: Map<string, Scalar>;
  risks: RiskRow[];
  profile: { mandiri: Scalar; pengawas: Scalar };
  permodalan: Scalar;
  /** C64/C65: from the PJP's own TKMR (row 39). F64/F65: from the pengawas TKMR (row 55). */
  ratingM: { template: RatingM; validasiPengawas: RatingM };
  /** The official one, per `officialBasis`; null while the period has not decided. */
  official: (RatingM & { basis: "template" | "validasi_pengawas" }) | null;
}

export interface Deviation {
  code: "pupt_input" | "period_from_posisi" | "weights_config" | "bentuk_remitansi";
  /** Cells replaced, with the value used. */
  cells: Record<string, Scalar>;
  modes: ("template" | "corrected")[];
  description: string;
}

export interface MrResult {
  template: MrModeResult;
  corrected: MrModeResult;
  deviations: Deviation[];
  warnings: MrWarning[];
}

function fp(def: MrDefinition, addr: string) {
  return `${def.sheets.form}!${addr}`;
}
function rs(def: MrDefinition, addr: string) {
  return `${def.sheets.risiko}!${addr}`;
}

/** Parameter prefix each Form Penilaian row 15–22 cell averages (`LEFT(K:K,7)="I.OPS.1"`), read from the formula. */
const paramCache = new WeakMap<MrDefinition, Map<string, string>>();
function parameterCells(def: MrDefinition): Map<string, string> {
  let m = paramCache.get(def);
  if (m) return m;
  m = new Map();
  const literal = (n: Node): string | null => {
    if (n.t === "str" && /^I\.[A-Z]+\.\d+$/.test(n.v)) return n.v;
    if (n.t === "fn") for (const a of n.args) {
      const r = literal(a);
      if (r) return r;
    }
    if (n.t === "bin") return literal(n.a) ?? literal(n.b);
    return null;
  };
  for (const r of RISKS) {
    for (let row = 15; row <= 22; row++) {
      const ref = fp(def, `${r.col}${row}`);
      const f = def.spec.formulas[ref];
      if (!f) continue;
      const p = literal(parseFormula(f));
      if (p) m.set(ref, p);
    }
  }
  paramCache.set(def, m);
  return m;
}

const num = (v: Scalar): number | null => (typeof v === "number" ? v : null);

function summarize(def: MrDefinition, wb: Workbook, basis: "template" | "validasi_pengawas" | null): MrModeResult {
  const cells = wb.evaluateAll();
  // Through the workbook, not `cells`: some summary cells are template constants (H23, H36, H52), not formulas.
  const g = (addr: string) => wb.value(fp(def, addr));
  const params = parameterCells(def);
  const risks: RiskRow[] = RISKS.map((r) => ({
    key: r.key,
    label: r.label,
    weight: g(`${r.col}10`),
    inherent: g(`${r.col}23`),
    inherentPredikat: g(`${r.col}24`),
    tkmrMandiri: g(`${r.col}36`),
    tkmrPengawas: g(`${r.col}52`),
    composite: g(`${r.col}39`),
    compositePredikat: g(`${r.col}40`),
    compositePengawas: g(`${r.col}55`),
    compositePengawasPredikat: g(`${r.col}56`),
    parameters: [...params.entries()]
      .filter(([ref]) => ref.startsWith(`${def.sheets.form}!${r.col}`))
      .map(([ref, parameter]) => ({ parameter, cell: ref, value: wb.value(ref) })),
  }));
  const template = { score: g("C64"), predikat: g("C65") };
  const validasiPengawas = { score: g("F64"), predikat: g("F65") };
  return {
    cells,
    risks,
    profile: { mandiri: g("C60"), pengawas: g("F60") },
    permodalan: g("C62"),
    ratingM: { template, validasiPengawas },
    official: basis ? { ...(basis === "template" ? template : validasiPengawas), basis } : null,
  };
}

/**
 * Scores one MR KK in both modes.
 *
 * Template mode: the KK's formulas as they are, with two input normalisations
 * decided for 2025: weights come from the versioned weight config (when
 * given), and "Lembaga Remitansi" is weighted as Lembaga Selain Bank.
 *
 * Corrected mode adds the documented deviations (docs/tikmi-deviations.md):
 * PU-PT from the pengawas input (H23, H36, H52) and the period divisor / BI
 * source from Posisi (D9) instead of Kategori PSP (D8).
 */
export function computeMr(
  def: MrDefinition,
  inputs: Map<string, unknown> | Record<string, unknown>,
  tables: MrTables = {},
  settings: MrSettings = {},
): MrResult {
  const input = inputs instanceof Map ? inputs : new Map(Object.entries(inputs));
  const basis = settings.officialBasis ?? null;
  const deviations: Deviation[] = [];
  const warnings: MrWarning[] = [];
  const base: Record<string, Override> = {};
  if (settings.sandi) base[rs(def, "D5")] = settings.sandi;

  // Bentuk lembaga: the B3 PJP template offers "Lembaga Remitansi", which the weight table lacks.
  const bentuk = input.get(rs(def, "D6"));
  if (typeof bentuk === "string" && bentuk.trim().toLowerCase() === LEMBAGA_REMITANSI.toLowerCase()) {
    base[fp(def, "C7")] = LSB;
    deviations.push({
      code: "bentuk_remitansi",
      cells: { [fp(def, "C7")]: LSB },
      modes: ["template", "corrected"],
      description: `Bentuk Lembaga "${bentuk}" dibobot sebagai "${LSB}" (tabel bobot KK tidak memiliki baris untuk Lembaga Remitansi).`,
    });
    warnings.push({ code: "bentuk_remitansi", message: `PJP mengisi Bentuk Lembaga "${bentuk}"; bobot memakai "${LSB}".` });
  }

  if (settings.weights) {
    const cells: Record<string, Scalar> = {};
    for (const r of RISKS) {
      const ref = fp(def, `${r.col}10`);
      cells[ref] = settings.weights[r.key];
      base[ref] = settings.weights[r.key];
    }
    deviations.push({ code: "weights_config", cells, modes: ["template", "corrected"], description: "Bobot risiko dari pengaturan periode (versi terbaru), bukan dari tabel DropDown List KK." });
  }

  const templateWb = mrWorkbook(def, input, tables, base);

  // Corrected mode.
  const corrected: Record<string, Override> = { ...base };
  const puPt = settings.puPt ?? 3;
  const puptCells: Record<string, Scalar> = {};
  for (const a of ["H23", "H36", "H52"]) {
    puptCells[fp(def, a)] = puPt;
    corrected[fp(def, a)] = puPt;
  }
  deviations.push({
    code: "pupt_input",
    cells: puptCells,
    modes: ["corrected"],
    description: `Risiko PU-PT memakai nilai pengawas ${puPt} untuk inheren (H23), TKMR Mandiri (H36) dan TKMR Pengawas (H52); di KK H23 dan H36 tetap 3 dan H52 = 0.`,
  });
  if (settings.puPt === undefined) warnings.push({ code: "pupt_template_constant", risk: "PUPT", message: "Nilai Risiko PU-PT belum diisi pengawas; dipakai 3 seperti template." });

  const d8 = input.get(rs(def, "D8"));
  const d9 = input.get(rs(def, "D9"));
  const fullYear = typeof d9 === "string" && d9.replace(/\s+/g, " ").trim().toLowerCase() === POSISI_SETAHUN.toLowerCase();
  const halfYear = typeof d9 === "string" && /30 juni|1 juli/i.test(d9);
  const effectiveD8 = fullYear ? "PSP Selain PSP Utama" : halfYear ? "PSP Utama" : null;
  if (effectiveD8) {
    corrected[rs(def, "D8")] = effectiveD8;
    deviations.push({
      code: "period_from_posisi",
      cells: { [rs(def, "D8")]: effectiveD8 },
      modes: ["corrected"],
      description: `Pembagi periode (I.OPS.6.x downtime, I.LIQ.1.2) dan sumber data BI mengikuti Posisi "${d9}" (${fullYear ? "12 bulan, Sumber BI 1 Tahun" : "6 bulan, Sumber BI (6 Bulan)"}), bukan Kategori PSP.`,
    });
    if (d8 !== effectiveD8) {
      warnings.push({
        code: "d8_d9_mismatch",
        cell: rs(def, "D8"),
        message: `Kategori PSP "${String(d8 ?? "(kosong)")}" tidak sesuai dengan Posisi "${d9}": template memakai ${d8 === "PSP Utama" ? "pembagi 6 bulan" : d8 === "PSP Selain PSP Utama" ? "pembagi 12 bulan" : "NA untuk data BI"}.`,
      });
    }
  }
  const correctedWb = mrWorkbook(def, input, tables, corrected);

  // Warnings from the template-mode numbers.
  const t = summarize(def, templateWb, basis);
  const templateCells = t.cells;
  if (t.risks.some((r) => typeof r.weight === "string" || isError(r.weight))) {
    warnings.push({ code: "weights_missing", message: `Tidak ada bobot untuk Bundling ${String(input.get(rs(def, "D7")))} / "${String(bentuk ?? "")}": Rating M tidak dapat dihitung.` });
  }
  for (const r of t.risks) {
    if (r.key === "PUPT") continue;
    if (r.parameters.every((p) => num(p.value) === null)) {
      warnings.push({ code: "risk_no_data", risk: r.key, message: `${r.label}: tidak ada indikator inheren yang bernilai; risiko inheren dihitung 0 (perilaku template) dan menurunkan Rating M.` });
    }
    if (num(r.tkmrMandiri) === 0) warnings.push({ code: "tkmr_no_data", risk: r.key, message: `${r.label}: TKMR Mandiri tanpa nilai, dihitung 0.` });
    if (num(r.tkmrPengawas) === 0) warnings.push({ code: "tkmr_pengawas_incomplete", risk: r.key, message: `${r.label}: TKMR Pengawas belum dinilai; Rating M validasi pengawas menghitungnya 0 (indikatif).` });
  }
  for (const ind of def.indicators) {
    if (!ind.oCell || ind.oKind === "pairSecond") continue;
    const ref = rs(def, ind.oCell);
    const v = templateCells.get(ref);
    if (typeof v === "number" && (v < 1 || v > 5)) {
      warnings.push({ code: "score_out_of_range", cell: ref, message: `${ind.id}: nilai ${v} di luar skala 1–5 (template tidak membatasi).` });
    }
  }

  return { template: t, corrected: summarize(def, correctedWb, basis), deviations, warnings };
}

/** A TKMR pengawas score counts as given when it is 1–5 or "NA". */
function isPengawasScore(v: unknown): boolean {
  if (typeof v === "number") return v >= 1 && v <= 5;
  if (typeof v === "string") {
    const t = v.trim();
    return /^na$/i.test(t) || (/^[1-5]$/.test(t));
  }
  return false;
}

export interface TkmrPengawasProgress {
  filled: number;
  total: number;
  /** TKMR question rows (sheet 2) still without a pengawas score in column L. */
  missingRows: number[];
  complete: boolean;
  /** "TKMR pengawas belum lengkap (37/122)", or null when complete. */
  badge: string | null;
}

/**
 * Pengawas TKMR scores (sheet 2 column L) given so far. Row 55 / F64 count a
 * risk without pengawas scores as 0, so F64 is only meaningful when complete.
 */
export function tkmrPengawasProgress(def: MrDefinition, inputs: Map<string, unknown> | Record<string, unknown>): TkmrPengawasProgress {
  const get = inputs instanceof Map ? (k: string) => inputs.get(k) : (k: string) => inputs[k];
  const missingRows = def.tkmrQuestions.filter((q) => !isPengawasScore(get(`${def.sheets.tkmr}!L${q.row}`))).map((q) => q.row);
  const total = def.tkmrQuestions.length;
  const filled = total - missingRows.length;
  return { filled, total, missingRows, complete: missingRows.length === 0, badge: missingRows.length ? `TKMR pengawas belum lengkap (${filled}/${total})` : null };
}

export interface FinalizeBlocker {
  code: "tkmr_pengawas_incomplete";
  message: string;
}

/** Why an MR assessment may not be set to Final yet (empty = it may). */
export function finalizeBlockers(def: MrDefinition, inputs: Map<string, unknown> | Record<string, unknown>): FinalizeBlocker[] {
  const p = tkmrPengawasProgress(def, inputs);
  return p.complete
    ? []
    : [{ code: "tkmr_pengawas_incomplete", message: `Belum bisa Final: ${p.total - p.filled} dari ${p.total} pertanyaan TKMR belum dinilai pengawas (kolom L), sehingga Rating M Penilaian Pengawas masih menghitungnya 0.` }];
}
