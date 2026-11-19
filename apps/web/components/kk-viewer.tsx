"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutCellStyle, LayoutSheet } from "@tikmi/template";
import { buildGridModel, SheetGrid, type SheetCellValue } from "@/components/grid/sheet-grid";
import { formatCellValue } from "@/lib/cellFormat";

const noop = () => {};
const EMPTY = new Set<string>();

const SOURCE_LABEL: Record<string, string> = { pjp: "Isian PJP", pengawas: "Isian pengawas", koreksi: "Koreksi pengawas", system: "Diisi aplikasi" };

/**
 * One KK sheet as Excel shows it, read-only: the template's layout (widths,
 * merges, fills, number formats) with the assessment's own values in input
 * cells and every formula's live result. Name box, formula bar, and sheet tabs
 * (links: each sheet is loaded on its own, the KKs are large).
 */
export function KkViewer({
  sheet,
  styles,
  values,
  sources,
  tabs,
}: {
  sheet: LayoutSheet;
  styles: LayoutCellStyle[];
  /** "Sheet!A1" -> value, for this sheet. */
  values: Record<string, SheetCellValue>;
  sources: Record<string, string>;
  tabs: { name: string; href: string; active: boolean }[];
}) {
  // The grid is drawn in the browser only: server-rendering thousands of styled cells would double the page.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [selected, setSelected] = useState("A1");
  const [widths, setWidths] = useState<Record<number, number>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildGridModel(sheet), [sheet]);
  const koreksi = useMemo(
    () => new Set(Object.entries(sources).filter(([r, s]) => s === "koreksi" && r.startsWith(`${sheet.name}!`)).map(([r]) => r.slice(sheet.name.length + 1))),
    [sources, sheet.name],
  );
  const cell = model.cellAt.get(selected);
  const ref = `${sheet.name}!${selected}`;
  const value = ref in values ? values[ref] : (cell?.value ?? null);
  const numFmt = cell?.style !== undefined ? styles[cell.style].numFmt : undefined;
  const source = sources[ref];

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line bg-white">
      <div className="flex items-center gap-2 border-b border-[#D4D4D4] bg-[#F3F3F3] px-2 py-1 text-[13px]">
        <span className="w-20 rounded border border-[#C6C6C6] bg-white px-1.5 py-0.5 font-mono text-[12px]">{selected}</span>
        <span className="text-[#888]">fx</span>
        <span className="min-w-0 flex-1 truncate rounded border border-[#C6C6C6] bg-white px-1.5 py-0.5 font-mono text-[12px]" title={cell?.formula ?? undefined}>
          {cell?.formula ? `=${cell.formula.replace(/^=/, "")}` : formatCellValue(value, numFmt)}
        </span>
        {cell?.formula && <span className="shrink-0 tabular-nums text-ink-2">= {formatCellValue(value, numFmt) || "(kosong)"}</span>}
        {source && <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[11.5px] text-ink-2 ring-1 ring-line">{SOURCE_LABEL[source] ?? source}</span>}
      </div>
      {!mounted ? (
        <div className="flex-1 p-6 text-[13px] text-ink-3">Memuat lembar kerja…</div>
      ) : (
      <SheetGrid
        sheet={sheet}
        model={model}
        styles={styles}
        values={values}
        editable={EMPTY}
        overridden={koreksi}
        selected={selected}
        editing={null}
        wideEditorCells={EMPTY}
        scoreCells={EMPTY}
        picker={null}
        zoom={100}
        colWidthOverrides={widths}
        onResizeColumn={(col, width) =>
          setWidths((w) => {
            const next = { ...w };
            if (width === null) delete next[col];
            else next[col] = width;
            return next;
          })
        }
        scrollerRef={scroller}
        onGridKeyDown={noop}
        onSelect={setSelected}
        onActivate={noop}
        onCellClick={noop}
        onPick={noop}
        onPickerHighlight={noop}
        onDraftChange={noop}
        onEditorKeyDown={noop}
        onLinkHover={noop}
      />
      )}
      <nav className="flex shrink-0 gap-0.5 overflow-x-auto border-t border-[#D4D4D4] bg-[#F3F3F3] px-2 text-[13px]">
        {tabs.map((t) => (
          <Link
            key={t.name}
            href={t.href}
            className={`whitespace-nowrap px-3 py-1.5 ${t.active ? "border-b-2 border-[#217346] bg-white font-semibold text-[#217346]" : "text-[#444] hover:bg-[#E6E6E6]"}`}
          >
            {t.name.trim()}
          </Link>
        ))}
      </nav>
    </div>
  );
}
