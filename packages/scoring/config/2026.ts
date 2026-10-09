import type { FinalIraMatrixEntry, KpmrQuestionConfig, ParameterConfig, PredikatRule, ScoringConfig } from "../src/types";

/**
 * The 2026 IRA template's actual scoring config, reverse-engineered from the
 * "A2. PJP ALL peng" and "B. KPMR 2025" sheet formulas (identical across all
 * 66 fixture workbooks). This is template structure, not PJP data -- it's
 * safe to check in, unlike anything under IRA_FIXTURES_DIR.
 *
 * Two known template quirks are preserved exactly rather than "fixed", since
 * Phase 0's job is to reproduce the existing cached values, not correct them:
 *  - TPPT item 3's leaf weights (rows 29-32) sum to 0.9, not 1.
 *  - Row 45's share formula sums 'C2. Form PJP LR'!C58 (not D58) with two
 *    D-column values -- a mismatched column reference in the source template.
 */

const AS = "A2. PJP ALL peng"; // sheet name shorthand
const O = (row: number) => `${AS}!O${row}`;

const IF_CHAIN_20_40_60_80_100 = {
  kind: "maxShare" as const,
  thresholds: [
    { maxShare: 0.2, score: 5 as const },
    { maxShare: 0.4, score: 4 as const },
    { maxShare: 0.6, score: 3 as const },
    { maxShare: 0.8, score: 2 as const },
    { maxShare: 1, score: 1 as const },
  ],
};

const JML_TOTAL_0_1_2_3 = {
  kind: "maxShare" as const,
  thresholds: [
    { maxShare: 0, score: 5 as const },
    { maxShare: 0.01, score: 4 as const },
    { maxShare: 0.02, score: 3 as const },
    { maxShare: 0.03, score: 2 as const },
    { maxShare: 1, score: 1 as const },
  ],
};

const LOOKUP_0_2_4_5_6 = {
  kind: "lookupMin" as const,
  breakpoints: [
    { minShare: 0, score: 5 as const },
    { minShare: 0.02, score: 4 as const },
    { minShare: 0.04, score: 3 as const },
    { minShare: 0.05, score: 2 as const },
    { minShare: 0.06, score: 1 as const },
  ],
};

const PRESENCE_GT_0 = {
  kind: "maxShare" as const,
  thresholds: [
    { maxShare: 0, score: 5 as const },
    { maxShare: 1, score: 1 as const },
  ],
};

/** Row 57's "e." leaf: `IF(SUM(D145)>1,1,5)` -- threshold at 1, not 0. */
const PRESENCE_GT_1 = {
  kind: "maxShare" as const,
  thresholds: [
    { maxShare: 1, score: 5 as const },
    { maxShare: Infinity, score: 1 as const },
  ],
};

