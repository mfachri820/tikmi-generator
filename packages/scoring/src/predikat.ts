import type { PredikatRule } from "./types.js";

/** Highest-scoring rule whose minScore the value clears, so rules can be given in any order. */
export function predikatFromScore(score: number, rules: PredikatRule[]): string {
  const sorted = [...rules].sort((a, b) => b.minScore - a.minScore);
  const match = sorted.find((rule) => score >= rule.minScore);
  if (!match) {
    throw new Error(`No predikat rule matches score ${score}`);
  }
  return match.label;
}
