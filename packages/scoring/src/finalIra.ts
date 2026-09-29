import type { FinalIraMatrixEntry } from "./types.js";

export function finalIraScore(
  inherentPredikat: string,
  kpmrPredikat: string,
  matrix: FinalIraMatrixEntry[],
  hasDataMismatch: boolean,
  dataMismatchPenalty: number,
): number {
  const entry = matrix.find(
    (m) => m.inherentPredikat === inherentPredikat && m.kpmrPredikat === kpmrPredikat,
  );
  if (!entry) {
    throw new Error(
      `No final IRA matrix entry for inherent="${inherentPredikat}" kpmr="${kpmrPredikat}"`,
    );
  }
  return hasDataMismatch ? entry.score - dataMismatchPenalty : entry.score;
}