const templateParameters: ParameterConfig[] = [
  // Risiko Inheren TPPU (40%)
  { kind: "form", id: "7", category: "TPPU", weight: 0.195, cellRef: O(7), rule: IF_CHAIN_20_40_60_80_100, label: "Persentase transaksi menggunakan layanan berisiko Tinggi menurut SRA" },
  { kind: "form", id: "8", category: "TPPU", weight: 0.105, cellRef: O(8), rule: IF_CHAIN_20_40_60_80_100, label: "Persentase transaksi menggunakan layanan berisiko Menengah menurut SRA" },
  { kind: "form", id: "10", category: "TPPU", weight: 0.13, cellRef: O(10), rule: IF_CHAIN_20_40_60_80_100, label: "Persentase transaksi melalui jalur distribusi berisiko Tinggi dari total transaksi" },
  { kind: "form", id: "11", category: "TPPU", weight: 0.07, cellRef: O(11), rule: IF_CHAIN_20_40_60_80_100, label: "Persentase transaksi melalui jalur distribusi berisiko Menengah menurut SRA dari total transaksi" },
  { kind: "form", id: "13", category: "TPPU", weight: 0.105, cellRef: O(13), rule: JML_TOTAL_0_1_2_3, label: "Persentase pengguna jasa individu dengan profesi berisiko Tinggi TPPU menurut SRA dari seluruh pengguna jasa" },
  { kind: "form", id: "14", category: "TPPU", weight: 0.03, cellRef: O(14), rule: LOOKUP_0_2_4_5_6, label: "Persentase pengguna jasa individu dengan profesi berisiko Menengah TPPU menurut SRA dari seluruh pengguna jasa" },
  { kind: "form", id: "15", category: "TPPU", weight: 0.105, cellRef: O(15), rule: JML_TOTAL_0_1_2_3, label: "Persentase pengguna jasa badan usaha dengan bentuk badan hukum berisiko Tinggi TPPU menurut SRA dari seluruh pengguna jasa" },
  { kind: "form", id: "16", category: "TPPU", weight: 0.03, cellRef: O(16), rule: LOOKUP_0_2_4_5_6, label: "Persentase pengguna jasa badan usaha dengan bentuk badan hukum berisiko Menengah TPPU menurut SRA dari seluruh pengguna jasa" },
  { kind: "form", id: "17", category: "TPPU", weight: 0.03, cellRef: O(17), rule: PRESENCE_GT_0, label: "Ada/tidak transaksi melibatkan WN High Risk Countries menurut Black/Grey list FATF dari seluruh transaksi" },
  { kind: "form", id: "19", category: "TPPU", weight: 0.15, cellRef: O(19), rule: JML_TOTAL_0_1_2_3, label: "Persentase transaksi yang dilakukan di wilayah berisiko Tinggi TPPU sesuai SRA dari seluruh transaksi" },
  { kind: "form", id: "20", category: "TPPU", weight: 0.05, cellRef: O(20), rule: PRESENCE_GT_0, label: "Ada/tidak transaksi yang dilakukan di High Risk Countries menurut Black/Grey list FATF" },

  // Risiko Inheren TPPT (25%)
  { kind: "form", id: "23", category: "TPPT", weight: 0.14, cellRef: O(23), rule: IF_CHAIN_20_40_60_80_100, label: "Persentase transaksi menggunakan layanan berisiko Tinggi menurut SRA dari seluruh transaksi" },
  { kind: "form", id: "24", category: "TPPT", weight: 0.06, cellRef: O(24), rule: IF_CHAIN_20_40_60_80_100, label: "Persentase transaksi menggunakan layanan berisiko Menengah menurut SRA dari seluruh transaksi" },
  { kind: "manual", id: "26", category: "TPPT", weight: 0.14, cellRef: O(26), defaultScore: 5, label: "Persentase transaksi menggunakan jalur distribusi berisiko Tinggi menurut SRA dari seluruh transaksi" },
  { kind: "form", id: "27", category: "TPPT", weight: 0.06, cellRef: O(27), rule: IF_CHAIN_20_40_60_80_100, label: "Persentase transaksi menggunakan jalur distribusi berisiko Menengah menurut SRA dari seluruh transaksi" },
  { kind: "form", id: "29", category: "TPPT", weight: 0.105, cellRef: O(29), rule: JML_TOTAL_0_1_2_3, label: "Persentase pengguna jasa individu dengan profesi berisiko Tinggi TPPT menurut SRA dari seluruh pengguna jasa" },
  { kind: "form", id: "30", category: "TPPT", weight: 0.03, cellRef: O(30), rule: JML_TOTAL_0_1_2_3, label: "Persentase pengguna jasa individu dengan profesi berisiko Menengah TPPT menurut SRA dari seluruh pengguna jasa" },
  { kind: "manual", id: "31", category: "TPPT", weight: 0.105, cellRef: O(31), defaultScore: 5, label: "Persentase pengguna jasa badan usaha dengan bentuk badan hukum berisiko Tinggi TPPT menurut SRA dari seluruh pengguna jasa" },
  { kind: "manual", id: "32", category: "TPPT", weight: 0.03, cellRef: O(32), defaultScore: 5, label: "Persentase pengguna jasa badan usaha dengan bentuk badan hukum berisiko Menengah TPPT menurut SRA dari seluruh pengguna jasa" },
  { kind: "form", id: "34", category: "TPPT", weight: 0.225, cellRef: O(34), rule: JML_TOTAL_0_1_2_3, label: "Persentase transaksi yang dilakukan di wilayah berisiko Tinggi TPPT sesuai SRA dari seluruh transaksi" },
  { kind: "form", id: "35", category: "TPPT", weight: 0.075, cellRef: O(35), rule: PRESENCE_GT_0, label: "Ada/tidak transaksi yang dilakukan di High Risk Countries menurut Black/Grey list FATF" },

  // Risiko Inheren PPSPM (5%)
  { kind: "form", id: "38", category: "PPSPM", weight: 0.07, cellRef: O(38), rule: IF_CHAIN_20_40_60_80_100, label: "Persentase menggunakan layanan berisiko tinggi menurut SRA" },
  { kind: "manual", id: "39", category: "PPSPM", weight: 0.03, cellRef: O(39), defaultScore: 5, label: "Persentase menggunakan layanan berisiko menengah menurut SRA" },
  { kind: "form", id: "41", category: "PPSPM", weight: 0.08, cellRef: O(41), rule: PRESENCE_GT_0, label: "Ada/Tidak mitra kerja sama dari negara asing" },
  { kind: "manual", id: "42", category: "PPSPM", weight: 0.12, cellRef: O(42), defaultScore: 5, label: "Ada/Tidak mitra yang berasal dari negara yang terkena sanksi Dewan Keamanan PBB terkait PPSPM" },
  { kind: "form", id: "44", category: "PPSPM", weight: 0.2, cellRef: O(44), rule: JML_TOTAL_0_1_2_3, label: "Persentase pengguna jasa Individu yang berasal dari negara yang terkena sanksi Dewan Keamanan PBB terkait PPSPM" },
  { kind: "form", id: "45", category: "PPSPM", weight: 0.1, cellRef: O(45), rule: JML_TOTAL_0_1_2_3, label: "Persentase pengguna jasa individu dengan profesi Pengurus/Pegawai LSM/organisasi tidak berbadan hukum lainnya, PEPs (diplomat asing) serta Pengusaha/Wiraswasta ekspor-impor dual-use goods" },
  { kind: "form", id: "46", category: "PPSPM", weight: 0.1, cellRef: O(46), rule: JML_TOTAL_0_1_2_3, label: "Persentase pengguna jasa Badan Usaha Perusahaan Non UMKM berbentuk Perseroan Terbatas" },
  { kind: "form", id: "48", category: "PPSPM", weight: 0.3, cellRef: O(48), rule: PRESENCE_GT_0, label: "Ada/tidak ada transaksi (In/Out) melibatkan negara yang terkena sanksi Dewan Keamanan PBB terkait PPSPM dari total transaksi" },

  // Risiko Struktural (30%)
  { kind: "manual", id: "51", category: "Struktural", weight: 0.16, cellRef: O(51), defaultScore: 5, label: "Ultimate Beneficial Owner (UBO) dapat/tidak dapat diidentifikasi" },
  { kind: "form", id: "52", category: "Struktural", weight: 0.16, cellRef: O(52), rule: PRESENCE_GT_0, label: "Ada/tidak pemegang saham berupa PEP" },
  { kind: "form", id: "53", category: "Struktural", weight: 0.16, cellRef: O(53), rule: PRESENCE_GT_0, label: "Ada/tidak pemegang saham berupa nominee dan/atau trust" },
  { kind: "form", id: "54", category: "Struktural", weight: 0.16, cellRef: O(54), rule: PRESENCE_GT_0, label: "Ada/tidak pemegang saham berupa WN atau BH dari negara berisiko tinggi" },
  { kind: "manual", id: "55", category: "Struktural", weight: 0.16, cellRef: O(55), defaultScore: 5, label: "Entitas merupakan bagian dari Grup dan/atau memiliki struktur korporasi kompleks" },
  { kind: "form", id: "57", category: "Struktural", weight: 0.2, cellRef: O(57), rule: PRESENCE_GT_1, label: "Ada/Tidak lini bisnis lain di luar Sistem Pembayaran yang berisiko terhadap TPPU, TPPT dan PPSPM" },
];

