import type { FinalIraMatrixEntry } from "./types.js";

export function finalIraFromMatrix(
  inherentPredikat: string,
  kpmrPredikat: string,
  matrix: FinalIraMatrixEntry[],
): number {
  const entry = matrix.find(
    (m) => m.inherentPredikat === inherentPredikat && m.kpmrPredikat === kpmrPredikat,
  );
  if (!entry) {
    throw new Error(
      `No final IRA matrix entry for inherent="${inherentPredikat}" kpmr="${kpmrPredikat}"`,
    );
  }
  return entry.score;
}

/**
 * Template rule: `IF(R70>1, R70-1, 1)` -- subtract the penalty but never go
 * below 1. The floor is 1 because that's the bottom of the 1-5 score scale
 * the whole engine works in, not a 2026-specific number.
 */
export function applyDataMismatchPenalty(
  rawScore: number,
  hasDataMismatch: boolean,
  penalty: number,
): number {
  if (!hasDataMismatch) return rawScore;
  return rawScore > 1 ? rawScore - penalty : 1;
}
