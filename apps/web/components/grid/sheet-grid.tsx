"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from "react";
import type { LayoutCell, LayoutCellStyle, LayoutSheet } from "@tikmi/template";
import type { SheetCellValue } from "@tikmi/scoring/config/2026-sheet";
import { columnLetter, formatCellValue, parseAddress } from "@/lib/cellFormat";

export const HEADER_HEIGHT = 20;
export const ROW_HEADER_WIDTH = 44;
const GRIDLINE = "1px solid #E1E1E1";
const EXCEL_GREEN = "#217346";
const MIN_COL_WIDTH = 16;
/** Empty columns/rows past the used range, so the sheet doesn't end abruptly (Excel's grid never does). */
const EXTRA_COLS = 3;
const EXTRA_ROWS = 12;

export interface MergeInfo {
  rowSpan: number;
  colSpan: number;
  lastRow: number;
  lastCol: number;
}

export interface GridModel {
  cols: number[];
  rows: number[];
  colWidth: Map<number, number>;
  rowHeight: Map<number, number>;
  cellAt: Map<string, LayoutCell>;
  merges: Map<string, MergeInfo>;
  /** Address of every cell hidden under a merge -> the merge's top-left address. */
  coveredBy: Map<string, string>;
  /** Sticky `top` offset for each frozen row. */
  frozenTop: Map<number, number>;
  frozenHeight: number;
}

export function buildGridModel(sheet: LayoutSheet): GridModel {
  const hiddenCols = new Set(sheet.hiddenColumns);
  const hiddenRows = new Set(sheet.hiddenRows);
  const cols: number[] = [];
  for (let c = 1; c <= sheet.columnCount + EXTRA_COLS; c++) if (!hiddenCols.has(c)) cols.push(c);
  const rows: number[] = [];
  for (let r = 1; r <= sheet.rowCount + EXTRA_ROWS; r++) if (!hiddenRows.has(r)) rows.push(r);

  // Excel widths are in "characters" of the default font; ~7px each plus padding at 100% zoom.
  const colWidth = new Map(cols.map((c) => [c, Math.round((sheet.columnWidths[c - 1] ?? sheet.defaultColumnWidth) * 7 + 5)]));
  // Row heights are in points.
  const rowHeight = new Map(rows.map((r) => [r, Math.round(((sheet.rowHeights[r] ?? sheet.defaultRowHeight) * 4) / 3)]));

  const cellAt = new Map(sheet.cells.map((c) => [c.address, c]));
  const colSet = new Set(cols);
  const rowSet = new Set(rows);
  const merges = new Map<string, MergeInfo>();
  const coveredBy = new Map<string, string>();
  for (const range of sheet.merges) {
    const [from, to] = range.split(":");
    const a = parseAddress(from);
    const b = parseAddress(to);
    const anchor = `${columnLetter(a.col)}${a.row}`;
    let rowSpan = 0;
    let colSpan = 0;
    for (let r = a.row; r <= b.row; r++) if (rowSet.has(r)) rowSpan++;
    for (let c = a.col; c <= b.col; c++) if (colSet.has(c)) colSpan++;
    merges.set(anchor, { rowSpan: Math.max(rowSpan, 1), colSpan: Math.max(colSpan, 1), lastRow: b.row, lastCol: b.col });
    for (let r = a.row; r <= b.row; r++) {
      for (let c = a.col; c <= b.col; c++) {
        const address = `${columnLetter(c)}${r}`;
        if (address !== anchor) coveredBy.set(address, anchor);
      }
    }
  }

  const frozenTop = new Map<number, number>();
  let top = HEADER_HEIGHT;
  for (const r of rows) {
    if (r > sheet.frozenRows) break;
    frozenTop.set(r, top);
    top += rowHeight.get(r)!;
  }

  return { cols, rows, colWidth, rowHeight, cellAt, merges, coveredBy, frozenTop, frozenHeight: top - HEADER_HEIGHT };
}

/** Template borders all drawn at one weight: Excel's medium (2px) and thick (3px) lines become 1px, so every line matches. */
const sameWeight = (border: string | undefined) => border?.replace(/^\d+px/, "1px");