/**
 * Deliberate corrections to A2 leaf weights (column E), applied by the app and
 * written into the Template Excel export. TPPT "Pengguna Jasa" (rows 29-32) is
 * 35/10/35/10 in the template, which sums to 90%; BI's BSSS report uses
 * 35/15/35/15. Decided 2026-10-06: follow the BSSS.
 */
export const leafWeightFixes: Record<string, { template: number; fixed: number }> = {
  "30": { template: 0.1, fixed: 0.15 },
  "32": { template: 0.1, fixed: 0.15 },
};

/** The 35 parameters as the app scores them: the template's, with `leafWeightFixes` applied. */
export const parameters: ParameterConfig[] = templateParameters.map((p) => {
  const fix = leafWeightFixes[p.id];
  // `weight` is item weight × leaf weight, so scaling it by fixed/template swaps the leaf weight.
  return fix ? { ...p, weight: (p.weight / fix.template) * fix.fixed } : p;
});

/**
 * Which 'C2. Form PJP LR' cells feed each parameter's `share` (summed).
 * Not part of `ScoringConfig` -- this is the field-mapping side, kept next
 * to the scoring rules only because both come from the same formula dump.
 */
export const parameterShareRefs: Record<string, string[]> = {
  "7": ["D10"],
  "8": ["D12"],
  "10": ["D90"],
  "11": ["D20"],
  "13": ["D35", "D39", "D58"],
  "14": ["D42", "D40", "D39"],
  "15": ["D62", "D64"],
  "16": ["D62"],
  "17": ["D120", "D121"],
  "19": ["D90"],
  "20": ["D120", "D121"],
  "23": ["D6", "D7", "D8"],
  "24": ["D13"],
  "27": ["D20"],
  "29": ["D35"],
  "30": ["D38"],
  "34": ["D90", "D84"],
  "35": ["D120", "D121"],
  "38": ["D6", "D7", "D8"],
  "41": ["D29"],
  "44": ["D123"],
  "45": ["D35", "D49", "C58"],
  "46": ["D62"],
  "48": ["D123"],
  "52": ["D139"],
  "53": ["D140", "D141"],
  "54": ["C132"],
  "57": ["D145"],
};

