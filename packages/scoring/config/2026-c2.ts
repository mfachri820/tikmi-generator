import { computeShare } from "../src/shares";

/**
 * The 2026 template's "C2. Form PJP LR" sheet: typed values in column C,
 * shares derived into column D as `IFERROR(sum(numerator)/sum(denominator),0)`.
 * Reverse-engineered from that sheet's own formulas (identical across all 66
 * fixtures). Two known quirks are preserved exactly, not "fixed":
 *  - The business-entity denominator (C74) sums only rows 62-70; the two
 *    "Tidak Berbadan Hukum" rows (72, 73) are excluded from their own
 *    group's denominator while still getting a share computed against it.
 *  - Some fields (ownership/control %, lini bisnis) have no D-column share
 *    at all -- their raw C value is used directly downstream (see A2's
 *    config, e.g. parameter "54" reads C132, not a derived share).
 */

function range(prefix: string, from: number, to: number): string[] {
  const cells: string[] = [];
  for (let i = from; i <= to; i++) cells.push(`${prefix}${i}`);
  return cells;
}

export interface C2ShareGroup {
  name: string;
  /** C-column cells this group derives a D-column share for. */
  numeratorCells: string[];
  /** C-column cells summed to make the group's shared denominator. */
  denominatorCells: string[];
}

export const c2ShareGroups: C2ShareGroup[] = [
  {
    name: "transaksiByProdukDanEksposur",
    numeratorCells: [...range("C", 6, 17), "C120", "C121", "C123"],
    denominatorCells: range("C", 6, 17),
  },
  {
    name: "jalurDistribusi",
    numeratorCells: range("C", 22, 24),
    denominatorCells: range("C", 22, 24),
  },
  {
    name: "mitraKerjaSamaNegara",
    numeratorCells: ["C28", "C29"],
    denominatorCells: ["C28", "C29"],
  },
  {
    name: "penggunaJasaPerorangan",
    numeratorCells: [...range("C", 34, 56), "C58"],
    denominatorCells: range("C", 34, 56),
  },
  {
    name: "penggunaJasaBadanUsaha",
    numeratorCells: [...range("C", 62, 70), "C72", "C73"],
    denominatorCells: range("C", 62, 70),
  },
  {
    name: "provinsi",
    numeratorCells: range("C", 80, 117),
    denominatorCells: range("C", 80, 117),
  },
];

/** Cell holding the self-reported transaction total (`=SUM(C6:C17)`), compared against BI's reference for the "Perbedaan Data" flag. */
export const totalTransactionCellRef = "C18";
export const dataMismatchToleranceRupiah = 1000;

function cellNum(raw: Record<string, number>, cell: string): number {
  return raw[cell] ?? 0;
}

function toShareCell(numeratorCell: string): string {
  return `D${numeratorCell.slice(1)}`;
}

/**
 * Derives every D-column share plus the group denominators (and the
 * transaction total) from raw typed C-column values. The result is keyed by
 * cell address ("D10", "C18", ...) so it can be looked up the same way as a
 * cached cell value.
 */
export function computeC2Derived(raw: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};

  for (const group of c2ShareGroups) {
    const denominator = group.denominatorCells.reduce((sum, cell) => sum + cellNum(raw, cell), 0);
    for (const numeratorCell of group.numeratorCells) {
      result[toShareCell(numeratorCell)] = computeShare(cellNum(raw, numeratorCell), denominator);
    }
  }

  result[totalTransactionCellRef] = c2ShareGroups[0].denominatorCells.reduce(
    (sum, cell) => sum + cellNum(raw, cell),
    0,
  );

  return result;
}
