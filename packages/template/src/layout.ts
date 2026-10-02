import type { Borders, Cell, Workbook, Worksheet } from "exceljs";
import { parseThemeColors, resolveColor } from "./colors";
import { symbolFontText } from "./symbolFonts";

/** A cell's look, with every color already resolved to CSS hex so the grid never needs the workbook theme. */
export interface LayoutCellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fontSize?: number;
  fill?: string;
  hAlign?: "left" | "center" | "right" | "justify";
  vAlign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  indent?: number;
  numFmt?: string;
  /** CSS border shorthands, e.g. "1px solid #000000". */
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
}

export type LayoutValue = string | number | boolean | null;

export interface LayoutCell {
  address: string;
  row: number;
  col: number;
  /**
   * Fixed template text/number, or a formula's cached result. Always omitted
   * for input cells: their values are per-workbook data (cell_inputs), and
   * the file a layout is extracted from may be a filled PJP workbook.
   */
  value?: LayoutValue;
  href?: string;
  formula?: string;
  isInput: boolean;
  /** Index into `ExtractedLayout.styles`. */
  style?: number;
}

export interface LayoutSheet {
  name: string;
  hidden: boolean;
  rowCount: number;
  columnCount: number;
  /** Excel character-width units per column (index 0 = column A); null = sheet default. */
  columnWidths: (number | null)[];
  hiddenColumns: number[];
  /** Points, keyed by row number; rows not listed use `defaultRowHeight`. */
  rowHeights: Record<number, number>;
  hiddenRows: number[];
  defaultColumnWidth: number;
  defaultRowHeight: number;
  frozenRows: number;
  showGridLines: boolean;
  /** Merge ranges, e.g. "A1:C1". */
  merges: string[];
  cells: LayoutCell[];
}

export interface ExtractedLayout {
  sheets: LayoutSheet[];
  styles: LayoutCellStyle[];
}

const BORDER_CSS: Record<string, string> = {
  thin: "1px solid",
  hair: "1px solid",
  dotted: "1px dotted",
  dashed: "1px dashed",
  dashDot: "1px dashed",
  dashDotDot: "1px dashed",
  medium: "2px solid",
  mediumDashed: "2px dashed",
  mediumDashDot: "2px dashed",
  mediumDashDotDot: "2px dashed",
  slantDashDot: "2px dashed",
  thick: "3px solid",
  double: "3px double",
};

function normalizeValue(raw: unknown): { value?: LayoutValue; href?: string } {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return { value: raw };
  if (raw instanceof Date) return { value: raw.toISOString().slice(0, 10) };
  const obj = raw as Record<string, unknown>;
  if ("formula" in obj || "sharedFormula" in obj) return normalizeValue(obj.result);
  if ("error" in obj) return { value: String(obj.error) };
  if ("hyperlink" in obj) {
    const text = normalizeValue(obj.text).value;
    return { value: text ?? String(obj.hyperlink), href: String(obj.hyperlink) };
  }
  if ("richText" in obj && Array.isArray(obj.richText)) {
    return { value: (obj.richText as { text: string }[]).map((r) => r.text).join("") };
  }
  return {};
}

function cellFormula(cell: Cell): string | undefined {
  const raw = cell.value as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return undefined;
  if (!("formula" in raw) && !("sharedFormula" in raw)) return undefined;
  // For a shared-formula cell, `cell.formula` is the master formula translated to this cell's address.
  return (cell as Cell & { formula?: string }).formula ?? (raw.formula as string | undefined);
}

function extractStyle(cell: Cell, theme: string[]): LayoutCellStyle {
  const style: LayoutCellStyle = {};
  const { font, fill, alignment, border, numFmt } = cell;

  if (font?.bold) style.bold = true;
  if (font?.italic) style.italic = true;
  if (font?.underline) style.underline = true;
  if (font?.size && font.size !== 11) style.fontSize = font.size;
  const fontColor = resolveColor(font?.color, theme);
  if (fontColor && fontColor !== "#000000") style.color = fontColor;

  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const fillColor = resolveColor(fill.fgColor, theme);
    if (fillColor) style.fill = fillColor;
  }

  const h = alignment?.horizontal;
  if (h === "center" || h === "centerContinuous" || h === "distributed" || h === "fill") style.hAlign = "center";
  else if (h === "left" || h === "right" || h === "justify") style.hAlign = h;
  const v = alignment?.vertical;
  if (v === "top" || v === "bottom") style.vAlign = v;
  else if (v === "middle" || v === "distributed" || v === "justify") style.vAlign = "middle";
  if (alignment?.wrapText) style.wrap = true;
  if (alignment?.indent) style.indent = alignment.indent;

  if (numFmt && numFmt !== "General") style.numFmt = numFmt;

  const sides: [keyof Borders, keyof LayoutCellStyle][] = [
    ["top", "borderTop"],
    ["right", "borderRight"],
    ["bottom", "borderBottom"],
    ["left", "borderLeft"],
  ];
  for (const [side, key] of sides) {
    const b = border?.[side];
    if (b?.style && BORDER_CSS[b.style]) {
      (style as Record<string, string>)[key] = `${BORDER_CSS[b.style]} ${resolveColor(b.color, theme) ?? "#000000"}`;
    }
  }
  return style;
}

