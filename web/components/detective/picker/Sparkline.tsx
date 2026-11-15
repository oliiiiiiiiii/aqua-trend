// A small anomaly chart for the variable dropdown: monthly z (σ) over the current window on a symmetric scale that
// every option shares, ±2σ hairlines, the event band and the selection. Bars wear the polarity colours
// (--viz-cool / --viz-warm), never the variable's identity colour. Values beyond the scale are clipped at the edge.
//
// The SVG is drawn in a fixed 160 × h coordinate box and stretched to its container's width
// (preserveAspectRatio="none", non-scaling strokes), so every sparkline in a list shares one time axis.
import type { Span } from "../workbench/model";
import { anomalyColor } from "../workbench/types";

export const SPARK_W = 160;
export const SPARK_H = 28;
/** default half-height of the σ scale (±3σ); bars beyond it are clipped and capped with a dark tick */
export const SPARK_SCALE = 3;

export interface SparklineProps {
  /** monthly z scores (Decomposition.z) */
  z: (number | null)[];
  /** absolute month index (ymIndex) of z[0] */
  base: number;
  /** months shown, inclusive absolute indices; the same for every sparkline in a list */
  view: Span;
  event: Span;
  /** the shared selection; null hides it */
  sel?: Span | null;
  polarity: "cool" | "warm";
  /** half-height of the σ scale (e.g. 3 = ±3σ); share one value across a list */
  scale?: number;
  height?: number;
  className?: string;
}

const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** a shared symmetric scale for several series: max(3, largest |z| in the view), capped at 5 */
export function sharedScale(series: { z: (number | null)[]; base: number }[], view: Span): number {
  let m = 3;
  for (const s of series) {
    const lo = Math.max(0, view.s - s.base), hi = Math.min(s.z.length - 1, view.e - s.base);
    for (let i = lo; i <= hi; i++) { const v = s.z[i]; if (isNum(v)) m = Math.max(m, Math.abs(v)); }
  }
  return Math.min(5, Math.ceil(m));
}

export default function Sparkline({ z, base, view, event, sel, polarity, scale = SPARK_SCALE, height = SPARK_H, className = "" }: SparklineProps) {
  const W = SPARK_W, h = height, mid = h / 2, half = h / 2 - 1.5;
  const n = Math.max(1, view.e - view.s + 1);
  const step = W / n;
  const x = (k: number) => (k - view.s) * step;
  const y = (v: number) => mid - (Math.max(-scale, Math.min(scale, v)) / scale) * half;
  const gap = step > 4 ? 0.6 : 0;
  const bw = Math.max(0.6, step - gap);

  let pos = "", neg = "", miss = "", caps = "";
  const lo = Math.max(0, view.s - base), hi = Math.min(z.length - 1, view.e - base);
  for (let k = view.s; k <= view.e; k++) {
    const i = k - base;
    const v = i >= lo && i <= hi ? z[i] : undefined;
    const xl = x(k) + gap / 2;
    if (v === undefined) continue; // outside the record: blank
    if (!isNum(v)) { miss += `M${xl.toFixed(2)} 0h${bw.toFixed(2)}v${h}h${(-bw).toFixed(2)}Z`; continue; }
    let top = Math.min(mid, y(v)), bh = Math.abs(y(v) - mid);
    if (bh < 0.75) { bh = 0.75; top = v >= 0 ? mid - 0.75 : mid; }
    const d = `M${xl.toFixed(2)} ${top.toFixed(2)}h${bw.toFixed(2)}v${bh.toFixed(2)}h${(-bw).toFixed(2)}Z`;
    if (v >= 0) pos += d; else neg += d;
    if (Math.abs(v) > scale) caps += `M${xl.toFixed(2)} ${(v > 0 ? 0 : h - 1.5).toFixed(2)}h${bw.toFixed(2)}v1.5h${(-bw).toFixed(2)}Z`;
  }

  const band = (s: Span) => {
    const x0 = Math.max(0, x(s.s)), x1 = Math.min(W, x(s.e + 1));
    return x1 > x0 ? { x: x0, width: x1 - x0 } : null;
  };
  const ev = band(event);
  const sb = sel ? band(sel) : null;
  const g2 = scale >= 2 ? [y(2), y(-2)] : [];

  return (
    <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" aria-hidden="true" className={`block h-[28px] w-full overflow-visible ${className}`} style={{ height: h }}>
      {ev && (
        <g>
          <rect x={ev.x} width={ev.width} y={0} height={h} style={{ fill: "var(--action)", opacity: "var(--event-band-opacity)" }} />
          <rect x={ev.x} width={ev.width} y={0} height={1.5} style={{ fill: "var(--action)" }} />
        </g>
      )}
      {miss && <path d={miss} style={{ fill: "var(--ink)", opacity: 0.08 }} />}
      {g2.map((gy, i) => (
        <line key={i} x1={0} x2={W} y1={gy} y2={gy} strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" style={{ stroke: "var(--ink-3)", opacity: 0.55 }} />
      ))}
      <line x1={0} x2={W} y1={mid} y2={mid} strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--viz-axis)" }} />
      {pos && <path d={pos} style={{ fill: anomalyColor(true, polarity) }} />}
      {neg && <path d={neg} style={{ fill: anomalyColor(false, polarity) }} />}
      {caps && <path d={caps} style={{ fill: "var(--ink)" }} />}
      {sb && (
        <rect x={sb.x} width={sb.width} y={0.5} height={h - 1} fill="none" strokeWidth={1.25} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--focus)" }} />
      )}
    </svg>
  );
}
