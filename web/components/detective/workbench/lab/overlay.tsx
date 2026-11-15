"use client";
// What the open test draws on LaneChart. On every layer: shaded spans ("bands": similar periods, states, flagged
// months) behind the series. On the Anomaly layer only (they are in anomaly units): fit segments as a thin ink line on
// a 2 px surface halo (dashed where the lab says so), and for Pettitt a dashed rule at the break.
import type { TimeScale } from "../axis";
import { COPY } from "../copy";
import { anomalyColor } from "../types";
import type { BandFill, LabOverlay } from "./tests";

/** CSS colour of a band fill: low / high follow the variable's anomaly colours. */
export const bandColor = (f: BandFill, polarity: "cool" | "warm") =>
  f === "low" ? anomalyColor(false, polarity) : f === "high" ? anomalyColor(true, polarity) : f === "focus" ? "var(--focus)" : "var(--ink)";

export function LabBandMarks({ overlay, base, t, ih, polarity }: { overlay: LabOverlay; base: number; t: TimeScale; ih: number; polarity: "cool" | "warm" }) {
  if (!overlay.bands.length) return null;
  return (
    <g pointerEvents="none">
      {overlay.bands.map((b, i) => {
        const x0 = t.x(b.x0 + base), x1 = t.x(b.x1 + base + 1);
        if (x1 < 0 || x0 > t.iw) return null;
        const w = Math.max(2, x1 - x0), c = bandColor(b.fill, polarity);
        return (
          <g key={i}>
            <rect x={x0} width={w} y={0} height={ih} style={{ fill: c, opacity: 0.17 }} />
            <rect x={x0} width={w} y={0} height={3} style={{ fill: c }} />
            {b.label && w > 10 && (
              <text x={x0 + w / 2} y={16} textAnchor="middle" style={{ fill: "var(--ink)", fontSize: 11, fontWeight: 700, paintOrder: "stroke", stroke: "var(--well)", strokeWidth: 3 }}>{b.label}</text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Legend entries for the bands, appended to the chart legend while a band overlay is shown. */
export function BandLegend({ overlay, polarity }: { overlay: LabOverlay | null; polarity: "cool" | "warm" }) {
  if (!overlay || !overlay.bands.length) return null;
  return (
    <>
      {overlay.legend.map((l) => (
        <span key={l.text} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true" className="inline-block h-2.5 w-3 rounded-[2px] border-t-[2px]" style={{ background: `color-mix(in srgb, ${bandColor(l.fill, polarity)} 22%, transparent)`, borderColor: bandColor(l.fill, polarity) }} />
          {l.text}
        </span>
      ))}
    </>
  );
}

export function LabOverlayMarks({ overlay, base, t, y, ih }: {
  overlay: LabOverlay;
  /** absolute month index of d.months[0] */
  base: number;
  t: TimeScale;
  y: (v: number) => number;
  ih: number;
}) {
  const xb = overlay.breakAfter != null ? t.x(overlay.breakAfter + base) : null;
  return (
    <g pointerEvents="none">
      {overlay.segments.map((s, i) => {
        const p = { x1: t.cx(s.x0 + base), x2: t.cx(s.x1 + base), y1: y(s.y0), y2: y(s.y1) };
        return (
          <g key={i}>
            <line {...p} strokeWidth={5} strokeLinecap="round" style={{ stroke: "var(--well)" }} />
            <line {...p} strokeWidth={1.75} strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} style={{ stroke: "var(--ink)" }} />
          </g>
        );
      })}
      {xb != null && xb >= 0 && xb <= t.iw && (
        <g>
          <line x1={xb} x2={xb} y1={0} y2={ih} strokeWidth={1.5} strokeDasharray="4 3" style={{ stroke: "var(--ink)" }} />
          <text x={xb + 4} y={14} style={{ fill: "var(--ink)", fontSize: 10, fontWeight: 600, paintOrder: "stroke", stroke: "var(--well)", strokeWidth: 3 }}>{COPY.lab.breakMark}</text>
        </g>
      )}
    </g>
  );
}
