"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Same-tab writers notify through this; other tabs through the `storage` event. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Used when localStorage is blocked (some private windows): settings then last until the page closes. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/**
 * A per-browser view preference (zoom, column widths, formula bar height),
 * kept in localStorage. The server render and the first client render use
 * `initial`, so there's no hydration mismatch; the saved value follows.
 * `initial` should be a constant (it isn't a dependency).
 */
export function usePersistentState<T>(key: string, initial: T) {
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const value = useMemo(() => {
    if (raw === null) return initial;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is a constant default
  }, [raw]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      let prev = initial;
      const current = read(key);
      if (current !== null) {
        try {
          prev = JSON.parse(current) as T;
        } catch {}
      }
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      write(key, JSON.stringify(resolved));
      for (const l of listeners) l();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is a constant default
    [key],
  );

  return [value, set] as const;
}
