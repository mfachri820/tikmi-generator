import type { ParameterConfig, ParameterInput, ParameterRule, Score } from "./types.js";

export function scoreFromRule(share: number, rule: ParameterRule): Score {
  if (rule.kind === "maxShare") {
    for (const t of rule.thresholds) {
      if (share <= t.maxShare) return t.score;
    }
    return rule.thresholds[rule.thresholds.length - 1].score;
  }

  // lookupMin: last (highest) breakpoint the share clears, ascending order.
  let picked = rule.breakpoints[0].score;
  for (const b of rule.breakpoints) {
    if (share >= b.minShare) picked = b.score;
  }
  return picked;
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
    config.kind === "form" ? scoreFromRule(input?.share ?? 0, config.rule) : config.defaultScore;

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
