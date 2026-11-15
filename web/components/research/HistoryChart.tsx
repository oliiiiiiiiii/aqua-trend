"use client";
// Full-history time series for the research page (spec §9): one series, one y-axis in the variable's own unit.
// - the values and the fitted line are the backend's arrays, drawn as they are (no fitting in the browser);
// - null is a break in the line and a shaded band, never zero;
// - the ANALYSIS period is a marked band; the VIEW range is the x-domain; the CURSOR is a shared read-out
//   position; the BRUSH is a pending selection that only becomes an analysis period through a new request.
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { ChartTooltip, TipRow } from "@/components/charts/ChartTooltip";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { fixed, indexYm, isYm, timeLabel, timeX, ymIndex } from "@/lib/research/format";
import type { Period } from "@/lib/research/types";

export interface HistoryChartProps {
  /** "YYYY-MM" (monthly) or "YYYY" (annual), strictly increasing */
  times: string[];
  values: (number | null)[];
  /** fitted line aligned to `times`, null outside the analysis period */
  fit?: (number | null)[] | null;
  unit: string;
  /** what the series is, for the tooltip and the accessible name */
  seriesName: string;
  /** CSS custom property of the series colour */
  color?: string;
  mark?: "line" | "bar";
  /** the period the backend fitted; drawn as a band */
  analysis: Period | null;
  /** visible x-range in fractional years; null = the whole series */
  view: [number, number] | null;
  /** shared cursor ("YYYY-MM" or "YYYY"), null when nothing is inspected */
  cursor: string | null;
  onCursor: (t: string | null) => void;
  /** pending selection; shown when set */
  brush?: Period | null;
  /** present = dragging on the plot selects a month range */
  onBrush?: (p: Period | null) => void;
  decimals: number;
  /** draw and include the zero line (anomalies, indices) */
  zeroLine?: boolean;
  label: string;
  height?: number;
}

const M = { top: 22, right: 12, bottom: 26 };
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const monthStartX = (ym: string) => Number(ym.slice(0, 4)) + (Number(ym.slice(5, 7)) - 1) / 12;
const monthEndX = (ym: string) => Number(ym.slice(0, 4)) + Number(ym.slice(5, 7)) / 12;
/** [x0, x1] covered by a period of months (also valid on an annual axis) */
const periodSpan = (p: Period): [number, number] => [
  isYm(p.start) ? monthStartX(p.start) : Number(p.start),
  isYm(p.end) ? monthEndX(p.end) : Number(p.end) + 1,
];

