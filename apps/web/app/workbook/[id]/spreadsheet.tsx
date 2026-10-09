"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { LayoutCellStyle, LayoutSheet } from "@ira/template";
import type { SheetCellValue } from "@ira/scoring/config/2026-sheet";
import type { WorkbookView } from "@/lib/workbookView";
import type { CellConflict } from "@/app/api/workbooks/[id]/cells/route";
import { columnLetter, editText, parseAddress, parseNumberInput } from "@/lib/cellFormat";
import { usePersistentState } from "@/lib/usePersistentState";
import { docLinksIn, type DocLink } from "@/lib/driveLinks";
import { DocHoverCard, DocPanel } from "./doc-panel";
import { ExplainStrip } from "./explain-strip";
import { FLAG_HELP, HELP } from "@/lib/glossary";
import { InfoTip } from "@/components/info-tip";
import {
  buildGridModel,
  displayValue,
  SheetGrid,
  type EditingState,
  type GridModel,
  type ScorePickerState,
} from "./sheet-grid";

const EXCEL_GREEN = "#217346";
/** Workbook statuses as the home page names them. */
const STATUS_LABELS: Record<string, string> = {
  generated: "Dibuat",
  in_review: "Ditinjau",
  final: "Final",
  locked: "Dikunci",
};
const DEFAULT_SHEET = "A2. PJP ALL peng";
const A2_SHEET = "A2. PJP ALL peng";
const C2_SHEET = "C2. Form PJP LR";

type Message = { text: string; tone: "info" | "error" };
/** A banner under the formula bar that stays until dismissed: conflicts, and changes made by others. */
type Notice = { text: string; tone: "info" | "warning"; action?: { label: string; run: () => void } };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
/** An edit shown in the grid but not yet sent; `since` is the workbook version it was made on (none = overwrite). */
type PendingEdit = { value: SheetCellValue; since?: string };

/** Edits go to the server together this long after the last one (or at once on Save / leaving the page). */
const AUTOSAVE_DELAY = 2000;
const RETRY_DELAY = 5000;
/** Checking for others' changes: only while the tab is visible and someone used it within IDLE_AFTER. */
const POLL_INTERVAL = 30_000;
const IDLE_AFTER = 5 * 60_000;

const SAVE_LABELS: Record<SaveState, string> = {
  idle: "",
  dirty: "Ada perubahan belum disimpan",
  saving: "Menyimpan…",
  saved: "Tersimpan",
  error: "Gagal menyimpan",
};

/** Formula bar height: one line collapsed; expanding opens it to BAR_EXPANDED, dragging goes up to BAR_MAX. */
const BAR_MIN = 24;
const BAR_EXPANDED = 96;
const BAR_MAX = 360;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const NO_WIDTHS: Record<string, Record<number, number>> = {};
/** How long the cursor rests on a link cell before its hover card shows. */
const HOVER_DELAY = 500;

/** "A2. PJP ALL peng!O7" -> "O7 (A2. PJP ALL peng)". */
function cellLabel(ref: string): string {
  const i = ref.lastIndexOf("!");
  return `${ref.slice(i + 1)} (${ref.slice(0, i)})`;
}

interface SpreadsheetProps {
  initialView: WorkbookView;
  /** Sheet to open first (`?sheet=` in the URL); defaults to the A2 assessment sheet. */
  initialSheet?: string;
  sheets: LayoutSheet[];
  styles: LayoutCellStyle[];
  editableCellRefs: string[];
  scoreCellRefs: string[];
  textCellRefs: string[];
  /** Cells with one value for every PJP in the period (A2's Keterangan): an edit here changes all workbooks. */
  sharedCellRefs: string[];
  /** A viewer: nothing is editable and the Save button is replaced by a badge. */
  readOnly?: boolean;
}

function moveFrom(model: GridModel, address: string, dRow: number, dCol: number): string {
  const { row, col } = parseAddress(address);
  const merge = model.merges.get(address);
  let rIdx = model.rows.indexOf(dRow > 0 && merge ? merge.lastRow : row);
  let cIdx = model.cols.indexOf(dCol > 0 && merge ? merge.lastCol : col);
  if (rIdx === -1) rIdx = model.rows.indexOf(row);
  if (cIdx === -1) cIdx = model.cols.indexOf(col);
  rIdx = Math.min(Math.max(rIdx + dRow, 0), model.rows.length - 1);
  cIdx = Math.min(Math.max(cIdx + dCol, 0), model.cols.length - 1);
  const target = `${columnLetter(model.cols[cIdx])}${model.rows[rIdx]}`;
  return model.coveredBy.get(target) ?? target;
}

