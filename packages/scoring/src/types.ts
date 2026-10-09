/**
 * Scoring config is per template version (see `template_versions.scoring_config_json`
 * in the build plan's data model). Nothing in this package may hard-code a 2026
 * weight, threshold or cell address — those live in the config a caller supplies.
 */

export type Score = 1 | 2 | 3 | 4 | 5;

/**
 * Score picked by the FIRST threshold (ascending by `maxShare`) the share
 * clears, e.g. `share <= 0.2 -> 5`. This is how most of the template's plain
 * `IF(share<=20%,5,IF(share<=40%,4,...))` chains work. A share of exactly a
 * boundary value takes the *better* (higher) score.
 */
export interface MaxShareRule {
  kind: "maxShare";
  thresholds: { maxShare: number; score: Score }[];
}

/**
 * Score picked by the LAST breakpoint (ascending by `minShare`) the share
 * clears, e.g. breakpoints 0/0.02/0.04 -> 5/4/3 means a share of exactly
 * 0.02 takes 4, not 5. This is how the template's `LOOKUP(share, {breakpoints}, {scores})`
 * formulas work -- the opposite boundary convention from `maxShare`.
 */
export interface LookupMinRule {
  kind: "lookupMin";
  breakpoints: { minShare: number; score: Score }[];
}

export type ParameterRule = MaxShareRule | LookupMinRule;

export interface FormParameterConfig {
  kind: "form";
  id: string;
  category: string;
  /** Weight within `category`; weights of a category's parameters are not guaranteed to sum to 1 -- port them as given, not as "should be". */
  weight: number;
  /** Template address the pengawas score is written to, e.g. "A2. PJP ALL peng!O7". */
  cellRef: string;
  rule: ParameterRule;
  /** The template's own "Parameter" (column F) description, in Bahasa Indonesia, for display. */
  label: string;
}

export interface ManualParameterConfig {
  kind: "manual";
  id: string;
  category: string;
  weight: number;
  cellRef: string;
  /** Score assumed until a pengawas provides one ("Perlu Penilaian Pengawas"). */
  defaultScore: Score;
  label: string;
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
  /**
   * Weight of each KPMR pillar in the overall score (summing to 1). A pillar
   * with no answers counts as 0, like the template's IFERROR(...,0) pillar
   * rows. Omitted = the plain average of the answered pillars' averages.
   */
  kpmrPillarWeights?: Record<string, number>;
  /** Also used to find the predikat of the final IRA score itself (same 1-5 scale). */
  inherentPredikatRules: PredikatRule[];
  kpmrPredikatRules: PredikatRule[];
  finalIraMatrix: FinalIraMatrixEntry[];
  /** Subtracted from the pengawas final IRA score when the workbook shows "Perbedaan Data", floored at 1. */
  dataMismatchPenalty: number;
}

export interface ParameterInput {
  id: string;
  /** Share/value the rule is evaluated against; omitted for manual parameters. */
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
