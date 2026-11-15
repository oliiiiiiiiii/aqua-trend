"use client";
// Small shared pieces: the verdict mark, the hypothesis chip, the anomaly legend.
import type { IntervalDetail } from "@/lib/detective/intervalDetail";
import { COPY } from "./copy";
import { hypothesis, verdictView } from "./model";
import { anomalyColor } from "./types";

/** ● ◐ ○ – (drawn, so every font shows the same shape) with its meaning in title and for screen readers; colour only when significant. */
export function VerdictMark({ d, polarity, className = "", size = 11 }: { d: IntervalDetail | null; polarity: "cool" | "warm"; className?: string; size?: number }) {
  const v = verdictView(d);
  const color = v.emphasis && d?.direction ? anomalyColor(d.direction === "high", polarity) : "var(--ink-2)";
  const r = size / 2 - 1;
  const c = size / 2;
  return (
    <span title={v.title} className={`inline-flex items-center ${className}`}>
      <svg width={size} height={size} aria-hidden="true" className="shrink-0">
        {v.mark === "●" && <circle cx={c} cy={c} r={r} style={{ fill: color }} />}
        {v.mark === "◐" && (
          <>
            <circle cx={c} cy={c} r={r - 0.25} fill="none" strokeWidth={1.5} style={{ stroke: color }} />
            <path d={`M${c} ${c - r}A${r} ${r} 0 0 0 ${c} ${c + r}Z`} style={{ fill: color }} />
          </>
        )}
        {v.mark === "○" && <circle cx={c} cy={c} r={r - 0.25} fill="none" strokeWidth={1.5} style={{ stroke: color }} />}
        {v.mark === "–" && <line x1={c - r} x2={c + r} y1={c} y2={c} strokeWidth={1.5} style={{ stroke: color }} />}
      </svg>
      <span className="sr-only">{v.title}</span>
    </span>
  );
}

export function HypothesisChip({ expected, d }: { expected?: "high" | "low"; d: IntervalDetail | null }) {
  const h = hypothesis(expected, d);
  if (!h) return null;
  return (
    <span
      title={COPY.expected.title(h.dir, h.state)}
      className={`inline-flex items-center gap-0.5 rounded-ctl px-1.5 text-xs leading-5 font-semibold whitespace-nowrap ${h.state === "yes" ? "bg-real-bg text-real" : h.state === "no" ? "bg-synthetic-bg text-synthetic" : "bg-paper text-ink-2 ring-1 ring-line"}`}
    >
      <span aria-hidden="true">{h.state === "yes" ? "✓" : h.state === "no" ? "✗" : "~"}</span>
      <span className="sr-only">{COPY.expected.title(h.dir, h.state)}</span>
      <span aria-hidden="true">{h.dir === "high" ? "↑" : "↓"}</span>
    </span>
  );
}

/** "above normal / below normal" swatches in the variable's polarity */
export function AnomalyLegend({ polarity, arbitrary }: { polarity: "cool" | "warm"; arbitrary: boolean }) {
  const sw = (positive: boolean) => (
    <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: anomalyColor(positive, polarity) }} />
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-1.5">{sw(true)}{COPY.chart.aboveNormal}</span>
      <span className="inline-flex items-center gap-1.5">{sw(false)}{COPY.chart.belowNormal}</span>
      {arbitrary && <span className="text-ink-3">{COPY.chart.arbitrary}</span>}
    </span>
  );
}