/**
 * Deliberate corrections to the template's references, applied by the app and
 * written into the export (see `a2FormulaOverrides2026` in 2026-sheet.ts):
 * rows 11 and 27 (jalur distribusi berisiko Menengah) read C2!D20, the empty
 * "Jalur Distribusi" heading, so they always scored 5. Their Keterangan says
 * "Kantor PTD", which is D22. Decided 2026-10-05.
 */
export const parameterShareRefFixes: Record<string, { template: string[]; fixed: string[] }> = {
  "11": { template: ["D20"], fixed: ["D22"] },
  "27": { template: ["D20"], fixed: ["D22"] },
};
for (const [id, fix] of Object.entries(parameterShareRefFixes)) parameterShareRefs[id] = fix.fixed;

/** The template's own references, before the fixes: what `scripts/golden-test.ts` checks the 66 real files against. */
export const templateParameterShareRefs: Record<string, string[]> = {
  ...parameterShareRefs,
  ...Object.fromEntries(Object.entries(parameterShareRefFixes).map(([id, fix]) => [id, fix.template])),
};

export const hasDataMismatchCellRef = "C2. Form PJP LR!H18";
export const hasDataMismatchValue = "Perbedaan Data";

function kpmrPillar(pillar: string, fromRow: number, toRow: number): KpmrQuestionConfig[] {
  const questions: KpmrQuestionConfig[] = [];
  for (let row = fromRow; row <= toRow; row++) {
    questions.push({
      id: `kpmr-${row}`,
      pillar,
      cellRef: `B. KPMR 2025!H${row}`,
      pengawasCellRef: `B. KPMR 2025!J${row}`,
    });
  }
  return questions;
}