function sameValue(a: SheetCellValue | undefined, b: SheetCellValue | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/** The PJP-side score next to a pengawas score cell: A2 column L for O, KPMR column H for J (same row). */
function pjpScoreRef(ref: string): string {
  return ref.replace(/!O(\d+)$/, "!L$1").replace(/!J(\d+)$/, "!H$1");
}

const SCORES_DESC = [5, 4, 3, 2, 1];

/**
 * Columns of the sheet's "Kriteria" header (A2 row 4: G=5 ... K=1), found as the
 * header row holding each score 1–5 exactly once; null when the sheet has none (KPMR).
 */
function criteriaColumns(model: GridModel): Map<number, string> | null {
  for (let row = 1; row <= 6; row++) {
    const byScore = new Map<number, string>();
    for (const [address, cell] of model.cellAt) {
      if (parseAddress(address).row !== row) continue;
      if (typeof cell.value === "number" && SCORES_DESC.includes(cell.value) && !cell.formula) {
        byScore.set(cell.value, address.replace(/\d+$/, ""));
      }
    }
    if (byScore.size === SCORES_DESC.length) return byScore;
  }
  return null;
}

export function Spreadsheet(props: SpreadsheetProps) {
  const { sheets, styles } = props;
  const [view, setView] = useState(props.initialView);
  const [activeSheet, setActiveSheet] = useState(
    [props.initialSheet, DEFAULT_SHEET].find((name) => sheets.some((s) => s.name === name)) ?? sheets[0].name,
  );
  const [selectedBySheet, setSelectedBySheet] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const router = useRouter();
  // View preferences, remembered in this browser across workbooks.
  const [zoom, setZoom] = usePersistentState("ira:sheet:zoom", 100);
  const [barHeight, setBarHeight] = usePersistentState("ira:sheet:formulaBarHeight", BAR_MIN);
  /** Column widths the user dragged, per sheet (every workbook shares the template, so they apply to all). */
  const [colWidthsBySheet, setColWidthsBySheet] = usePersistentState("ira:sheet:colWidths", NO_WIDTHS);
  /** Live height while the formula bar's edge is being dragged; saved on release. */
  const [barDrag, setBarDrag] = useState<{ startY: number; startHeight: number; height: number } | null>(null);
  /** What's typed into the name box, or null while it just shows the selected cell. */
  const [nameBoxDraft, setNameBoxDraft] = useState<string | null>(null);
  /** The document side panel: which link cell it shows ("Sheet!Address") and which of its files. */
  const [panelDoc, setPanelDoc] = useState<{ ref: string; index: number } | null>(null);
  const [panelWidth, setPanelWidth] = usePersistentState("ira:sheet:docPanelWidth", 520);
  /** The link cell the cursor rests on, once HOVER_DELAY has passed. */
  const [hoverDoc, setHoverDoc] = useState<{ ref: string; rect: DOMRect } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The "Kenapa nilainya" card can be hidden; remembered in this browser. */
  const [explainHidden, setExplainHidden] = usePersistentState("ira:sheet:explainHidden", false);
  const shownBarHeight = barDrag?.height ?? barHeight;
  const barExpanded = shownBarHeight > BAR_MIN;
  const toggleFormulaBar = () => setBarHeight((h) => (h > BAR_MIN ? BAR_MIN : BAR_EXPANDED));
  /** Which download is being prepared: the IRA workbook or BI's Individu PJP report. */
  const [exporting, setExporting] = useState<"workbook" | "individu" | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLSpanElement>(null);
  // The Export menu closes on a click elsewhere or Esc.
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (!exportMenuRef.current?.contains(e.target as Node)) setExportMenuOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setExportMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [exportMenuOpen]);
  /** The 1–5 list is open on the selected score cell; the number is the keyboard-highlighted item. */
  const [pickerHighlight, setPickerHighlight] = useState<number | null>(null);
  const pickerOpen = pickerHighlight !== null;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pending = useRef(new Map<string, PendingEdit>());
  const inflight = useRef<Promise<boolean> | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The workbook version the grid shows (server values; pending edits are laid over them). */
  const revision = useRef(props.initialView.workbook.updatedAt);

  const editable = useMemo(() => new Set(props.editableCellRefs), [props.editableCellRefs]);
  const scoreCells = useMemo(() => new Set(props.scoreCellRefs), [props.scoreCellRefs]);
  const textCells = useMemo(() => new Set(props.textCellRefs), [props.textCellRefs]);
  const sharedCells = useMemo(() => new Set(props.sharedCellRefs), [props.sharedCellRefs]);
  const overridden = useMemo(() => new Set(view.overriddenCellRefs), [view.overriddenCellRefs]);
  const models = useMemo(() => new Map(sheets.map((s) => [s.name, buildGridModel(s)])), [sheets]);
  const criteriaBySheet = useMemo(
    () => new Map([...models].map(([name, m]) => [name, criteriaColumns(m)])),
    [models],
  );
  const workbookId = props.initialView.workbook.id;

  const sheet = sheets.find((s) => s.name === activeSheet)!;
  const model = models.get(activeSheet)!;
  const selected = selectedBySheet[activeSheet] ?? "A1";
  const selectedRef = `${activeSheet}!${selected}`;
  const selectedCell = model.cellAt.get(selected);

  function numFmtOf(address: string) {
    const cell = model.cellAt.get(address);
    return cell?.style !== undefined ? styles[cell.style].numFmt : undefined;
  }

  function focusGrid() {
    scrollerRef.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    scrollerRef.current
      ?.querySelector(`[data-address="${selected}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, activeSheet]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-score-picker]") || target?.closest(`td[data-address="${selected}"]`)) return;
      setPickerHighlight(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen, selected]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(t);
  }, [saveState]);

  useEffect(() => {
    if (notice?.tone !== "info" || notice.action) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  /** Shows the edit at once and queues it; the queue is saved AUTOSAVE_DELAY after the last edit, on Save, or on leaving. */
  function save(cellRef: string, value: SheetCellValue) {
    const queued = pending.current.get(cellRef);
    pending.current.set(cellRef, { value, since: queued ? queued.since : revision.current });
    setView((v) => ({ ...v, cells: { ...v.cells, [cellRef]: value } }));
    setSaveState("dirty");
    scheduleFlush(AUTOSAVE_DELAY);
  }

  function scheduleFlush(delay: number) {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flush(), delay);
  }

  /** The server's view with this browser's not-yet-saved edits laid over it. */
  function withPending(next: WorkbookView): WorkbookView {
    if (!pending.current.size) return next;
    const cells = { ...next.cells };
    for (const [ref, edit] of pending.current) cells[ref] = edit.value;
    return { ...next, cells };
  }

  async function reload() {
    const res = await fetch(`/api/workbooks/${workbookId}`, { cache: "no-store" });
    if (!res.ok) return;
    const next = (await res.json()) as WorkbookView;
    revision.current = next.workbook.updatedAt;
    setView(withPending(next));
  }

  function showConflicts(conflicts: CellConflict[]) {
    const who = (c: CellConflict) => c.by ?? "pengguna lain";
    const text =
      conflicts.length === 1
        ? `${cellLabel(conflicts[0].cellRef)} sudah diubah oleh ${who(conflicts[0])} sejak Anda membukanya. ` +
          `Nilai Anda (${conflicts[0].yourValue ?? "kosong"}) tidak disimpan; nilai mereka (${String(conflicts[0].theirValue ?? "kosong")}) dipertahankan.`
        : `${conflicts.length} sel sudah diubah oleh pengguna lain sejak Anda membukanya (${conflicts.map((c) => cellLabel(c.cellRef)).join(", ")}). ` +
          "Nilai Anda tidak disimpan; nilai mereka dipertahankan.";
    setNotice({
      text,
      tone: "warning",
      action: {
        label: "Timpa dengan nilai saya",
        run: () => {
          for (const c of conflicts) pending.current.set(c.cellRef, { value: c.yourValue });
          setView((v) => withPending(v));
          setNotice(null);
          void flush();
        },
      },
    });
  }

  /**
   * Sends every queued edit in one request (one save at a time, in order).
   * Resolves true once nothing is left unsaved.
   */
  async function flush(): Promise<boolean> {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    while (inflight.current) await inflight.current;
    if (!pending.current.size) return true;

    const batch = [...pending.current];
    pending.current.clear();
    // Puts edits back for a retry, unless the cell was edited again meanwhile.
    const requeue = () => {
      for (const [ref, edit] of batch) if (!pending.current.has(ref)) pending.current.set(ref, edit);
    };
    setSaveState("saving");

    const run = (async (): Promise<boolean> => {
      let res: Response;
      try {
        res = await fetch(`/api/workbooks/${workbookId}/cells`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edits: batch.map(([cellRef, e]) => ({ cellRef, value: e.value, since: e.since })) }),
          // Lets the request finish even if the tab is closing.
          keepalive: true,
        });
      } catch {
        res = new Response(null, { status: 503 });
      }
      if (res.status >= 500) {
        requeue();
        setSaveState("error");
        setNotice({ text: "Koneksi bermasalah — perubahan belum tersimpan, mencoba lagi otomatis.", tone: "warning" });
        scheduleFlush(RETRY_DELAY);
        return false;
      }
      if (!res.ok) {
        // Rejected outright (e.g. an invalid value): drop the batch and show what the server holds.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage({ text: body.error ?? "Gagal menyimpan perubahan.", tone: "error" });
        setSaveState("error");
        await reload();
        return false;
      }
      const { view: next, conflicts } = (await res.json()) as { view: WorkbookView; conflicts: CellConflict[] };
      revision.current = next.workbook.updatedAt;
      setView(withPending(next));
      if (conflicts.length) showConflicts(conflicts);
      else setNotice((n) => (n?.text.startsWith("Koneksi bermasalah") ? null : n));
      setSaveState(pending.current.size ? "dirty" : "saved");
      return true;
    })();

    inflight.current = run;
    let ok: boolean;
    try {
      ok = await run;
    } finally {
      inflight.current = null;
    }
    if (pending.current.size && !flushTimer.current) scheduleFlush(AUTOSAVE_DELAY);
    return ok && pending.current.size === 0;
  }

  /** The Save button and Ctrl+S: finish the open edit and save now. */
  async function saveNow() {
    if (!commitEdit()) return;
    await flush();
  }

  /** Back to Beranda only once everything is saved, so a failure can still be shown here. */
  async function leaveTo(e: ReactMouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (!commitEdit()) return;
    if (await flush()) router.push(href);
  }

  function lockedMessage(address: string): string {
    const cell = model.cellAt.get(address);
    if (cell?.formula) return "Sel ini berisi rumus dan dihitung otomatis.";
    if (cell?.isInput) return "Sel ini diisi dari formulir PJP dan tidak dapat diubah.";
    return "Sel ini bagian dari templat dan terkunci.";
  }

  function startEdit(
    address: string,
    initial: string | undefined,
    mode: EditingState["mode"],
    focus: EditingState["focus"] = "cell",
  ) {
    const ref = `${activeSheet}!${address}`;
    if (!editable.has(ref)) {
      setMessage({ text: lockedMessage(address), tone: "info" });
      return;
    }
    setMessage(null);
    setEditing({ address, draft: initial ?? editText(view.cells[ref], numFmtOf(address)), mode, focus });
  }

  /** Turns the typed text into the value to store, or an error message (and the edit stays open). */
  function parseDraft(ref: string, draft: string): { value: SheetCellValue } | { error: string } {
    if (scoreCells.has(ref)) {
      const n = parseNumberInput(draft);
      if (n === null) return { value: null };
      if (n === undefined || !Number.isInteger(n) || n < 1 || n > 5) {
        return { error: "Nilai Pengawas harus angka bulat 1–5. Kosongkan untuk kembali ke nilai PJP." };
      }
      return { value: n };
    }
    if (textCells.has(ref)) return { value: draft.trim() === "" ? null : draft.replace(/\s+$/, "") };
    const n = parseNumberInput(draft);
    if (n !== undefined) return { value: n };
    if (typeof view.cells[ref] === "string") return { value: draft.trim() };
    return { error: "Masukkan angka, misalnya 1.250.000 atau 25%." };
  }

  function select(address: string) {
    setSelectedBySheet((s) => ({ ...s, [activeSheet]: address }));
    // An open document panel follows the selection to other link cells, and stays put on cells without one.
    const ref = `${activeSheet}!${address}`;
    if (panelDoc && panelDoc.ref !== ref && linksForRef(ref).length) setPanelDoc({ ref, index: 0 });
  }

  /** The document links a cell holds: its stored value, or the template's own hyperlink. */
  function linksForRef(ref: string): DocLink[] {
    const i = ref.lastIndexOf("!");
    const cell = models.get(ref.slice(0, i))?.cellAt.get(ref.slice(i + 1));
    const value = ref in view.cells ? view.cells[ref] : cell?.isInput ? null : cell?.value;
    const links = docLinksIn(value);
    return links.length ? links : docLinksIn(cell?.href);
  }

  /** The question a link belongs to: the longest text in the link's row (e.g. KPMR column C). */
  function rowTitle(ref: string): string | undefined {
    const i = ref.lastIndexOf("!");
    const sheetName = ref.slice(0, i);
    const sheetModel = models.get(sheetName);
    if (!sheetModel) return undefined;
    const row = parseAddress(ref.slice(i + 1)).row;
    let best = "";
    for (const [address, cell] of sheetModel.cellAt) {
      if (parseAddress(address).row !== row || address === ref.slice(i + 1)) continue;
      const text = displayValue(sheetName, cell, view.cells, styles).text.replace(/\s+/g, " ").trim();
      if (text.length > best.length && !/^https?:\/\//.test(text)) best = text;
    }
    return best.length >= 12 ? best : undefined;
  }

  function openDoc(ref: string) {
    setHoverDoc(null);
    setPanelDoc({ ref, index: 0 });
  }

  function onLinkHover(address: string | null, rect?: DOMRect) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (!address || !rect) {
      setHoverDoc(null);
      return;
    }
    const ref = `${activeSheet}!${address}`;
    hoverTimer.current = setTimeout(() => setHoverDoc({ ref, rect }), HOVER_DELAY);
  }

  function hideHover() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoverDoc(null);
  }

  const isScoreCell = (address: string) => {
    const ref = `${activeSheet}!${address}`;
    return editable.has(ref) && scoreCells.has(ref);
  };

  /** The open list's contents for the selected score cell, or null when it's closed. */
  const picker: ScorePickerState | null = (() => {
    if (!pickerOpen || !isScoreCell(selected) || editing) return null;
    const criteria = criteriaBySheet.get(activeSheet);
    const row = parseAddress(selected).row;
    const pjpValue = view.cells[pjpScoreRef(selectedRef)] ?? null;
    return {
      options: SCORES_DESC.map((value) => {
        const col = criteria?.get(value);
        const text = col ? displayValue(activeSheet, model.cellAt.get(`${col}${row}`), view.cells, styles).text : "";
        return { value, criteria: text.replace(/\s+/g, " ").trim() || undefined };
      }),
      current: view.cells[selectedRef] ?? null,
      pjpValue,
      canReset: overridden.has(selectedRef),
      highlighted: pickerHighlight,
    };
  })();
  const pickerItemCount = picker ? picker.options.length + (picker.canReset ? 1 : 0) : 0;

  function openPicker() {
    const current = view.cells[selectedRef];
    const index = SCORES_DESC.indexOf(typeof current === "number" ? current : -1);
    setMessage(null);
    setPickerHighlight(index === -1 ? 0 : index);
  }

  function highlightPickerItem(index: number) {
    setPickerHighlight(index);
  }

  function closePicker() {
    setPickerHighlight(null);
  }

  /** Saves a score straight from the list or a 1–5 key press; null reverts to the PJP's value. */
  function pickScore(address: string, value: number | null) {
    closePicker();
    focusGrid();
    const ref = `${activeSheet}!${address}`;
    if (value === null) {
      if (view.cells[ref] !== null && view.cells[ref] !== undefined) void save(ref, null);
      return;
    }
    if (!sameValue(value, view.cells[ref])) void save(ref, value);
  }

  /** Saves the open edit (optionally moving the selection like Enter/Tab do). Returns false if the input was rejected. */
  function commitEdit(move?: [number, number]): boolean {
    if (!editing) return true;
    const ref = `${activeSheet}!${editing.address}`;
    const parsed = parseDraft(ref, editing.draft);
    if ("error" in parsed) {
      setMessage({ text: parsed.error, tone: "error" });
      return false;
    }
    setEditing(null);
    setMessage(null);
    if (move) select(moveFrom(model, editing.address, move[0], move[1]));
    focusGrid();
    if (!sameValue(parsed.value, view.cells[ref])) void save(ref, parsed.value);
    return true;
  }

  function onSelect(address: string) {
    if (editing?.address === address) return;
    if (editing && !commitEdit()) return;
    if (address !== selected) closePicker();
    select(address);
    setMessage(null);
    requestAnimationFrame(focusGrid);
  }

  function onActivate(address: string) {
    closePicker();
    startEdit(address, undefined, "edit");
  }

  /** A click on a score cell toggles its 1–5 list (the mousedown before it already selected the cell). */
  function onCellClick(address: string) {
    const ref = `${activeSheet}!${address}`;
    if (!editing && linksForRef(ref).length) {
      openDoc(ref);
      return;
    }
    if (!isScoreCell(address) || editing) return;
    if (pickerOpen) closePicker();
    else openPicker();
  }

  function onDraftChange(draft: string) {
    setEditing((e) => (e ? { ...e, draft } : e));
  }

  function onEditorKeyDown(e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    e.stopPropagation();
    if (!editing) return;
    if (e.key === "Enter" && e.altKey && textCells.has(`${activeSheet}!${editing.address}`)) {
      e.preventDefault();
      const el = e.currentTarget;
      const pos = el.selectionStart ?? editing.draft.length;
      const draft = `${editing.draft.slice(0, pos)}\n${editing.draft.slice(el.selectionEnd ?? pos)}`;
      setEditing({ ...editing, draft });
      requestAnimationFrame(() => el.setSelectionRange(pos + 1, pos + 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit([e.shiftKey ? -1 : 1, 0]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit([0, e.shiftKey ? -1 : 1]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
      setMessage(null);
      focusGrid();
    } else if (editing.mode === "enter" && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const moves: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      commitEdit(moves[e.key]);
    }
  }

  // Grid cells are memoized, so they get callbacks with a stable identity that forward to the latest handlers.
  const zoomBy = (step: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + step)));
  const handlers = useRef({ onSelect, onActivate, onCellClick, pickScore, highlightPickerItem, onDraftChange, onEditorKeyDown, flush, saveNow, withPending, toggleFormulaBar, zoomBy, onLinkHover });
  useLayoutEffect(() => {
    handlers.current = { onSelect, onActivate, onCellClick, pickScore, highlightPickerItem, onDraftChange, onEditorKeyDown, flush, saveNow, withPending, toggleFormulaBar, zoomBy, onLinkHover };
  });

  // Ctrl/⌘ + wheel zooms the sheet (not the whole page), 10% per notch; trackpad pinches add up to a notch.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let accumulated = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      accumulated += e.deltaY;
      if (Math.abs(accumulated) < 40) return;
      handlers.current.zoomBy(accumulated < 0 ? 10 : -10);
      accumulated = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Leaving: save what's queued when the tab is hidden or closed, or the page unmounts (in-app navigation),
  // and ask before closing while edits are still unsaved. Ctrl+S saves now, as in Excel.
  useEffect(() => {
    const flushNow = () => {
      if (pending.current.size) void handlers.current.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!pending.current.size && !inflight.current) return;
      flushNow();
      e.preventDefault();
      e.returnValue = "";
    };
    // Capture phase: the cell editor stops its keydowns from bubbling.
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handlers.current.saveNow();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        handlers.current.toggleFormulaBar();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("keydown", onKeyDown, true);
      flushNow();
    };
  }, []);

  // Others' changes: a small version check every POLL_INTERVAL, only while the tab is visible and in use,
  // and right away on coming back to it. A change reloads the view, keeping this browser's unsaved edits on top.
  useEffect(() => {
    let lastActive = Date.now();
    let checking = false;
    const check = async () => {
      if (checking || inflight.current || document.visibilityState !== "visible" || Date.now() - lastActive > IDLE_AFTER) return;
      checking = true;
      try {
        const res = await fetch(`/api/workbooks/${workbookId}/changes?since=${encodeURIComponent(revision.current)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const change = (await res.json()) as { updatedAt: string; changed: boolean; by?: string | null };
        if (!change.changed || change.updatedAt === revision.current) return;
        const viewRes = await fetch(`/api/workbooks/${workbookId}`, { cache: "no-store" });
        if (!viewRes.ok || inflight.current) return; // a save of ours is landing; its response is newer
        const next = (await viewRes.json()) as WorkbookView;
        revision.current = next.workbook.updatedAt;
        setView(handlers.current.withPending(next));
        setNotice({ text: `Workbook diperbarui oleh ${change.by ?? "pengguna lain"}.`, tone: "info" });
      } catch {
        // Offline for a moment: the next check tries again.
      } finally {
        checking = false;
      }
    };
    const onActivity = () => {
      const wasIdle = Date.now() - lastActive > IDLE_AFTER;
      lastActive = Date.now();
      if (wasIdle) void check();
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      lastActive = Date.now();
      void check();
    };
    const timer = setInterval(check, POLL_INTERVAL);
    const activity = ["pointerdown", "keydown", "wheel"] as const;
    for (const type of activity) window.addEventListener(type, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      for (const type of activity) window.removeEventListener(type, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [workbookId]);
  const stableHandlers = useMemo(
    () => ({
      onSelect: (address: string) => handlers.current.onSelect(address),
      onActivate: (address: string) => handlers.current.onActivate(address),
      onCellClick: (address: string) => handlers.current.onCellClick(address),
      onPick: (address: string, value: number | null) => handlers.current.pickScore(address, value),
      onPickerHighlight: (index: number) => handlers.current.highlightPickerItem(index),
      onDraftChange: (draft: string) => handlers.current.onDraftChange(draft),
      onEditorKeyDown: (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) =>
        handlers.current.onEditorKeyDown(e),
      onLinkHover: (address: string | null, rect?: DOMRect) => handlers.current.onLinkHover(address, rect),
    }),
    [],
  );

  const clearCell = (address: string) => {
    const ref = `${activeSheet}!${address}`;
    if (!editable.has(ref)) {
      setMessage({ text: lockedMessage(address), tone: "info" });
      return;
    }
    if (view.cells[ref] !== null && view.cells[ref] !== undefined) void save(ref, null);
  };

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    if (picker) {
      // The open list takes the keys it needs, like Excel's dropdown; anything else closes it and acts as usual.
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setPickerHighlight((i) => Math.min(Math.max((i ?? 0) + step, 0), pickerItemCount - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const i = picker.highlighted;
        pickScore(selected, i < picker.options.length ? picker.options[i].value : null);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closePicker();
        return;
      }
      closePicker();
    }
    // Space opens (or closes) the selected link cell's document in the side panel; Esc closes the panel.
    if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey && linksForRef(selectedRef).length) {
      e.preventDefault();
      if (panelDoc?.ref === selectedRef) setPanelDoc(null);
      else openDoc(selectedRef);
      return;
    }
    if (e.key === "Escape" && panelDoc) {
      e.preventDefault();
      setPanelDoc(null);
      return;
    }
    if (isScoreCell(selected)) {
      if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        openPicker();
        return;
      }
      // A 1–5 key saves at once: there is nothing else a score cell can hold, so no Enter is needed.
      if (/^[1-5]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        pickScore(selected, Number(e.key));
        return;
      }
    }
    const go = (dRow: number, dCol: number) => {
      e.preventDefault();
      setMessage(null);
      select(moveFrom(model, selected, dRow, dCol));
    };
    const ctrl = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case "ArrowUp":
        return go(ctrl ? -model.rows.length : -1, 0);
      case "ArrowDown":
        return go(ctrl ? model.rows.length : 1, 0);
      case "ArrowLeft":
        return go(0, ctrl ? -model.cols.length : -1);
      case "ArrowRight":
        return go(0, ctrl ? model.cols.length : 1);
      case "PageUp":
        return go(-20, 0);
      case "PageDown":
        return go(20, 0);
      case "Enter":
        return go(e.shiftKey ? -1 : 1, 0);
      case "Tab":
        return go(0, e.shiftKey ? -1 : 1);
      case "Home":
        e.preventDefault();
        select(ctrl ? "A1" : `A${parseAddress(selected).row}`);
        return;
      case "F2":
        e.preventDefault();
        startEdit(selected, undefined, "edit");
        return;
      case "Delete":
        e.preventDefault();
        clearCell(selected);
        return;
      case "Backspace":
        e.preventDefault();
        startEdit(selected, "", "enter");
        return;
    }
    if (ctrl && e.key.toLowerCase() === "c") {
      const text = displayValue(activeSheet, selectedCell, view.cells, styles).text;
      void navigator.clipboard?.writeText(text);
      setMessage({ text: "Disalin ke clipboard.", tone: "info" });
      return;
    }
    if (e.key.length === 1 && !ctrl && !e.altKey) {
      e.preventDefault();
      startEdit(selected, e.key, "enter");
    }
  };

  const switchSheet = (name: string) => {
    if (!commitEdit()) return;
    closePicker();
    setActiveSheet(name);
    setMessage(null);
    window.history.replaceState(null, "", `?sheet=${encodeURIComponent(name)}`);
    requestAnimationFrame(focusGrid);
  };

  /** The name box: jump to a typed address like "O7", as Excel's Go To does. */
  function goToCell(input: string) {
    const address = input.trim().toUpperCase().replace(/\$/g, "");
    if (!/^[A-Z]{1,3}\d{1,7}$/.test(address)) {
      setMessage({ text: `"${input.trim()}" bukan alamat sel — contoh: O7.`, tone: "error" });
      return;
    }
    const { row, col } = parseAddress(address);
    if (!model.rows.includes(row) || !model.cols.includes(col)) {
      setMessage({ text: `Sel ${address} tidak ada (atau tersembunyi) di lembar ini.`, tone: "error" });
      return;
    }
    if (!commitEdit()) return;
    closePicker();
    select(model.coveredBy.get(address) ?? address);
    setNameBoxDraft(null);
    setMessage(null);
    requestAnimationFrame(focusGrid);
  }

  function resizeColumn(col: number, width: number | null) {
    setColWidthsBySheet((all) => {
      const widths = { ...all[activeSheet] };
      if (width === null) delete widths[col];
      else widths[col] = width;
      return { ...all, [activeSheet]: widths };
    });
  }

  async function onExport(kind: "workbook" | "individu") {
    if (!commitEdit()) return;
    // The export reads the database, so it must include the edits still queued here.
    if (!(await flush())) {
      setMessage({ text: "Perubahan belum tersimpan — ekspor dibatalkan.", tone: "error" });
      return;
    }
    setExporting(kind);
    try {
      const path = kind === "individu" ? "export-individu" : "export";
      const res = await fetch(`/api/workbooks/${view.workbook.id}/${path}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage({ text: body.error ?? "Gagal mengekspor.", tone: "error" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? "IRA.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  }

  // Like Excel: the formula for computed cells (and for score cells still on their `=L`/`=H` default), else the raw value.
  const formulaBarText = (() => {
    if (editing) return editing.draft;
    const showsFormula = selectedCell?.formula && (!selectedCell.isInput || !overridden.has(selectedRef));
    // Expanded, long formulas keep their own line breaks; on one line they're joined.
    if (showsFormula) return `=${barExpanded ? selectedCell!.formula! : selectedCell!.formula!.replace(/\s*\n\s*/g, " ")}`;
    const value = selectedRef in view.cells ? view.cells[selectedRef] : selectedCell?.isInput ? null : selectedCell?.value;
    return editText(value, numFmtOf(selected));
  })();

  // "Kenapa nilainya …?": shown while any cell of an A2 parameter row is selected.
  const explanation =
    activeSheet === A2_SHEET ? view.parameterInfo.find((p) => p.row === parseAddress(selected).row) : undefined;

  /** A C2 row's label (column B), e.g. "Cash to Account (Outgoing)" for D10. */
  function c2Label(cell: string): string {
    const c2 = models.get(C2_SHEET);
    const row = parseAddress(cell).row;
    const text = c2 ? displayValue(C2_SHEET, c2.cellAt.get(`B${row}`), view.cells, styles).text.trim() : "";
    return text || `Baris ${row}`;
  }

  function goToC2(cell: string) {
    if (!sheets.some((s) => s.name === C2_SHEET)) return;
    setSelectedBySheet((s) => ({ ...s, [C2_SHEET]: cell }));
    switchSheet(C2_SHEET);
  }

  const hint = (() => {
    if (message) return message;
    const isEditable = editable.has(selectedRef);
    let text: string;
    if (scoreCells.has(selectedRef)) {
      text = "Nilai Pengawas (1–5) — klik sel untuk memilih, atau tekan 1–5. Delete mengembalikan ke nilai PJP.";
      if (overridden.has(selectedRef)) {
        text = `Berbeda dari nilai PJP (${view.cells[pjpScoreRef(selectedRef)] ?? "-"}). ${text}`;
      }
    } else if (sharedCells.has(selectedRef)) {
      text = "Keterangan berlaku untuk semua PJP — perubahan di sini ikut mengubah workbook PJP lain. Alt+Enter untuk baris baru.";
    } else if (textCells.has(selectedRef)) {
      text = "Catatan pengawas — ketik lalu Enter. Alt+Enter untuk baris baru.";
    } else if (isEditable) {
      text = "Jawaban formulir PJP — perubahan oleh pengawas tercatat sebagai koreksi.";
    } else if (linksForRef(selectedRef).length) {
      text = "Dokumen PJP — klik atau tekan Spasi untuk membuka di panel samping · Ctrl+klik: tab baru.";
    } else if (selectedCell?.formula) {
      text = "Dihitung otomatis dari rumus templat.";
    } else if (selectedCell?.isInput) {
      text = "Diisi dari formulir PJP — tidak dapat diubah.";
    } else {
      text = "Siap";
    }
    return { text, tone: "info" as const };
  })();

  const { scores } = view;

  return (
    <div className="fixed inset-0 flex flex-col bg-white text-[13px] text-black">
      {/* Title bar */}
      <header className="flex h-10 shrink-0 items-center gap-3 px-3 text-white" style={{ backgroundColor: EXCEL_GREEN }}>
        <Link
          href="/"
          onClick={(e) => void leaveTo(e, "/")}
          className="rounded px-2 py-1 text-white/90 hover:bg-white/15"
          title="Kembali ke Beranda"
        >
          ‹ Beranda
        </Link>
        {/* White ring so the blue mark reads on the green bar. */}
        <Image src="/bi-mark.webp" alt="Bank Indonesia" width={24} height={24} unoptimized className="rounded-full bg-white p-px" />        <span className="truncate font-medium">
          IRA_{view.workbook.pjpSandi} - {view.workbook.pjpNama}.xlsx
        </span>
        <span className="flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs">
          {STATUS_LABELS[view.workbook.status] ?? view.workbook.status}
          <InfoTip label="Penjelasan status workbook" onDark>
            {HELP.stages}
          </InfoTip>
        </span>
        <span className="ml-auto flex items-center gap-4">
          {props.readOnly ? (
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs" title="Akun Anda hanya bisa melihat dan export">
              Hanya lihat
            </span>
          ) : (
            <>
              <span className="text-xs text-white/85" role="status">
                {SAVE_LABELS[saveState]}
              </span>
              <button
                onClick={() => void saveNow()}
                disabled={saveState !== "dirty" && saveState !== "error"}
                title="Simpan sekarang (Ctrl+S). Perubahan juga tersimpan otomatis."
                className="rounded border border-white/70 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-50 disabled:hover:bg-transparent"
              >
                Simpan
              </button>
            </>
          )}
          {/* One Export menu for both downloads. */}
          <span className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setExportMenuOpen((o) => !o)}
              disabled={exporting !== null}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              className="flex items-center gap-1.5 rounded bg-white px-3 py-1 text-xs font-semibold disabled:opacity-60"
              style={{ color: EXCEL_GREEN }}
            >
              {exporting ? "Menyiapkan…" : "Export"}
              <span className={`text-[9px] transition-transform ${exportMenuOpen ? "rotate-180" : ""}`}>▼</span>
            </button>
            {exportMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-[#C6C6C6] bg-white py-1 text-left text-[13px] text-black shadow-lg"
              >
                {(
                  [
                    { kind: "workbook", label: "Template Excel", help: "Workbook IRA seperti yang tampil di web" },
                    { kind: "individu", label: "BSSS - PJP Individu", help: "Laporan BI APU PPT dan Net Risk PTD Individu" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.kind}
                    role="menuitem"
                    onClick={() => {
                      setExportMenuOpen(false);
                      void onExport(item.kind);
                    }}
                    className="block w-full px-3 py-2 text-left hover:bg-[#E8F2EC]"
                  >
                    <span className="block font-medium">{item.label}</span>
                    <span className="block text-[11.5px] text-[#666]">{item.help}</span>
                  </button>
                ))}
              </div>
            )}
          </span>
        </span>
      </header>

      {/* Name box + formula bar */}
      <div className="relative flex shrink-0 items-start gap-2 border-b border-[#D4D4D4] bg-white px-2 py-1">
        <input
          aria-label="Kotak nama: ketik alamat sel lalu Enter"
          title="Ketik alamat sel (mis. O7) lalu Enter untuk menuju ke sel itu"
          value={nameBoxDraft ?? selected}
          onFocus={(e) => {
            setNameBoxDraft(selected);
            const input = e.currentTarget;
            requestAnimationFrame(() => input.select());
          }}
          onChange={(e) => setNameBoxDraft(e.target.value)}
          onBlur={() => setNameBoxDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              goToCell(e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setNameBoxDraft(null);
              focusGrid();
            }
          }}
          spellCheck={false}
          className="h-6 w-24 shrink-0 rounded-sm border border-[#C6C6C6] px-2 font-mono text-xs outline-none focus:border-[#217346]"
        />
        <span className="flex h-6 select-none items-center px-1 font-serif italic text-[#666]">fx</span>
        <textarea
          aria-label="Bilah rumus"
          className="min-w-0 flex-1 resize-none rounded-sm border border-[#C6C6C6] px-2 py-[3px] font-mono text-xs leading-4 outline-none focus:border-[#217346] read-only:bg-[#FAFAFA] read-only:text-[#555]"
          style={{
            height: shownBarHeight,
            whiteSpace: barExpanded ? "pre-wrap" : "pre",
            overflowX: "hidden",
            overflowY: barExpanded ? "auto" : "hidden",
          }}
          value={formulaBarText ?? ""}
          readOnly={!editable.has(selectedRef)}
          onFocus={() => {
            if (!editing && editable.has(selectedRef)) startEdit(selected, undefined, "edit", "bar");
          }}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (editing) onEditorKeyDown(e);
          }}
          spellCheck={false}
        />
        <button
          onClick={toggleFormulaBar}
          aria-expanded={barExpanded}
          title={`${barExpanded ? "Ciutkan" : "Perluas"} bilah rumus (Ctrl+Shift+U)`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[#555] hover:bg-[#E6E6E6]"
        >
          <span className={`text-[10px] transition-transform ${barExpanded ? "rotate-180" : ""}`}>▼</span>
        </button>
        {/* Bottom edge: drag to resize, double-click to expand/collapse. */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Ubah tinggi bilah rumus"
          title="Seret untuk mengubah tinggi bilah rumus"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            setBarDrag({ startY: e.clientY, startHeight: barHeight, height: barHeight });
          }}
          onPointerMove={(e) => {
            if (!barDrag) return;
            const height = Math.min(BAR_MAX, Math.max(BAR_MIN, Math.round(barDrag.startHeight + e.clientY - barDrag.startY)));
            setBarDrag({ ...barDrag, height });
          }}
          onPointerUp={() => {
            if (!barDrag) return;
            setBarHeight(barDrag.height);
            setBarDrag(null);
          }}
          onPointerCancel={() => setBarDrag(null)}
          onDoubleClick={toggleFormulaBar}
          className="absolute inset-x-0 -bottom-[3px] z-10 h-[6px] cursor-row-resize hover:bg-[#217346]/40"
          style={barDrag ? { backgroundColor: EXCEL_GREEN } : undefined}
        />
      </div>

      {notice && (
        <div
          role="status"
          className={`flex shrink-0 items-center gap-3 border-b px-3 py-1.5 text-xs text-black ${
            notice.tone === "warning" ? "border-[#F0D58C] bg-[#FFF4CE]" : "border-[#C7E0F4] bg-[#EFF6FC]"
          }`}
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          {notice.action && (
            <button onClick={notice.action.run} className="shrink-0 rounded border border-black/20 bg-white px-2 py-0.5 font-medium hover:bg-black/5">
              {notice.action.label}
            </button>
          )}
          <button onClick={() => setNotice(null)} aria-label="Tutup pemberitahuan" className="shrink-0 px-1 text-[#555] hover:text-black">
            ✕
          </button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <SheetGrid
          sheet={sheet}
          model={model}
          styles={styles}
          values={view.cells}
          editable={editable}
          overridden={overridden}
          selected={selected}
          editing={editing}
          wideEditorCells={textCells}
          scoreCells={scoreCells}
          picker={picker}
          zoom={zoom}
          colWidthOverrides={colWidthsBySheet[activeSheet] ?? {}}
          onResizeColumn={resizeColumn}
          scrollerRef={scrollerRef}
          onGridKeyDown={onGridKeyDown}
          onSelect={stableHandlers.onSelect}
          onActivate={stableHandlers.onActivate}
          onCellClick={stableHandlers.onCellClick}
          onPick={stableHandlers.onPick}
          onPickerHighlight={stableHandlers.onPickerHighlight}
          onDraftChange={stableHandlers.onDraftChange}
          onEditorKeyDown={stableHandlers.onEditorKeyDown}
          onLinkHover={stableHandlers.onLinkHover}
          onScroll={hideHover}
        />
        {explanation &&
          (explainHidden ? (
            <button
              onClick={() => setExplainHidden(false)}
              className="absolute bottom-3 left-14 z-40 rounded-full border border-[#C7D7EA] bg-[#F7FAFE] px-3 py-1 text-xs font-medium text-[#1F4E78] shadow hover:bg-white"
            >
              Kenapa nilainya {explanation.pjpScore}?
            </button>
          ) : (
            <ExplainStrip info={explanation} labelOf={c2Label} onGoTo={goToC2} onClose={() => setExplainHidden(true)} />
          ))}
        {panelDoc &&
          (() => {
            const links = linksForRef(panelDoc.ref);
            if (!links.length) return null;
            return (
              <DocPanel
                links={links}
                index={Math.min(panelDoc.index, links.length - 1)}
                cellLabel={cellLabel(panelDoc.ref)}
                title={rowTitle(panelDoc.ref)}
                width={panelWidth}
                onIndex={(index) => setPanelDoc({ ...panelDoc, index })}
                onResize={setPanelWidth}
                onClose={() => {
                  setPanelDoc(null);
                  focusGrid();
                }}
              />
            );
          })()}
      </div>
      {hoverDoc &&
        !editing &&
        !pickerOpen &&
        panelDoc?.ref !== hoverDoc.ref &&
        (() => {
          const links = linksForRef(hoverDoc.ref);
          return links.length ? <DocHoverCard key={hoverDoc.ref} links={links} rect={hoverDoc.rect} /> : null;
        })()}

      {/* Sheet tabs */}
      <nav className="flex h-8 shrink-0 items-stretch gap-px border-t border-[#D4D4D4] bg-[#F3F3F3] pl-10">
        {sheets.map((s) => {
          const active = s.name === activeSheet;
          return (
            <button
              key={s.name}
              onClick={() => switchSheet(s.name)}
              className={`px-4 text-xs ${active ? "bg-white font-semibold" : "text-[#444] hover:bg-[#E6E6E6]"}`}
              style={active ? { color: EXCEL_GREEN, boxShadow: `inset 0 -2px 0 ${EXCEL_GREEN}` } : undefined}
            >
              {s.name}
            </button>
          );
        })}
      </nav>

      {/* Status bar */}
      <footer className="flex h-7 shrink-0 items-center gap-4 px-3 text-xs text-white" style={{ backgroundColor: EXCEL_GREEN }}>
        <span className={`truncate ${hint.tone === "error" ? "rounded bg-[#C42B1C] px-2 py-0.5" : ""}`}>{hint.text}</span>
        <span className="ml-auto flex shrink-0 items-center gap-4">
          {!view.ltdbb ? (
            <span className="flex items-center rounded bg-[#C42B1C] px-2 py-0.5 font-semibold">
              Data LTDBB belum ada
              <InfoTip label="Penjelasan data LTDBB belum ada" onDark>
                {HELP.ltdbbSource}
              </InfoTip>
            </span>
          ) : view.ltdbb.flags.includes("NOT_IN_LTDBB") ? (
            <span className="flex items-center rounded bg-white/20 px-2 py-0.5">
              Tidak ada di LTDBB {view.ltdbb.dataYear}
              <InfoTip label="Penjelasan tidak ada di LTDBB" onDark>
                {FLAG_HELP.NOT_IN_LTDBB} Sumber: {view.ltdbb.filename}.
              </InfoTip>
            </span>
          ) : view.ltdbb.flags.includes("INCOMPLETE_YEAR") ? (
            <span className="flex items-center rounded bg-white/20 px-2 py-0.5">
              LTDBB {view.ltdbb.dataYear} &lt; 12 bulan
              <InfoTip label="Penjelasan LTDBB kurang dari 12 bulan" onDark>
                {FLAG_HELP.INCOMPLETE_YEAR} Sumber: {view.ltdbb.filename}.
              </InfoTip>
            </span>
          ) : null}
          {view.hasDataMismatch && (
            <span className="flex items-center rounded bg-[#FFC000] px-2 py-0.5 font-semibold text-black">
              Perbedaan Data
              <InfoTip label="Penjelasan Perbedaan Data">
                {FLAG_HELP.PENALTY_EXPECTED} Total LTDBB {view.ltdbb?.dataYear}: Rp
                {view.ltdbb?.totalNominal.toLocaleString("id-ID")}.
              </InfoTip>
            </span>
          )}
          <span>
            Inheren: {scores.inherentScore.pengawas.toFixed(2)} ({scores.inherentPredikat.pengawas})
          </span>
          <span>
            KPMR: {scores.kpmrOverall.pengawas.toFixed(2)} ({scores.kpmrPredikat.pengawas})
          </span>
          <span className="flex items-center font-semibold">
            <InfoTip label="Penjelasan nilai akhir IRA" onDark>
              {HELP.finalIra}
            </InfoTip>
            <span className="ml-1">Nilai Akhir IRA:</span>&nbsp;
            {/* NaN on first render; a PATCH response's JSON turns it into null. */}
            {typeof scores.finalIra.pengawasAdjusted !== "number" || Number.isNaN(scores.finalIra.pengawasAdjusted)
              ? "#N/A (KPMR belum diisi)"
              : `${scores.finalIra.pengawasAdjusted} — ${scores.finalIraPredikat.pengawasAdjusted}`}
          </span>
          <span className="flex items-center gap-1.5">
            <button onClick={() => setZoom((z) => Math.max(50, z - 10))} className="px-1 hover:bg-white/15" aria-label="Perkecil">
              −
            </button>
            <input
              type="range"
              min={50}
              max={200}
              step={10}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-24 accent-white"
              aria-label="Zoom"
            />
            <button onClick={() => setZoom((z) => Math.min(200, z + 10))} className="px-1 hover:bg-white/15" aria-label="Perbesar">
              +
            </button>
            <span className="w-9 text-right">{zoom}%</span>
          </span>
        </span>
      </footer>
    </div>
  );
}
