"use client";
// The detective "number line": one variable's monthly series with the event shaded.
// Wheel = zoom around the pointer, drag = pan, Shift+drag (or select mode) = pick an interval.
// Missing months are gaps and shaded columns, never zero and never bridged.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import type { Decomposition, TimeRange } from "@/lib/detective/contracts";
import type { LabBand, LabSegment } from "@/lib/detective/lab";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { ChartTooltip, TipRow } from "@/components/charts/ChartTooltip";
import { num, ymIndex } from "./format";

export type ChartLayer = "raw" | "seasonal" | "trend" | "residual";

/** Visible window in month-index space: month i spans [i, i + 1]. */
export type ViewWindow = [number, number];
/** Selected months, inclusive indices into `d.months`. */
export type MonthSelection = [number, number];

export interface SeriesChartProps {
  d: Decomposition;
  layer: ChartLayer;
  unit: string;
  event: TimeRange;
  view: ViewWindow;
  onViewChange: (v: ViewWindow) => void;
  selection: MonthSelection | null;
  onSelectionChange: (s: MonthSelection | null) => void;
  /** when true a plain drag selects instead of panning (touch-friendly) */
  selectMode: boolean;
  /** accessible name */
  label: string;
  height?: number;
  /** analysis-lab fit lines, in residual units; drawn on the residual layer only */
  overlay?: LabSegment[];
  /** analysis-lab shaded month spans (analogues, regimes, flagged months), drawn on every layer */
  overlayBands?: LabBand[];
}

export const MIN_SPAN = 6;

/** Clamp a window into [0, n] keeping at least MIN_SPAN months. */
export function clampView([a, b]: ViewWindow, n: number): ViewWindow {
  let span = Math.min(n, Math.max(Math.min(MIN_SPAN, n), b - a));
  let lo = a;
  if (b - a !== span) lo = (a + b) / 2 - span / 2;
  lo = Math.max(0, Math.min(n - span, lo));
  span = Math.min(span, n - lo);
  return [lo, lo + span];
}

/** Zoom by factor k (>1 zooms out) around month-space point c. */
export function zoomView([a, b]: ViewWindow, k: number, c: number, n: number): ViewWindow {
  return clampView([c - (c - a) * k, c + (b - c) * k], n);
}

const M = { top: 22, right: 10, bottom: 26 };
const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Month index → "YYYY-MM" label, using the first month of the series. */
function monthOf(base: number, i: number) {
  const k = base + i;
  return { year: Math.floor(k / 12), month: (k % 12) + 1 };
}