function baseStyle(style: LayoutCellStyle | undefined, gridline: string): CSSProperties {
  const border = (side: string | undefined) => sameWeight(side) ?? gridline;
  return {
    backgroundColor: style?.fill ?? "#FFFFFF",
    color: style?.color ?? "#000000",
    fontWeight: style?.bold ? 700 : undefined,
    fontStyle: style?.italic ? "italic" : undefined,
    textDecoration: style?.underline ? "underline" : undefined,
    fontSize: style?.fontSize ? `${(style.fontSize * 4) / 3}px` : undefined,
    verticalAlign: style?.vAlign ?? "bottom",
    whiteSpace: style?.wrap ? "pre-wrap" : "pre",
    wordBreak: style?.wrap ? "break-word" : undefined,
    paddingLeft: 3 + (style?.indent ?? 0) * 9,
    paddingRight: 3,
    borderTop: border(style?.borderTop),
    borderRight: border(style?.borderRight),
    borderBottom: border(style?.borderBottom),
    borderLeft: border(style?.borderLeft),
  };
}

export interface EditingState {
  address: string;
  draft: string;
  /** Excel's two modes: "enter" (typed over the cell; arrows commit and move) and "edit" (F2/double-click; arrows move the caret). */
  mode: "enter" | "edit";
  focus: "cell" | "bar";
}

/** The 1–5 list an open score cell shows, like an Excel data-validation dropdown. */
export interface ScorePickerState {
  /** Highest score first, each with the row's Kriteria text for it when the sheet has one. */
  options: { value: number; criteria?: string }[];
  current: SheetCellValue;
  pjpValue: SheetCellValue;
  /** The pengawas value differs from the PJP's, so "Kembalikan ke nilai PJP" is offered (as the last item). */
  canReset: boolean;
  /** Keyboard highlight: an index into `options`, or `options.length` for the reset item. */
  highlighted: number;
}

