"use client";

import type { ParameterExplanation } from "@/lib/scoreExplain";

const pct = (x: number) => `${(x * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
const num = (x: number) => x.toLocaleString("id-ID", { maximumFractionDigits: 2 });

/**
 * "Kenapa nilainya 4?" while an A2 parameter row is selected: the C2 values
 * the score is based on, the bands, the one that applies, and any pengawas
 * override or known template defect. A card floating over the grid's corner,
 * so showing, hiding or resizing it never moves the grid.
 */
export function ExplainStrip({
  info,
  labelOf,
  onGoTo,
  onClose,
}: {
  info: ParameterExplanation;
  /** The C2 row label for a cell like "D10". */
  labelOf: (cell: string) => string;
  /** Jump to a C2 cell. */
  onGoTo: (cell: string) => void;
  onClose: () => void;
}) {
  const overridden = info.pengawasScore !== info.pjpScore;

  return (
    <div
      className="absolute bottom-3 left-14 z-40 flex max-h-[45%] w-[min(600px,calc(100%-5rem))] flex-col gap-1.5 overflow-y-auto rounded-md border border-[#C7D7EA] bg-[#F7FAFE]/95 px-3 py-2 text-xs text-black shadow-lg backdrop-blur"
      role="note"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-5">
        <button
          onClick={onClose}
          className="absolute right-1.5 top-1 px-1 text-[#666] hover:text-black"
          aria-label="Sembunyikan penjelasan nilai"
          title="Sembunyikan"
        >
          ✕
        </button>
        <span className="font-semibold">
          Kenapa nilainya {info.pjpScore}? <span className="font-normal text-[#666]">(baris {info.row})</span>
        </span>
        {info.manual ? (
          <span className="text-[#444]">Parameter manual: tidak ada data formulir untuk baris ini. Pengawas menentukan nilainya (bawaan 5).</span>
        ) : (
          <>
            <span className="text-[#444]">Berdasarkan</span>
            {info.sources.map((s, i) => (
              <span key={s.cell} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-[#666]">+</span>}
                <button
                  onClick={() => onGoTo(s.cell)}
                  className="rounded border border-[#C7D7EA] bg-white px-1.5 py-px hover:border-[#217346] hover:text-[#217346]"
                  title={`Buka C2!${s.cell}`}
                >
                  {labelOf(s.cell)} <span className="font-mono text-[#666]">({s.cell})</span>{" "}
                  <b>{s.isShare ? pct(s.value) : num(s.value)}</b>
                </button>
              </span>
            ))}
            {info.sources.length > 1 && (
              <span>
                = <b>{info.totalIsShare ? pct(info.total) : num(info.total)}</b>
              </span>
            )}
          </>
        )}
      </div>

      {!info.manual && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[#555]">Aturan:</span>
          {info.bands.map((b) => {
            const hit = b.score === info.pjpScore;
            return (
              <span
                key={b.text}
                className={`rounded px-1.5 py-px ${hit ? "bg-[#217346] font-semibold text-white" : "bg-white text-[#444] ring-1 ring-[#DADADA]"}`}
              >
                {b.text} → {b.score}
              </span>
            );
          })}
        </div>
      )}

      {overridden && (
        <p className="text-[#444]">
          Pengawas mengubah nilai menjadi <b>{info.pengawasScore}</b> (nilai dari data PJP: {info.pjpScore}).
        </p>
      )}
      {info.note && <p className="text-[#7a5200]">⚠ {info.note}</p>}
    </div>
  );
}
