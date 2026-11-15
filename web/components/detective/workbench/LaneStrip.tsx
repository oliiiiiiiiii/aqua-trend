"use client";
// A collapsed lane's anomaly strip: z in σ units on a symmetric domain max(3, max |z| in view),
// ±2σ guides, the event band, the shared selection and the shared crosshair.
import { useElementWidth } from "@/components/charts/useElementWidth";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { GUTTER_L, barsPath, gapRuns, isNum, timeScale } from "./axis";
import type { Span } from "./model";
import { anomalyColor, type LaneReady } from "./types";
import { useSelectionDrag } from "./useSelectionDrag";
import { MonthTip } from "./MonthTip";

export const STRIP_H = 44;

export interface StripProps {
  lane: LaneReady;
  name: string;
  polarity: "cool" | "warm";
  view: Span;
  event: Span;
  sel: Span;
  hover: number | null;
  showTip: boolean;
  onSel: (s: Span) => void;
  onCommit: (s: Span) => void;
  onHover: (k: number | null) => void;
  onTap: () => void;
}

export default function LaneStrip(p: StripProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const t = timeScale(p.view, width || 600);
  const { d, base } = p.lane;
  const h = STRIP_H, mid = h / 2, half = h / 2 - 3;

  let M = 3;
  for (let k = p.view.s; k <= p.view.e; k++) {
    const z = d.z[k - base];
    if (isNum(z)) M = Math.max(M, Math.abs(z));
  }
  const y = (z: number) => mid - (z / M) * half;
  const drag = useSelectionDrag({ t, sel: p.sel, onChange: p.onSel, onCommit: p.onCommit, onHover: p.onHover, onTap: p.onTap });

  const band = (s: Span) => {
    const x0 = Math.max(0, t.x(s.s)), x1 = Math.min(t.iw, t.x(s.e + 1));
    return x1 > x0 ? { x: x0, width: x1 - x0 } : null;
  };
  const ev = band(p.event);
  const sb = band(p.sel);
  const g2 = Math.abs(y(2) - mid) >= 7;
  const hoverIn = p.hover != null && p.hover >= p.view.s && p.hover <= p.view.e;

  return (
    <div ref={ref} className="relative min-w-0 select-none" style={{ height: h }}>
      {width > 0 && (
        <svg width={width} height={h} aria-hidden="true" className="block overflow-visible">
          <g transform={`translate(${GUTTER_L},0)`}>
            {ev && (
              <g>
                <rect x={ev.x} width={ev.width} y={0} height={h} style={{ fill: "var(--action)", opacity: "var(--event-band-opacity)" }} />
                <rect x={ev.x} width={ev.width} y={0} height={2} style={{ fill: "var(--action)" }} />
              </g>
            )}
            {gapRuns(d.raw, base, p.view).map((g) => {
              const b = band(g);
              return b ? <rect key={g.s} {...b} y={0} height={h} style={{ fill: "var(--ink)", opacity: 0.09 }} /> : null;
            })}
            <line x1={0} x2={t.iw} y1={mid} y2={mid} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
            {[-2, 2].map((k) => (
              <line key={k} x1={0} x2={t.iw} y1={y(k)} y2={y(k)} strokeWidth={1} strokeDasharray="3 3" style={{ stroke: "var(--ink-3)", opacity: 0.6 }} />
            ))}
            <path d={barsPath(t, d.z, base, y, mid, (v) => v >= 0)} style={{ fill: anomalyColor(true, p.polarity) }} />
            <path d={barsPath(t, d.z, base, y, mid, (v) => v < 0)} style={{ fill: anomalyColor(false, p.polarity) }} />
            {sb && (
              <g>
                <rect {...sb} y={0} height={h} style={{ fill: "var(--focus)", opacity: 0.07 }} />
                <rect {...sb} y={0.5} height={h - 1} fill="none" strokeWidth={1.5} style={{ stroke: "var(--focus)" }} />
                {[sb.x, sb.x + sb.width].map((x, i) => (
                  <rect key={i} x={x - 3} y={mid - 8} width={6} height={16} rx={2} strokeWidth={1} style={{ fill: "var(--paper)", stroke: "var(--focus)" }} />
                ))}
              </g>
            )}
            {hoverIn && <line x1={t.cx(p.hover!)} x2={t.cx(p.hover!)} y1={0} y2={h} strokeWidth={1} style={{ stroke: "var(--ink-2)" }} />}
          </g>
          <g className="tnum" style={{ fill: "var(--ink-3)", fontSize: 10 }}>
            {g2 && <text x={GUTTER_L - 6} y={y(2)} dy="0.32em" textAnchor="end">+2σ</text>}
            {g2 && <text x={GUTTER_L - 6} y={y(-2)} dy="0.32em" textAnchor="end">−2σ</text>}
            {!g2 && <text x={GUTTER_L - 6} y={y(M) + 4} dy="0.32em" textAnchor="end">±{Math.round(M)}σ</text>}
          </g>
        </svg>
      )}
      <div
        className="absolute inset-y-0"
        style={{ left: GUTTER_L, width: t.iw, ...drag.style }}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
        onPointerLeave={drag.onPointerLeave}
      />
      {p.showTip && hoverIn && width > 0 && (
        <ChartTooltip x={GUTTER_L + t.cx(p.hover!)} width={width}>
          <MonthTip lane={p.lane} k={p.hover!} />
        </ChartTooltip>
      )}
    </div>
  );
}
