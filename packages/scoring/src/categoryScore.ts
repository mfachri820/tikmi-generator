import type { ResolvedParameter } from "./parameterScore";

export interface CategoryScores {
  /** Score per category, computed from pjpValue (no pengawas overrides). */
  pjp: Record<string, number>;
  /** Score per category, computed from pengawasValue. */
  pengawas: Record<string, number>;
}

function weightedSum(
  parameters: ResolvedParameter[],
  category: string,
  pick: (p: ResolvedParameter) => number,
): number {
  return parameters
    .filter((p) => p.category === category)
    .reduce((sum, p) => sum + p.weight * pick(p), 0);
}

export function computeCategoryScores(
  parameters: ResolvedParameter[],
  categories: string[],
): CategoryScores {
  const pjp: Record<string, number> = {};
  const pengawas: Record<string, number> = {};
  for (const category of categories) {
    pjp[category] = weightedSum(parameters, category, (p) => p.pjpValue);
    pengawas[category] = weightedSum(parameters, category, (p) => p.pengawasValue);
  }
  return { pjp, pengawas };
}

/** Combines category scores into the inherent + struktural score via categoryWeights. */
export function combineCategories(
  categoryScores: Record<string, number>,
  categoryWeights: Record<string, number>,
): number {
  return Object.entries(categoryWeights).reduce(
    (sum, [category, weight]) => sum + weight * (categoryScores[category] ?? 0),
    0,
  );
}
