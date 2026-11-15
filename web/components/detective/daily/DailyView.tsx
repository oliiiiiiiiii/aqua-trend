"use client";
// Daily view of one variable for a days or weeks window: daily values over [selection start − reach, selection end +
// reach], loaded progressively in ≤ 3-day pieces. The span follows the workbench's interactive selection (which starts
// on the event), not the event itself; the event stays marked wherever it falls inside the span.
//
// Two layers, like the monthly chart:
//   Anomaly  (default) each day minus its normal: the long-term trend and the seasonal cycle of the monthly
//            decomposition, read at each day (plan.dailyNormal). Bars from zero, in the variable's polarity colours.
//   Observed the daily values with that normal as a dashed line.
// No daily σ / z is computed (there is no daily baseline record): significance stays with the monthly statistics.
// Variables without a daily product get a one-line note and the monthly `fallback`.
//
// States drawn distinctly: not loaded yet (plain tint), loaded but missing (hatched), observed (bars / line).
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import type { Decomposition, LayerId, RegionId, TimeRange } from "@/lib/detective/contracts";
import { dailySpan, eventDays, windowLabel, type DailyUnit } from "@/lib/detective/window";
import { formatRange } from "@/lib/detective/url";
import { dayNumber } from "@/lib/detective/daily";
import { ChartTooltip, TipRow } from "@/components/charts/ChartTooltip";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { Segmented } from "@/components/ui/Segmented";
import { num } from "../format";
import { COPY } from "../copy/daily";
import { anomalyColor } from "../workbench/types";
import { dailyAnomaly, dailyNormal, runs, sameUnit, selectionSummary, type DayRange } from "./plan";
import { useDailyRange, type DailyState } from "./useDailyRange";

export type DailyMode = "anomaly" | "observed";