const KPMR_PILLARS = {
  direksi: "Tugas Dan Tanggung Jawab Direksi Dan Pengawasan Aktif Dewan Komisaris",
  kpt: "Kebijakan Dan Prosedur Tertulis",
  prosesMr: "Proses Manajemen Risiko",
  sdm: "Manajemen Sumber Daya Manusia",
  spi: "Sistem Pengendalian Internal",
} as const;

export const kpmrQuestions: KpmrQuestionConfig[] = [
  ...kpmrPillar(KPMR_PILLARS.direksi, 5, 11),
  ...kpmrPillar(KPMR_PILLARS.kpt, 14, 21),
  ...kpmrPillar(KPMR_PILLARS.prosesMr, 24, 33),
  ...kpmrPillar(KPMR_PILLARS.sdm, 36, 38),
  ...kpmrPillar(KPMR_PILLARS.spi, 41, 43),
];

/**
 * The weights in the KPMR sheet's own pillar headings (rows 4, 13, 23, 35, 40:
 * "(30%)", "(25%)", "(25%)", "(10%)", "(10%)"). The 2026 template's H46/J46
 * ignore them (`=AVERAGE(H12,H22,H34,H39,H44)`, identical in all 66 files);
 * the app applies them by decision (2026-10-05), and the export rewrites
 * H46/J46 to match (see `kpmrOverallFormulas2026` in 2026-sheet.ts).
 * `scripts/golden-test.ts` drops them to keep checking the template's own formula.
 */
export const kpmrPillarWeights: Record<string, number> = {
  [KPMR_PILLARS.direksi]: 0.3,
  [KPMR_PILLARS.kpt]: 0.25,
  [KPMR_PILLARS.prosesMr]: 0.25,
  [KPMR_PILLARS.sdm]: 0.1,
  [KPMR_PILLARS.spi]: 0.1,
};

// Both predikat scales share the same breakpoints (A2!H60:H64 / K60:K64).
const SCALE_BREAKPOINTS = [1, 2, 3, 3.75, 4.5];

export const inherentPredikatRules: PredikatRule[] = [
  { label: "Tinggi", minScore: SCALE_BREAKPOINTS[0] },
  { label: "Menengah ke Tinggi", minScore: SCALE_BREAKPOINTS[1] },
  { label: "Menengah", minScore: SCALE_BREAKPOINTS[2] },
  { label: "Rendah ke Menengah", minScore: SCALE_BREAKPOINTS[3] },
  { label: "Rendah", minScore: SCALE_BREAKPOINTS[4] },
];

export const kpmrPredikatRules: PredikatRule[] = [
  { label: "Unsatisfactory", minScore: SCALE_BREAKPOINTS[0] },
  { label: "Marginal", minScore: SCALE_BREAKPOINTS[1] },
  { label: "Fair", minScore: SCALE_BREAKPOINTS[2] },
  { label: "Satisfactory", minScore: SCALE_BREAKPOINTS[3] },
  { label: "Strong", minScore: SCALE_BREAKPOINTS[4] },
];

