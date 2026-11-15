"use client";
// What the open test draws on LaneChart's Anomaly layer: fit segments as a thin ink line on a 2 px
// surface halo (dashed where the lab says so), and for Pettitt a dashed rule at the break.
import type { TimeScale } from "../axis";
import { COPY } from "../copy";
import type { LabOverlay } from "./tests";

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
