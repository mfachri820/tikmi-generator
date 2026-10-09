import Link from "next/link";
import { ChevronRightIcon } from "./icons";

export const PAGE_SIZE = 20;

/** Page numbers to show: all of them when few, else first, last and the current one's neighbours with gaps. */
function pageItems(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const keep = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const sorted = [...keep].sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) items.push("gap");
    items.push(p);
  });
  return items;
}

/**
 * "Menampilkan 21–40 dari 85" plus previous / page numbers / next. Works both
 * as links (`hrefFor`, for server-rendered tables: the page lives in the URL)
 * and as buttons (`onChange`, for tables filtered in the browser).
 */
export function Pagination({
  page,
  total,
  pageSize = PAGE_SIZE,
  hrefFor,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  hrefFor?: (page: number) => string;
  onChange?: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const control = (target: number, content: React.ReactNode, opts: { active?: boolean; disabled?: boolean; label?: string } = {}) => {
    const cls = `inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-md px-2.5 text-[13.5px] transition ${
      opts.active
        ? "bg-brand font-medium text-white"
        : opts.disabled
          ? "cursor-default text-line-strong"
          : "text-ink-2 hover:bg-plane hover:text-ink"
    }`;
    if (opts.disabled || opts.active) {
      return (
        <span className={cls} aria-current={opts.active ? "page" : undefined} aria-disabled={opts.disabled || undefined}>
          {content}
        </span>
      );
    }
    return hrefFor ? (
      <Link href={hrefFor(target)} scroll={false} className={cls} aria-label={opts.label}>
        {content}
      </Link>
    ) : (
      <button type="button" onClick={() => onChange?.(target)} className={cls} aria-label={opts.label}>
        {content}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
      <p className="text-[13.5px] text-ink-2">
        Menampilkan <span className="font-medium text-ink">{from}–{to}</span> dari {total}
      </p>
      {pageCount > 1 && (
        <nav className="flex items-center gap-0.5" aria-label="Halaman">
          {control(page - 1, <><ChevronRightIcon className="rotate-180 text-[14px]" /> Sebelumnya</>, { disabled: page === 1, label: "Halaman sebelumnya" })}
          {pageItems(page, pageCount).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="px-1 text-ink-3">…</span>
            ) : (
              <span key={p}>{control(p, p, { active: p === page, label: `Halaman ${p}` })}</span>
            ),
          )}
          {control(page + 1, <>Berikutnya <ChevronRightIcon className="text-[14px]" /></>, { disabled: page === pageCount, label: "Halaman berikutnya" })}
        </nav>
      )}
    </div>
  );
}