function ScorePicker({
  picker,
  onPick,
  onHighlight,
}: {
  picker: ScorePickerState;
  onPick: (value: number | null) => void;
  onHighlight: (index: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);
  const item = (index: number) =>
    `flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${picker.highlighted === index ? "bg-[#E8F2EC]" : ""}`;

  return (
    <div
      ref={ref}
      data-score-picker
      role="listbox"
      aria-label="Pilih nilai pengawas"
      // Keep focus (and the selection) on the grid: the picker is driven by clicks and the grid's own key handler.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-full z-50 mt-0.5 w-64 overflow-hidden rounded border border-[#C6C6C6] bg-white py-1 text-left text-[13px] font-normal text-black shadow-lg"
      style={{ fontFamily: "'Segoe UI', Arial, sans-serif", whiteSpace: "normal", lineHeight: 1.3, cursor: "default" }}
    >
      {picker.options.map((o, i) => {
        const isCurrent = picker.current === o.value;
        return (
          <button
            key={o.value}
            role="option"
            aria-selected={isCurrent}
            onMouseEnter={() => onHighlight(i)}
            onClick={() => onPick(o.value)}
            className={item(i)}
          >
            <span className={`w-4 text-center font-semibold tabular-nums ${isCurrent ? "text-[#217346]" : ""}`}>{o.value}</span>
            <span className="flex-1 truncate text-[#555]">{o.criteria}</span>
            {picker.pjpValue === o.value && (
              <span className="rounded bg-[#DDEBF7] px-1 text-[11px] text-[#1F4E78]">PJP</span>
            )}
            <span className="w-3 text-[#217346]">{isCurrent ? "✓" : ""}</span>
          </button>
        );
      })}
      {picker.canReset && (
        <button
          onMouseEnter={() => onHighlight(picker.options.length)}
          onClick={() => onPick(null)}
          className={`${item(picker.options.length)} mt-1 border-t border-[#E1E1E1] text-[#555]`}
        >
          ↺ Kembalikan ke nilai PJP ({picker.pjpValue ?? "-"})
        </button>
      )}
    </div>
  );
}

interface GridCellProps {
  address: string;
  text: string;
  href?: string;
  isNumber: boolean;
  css: CSSProperties;
  rowSpan?: number;
  colSpan?: number;
  stickyTop?: number;
  selected: boolean;
  editable: boolean;
  overridden: boolean;
  spill: boolean;
  editing: EditingState | null;
  wideEditor: boolean;
  /** A pengawas score cell: shows a dropdown arrow when selected and opens the 1–5 list on click. */
  scoreCell: boolean;
  picker: ScorePickerState | null;
  onSelect: (address: string) => void;
  onActivate: (address: string) => void;
  onCellClick: (address: string) => void;
  onPick: (address: string, value: number | null) => void;
  onPickerHighlight: (index: number) => void;
  onDraftChange: (draft: string) => void;
  onEditorKeyDown: (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  /** The cursor entered (with the cell's screen box) or left a link cell, for the document hover card. */
  onLinkHover: (address: string | null, rect?: DOMRect) => void;
}

const GridCell = memo(function GridCell(props: GridCellProps) {
  const { address, text, href, isNumber, css, editing, selected, picker } = props;
  const showArrow = props.scoreCell && selected && !editing;
  const style: CSSProperties = {
    ...css,
    textAlign: (css.textAlign as CSSProperties["textAlign"]) ?? (isNumber ? "right" : "left"),
    overflow: props.spill || showArrow ? "visible" : "hidden",
    position: props.stickyTop !== undefined ? "sticky" : "relative",
    top: props.stickyTop,
    // Every cell is positioned, so later cells paint over earlier ones: lift spilled text and the selection outline above them.
    // Frozen rows sit above everything that scrolls under them (but below the sticky row/column headers).
    zIndex: picker
      ? 40 // above the sticky row/column headers the list may pass under
      : props.stickyTop !== undefined
        ? selected || editing ? 6 : 5
        : selected || editing ? 3 : props.spill ? 1 : undefined,
    outline: selected ? `2px solid ${EXCEL_GREEN}` : undefined,
    outlineOffset: selected ? -1 : undefined,
    // Keep the fill inside the borders so a coloured cell never covers its neighbour's gridline.
    backgroundClip: "padding-box",
  };

  return (
    <td
      data-address={address}
      rowSpan={props.rowSpan}
      colSpan={props.colSpan}
      style={style}
      onMouseDown={(e) => {
        if (e.button === 0) props.onSelect(address);
      }}
      onClick={() => props.onCellClick(address)}
      onDoubleClick={() => props.onActivate(address)}
      onMouseEnter={href ? (e) => props.onLinkHover(address, e.currentTarget.getBoundingClientRect()) : undefined}
      onMouseLeave={href ? () => props.onLinkHover(null) : undefined}
      title={props.overridden ? "Nilai pengawas berbeda dari nilai PJP" : undefined}
    >
      {editing ? (
        <textarea
          autoFocus={editing.focus === "cell"}
          value={editing.draft}
          spellCheck={false}
          onChange={(e) => props.onDraftChange(e.target.value)}
          onKeyDown={props.onEditorKeyDown}
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          className="absolute left-0 top-0 z-20 resize-none bg-white px-[3px] text-black outline-none"
          style={{
            width: props.wideEditor ? "max(100%, 280px)" : "100%",
            height: props.wideEditor ? "max(100%, 76px)" : "100%",
            border: `2px solid ${EXCEL_GREEN}`,
            font: "inherit",
            textAlign: style.textAlign,
            whiteSpace: "pre-wrap",
          }}
        />
      ) : href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          // A plain click opens the document panel (via the cell's click); Ctrl/⌘/Shift/middle click opens a tab as usual.
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey) e.stopPropagation();
            else e.preventDefault();
          }}
          className="text-[#0563C1] underline"
        >
          {text}
        </a>
      ) : (
        text
      )}
      {props.overridden && !editing && (
        <span className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-[#E81123]" />
      )}
      {showArrow && (
        // Excel's data-validation arrow, just past the cell's right edge; a click on it toggles the list.
        <span
          className="absolute -right-[19px] bottom-0 z-10 flex h-[18px] w-[18px] items-center justify-center border border-[#ABABAB] bg-[#F3F3F3] text-[9px] text-[#444] hover:bg-[#E1E1E1]"
          style={{ cursor: "default" }}
          aria-hidden
        >
          ▼
        </span>
      )}
      {picker && (
        <ScorePicker
          picker={picker}
          onPick={(value) => props.onPick(address, value)}
          onHighlight={props.onPickerHighlight}
        />
      )}
    </td>
  );
});

