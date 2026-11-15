"use client";
// The expanded lane's chart in original units. Four layers: Anomaly (bars, ±1σ/±2σ guides labelled on
// the right edge), Observed (raw + dashed normal), Seasonal, Trend. The event band, the shared
// selection (with handles) and the crosshair show in every layer. Missing months are hatched, never bridged.
import { useId, type KeyboardEvent } from "react";
import { scaleLinear } from "d3-scale";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { num } from "../format";
import { GUTTER_L, GUTTER_R, barsPath, gapRuns, isNum, linePath, timeScale, timeTicks } from "./axis";
import type { Span } from "./model";
import { anomalyColor, type LaneReady } from "./types";
import { useSelectionDrag } from "./useSelectionDrag";
import { MonthTip } from "./MonthTip";
import { COPY } from "./copy";
// Tests (lab) overlay: drawn on the Anomaly layer only
import { LabOverlayMarks } from "./lab/overlay";
import type { LabOverlay } from "./lab/tests";

export type ChartLayer = "anomaly" | "observed" | "seasonal" | "trend";

const TOP = 20, BOTTOM = 24;

export interface LaneChartProps {
  lane: LaneReady;
  layer: ChartLayer;
  polarity: "cool" | "warm";
  view: Span;
  event: Span;
  sel: Span;
  hover: number | null;
  showTip: boolean;
  /** defaults to 300 px, 230 px when narrow */
  height?: number;
  label: string;
  onSel: (s: Span) => void;
  onCommit: (s: Span) => void;
  onHover: (k: number | null) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** fit lines / break of the open test (Tests area); shown on the Anomaly layer */
  overlay?: LabOverlay | null;
}

