import type { SumberBiRow } from "./parse";

/** What `VLOOKUP(IDDATA&"-"&Sandi, Sumber BI!D:E, 2, FALSE)` gives. */
export type LookupResult =
  /** No row with the key: #N/A, which the KK's IFERROR turns into "NA". */
  | { found: false }
  /** A number, the text written in the amount cell, or 0 for a blank amount (Excel's VLOOKUP of an empty cell). */
  | { found: true; value: number | string; rowNo: number };

export interface SumberBiLookup {
  get(dataId: string, sandi: string): LookupResult;
  /** Lookup by a ready key (the template's idx), e.g. for the industri sheet. */
  getByKey(key: string): LookupResult;
  /** Sandi that have at least one row. */
  pelapor(): Set<string>;
}

/**
 * Exact-match VLOOKUP semantics: case-insensitive key comparison, first row in
 * file order wins.
 */
export function buildLookup(rows: Iterable<SumberBiRow>): SumberBiLookup {
  const byKey = new Map<string, SumberBiRow>();
  const pel = new Set<string>();
  const sorted = [...rows].sort((a, b) => a.rowNo - b.rowNo);
  for (const r of sorted) {
    if (r.idpelapor) pel.add(r.idpelapor);
    if (r.idx === null) continue;
    const key = r.idx.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, r);
  }
  const getByKey = (key: string): LookupResult => {
    const r = byKey.get(key.toLowerCase());
    if (!r) return { found: false };
    return { found: true, value: r.amount ?? r.amountText ?? 0, rowNo: r.rowNo };
  };
  return {
    getByKey,
    get: (dataId, sandi) => getByKey(`${dataId}-${sandi}`),
    pelapor: () => new Set(pel),
  };
}

export interface CoverageRow {
  sandi: string;
  /** Data IDs with a row for this PJP. */
  dataIds: number;
}

/** Which of `sandi` have at least one row, and how many data IDs each; the rest are `missing`. */
export function coverage(rows: Iterable<SumberBiRow>, sandi: string[]): { covered: CoverageRow[]; missing: string[] } {
  const ids = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.idpelapor) continue;
    if (!ids.has(r.idpelapor)) ids.set(r.idpelapor, new Set());
    ids.get(r.idpelapor)!.add(r.dataId);
  }
  const covered: CoverageRow[] = [];
  const missing: string[] = [];
  for (const s of sandi) {
    const n = ids.get(s)?.size ?? 0;
    if (n > 0) covered.push({ sandi: s, dataIds: n });
    else missing.push(s);
  }
  return { covered, missing };
}
