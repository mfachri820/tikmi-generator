import ExcelJS from "exceljs";
import { extractLayout, type ExtractedLayout, type LayoutSheet } from "./layout";

/**
 * The grid layout of a KK template for the app's viewer: only the given
 * sheets (the KK's own visible sheets, not its Sumber BI / Lamp. PJP data),
 * with styles, merges, widths and fixed text, and with every input value and
 * every formula's cached result removed. The 2025 KKs carry a filled sample
 * PJP, so nothing PJP-specific may survive into the stored layout: the viewer
 * shows the assessment's own values instead.
 *
 * Each sheet is trimmed to its content (the last row/column with text or a
 * formula, plus a small margin): the KKs format far more than they use (the
 * TKMR sheet is styled down to row 1,452 for ~566 rows of questions).
 */
export async function extractViewLayout(xlsx: Buffer | ArrayBuffer, sheetNames: string[], inputCellRefs: Set<string>): Promise<ExtractedLayout> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as ArrayBuffer);
  const keep = new Set(sheetNames);
  for (const ws of [...wb.worksheets]) if (!keep.has(ws.name)) wb.removeWorksheet(ws.id);
  const missing = sheetNames.filter((n) => !wb.getWorksheet(n));
  if (missing.length) throw new Error(`Template has no sheet ${missing.map((n) => `"${n}"`).join(", ")}`);
  const layout = extractLayout(wb, inputCellRefs);
  for (const sheet of layout.sheets) {
    sheet.hidden = false;
    trim(sheet);
    for (const cell of sheet.cells) {
      if (cell.isInput || cell.formula !== undefined) delete cell.value;
    }
  }
  layout.sheets.sort((a, b) => sheetNames.indexOf(a.name) - sheetNames.indexOf(b.name));
  // Drop styles no remaining cell uses, re-indexing the rest.
  const used = [...new Set(layout.sheets.flatMap((s) => s.cells.map((c) => c.style)).filter((x): x is number => x !== undefined))].sort((a, b) => a - b);
  const remap = new Map(used.map((old, i) => [old, i]));
  for (const s of layout.sheets) for (const c of s.cells) if (c.style !== undefined) c.style = remap.get(c.style);
  layout.styles = used.map((i) => layout.styles[i]);
  return layout;
}

const MARGIN_ROWS = 2;

function trim(sheet: LayoutSheet) {
  let lastRow = 0;
  let lastCol = 0;
  for (const c of sheet.cells) {
    if (c.value !== undefined || c.formula !== undefined) {
      lastRow = Math.max(lastRow, c.row);
      lastCol = Math.max(lastCol, c.col);
    }
  }
  // A merge that starts inside the content extends it to its end.
  for (const m of sheet.merges) {
    const [a, b] = m.split(":");
    const ra = Number(/\d+/.exec(a)![0]);
    const rb = Number(/\d+/.exec(b ?? a)![0]);
    const cb = colNum(/^[A-Z]+/.exec(b ?? a)![0]);
    if (ra <= lastRow) {
      lastRow = Math.max(lastRow, rb);
      lastCol = Math.max(lastCol, cb);
    }
  }
  if (!lastRow) return;
  const maxRow = lastRow + MARGIN_ROWS;
  sheet.cells = sheet.cells.filter((c) => c.row <= maxRow && c.col <= lastCol);
  sheet.merges = sheet.merges.filter((m) => Number(/\d+/.exec(m.split(":")[0])![0]) <= maxRow);
  sheet.rowCount = Math.min(sheet.rowCount, maxRow);
  sheet.columnCount = Math.min(sheet.columnCount, lastCol);
  sheet.hiddenRows = sheet.hiddenRows.filter((r) => r <= maxRow);
  for (const k of Object.keys(sheet.rowHeights)) if (Number(k) > maxRow) delete sheet.rowHeights[Number(k)];
}

function colNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