export default function LaneChart(p: LaneChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const t = timeScale(p.view, width || 600);
  const { d, base, baseline } = p.lane;
  const sigma = baseline.sigma;
  const h = p.height ?? (width > 0 && width < 560 ? 230 : 300), ih = h - TOP - BOTTOM;
  const normal = d.trend.map((v, i) => v + d.seasonal[i]);

  const main: (number | null)[] = p.layer === "anomaly" ? d.residual : p.layer === "observed" ? d.raw : p.layer === "seasonal" ? d.seasonal : d.trend;
  const context: (number | null)[] | null = p.layer === "observed" ? normal : p.layer === "trend" ? d.raw : null;

  let lo = Infinity, hi = -Infinity;
  const take = (v: number | null | undefined) => { if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  for (let k = p.view.s; k <= p.view.e; k++) { take(main[k - base]); if (context) take(context[k - base]); }
  if (p.layer === "anomaly") { take(0); if (sigma) { take(2 * sigma); take(-2 * sigma); } }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.06;
  const y = scaleLinear().domain([lo - pad, hi + pad]).range([ih, 0]).nice(5);
  const yTicks = y.ticks(5);
  const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
  const yDigits = Math.max(0, -Math.floor(Math.log10(yStep) + 1e-9)) + 1;

  const drag = useSelectionDrag({ t, sel: p.sel, onChange: p.onSel, onCommit: p.onCommit, onHover: p.onHover });
  const band = (s: Span) => {
    const x0 = Math.max(0, t.x(s.s)), x1 = Math.min(t.iw, t.x(s.e + 1));
    return x1 > x0 ? { x: x0, width: x1 - x0 } : null;
  };
  const ev = band(p.event);
  const sb = band(p.sel);
  const hoverIn = p.hover != null && p.hover >= p.view.s && p.hover <= p.view.e;
  const axisText = { fill: "var(--ink-2)", fontSize: 11 } as const;

  // σ guide labels on the right edge (same scale as the left axis); drop the ones that would collide
  const guides: { k: number; y: number }[] = [];
  if (p.layer === "anomaly" && sigma) {
    const y0 = y(0);
    const dy1 = Math.abs(y(sigma) - y0);
    for (const k of [2, 1, -1, -2]) {
      if (Math.abs(k) === 1 && dy1 < 11) continue;
      if (Math.abs(y(2 * sigma) - y0) < 9) continue;
      guides.push({ k, y: y(k * sigma) });
    }
  }
  const clip = `lc-${uid}`, hatch = `lh-${uid}`;
  const crossesZero = y.domain()[0] < 0 && y.domain()[1] > 0;
  const hv = hoverIn ? main[p.hover! - base] : null;

  return (
    <div
      ref={ref}
      className="relative min-w-0 select-none rounded-[6px]"
      style={{ height: h }}
      tabIndex={0}
      role="group"
      aria-label={p.label}
      onKeyDown={p.onKeyDown}
    >
      {width > 0 && (
        <svg width={width} height={h} aria-hidden="true" className="block">
          <defs>
            <clipPath id={clip}><rect x={0} y={-1} width={t.iw} height={ih + 2} /></clipPath>
            <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={6} strokeWidth={2} style={{ stroke: "var(--ink)", opacity: 0.14 }} />
            </pattern>
          </defs>
          <g transform={`translate(${GUTTER_L},${TOP})`}>
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={0} x2={t.iw} y1={y(v)} y2={y(v)} strokeWidth={1} style={{ stroke: "var(--viz-grid)" }} />
                <text x={-6} y={y(v)} dy="0.32em" textAnchor="end" className="tnum" style={axisText}>{num(v, yDigits)}</text>
              </g>
            ))}
            <text x={-GUTTER_L + 2} y={-8} style={{ ...axisText, fill: "var(--ink-3)" }}>{p.lane.meta.unit}</text>

            <g clipPath={`url(#${clip})`}>
              {ev && (
                <g>
                  <rect x={ev.x} width={ev.width} y={0} height={ih} style={{ fill: "var(--action)", opacity: "var(--event-band-opacity)" }} />
                  <rect x={ev.x} width={ev.width} y={0} height={3} style={{ fill: "var(--action)" }} />
                </g>
              )}
              {gapRuns(d.raw, base, p.view).map((g) => {
                const b = band(g);
                return b ? <rect key={g.s} {...b} y={0} height={ih} fill={`url(#${hatch})`} /> : null;
              })}
              {sb && <rect {...sb} y={0} height={ih} style={{ fill: "var(--focus)", opacity: 0.07 }} />}

              {crossesZero && <line x1={0} x2={t.iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />}

              {p.layer === "anomaly" ? (
                <>
                  {sigma != null && [-2, -1, 1, 2].map((k) => (
                    <line key={k} x1={0} x2={t.iw} y1={y(k * sigma)} y2={y(k * sigma)} strokeWidth={1}
                      strokeDasharray={Math.abs(k) === 2 ? "4 3" : "1 3"} style={{ stroke: "var(--ink-3)", opacity: Math.abs(k) === 2 ? 0.8 : 0.6 }} />
                  ))}
                  <path d={barsPath(t, d.residual, base, (v) => y(v), y(0), (v) => v >= 0)} style={{ fill: anomalyColor(true, p.polarity) }} />
                  <path d={barsPath(t, d.residual, base, (v) => y(v), y(0), (v) => v < 0)} style={{ fill: anomalyColor(false, p.polarity) }} />
                  {p.overlay && <LabOverlayMarks overlay={p.overlay} base={base} t={t} y={(v) => y(v)} ih={ih} />}
                </>
              ) : (
                <>
                  {context && (
                    <path d={linePath(t, context, base, (v) => y(v))} fill="none" strokeWidth={1.25}
                      strokeDasharray={p.layer === "observed" ? "4 3" : undefined}
                      style={{ stroke: "var(--viz-ink)", opacity: p.layer === "observed" ? 0.8 : 0.35 }} />
                  )}
                  <path d={linePath(t, main, base, (v) => y(v))} fill="none" strokeWidth={p.layer === "trend" ? 2 : 1.5}
                    strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--viz-blue)" }} />
                  {p.layer === "observed" && lonePoints(d.raw, base, p.view).map((k) => (
                    <circle key={k} cx={t.cx(k)} cy={y(d.raw[k - base] as number)} r={2} style={{ fill: "var(--viz-blue)" }} />
                  ))}
                </>
              )}

              {hoverIn && (
                <>
                  <line x1={t.cx(p.hover!)} x2={t.cx(p.hover!)} y1={0} y2={ih} strokeWidth={1} style={{ stroke: "var(--ink-2)" }} />
                  {p.layer !== "anomaly" && isNum(hv) && (
                    <circle cx={t.cx(p.hover!)} cy={y(hv)} r={3.5} strokeWidth={1.5} style={{ fill: "var(--viz-blue)", stroke: "var(--paper)" }} />
                  )}
                </>
              )}
            </g>

            {sb && (
              <g>
                <rect {...sb} y={0} height={ih} fill="none" strokeWidth={1.5} style={{ stroke: "var(--focus)" }} />
                {[sb.x, sb.x + sb.width].map((x, i) => (
                  <rect key={i} x={x - 4} y={ih / 2 - 14} width={8} height={28} rx={3} strokeWidth={1.25} style={{ fill: "var(--paper)", stroke: "var(--focus)" }} />
                ))}
              </g>
            )}

            {ev && ev.width > 26 && (
              <text x={ev.x + ev.width / 2} y={-7} textAnchor="middle" style={{ ...axisText, fill: "var(--ink)", fontWeight: 600 }}>{COPY.lanes.event}</text>
            )}
            {guides.map((g) => (
              <text key={g.k} x={t.iw + 5} y={g.y} dy="0.32em" className="tnum" style={{ ...axisText, fill: "var(--ink-3)", fontSize: 10 }}>
                {g.k > 0 ? "+" : "−"}{Math.abs(g.k)}σ
              </text>
            ))}

            <line x1={0} x2={t.iw} y1={ih} y2={ih} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
            {timeTicks(t).map((tk) => (
              <g key={tk.at} transform={`translate(${t.x(tk.at)},${ih})`}>
                <line y2={tk.major ? 5 : 3} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
                <text y={17} textAnchor="middle" className="tnum" style={{ ...axisText, fontWeight: tk.major ? 600 : 400 }}>{tk.label}</text>
              </g>
            ))}
          </g>
        </svg>
      )}
      <div
        className="absolute"
        style={{ left: GUTTER_L, width: t.iw, top: 0, height: TOP + ih, ...drag.style }}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
        onPointerLeave={drag.onPointerLeave}
      />
      {p.showTip && hoverIn && width > 0 && (
        <ChartTooltip x={GUTTER_L + t.cx(p.hover!)} width={width - GUTTER_R}>
          <MonthTip lane={p.lane} k={p.hover!} />
        </ChartTooltip>
      )}
    </div>
  );
}

function lonePoints(raw: (number | null)[], base: number, view: Span): number[] {
  const out: number[] = [];
  for (let k = view.s; k <= view.e; k++) {
    const i = k - base;
    if (isNum(raw[i]) && !isNum(raw[i - 1]) && !isNum(raw[i + 1])) out.push(k);
  }
  return out;
}
