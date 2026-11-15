"use client";
// The Time tab: a big read-out of the chosen months over a zoomable timeline of the whole record.
//   drag on empty track  → new range        drag inside the range → move it      drag an edge → resize
//   click                → that month (zoomed in) or that year (zoomed out)
//   wheel                → zoom around the pointer      shift+wheel / trackpad sideways → pan
//   the overview strip under it shows the whole record; drag its window to pan.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { TimeRange } from "@/lib/detective/contracts";
import { formatRange, formatYm, ymFromIndex, ymIndex } from "@/lib/detective/url";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { anomalyVar, meanZ, type AnomalyBars } from "./useIntervalAnomaly";

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MIN_SPAN = 12;

export interface TimePickerProps {
  time: TimeRange | null;
  onChange: (next: TimeRange | ((current: TimeRange | null) => TimeRange)) => void;
  bounds: TimeRange;
  padMonths: number;
  suggestion: TimeRange | null;
  /** the sub-basin's real monthly anomaly for one picked variable, drawn behind the track */
  bars?: AnomalyBars | null;
  /** where the bars come from, e.g. "Indus basin" */
  place?: string;
  /** inside the questionnaire's drop-down: no big read-out, no card */
  compact?: boolean;
}

type Drag =
  | { kind: "new"; anchor: number; at: number; moved: boolean }
  | { kind: "move"; grab: number; s: number; e: number }
  | { kind: "start" | "end"; s: number; e: number };

