/** Share of a total, guarding the zero-total case (no transactions reported). */
export function computeShare(value: number, total: number): number {
  if (total <= 0) return 0;
  return value / total;
}
