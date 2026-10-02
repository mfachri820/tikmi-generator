"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { LayoutCellStyle, LayoutSheet } from "@ira/template";
import type { SheetCellValue } from "@ira/scoring/config/2026-sheet";
import type { WorkbookView } from "@/lib/workbookView";
import { columnLetter, editText, parseAddress, parseNumberInput } from "@/lib/cellFormat";
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

type Message = { text: string; tone: "info" | "error" };
type SaveState = "idle" | "saving" | "saved" | "error";

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
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [zoom, setZoom] = useState(100);
  const [highlightInputs, setHighlightInputs] = useState(true);
  const [exporting, setExporting] = useState(false);
  /** The 1–5 list is open on the selected score cell; the number is the keyboard-highlighted item. */
  const [pickerHighlight, setPickerHighlight] = useState<number | null>(null);
  const pickerOpen = pickerHighlight !== null;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const latestRequest = useRef(0);

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

  async function save(cellRef: string, value: SheetCellValue) {
    const requestId = ++latestRequest.current;
    const previous = view.cells[cellRef] ?? null;
    setView((v) => ({ ...v, cells: { ...v.cells, [cellRef]: value } }));
    setSaveState("saving");
    const res = await fetch(`/api/workbooks/${workbookId}/cells`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cellRef, value }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setView((v) => ({ ...v, cells: { ...v.cells, [cellRef]: previous } }));
      setMessage({ text: body.error ?? "Gagal menyimpan perubahan.", tone: "error" });
      setSaveState("error");
      return;
    }
    const next = (await res.json()) as WorkbookView;
    // A later edit's response already includes this one; an older response must not overwrite it.
    if (requestId === latestRequest.current) {
      setView(next);
      setSaveState("saved");
    }
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
  const handlers = useRef({ onSelect, onActivate, onCellClick, pickScore, highlightPickerItem, onDraftChange, onEditorKeyDown });
  useLayoutEffect(() => {
    handlers.current = { onSelect, onActivate, onCellClick, pickScore, highlightPickerItem, onDraftChange, onEditorKeyDown };
  });
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

  async function onExport() {
    if (!commitEdit()) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/workbooks/${view.workbook.id}/export`, { method: "POST" });
      if (!res.ok) {
        setMessage({ text: "Gagal mengekspor workbook.", tone: "error" });
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
      setExporting(false);
    }
  }

  // Like Excel: the formula for computed cells (and for score cells still on their `=L`/`=H` default), else the raw value.
  const formulaBarText = (() => {
    if (editing) return editing.draft;
    const showsFormula = selectedCell?.formula && (!selectedCell.isInput || !overridden.has(selectedRef));
    if (showsFormula) return `=${selectedCell!.formula!.replace(/\s*\n\s*/g, " ")}`;
    const value = selectedRef in view.cells ? view.cells[selectedRef] : selectedCell?.isInput ? null : selectedCell?.value;
    return editText(value, numFmtOf(selected));
  })();

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
        <Link href="/" className="rounded px-2 py-1 text-white/90 hover:bg-white/15" title="Kembali ke Beranda">
          ‹ Beranda
        </Link>
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-white text-xs font-bold" style={{ color: EXCEL_GREEN }}>
          X
        </span>
        <span className="truncate font-medium">
          IRA_{view.workbook.pjpSandi} - {view.workbook.pjpNama}.xlsx
        </span>
        <span className="flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs">
          {STATUS_LABELS[view.workbook.status] ?? view.workbook.status}
          <InfoTip label="Penjelasan status workbook" onDark>
            {HELP.stages}
          </InfoTip>
        </span>
        <span className="ml-auto flex items-center gap-4">
          <span className="text-xs text-white/85">
            {saveState === "saving" ? "Menyimpan…" : saveState === "saved" ? "Tersimpan" : saveState === "error" ? "Gagal menyimpan" : ""}
          </span>
          <span className="flex items-center text-xs">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={highlightInputs} onChange={(e) => setHighlightInputs(e.target.checked)} />
              Sorot sel isian
            </label>
            <InfoTip label="Penjelasan sorot sel isian" onDark>
              {HELP.highlightInputs}
            </InfoTip>
          </span>
          <button
            onClick={onExport}
            disabled={exporting}
            className="rounded bg-white px-3 py-1 text-xs font-semibold disabled:opacity-60"
            style={{ color: EXCEL_GREEN }}
          >
            {exporting ? "Mengekspor…" : "Export Excel"}
          </button>
        </span>
      </header>

      {/* Name box + formula bar */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[#D4D4D4] bg-white px-2">
        <div className="flex h-6 w-24 items-center rounded-sm border border-[#C6C6C6] px-2 font-mono text-xs">{selected}</div>
        <span className="select-none px-1 font-serif italic text-[#666]">fx</span>
        <input
          className="h-6 min-w-0 flex-1 rounded-sm border border-[#C6C6C6] px-2 font-mono text-xs outline-none focus:border-[#217346] read-only:bg-[#FAFAFA] read-only:text-[#555]"
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
      </div>

      <SheetGrid
        sheet={sheet}
        model={model}
        styles={styles}
        values={view.cells}
        editable={editable}
        overridden={overridden}
        highlightInputs={highlightInputs}
        selected={selected}
        editing={editing}
        wideEditorCells={textCells}
        scoreCells={scoreCells}
        picker={picker}
        zoom={zoom}
        scrollerRef={scrollerRef}
        onGridKeyDown={onGridKeyDown}
        onSelect={stableHandlers.onSelect}
        onActivate={stableHandlers.onActivate}
        onCellClick={stableHandlers.onCellClick}
        onPick={stableHandlers.onPick}
        onPickerHighlight={stableHandlers.onPickerHighlight}
        onDraftChange={stableHandlers.onDraftChange}
        onEditorKeyDown={stableHandlers.onEditorKeyDown}
      />

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
