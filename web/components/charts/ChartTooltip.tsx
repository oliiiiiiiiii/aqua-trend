"use client";
import type { ReactNode } from "react";

/** Floating read-out inside a chart wrapper (which must be position: relative). Never takes pointer events. */
export function ChartTooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const flip = x > width * 0.55;
  const availableWidth = Math.max(0, flip ? x - 12 : width - x - 12);
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute top-2 z-10 w-max rounded-ctl border border-line bg-paper px-3 py-2 text-[0.8125rem] leading-snug text-ink shadow-card"
      style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, maxWidth: `min(17rem, ${availableWidth}px)`, borderRadius: "min(var(--r-ctl), 10px)" }}
    >
      {children}
    </div>
  );
}

/** One tooltip row keyed with a short stroke in the series colour; value leads, label follows. */
export function TipRow({ color, value, label, dashed }: { color?: string; value: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      {color ? (
        <svg width="14" height="8" aria-hidden="true" className="shrink-0 translate-y-px">
          <line x1="0" x2="14" y1="4" y2="4" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} style={{ stroke: `var(${color})` }} />
        </svg>
      ) : null}
      <span className="tnum whitespace-nowrap font-semibold">{value}</span>
      <span className="text-ink-2">{label}</span>
    </div>
  );
}
