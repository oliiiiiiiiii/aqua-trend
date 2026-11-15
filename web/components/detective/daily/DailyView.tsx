"use client";
// The chart of the Days and Weeks windows (data and statistics: ./useFineModel). One point per day, or per 7-day
// block in the Weeks window, over [month selection − reach, month selection + reach]; the event stays marked
// wherever it falls inside.
//
// Two layers, like the monthly chart:
//   Anomaly  (default) each point minus its normal (the monthly series' trend + seasonal cycle, read at each day and
//            moved to the daily product's level). Bars from zero, in the variable's polarity colours.
//   Observed the values with that normal as a dashed line.
//
// The chart has its own selection of points, the one the statistics column and the Tests area use: drag on the plot
// to select, drag the selection to move it, drag an edge to resize; arrows move it, Shift + arrows resize, Esc goes
// back to the month selection's days. A test's fit lines and shaded spans are drawn over the Anomaly layer.
//
// Variables without a daily product get a one-line note and the monthly `fallback`.
import { useId, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import type { TimeRange } from "@/lib/detective/contracts";
import { dayNum, pointsOf, type DayRange, type PointRange } from "@/lib/detective/fine";
import { eventDays } from "@/lib/detective/window";
import { ChartTooltip, TipRow } from "@/components/charts/ChartTooltip";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { Segmented } from "@/components/ui/Segmented";
import { num } from "../format";
import { COPY } from "../copy/daily";
import { COPY as FINE } from "../copy/fine";
import { anomalyColor } from "../workbench/types";
import type { TimeScale } from "../workbench/axis";
import { useSelectionDrag } from "../workbench/useSelectionDrag";
import { LabBandMarks, LabOverlayMarks } from "../workbench/lab/overlay";
import type { LabOverlay } from "../workbench/lab/tests";
import { formatDays } from "../workbench/lab/step";
import { runs } from "./plan";
import type { DailyState } from "./useDailyRange";
import type { FineModel } from "./useFineModel";

export type DailyMode = "anomaly" | "observed";

export interface DailyViewProps {
  m: FineModel;
  /** "Precipitation" */
  name: string;
  /** shown until the daily dataset name arrives */
  product?: string;
  /** the event period: marked where it falls inside the span */
  event: TimeRange;
  /** "± 3 days around Mar 2021" */
  around: string;
  polarity?: "cool" | "warm";
  /** what the open test draws (in the lab's units: anomaly − baseline level) */
  overlay?: LabOverlay | null;
  /** move the month selection by whole months (−1 / +1); omit to hide the two buttons */
  onShift?: (months: number) => void;
  /** a new selection of days; null = back to the month selection's days */
  onSelect: (r: DayRange | null) => void;
  /** shown instead when the layer has no daily product (normally the monthly chart) */
  fallback?: ReactNode;
  className?: string;
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const MODES: { value: DailyMode; label: string; title: string }[] = [
  { value: "anomaly", label: COPY.mode.anomaly, title: COPY.modeTitle.anomaly },
  { value: "observed", label: COPY.mode.observed, title: COPY.modeTitle.observed },
];

export default function DailyView(p: DailyViewProps) {
  const { m } = p;
  const st = m.st;
  const titleId = useId();
  const [picked, setMode] = useState<DailyMode>("anomaly");
  const hasNormal = !!m.level;
  const mode: DailyMode = m.hasModel ? picked : "observed";

  if (st.phase === "unsupported") {
    return (
      <div className={p.className}>
        <p className="mb-2 text-sm text-ink-2">{COPY.noProduct}</p>
        {p.fallback}
      </div>
    );
  }

  const unit = st.unit ?? "";
  const dataset = st.source?.dataset ?? p.product;
  const step = "inline-flex h-6 w-6 items-center justify-center rounded-full border border-line text-sm text-ink hover:border-ink-3";
  const title = m.step === "week" ? (mode === "anomaly" ? COPY.title.weeklyAnomaly : COPY.title.weeklyObserved) : COPY.title[mode];
  return (
    <section aria-labelledby={titleId} className={`min-w-0 ${p.className ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h3 id={titleId} className="font-[family-name:var(--font-body-active)] text-sm font-semibold text-ink">{title}</h3>
          <p className="min-w-0 text-xs text-ink-2 tnum">{dataset ? `${dataset} · ` : ""}{formatDays(m.span.start, m.span.end)}</p>
        </div>
        {m.hasModel && <Segmented legend={COPY.modes} hideLegend tone="paper" look="underline" options={MODES} value={mode} onChange={setMode} />}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2 tnum">
        {p.onShift && <button type="button" onClick={() => p.onShift!(-1)} aria-label={COPY.earlier} title={COPY.earlier} className={step}><span aria-hidden="true">‹</span></button>}
        <span>{p.around}</span>
        {p.onShift && <button type="button" onClick={() => p.onShift!(1)} aria-label={COPY.later} title={COPY.later} className={step}><span aria-hidden="true">›</span></button>}
        {m.lab && (
          <span className="ml-2 text-ink">
            <span className="text-ink-2">{COPY.selection}: </span>
            <span className="font-semibold">{m.lab.axis.span(m.lab.sel.s, m.lab.sel.e)}</span>
            {m.custom && <button type="button" onClick={() => p.onSelect(null)} className="ml-2 text-link underline underline-offset-2">{FINE.reset}</button>}
          </span>
        )}
      </p>
      <Status st={st} />
      {!hasNormal && st.values.some(finite) && <p role="note" className="mb-2 text-xs text-ink-2">{m.hasModel ? COPY.noLevel : COPY.noNormal}</p>}
      {st.phase !== "empty" && (
        <FineChart m={p.m} mode={mode} unit={unit} name={p.name} event={p.event} polarity={p.polarity ?? "cool"}
          overlay={mode === "anomaly" ? p.overlay ?? null : null} onSelect={p.onSelect} />
      )}
      {st.doneDays > 0 && (
        <>
          <Legend mode={mode} showNormal={hasNormal} polarity={p.polarity ?? "cool"} />
          <p className="mt-0.5 text-xs text-ink-2 tnum">{COPY.coverage(st.values.filter(finite).length, st.doneDays)}</p>
          <details className="mt-2 border-t border-line">
            <summary className="cursor-pointer py-2 text-sm text-link hover:underline">{COPY.table(unit)}</summary>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-left text-sm tnum">
                <caption className="sr-only">{p.name}, {COPY.title.anomaly}</caption>
                <thead className="sticky top-0 bg-paper text-xs text-ink-2">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-normal">{COPY.date}</th>
                    <th scope="col" className="py-1 text-right font-normal">{COPY.value}</th>
                    {hasNormal && <th scope="col" className="py-1 pl-3 text-right font-normal">{COPY.normal}</th>}
                    {hasNormal && <th scope="col" className="py-1 pl-3 text-right font-normal">{COPY.anomaly}</th>}
                  </tr>
                </thead>
                <tbody>
                  {st.dates.map((day, i) => (
                    <tr key={day} className={`border-t border-line/60 ${day >= m.selDays.start && day <= m.selDays.end ? "bg-well/60" : ""}`}>
                      <th scope="row" className="py-1 pr-3 font-normal">{day}</th>
                      <td className={`py-1 text-right ${finite(st.values[i]) ? "text-ink" : "text-ink-3"}`}>{!st.loaded[i] ? COPY.notLoaded : finite(st.values[i]) ? num(st.values[i]) : COPY.missing}</td>
                      {hasNormal && <td className="py-1 pl-3 text-right text-ink-2">{num(m.normal[i])}</td>}
                      {hasNormal && <td className="py-1 pl-3 text-right text-ink">{num(m.anomaly[i], 2, true)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {m.level && <p className="mt-1 text-xs leading-relaxed text-ink-3">{COPY.method(`${num(m.level.offset, 2, true)} ${unit}`, m.level.days, m.level.months)}</p>}
          {st.source && (
            <p className="mt-1 text-xs leading-relaxed text-ink-3">
              {COPY.source}: <a href={st.source.url} target="_blank" rel="noreferrer" className="text-link underline underline-offset-2 hover:no-underline">{st.source.dataset}</a> · {st.source.aggregation}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ status line */

function Status({ st }: { st: DailyState }) {
  const btn = "rounded-ctl border border-line px-2.5 py-0.5 text-sm font-semibold text-ink hover:border-ink-3";
  const r = { borderRadius: "min(var(--r-ctl), 8px)" };
  const clipped = st.range && st.range.end !== st.requestedEnd ? COPY.clipped(st.range.end) : null;
  const pct = st.totalDays ? (100 * st.doneDays) / st.totalDays : 0;
  return (
    <div className="mt-1.5 mb-2 min-h-7 text-sm text-ink-2">
      {st.phase === "empty" && <p>{COPY.noDays}</p>}
      {st.phase === "idle" && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={st.start} className={`${btn} bg-action text-on-action border-transparent hover:bg-action-hover`} style={r}>
            {COPY.start(st.totalDays, COPY.seconds(st.etaSeconds))}
          </button>
          <span className="text-xs text-ink-3">{COPY.startHint}</span>
        </p>
      )}
      {st.phase === "partial" && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tnum">{COPY.progress(st.doneDays, st.totalDays)}</span>
          <button type="button" onClick={st.start} className={btn} style={r}>
            {COPY.more(st.remainingDays, COPY.seconds(st.etaSeconds))}
          </button>
        </p>
      )}
      {(st.phase === "loading" || st.phase === "waiting" || st.phase === "stopped") && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="status" aria-busy={st.phase !== "stopped"}>
          <span className="relative block h-[3px] w-40 overflow-hidden rounded-full bg-well" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded-full bg-focus transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </span>
          <span className="tnum">{COPY.progress(st.doneDays, st.totalDays)}{st.phase === "loading" ? ` · ${COPY.left(COPY.seconds(st.etaSeconds))}` : ""}</span>
          {st.phase === "loading" && <button type="button" onClick={st.stop} className="text-sm text-link hover:underline">{COPY.stop}</button>}
          {st.phase === "stopped" && <button type="button" onClick={st.retry} className={btn} style={r}>{COPY.resume}</button>}
        </div>
      )}
      {st.phase === "error" && (
        <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-ink">{COPY.failed[st.error ?? "failed"]}</span>
          {st.doneDays > 0 && <span className="tnum">{COPY.progress(st.doneDays, st.totalDays)}</span>}
          <button type="button" onClick={st.retry} className={btn} style={r}>{COPY.retry}</button>
        </p>
      )}
      {clipped && <p className="text-xs text-ink-3">{clipped}</p>}
    </div>
  );
}

const HATCH = "repeating-linear-gradient(45deg, color-mix(in srgb, var(--ink) 22%, transparent) 0 2px, transparent 2px 5px)";

function Legend({ mode, showNormal, polarity }: { mode: DailyMode; showNormal: boolean; polarity: "cool" | "warm" }) {
  const sw = (style: React.CSSProperties, cls = "") => <span aria-hidden="true" className={`inline-block h-2.5 w-3 rounded-[2px] ${cls}`} style={style} />;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
      {mode === "anomaly" ? (
        <>
          <span className="inline-flex items-center gap-1.5">{sw({ background: anomalyColor(true, polarity) })}{COPY.above}</span>
          <span className="inline-flex items-center gap-1.5">{sw({ background: anomalyColor(false, polarity) })}{COPY.below}</span>
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5"><svg width="14" height="8" aria-hidden="true"><line x1="0" x2="14" y1="4" y2="4" strokeWidth="2" style={{ stroke: "var(--viz-blue)" }} /></svg>{COPY.raw}</span>
          {showNormal && (
            <span className="inline-flex items-center gap-1.5" title={COPY.normalTitle}><svg width="14" height="8" aria-hidden="true"><line x1="0" x2="14" y1="4" y2="4" strokeWidth="1.5" strokeDasharray="4 3" style={{ stroke: "var(--viz-ink)", opacity: 0.7 }} /></svg>{COPY.normal}</span>
          )}
        </>
      )}
      <span className="inline-flex items-center gap-1.5">{sw({ background: "var(--action)", opacity: 0.45 })}{COPY.event}</span>
      <span className="inline-flex items-center gap-1.5">{sw({ background: "color-mix(in srgb, var(--focus) 12%, transparent)" }, "border-[1.5px] border-focus")}{COPY.selection}</span>
      <span className="inline-flex items-center gap-1.5">{sw({ background: HATCH })}{COPY.missing}</span>
      <span className="inline-flex items-center gap-1.5">{sw({ background: "var(--well)" })}{COPY.notLoaded}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ chart */

const H = 248, TOP = 22, BOTTOM = 24, RIGHT = 12;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;

function FineChart({ m, mode, unit, name, event, polarity, overlay, onSelect }: {
  m: FineModel; mode: DailyMode; unit: string; name: string; event: TimeRange; polarity: "cool" | "warm";
  overlay: LabOverlay | null; onSelect: (r: DayRange | null) => void;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const s = m.series;
  const n = s.start.length;
  const isAnomaly = mode === "anomaly";
  const anomaly = s.anomaly, value = s.value, normal = s.normal;

  // the selection being dragged (shown live), else the model's
  const [live, setLive] = useState<PointRange | null>(null);
  const sel = live ?? m.sel;

  const vals = isAnomaly ? [0, ...anomaly.filter(finite)] : [...value.filter(finite), ...normal.filter(finite)];
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  if (!isAnomaly && lo >= 0 && hi > 0 && lo < hi * 0.35) lo = 0;
  const padv = hi === lo ? Math.max(0.5, Math.abs(lo) * 0.05) : (hi - lo) * 0.06;
  const ih = H - TOP - BOTTOM;
  const y = scaleLinear().domain([!isAnomaly && lo === 0 ? 0 : lo - padv, hi + padv]).range([ih, 0]).nice(4);
  const ticks = y.ticks(4);
  const tf = y.tickFormat(4);
  const fmt = (t: number) => tf(t).replace("-", "−");
  const left = Math.max(40, Math.max(...ticks.map((t) => fmt(t).length)) * 7 + 14);
  const iw = Math.max(40, width - left - RIGHT);
  const stepPx = n ? iw / n : iw;
  const t: TimeScale = {
    iw, view: { s: 0, e: Math.max(0, n - 1) }, step: stepPx,
    x: (k) => k * stepPx,
    cx: (k) => k * stepPx + stepPx / 2,
    at: (px) => Math.max(0, Math.min(n - 1, Math.floor(px / stepPx))),
  };
  const band = (r: PointRange) => ({ x: t.x(r.a), width: t.x(r.b + 1) - t.x(r.a) });
  const ev = n ? pointsOf(s, eventDays(event)) : null;

  const commit = (r: PointRange) => { setLive(null); onSelect({ start: s.start[r.a], end: s.end[r.b] }); };
  const drag = useSelectionDrag({
    t, sel: { s: sel?.a ?? 0, e: sel?.b ?? 0 },
    onChange: (x) => setLive({ a: x.s, b: x.e }),
    onCommit: (x) => commit({ a: x.s, b: x.e }),
    onHover: setHover,
  });

  let path = "", npath = "";
  const dots: number[] = [];
  if (!isAnomaly) {
    for (let i = 0; i < n; i++) {
      const v = value[i];
      if (!finite(v)) continue;
      const prev = i > 0 && finite(value[i - 1]);
      path += `${prev ? "L" : "M"}${t.cx(i).toFixed(1)} ${y(v).toFixed(1)}`;
      if (!prev && !(i + 1 < n && finite(value[i + 1]))) dots.push(i);
    }
    for (let i = 0; i < n; i++) {
      const v = normal[i];
      if (finite(v)) npath += `${i > 0 && finite(normal[i - 1]) ? "L" : "M"}${t.cx(i).toFixed(1)} ${y(v).toFixed(1)}`;
    }
  }
  const zero = y(0);
  const barW = Math.max(1, stepPx - (stepPx >= 4 ? Math.min(3, stepPx * 0.15) : 0));
  const notLoaded = runs(n, (i) => !m.loaded[i]);
  const missing = runs(n, (i) => m.loaded[i] && !finite(anomaly[i]) && !finite(value[i]));
  const monthStarts = s.start.map((d, i) => (i === 0 || d.slice(5, 7) !== s.start[i - 1].slice(5, 7) ? i : -1)).filter((i) => i >= 0);
  const labelled: number[] = [];
  for (const i of monthStarts) if (!labelled.length || t.x(i) - t.x(labelled[labelled.length - 1]) >= 46) labelled.push(i);
  const level = m.lab?.level ?? 0;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!sel) return;
    if (e.key === "Escape") { e.preventDefault(); setLive(null); onSelect(null); return; }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const d = e.key === "ArrowLeft" ? -1 : 1;
    const next = e.shiftKey
      ? { a: sel.a, b: Math.max(sel.a, Math.min(n - 1, sel.b + d)) }
      : (() => { const len = sel.b - sel.a; const a = Math.max(0, Math.min(n - 1 - len, sel.a + d)); return { a, b: a + len }; })();
    commit(next);
  };
  const label = (i: number) => (m.step === "week" ? formatDays(s.start[i], s.end[i]) : formatDays(s.start[i]));
  const valueText = (i: number) => (!m.loaded[i] ? COPY.notLoaded : finite(value[i]) ? `${num(value[i])} ${unit}` : COPY.missing);
  const anomalyText = (i: number) => (finite(anomaly[i]) ? `${num(anomaly[i], 2, true)} ${unit}` : null);
  const barColor = (v: number) => anomalyColor(v > 0, polarity);
  const hv = hover != null ? (isAnomaly ? anomaly[hover] : value[hover]) : null;
  const selLabel = sel ? (sel.a === sel.b ? label(sel.a) : formatDays(s.start[sel.a], s.end[sel.b])) : "";

  return (
    <div
      ref={ref}
      className="relative select-none"
      style={{ height: H }}
      role="group"
      tabIndex={0}
      title={m.step === "week" ? FINE.chartSelectWeeks : FINE.chartSelect}
      aria-label={`${COPY.chartLabel(name, (m.step === "week" ? COPY.title.weeklyAnomaly : COPY.title[mode]).toLowerCase())} ${m.step === "week" ? FINE.chartSelectWeeks : FINE.chartSelect}`}
      onKeyDown={onKey}
    >
      <span className="sr-only" aria-live="polite">{sel ? `${COPY.selection}: ${selLabel}` : ""}</span>
      {width > 0 && n > 0 && (
        <svg width={width} height={H} aria-hidden="true" className="block">
          <defs>
            <pattern id="dv-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2" height="5" style={{ fill: "var(--ink)", opacity: 0.2 }} />
            </pattern>
          </defs>
          <g transform={`translate(${left},${TOP})`}>
            {notLoaded.map(([a, b]) => <rect key={`n${a}`} x={t.x(a)} width={t.x(b + 1) - t.x(a)} y={0} height={ih} style={{ fill: "var(--well)", opacity: 0.8 }} />)}
            {missing.map(([a, b]) => <rect key={`m${a}`} x={t.x(a)} width={t.x(b + 1) - t.x(a)} y={0} height={ih} fill="url(#dv-hatch)" />)}
            {ev && (
              <g>
                <rect {...band(ev)} y={0} height={ih} style={{ fill: "var(--action)", opacity: "var(--event-band-opacity)" }} />
                <rect {...band(ev)} y={0} height={2} style={{ fill: "var(--action)" }} />
                <text x={t.x(ev.a) + 4} y={13} style={{ fill: "var(--ink)", fontSize: 11, fontWeight: 600 }}>{COPY.event}</text>
              </g>
            )}
            {sel && <rect {...band(sel)} y={0} height={ih} style={{ fill: "var(--focus)", opacity: 0.07 }} />}
            {overlay && <LabBandMarks overlay={overlay} base={0} t={t} ih={ih} polarity={polarity} />}
            {ticks.map((v) => (
              <g key={v}>
                <line x2={iw} y1={y(v)} y2={y(v)} strokeWidth={1} style={{ stroke: "var(--viz-grid)" }} />
                <text x={-8} y={y(v)} dy="0.32em" textAnchor="end" className="tnum" style={{ fill: "var(--ink-2)", fontSize: 11 }}>{fmt(v)}</text>
              </g>
            ))}
            <text x={-left + 2} y={-11} style={{ fill: "var(--ink-3)", fontSize: 10 }}>{unit}</text>
            {isAnomaly ? (
              <>
                {anomaly.map((v, i) => finite(v) && (
                  <rect key={i} x={t.x(i) + (stepPx - barW) / 2} width={barW} y={Math.min(zero, y(v))} height={Math.max(1, Math.abs(y(v) - zero))} style={{ fill: barColor(v) }} />
                ))}
                <line x2={iw} y1={zero} y2={zero} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
                {overlay && <LabOverlayMarks overlay={overlay} base={0} t={t} y={(v) => y(v + level)} ih={ih} />}
              </>
            ) : (
              <>
                {npath && <path d={npath} fill="none" strokeWidth={1.5} strokeDasharray="4 3" style={{ stroke: "var(--viz-ink)", opacity: 0.6 }} />}
                {path && <path d={path} fill="none" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--viz-blue)" }} />}
                {dots.map((i) => <circle key={i} cx={t.cx(i)} cy={y(value[i]!)} r={2.5} style={{ fill: "var(--viz-blue)" }} />)}
              </>
            )}
            {sel && (
              <g>
                <rect {...band(sel)} y={0} height={ih} fill="none" strokeWidth={1.5} style={{ stroke: "var(--focus)" }} />
                {[t.x(sel.a), t.x(sel.b + 1)].map((x, i) => (
                  <rect key={i} x={x - 4} y={ih / 2 - 14} width={8} height={28} rx={3} strokeWidth={1.25} style={{ fill: "var(--paper)", stroke: "var(--focus)" }} />
                ))}
              </g>
            )}
            <line x2={iw} y1={ih} y2={ih} style={{ stroke: "var(--viz-axis)" }} />
            {monthStarts.map((i) => <line key={i} x1={t.x(i)} x2={t.x(i)} y1={ih} y2={ih + 4} style={{ stroke: "var(--viz-axis)" }} />)}
            {labelled.map((i) => (
              <text key={i} x={t.x(i) + 2} y={ih + 16} className="tnum" style={{ fill: "var(--ink-2)", fontSize: 11 }}>{short(s.start[i])}</text>
            ))}
            {hover != null && (
              <g pointerEvents="none">
                <line x1={t.cx(hover)} x2={t.cx(hover)} y2={ih} style={{ stroke: "var(--ink-2)" }} />
                {finite(hv) && <circle cx={t.cx(hover)} cy={y(hv)} r={3.5} strokeWidth={2} style={{ fill: isAnomaly ? barColor(hv) : "var(--viz-blue)", stroke: "var(--paper)" }} />}
              </g>
            )}
            <rect
              width={iw} height={ih} fill="transparent" style={drag.style}
              onPointerDown={(e) => drag.onPointerDown(e as unknown as PointerEvent<HTMLElement>)}
              onPointerMove={(e) => drag.onPointerMove(e as unknown as PointerEvent<HTMLElement>)}
              onPointerUp={(e) => drag.onPointerUp(e as unknown as PointerEvent<HTMLElement>)}
              onPointerCancel={(e) => drag.onPointerCancel(e as unknown as PointerEvent<HTMLElement>)}
              onPointerLeave={() => { drag.onPointerLeave(); setHover(null); }}
            />
          </g>
        </svg>
      )}
      {width > 0 && hover != null && (
        <ChartTooltip x={left + t.cx(hover)} width={width}>
          <div className="mb-1 font-semibold tnum">{label(hover)}</div>
          {anomalyText(hover) && <TipRow color={finite(anomaly[hover]) && anomaly[hover]! > 0 === (polarity === "cool") ? "--viz-cool" : "--viz-warm"} value={anomalyText(hover)!} label={COPY.anomaly} />}
          <TipRow color={!isAnomaly && finite(value[hover]) ? "--viz-blue" : undefined} value={valueText(hover)} label={m.step === "week" ? COPY.weeklyMean : COPY.raw} />
          {finite(normal[hover]) && <TipRow color={isAnomaly ? undefined : "--viz-ink"} dashed={!isAnomaly} value={`${num(normal[hover])} ${unit}`} label={COPY.normal} />}
          {m.step === "week" && <div className="mt-0.5 text-xs text-ink-3 tnum">{COPY.daysObserved(s.days[hover], dayNum(s.end[hover]) - dayNum(s.start[hover]) + 1)}</div>}
        </ChartTooltip>
      )}
    </div>
  );
}
