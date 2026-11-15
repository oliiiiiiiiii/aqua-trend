"use client";
// One monthly / seasonal-cycle-removed / yearly time-series panel (SVG, responsive width).
// Single y-axis in the variable's own unit. Missing months are gaps and shaded bands, never zero.
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useElementWidth } from "./useElementWidth";
import { ChartTooltip } from "./ChartTooltip";
import { scrubKey } from "./scrubKeys";
import { missingRuns, plain, type TimeAxis } from "./time";

export type ChartView = "monthly" | "anomaly" | "annual";

export interface TimeSeriesChartProps {
  view: ChartView;
  axis: TimeAxis;
  /** plotted monthly series for the monthly and anomaly views (NaN = missing) */
  monthly: ArrayLike<number>;
  /** annual means of complete years, in the plotted space of the current view */
  annualYears: number[];
  annualValues: number[];
  /** y = intercept + slope * (t - 0.5), t = fractional year; null when no trend is fitted */
  trend: { intercept: number; slope: number } | null;
  /** first year that is incomplete at the end of the record (excluded from the fit), or null */
  partialFromYear: number | null;
  unit: string;
  /** CSS custom property of the series colour, e.g. "--viz-blue" */
  color: string;
  cursorIndex: number;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
  /** tooltip content for a month index (a React node built by the caller) */
  tooltip: (index: number) => React.ReactNode;
  /** accessible name and the slider's spoken value */
  label: string;
  valueText: string;
  height?: number;
}

const M = { top: 20, right: 12, bottom: 26 };

