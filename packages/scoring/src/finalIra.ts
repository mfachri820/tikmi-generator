import type { FinalIraMatrixEntry } from "./types";

/** NaN when either predikat isn't in the matrix (e.g. #N/A), like the template's INDEX/MATCH returning #N/A. */
export function finalIraFromMatrix(
  inherentPredikat: string,
  kpmrPredikat: string,
  matrix: FinalIraMatrixEntry[],
): number {
  const entry = matrix.find(
    (m) => m.inherentPredikat === inherentPredikat && m.kpmrPredikat === kpmrPredikat,
  );
  return entry?.score ?? NaN;
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
  if (!hasDataMismatch || Number.isNaN(rawScore)) return rawScore;
  return rawScore > 1 ? rawScore - penalty : 1;
}