export default function HistoryChart(p: HistoryChartProps) {
  const { times, values, fit, unit, analysis, cursor } = p;
  const color = p.color ?? "--viz-blue";
  const mark = p.mark ?? "line";
  const height = p.height ?? 220;
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const clipId = useId();
  const [inside, setInside] = useState(false);
  const [focused, setFocused] = useState(false);
  const drag = useRef<{ x0: number; t0: number; moved: boolean } | null>(null);

  const n = times.length;
  const annual = n > 0 && !isYm(times[0]);
  const xs = useMemo(() => times.map(timeX), [times]);
  const half = annual ? 0.5 : 0.5 / 12;
  const full: [number, number] = n ? [xs[0] - half, xs[n - 1] + half] : [0, 1];
  const domain: [number, number] = p.view ? [Math.max(full[0], p.view[0]), Math.min(full[1], p.view[1])] : full;
  const d0 = domain[0], d1 = domain[1] > domain[0] ? domain[1] : domain[0] + 1;
  const visible = (i: number) => xs[i] >= d0 && xs[i] <= d1;

  const yInfo = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    const take = (v: number | null | undefined) => {
      if (v != null && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    };
    for (let i = 0; i < n; i++) {
      if (xs[i] < d0 || xs[i] > d1) continue;
      take(values[i]);
      if (fit) take(fit[i]);
    }
    if (p.zeroLine || mark === "bar") take(0);
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.06;
    return { lo: lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi: hi + pad };
  }, [n, xs, values, fit, d0, d1, p.zeroLine, mark]);

  const ih = Math.max(10, height - M.top - M.bottom);
  const y = useMemo(() => scaleLinear().domain([yInfo.lo, yInfo.hi]).range([ih, 0]).nice(5), [yInfo, ih]);
  const yTicks = y.ticks(5);
  const step = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
  const yDec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const yLabels = yTicks.map((t) => fixed(t, yDec));
  const left = Math.ceil(Math.max(1, ...yLabels.map((s) => s.length)) * 6.6) + 14;
  const iw = Math.max(40, width - left - M.right);
  const x = useMemo(() => scaleLinear().domain([d0, d1]).range([0, iw]), [d0, d1, iw]);
  const crossesZero = y.domain()[0] < 0 && y.domain()[1] > 0;

  const span = d1 - d0;
  const tickStep = [1, 2, 5, 10, 20, 50].find((s) => span / s <= (iw < 420 ? 5 : 9)) ?? 100;
  const xTicks: number[] = [];
  for (let t = Math.ceil(d0 / tickStep) * tickStep; t <= d1; t += tickStep) xTicks.push(t);

  const idx = useMemo(() => Array.from({ length: n }, (_, i) => i), [n]);
  const valuePath = useMemo(() => {
    if (mark !== "line") return "";
    return line<number>().defined((i) => values[i] != null).x((i) => x(xs[i])).y((i) => y(values[i] as number))(idx) ?? "";
  }, [mark, values, x, xs, y, idx]);
  const fitPath = useMemo(() => {
    if (!fit) return "";
    return line<number>().defined((i) => fit[i] != null).x((i) => x(xs[i])).y((i) => y(fit[i] as number))(idx) ?? "";
  }, [fit, x, xs, y, idx]);
  /** valid points with no valid neighbour: a line would not show them */
  const isolated = useMemo(() => {
    if (mark !== "line") return [] as number[];
    return idx.filter((i) => values[i] != null && values[i - 1] == null && values[i + 1] == null);
  }, [mark, idx, values]);
  /** runs of missing values as [first, last] */
  const gaps = useMemo(() => {
    const runs: [number, number][] = [];
    let s = -1;
    for (let i = 0; i <= n; i++) {
      const miss = i < n && values[i] == null;
      if (miss && s < 0) s = i;
      if (!miss && s >= 0) { runs.push([s, i - 1]); s = -1; }
    }
    return runs;
  }, [n, values]);

  const lookup = useMemo(() => new Map(times.map((t, i) => [t, i])), [times]);
  const cursorIndex = cursor == null ? null : lookup.get(cursor) ?? lookup.get(cursor.slice(0, 4)) ?? null;
  const shownCursor = cursorIndex != null && visible(cursorIndex) ? cursorIndex : null;

  const nearest = (t: number): number => {
    let best = 0, dist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xs[i] - t);
      if (d < dist && visible(i)) { dist = d; best = i; }
    }
    return best;
  };
  const tOf = (e: PointerEvent): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    return x.invert(clamp(e.clientX - rect.left - left, 0, iw));
  };
  /** month that contains fractional year t */
  const monthAt = (t: number) => indexYm(Math.floor(t * 12 + 1e-9));
  const brushBetween = (a: number, b: number): Period => {
    const lo = clamp(Math.min(a, b), full[0], full[1] - 1e-6), hi = clamp(Math.max(a, b), full[0], full[1] - 1e-6);
    return { start: monthAt(lo), end: monthAt(hi) };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!n) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { x0: e.clientX, t0: tOf(e), moved: false };
    p.onCursor(times[nearest(tOf(e))]);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!n) return;
    const t = tOf(e);
    p.onCursor(times[nearest(t)]);
    const d = drag.current;
    if (d && p.onBrush) {
      if (!d.moved && Math.abs(e.clientX - d.x0) > 4) d.moved = true;
      if (d.moved) p.onBrush(brushBetween(d.t0, t));
    }
  };
  const endDrag = (e: PointerEvent) => {
    drag.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!n) return;
    const first = idx.find(visible) ?? 0;
    const last = [...idx].reverse().find(visible) ?? n - 1;
    const at = shownCursor ?? first;
    const jump = annual ? 1 : 12;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = at - (e.shiftKey ? jump : 1);
    else if (e.key === "ArrowRight") next = at + (e.shiftKey ? jump : 1);
    else if (e.key === "Home") next = first;
    else if (e.key === "End") next = last;
    else if (p.onBrush && !annual && (e.key === "[" || e.key === "]")) {
      const here = times[at];
      const cur = p.brush ?? { start: here, end: here };
      const nextBrush = e.key === "[" ? { start: here, end: cur.end } : { start: cur.start, end: here };
      p.onBrush(ymIndex(nextBrush.start) <= ymIndex(nextBrush.end) ? nextBrush : { start: here, end: here });
      e.preventDefault();
      return;
    } else if (p.onBrush && e.key === "Escape" && p.brush) {
      p.onBrush(null);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    p.onCursor(times[clamp(next, first, last)]);
  };

  const band = (span_: [number, number]) => {
    const a = clamp(span_[0], d0, d1), b = clamp(span_[1], d0, d1);
    return b > a ? { x: x(a), w: Math.max(1, x(b) - x(a)) } : null;
  };
  const analysisBand = analysis ? band(periodSpan(analysis)) : null;
  const brushBand = p.brush ? band(periodSpan(p.brush)) : null;
  const barW = mark === "bar" && n > 1 ? clamp((x(xs[1]) - x(xs[0])) * 0.6, 2, 24) : 12;

  const tip = (inside || focused) && shownCursor != null ? shownCursor : null;
  const surface = "var(--paper)";
  const axisText = { fill: "var(--ink-2)", fontSize: 11 } as const;
  const insideAnalysis = (i: number) => {
    if (!analysis) return false;
    const [a, b] = periodSpan(analysis);
    return xs[i] >= a && xs[i] <= b;
  };
  const cursorText = shownCursor == null
    ? "No month selected"
    : `${timeLabel(times[shownCursor])}: ${values[shownCursor] == null ? "missing" : `${fixed(values[shownCursor], p.decimals)} ${unit}`}`;

  let tipNode: ReactNode = null;
  if (tip != null) {
    const v = values[tip], f = fit?.[tip];
    tipNode = (
      <>
        <div className="font-semibold">{timeLabel(times[tip])}</div>
        <TipRow color={color} value={v == null ? "Missing" : `${fixed(v, p.decimals)} ${unit}`} label={v == null ? "no value, not zero" : p.seriesName} />
        {f != null && <TipRow color="--ink" value={`${fixed(f, p.decimals)} ${unit}`} label="fitted line" />}
        {analysis && <div className="text-ink-2">{insideAnalysis(tip) ? "Inside the analysis period" : "Outside the analysis period"}</div>}
      </>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="relative select-none outline-offset-2"
      style={{ height, touchAction: "pan-y", borderRadius: "min(var(--r-ctl), 8px)" }}
      tabIndex={0}
      role="slider"
      aria-label={p.label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, n - 1)}
      aria-valuenow={shownCursor ?? 0}
      aria-valuetext={cursorText}
      onFocus={(e) => { if (e.target === e.currentTarget) setFocused(true); }}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
    >
      {width > 0 && (
        <svg ref={svgRef} width={width} height={height} aria-hidden="true" className="block overflow-visible" style={{ touchAction: "pan-y" }}>
          <defs>
            <clipPath id={clipId}><rect x={0} y={-4} width={iw} height={ih + 8} /></clipPath>
          </defs>
          <g transform={`translate(${left},${M.top})`}>
            {yTicks.map((t, k) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: "var(--viz-grid)" }} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{yLabels[k]}</text>
              </g>
            ))}
            <line x1={0} x2={iw} y1={ih} y2={ih} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
            {xTicks.map((t) => (
              <g key={t} transform={`translate(${x(t)},${ih})`}>
                <line y2={4} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
                <text y={17} textAnchor="middle" className="tnum" style={axisText}>{t}</text>
              </g>
            ))}
            <text x={-left} y={-10} style={axisText}>{unit}</text>

            {/* analysis period: the only window the fit used */}
            {analysisBand && (
              <g data-testid="analysis-band">
                <rect x={analysisBand.x} width={analysisBand.w} y={0} height={ih} style={{ fill: "var(--action)", opacity: 0.16 }} />
                <line x1={analysisBand.x} x2={analysisBand.x} y1={-4} y2={ih} strokeWidth={1.5} style={{ stroke: "var(--ink-2)" }} />
                <line x1={analysisBand.x + analysisBand.w} x2={analysisBand.x + analysisBand.w} y1={-4} y2={ih} strokeWidth={1.5} style={{ stroke: "var(--ink-2)" }} />
                {analysisBand.w > 96 && (
                  <text x={analysisBand.x + analysisBand.w / 2} y={-10} textAnchor="middle" style={{ ...axisText, fill: "var(--ink)", fontWeight: 600 }}>Analysis period</text>
                )}
              </g>
            )}

            <g clipPath={`url(#${clipId})`}>
              {/* missing values: shaded, never drawn as a number */}
              {gaps.map(([a, b]) => {
                const g = band([xs[a] - half, xs[b] + half]);
                return g ? <rect key={a} x={g.x} width={Math.max(2, g.w)} y={0} height={ih} style={{ fill: "var(--ink)", opacity: 0.09 }} /> : null;
              })}
              {crossesZero && <line x1={0} x2={iw} y1={y(0)} y2={y(0)} strokeWidth={1.25} style={{ stroke: "var(--ink-3)" }} />}

              {mark === "line" ? (
                <>
                  <path d={valuePath} fill="none" strokeWidth={annual ? 2 : 1.4} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: `var(${color})` }} />
                  {isolated.map((i) => <circle key={i} cx={x(xs[i])} cy={y(values[i] as number)} r={2.5} style={{ fill: `var(${color})` }} />)}
                  {annual && idx.map((i) => values[i] != null ? <circle key={i} cx={x(xs[i])} cy={y(values[i] as number)} r={4} strokeWidth={2} style={{ fill: `var(${color})`, stroke: surface }} /> : null)}
                </>
              ) : (
                idx.map((i) => {
                  const v = values[i];
                  if (v == null) return null;
                  const y0 = y(0), y1 = y(v);
                  // a true zero keeps a visible tick on the baseline so it is not mistaken for a missing year
                  return <rect key={i} x={x(xs[i]) - barW / 2} width={barW} y={Math.min(y0, y1) - (v === 0 ? 1.5 : 0)} height={Math.max(v === 0 ? 3 : 1, Math.abs(y0 - y1))} rx={Math.min(3, barW / 2)} style={{ fill: `var(${color})` }} />;
                })
              )}

              {fitPath && (
                <>
                  <path d={fitPath} fill="none" strokeWidth={5} strokeLinecap="round" style={{ stroke: surface, opacity: 0.85 }} />
                  <path d={fitPath} fill="none" strokeWidth={2} strokeLinecap="round" style={{ stroke: "var(--ink)" }} />
                </>
              )}

              {/* pending selection */}
              {brushBand && (
                <g data-testid="brush-band">
                  <rect x={brushBand.x} width={brushBand.w} y={0} height={ih} strokeWidth={1.5} strokeDasharray="5 4" style={{ fill: "var(--link)", opacity: 0.12 }} />
                  <rect x={brushBand.x} width={brushBand.w} y={0} height={ih} fill="none" strokeWidth={1.5} strokeDasharray="5 4" style={{ stroke: "var(--link)" }} />
                </g>
              )}
            </g>

            {/* cursor */}
            {shownCursor != null && (
              <>
                <line x1={x(xs[shownCursor])} x2={x(xs[shownCursor])} y1={0} y2={ih} strokeWidth={1.25} style={{ stroke: "var(--ink)" }} />
                {values[shownCursor] != null && (
                  <circle cx={x(xs[shownCursor])} cy={y(values[shownCursor] as number)} r={4.5} strokeWidth={2} style={{ fill: `var(${color})`, stroke: surface }} />
                )}
              </>
            )}

            <rect
              data-testid="plot-hit"
              x={0} y={-M.top + 4} width={iw} height={ih + M.top - 4} fill="transparent"
              style={{ cursor: p.onBrush ? "col-resize" : "crosshair" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerEnter={() => setInside(true)}
              onPointerLeave={() => { setInside(false); if (!drag.current) p.onCursor(null); }}
            />
          </g>
        </svg>
      )}
      {width > 0 && tip != null && (
        <ChartTooltip x={left + clamp(x(xs[tip]), 0, iw)} width={width}>{tipNode}</ChartTooltip>
      )}
    </div>
  );
}