interface SheetGridProps {
  sheet: LayoutSheet;
  model: GridModel;
  styles: LayoutCellStyle[];
  values: Record<string, SheetCellValue>;
  editable: Set<string>;
  overridden: Set<string>;
  selected: string;
  editing: EditingState | null;
  wideEditorCells: Set<string>;
  scoreCells: Set<string>;
  /** The open score list; it belongs to the selected cell. */
  picker: ScorePickerState | null;
  zoom: number;
  /** Widths the user dragged, in px at 100% zoom, by column number; other columns keep the template's. */
  colWidthOverrides: Record<number, number>;
  /** A finished column drag (null = back to the template width, on double-click). */
  onResizeColumn: (col: number, width: number | null) => void;
  scrollerRef: Ref<HTMLDivElement>;
  onGridKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onSelect: (address: string) => void;
  onActivate: (address: string) => void;
  onCellClick: (address: string) => void;
  onPick: (address: string, value: number | null) => void;
  onPickerHighlight: (index: number) => void;
  onDraftChange: (draft: string) => void;
  onEditorKeyDown: (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  onLinkHover: (address: string | null, rect?: DOMRect) => void;
  /** The grid scrolled (hover cards anchored to a cell must go). */
  onScroll?: () => void;
}

interface CellDisplay {
  text: string;
  isNumber: boolean;
  isEmpty: boolean;
  href?: string;
}

/** What a cell shows: live data for input/formula cells, otherwise the template's own text. */
export function displayValue(
  sheetName: string,
  cell: LayoutCell | undefined,
  values: Record<string, SheetCellValue>,
  styles: LayoutCellStyle[],
): CellDisplay {
  if (!cell) return { text: "", isNumber: false, isEmpty: true };
  const ref = `${sheetName}!${cell.address}`;
  const value = ref in values ? values[ref] : cell.isInput ? null : cell.value;
  const numFmt = cell.style !== undefined ? styles[cell.style].numFmt : undefined;
  const text = formatCellValue(value, numFmt);
  // A form upload with several files is stored one link per line; the cell links to the first.
  const href =
    cell.href ?? (typeof value === "string" && /^https?:\/\//.test(value) ? value.split(/\s+/)[0] : undefined);
  return { text, isNumber: typeof value === "number", isEmpty: text === "", href };
}

export function SheetGrid(props: SheetGridProps) {
  const {
    sheet, model, styles, values, editable, overridden, selected, editing,
    wideEditorCells, scoreCells, picker, zoom, colWidthOverrides, onResizeColumn, scrollerRef, onGridKeyDown,
    onSelect, onActivate, onCellClick, onPick, onPickerHighlight, onDraftChange, onEditorKeyDown, onLinkHover, onScroll,
  } = props;
  const gridline = sheet.showGridLines ? GRIDLINE : "1px solid transparent";

  // A column drag in progress: shown live here, handed up (and saved) on release.
  const [drag, setDrag] = useState<{ col: number; startX: number; startWidth: number; width: number } | null>(null);
  const widthOf = (c: number) =>
    drag?.col === c ? drag.width : (colWidthOverrides[c] ?? model.colWidth.get(c)!);

  function startColumnDrag(e: PointerEvent<HTMLSpanElement>, col: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ col, startX: e.clientX, startWidth: widthOf(col), width: widthOf(col) });
  }
  function moveColumnDrag(e: PointerEvent<HTMLSpanElement>) {
    if (!drag) return;
    // The table is zoomed, so a screen pixel is less (or more) than a column pixel.
    const width = Math.max(MIN_COL_WIDTH, Math.round(drag.startWidth + (e.clientX - drag.startX) / (zoom / 100)));
    setDrag({ ...drag, width });
  }
  function endColumnDrag() {
    if (!drag) return;
    if (drag.width !== drag.startWidth) onResizeColumn(drag.col, drag.width);
    setDrag(null);
  }
  const selectedPos = parseAddress(selected);
  const selectedMerge = model.merges.get(selected);

