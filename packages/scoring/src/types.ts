/**
 * Scoring config is per template version (see `template_versions.scoring_config_json`
 * in the build plan's data model). Nothing in this package may hard-code a 2026
 * weight, threshold or cell address — those live in the config a caller supplies.
 */

export type Score = 1 | 2 | 3 | 4 | 5;

export interface ShareThreshold {
  /** Upper bound (inclusive) of the share this score applies to. Evaluated in order. */
  maxShare: number;
  score: Score;
}

export interface FormParameterConfig {
  kind: "form";
  id: string;
  category: string;
  /** Weight within `category`; weights of all parameters in a category should sum to 1. */
  weight: number;
  /** Template address the pengawas score is written to, e.g. "A2. PJP ALL peng!O7". */
  cellRef: string;
  thresholds: ShareThreshold[];
}

export interface ManualParameterConfig {
  kind: "manual";
  id: string;
  category: string;
  weight: number;
  cellRef: string;
  /** Score assumed until a pengawas provides one ("Perlu Penilaian Pengawas"). */
  defaultScore: Score;
}

export type ParameterConfig = FormParameterConfig | ManualParameterConfig;

export interface KpmrQuestionConfig {
  id: string;
  pillar: string;
  cellRef: string;
  pengawasCellRef: string;
}

export interface PredikatRule {
  label: string;
  minScore: number;
}

export interface FinalIraMatrixEntry {
  inherentPredikat: string;
  kpmrPredikat: string;
  score: number;
}

export interface ScoringConfig {
  categoryWeights: Record<string, number>;
  parameters: ParameterConfig[];
  kpmrQuestions: KpmrQuestionConfig[];
  inherentPredikatRules: PredikatRule[];
  kpmrPredikatRules: PredikatRule[];
  finalIraMatrix: FinalIraMatrixEntry[];
  /** Subtracted from the final IRA score when the workbook shows "Perbedaan Data". */
  dataMismatchPenalty: number;
}

export interface ParameterInput {
  id: string;
  /** Share (0..1) derived from C2 form values; omitted for manual parameters. */
  share?: number;
  /** Pengawas override; when present it wins over the form-derived score. */
  pengawasScore?: Score;
}

export interface KpmrAnswerInput {
  id: string;
  /** PJP self-score 1-5; undefined means "n/a" (blank in the sheet). */
  pjpScore?: number;
  /** Pengawas score; defaults to pjpScore when absent. */
  pengawasScore?: number;
}

export interface WorkbookScoringInput {
  parameters: ParameterInput[];
  kpmrAnswers: KpmrAnswerInput[];
  hasDataMismatch: boolean;
}