function extractSheet(
  worksheet: Worksheet,
  inputCellRefs: Set<string>,
  theme: string[],
  styleIndex: (style: LayoutCellStyle) => number | undefined,
): LayoutSheet {
  // `_merges` is keyed by each merge's top-left address; the full "B3:C4" range is on the value.
  const merges = Object.values(
    (worksheet as unknown as { _merges?: Record<string, { range: string }> })._merges ?? {},
  ).map((m) => m.range);
  const view = worksheet.views?.[0] as { state?: string; ySplit?: number; showGridLines?: boolean } | undefined;

  const columnWidths: (number | null)[] = [];
  const hiddenColumns: number[] = [];
  for (let c = 1; c <= worksheet.columnCount; c++) {
    const column = worksheet.getColumn(c);
    columnWidths.push(column.width ?? null);
    if (column.hidden) hiddenColumns.push(c);
  }

  const rowHeights: Record<number, number> = {};
  const hiddenRows: number[] = [];
  const cells: LayoutCell[] = [];

  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.findRow(r);
    if (!row) continue;
    if (row.height) rowHeights[r] = row.height;
    if (row.hidden) hiddenRows.push(r);

    for (let c = 1; c <= worksheet.columnCount; c++) {
      const cell = row.findCell(c);
      if (!cell) continue;
      const address = cell.address;
      const isInput = inputCellRefs.has(`${worksheet.name}!${address}`);
      const style = styleIndex(extractStyle(cell, theme));
      const formula = cellFormula(cell);
      const normalized = isInput ? {} : normalizeValue(cell.value);
      const { href } = normalized;
      const value =
        typeof normalized.value === "string" ? symbolFontText(normalized.value, cell.font?.name) : normalized.value;
      if (value === undefined && style === undefined && !isInput && !formula) continue;
      cells.push({
        address,
        row: r,
        col: c,
        ...(value !== undefined && { value }),
        ...(href && { href }),
        ...(formula && { formula }),
        isInput,
        ...(style !== undefined && { style }),
      });
    }
  }

  return {
    name: worksheet.name,
    hidden: worksheet.state !== "visible",
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    columnWidths,
    hiddenColumns,
    rowHeights,
    hiddenRows,
    defaultColumnWidth: worksheet.properties.defaultColWidth ?? 8.43,
    defaultRowHeight: worksheet.properties.defaultRowHeight ?? 15,
    frozenRows: view?.state === "frozen" ? (view.ySplit ?? 0) : 0,
    showGridLines: view?.showGridLines !== false,
    merges,
    cells,
  };
}

/**
 * Walks every sheet and produces the layout JSON the grid renders from
 * (`template_versions.layout_json`): cell text, merges, column widths, row
 * heights, frozen rows and resolved styles, so the web grid looks like the
 * Excel file. `inputCellRefs` is the admin-curated set of "Sheet!Address"
 * cells that are actually typed into (see the build plan's Input cells
 * table) -- everything else is template text or a formula the scoring engine
 * recomputes.
 */
export function extractLayout(workbook: Workbook, inputCellRefs: Set<string>): ExtractedLayout {
  const theme = parseThemeColors((workbook as unknown as { _themes?: Record<string, string> })._themes?.theme1);
  const styles: LayoutCellStyle[] = [];
  const styleKeys = new Map<string, number>();
  const styleIndex = (style: LayoutCellStyle) => {
    const key = JSON.stringify(style);
    if (key === "{}") return undefined;
    let index = styleKeys.get(key);
    if (index === undefined) {
      index = styles.length;
      styles.push(style);
      styleKeys.set(key, index);
    }
    return index;
  };

  const sheets: LayoutSheet[] = [];
  workbook.eachSheet((worksheet) => {
    sheets.push(extractSheet(worksheet, inputCellRefs, theme, styleIndex));
  });
  return { sheets, styles };
}
