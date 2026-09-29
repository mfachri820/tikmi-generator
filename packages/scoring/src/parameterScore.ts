import type {
  ParameterConfig,
  ParameterInput,
  Score,
  ShareThreshold,
} from "./types.js";

export function scoreFromShare(share: number, thresholds: ShareThreshold[]): Score {
  for (const t of thresholds) {
    if (share <= t.maxShare) return t.score;
  }
  return thresholds[thresholds.length - 1].score;
}

export interface ResolvedParameter {
  id: string;
  category: string;
  weight: number;
  cellRef: string;
  /** Score derived from the form / default, before any pengawas override. */
  pjpValue: Score;
  /** Score used in the final calculation: the pengawas override, or pjpValue. */
  pengawasValue: Score;
  /** True when the pengawas score differs from pjpValue and needs a recorded reason. */
  isOverride: boolean;
}

export function resolveParameter(
  config: ParameterConfig,
  input: ParameterInput | undefined,
): ResolvedParameter {
  const pjpValue: Score =
    config.kind === "form"
      ? scoreFromShare(input?.share ?? 0, config.thresholds)
      : config.defaultScore;

  const pengawasValue = input?.pengawasScore ?? pjpValue;

  return {
    id: config.id,
    category: config.category,
    weight: config.weight,
    cellRef: config.cellRef,
    pjpValue,
    pengawasValue,
    isOverride: pengawasValue !== pjpValue,
  };
}