// A2!I67:M71, rows = inherent predikat, columns = KPMR predikat.
export const finalIraMatrix: FinalIraMatrixEntry[] = [
  { inherentPredikat: "Tinggi", kpmrPredikat: "Unsatisfactory", score: 1 },
  { inherentPredikat: "Tinggi", kpmrPredikat: "Marginal", score: 1 },
  { inherentPredikat: "Tinggi", kpmrPredikat: "Fair", score: 2 },
  { inherentPredikat: "Tinggi", kpmrPredikat: "Satisfactory", score: 3 },
  { inherentPredikat: "Tinggi", kpmrPredikat: "Strong", score: 3 },

  { inherentPredikat: "Menengah ke Tinggi", kpmrPredikat: "Unsatisfactory", score: 1 },
  { inherentPredikat: "Menengah ke Tinggi", kpmrPredikat: "Marginal", score: 2 },
  { inherentPredikat: "Menengah ke Tinggi", kpmrPredikat: "Fair", score: 2 },
  { inherentPredikat: "Menengah ke Tinggi", kpmrPredikat: "Satisfactory", score: 3 },
  { inherentPredikat: "Menengah ke Tinggi", kpmrPredikat: "Strong", score: 4 },

  { inherentPredikat: "Menengah", kpmrPredikat: "Unsatisfactory", score: 2 },
  { inherentPredikat: "Menengah", kpmrPredikat: "Marginal", score: 2 },
  { inherentPredikat: "Menengah", kpmrPredikat: "Fair", score: 3 },
  { inherentPredikat: "Menengah", kpmrPredikat: "Satisfactory", score: 4 },
  { inherentPredikat: "Menengah", kpmrPredikat: "Strong", score: 4 },

  { inherentPredikat: "Rendah ke Menengah", kpmrPredikat: "Unsatisfactory", score: 2 },
  { inherentPredikat: "Rendah ke Menengah", kpmrPredikat: "Marginal", score: 3 },
  { inherentPredikat: "Rendah ke Menengah", kpmrPredikat: "Fair", score: 4 },
  { inherentPredikat: "Rendah ke Menengah", kpmrPredikat: "Satisfactory", score: 4 },
  { inherentPredikat: "Rendah ke Menengah", kpmrPredikat: "Strong", score: 5 },

  { inherentPredikat: "Rendah", kpmrPredikat: "Unsatisfactory", score: 3 },
  { inherentPredikat: "Rendah", kpmrPredikat: "Marginal", score: 3 },
  { inherentPredikat: "Rendah", kpmrPredikat: "Fair", score: 4 },
  { inherentPredikat: "Rendah", kpmrPredikat: "Satisfactory", score: 5 },
  { inherentPredikat: "Rendah", kpmrPredikat: "Strong", score: 5 },
];

export const scoringConfig2026: ScoringConfig = {
  categoryWeights: { TPPU: 0.4, TPPT: 0.25, PPSPM: 0.05, Struktural: 0.3 },
  parameters,
  kpmrQuestions,
  kpmrPillarWeights,
  inherentPredikatRules,
  kpmrPredikatRules,
  finalIraMatrix,
  dataMismatchPenalty: 1,
};

// ---------------------------------------------------------------------------
// Adjustable weights (the admin "Bobot" page)
// ---------------------------------------------------------------------------

/** A2 item rows ("1. Produk dan/atau Jasa", …), each with its category, in sheet order. */
export const a2Items: { row: number; category: string }[] = [
  { row: 6, category: "TPPU" }, { row: 9, category: "TPPU" }, { row: 12, category: "TPPU" }, { row: 18, category: "TPPU" },
  { row: 22, category: "TPPT" }, { row: 25, category: "TPPT" }, { row: 28, category: "TPPT" }, { row: 33, category: "TPPT" },
  { row: 37, category: "PPSPM" }, { row: 40, category: "PPSPM" }, { row: 43, category: "PPSPM" }, { row: 47, category: "PPSPM" },
  { row: 50, category: "Struktural" }, { row: 56, category: "Struktural" },
];

/** The item a parameter row belongs to: the nearest item row above it. */
export function itemRowOf(parameterId: string): number {
  const row = Number(parameterId);
  return [...a2Items].reverse().find((i) => i.row < row)!.row;
}

/**
 * Every weight in the assessment, as fractions (0.4 = 40%), in four groups
 * that must each add up to 1: categories; items within each category;
 * parameters ("leaves") within each item; KPMR pillars. Stored per period by
 * the admin "Bobot" page; anything missing falls back to `defaultWeights2026`.
 */
