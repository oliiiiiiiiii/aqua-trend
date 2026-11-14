"use client";
// Compact seasonal-cycle chart: 12 calendar-month means, the min-max envelope over the baseline years, and the
// selected year on top. Tells the reader what is season, what is anomaly and what is trend.
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import { useElementWidth } from "./useElementWidth";
import { ChartTooltip } from "./ChartTooltip";
import { scrubKey } from "./scrubKeys";
import { MONTH_INITIAL, plain } from "./time";

export interface SeasonalChartProps {
  mean: number[];
  min: number[];
  max: number[];
  /** 12 values of the selected year (NaN = missing or not yet happened) */
  selected: number[];
  selectedYear: number;
  /** calendar month 0-11 of the playback cursor */
  cursorMonth: number;
  unit: string;
  color: string;
  tooltip: (month: number) => React.ReactNode;
  /** click or drag: calendar month 0-11 within the selected year */
  onPickMonth: (month: number) => void;
  /** keyboard: move the global cursor by +-1 month or +-1 year */
  onKey: (e: React.KeyboardEvent) => void;
  label: string;
  valueText: string;
  height?: number;
}

const M = { top: 20, right: 42, bottom: 26 };

export default function SeasonalChart(p: SeasonalChartProps) {
  const height = p.height ?? 220;
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);

  const ih = Math.max(10, height - M.top - M.bottom);
  const y = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const arr of [p.min, p.max, p.selected]) for (const v of arr) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.06;
    return scaleLinear().domain([lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad]).range([ih, 0]).nice(4);
  }, [p.min, p.max, p.selected, ih]);
  const yTicks = y.ticks(4);
  const step = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
  const yDec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const yLabels = yTicks.map((t) => plain(t, yDec));
  const left = Math.ceil(Math.max(...yLabels.map((s) => s.length)) * 6.6) + 14;
  const iw = Math.max(40, width - left - M.right);
  const x = useMemo(() => scaleLinear().domain([0, 11]).range([0, iw]), [iw]);
  const crossesZero = y.domain()[0] < 0 && y.domain()[1] > 0;

  const idx = Array.from({ length: 12 }, (_, i) => i);
  const bandPath = useMemo(
    () => area<number>().defined((i) => Number.isFinite(p.min[i]) && Number.isFinite(p.max[i])).x((i) => x(i)).y0((i) => y(p.min[i])).y1((i) => y(p.max[i]))(idx) ?? "",
    [p.min, p.max, x, y], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const meanPath = useMemo(
    () => line<number>().defined((i) => Number.isFinite(p.mean[i])).x((i) => x(i)).y((i) => y(p.mean[i]))(idx) ?? "",
    [p.mean, x, y], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const selPath = useMemo(
    () => line<number>().defined((i) => Number.isFinite(p.selected[i])).x((i) => x(i)).y((i) => y(p.selected[i]))(idx) ?? "",
    [p.selected, x, y], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const monthAt = (e: PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return Math.min(11, Math.max(0, Math.round(x.invert(e.clientX - rect.left - left))));
  };
  const lastSel = [...idx].reverse().find((i) => Number.isFinite(p.selected[i]));
  const surface = "var(--paper)";
  const axisText = { fill: "var(--ink-2)", fontSize: 11 } as const;
  const tipMonth = hover ?? (focused ? p.cursorMonth : null);

  return (
    <div
      ref={wrapRef}
      className="relative select-none outline-offset-2"
      style={{ height, touchAction: "pan-y", borderRadius: "min(var(--r-ctl), 8px)" }}
      tabIndex={0}
      role="slider"
      aria-label={p.label}
      aria-valuemin={0}
      aria-valuemax={11}
      aria-valuenow={p.cursorMonth}
      aria-valuetext={p.valueText}
      onFocus={(e) => { if (e.target === e.currentTarget) setFocused(true); }}
      onBlur={() => setFocused(false)}
      onKeyDown={p.onKey}
    >
      {width > 0 && (
        <svg ref={svgRef} width={width} height={height} aria-hidden="true" className="block overflow-visible" style={{ touchAction: "pan-y" }}>
          <g transform={`translate(${left},${M.top})`}>
            {yTicks.map((t, k) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: "var(--viz-grid)" }} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{yLabels[k]}</text>
              </g>
            ))}
            {crossesZero && <line x1={0} x2={iw} y1={y(0)} y2={y(0)} strokeWidth={1.25} style={{ stroke: "var(--ink-3)" }} />}
            <line x1={0} x2={iw} y1={ih} y2={ih} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
            {idx.map((i) => (
              <g key={i} transform={`translate(${x(i)},${ih})`}>
                <line y2={4} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
                <text y={17} textAnchor="middle" style={axisText}>{MONTH_INITIAL[i]}</text>
              </g>
            ))}
            <text x={-left} y={-8} className="tnum" style={axisText}>{p.unit}</text>

            <path d={bandPath} style={{ fill: `var(${p.color})`, opacity: 0.14 }} />
            <path d={meanPath} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: `var(${p.color})` }} />

            <line x1={x(p.cursorMonth)} x2={x(p.cursorMonth)} y1={0} y2={ih} strokeWidth={1.5} style={{ stroke: "var(--ink)" }} />
            <path d={`M${x(p.cursorMonth) - 5},-1L${x(p.cursorMonth) + 5},-1L${x(p.cursorMonth)},6Z`} style={{ fill: "var(--ink)" }} />

            <path d={selPath} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--ink)" }} />
            {idx.map((i) => Number.isFinite(p.selected[i]) ? <circle key={i} cx={x(i)} cy={y(p.selected[i])} r={i === p.cursorMonth ? 5 : 3} strokeWidth={2} style={{ fill: "var(--ink)", stroke: surface }} /> : null)}
            {lastSel != null && <text x={x(lastSel) + 7} y={y(p.selected[lastSel])} dy="0.32em" className="tnum" style={{ ...axisText, fill: "var(--ink)", fontWeight: 600 }}>{p.selectedYear}</text>}

            {hover != null && hover !== p.cursorMonth && <line x1={x(hover)} x2={x(hover)} y1={0} y2={ih} strokeWidth={1} style={{ stroke: "var(--ink-3)" }} />}

            <rect
              x={-4} y={-M.top + 4} width={iw + 8} height={ih + M.top - 4} fill="transparent" style={{ cursor: "crosshair" }}
              onPointerDown={(e) => { dragging.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); const m = monthAt(e); setHover(m); p.onPickMonth(m); }}
              onPointerMove={(e) => { const m = monthAt(e); setHover(m); if (dragging.current) p.onPickMonth(m); }}
              onPointerUp={(e) => { dragging.current = false; try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ } }}
              onPointerCancel={() => { dragging.current = false; }}
              onPointerLeave={() => { if (!dragging.current) setHover(null); }}
            />
          </g>
        </svg>
      )}
      {width > 0 && tipMonth != null && (
        <ChartTooltip x={left + x(tipMonth)} width={width}>{p.tooltip(tipMonth)}</ChartTooltip>
      )}
    </div>
  );
}
