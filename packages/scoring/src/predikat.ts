import type { PredikatRule } from "./types";

/**
 * What the template shows when a score is below every rule (e.g. a KPMR
 * average of 0 before any answers exist): its approximate-match `VLOOKUP`
 * returns #N/A, which then flows through the final-IRA lookup too.
 */
export const NOT_AVAILABLE = "#N/A";

/** Highest-scoring rule whose minScore the value clears, so rules can be given in any order. */
export function predikatFromScore(score: number, rules: PredikatRule[]): string {
  const sorted = [...rules].sort((a, b) => b.minScore - a.minScore);
  return sorted.find((rule) => score >= rule.minScore)?.label ?? NOT_AVAILABLE;
}
