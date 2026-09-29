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

export const parameters: ParameterConfig[] = [
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

export const kpmrQuestions: KpmrQuestionConfig[] = [
  ...kpmrPillar("Tugas Dan Tanggung Jawab Direksi Dan Pengawasan Aktif Dewan Komisaris", 5, 11),
  ...kpmrPillar("Kebijakan Dan Prosedur Tertulis", 14, 21),
  ...kpmrPillar("Proses Manajemen Risiko", 24, 33),
  ...kpmrPillar("Manajemen Sumber Daya Manusia", 36, 38),
  ...kpmrPillar("Sistem Pengendalian Internal", 41, 43),
];

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
  inherentPredikatRules,
  kpmrPredikatRules,
  finalIraMatrix,
  dataMismatchPenalty: 1,
};
