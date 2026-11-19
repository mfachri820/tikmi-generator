/** Excel values as the evaluator sees them. `null` is an empty cell. */

export class XlError {
  private constructor(public readonly code: string) {}
  static readonly DIV0 = new XlError("#DIV/0!");
  static readonly NA = new XlError("#N/A");
  static readonly VALUE = new XlError("#VALUE!");
  static readonly REF = new XlError("#REF!");
  static readonly NAME = new XlError("#NAME?");
  static readonly NUM = new XlError("#NUM!");
  static readonly CALC = new XlError("#CALC!");
  static of(code: string): XlError {
    const known = [XlError.DIV0, XlError.NA, XlError.VALUE, XlError.REF, XlError.NAME, XlError.NUM, XlError.CALC].find((e) => e.code === code);
    return known ?? new XlError(code);
  }
  toString() {
    return this.code;
  }
}

export type Scalar = number | string | boolean | null | XlError;

/** A rectangle of values: a range reference or an array result (FILTER, comparisons over ranges). Row-major. */
export interface Matrix {
  kind: "matrix";
  rows: number;
  cols: number;
  data: Scalar[];
}

export type Value = Scalar | Matrix;

export const isError = (v: unknown): v is XlError => v instanceof XlError;
export const isMatrix = (v: Value): v is Matrix => typeof v === "object" && v !== null && (v as Matrix).kind === "matrix";

export function matrix(rows: number, cols: number, data: Scalar[]): Matrix {
  return { kind: "matrix", rows, cols, data };
}

export function at(m: Matrix, r: number, c: number): Scalar {
  // Broadcasting: a single row/column repeats along the other dimension.
  const rr = m.rows === 1 ? 0 : r;
  const cc = m.cols === 1 ? 0 : c;
  if (rr >= m.rows || cc >= m.cols) return XlError.NA;
  return m.data[rr * m.cols + cc];
}

/** Excel's "General" number display, used when a number becomes text (& LEFT TRIM). */
export function numberToText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const p = Number(n.toPrecision(15));
  return String(p).replace("e+", "E+").replace("e-", "E-");
}

const NUMERIC_TEXT = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?%?$/;

/** Number from typed text the way Excel coerces it in arithmetic ("12" -> 12, "20%" -> 0.2), or null. */
export function parseNumericText(s: string): number | null {
  const t = s.trim();
  if (!NUMERIC_TEXT.test(t)) return null;
  return t.endsWith("%") ? Number(t.slice(0, -1)) / 100 : Number(t);
}

export function toNumber(v: Scalar): number | XlError {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isError(v)) return v;
  const n = parseNumericText(v);
  return n === null ? XlError.VALUE : n;
}

export function toBool(v: Scalar): boolean | XlError {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (isError(v)) return v;
  const u = v.trim().toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  return XlError.VALUE;
}

export function toText(v: Scalar): string | XlError {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (isError(v)) return v;
  return numberToText(v);
}

/** Excel type order for comparisons: numbers < text < logicals. */
function rank(v: number | string | boolean): number {
  return typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2;
}

/**
 * Excel comparison: -1, 0, 1. An empty cell compares as 0, "" or FALSE
 * depending on the other side; text compares case-insensitively.
 */
export function compare(a: Scalar, b: Scalar): number | XlError {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === "string") {
    const x = a.toLowerCase();
    const y = (b as string).toLowerCase();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (typeof a === "boolean") return a === b ? 0 : a ? 1 : -1;
  return a === b ? 0 : (a as number) < (b as number) ? -1 : 1;
}

/** Lookup equality (VLOOKUP / XLOOKUP / MATCH exact): same type, text case-insensitive; an empty cell never matches. */
export function lookupEquals(needle: Scalar, hay: Scalar): boolean {
  if (hay === null || isError(hay) || isError(needle)) return false;
  if (needle === null) return false;
  if (typeof needle !== typeof hay) return false;
  if (typeof needle === "string") return needle.toLowerCase() === (hay as string).toLowerCase();
  return needle === hay;
}
