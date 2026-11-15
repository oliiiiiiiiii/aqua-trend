"use client";
// The When strip: the whole record as a zoomable, pannable timeline with the event period on it.
//   wheel / pinch over the strip  zoom about the pointer      drag the background  select a range
//   drag the orange bar           move the period             drag either handle   resize the period
//   overview bar below            drag its window to pan      keys: arrows move the range, + - zoom, Shift+arrows resize the end
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TimeRange } from "@/lib/detective/contracts";
import { ymFromIndex, ymIndex } from "@/lib/detective/url";
import { eventDays } from "@/lib/detective/window";
import { dayNumber, dayString } from "@/lib/detective/daily";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { COPY } from "./copy/input";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAD_X = 10;
const H = 66;
const HIT = 12; // half of the 24 px handle hit area
const MIN_SPAN = 6; // months across the strip at full zoom
const OV_H = 20;

interface View { lo: number; span: number }
type Mode = "new" | "move" | "start" | "end";
interface Session { mode: Mode; x0: number; view: View; s: number; e: number; moved: boolean; px: number; range?: TimeRange }

const monthDays = (i: number) => Number(eventDays({ start: ymFromIndex(i), end: ymFromIndex(i) }).end.slice(8, 10));
const dayIndex = (day: string, end = false) => ymIndex(day) + (Number(day.slice(8, 10)) - (end ? 0 : 1)) / monthDays(ymIndex(day));
const sessionRange = (s: Session): TimeRange => s.range ?? { start: ymFromIndex(s.s), end: ymFromIndex(s.e) };

