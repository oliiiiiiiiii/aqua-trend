// Shared time geometry: every lane plots the same window with the same gutters, so month k sits
// at the same x in the axis, the strips and the expanded chart.
import { monthAbbr, type Span } from "./model";

/** left gutter (unit ticks in the expanded chart, σ ticks in strips) and right gutter (σ labels) */
export const GUTTER_L = 52;
export const GUTTER_R = 36;

export interface TimeScale {
  /** inner plot width */
  iw: number;
  view: Span;
  /** x of the left edge of month k (k = absolute month index); k + 1 is its right edge */
  x: (k: number) => number;
  /** centre of month k */
  cx: (k: number) => number;
  /** month under an inner-plot x, clamped to the window */
  at: (px: number) => number;
  /** px width of one month */
  step: number;
}

export function timeScale(view: Span, width: number): TimeScale {
  const iw = Math.max(40, width - GUTTER_L - GUTTER_R);
  const n = view.e - view.s + 1;
  const step = iw / n;
  const x = (k: number) => (k - view.s) * step;
  return {
    iw, view, x, step,
    cx: (k) => x(k) + step / 2,
    at: (px) => Math.max(view.s, Math.min(view.e, view.s + Math.floor(px / step))),
  };
}

export interface Tick { at: number; label: string; major: boolean }

/** Month ticks for short windows, year ticks for long ones. `at` is a month-edge position. */
export function timeTicks(t: TimeScale): Tick[] {
  const { view, iw } = t;
  const span = view.e - view.s + 1;
  const maxTicks = Math.max(2, Math.floor(iw / 58));
  const out: Tick[] = [];
  if (span > 48) {
    const yrs = span / 12;
    const step = [1, 2, 5, 10, 20].find((s) => yrs / s <= maxTicks) ?? 20;
    const y0 = Math.ceil(view.s / 12), y1 = Math.floor((view.e + 1) / 12);
    for (let yr = Math.ceil(y0 / step) * step; yr <= y1; yr += step) out.push({ at: yr * 12, label: String(yr), major: true });
    return out;
  }
  const step = [1, 2, 3, 6].find((s) => span / s <= maxTicks) ?? 12;
  for (let k = view.s; k <= view.e; k++) {
    const m = ((k % 12) + 12) % 12;
    if (m % step !== 0) continue;
    // January carries the year; other months sit at their centre
    out.push(m === 0 ? { at: k, label: String(Math.floor(k / 12)), major: true } : { at: k + 0.5, label: monthAbbr(k), major: false });
  }
  return out;
}

/** Missing-month runs (inclusive absolute indices) of a series that starts at absolute month `base`. */
export function gapRuns(values: (number | null)[], base: number, view: Span): Span[] {
  const runs: Span[] = [];
  let s = -1;
  const lo = Math.max(0, view.s - base), hi = Math.min(values.length - 1, view.e - base);
  for (let i = lo; i <= hi + 1; i++) {
    const miss = i <= hi && !isNum(values[i]);
    if (miss && s < 0) s = i;
    if (!miss && s >= 0) { runs.push({ s: s + base, e: i - 1 + base }); s = -1; }
  }
  return runs;
}

export const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Bars from y0 to each value as one SVG path (fast enough to redraw on every pointer move). */
export function barsPath(
  t: TimeScale, values: (number | null)[], base: number, y: (v: number) => number, y0: number, keep: (v: number) => boolean,
): string {
  const gap = t.step > 5 ? 1 : t.step > 2.5 ? 0.5 : 0;
  const w = Math.max(0.75, t.step - gap);
  let d = "";
  const lo = Math.max(0, t.view.s - base), hi = Math.min(values.length - 1, t.view.e - base);
  for (let i = lo; i <= hi; i++) {
    const v = values[i];
    if (!isNum(v) || !keep(v)) continue;
    const xl = t.x(i + base) + gap / 2;
    let top = Math.min(y0, y(v)), h = Math.abs(y(v) - y0);
    if (h < 0.75) { h = 0.75; top = v >= 0 ? y0 - 0.75 : y0; }
    d += `M${xl.toFixed(2)} ${top.toFixed(2)}h${w.toFixed(2)}v${h.toFixed(2)}h${(-w).toFixed(2)}Z`;
  }
  return d;
}

/** Line through observed months; breaks at missing months (never bridged). */
export function linePath(t: TimeScale, values: (number | null)[], base: number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  const lo = Math.max(0, t.view.s - base - 1), hi = Math.min(values.length - 1, t.view.e - base + 1);
  for (let i = lo; i <= hi; i++) {
    const v = values[i];
    if (!isNum(v)) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${t.cx(i + base).toFixed(2)} ${y(v).toFixed(2)}`;
    pen = true;
  }
  return d;
}
