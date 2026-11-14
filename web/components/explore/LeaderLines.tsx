"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { OrbAnchors } from "@/lib/contracts";
import { readValue } from "@/components/orb/encoding";
import type { VarId } from "@/lib/types";
import { VARIABLES } from "@/lib/variables";

interface Leader { v: VarId; d: string; tx: number; ty: number; dashed: boolean }

/**
 * Thin leader lines from each target's read-out row to the part of the ball that value drives. The ball reports where
 * it drew each channel (`CrystalBall onAnchors`, projected from the 3D scene), so the line follows the camera and
 * works for every scenery. Drawn in the stage's own pixel space; the overlay never takes pointer events and is not animated.
 */
export function LeaderLines({
  stageRef, ballRef, rows, anchors, targets, values, missing,
}: {
  stageRef: RefObject<HTMLElement | null>;
  /** element the anchors are relative to (the CrystalBall root) */
  ballRef: RefObject<HTMLElement | null>;
  rows: RefObject<Partial<Record<VarId, HTMLElement | null>>>;
  anchors: OrbAnchors;
  targets: VarId[];
  values: Partial<Record<VarId, number | null>>;
  /** no land-model series: every value is missing */
  missing: boolean;
}) {
  const [geo, setGeo] = useState<{ w: number; h: number; leaders: Leader[] }>({ w: 0, h: 0, leaders: [] });
  const lastKey = useRef("");
  const latest = useRef({ anchors, targets, values, missing });
  latest.current = { anchors, targets, values, missing };

  const measure = useCallback(() => {
    const stage = stageRef.current, ball = ballRef.current;
    if (!stage || !ball) return;
    const sb = stage.getBoundingClientRect(), bb = ball.getBoundingClientRect();
    const { anchors: A, targets: T, values: V, missing: none } = latest.current;
    const leaders: Leader[] = [];
    for (const v of T) {
      const a = A[v], row = rows.current?.[v];
      if (!a || !a.visible || !row) continue;
      const r = row.getBoundingClientRect();
      const card = row.closest("section")?.getBoundingClientRect();
      const head = (row.firstElementChild as HTMLElement | null)?.getBoundingClientRect() ?? r;
      const x1 = (card ? card.left : r.left) - sb.left;
      const y1 = head.top + head.height / 2 - sb.top;
      if (card && (head.top + head.height / 2 < card.top || head.top + head.height / 2 > card.bottom)) continue; // scrolled out of the read-out
      const tx = a.x + bb.left - sb.left, ty = a.y + bb.top - sb.top;
      // a short stub out of the card, then one straight run to the target
      const xs = x1 - 14;
      leaders.push({
        v, tx, ty,
        d: `M${x1.toFixed(1)} ${y1.toFixed(1)}H${xs.toFixed(1)}L${tx.toFixed(1)} ${ty.toFixed(1)}`,
        dashed: readValue(v, none ? null : V[v]).missing,
      });
    }
    const key = `${Math.round(sb.width)}x${Math.round(sb.height)}|${leaders.map((l) => l.d + l.dashed).join("|")}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    setGeo({ w: sb.width, h: sb.height, leaders });
  }, [stageRef, ballRef, rows]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (stageRef.current) ro.observe(stageRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true); // the read-out column and the page both scroll
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [measure, stageRef]);
  // anchors / values / targets changed
  useEffect(() => { measure(); }, [measure, anchors, targets, values, missing]);

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 overflow-visible" width={geo.w} height={geo.h}>
      {geo.leaders.map((l) => (
        <g key={l.v}>
          <path d={l.d} fill="none" stroke="var(--stage)" strokeWidth={4} strokeOpacity={0.7} strokeLinejoin="round" />
          <path d={l.d} fill="none" stroke="var(--on-stage)" strokeWidth={1.25} strokeLinejoin="round" strokeDasharray={l.dashed ? "4 3" : undefined} />
          <circle cx={l.tx} cy={l.ty} r={5} fill="var(--stage)" fillOpacity={0.7} />
          <circle cx={l.tx} cy={l.ty} r={3} fill={l.dashed ? "var(--stage)" : `var(${VARIABLES[l.v].color})`} stroke="var(--on-stage)" strokeWidth={1.25} />
        </g>
      ))}
    </svg>
  );
}
