import type { Color } from "exceljs";

/** Office 2013+ default theme, in Excel's theme-index order (lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink). */
const DEFAULT_THEME = [
  "FFFFFF", "000000", "E7E6E6", "44546A", "5B9BD5", "ED7D31",
  "A5A5A5", "FFC000", "4472C4", "70AD47", "0563C1", "954F72",
];

/** Excel's legacy indexed palette; 64/65 are "system" colors and resolve to nothing. */
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/**
 * Reads the workbook's own color scheme. The XML lists dk1, lt1, dk2, lt2,
 * but cell styles index it as lt1, dk1, lt2, dk2 -- Excel swaps the first
 * two pairs, so this returns them in style-index order.
 */
export function parseThemeColors(themeXml: string | undefined): string[] {
  const scheme = themeXml?.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/)?.[0];
  if (!scheme) return DEFAULT_THEME;
  const read = (tag: string, fallback: string) =>
    scheme.match(new RegExp(`<a:${tag}>[\\s\\S]*?(?:lastClr|val)="([0-9A-Fa-f]{6})"`))?.[1] ?? fallback;
  const tags = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  return tags.map((tag, i) => read(tag, DEFAULT_THEME[i]).toUpperCase());
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r = l;
  let g = l;
  let b = l;
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  return [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Excel's tint: darkens toward black when negative, lightens toward white when positive (on HSL luminance). */
function applyTint(hex: string, tint: number | undefined): string {
  if (!tint) return hex;
  const [h, s, l] = hexToHsl(hex);
  const lum = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return hslToHex(h, s, Math.min(1, Math.max(0, lum)));
}

/** Resolves an ExcelJS color (argb, theme+tint, or indexed) to a CSS hex color. */
export function resolveColor(color: Partial<Color> | undefined, theme: string[]): string | undefined {
  if (!color) return undefined;
  const c = color as Partial<Color> & { indexed?: number; tint?: number };
  if (c.argb) return `#${c.argb.slice(-6).toUpperCase()}`;
  if (c.theme !== undefined && theme[c.theme]) return `#${applyTint(theme[c.theme], c.tint)}`;
  if (c.indexed !== undefined && INDEXED[c.indexed]) return `#${INDEXED[c.indexed]}`;
  return undefined;
}
