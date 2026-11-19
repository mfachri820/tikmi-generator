/**
 * PJP names as people type them: the form's dropdown, its "Other" box, a
 * file's D4 and `Lamp. PJP` spell the same company differently ("PT Indogo
 * Ekspress Remittance" vs "Indogo Ekspress Remittance, PT", "(d/h PT Silot
 * Technology Indonesia)", stray punctuation). `normalizeName` is the matching
 * key stored in `pjp_aliases.normalized`.
 */

/** Legal-form words that carry no identity. "KSP" (koperasi) is kept: it is part of the name. */
const LEGAL_FORM = new Set(["pt", "persero", "tbk", "perseroan", "terbatas"]);

/** Spelling variants of one word, mapped to one form ("NANDY DANA EKSPRES" = "Nandy Dana Express"). */
const SPELLING: Record<string, string> = {
  ekspres: "express",
  ekspress: "express",
  expres: "express",
  remitance: "remittance",
};

/** The name with spaces removed: "Omni Pay" = "Omnipay", "e-Transfer" = "ETransfer". */
export function compactName(name: string): string {
  return normalizeName(name).replace(/ /g, "");
}

export function normalizeName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // "(d/h ...)" / "d/h ..." = "dahulu" (formerly): the old name is not this PJP's current name.
      .replace(/\(\s*d\s*\/\s*h\b[^)]*\)?/g, " ")
      .replace(/\bd\s*\/\s*h\b.*$/g, " ")
      .replace(/&/g, " dan ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w && !LEGAL_FORM.has(w))
      .map((w) => SPELLING[w] ?? w)
      .join(" ")
  );
}

/** The "d/h" former name, normalised, when the name carries one: also worth an alias. */
export function formerName(name: string): string | null {
  const m = /\(?\s*d\s*\/\s*h\s+([^)]*)\)?/i.exec(name);
  return m ? normalizeName(m[1]) || null : null;
}

/** Sandi as text with leading zeros: Excel often stores it as a number (69000000 for "069000000"). */
export function normalizeSandi(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === "number" ? String(Math.trunc(raw)) : String(raw).trim();
  if (!/^\d{1,9}$/.test(text)) return null;
  return text.padStart(9, "0");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Similarity of two normalised names, 0..1: the better of character-level
 * similarity (catches typos such as "Remintance") and token overlap (catches
 * dropped or reordered words such as "Remitance" vs "Remittance Indonesia").
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const chars = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  let shared = 0;
  for (const t of ta) {
    if (tb.has(t)) shared++;
    else if ([...tb].some((u) => t.length >= 4 && u.length >= 4 && 1 - levenshtein(t, u) / Math.max(t.length, u.length) >= 0.8)) shared += 0.9;
  }
  const tokens = shared / Math.max(ta.size, tb.size);
  // Every word of the shorter name (2+ words) is in the longer one: "Priority Valasindo" vs
  // "Priority Valasindo Remittance". Strong enough to suggest, never to match automatically.
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  const contained = small.size >= 2 && [...small].every((t) => large.has(t)) ? 0.8 + 0.1 * (small.size / large.size) : 0;
  return Math.min(Math.max(chars, tokens, contained), 0.99);
}