export default function SeriesChart(p: SeriesChartProps) {
  const { d, layer, unit, view, selection } = p;
  const height = p.height ?? 280;
  const n = d.months.length;
  const base = n ? ymIndex(d.months[0]) : 0;
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const hitRef = useRef<SVGRectElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<null | { kind: "pan" | "select"; x0: number; view0: ViewWindow; i0: number }>(null);
  const clipId = "sc" + useId().replace(/[^a-zA-Z0-9]/g, "");

  const ev = useMemo(() => {
    const s = ymIndex(p.event.start) - base, e = ymIndex(p.event.end) - base;
    return { s: Math.max(0, s), e: Math.min(n - 1, e), visible: e >= 0 && s <= n - 1 };
  }, [p.event, base, n]);

  // σ of the baseline residuals, recovered from residual / z (same for every month)
  const sigma = useMemo(() => {
    for (let i = 0; i < n; i++) {
      const r = d.residual[i], z = d.z[i];
      if (isNum(r) && isNum(z) && Math.abs(z) > 1e-9) return Math.abs(r / z);
    }
    return null;
  }, [d, n]);

  const normal = useMemo(() => d.trend.map((t, i) => t + d.seasonal[i]), [d]);

  // what is drawn in each layer: a primary series and an optional faint context series
  const series = useMemo(() => {
    switch (layer) {
      case "raw": return { main: d.raw, context: normal as (number | null)[], contextLabel: "正常值（趨勢＋季節）", mainLabel: "原始值" };
      case "seasonal": return { main: d.seasonal as (number | null)[], context: null, contextLabel: "", mainLabel: "季節循環" };
      case "trend": return { main: d.trend as (number | null)[], context: d.raw, contextLabel: "原始值", mainLabel: "長期趨勢" };
      case "residual": return { main: d.residual, context: null, contextLabel: "", mainLabel: "殘差（異常）" };
    }
  }, [layer, d, normal]);

  const [a, b] = view;
  const i0 = Math.max(0, Math.floor(a)), i1 = Math.min(n - 1, Math.ceil(b) - 1);

  // y domain from what is visible
  const yDomain = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    const take = (v: number | null | undefined) => { if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    for (let i = i0; i <= i1; i++) { take(series.main[i]); if (series.context) take(series.context[i]); }
    if (layer === "residual") { take(0); if (sigma) { take(2 * sigma); take(-2 * sigma); } }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad] as [number, number];
  }, [series, i0, i1, layer, sigma]);

  const ih = Math.max(20, height - M.top - M.bottom);
  const y = useMemo(() => scaleLinear().domain(yDomain).range([ih, 0]).nice(5), [yDomain, ih]);
  const yTicks = y.ticks(5);
  const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
  const yLabels = yTicks.map((t) => num(t, Math.max(0, -Math.floor(Math.log10(yStep) + 1e-9)) + 1));
  const left = Math.ceil(Math.max(3, ...yLabels.map((s) => s.length)) * 6.6) + 12;
  const iw = Math.max(40, width - left - M.right);
  const x = useMemo(() => scaleLinear().domain([a, b]).range([0, iw]), [a, b, iw]);

  /* ------------------------------------------------ x ticks: years when zoomed out, months when zoomed in */
  const xTicks = useMemo(() => {
    const span = b - a;
    const out: { at: number; label: string; major: boolean }[] = [];
    const maxTicks = Math.max(2, Math.floor(iw / 64));
    if (span > 36) {
      const step = [1, 2, 5, 10, 20].find((s) => span / 12 / s <= maxTicks) ?? 20;
      const y0 = Math.ceil((base + a) / 12), y1 = Math.floor((base + b) / 12);
      for (let yr = Math.ceil(y0 / step) * step; yr <= y1; yr += step) out.push({ at: yr * 12 - base, label: String(yr), major: true });
    } else {
      const step = [1, 2, 3, 6].find((s) => span / s <= maxTicks) ?? 12;
      for (let k = Math.ceil(a); k <= Math.floor(b); k++) {
        const m = monthOf(base, k);
        if ((m.month - 1) % step !== 0) continue;
        out.push({ at: m.month === 1 ? k : k + 0.5, label: m.month === 1 ? String(m.year) : String(m.month).padStart(2, "0"), major: m.month === 1 });
      }
    }
    return out;
  }, [a, b, iw, base]);

  const cx = (i: number) => x(i + 0.5);

  const pathOf = (vals: (number | null)[]) =>
    line<number>().defined((i) => isNum(vals[i])).x(cx).y((i) => y(vals[i] as number))(range(Math.max(0, i0 - 1), Math.min(n - 1, i1 + 1))) ?? "";

  const gaps = useMemo(() => {
    const runs: [number, number][] = [];
    let s = -1;
    for (let i = 0; i <= n; i++) {
      const miss = i < n && !isNum(d.raw[i]);
      if (miss && s < 0) s = i;
      if (!miss && s >= 0) { runs.push([s, i - 1]); s = -1; }
    }
    return runs;
  }, [d, n]);

  /* ------------------------------------------------ interaction */
  const idxAt = (clientX: number) => {
    const rect = hitRef.current!.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor(x.invert(clientX - rect.left))));
  };
  const onPointerDown = (e: PointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const i = idxAt(e.clientX);
    const kind = p.selectMode || e.shiftKey ? "select" : "pan";
    drag.current = { kind, x0: e.clientX, view0: view, i0: i };
    if (kind === "select") p.onSelectionChange([i, i]);
  };
  const onPointerMove = (e: PointerEvent<SVGRectElement>) => {
    const i = idxAt(e.clientX);
    setHover(i);
    const g = drag.current;
    if (!g) return;
    if (g.kind === "select") p.onSelectionChange([Math.min(g.i0, i), Math.max(g.i0, i)]);
    else {
      const dm = ((e.clientX - g.x0) / iw) * (g.view0[1] - g.view0[0]);
      p.onViewChange(clampView([g.view0[0] - dm, g.view0[1] - dm], n));
    }
  };
  const endDrag = (e: PointerEvent<SVGRectElement>) => {
    drag.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };

  // wheel zoom needs a non-passive listener to keep the page from scrolling
  const latest = useRef({ view, n, iw, onViewChange: p.onViewChange, x });
  latest.current = { view, n, iw, onViewChange: p.onViewChange, x };
  useEffect(() => {
    const el = hitRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const L = latest.current;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const c = L.x.invert(e.clientX - rect.left);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      L.onViewChange(zoomView(L.view, Math.exp(delta * 0.0015), c, L.n));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [width]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const span = b - a;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dm = (e.key === "ArrowLeft" ? -1 : 1) * span * (e.shiftKey ? 0.5 : 0.1);
      p.onViewChange(clampView([a + dm, b + dm], n));
    } else if (e.key === "+" || e.key === "=") p.onViewChange(zoomView(view, 0.7, (a + b) / 2, n));
    else if (e.key === "-" || e.key === "_") p.onViewChange(zoomView(view, 1 / 0.7, (a + b) / 2, n));
    else if (e.key === "Escape") p.onSelectionChange(null);
    else return;
    e.preventDefault();
  };

  /* ------------------------------------------------ render */
  const color = "var(--viz-blue)";
  const surface = "var(--paper)";
  const axisText = { fill: "var(--ink-2)", fontSize: 11 } as const;
  const crossesZero = y.domain()[0] < 0 && y.domain()[1] > 0;
  const band = (s: number, e: number) => {
    const x0 = Math.max(0, x(s)), x1 = Math.min(iw, x(e + 1));
    return x1 > x0 ? { x: x0, width: x1 - x0 } : null;
  };
  const evBand = ev.visible ? band(ev.s, ev.e) : null;
  const selBand = selection ? band(selection[0], selection[1]) : null;
  const barW = Math.max(1, x(1) - x(0) - (x(1) - x(0) > 4 ? 1 : 0));

  const tip = hover != null ? (
    <>
      <div className="mb-1 font-semibold tnum">{d.months[hover]}</div>
      <TipRow color="--viz-blue" value={isNum(series.main[hover]) ? `${num(series.main[hover])} ${unit}` : "缺值"} label={series.mainLabel} />
      {series.context && <TipRow color="--viz-ink" dashed value={isNum(series.context[hover]) ? `${num(series.context[hover])} ${unit}` : "缺值"} label={series.contextLabel} />}
      {(layer === "residual" || layer === "raw") && isNum(d.z[hover]) && <TipRow value={`z = ${num(d.z[hover], 1, true)}`} label="標準化異常" />}
    </>
  ) : null;

  return (
    <div
      ref={wrapRef}
      className="relative select-none"
      style={{ height, touchAction: "pan-y", borderRadius: "min(var(--r-ctl), 8px)" }}
      tabIndex={0}
      role="group"
      aria-label={`${p.label}：${d.months[i0] ?? ""} 至 ${d.months[i1] ?? ""}。方向鍵平移，+／− 縮放，Esc 清除選取。`}
      onKeyDown={onKeyDown}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true" className="block">
          <defs>
            <clipPath id={clipId}><rect x={0} y={-2} width={iw} height={ih + 4} /></clipPath>
          </defs>
          <g transform={`translate(${left},${M.top})`}>
            {yTicks.map((t, k) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: "var(--viz-grid)" }} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{yLabels[k]}</text>
              </g>
            ))}
            <text x={-left + 2} y={-9} style={axisText}>{unit}</text>

            <g clipPath={`url(#${clipId})`}>
              {evBand && (
                <g>
                  <rect x={evBand.x} width={evBand.width} y={0} height={ih} style={{ fill: "var(--action)", opacity: 0.32 }} />
                  <rect x={evBand.x} width={evBand.width} y={0} height={3} style={{ fill: "var(--action)" }} />
                </g>
              )}
              {gaps.map(([s, e]) => {
                const g = band(s, e);
                return g ? <rect key={s} {...g} y={0} height={ih} style={{ fill: "var(--ink)", opacity: 0.08 }} /> : null;
              })}
              {selBand && (
                <g>
                  <rect {...selBand} y={0} height={ih} style={{ fill: "var(--focus)", opacity: 0.14 }} />
                  <line x1={selBand.x} x2={selBand.x} y1={0} y2={ih} strokeWidth={1.5} style={{ stroke: "var(--focus)" }} />
                  <line x1={selBand.x + selBand.width} x2={selBand.x + selBand.width} y1={0} y2={ih} strokeWidth={1.5} style={{ stroke: "var(--focus)" }} />
                </g>
              )}

              {p.overlayBands?.map((g, k) => {
                const r = band(g.x0, g.x1);
                if (!r) return null;
                const c = g.tone === "cool" ? "var(--viz-cool)" : g.tone === "warm" ? "var(--viz-warm)" : g.tone === "ink" ? "var(--ink-2)" : "var(--focus)";
                return (
                  <g key={`b${k}`}>
                    <rect {...r} y={0} height={ih} style={{ fill: c, opacity: 0.13 }} />
                    <rect {...r} y={ih - 4} height={4} style={{ fill: c, opacity: 0.85 }} />
                    {g.label && r.width > 10 && <text x={r.x + r.width / 2} y={ih - 8} textAnchor="middle" style={{ fill: c, fontSize: 10, fontWeight: 700 }}>{g.label}</text>}
                  </g>
                );
              })}

              {crossesZero && <line x1={0} x2={iw} y1={y(0)} y2={y(0)} strokeWidth={1.25} style={{ stroke: "var(--ink-3)" }} />}

              {layer === "residual" ? (
                <>
                  {sigma != null && [-2, 2].map((k) => (
                    <line key={k} x1={0} x2={iw} y1={y(k * sigma)} y2={y(k * sigma)} strokeWidth={1} strokeDasharray="4 4" style={{ stroke: "var(--ink-3)" }} />
                  ))}
                  {range(i0, i1).map((i) => {
                    const v = d.residual[i];
                    if (!isNum(v)) return null;
                    const y0 = y(0), y1 = y(v);
                    return <rect key={i} x={x(i) + (x(1) - x(0) - barW) / 2} width={barW} y={Math.min(y0, y1)} height={Math.max(0.5, Math.abs(y1 - y0))} style={{ fill: v >= 0 ? "var(--viz-warm)" : "var(--viz-cool)" }} />;
                  })}
                </>
              ) : (
                <>
                  {series.context && (
                    <path d={pathOf(series.context)} fill="none" strokeWidth={1.25} strokeDasharray={layer === "raw" ? "4 3" : undefined} style={{ stroke: "var(--viz-ink)", opacity: layer === "raw" ? 0.75 : 0.35 }} />
                  )}
                  <path d={pathOf(series.main)} fill="none" strokeWidth={layer === "trend" ? 2.5 : 1.75} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: color }} />
                  {layer === "raw" && range(i0, i1).map((i) => {
                    const v = d.raw[i];
                    const lone = isNum(v) && !isNum(d.raw[i - 1]) && !isNum(d.raw[i + 1]);
                    return lone ? <circle key={i} cx={cx(i)} cy={y(v as number)} r={2.5} style={{ fill: color }} /> : null;
                  })}
                </>
              )}

              {layer === "residual" && p.overlay?.map((g, k) => {
                const pts = { x1: cx(g.x0), x2: cx(g.x1), y1: y(g.y0), y2: y(g.y1) };
                return (
                  <g key={k}>
                    <line {...pts} strokeWidth={5} strokeLinecap="round" style={{ stroke: surface, opacity: 0.85 }} />
                    <line {...pts} strokeWidth={2.25} strokeLinecap="round" strokeDasharray={g.dashed ? "6 4" : undefined} style={{ stroke: "var(--ink)" }} />
                  </g>
                );
              })}

              {hover != null && (
                <>
                  <line x1={cx(hover)} x2={cx(hover)} y1={0} y2={ih} strokeWidth={1} style={{ stroke: "var(--ink-3)" }} />
                  {isNum(series.main[hover]) && layer !== "residual" && (
                    <circle cx={cx(hover)} cy={y(series.main[hover] as number)} r={4} strokeWidth={2} style={{ fill: color, stroke: surface }} />
                  )}
                </>
              )}
            </g>

            {evBand && evBand.width > 24 && (
              <text x={evBand.x + evBand.width / 2} y={-8} textAnchor="middle" style={{ ...axisText, fill: "var(--ink)", fontWeight: 600 }}>事件</text>
            )}
            {layer === "residual" && sigma != null && y(2 * sigma) > 8 && (
              <text x={iw - 2} y={y(2 * sigma) - 4} textAnchor="end" style={axisText}>+2σ</text>
            )}

            <line x1={0} x2={iw} y1={ih} y2={ih} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
            {xTicks.map((t) => (
              <g key={t.at} transform={`translate(${x(t.at)},${ih})`}>
                <line y2={t.major ? 5 : 3} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
                <text y={17} textAnchor="middle" className="tnum" style={{ ...axisText, fontWeight: t.major ? 600 : 400 }}>{t.label}</text>
              </g>
            ))}

            <rect
              ref={hitRef}
              x={0} y={-M.top + 4} width={iw} height={ih + M.top - 4} fill="transparent"
              style={{ cursor: p.selectMode ? "crosshair" : drag.current?.kind === "pan" ? "grabbing" : "grab" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerLeave={() => { if (!drag.current) setHover(null); }}
            />
          </g>
        </svg>
      )}
      {width > 0 && hover != null && (
        <ChartTooltip x={left + Math.min(iw, Math.max(0, cx(hover)))} width={width}>{tip}</ChartTooltip>
      )}
    </div>
  );
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