export function Timeline({ bounds, time, onChange, onPreviewChange }: { bounds: TimeRange; time: TimeRange | null; onChange: (r: TimeRange) => void; onPreviewChange: (r: TimeRange | null) => void }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const a = ymIndex(bounds.start), b = ymIndex(bounds.end);
  const full = Math.max(1, b - a + 1);
  const w = Math.max(0, width);
  const inner = Math.max(1, w - 2 * PAD_X);

  const clampView = useCallback((lo: number, span: number): View => {
    const sp = Math.max(Math.min(MIN_SPAN, full), Math.min(full, span));
    return { lo: Math.max(a, Math.min(a + full - sp, lo)), span: sp };
  }, [a, full]);
  /** about three years either side of the period; the whole record without one */
  const around = useCallback((t: TimeRange | null): View => {
    if (!t) return { lo: a, span: full };
    const s = ymIndex(t.start), e = ymIndex(t.end) + 1;
    const span = e - s + 72;
    return clampView((s + e) / 2 - span / 2, span);
  }, [a, full, clampView]);

  const [view, setView] = useState<View>(() => around(time));
  const viewRef = useRef(view);
  viewRef.current = view;
  const userView = useRef(false);
  const [sess, setSess] = useState<Session | null>(null);
  const sessRef = useRef<Session | null>(null);
  const [cursor, setCursor] = useState("crosshair");

  // keep the period in view when it changes from elsewhere (selects, "Use" suggestion, link)
  const key = time ? time.start + time.end : "";
  useEffect(() => {
    if (!time || sessRef.current) return;
    setView((v) => {
      if (!userView.current) return around(time);
      const s = ymIndex(time.start), e = ymIndex(time.end) + 1;
      if (s >= v.lo && e <= v.lo + v.span) return v;
      return clampView((s + e) / 2 - v.span / 2, Math.max(v.span, e - s + 6));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    setView((v) => userView.current ? clampView(v.lo, v.span) : around(time));
    // Bounds can expand when the catalogue arrives; an untouched view should still fit the full record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampView, around]);

  const ppm = inner / view.span;
  const x = (i: number) => PAD_X + (i - view.lo) * ppm;
  const indexAt = (px: number) => view.lo + (px - PAD_X) / ppm;

  const sel = time ? { s: ymIndex(time.start), e: ymIndex(time.end) } : null;
  const shownDays = sess ? eventDays(sessionRange(sess)) : time ? eventDays(time) : null;
  const shown = shownDays ? { s: dayIndex(shownDays.start), e: dayIndex(shownDays.end, true) - 1 } : null;
  const dayAt = (px: number) => {
    const i = Math.max(a, Math.min(b + 1 - 1e-7, indexAt(px)));
    const m = Math.floor(i);
    return dayNumber(`${ymFromIndex(m)}-01`)! + Math.min(monthDays(m) - 1, Math.floor((i - m) * monthDays(m)));
  };

  const zoomAt = useCallback((factor: number, anchorFrac: number) => {
    userView.current = true;
    setView((v) => {
      const span = Math.max(Math.min(MIN_SPAN, full), Math.min(full, v.span * factor));
      const m = v.lo + anchorFrac * v.span;
      return clampView(m - anchorFrac * span, span);
    });
  }, [full, clampView]);
  const panBy = useCallback((months: number) => {
    userView.current = true;
    setView((v) => clampView(v.lo + months, v.span));
  }, [clampView]);

  // wheel needs a non-passive listener to keep the page from scrolling while the pointer is over the strip
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { panBy((e.deltaX / Math.max(1, r.width - 2 * PAD_X)) * viewRef.current.span); return; }
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left - PAD_X) / Math.max(1, r.width - 2 * PAD_X)));
      zoomAt(Math.exp((e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))), frac);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, panBy, zoomAt]);

  const zoneAt = (px: number): Mode => {
    if (shown) {
      const sx = x(shown.s), ex = x(shown.e + 1);
      const dS = Math.abs(px - sx), dE = Math.abs(px - ex);
      if (Math.min(dS, dE) <= HIT) return dS < dE || (dS === dE && px < sx) ? "start" : "end";
      if (px > sx && px < ex) return "move";
    }
    return "new";
  };
  const local = (e: PointerEvent<SVGSVGElement>) => e.clientX - e.currentTarget.getBoundingClientRect().left;
  const begin = (s: Session) => {
    sessRef.current = s;
    setSess(s);
    onPreviewChange(sessionRange(s));
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const px = local(e);
    ref.current?.focus({ preventScroll: true });
    const mode = zoneAt(px);
    const month = Math.max(a, Math.min(b, Math.floor(indexAt(px))));
    const range = view.span <= 12 ? (mode === "new" ? { start: dayString(dayAt(px)), end: dayString(dayAt(px)) } : eventDays(time!)) : undefined;
    begin({ mode, x0: e.clientX, view: viewRef.current, s: mode === "new" ? month : sel!.s, e: mode === "new" ? month : sel!.e, moved: false, px, range });
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const cur = sessRef.current;
    if (!cur) { setCursor(zoneAt(local(e)) === "new" ? "crosshair" : zoneAt(local(e)) === "move" ? "move" : "ew-resize"); return; }
    const dx = e.clientX - cur.x0;
    const moved = cur.moved || Math.abs(dx) > 3;
    if (!moved) return;
    const dm = dx / ppm;
    let next: Session = { ...cur, moved };
    if (cur.range) {
      const anchor = dayAt(cur.px), target = dayAt(local(e));
      const original = time ? eventDays(time) : cur.range;
      const s0 = dayNumber(original.start)!, e0 = dayNumber(original.end)!;
      const lo = dayNumber(`${bounds.start}-01`)!, hi = dayNumber(eventDays(bounds).end)!;
      let s = s0, end = e0;
      if (cur.mode === "new") { s = Math.min(anchor, target); end = Math.max(anchor, target); }
      else if (cur.mode === "move") {
        const delta = Math.max(lo - s0, Math.min(hi - e0, target - anchor));
        s += delta; end += delta;
      } else if (cur.mode === "start") s = Math.max(lo, Math.min(e0, s0 + target - anchor));
      else end = Math.min(hi, Math.max(s0, e0 + target - anchor));
      next.range = { start: dayString(s), end: dayString(end) };
    } else if (cur.mode === "new") {
      const anchor = Math.max(a, Math.min(b, Math.floor(cur.view.lo + (cur.px - PAD_X) / ppm)));
      const month = Math.max(a, Math.min(b, Math.floor(indexAt(local(e)))));
      next = { ...next, s: Math.min(anchor, month), e: Math.max(anchor, month) };
    } else if (time) {
      const s0 = ymIndex(time.start), e0 = ymIndex(time.end);
      if (cur.mode === "move") {
        const d = Math.max(a - s0, Math.min(b - e0, Math.round(dm)));
        next = { ...next, s: s0 + d, e: e0 + d };
      } else if (cur.mode === "start") {
        next = { ...next, s: Math.max(a, Math.min(e0, s0 + Math.round(dm))), e: e0 };
      } else {
        next = { ...next, s: s0, e: Math.min(b, Math.max(s0, e0 + Math.round(dm))) };
      }
    }
    sessRef.current = next;
    setSess(next);
    onPreviewChange(sessionRange(next));
  };
  const up = () => {
    const cur = sessRef.current;
    sessRef.current = null;
    setSess(null);
    onPreviewChange(null);
    if (!cur) return;
    if (cur.mode === "new" || cur.moved) {
      onChange(sessionRange(cur));
    }
  };
  const cancel = () => { sessRef.current = null; setSess(null); onPreviewChange(null); };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.shiftKey && sel && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const end = Math.max(sel.s, Math.min(b, sel.e + (e.key === "ArrowRight" ? 1 : -1)));
      onChange({ start: ymFromIndex(sel.s), end: ymFromIndex(end) });
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const direction = e.key === "ArrowRight" ? 1 : -1;
      const current = sel ?? { s: Math.floor(view.lo + view.span / 2), e: Math.floor(view.lo + view.span / 2) };
      const delta = Math.max(a - current.s, Math.min(b - current.e, direction));
      onChange({ start: ymFromIndex(current.s + delta), end: ymFromIndex(current.e + delta) });
    } else if (e.key === "Enter" && !sel) {
      e.preventDefault();
      const month = Math.max(a, Math.min(b, Math.floor(view.lo + view.span / 2)));
      onChange({ start: ymFromIndex(month), end: ymFromIndex(month) });
    } else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(0.6, 0.5); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAt(1 / 0.6, 0.5); }
    else if (e.key === "0" || e.key === "Home") { e.preventDefault(); userView.current = true; setView({ lo: a, span: full }); }
  };

  /* ---- ticks */
  const monthsOn = ppm >= 6;
  const labelMonths = ppm >= 26 ? "name" : ppm >= 12 ? "initial" : null;
  const yearsOn = ppm * 12;
  const yStep = [1, 2, 5, 10, 20].find((s) => yearsOn * s >= 46) ?? 20;
  const first = Math.max(a, Math.floor(view.lo)), last = Math.min(b, Math.ceil(view.lo + view.span));
  const ticks: { i: number; key: string; label: string | null; year: boolean }[] = [];
  if (monthsOn) {
    for (let i = first; i <= last; i++) {
      const m = i % 12;
      ticks.push({ i, key: `m${i}`, year: m === 0, label: labelMonths && (labelMonths === "name" ? MONTHS[m] : MONTHS[m][0]) });
    }
  }
  const yearLabels: { i: number; y: number }[] = [];
  for (let y = Math.ceil(view.lo / 12 / yStep) * yStep; y * 12 <= view.lo + view.span; y += yStep) yearLabels.push({ i: y * 12, y });
  const yearY = labelMonths ? 62 : 52;
  const zoomedOut = view.span >= full - 0.01;

  /* ---- overview */
  const oppm = inner / full;
  const ox = (i: number) => PAD_X + (i - a) * oppm;
  const [ovDrag, setOvDrag] = useState<{ x0: number; lo: number } | null>(null);
  const ovDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const v = viewRef.current;
    const inWin = px >= ox(v.lo) && px <= ox(v.lo + v.span);
    userView.current = true;
    if (!inWin) {
      const lo = clampView(a + (px - PAD_X) / oppm - v.span / 2, v.span).lo;
      setView({ lo, span: v.span });
      setOvDrag({ x0: e.clientX, lo });
    } else setOvDrag({ x0: e.clientX, lo: v.lo });
  };
  const ovMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!ovDrag) return;
    setView(clampView(ovDrag.lo + (e.clientX - ovDrag.x0) / oppm, viewRef.current.span));
  };

  const T = COPY.when;
  const btn = "grid h-6 min-w-6 place-items-center rounded-ctl px-1 text-sm text-on-stage hover:bg-on-stage/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40";
  const sxs = shown ? x(shown.s) : 0;
  const exs = shown ? x(shown.e + 1) : 0;
  const barW = Math.max(4, exs - sxs);
  return (
    <div
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label={T.stripLabel}
      aria-keyshortcuts="ArrowLeft ArrowRight + - Shift+ArrowLeft Shift+ArrowRight Enter"
      onKeyDown={onKey}
      title={T.stripTitle}
      className="mt-2 w-full select-none rounded-ctl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {w > 0 && (
        <svg
          width={w}
          height={H}
          data-timeline-strip
          className="block touch-none overflow-hidden"
          style={{ cursor: sess ? (sess.mode === "new" ? "crosshair" : sess.mode === "move" ? "move" : "ew-resize") : cursor }}
          aria-hidden="true"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
        >
          <rect x={PAD_X} y={14} width={inner} height={14} rx={7} fill="var(--well)" stroke="var(--line)" />
          {shown && <rect x={sxs} y={11} width={barW} height={20} rx={3} fill="var(--viz-orange)" />}
          {ticks.map((t) => (
            <g key={t.key}>
              <line x1={x(t.i)} x2={x(t.i)} y1={t.year ? 28 : 28} y2={t.year ? 40 : 34} stroke="var(--on-stage-2)" strokeOpacity={t.year ? 0.9 : 0.55} />
              {t.label && ppm >= 12 && x(t.i) + ppm / 2 >= PAD_X && x(t.i) + ppm / 2 <= w - PAD_X && <text x={x(t.i) + ppm / 2} y={47} textAnchor="middle" fontSize={10.5} fill="var(--on-stage-2)">{t.label}</text>}
            </g>
          ))}
          {yearLabels.map(({ i, y }) => (
            <g key={y}>
              {!monthsOn && <line x1={x(i)} x2={x(i)} y1={28} y2={36} stroke="var(--on-stage-2)" />}
              <text x={x(i)} y={yearY} textAnchor={x(i) < 16 ? "start" : x(i) > w - 16 ? "end" : "middle"} fontSize={11} fill="var(--on-stage)" className="tnum">{y}</text>
            </g>
          ))}
          {shown && [sxs, sxs + barW].map((hx, k) => (
            <g key={k}>
              <rect x={hx - 12} y={2} width={24} height={40} fill="transparent" />
              <rect x={hx - 3} y={5} width={6} height={32} rx={3} fill="var(--paper)" stroke="var(--viz-orange)" strokeWidth={1.5} />
            </g>
          ))}
        </svg>
      )}
      {w > 0 && (
        <svg
          width={w}
          height={OV_H}
          data-timeline-overview
          className="mt-1 block cursor-grab touch-none"
          aria-hidden="true"
          onPointerDown={ovDown}
          onPointerMove={ovMove}
          onPointerUp={() => setOvDrag(null)}
          onPointerCancel={() => setOvDrag(null)}
        >
          <rect x={PAD_X} y={7} width={inner} height={6} rx={3} fill="var(--well)" stroke="var(--line)" />
          {shown && <rect x={ox(shown.s)} y={5} width={Math.max(2, ox(shown.e + 1) - ox(shown.s))} height={10} rx={2} fill="var(--viz-orange)" />}
          <rect x={ox(view.lo)} y={1} width={Math.max(8, view.span * oppm)} height={18} rx={4} fill="var(--on-stage)" fillOpacity={0.12} stroke="var(--on-stage)" strokeWidth={1.5} style={{ cursor: ovDrag ? "grabbing" : "grab" }} />
        </svg>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-xs text-on-stage-2">
        <span className="inline-flex items-center gap-1.5" role="group" aria-label={T.zoom}>
          <button type="button" className={btn} aria-label={T.zoomOut} title={T.zoomOut} disabled={zoomedOut} onClick={() => zoomAt(1 / 0.6, 0.5)}>−</button>
          <button type="button" className={btn} aria-label={T.zoomIn} title={T.zoomIn} disabled={view.span <= Math.min(MIN_SPAN, full) + 0.01} onClick={() => zoomAt(0.6, 0.5)}>+</button>
          <button type="button" className={btn} title={T.fitTitle} disabled={zoomedOut} onClick={() => { userView.current = true; setView({ lo: a, span: full }); }}>{T.fit}</button>
        </span>
      </div>
    </div>
  );
}