export function TimePicker({ time, onChange, bounds, padMonths, suggestion, bars, place, compact = false }: TimePickerProps) {
  const A = ymIndex(bounds.start), B = ymIndex(bounds.end) + 1; // record = [A, B)
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const W = Math.max(1, width);
  const initialView = (): [number, number] => {
    if (!time) return [A, B];
    const s = ymIndex(time.start), e = ymIndex(time.end) + 1;
    const span = Math.min(B - A, Math.max(36, (e - s) * 8));
    const c = (s + e) / 2;
    return clampView(c - span / 2, c + span / 2, A, B);
  };
  const [view, setView] = useState<[number, number]>(initialView);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [v0, v1] = view;
  const span = v1 - v0;
  const ppm = W / span;
  const x = (m: number) => (m - v0) * ppm;
  const mAt = (clientX: number, el: Element) => v0 + ((clientX - el.getBoundingClientRect().left) / W) * span;

  const sel = useMemo(() => {
    if (drag?.kind === "new") return [Math.min(drag.anchor, drag.at), Math.max(drag.anchor, drag.at) + 1] as const;
    if (drag) return [drag.s, drag.e] as const;
    return time ? ([ymIndex(time.start), ymIndex(time.end) + 1] as const) : null;
  }, [drag, time]);

  /* ---------------- wheel: zoom / pan (non-passive, so it does not scroll the page) */
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [a, b] = viewRef.current;
      const s = b - a;
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horizontal) {
        const d = ((e.shiftKey ? e.deltaY : e.deltaX) / el.getBoundingClientRect().width) * s;
        setView(clampView(a + d, b + d, A, B));
        return;
      }
      const at = a + ((e.clientX - el.getBoundingClientRect().left) / el.getBoundingClientRect().width) * s;
      const f = Math.exp(e.deltaY * 0.0022);
      const ns = Math.max(MIN_SPAN, Math.min(B - A, s * f));
      const t = (at - a) / s;
      setView(clampView(at - t * ns, at - t * ns + ns, A, B));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [A, B, width]);

  const zoom = (f: number) => {
    const c = sel ? (sel[0] + sel[1]) / 2 : (v0 + v1) / 2;
    const ns = Math.max(MIN_SPAN, Math.min(B - A, span * f));
    setView(clampView(c - ns / 2, c + ns / 2, A, B));
  };

  /* ---------------- pointer on the main track */
  const down = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = mAt(e.clientX, e.currentTarget);
    const mi = Math.floor(m);
    if (sel) {
      const edge = 7 / ppm;
      if (Math.abs(m - sel[0]) <= Math.max(edge, 0.3)) return setDrag({ kind: "start", s: sel[0], e: sel[1] });
      if (Math.abs(m - sel[1]) <= Math.max(edge, 0.3)) return setDrag({ kind: "end", s: sel[0], e: sel[1] });
      if (m > sel[0] && m < sel[1]) return setDrag({ kind: "move", grab: mi, s: sel[0], e: sel[1] });
    }
    setDrag({ kind: "new", anchor: clampM(mi), at: clampM(mi), moved: false });
  };
  const clampM = (m: number) => Math.max(A, Math.min(B - 1, m));
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const m = Math.floor(mAt(e.clientX, e.currentTarget));
    const r = Math.round(mAt(e.clientX, e.currentTarget));
    if (drag.kind === "new") { const at = clampM(m); if (at !== drag.at) setDrag({ ...drag, at, moved: true }); }
    else if (drag.kind === "move") {
      const len = drag.e - drag.s;
      const s = Math.max(A, Math.min(B - len, drag.s + (m - drag.grab)));
      if (s !== drag.s) setDrag({ ...drag, s, e: s + len, grab: drag.grab + (s - drag.s) });
    } else if (drag.kind === "start") setDrag({ ...drag, s: Math.max(A, Math.min(drag.e - 1, r)) });
    else setDrag({ ...drag, e: Math.min(B, Math.max(drag.s + 1, r)) });
  };
  const up = () => {
    if (!drag) return;
    if (drag.kind === "new" && !drag.moved) {
      if (ppm >= 14) onChange({ start: ymFromIndex(drag.anchor), end: ymFromIndex(drag.anchor) });
      else { const y = Math.floor(drag.anchor / 12) * 12; onChange({ start: ymFromIndex(Math.max(A, y)), end: ymFromIndex(Math.min(B - 1, y + 11)) }); }
    } else if (sel) onChange({ start: ymFromIndex(sel[0]), end: ymFromIndex(sel[1] - 1) });
    setDrag(null);
  };

  /* ---------------- ticks */
  const yearStep = [1, 2, 5, 10].find((k) => 12 * k * ppm >= 52) ?? 10;
  const monthLabels = ppm >= 30 ? 1 : ppm >= 12 ? 3 : 0;
  const ticks: { m: number; label: string; major: boolean }[] = [];
  for (let m = Math.ceil(v0); m < v1; m++) {
    const mo = ((m % 12) + 12) % 12;
    const y = Math.floor(m / 12);
    if (mo === 0 && y % yearStep === 0) ticks.push({ m, label: String(y), major: true });
    else if (monthLabels && mo % monthLabels === 0) ticks.push({ m, label: MONTH[mo], major: false });
  }

  const H = 120, top = 26, trackH = 56;
  const len = sel ? sel[1] - sel[0] : 0;
  const shown: TimeRange | null = sel ? { start: ymFromIndex(sel[0]), end: ymFromIndex(sel[1] - 1) } : null;
  const offer = suggestion && !(time && ymIndex(time.start) >= ymIndex(suggestion.start) && ymIndex(time.end) <= ymIndex(suggestion.end)) ? suggestion : null;

  return (
    <div className="mx-auto max-w-5xl">
      {/* timeline */}
      <div className={compact ? "rounded-[0.9rem] border border-line p-4 text-ink" : "rounded-[1.5rem] border border-space-line bg-paper/90 p-5 text-ink shadow-card backdrop-blur-xl"}>
      <div className={compact ? "hidden" : "text-center"}>
        <p className="font-display text-4xl leading-tight text-ink tnum sm:text-5xl">
          {shown ? (
            len === 1 ? formatYm(shown.start) : <>{formatYm(shown.start)} <span className="text-ink-3">→</span> {formatYm(shown.end)}</>
          ) : (
            <span className="text-ink-3">Pick the months</span>
          )}
        </p>
        <p className="mt-1 min-h-6 text-ink-3 tnum">
          {shown ? `${len} month${len === 1 ? "" : "s"}` : ""}
          {bars && sel && (() => {
            const z = meanZ(bars, sel[0], sel[1]);
            if (z == null) return null;
            return (
              <span className="ml-3" title={`Mean monthly anomaly of ${bars.label.toLowerCase()}${place ? ` in ${place}` : ""} over these months (seasonal cycle and trend removed)`}>
                · {bars.label} <b className="tnum" style={{ color: anomalyVar(bars, z) === "--viz-map-mid" ? "var(--ink)" : `var(${anomalyVar(bars, z)})` }}>{z < 0 ? "−" : "+"}{Math.abs(z).toFixed(1)}σ</b>
              </span>
            );
          })()}
          {offer && (
            <button type="button" onClick={() => onChange(offer)} title="Read from your description" className="ml-3 rounded-full bg-well px-3 py-0.5 text-sm text-ink hover:bg-line">
              Use {formatRange(offer)}
            </button>
          )}
        </p>
      </div>

        <div className="mb-2 flex items-center justify-end gap-1 text-sm">
          {sel && (
            <ToolBtn title="Zoom to the selection" onClick={() => { const c = (sel[0] + sel[1]) / 2, s = Math.max(MIN_SPAN, len * 6); setView(clampView(c - s / 2, c + s / 2, A, B)); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg>
            </ToolBtn>
          )}
          <ToolBtn title="Zoom out" onClick={() => zoom(1.6)}>−</ToolBtn>
          <ToolBtn title="Zoom in" onClick={() => zoom(1 / 1.6)}>+</ToolBtn>
          <ToolBtn title="Whole record" onClick={() => setView([A, B])}>All</ToolBtn>
        </div>
        <div ref={ref} className="w-full select-none">
          {width > 0 && (
            <svg
              ref={svgRef}
              width={W}
              height={H}
              className="block touch-none"
              style={{ cursor: drag?.kind === "move" ? "grabbing" : "crosshair" }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => setDrag(null)}
            >
              <rect x={0} y={top} width={W} height={trackH} rx={10} fill="var(--well)" />
              {/* month cells when zoomed in */}
              {ppm >= 6 && Array.from({ length: Math.ceil(span) + 1 }, (_, i) => Math.floor(v0) + i).map((m) => (
                <line key={m} x1={x(m)} x2={x(m)} y1={top + 6} y2={top + trackH - 6} stroke="var(--line)" strokeWidth={m % 12 === 0 ? 1.5 : 0.75} />
              ))}
              {bars && bars.z.map((z, i) => {
                const m = bars.start + i;
                if (z == null || m + 1 < v0 || m > v1) return null;
                const half = trackH / 2 - 4;
                const h = Math.min(half, (Math.abs(z) / 3) * half);
                const cy = top + trackH / 2;
                return (
                  <rect key={`z${m}`} x={x(m) + (ppm > 4 ? 0.5 : 0)} y={z > 0 ? cy - h : cy} width={Math.max(0.6, ppm - (ppm > 4 ? 1 : 0))} height={Math.max(0.5, h)} fill={(z > 0) === bars.highCool ? "var(--viz-cool)" : "var(--viz-warm)"} opacity={0.7} />
                );
              })}
              {sel && (
                <>
                  <rect x={x(sel[0] - padMonths)} y={top} width={Math.max(0, x(sel[1] + padMonths) - x(sel[0] - padMonths))} height={trackH} fill="var(--q-accent, var(--viz-orange))" opacity={0.12}>
                    <title>{`The ${padMonths} months either side are left out of the baseline`}</title>
                  </rect>
                  <rect x={x(sel[0])} y={top - 4} width={Math.max(3, x(sel[1]) - x(sel[0]))} height={trackH + 8} rx={8} fill="color-mix(in srgb, var(--q-accent, var(--viz-orange)) 22%, transparent)" stroke="var(--q-accent, var(--viz-orange))" strokeWidth={2.5} style={{ cursor: "grab" }} />
                  {[sel[0], sel[1]].map((m, k) => (
                    <rect key={k} x={x(m) - 4} y={top + trackH / 2 - 14} width={8} height={28} rx={4} fill="var(--paper)" stroke="var(--q-accent, var(--viz-orange))" strokeWidth={2} style={{ cursor: "ew-resize" }} />
                  ))}
                </>
              )}
              {ticks.map((t) => (
                <g key={t.m}>
                  <line x1={x(t.m)} x2={x(t.m)} y1={top + trackH} y2={top + trackH + (t.major ? 10 : 5)} stroke="var(--viz-axis)" />
                  <text x={t.major ? x(t.m) : x(t.m) + 3} y={top + trackH + 26} textAnchor={t.major ? "middle" : "start"} fontSize={t.major ? 13 : 11} fontWeight={t.major ? 600 : 400} fill={t.major ? "var(--ink)" : "var(--ink-3)"} className="tnum">
                    {t.label}
                  </text>
                </g>
              ))}
            </svg>
          )}
          {bars && (
            <p className="mt-2 text-xs text-ink-3" title="Bars: this basin's monthly anomaly (seasonal cycle and trend removed). Globe: the long-term trend map of the same variable; the basin glows by the mean anomaly of the selected months.">
              {bars.label}{place ? ` · ${place}` : ""} · real NASA data
            </p>
          )}
          {width > 0 && <Overview A={A} B={B} view={view} sel={sel} W={W} onPan={(a) => setView(clampView(a, a + span, A, B))} />}
        </div>
      </div>
    </div>
  );
}

function Overview({ A, B, view, sel, W, onPan }: { A: number; B: number; view: [number, number]; sel: readonly [number, number] | null; W: number; onPan: (a: number) => void }) {
  const k = W / (B - A);
  const [grab, setGrab] = useState<number | null>(null);
  const whole = view[0] <= A && view[1] >= B;
  if (whole) return null;
  return (
    <svg
      width={W}
      height={18}
      className="mt-2 block touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const m = A + (e.clientX - e.currentTarget.getBoundingClientRect().left) / k;
        const off = m >= view[0] && m <= view[1] ? m - view[0] : (view[1] - view[0]) / 2;
        setGrab(off);
        onPan(m - off);
      }}
      onPointerMove={(e) => { if (grab !== null) onPan(A + (e.clientX - e.currentTarget.getBoundingClientRect().left) / k - grab); }}
      onPointerUp={() => setGrab(null)}
    >
      <rect x={0} y={6} width={W} height={6} rx={3} fill="var(--well)" />
      {sel && <rect x={(sel[0] - A) * k} y={4} width={Math.max(2, (sel[1] - sel[0]) * k)} height={10} rx={2} fill="var(--q-accent, var(--viz-orange))" />}
      <rect x={(view[0] - A) * k} y={1} width={(view[1] - view[0]) * k} height={16} rx={5} fill="none" stroke="var(--ink-3)" strokeWidth={1.5} style={{ cursor: "grab" }} />
    </svg>
  );
}

function ToolBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="grid h-8 min-w-8 place-items-center rounded-full px-2 font-semibold text-ink-2 hover:bg-well hover:text-ink">
      {children}
    </button>
  );
}

function clampView(a: number, b: number, A: number, B: number): [number, number] {
  const s = Math.min(b - a, B - A);
  let lo = a;
  if (lo < A) lo = A;
  if (lo + s > B) lo = B - s;
  return [lo, lo + s];
}

