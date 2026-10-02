/**
 * Open decisions about LTDBB data quality, as settings. "warn" shows a badge
 * on /admin/ltdbb and still generates the file; "block" stops the export.
 *
 * Not configurable here: the -1 penalty for a PJP missing from LTDBB. The
 * template's own S70 formula penalises any reported total that differs from
 * the (zero) LTDBB total, and the app's live score mirrors the file.
 */
export const ltdbbPolicy = {
  /** A PJP in the form's list with no LTDBB rows for the data year: its Validasi row is written as zeros. */
  missingPjp: "warn" as "warn" | "block",
  /** A PJP with fewer than 12 months of LTDBB data in the data year. */
  incompleteYear: "warn" as "warn" | "block",
};

/** Totals that differ by at most this many Rupiah (or transactions) count as equal: float sums carry noise. */
export const AMOUNT_TOLERANCE = 1;