  // Static per-cell CSS: only recomputed when the sheet changes, so memoized cells keep stable props.
  const cssByAddress = useMemo(() => {
    const map = new Map<string, CSSProperties>();
    const blank = baseStyle(undefined, gridline);
    for (const r of model.rows) {
      for (const c of model.cols) {
        const address = `${columnLetter(c)}${r}`;
        const cell = model.cellAt.get(address);
        const style = cell?.style !== undefined ? styles[cell.style] : undefined;
        if (!style) {
          map.set(address, blank);
          continue;
        }
        const css = baseStyle(style, gridline);
        if (style.hAlign) css.textAlign = style.hAlign;
        map.set(address, css);
      }
    }

    // A line two cells share is drawn by both: Excel shows a border set on either side, but in a collapsed
    // HTML table an equal-width gridline on the left/top cell wins the tie and turns the line grey.
    const anchor = (address: string) => model.coveredBy.get(address) ?? address;
    const writable = (address: string) => {
      const css = map.get(address)!;
      if (css !== blank) return css;
      const copy = { ...blank };
      map.set(address, copy);
      return copy;
    };
    const share = (a: string, aSide: "borderRight" | "borderBottom", b: string, bSide: "borderLeft" | "borderTop") => {
      const cssA = map.get(a);
      const cssB = map.get(b);
      if (!cssA || !cssB || a === b) return;
      const lineA = cssA[aSide] as string;
      const lineB = cssB[bSide] as string;
      if (lineA === gridline && lineB !== gridline) writable(a)[aSide] = lineB;
      else if (lineB === gridline && lineA !== gridline) writable(b)[bSide] = lineA;
    };
    for (const [ri, r] of model.rows.entries()) {
      for (const [ci, c] of model.cols.entries()) {
        const address = `${columnLetter(c)}${r}`;
        if (model.coveredBy.has(address)) continue;
        const merge = model.merges.get(address);
        // Neighbours past the merge's last visible column / row.
        const nextCol = model.cols.find((x, i) => i > ci && x > (merge?.lastCol ?? c));
        const nextRow = model.rows.find((x, i) => i > ri && x > (merge?.lastRow ?? r));
        if (nextCol !== undefined) share(address, "borderRight", anchor(`${columnLetter(nextCol)}${r}`), "borderLeft");
        if (nextRow !== undefined) share(address, "borderBottom", anchor(`${columnLetter(c)}${nextRow}`), "borderTop");
      }
    }
    return map;
  }, [model, styles, gridline]);

  const displays = useMemo(() => {
    const map = new Map<string, CellDisplay>();
    for (const cell of sheet.cells) map.set(cell.address, displayValue(sheet.name, cell, values, styles));
    return map;
  }, [sheet, values, styles]);

  const totalWidth = ROW_HEADER_WIDTH + model.cols.reduce((sum, c) => sum + widthOf(c), 0);
  const inSelectedCols = (c: number) => c >= selectedPos.col && c <= (selectedMerge?.lastCol ?? selectedPos.col);
  const inSelectedRows = (r: number) => r >= selectedPos.row && r <= (selectedMerge?.lastRow ?? selectedPos.row);