/** Text + swatch key for the marks used above (identity is never colour alone). */
export function ChartKey({ items }: { items: { kind: "line" | "fit" | "analysis" | "missing" | "brush" | "bar"; label: string; color?: string }[] }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-ink-2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <svg width="18" height="10" aria-hidden="true" className="shrink-0">
            {it.kind === "line" && <line x1="1" x2="17" y1="5" y2="5" strokeWidth="2" strokeLinecap="round" style={{ stroke: `var(${it.color ?? "--viz-blue"})` }} />}
            {it.kind === "bar" && <rect x="5" y="1" width="8" height="9" rx="2" style={{ fill: `var(${it.color ?? "--viz-blue"})` }} />}
            {it.kind === "fit" && <line x1="1" x2="17" y1="5" y2="5" strokeWidth="2.5" strokeLinecap="round" style={{ stroke: "var(--ink)" }} />}
            {it.kind === "analysis" && <rect x="1" y="0" width="16" height="10" strokeWidth="1" style={{ fill: "var(--action)", fillOpacity: 0.3, stroke: "var(--ink-2)" }} />}
            {it.kind === "missing" && <rect x="1" y="0" width="16" height="10" style={{ fill: "var(--ink)", opacity: 0.14 }} />}
            {it.kind === "brush" && <rect x="1" y="0.75" width="16" height="8.5" strokeWidth="1.5" strokeDasharray="3 2" style={{ fill: "none", stroke: "var(--link)" }} />}
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  );
}
