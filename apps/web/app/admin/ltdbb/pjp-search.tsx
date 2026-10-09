"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "@/components/icons";

/** Filters the per-PJP table as you type, through `?q=` so the result survives a refresh or a shared link. */
export function PjpSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(initial);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      const q = query.trim();
      if (q) next.set("q", q);
      else next.delete("q");
      next.delete("page");
      router.replace(`${pathname}?${next}`, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only typing should trigger a navigation
  }, [query]);

  return (
    <label className="relative w-full sm:w-64">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-ink-3" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cari sandi atau nama PJP"
        className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-[13px] outline-none transition placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}
