"use client";

import { useState } from "react";
import type { DocLink } from "@/lib/driveLinks";

const EXCEL_GREEN = "#217346";
export const DOC_PANEL_MIN = 280;
const DOC_PANEL_MAX_SHARE = 0.7;

/**
 * The document beside the grid: a supporting-document link from the selected
 * cell, shown in Drive's own viewer. It follows the selection to other link
 * cells and stays put on cells without one, so the score next to it can be
 * checked against the document.
 */
export function DocPanel({
  links,
  index,
  cellLabel,
  title,
  width,
  onIndex,
  onResize,
  onClose,
}: {
  links: DocLink[];
  index: number;
  /** e.g. "I10 · B. KPMR 2025" */
  cellLabel: string;
  /** The row's question text, when the row has one. */
  title?: string;
  width: number;
  onIndex: (index: number) => void;
  /** A finished drag of the panel's edge. */
  onResize: (width: number) => void;
  onClose: () => void;
}) {
  const [drag, setDrag] = useState<{ startX: number; startWidth: number; width: number } | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const link = links[Math.min(index, links.length - 1)];
  const shownWidth = drag?.width ?? width;

  const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, DOC_PANEL_MIN), window.innerWidth * DOC_PANEL_MAX_SHARE));

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-[#C6C6C6] bg-[#F3F3F3]"
      style={{ width: shownWidth }}
      aria-label="Pratinjau dokumen"
    >
      {/* Left edge: drag to resize. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ubah lebar panel dokumen"
        title="Seret untuk mengubah lebar panel"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ startX: e.clientX, startWidth: width, width });
        }}
        onPointerMove={(e) => {
          if (drag) setDrag({ ...drag, width: clampWidth(drag.startWidth - (e.clientX - drag.startX)) });
        }}
        onPointerUp={() => {
          if (!drag) return;
          onResize(drag.width);
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
        className="absolute -left-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize hover:bg-[#217346]/40"
        style={drag ? { backgroundColor: EXCEL_GREEN } : undefined}
      />
      {/* While dragging, keep the pointer away from the iframe, which would otherwise swallow the moves. */}
      {drag && <div className="fixed inset-0 z-10 cursor-col-resize" />}

      <header className="flex shrink-0 items-start gap-2 border-b border-[#D4D4D4] bg-white px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-[#555]">Dokumen · {cellLabel}</p>
          {title && (
            <p className="mt-0.5 line-clamp-2 text-xs font-medium text-black" title={title}>
              {title}
            </p>
          )}
        </div>
        {links.length > 1 && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-[#444]">
            <button
              onClick={() => onIndex((index - 1 + links.length) % links.length)}
              className="rounded px-1.5 py-0.5 hover:bg-[#E6E6E6]"
              aria-label="File sebelumnya"
            >
              ‹
            </button>
            <span className="tabular-nums">
              {index + 1} / {links.length}
            </span>
            <button
              onClick={() => onIndex((index + 1) % links.length)}
              className="rounded px-1.5 py-0.5 hover:bg-[#E6E6E6]"
              aria-label="File berikutnya"
            >
              ›
            </button>
          </span>
        )}
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded border border-[#C6C6C6] px-2 py-0.5 text-xs text-[#217346] hover:bg-[#F3F3F3]"
          title="Buka di tab baru"
        >
          Tab baru ↗
        </a>
        <button
          onClick={onClose}
          className="shrink-0 rounded px-1.5 py-0.5 text-[#555] hover:bg-[#E6E6E6] hover:text-black"
          aria-label="Tutup panel dokumen (Esc)"
          title="Tutup (Esc)"
        >
          ✕
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        {link.previewUrl ? (
          <>
            {loadedUrl !== link.previewUrl && (
              <p className="absolute inset-x-0 top-6 text-center text-xs text-[#666]">Memuat dokumen…</p>
            )}
            <iframe
              key={link.previewUrl}
              src={link.previewUrl}
              title={`Dokumen ${cellLabel}`}
              onLoad={() => setLoadedUrl(link.previewUrl)}
              className="relative h-full w-full border-0 bg-transparent"
              allow="autoplay; fullscreen"
            />
          </>
        ) : (
          <div className="p-6 text-center text-xs text-[#555]">
            Tautan ini tidak bisa ditampilkan di panel.
            <a href={link.url} target="_blank" rel="noreferrer" className="mt-2 block font-medium text-[#217346] underline">
              Buka di tab baru
            </a>
          </div>
        )}
      </div>
      <p className="shrink-0 border-t border-[#D4D4D4] bg-white px-3 py-1.5 text-[11px] leading-snug text-[#666]">
        Tidak tampil? Akun Google Anda perlu akses ke file ini — gunakan &ldquo;Tab baru&rdquo;.
      </p>
    </aside>
  );
}

/** A peek at a link cell's document while the cursor rests on it: the first file's first page. */
export function DocHoverCard({ links, rect }: { links: DocLink[]; rect: DOMRect }) {
  const [thumb, setThumb] = useState<"loading" | "ok" | "error">("loading");
  const width = 260;
  const link = links[0];
  // Below the cell, or above it when there's no room; never past the window's right edge.
  const below = rect.bottom + 230 < window.innerHeight;
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[90] overflow-hidden rounded-md border border-[#C6C6C6] bg-white text-xs text-black shadow-lg"
      style={{ width, left, ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }) }}
    >
      <div className="flex h-40 items-center justify-center bg-[#F3F3F3]">
        {link.thumbnailUrl && thumb !== "error" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Drive thumbnail, loaded with the viewer's own Google session
          <img
            src={link.thumbnailUrl}
            alt=""
            referrerPolicy="no-referrer"
            onLoad={() => setThumb("ok")}
            onError={() => setThumb("error")}
            className={`max-h-full max-w-full object-contain ${thumb === "ok" ? "" : "hidden"}`}
          />
        ) : null}
        {(thumb === "loading" && link.thumbnailUrl) ? (
          <span className="text-[#888]">Memuat pratinjau…</span>
        ) : thumb === "error" || !link.thumbnailUrl ? (
          <span className="px-4 text-center text-[#888]">Pratinjau tidak tersedia</span>
        ) : null}
      </div>
      <p className="border-t border-[#E1E1E1] px-2.5 py-1.5 text-[#555]">
        {links.length > 1 ? `${links.length} file · ` : ""}Klik untuk buka di panel · Ctrl+klik: tab baru
      </p>
    </div>
  );
}
