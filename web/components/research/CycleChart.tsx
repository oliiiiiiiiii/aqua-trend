"use client";
// The fixed seasonal pattern of one variable: twelve calendar-month means of the registered reference period,
// exactly as the backend sent them (spec §7.1). It does not change when the analysis period changes.
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { ChartTooltip, TipRow } from "@/components/charts/ChartTooltip";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { fixed, MONTH_NAMES } from "@/lib/research/format";

export interface CycleChartProps {
  /** Jan..Dec, null = no reference value for that month */
  cycle: (number | null)[];
  unit: string;
  color?: string;
  decimals: number;
  /** calendar month 0-11 of the shared cursor, or null */
  cursorMonth: number | null;
  label: string;
  height?: number;
}

const M = { top: 22, right: 12, bottom: 26 };

export default function CycleChart(p: CycleChartProps) {
  const color = p.color ?? "--viz-blue";
  const height = p.height ?? 220;
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [own, setOwn] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const ih = Math.max(10, height - M.top - M.bottom);

  const y = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const v of p.cycle) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.06;
    return scaleLinear().domain([lo >= 0 ? Math.max(0, lo - pad) : lo - pad, hi + pad]).range([ih, 0]).nice(4);
  }, [p.cycle, ih]);
  const yTicks = y.ticks(4);
  const step = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
  const yDec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const yLabels = yTicks.map((t) => fixed(t, yDec));
  const left = Math.ceil(Math.max(1, ...yLabels.map((s) => s.length)) * 6.6) + 14;
  const iw = Math.max(40, width - left - M.right);
  const x = useMemo(() => scaleLinear().domain([0, 11]).range([8, iw - 8]), [iw]);
  const idx = Array.from({ length: 12 }, (_, i) => i);
  const path = line<number>().defined((i) => p.cycle[i] != null).x((i) => x(i)).y((i) => y(p.cycle[i] as number))(idx) ?? "";
  const crossesZero = y.domain()[0] < 0 && y.domain()[1] > 0;

  const monthAt = (e: PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return Math.min(11, Math.max(0, Math.round(x.invert(e.clientX - rect.left - left))));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const at = own ?? p.cursorMonth ?? 0;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = at - 1;
    else if (e.key === "ArrowRight") next = at + 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 11;
    else return;
    e.preventDefault();
    setOwn(Math.min(11, Math.max(0, next)));
  };

  const mark = own ?? p.cursorMonth;
  const tip = own ?? (focused ? p.cursorMonth ?? 0 : null);
  const surface = "var(--paper)";
  const axisText = { fill: "var(--ink-2)", fontSize: 11 } as const;
  const text = (m: number) => `${MONTH_NAMES[m]}: ${p.cycle[m] == null ? "no reference value" : `${fixed(p.cycle[m], p.decimals)} ${p.unit}`}`;

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
      aria-valuenow={mark ?? 0}
      aria-valuetext={text(mark ?? 0)}
      onFocus={(e) => { if (e.target === e.currentTarget) setFocused(true); }}
      onBlur={() => { setFocused(false); setOwn(null); }}
      onKeyDown={onKeyDown}
    >
      {width > 0 && (
        <svg ref={svgRef} width={width} height={height} aria-hidden="true" className="block overflow-visible">
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
                <text y={17} textAnchor="middle" style={axisText}>{MONTH_NAMES[i][0]}</text>
              </g>
            ))}
            <text x={-left} y={-10} style={axisText}>{p.unit}</text>
            {mark != null && <line x1={x(mark)} x2={x(mark)} y1={0} y2={ih} strokeWidth={1.25} style={{ stroke: "var(--ink)" }} />}
            <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: `var(${color})` }} />
            {idx.map((i) => p.cycle[i] != null ? (
              <circle key={i} cx={x(i)} cy={y(p.cycle[i] as number)} r={i === mark ? 5 : 4} strokeWidth={2} style={{ fill: `var(${color})`, stroke: surface }} />
            ) : null)}
            <rect
              x={0} y={-M.top + 4} width={iw} height={ih + M.top - 4} fill="transparent" style={{ cursor: "crosshair" }}
              onPointerMove={(e) => setOwn(monthAt(e))}
              onPointerLeave={() => setOwn(null)}
            />
          </g>
        </svg>
      )}
      {width > 0 && tip != null && (
        <ChartTooltip x={left + x(tip)} width={width}>
          <div className="font-semibold">{MONTH_NAMES[tip]}</div>
          <TipRow color={color} value={p.cycle[tip] == null ? "No value" : `${fixed(p.cycle[tip], p.decimals)} ${p.unit}`} label="reference-period mean" />
        </ChartTooltip>
      )}
    </div>
  );
}