function decimalsForStep(step: number): number {
  if (!(step > 0)) return 0;
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

export default function TimeSeriesChart(p: TimeSeriesChartProps) {
  const { view, axis, monthly, annualYears, annualValues, trend, partialFromYear, unit, color, cursorIndex, hoverIndex } = p;
  const height = p.height ?? 220;
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);
  const [inside, setInside] = useState(false);
  const [focused, setFocused] = useState(false);

  const isAnnual = view === "annual";
  const zeroBand = view === "anomaly";

  // y domain from everything that will be drawn
  const trendAt = (t: number) => (trend ? trend.intercept + trend.slope * (t - 0.5) : NaN);
  const [d0, d1] = axis.domain;
  const yInfo = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    const take = (v: number) => { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    if (!isAnnual) for (let i = 0; i < monthly.length; i++) take(monthly[i]);
    annualValues.forEach(take);
    if (trend && annualYears.length) {
      take(trend.intercept + trend.slope * (d0 - 0.5));
      take(trend.intercept + trend.slope * ((partialFromYear ?? d1) - 0.5));
    }
    if (zeroBand) { take(0); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.06;
    // data that never goes below zero (fluxes, stocks) keeps a zero floor instead of padding into negative values
    return { lo: lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi: hi + pad };
  }, [monthly, annualValues, annualYears, trend, isAnnual, zeroBand, d0, d1, partialFromYear]);

  const yScaleFor = (h: number) => scaleLinear().domain([yInfo.lo, yInfo.hi]).range([h, 0]).nice(5);
  const ih = Math.max(10, height - M.top - M.bottom);
  const y = useMemo(() => yScaleFor(ih), [yInfo, ih]); // eslint-disable-line react-hooks/exhaustive-deps
  const yTicks = y.ticks(5);
  const yDec = decimalsForStep(yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1);
  const yLabels = yTicks.map((t) => plain(t, yDec));
  const left = Math.ceil(Math.max(...yLabels.map((s) => s.length)) * 6.6) + 14;
  const iw = Math.max(40, width - left - M.right);
  const x = useMemo(() => scaleLinear().domain(axis.domain).range([0, iw]), [axis, iw]);

  const crossesZero = y.domain()[0] < 0 && y.domain()[1] > 0;

  // x ticks: every 5 years, every 10 when narrow
  const stepYears = iw < 420 ? 10 : 5;
  const xTicks: number[] = [];
  for (let t = Math.ceil(axis.domain[0] / stepYears) * stepYears; t <= axis.domain[1]; t += stepYears) xTicks.push(t);

  const monthlyPath = useMemo(() => {
    if (isAnnual) return "";
    const gen = line<number>().defined((i) => Number.isFinite(monthly[i])).x((i) => x(axis.monthX(i))).y((i) => y(monthly[i]));
    return gen(Array.from({ length: monthly.length }, (_, i) => i)) ?? "";
  }, [isAnnual, monthly, x, y, axis]);

  const isolated = useMemo(() => {
    if (isAnnual) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < monthly.length; i++) {
      if (!Number.isFinite(monthly[i])) continue;
      const a = i > 0 && Number.isFinite(monthly[i - 1]);
      const b = i < monthly.length - 1 && Number.isFinite(monthly[i + 1]);
      if (!a && !b) out.push(i);
    }
    return out;
  }, [isAnnual, monthly]);

  const gaps = useMemo(() => missingRuns(monthly), [monthly]);

  const annualPath = useMemo(() => {
    const gen = line<number>().defined((i) => Number.isFinite(annualValues[i])).x((i) => x(annualYears[i] + 0.5)).y((i) => y(annualValues[i]));
    return gen(annualYears.map((_, i) => i)) ?? "";
  }, [annualYears, annualValues, x, y]);

  const trendPath = trend && annualYears.length
    ? `M${x(d0)},${y(trendAt(d0))}L${x(partialFromYear ?? d1)},${y(trendAt(partialFromYear ?? d1))}`
    : null;

  /* ------------------------------------------------ pointer and keyboard */
  const indexFromEvent = (e: PointerEvent): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    const t = x.invert(e.clientX - rect.left - left);
    if (isAnnual) {
      const yr = Math.min(axis.yearOf(axis.n - 1), Math.max(axis.firstYear, Math.floor(t)));
      return axis.indexOf(yr, axis.monthOf(cursorIndex));
    }
    return axis.indexAt(t);
  };
  const onPointerDown = (e: PointerEvent) => {
    dragging.current = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const i = indexFromEvent(e);
    p.onHover(i); p.onPick(i);
  };
  const onPointerMove = (e: PointerEvent) => {
    const i = indexFromEvent(e);
    p.onHover(i);
    if (dragging.current) p.onPick(i);
  };
  const endDrag = (e: PointerEvent) => {
    dragging.current = false;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };

  const showTipAt = inside ? hoverIndex : focused ? cursorIndex : null;
  const markX = (i: number) => (isAnnual ? x(axis.yearOf(i) + 0.5) : x(axis.monthX(i)));
  const annualIdxOfYear = (yr: number) => annualYears.indexOf(yr);

  const hoverDot = (i: number | null) => {
    if (i == null) return null;
    if (isAnnual) {
      const k = annualIdxOfYear(axis.yearOf(i));
      return k >= 0 ? { cx: x(annualYears[k] + 0.5), cy: y(annualValues[k]) } : null;
    }
    return Number.isFinite(monthly[i]) ? { cx: x(axis.monthX(i)), cy: y(monthly[i]) } : null;
  };
  const cursorDot = hoverDot(cursorIndex);
  const hoverPt = hoverDot(hoverIndex);

  const surface = "var(--paper)";
  const axisText = { fill: "var(--ink-2)", fontSize: 11 } as const;

  return (
    <div
      ref={wrapRef}
      className="relative select-none rounded-ctl outline-offset-2"
      style={{ height, touchAction: "pan-y", borderRadius: "min(var(--r-ctl), 8px)" }}
      tabIndex={0}
      role="slider"
      aria-label={p.label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={axis.n - 1}
      aria-valuenow={cursorIndex}
      aria-valuetext={p.valueText}
      onFocus={(e) => { if (e.target === e.currentTarget) setFocused(true); }}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => { scrubKey(e, cursorIndex, axis.n, p.onPick); }}
    >
      {width > 0 && (
        <svg ref={svgRef} width={width} height={height} aria-hidden="true" className="block overflow-visible" style={{ touchAction: "pan-y" }}>
          <g transform={`translate(${left},${M.top})`}>
            {/* gridlines and y labels */}
            {yTicks.map((t, k) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: "var(--viz-grid)" }} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{yLabels[k]}</text>
              </g>
            ))}
            {crossesZero && <line x1={0} x2={iw} y1={y(0)} y2={y(0)} strokeWidth={1.25} style={{ stroke: "var(--ink-3)" }} />}
            <line x1={0} x2={iw} y1={ih} y2={ih} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
            {xTicks.map((t) => (
              <g key={t} transform={`translate(${x(t)},${ih})`}>
                <line y2={4} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
                <text y={17} textAnchor="middle" className="tnum" style={axisText}>{t}</text>
              </g>
            ))}
            <text x={-left} y={-8} className="tnum" style={{ ...axisText, fill: "var(--ink-2)" }}>{unit}</text>

            {/* missing months: shaded, labelled in the legend, never drawn as a value */}
            {gaps.map(([a, b]) => (
              <rect key={a} x={x(axis.monthX(a) - 0.5 / 12)} width={Math.max(2, x(axis.monthX(b) + 0.5 / 12) - x(axis.monthX(a) - 0.5 / 12))} y={0} height={ih} style={{ fill: "var(--ink)", opacity: 0.09 }} />
            ))}

            {/* partial year: visibly outside the fit */}
            {partialFromYear != null && (
              <g>
                <rect x={x(partialFromYear)} width={Math.max(0, iw - x(partialFromYear))} y={0} height={ih} style={{ fill: "var(--ink)", opacity: 0.06 }} />
                <line x1={x(partialFromYear)} x2={x(partialFromYear)} y1={0} y2={ih} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
                <text x={iw} y={-8} textAnchor="end" style={axisText}>{iw < 300 ? `${partialFromYear} partial` : `${partialFromYear} partial, not in fit`}</text>
              </g>
            )}

            {/* playback cursor */}
            {isAnnual ? (
              <rect x={x(axis.yearOf(cursorIndex))} width={Math.max(2, x(axis.yearOf(cursorIndex) + 1) - x(axis.yearOf(cursorIndex)))} y={0} height={ih} style={{ fill: "var(--ink)", opacity: 0.1 }} />
            ) : null}
            <line x1={markX(cursorIndex)} x2={markX(cursorIndex)} y1={0} y2={ih} strokeWidth={1.5} style={{ stroke: "var(--ink)" }} />
            <path d={`M${markX(cursorIndex) - 5},-1L${markX(cursorIndex) + 5},-1L${markX(cursorIndex)},6Z`} style={{ fill: "var(--ink)" }} />

            {/* series */}
            {!isAnnual && (
              <>
                <path d={monthlyPath} fill="none" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: `var(${color})`, opacity: 0.7 }} />
                {isolated.map((i) => <circle key={i} cx={x(axis.monthX(i))} cy={y(monthly[i])} r={2} style={{ fill: `var(${color})`, opacity: 0.7 }} />)}
              </>
            )}
            <path d={annualPath} fill="none" strokeWidth={isAnnual ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: `var(${color})`, opacity: isAnnual ? 0.6 : 1 }} />
            {trendPath && (
              <>
                <path d={trendPath} fill="none" strokeWidth={5} strokeLinecap="round" style={{ stroke: surface, opacity: 0.85 }} />
                <path d={trendPath} fill="none" strokeWidth={2} strokeLinecap="round" style={{ stroke: "var(--ink)" }} />
              </>
            )}
            {annualYears.map((yr, k) => Number.isFinite(annualValues[k]) ? (
              <circle key={yr} cx={x(yr + 0.5)} cy={y(annualValues[k])} r={isAnnual ? 4.5 : 3.5} strokeWidth={2} style={{ fill: `var(${color})`, stroke: surface }} />
            ) : null)}

            {/* cursor marker on the data */}
            {cursorDot && <circle cx={cursorDot.cx} cy={cursorDot.cy} r={5} strokeWidth={2} style={{ fill: "var(--ink)", stroke: surface }} />}

            {/* hover crosshair, synced across blocks */}
            {hoverIndex != null && hoverIndex !== cursorIndex && (
              <line x1={markX(hoverIndex)} x2={markX(hoverIndex)} y1={0} y2={ih} strokeWidth={1} style={{ stroke: "var(--ink-3)" }} />
            )}
            {hoverPt && hoverIndex !== cursorIndex && <circle cx={hoverPt.cx} cy={hoverPt.cy} r={4} strokeWidth={2} style={{ fill: `var(${color})`, stroke: surface }} />}

            {/* hit area: the whole plot */}
            <rect
              x={0} y={-M.top + 4} width={iw} height={ih + M.top - 4} fill="transparent" style={{ cursor: "crosshair" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerEnter={() => setInside(true)}
              onPointerLeave={() => { setInside(false); if (!dragging.current) p.onHover(null); }}
            />
          </g>
        </svg>
      )}
      {width > 0 && showTipAt != null && (
        <ChartTooltip x={left + Math.min(iw, Math.max(0, markX(showTipAt)))} width={width}>{p.tooltip(showTipAt)}</ChartTooltip>
      )}
    </div>
  );
}