export interface DailyViewProps {
  region: RegionId;
  layer: LayerId;
  /** "Precipitation" */
  name: string;
  /** monthly product name, shown until the daily dataset name arrives */
  product?: string;
  /** unit of the monthly series (the normal, and so the anomaly, exists only when the daily unit matches) */
  unit: string;
  /** the event period: marked where it falls inside the span */
  event: TimeRange;
  /** the workbench's interactive selection (months): the span is built around it */
  selection: TimeRange;
  /** ± days (1–14) or ± weeks (1–5) around the selection */
  reach: { unit: DailyUnit; n: number };
  /** monthly decomposition of the same variable: its trend and seasonal cycle give each day's normal */
  d: Decomposition | null;
  /** how high values read, for the anomaly colours */
  polarity?: "cool" | "warm";
  /** move the selection by whole months (−1 / +1); omit to hide the two buttons */
  onShift?: (months: number) => void;
  /** shown instead when the layer has no daily product (normally the monthly chart) */
  fallback?: ReactNode;
  /** false pauses all loading (e.g. while the view is hidden) */
  enabled?: boolean;
  className?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const longDay = (iso: string) => `${dayLabel(iso)} ${iso.slice(0, 4)}`;
const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const HATCH = "repeating-linear-gradient(45deg, color-mix(in srgb, var(--ink) 22%, transparent) 0 2px, transparent 2px 5px)";
const MODES: { value: DailyMode; label: string; title: string }[] = [
  { value: "anomaly", label: COPY.mode.anomaly, title: COPY.modeTitle.anomaly },
  { value: "observed", label: COPY.mode.observed, title: COPY.modeTitle.observed },
];

export default function DailyView(p: DailyViewProps) {
  const { unit: reachUnit, n: reachN } = p.reach;
  const span = useMemo(() => dailySpan(p.selection, reachN, reachUnit), [p.selection.start, p.selection.end, reachN, reachUnit]); // eslint-disable-line react-hooks/exhaustive-deps
  const selDays = useMemo(() => eventDays(p.selection), [p.selection.start, p.selection.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useDailyRange({ region: p.region, layer: p.layer, start: span.start, end: span.end, focus: selDays, enabled: p.enabled !== false });
  const titleId = useId();
  const [picked, setMode] = useState<DailyMode>("anomaly");

  // the normal of every day of the span, and what is left once it is taken off
  const dailyUnit = st.unit ?? p.unit;
  const comparable = !!p.d && sameUnit(dailyUnit, p.unit);
  const normal = useMemo(() => (comparable ? dailyNormal(p.d, st.dates) : st.dates.map(() => null)), [comparable, p.d, st.dates]);
  const anomaly = useMemo(() => dailyAnomaly(st.values, normal), [st.values, normal]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasNormal = normal.some(finite);
  const mode: DailyMode = hasNormal ? picked : "observed";

  if (st.phase === "unsupported") {
    return (
      <div className={p.className}>
        <p className="mb-2 text-sm text-ink-2">{COPY.noProduct}</p>
        {p.fallback}
      </div>
    );
  }

  const dataset = st.source?.dataset;
  const sum = selectionSummary(st.dates, st.values, anomaly, selDays);
  const step = "inline-flex h-6 w-6 items-center justify-center rounded-full border border-line text-sm text-ink hover:border-ink-3";
  return (
    <section aria-labelledby={titleId} className={`min-w-0 ${p.className ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h3 id={titleId} className="font-[family-name:var(--font-body-active)] text-sm font-semibold text-ink">{COPY.title[mode]}</h3>
          <p className="min-w-0 text-xs text-ink-2 tnum">{dataset ? `${dataset} · ` : ""}{longDay(span.start)} – {longDay(span.end)}</p>
        </div>
        {hasNormal && <Segmented legend={COPY.modes} hideLegend tone="paper" look="underline" options={MODES} value={mode} onChange={setMode} />}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2 tnum">
        {p.onShift && <button type="button" onClick={() => p.onShift!(-1)} aria-label={COPY.earlier} title={COPY.earlier} className={step}><span aria-hidden="true">‹</span></button>}
        <span aria-live="polite">{COPY.around(windowLabel(p.reach), formatRange(p.selection))}</span>
        {p.onShift && <button type="button" onClick={() => p.onShift!(1)} aria-label={COPY.later} title={COPY.later} className={step}><span aria-hidden="true">›</span></button>}
      </p>
      <Status st={st} />
      {!hasNormal && st.doneDays > 0 && <p role="note" className="mb-2 text-xs text-ink-2">{COPY.noNormal}</p>}
      {st.phase !== "empty" && (
        <DailyChart
          st={st} mode={mode} normal={normal} anomaly={anomaly} unit={dailyUnit} name={p.name}
          event={p.event} selection={selDays} polarity={p.polarity ?? "cool"}
        />
      )}
      {st.doneDays > 0 && (
        <>
          <Legend mode={mode} showNormal={hasNormal} polarity={p.polarity ?? "cool"} />
          <p className="mt-1.5 text-sm text-ink tnum" aria-live="polite">
            {mode === "anomaly"
              ? sum.n ? COPY.summary.anomaly(`${num(sum.meanAnomaly, 2, true)} ${dailyUnit}`, sum.n, sum.days) : COPY.summary.none
              : sum.observed ? COPY.summary.observed(`${num(sum.meanValue)} ${dailyUnit}`, sum.observed, sum.days) : COPY.summary.none}
          </p>
          <p className="mt-0.5 text-xs text-ink-2 tnum">{COPY.coverage(st.values.filter(finite).length, st.doneDays)}</p>
          <details className="mt-2 border-t border-line">
            <summary className="cursor-pointer py-2 text-sm text-link hover:underline">{COPY.table(dailyUnit)}</summary>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-left text-sm tnum">
                <caption className="sr-only">{p.name}, {COPY.title[mode]}</caption>
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
                    <tr key={day} className={`border-t border-line/60 ${day >= selDays.start && day <= selDays.end ? "bg-well/60" : ""}`}>
                      <th scope="row" className="py-1 pr-3 font-normal">{day}</th>
                      <td className={`py-1 text-right ${finite(st.values[i]) ? "text-ink" : "text-ink-3"}`}>{!st.loaded[i] ? COPY.notLoaded : finite(st.values[i]) ? num(st.values[i]) : COPY.missing}</td>
                      {hasNormal && <td className="py-1 pl-3 text-right text-ink-2">{num(normal[i])}</td>}
                      {hasNormal && <td className="py-1 pl-3 text-right text-ink">{num(anomaly[i], 2, true)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {hasNormal && <p className="mt-1 text-xs leading-relaxed text-ink-3">{COPY.method}</p>}
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

function DailyChart({ st, mode, normal, anomaly, unit, name, event, selection, polarity }: {
  st: DailyState; mode: DailyMode; normal: (number | null)[]; anomaly: (number | null)[]; unit: string; name: string;
  event: TimeRange; selection: DayRange; polarity: "cool" | "warm";
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = st.dates.length;
  const isAnomaly = mode === "anomaly";

  const vals = isAnomaly ? [0, ...anomaly.filter(finite)] : [...st.values.filter(finite), ...normal.filter(finite)];
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  if (!isAnomaly && lo >= 0 && hi > 0 && lo < hi * 0.35) lo = 0; // start near-zero quantities (rain, runoff) at 0
  const padv = hi === lo ? Math.max(0.5, Math.abs(lo) * 0.05) : (hi - lo) * 0.06;
  const ih = H - TOP - BOTTOM;
  const y = scaleLinear().domain([!isAnomaly && lo === 0 ? 0 : lo - padv, hi + padv]).range([ih, 0]).nice(4);
  const ticks = y.ticks(4);
  const tf = y.tickFormat(4);
  const fmt = (t: number) => tf(t).replace("-", "−");
  const left = Math.max(40, Math.max(...ticks.map((t) => fmt(t).length)) * 7 + 14);
  const iw = Math.max(40, width - left - RIGHT);
  const step = n ? iw / n : iw;
  const x = (i: number) => i * step;           // left edge of day i
  const cx = (i: number) => x(i) + step / 2;   // centre

  // a day range as [first, last] indices of the span, null when it lies outside
  const d0 = dayNumber(st.dates[0] ?? "") ?? 0;
  const within = (r: DayRange): [number, number] | null => {
    const a = Math.max(0, (dayNumber(r.start) ?? d0) - d0), b = Math.min(n - 1, (dayNumber(r.end) ?? d0) - d0);
    return b >= a ? [a, b] : null;
  };
  const ev = within(eventDays(event));
  const sel = within(selection);
  const band = (r: [number, number]) => ({ x: x(r[0]), width: x(r[1] + 1) - x(r[0]) });

  // observed layer: the raw line, broken at missing / not-loaded days; isolated observed days get a dot
  let path = "";
  const dots: number[] = [];
  // the normal, one level per day (it moves smoothly through the month)
  let npath = "";
  if (!isAnomaly) {
    for (let i = 0; i < n; i++) {
      const v = st.values[i];
      if (!finite(v)) continue;
      const prev = i > 0 && finite(st.values[i - 1]);
      path += `${prev ? "L" : "M"}${cx(i).toFixed(1)} ${y(v).toFixed(1)}`;
      if (!prev && !(i + 1 < n && finite(st.values[i + 1]))) dots.push(i);
    }
    for (let i = 0; i < n; i++) {
      const v = normal[i];
      if (!finite(v)) continue;
      npath += `${i > 0 && finite(normal[i - 1]) ? "L" : "M"}${cx(i).toFixed(1)} ${y(v).toFixed(1)}`;
    }
  }
  const zero = y(0);
  const barW = Math.max(1, step - (step >= 4 ? 1 : 0));

  const notLoaded = runs(n, (i) => !st.loaded[i]);
  const missing = runs(n, (i) => st.loaded[i] && !finite(st.values[i]));
  const monthStarts = st.dates.map((s, i) => (s.endsWith("-01") || i === 0 ? i : -1)).filter((i) => i >= 0);
  const minGap = 46;
  const labelled: number[] = [];
  for (const i of monthStarts) if (!labelled.length || x(i) - x(labelled[labelled.length - 1]) >= minGap) labelled.push(i);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === "Home") setHover(0);
    else if (e.key === "End") setHover(n - 1);
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };
  const valueText = (i: number) => (!st.loaded[i] ? COPY.notLoaded : finite(st.values[i]) ? `${num(st.values[i])} ${unit}` : COPY.missing);
  const anomalyText = (i: number) => (finite(anomaly[i]) ? `${num(anomaly[i], 2, true)} ${unit}` : null);
  const barColor = (v: number) => anomalyColor(v > 0, polarity);
  const hv = hover != null ? (isAnomaly ? anomaly[hover] : st.values[hover]) : null;

  return (
    <div
      ref={ref}
      className="relative select-none"
      style={{ height: H }}
      role="group"
      tabIndex={0}
      aria-label={COPY.chartLabel(name, COPY.title[mode].toLowerCase())}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
    >
      <span className="sr-only" aria-live="polite">
        {hover != null ? `${st.dates[hover]}: ${isAnomaly && anomalyText(hover) ? `${COPY.anomaly} ${anomalyText(hover)}, ` : ""}${valueText(hover)}` : ""}
      </span>
      {width > 0 && n > 0 && (
        <svg width={width} height={H} aria-hidden="true" className="block">
          <defs>
            <pattern id="dv-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2" height="5" style={{ fill: "var(--ink)", opacity: 0.2 }} />
            </pattern>
          </defs>
          <g transform={`translate(${left},${TOP})`}>
            {notLoaded.map(([a, b]) => <rect key={`n${a}`} x={x(a)} width={x(b + 1) - x(a)} y={0} height={ih} style={{ fill: "var(--well)", opacity: 0.8 }} />)}
            {missing.map(([a, b]) => <rect key={`m${a}`} x={x(a)} width={x(b + 1) - x(a)} y={0} height={ih} fill="url(#dv-hatch)" />)}
            {ev && (
              <g>
                <rect {...band(ev)} y={0} height={ih} style={{ fill: "var(--action)", opacity: "var(--event-band-opacity)" }} />
                <rect {...band(ev)} y={0} height={2} style={{ fill: "var(--action)" }} />
                <text x={x(ev[0]) + 4} y={13} style={{ fill: "var(--ink)", fontSize: 11, fontWeight: 600 }}>{COPY.event}</text>
              </g>
            )}
            {sel && <rect {...band(sel)} y={0} height={ih} style={{ fill: "var(--focus)", opacity: 0.07 }} />}
            {ticks.map((t) => (
              <g key={t}>
                <line x2={iw} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: "var(--viz-grid)" }} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum" style={{ fill: "var(--ink-2)", fontSize: 11 }}>{fmt(t)}</text>
              </g>
            ))}
            <text x={-left + 2} y={-11} style={{ fill: "var(--ink-3)", fontSize: 10 }}>{unit}</text>
            {isAnomaly ? (
              <>
                {anomaly.map((v, i) => finite(v) && (
                  <rect key={i} x={x(i) + (step - barW) / 2} width={barW} y={Math.min(zero, y(v))} height={Math.max(1, Math.abs(y(v) - zero))} style={{ fill: barColor(v) }} />
                ))}
                <line x2={iw} y1={zero} y2={zero} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
              </>
            ) : (
              <>
                {npath && <path d={npath} fill="none" strokeWidth={1.5} strokeDasharray="4 3" style={{ stroke: "var(--viz-ink)", opacity: 0.6 }} />}
                {path && <path d={path} fill="none" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--viz-blue)" }} />}
                {dots.map((i) => <circle key={i} cx={cx(i)} cy={y(st.values[i]!)} r={2.5} style={{ fill: "var(--viz-blue)" }} />)}
              </>
            )}
            {sel && <rect {...band(sel)} y={0} height={ih} fill="none" strokeWidth={1.5} style={{ stroke: "var(--focus)" }} />}
            <line x2={iw} y1={ih} y2={ih} style={{ stroke: "var(--viz-axis)" }} />
            {monthStarts.map((i) => <line key={i} x1={x(i)} x2={x(i)} y1={ih} y2={ih + 4} style={{ stroke: "var(--viz-axis)" }} />)}
            {labelled.map((i) => (
              <text key={i} x={x(i) + 2} y={ih + 16} className="tnum" style={{ fill: "var(--ink-2)", fontSize: 11 }}>{dayLabel(st.dates[i])}</text>
            ))}
            {hover != null && (
              <g>
                <line x1={cx(hover)} x2={cx(hover)} y2={ih} style={{ stroke: "var(--ink-2)" }} />
                {finite(hv) && <circle cx={cx(hover)} cy={y(hv)} r={3.5} strokeWidth={2} style={{ fill: isAnomaly ? barColor(hv) : "var(--viz-blue)", stroke: "var(--paper)" }} />}
              </g>
            )}
            <rect
              width={iw} height={ih} fill="transparent" style={{ cursor: "crosshair", touchAction: "pan-y" }}
              onPointerMove={(e) => {
                const b = e.currentTarget.getBoundingClientRect();
                setHover(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - b.left) / step))));
              }}
              onPointerLeave={() => setHover(null)}
            />
          </g>
        </svg>
      )}
      {width > 0 && hover != null && (
        <ChartTooltip x={left + cx(hover)} width={width}>
          <div className="mb-1 font-semibold tnum">{longDay(st.dates[hover])}</div>
          {anomalyText(hover) && <TipRow color={finite(anomaly[hover]) && anomaly[hover]! > 0 === (polarity === "cool") ? "--viz-cool" : "--viz-warm"} value={anomalyText(hover)!} label={COPY.anomaly} />}
          <TipRow color={!isAnomaly && finite(st.values[hover]) ? "--viz-blue" : undefined} value={valueText(hover)} label={COPY.raw} />
          {finite(normal[hover]) && <TipRow color={isAnomaly ? undefined : "--viz-ink"} dashed={!isAnomaly} value={`${num(normal[hover])} ${unit}`} label={COPY.normal} />}
        </ChartTooltip>
      )}
    </div>
  );
}
