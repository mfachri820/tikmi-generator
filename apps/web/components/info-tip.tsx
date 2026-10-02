"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const WIDTH = 288;
const GAP = 6;
const MARGIN = 8;

/**
 * A small "i" next to a label that explains it: opens on hover, keyboard
 * focus or tap (a tap pins it open until the next tap, Esc or a click
 * elsewhere). The bubble is portalled to <body> with fixed positioning so
 * scrolling tables and the grid's status bar can't clip it.
 */
export function InfoTip({
  children,
  label = "Penjelasan",
  onDark = false,
}: {
  children: ReactNode;
  /** Accessible name of the button, e.g. the term it explains. */
  label?: string;
  /** For use on the green title/status bars. */
  onDark?: boolean;
}) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const open = hovered || pinned;

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
      const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, MARGIN), window.innerWidth - width - MARGIN);
      // Open toward the side with more room: up from the status bar, down from headings.
      setPos(
        r.top > window.innerHeight / 2
          ? { left, bottom: window.innerHeight - r.top + GAP }
          : { left, top: r.bottom + GAP },
      );
    };
    place();
    const close = () => {
      setHovered(false);
      setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: MouseEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => {
          setHovered(false);
          setPinned(false);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          // Inside clickable rows and sort headers: explain, don't trigger the parent.
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        className={`ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full align-[-2px] font-serif text-[10px] font-bold normal-case italic leading-none tracking-normal outline-none focus-visible:ring-2 ${
          onDark
            ? "border border-white/70 text-white/90 hover:bg-white/20 focus-visible:ring-white"
            : "border border-zinc-400 text-zinc-500 hover:border-[#217346] hover:text-[#217346] focus-visible:ring-[#217346]"
        }`}
      >
        i
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[100] rounded-md bg-zinc-900 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg"
            style={{ width: Math.min(WIDTH, window.innerWidth - 2 * MARGIN), ...pos }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
