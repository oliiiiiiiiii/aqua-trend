"use client";
// Daily view of one variable for a weeks window: raw daily values over [event start − k weeks, event end + k weeks],
// loaded progressively in ≤ 3-day pieces, with the monthly normal (trend + seasonal of each day's month, from the
// monthly decomposition) as a faint reference step. No daily anomaly or z is computed: the monthly seasonal model is
// not applied to daily data. Variables without a daily product get a one-line note and the monthly `fallback`.
//
// States drawn distinctly: not loaded yet (plain tint), loaded but missing (hatched), observed (line).
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { scaleLinear } from "d3-scale";
import type { Decomposition, LayerId, RegionId, TimeRange } from "@/lib/detective/contracts";
import { dailySpan, eventDays } from "@/lib/detective/window";
import { dayNumber } from "@/lib/detective/daily";
import { ChartTooltip, TipRow } from "@/components/charts/ChartTooltip";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { num } from "../format";
import { COPY } from "../copy/daily";
import { monthlyNormalByDay, runs, sameUnit } from "./plan";
import { useDailyRange, type DailyState } from "./useDailyRange";

export interface DailyViewProps {
  region: RegionId;
  layer: LayerId;
  /** "Precipitation" */
  name: string;
  /** monthly product name, shown until the daily dataset name arrives */
  product?: string;
  /** unit of the monthly series (the normal is drawn only when the daily unit matches) */
  unit: string;
  event: TimeRange;
  /** ± weeks around the event (1–5) */
  weeks: number;
  /** monthly decomposition of the same variable, for the monthly normal; null hides it */
  d: Decomposition | null;
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

export default function DailyView(p: DailyViewProps) {
  const span = useMemo(() => dailySpan(p.event, p.weeks), [p.event.start, p.event.end, p.weeks]); // eslint-disable-line react-hooks/exhaustive-deps
  const evDays = useMemo(() => eventDays(p.event), [p.event.start, p.event.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useDailyRange({ region: p.region, layer: p.layer, start: span.start, end: span.end, event: evDays, enabled: p.enabled !== false });
  const titleId = useId();

  if (st.phase === "unsupported") {
    return (
      <div className={p.className}>
        <p className="mb-2 text-sm text-ink-2">{COPY.noProduct}</p>
        {p.fallback}
      </div>
    );
  }

  const dataset = st.source?.dataset;
  return (
    <section aria-labelledby={titleId} className={`min-w-0 ${p.className ?? ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 id={titleId} className="font-[family-name:var(--font-body-active)] text-sm font-semibold text-ink">{COPY.title}</h3>
        <p className="min-w-0 text-xs text-ink-2 tnum">{dataset ? `${dataset} · ` : ""}{longDay(span.start)} – {longDay(span.end)}</p>
      </div>
      <Status st={st} />
      {st.phase !== "empty" && <DailyChart st={st} d={p.d} unit={p.unit} name={p.name} event={p.event} />}
      {st.doneDays > 0 && (
        <>
          <Legend showNormal={!!p.d && sameUnit(st.unit ?? p.unit, p.unit)} />
          <p className="mt-1 text-xs text-ink-2 tnum">{COPY.coverage(st.values.filter(finite).length, st.doneDays)}</p>
          <details className="mt-2 border-t border-line">
            <summary className="cursor-pointer py-2 text-sm text-link hover:underline">{COPY.table(st.unit ?? p.unit)}</summary>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-left text-sm tnum">
                <caption className="sr-only">{p.name}, {COPY.title}</caption>
                <thead className="sticky top-0 bg-paper text-xs text-ink-2"><tr><th scope="col" className="py-1 pr-3 font-normal">{COPY.date}</th><th scope="col" className="py-1 text-right font-normal">{COPY.value}</th></tr></thead>
                <tbody>
                  {st.dates.map((day, i) => (
                    <tr key={day} className="border-t border-line/60">
                      <th scope="row" className="py-1 pr-3 font-normal">{day}</th>
                      <td className={`py-1 text-right ${finite(st.values[i]) ? "text-ink" : "text-ink-3"}`}>{!st.loaded[i] ? COPY.notLoaded : finite(st.values[i]) ? num(st.values[i]) : COPY.missing}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
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

function Legend({ showNormal }: { showNormal: boolean }) {
  const sw = (style: React.CSSProperties) => <span aria-hidden="true" className="inline-block h-2.5 w-3 rounded-[2px]" style={style} />;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
      <span className="inline-flex items-center gap-1.5"><svg width="14" height="8" aria-hidden="true"><line x1="0" x2="14" y1="4" y2="4" strokeWidth="2" style={{ stroke: "var(--viz-blue)" }} /></svg>{COPY.raw}</span>
      {showNormal && (
        <span className="inline-flex items-center gap-1.5" title={COPY.normalTitle}><svg width="14" height="8" aria-hidden="true"><line x1="0" x2="14" y1="4" y2="4" strokeWidth="1.5" strokeDasharray="4 3" style={{ stroke: "var(--viz-ink)", opacity: 0.7 }} /></svg>{COPY.normal}</span>
      )}
      <span className="inline-flex items-center gap-1.5">{sw({ background: "var(--action)", opacity: 0.45 })}{COPY.event}</span>
      <span className="inline-flex items-center gap-1.5">{sw({ background: HATCH })}{COPY.missing}</span>
      <span className="inline-flex items-center gap-1.5">{sw({ background: "var(--well)" })}{COPY.notLoaded}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ chart */

const H = 248, TOP = 22, BOTTOM = 24, RIGHT = 12;

function DailyChart({ st, d, unit, name, event }: { st: DailyState; d: Decomposition | null; unit: string; name: string; event: TimeRange }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = st.dates.length;
  const showNormal = !!d && sameUnit(st.unit ?? unit, unit);
  const normal = useMemo(() => (showNormal ? monthlyNormalByDay(d, st.dates) : st.dates.map(() => null)), [showNormal, d, st.dates]);

  const vals = [...st.values.filter(finite), ...normal.filter(finite)];
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  if (lo >= 0 && hi > 0 && lo < hi * 0.35) lo = 0; // start near-zero quantities (rain, runoff) at 0
  const padv = hi === lo ? Math.max(0.5, Math.abs(lo) * 0.05) : (hi - lo) * 0.06;
  const ih = H - TOP - BOTTOM;
  const y = scaleLinear().domain([lo === 0 ? 0 : lo - padv, hi + padv]).range([ih, 0]).nice(4);
  const ticks = y.ticks(4);
  const tf = y.tickFormat(4);
  const fmt = (t: number) => tf(t).replace("-", "−");
  const left = Math.max(40, Math.max(...ticks.map((t) => fmt(t).length)) * 7 + 14);
  const iw = Math.max(40, width - left - RIGHT);
  const step = n ? iw / n : iw;
  const x = (i: number) => i * step;           // left edge of day i
  const cx = (i: number) => x(i) + step / 2;   // centre

  const ev = eventDays(event);
  const d0 = dayNumber(st.dates[0] ?? "") ?? 0;
  const evS = Math.max(0, (dayNumber(ev.start) ?? d0) - d0), evE = Math.min(n - 1, (dayNumber(ev.end) ?? d0) - d0);

  // raw line, broken at missing / not-loaded days; isolated observed days get a dot
  let path = "";
  const dots: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = st.values[i];
    if (!finite(v)) continue;
    const prev = i > 0 && finite(st.values[i - 1]);
    path += `${prev ? "L" : "M"}${cx(i).toFixed(1)} ${y(v).toFixed(1)}`;
    if (!prev && !(i + 1 < n && finite(st.values[i + 1]))) dots.push(i);
  }
  // normal as a step (one level per month)
  let npath = "";
  for (let i = 0; i < n; i++) {
    const v = normal[i];
    if (!finite(v)) continue;
    const prev = i > 0 && finite(normal[i - 1]);
    npath += `${prev ? `L${x(i).toFixed(1)} ${y(normal[i - 1]!).toFixed(1)}L` : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}L${(x(i) + step).toFixed(1)} ${y(v).toFixed(1)}`;
  }

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
  const valueText = (i: number) => (!st.loaded[i] ? COPY.notLoaded : finite(st.values[i]) ? `${num(st.values[i])} ${st.unit ?? unit}` : COPY.missing);

  return (
    <div
      ref={ref}
      className="relative select-none"
      style={{ height: H }}
      role="group"
      tabIndex={0}
      aria-label={COPY.chartLabel(name)}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
    >
      <span className="sr-only" aria-live="polite">{hover != null ? `${st.dates[hover]}: ${valueText(hover)}` : ""}</span>
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
            {evE >= evS && (
              <g>
                <rect x={x(evS)} width={x(evE + 1) - x(evS)} y={0} height={ih} style={{ fill: "var(--action)", opacity: "var(--event-band-opacity)" }} />
                <rect x={x(evS)} width={x(evE + 1) - x(evS)} y={0} height={2} style={{ fill: "var(--action)" }} />
                <text x={x(evS) + 4} y={13} style={{ fill: "var(--ink)", fontSize: 11, fontWeight: 600 }}>{COPY.event}</text>
              </g>
            )}
            {ticks.map((t) => (
              <g key={t}>
                <line x2={iw} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: "var(--viz-grid)" }} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum" style={{ fill: "var(--ink-2)", fontSize: 11 }}>{fmt(t)}</text>
              </g>
            ))}
            <text x={-left + 2} y={-11} style={{ fill: "var(--ink-3)", fontSize: 10 }}>{st.unit ?? unit}</text>
            {npath && <path d={npath} fill="none" strokeWidth={1.5} strokeDasharray="4 3" style={{ stroke: "var(--viz-ink)", opacity: 0.6 }} />}
            {path && <path d={path} fill="none" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: "var(--viz-blue)" }} />}
            {dots.map((i) => <circle key={i} cx={cx(i)} cy={y(st.values[i]!)} r={2.5} style={{ fill: "var(--viz-blue)" }} />)}
            <line x2={iw} y1={ih} y2={ih} style={{ stroke: "var(--viz-axis)" }} />
            {monthStarts.map((i) => <line key={i} x1={x(i)} x2={x(i)} y1={ih} y2={ih + 4} style={{ stroke: "var(--viz-axis)" }} />)}
            {labelled.map((i) => (
              <text key={i} x={x(i) + 2} y={ih + 16} className="tnum" style={{ fill: "var(--ink-2)", fontSize: 11 }}>{dayLabel(st.dates[i])}</text>
            ))}
            {hover != null && (
              <g>
                <line x1={cx(hover)} x2={cx(hover)} y2={ih} style={{ stroke: "var(--ink-2)" }} />
                {finite(st.values[hover]) && <circle cx={cx(hover)} cy={y(st.values[hover]!)} r={3.5} strokeWidth={2} style={{ fill: "var(--viz-blue)", stroke: "var(--paper)" }} />}
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
          <TipRow color={finite(st.values[hover]) ? "--viz-blue" : undefined} value={valueText(hover)} label={COPY.raw} />
          {finite(normal[hover]) && <TipRow color="--viz-ink" dashed value={`${num(normal[hover])} ${unit}`} label={COPY.normal} />}
        </ChartTooltip>
      )}
    </div>
  );
}