export interface WeightSet {
  categories: Record<string, number>;
  /** By A2 item row ("6", "9", …). */
  items: Record<string, number>;
  /** By A2 parameter row ("7", "8", …): the weight within its item (column E). */
  leaves: Record<string, number>;
  /** By KPMR pillar name. */
  kpmrPillars: Record<string, number>;
}

/** The template's item weights (A2 column D). */
const TEMPLATE_ITEM_WEIGHTS: Record<string, number> = {
  "6": 0.3, "9": 0.2, "12": 0.3, "18": 0.2,
  "22": 0.2, "25": 0.2, "28": 0.3, "33": 0.3,
  "37": 0.1, "40": 0.2, "43": 0.4, "47": 0.3,
  "50": 0.8, "56": 0.2,
};

/** Today's weights: the template's, with the decided corrections (TPPT 35/15/35/15, KPMR 30/25/25/10/10). */
export const defaultWeights2026: WeightSet = {
  categories: { ...scoringConfig2026.categoryWeights },
  items: { ...TEMPLATE_ITEM_WEIGHTS },
  leaves: Object.fromEntries(parameters.map((p) => [p.id, roundWeight(p.weight / TEMPLATE_ITEM_WEIGHTS[String(itemRowOf(p.id))])])),
  kpmrPillars: { ...kpmrPillarWeights },
};

function roundWeight(x: number) {
  return Math.round(x * 1e6) / 1e6;
}

/** A complete weight set: `partial` on top of the defaults (a saved set may predate a new key). */
export function withDefaultWeights(partial: Partial<WeightSet> | null | undefined): WeightSet {
  return {
    categories: { ...defaultWeights2026.categories, ...partial?.categories },
    items: { ...defaultWeights2026.items, ...partial?.items },
    leaves: { ...defaultWeights2026.leaves, ...partial?.leaves },
    kpmrPillars: { ...defaultWeights2026.kpmrPillars, ...partial?.kpmrPillars },
  };
}

/** The scoring config for a weight set: parameter weight = item weight × leaf weight. */
export function buildScoringConfig2026(weights: WeightSet): ScoringConfig {
  return {
    ...scoringConfig2026,
    categoryWeights: { ...weights.categories },
    parameters: templateParameters.map((p) => ({ ...p, weight: weights.items[String(itemRowOf(p.id))] * weights.leaves[p.id] })),
    kpmrPillarWeights: { ...weights.kpmrPillars },
  };
}

/** One problem per group that doesn't add up to 100% (within 0.01 percentage point) or has a negative weight. */
export function weightProblems(weights: WeightSet): { group: string; total: number }[] {
  const problems: { group: string; total: number }[] = [];
  const check = (group: string, values: number[]) => {
    const total = values.reduce((s, v) => s + v, 0);
    if (Math.abs(total - 1) > 1e-4 || values.some((v) => !(v >= 0))) problems.push({ group, total });
  };
  check("Kategori risiko", Object.keys(scoringConfig2026.categoryWeights).map((c) => weights.categories[c]));
  for (const category of Object.keys(scoringConfig2026.categoryWeights)) {
    check(`Faktor ${category}`, a2Items.filter((i) => i.category === category).map((i) => weights.items[String(i.row)]));
  }
  for (const item of a2Items) {
    check(`Parameter baris ${item.row}`, templateParameters.filter((p) => itemRowOf(p.id) === item.row).map((p) => weights.leaves[p.id]));
  }
  check("Pilar KPMR", Object.values(KPMR_PILLARS).map((p) => weights.kpmrPillars[p]));
  return problems;
}

/**
 * The 2026 template exactly as it was: no KPMR pillar weights, the original
 * TPPT leaf weights. `scripts/golden-test.ts` checks the 66 real files against
 * this (with `templateParameterShareRefs`), since they were scored with it.
 */
export const templateScoringConfig2026: ScoringConfig = {
  ...scoringConfig2026,
  parameters: templateParameters,
  kpmrPillarWeights: undefined,
};
