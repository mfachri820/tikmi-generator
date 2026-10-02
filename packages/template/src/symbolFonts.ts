/**
 * Symbol fonts draw letters as pictograms: in Webdings an "a" is a checkmark,
 * which is how the template ticks the KPMR "PSP LSB" column. A browser
 * without the font shows the bare letter, so the layout carries the Unicode
 * character the font would draw. Display only -- exports keep the template's
 * own cells.
 */
const SYMBOL_FONTS: Record<string, Record<string, string>> = {
  webdings: { a: "✓", r: "✕" },
  marlett: { a: "✓", b: "✔", r: "✕" },
  wingdings: { "ü": "✓", "û": "✗", "þ": "☑", "ý": "☒", "o": "☐", "¨": "☐", "l": "●", "n": "■" },
  "wingdings 2": { P: "✓", O: "✗", R: "☑", S: "☒", T: "☒", "£": "☐" },
};

export function symbolFontText(text: string, fontName: string | undefined): string {
  const map = fontName ? SYMBOL_FONTS[fontName.toLowerCase()] : undefined;
  if (!map) return text;
  return [...text].map((ch) => map[ch] ?? ch).join("");
}
