/**
 * Just enough of Excel's number formats to show the 2026 template the way the
 * workbook does (in Indonesian locale: "." thousands, "," decimals): General,
 * fixed decimals, thousands grouping, percentages, and the accounting format's
 * "-" for zero. Anything fancier falls back to General.
 */

const LOCALE = "id-ID";

function general(n: number): string {
  return n.toLocaleString(LOCALE, { maximumSignificantDigits: 11, useGrouping: false });
}

/** Splits a format into its ;-separated sections, ignoring ";" inside quotes. */
function sections(format: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of format) {
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

export function formatCellValue(value: unknown, numFmt?: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value !== "number") return String(value);
  if (!Number.isFinite(value)) return "#NUM!";
  if (!numFmt || numFmt === "General" || numFmt === "@") return general(value);

  const parts = sections(numFmt);
  let section = parts[0];
  let n = value;
  let negativeStyle: "minus" | "parens" | "none" = value < 0 ? "minus" : "none";
  if (value < 0 && parts[1] !== undefined) {
    section = parts[1];
    n = Math.abs(value);
    const bare = section.replace(/"[^"]*"/g, "");
    negativeStyle = bare.includes("(") ? "parens" : bare.includes("-") ? "minus" : "none";
  } else if (value === 0 && parts[2] !== undefined) {
    section = parts[2];
    // Accounting's zero section is `_-* "-"??_-`: a quoted dash plus "?" alignment padding, no real digits.
    const bare = section.replace(/"[^"]*"/g, "").replace(/_.|\\.|\*./g, "");
    if (!/[0#]/.test(bare)) return section.match(/"([^"]*)"/)?.[1]?.trim() ?? "";
  } else if (value < 0) {
    n = Math.abs(value);
  }

  const bare = section.replace(/"[^"]*"/g, "");
  const percent = bare.includes("%");
  const decimals = bare.match(/\.([0#?]+)/)?.[1] ?? "";
  const minDecimals = (decimals.match(/0/g) ?? []).length;
  const grouping = /[#0?],[#0?]/.test(bare);
  if (!/[0#?]/.test(bare)) return general(value);

  let text = (percent ? n * 100 : n).toLocaleString(LOCALE, {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: decimals.length,
    useGrouping: grouping,
  });
  if (percent) text += "%";
  if (negativeStyle === "minus") text = `-${text}`;
  if (negativeStyle === "parens") text = `(${text})`;
  return text;
}

export function isPercentFormat(numFmt?: string): boolean {
  return !!numFmt && sections(numFmt)[0].replace(/"[^"]*"/g, "").includes("%");
}

/** The text a cell shows while being edited, like Excel's formula bar (no grouping, "," decimals). */
export function editText(value: unknown, numFmt?: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "number") return String(value);
  if (isPercentFormat(numFmt)) {
    return `${(value * 100).toLocaleString(LOCALE, { useGrouping: false, maximumFractionDigits: 10 })}%`;
  }
  return value.toLocaleString(LOCALE, { useGrouping: false, maximumFractionDigits: 15 });
}

/**
 * Parses what a pengawas typed into a number, accepting Indonesian input
 * ("1.234.567", "0,25", "25%") as well as plain "0.25". Returns null for an
 * empty string and undefined when the text isn't a number.
 */
export function parseNumberInput(text: string): number | null | undefined {
  let t = text.trim();
  if (t === "") return null;
  const percent = t.endsWith("%");
  if (percent) t = t.slice(0, -1);
  t = t.replace(/\s/g, "").replace(/^Rp\.?/i, "");
  let normalized: string;
  if (t.includes(",")) normalized = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) normalized = t.replace(/\./g, "");
  else normalized = t;
  if (normalized === "" || normalized === "-") return undefined;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return undefined;
  return percent ? n / 100 : n;
}

export function columnLetter(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

export function parseAddress(address: string): { row: number; col: number } {
  const m = address.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`Bad cell address "${address}"`);
  const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { row: Number(m[2]), col };
}
