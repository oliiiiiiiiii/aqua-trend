"use client";
// Pointer behaviour shared by the lane strips and the expanded chart:
//   drag on empty plot = new selection, drag an edge = resize, drag inside = move,
//   a tap without movement calls onTap (strips use it to expand the lane).
// Hover reports the month under the pointer. Vertical page scrolling on touch stays native (touch-action: pan-y).
import { useRef, type PointerEvent } from "react";
import type { TimeScale } from "./axis";
import type { Span } from "./model";

const EDGE_HIT = 12; // px either side of an edge: a 24 px hit area
const TAP_SLOP = 4;

type Mode = "new" | "start" | "end" | "move";

export interface SelectionDragOptions {
  t: TimeScale;
  sel: Span;
  onChange: (s: Span) => void;
  onCommit: (s: Span) => void;
  onHover: (k: number | null) => void;
  onTap?: () => void;
}

export function useSelectionDrag(o: SelectionDragOptions) {
  const drag = useRef<null | { mode: Mode; k0: number; sel0: Span; x0: number; moved: boolean; last: Span }>(null);
  const latest = useRef(o);
  latest.current = o;

  const local = (e: PointerEvent<HTMLElement>) => e.clientX - e.currentTarget.getBoundingClientRect().left;

  const zone = (px: number): Mode => {
    const { t, sel } = latest.current;
    const xs = t.x(sel.s), xe = t.x(sel.e + 1);
    const ds = Math.abs(px - xs), de = Math.abs(px - xe);
    // a narrow selection: grab the nearer edge, but keep its middle third for moving
    const inside = px > xs && px < xe;
    const mid = inside && px > xs + (xe - xs) / 3 && px < xe - (xe - xs) / 3;
    if (!mid && (ds <= EDGE_HIT || de <= EDGE_HIT)) return ds <= de ? "start" : "end";
    return inside ? "move" : "new";
  };
  const cursorOf = (m: Mode, dragging: boolean) =>
    m === "start" || m === "end" ? "ew-resize" : m === "move" ? (dragging ? "grabbing" : "grab") : "crosshair";

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const px = local(e);
    const { t, sel } = latest.current;
    const mode = zone(px);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, k0: t.at(px), sel0: sel, x0: e.clientX, moved: false, last: sel };
    e.currentTarget.style.cursor = cursorOf(mode, true);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const px = local(e);
    const { t, onChange, onHover } = latest.current;
    const k = t.at(px);
    onHover(k);
    const g = drag.current;
    if (!g) {
      e.currentTarget.style.cursor = cursorOf(zone(px), false);
      return;
    }
    if (!g.moved && Math.abs(e.clientX - g.x0) < TAP_SLOP) return;
    g.moved = true;
    const v = t.view;
    let next: Span;
    if (g.mode === "new") next = { s: Math.min(g.k0, k), e: Math.max(g.k0, k) };
    else if (g.mode === "start") next = k <= g.sel0.e ? { s: k, e: g.sel0.e } : { s: g.sel0.e, e: k };
    else if (g.mode === "end") next = k >= g.sel0.s ? { s: g.sel0.s, e: k } : { s: k, e: g.sel0.s };
    else {
      const len = g.sel0.e - g.sel0.s;
      const s = Math.max(v.s, Math.min(v.e - len, g.sel0.s + (k - g.k0)));
      next = { s, e: s + len };
    }
    if (next.s !== g.last.s || next.e !== g.last.e) {
      g.last = next;
      onChange(next);
    }
  };

  const end = (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const g = drag.current;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    e.currentTarget.style.cursor = cursorOf(zone(local(e)), false);
    if (!g) return;
    if (g.moved) latest.current.onCommit(g.last);
    else if (!cancelled) latest.current.onTap?.();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, false),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, true),
    onPointerLeave: () => { if (!drag.current) latest.current.onHover(null); },
    style: { touchAction: "pan-y" as const, cursor: "crosshair" },
  };
}