  return (
    <div
      ref={scrollerRef}
      tabIndex={0}
      onKeyDown={onGridKeyDown}
      onScroll={onScroll}
      className="min-h-0 min-w-0 flex-1 overflow-auto bg-[#F3F3F3] outline-none"
    >
      <table
        className="border-collapse bg-white"
        style={{
          tableLayout: "fixed",
          width: totalWidth,
          zoom: zoom / 100,
          fontFamily: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif",
          fontSize: "14.67px",
          lineHeight: 1.2,
          cursor: "cell",
          ["--scroll-top" as string]: `${HEADER_HEIGHT + model.frozenHeight + 2}px`,
        }}
      >
        <colgroup>
          <col style={{ width: ROW_HEADER_WIDTH }} />
          {model.cols.map((c) => (
            <col key={c} style={{ width: widthOf(c) }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ height: HEADER_HEIGHT }}>
            <th
              className="sticky left-0 top-0 z-30 bg-[#E6E6E6] p-0"
              style={{ boxShadow: "inset -1px -1px 0 #BFBFBF" }}
            />
            {model.cols.map((c) => {
              const active = inSelectedCols(c);
              return (
                <th
                  key={c}
                  className="sticky top-0 z-20 select-none p-0 text-center font-normal"
                  style={{
                    fontSize: 12,
                    backgroundColor: active ? "#D2D2D2" : "#F3F3F3",
                    color: active ? EXCEL_GREEN : "#444",
                    boxShadow: active ? `inset -1px -2px 0 ${EXCEL_GREEN}` : "inset -1px -1px 0 #D4D4D4",
                  }}
                >
                  {columnLetter(c)}
                  {/* Excel's column-edge handle: drag to resize, double-click for the template width. */}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Ubah lebar kolom ${columnLetter(c)}`}
                    title="Seret untuk mengubah lebar kolom · klik dua kali untuk lebar semula"
                    onPointerDown={(e) => startColumnDrag(e, c)}
                    onPointerMove={moveColumnDrag}
                    onPointerUp={endColumnDrag}
                    onPointerCancel={endColumnDrag}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onResizeColumn(c, null);
                    }}
                    className="absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize hover:bg-[#217346]/40"
                    style={drag?.col === c ? { backgroundColor: EXCEL_GREEN } : undefined}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="[&_td]:[scroll-margin-left:48px] [&_td]:[scroll-margin-top:var(--scroll-top)]">
          {model.rows.map((r) => {
            const stickyTop = model.frozenTop.get(r);
            const activeRow = inSelectedRows(r);
            return (
              <tr key={r} style={{ height: model.rowHeight.get(r) }}>
                <th
                  className="sticky left-0 select-none p-0 text-center font-normal"
                  style={{
                    top: stickyTop,
                    zIndex: stickyTop !== undefined ? 25 : 10,
                    fontSize: 12,
                    backgroundColor: activeRow ? "#D2D2D2" : "#F3F3F3",
                    color: activeRow ? EXCEL_GREEN : "#444",
                    boxShadow: activeRow ? `inset -2px -1px 0 ${EXCEL_GREEN}` : "inset -1px -1px 0 #D4D4D4",
                  }}
                >
                  {r}
                </th>
                {model.cols.map((c, ci) => {
                  const address = `${columnLetter(c)}${r}`;
                  if (model.coveredBy.has(address)) return null;
                  const ref = `${sheet.name}!${address}`;
                  const merge = model.merges.get(address);
                  const display = displays.get(address);
                  const isEditing = editing?.address === address ? editing : null;
                  const isEditable = editable.has(ref);
                  const css = cssByAddress.get(address)!;
                  // Excel lets unwrapped left-aligned text run into empty neighbours.
                  const nextAddress = ci + 1 < model.cols.length ? `${columnLetter(model.cols[ci + 1])}${r}` : undefined;
                  const spill =
                    !!display &&
                    !display.isEmpty &&
                    !display.isNumber &&
                    !merge &&
                    css.whiteSpace === "pre" &&
                    (css.textAlign === undefined || css.textAlign === "left") &&
                    !!nextAddress &&
                    !model.coveredBy.has(nextAddress) &&
                    (displays.get(nextAddress)?.isEmpty ?? true);
                  return (
                    <GridCell
                      key={address}
                      address={address}
                      text={display?.text ?? ""}
                      href={display?.href}
                      isNumber={display?.isNumber ?? false}
                      css={css}
                      rowSpan={merge && merge.rowSpan > 1 ? merge.rowSpan : undefined}
                      colSpan={merge && merge.colSpan > 1 ? merge.colSpan : undefined}
                      stickyTop={stickyTop}
                      selected={selected === address}
                      editable={isEditable}
                      overridden={overridden.has(ref)}
                      spill={spill}
                      editing={isEditing}
                      wideEditor={wideEditorCells.has(ref)}
                      scoreCell={isEditable && scoreCells.has(ref)}
                      picker={selected === address ? picker : null}
                      onSelect={onSelect}
                      onActivate={onActivate}
                      onCellClick={onCellClick}
                      onPick={onPick}
                      onPickerHighlight={onPickerHighlight}
                      onDraftChange={onDraftChange}
                      onEditorKeyDown={onEditorKeyDown}
                      onLinkHover={onLinkHover}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
