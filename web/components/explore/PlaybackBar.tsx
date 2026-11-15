"use client";
import { useId } from "react";
import type { RegionSeries, VarId } from "@/lib/types";
import { VARIABLES, formatValue } from "@/lib/variables";
import { SEASON_DEFAULT, formatMonth, nextIn, prevIn, seasonLabel, type PlayWindow } from "./regionUtils";

const MONTH_SHORT_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const SPEEDS = [
  { value: 2, label: "2 months/s" },
  { value: 4, label: "4 months/s" },
  { value: 8, label: "8 months/s" },
];

export interface PlaybackBarProps {
  series: RegionSeries;
  monthIndex: number;
  onMonthChange: (i: number) => void;
  playing: boolean;
  onPlayingChange: (p: boolean) => void;
  speed: number;
  onSpeedChange: (s: number) => void;
  reducedMotion: boolean;
  /** also list this month's values for these targets (plus air temperature) under the bar; omit for the slim bar */
  valuesFor?: VarId[];
  /** month indices playback and stepping visit (ascending); omit for the whole series */
  sequence?: number[];
  /** playback window controls; omit to hide them */
  window?: PlayWindow;
  yearRange?: [number, number];
  onWindowChange?: (patch: Partial<PlayWindow>) => void;
  /** season wording for the current month (e.g. "Autumn (N. Hemisphere)"), shown next to the month */
  seasonNote?: string;
  className?: string;
}

/** Slim paper bar: previous / play / next, the month, a scrubber with year ticks and the speed. */
export function PlaybackBar({
  series,
  monthIndex,
  onMonthChange,
  playing,
  onPlayingChange,
  speed,
  onSpeedChange,
  reducedMotion,
  valuesFor,
  sequence,
  window: win,
  yearRange,
  onWindowChange,
  seasonNote,
  className = "",
}: PlaybackBarProps) {
  const id = useId();
  const n = series.months.length;
  const month = series.months[monthIndex];
  const years = yearTicks(series.months);
  const seq = sequence && sequence.length ? sequence : null;
  const prev = seq ? prevIn(seq, monthIndex) : monthIndex > 0 ? monthIndex - 1 : null;
  const next = seq ? nextIn(seq, monthIndex) : monthIndex < n - 1 ? monthIndex + 1 : null;
  const runs = seq ? runsOf(seq) : [];
  const partial = !!seq && seq.length < n;
  const season = win ? `${win.startMonth}-${win.endMonth}` : SEASON_DEFAULT;
  const isDefault = !win || !yearRange || (win.from === yearRange[0] && win.to === yearRange[1] && season === SEASON_DEFAULT);

  function step(target: number | null) {
    onPlayingChange(false);
    if (target != null) onMonthChange(target);
  }

  const iconBtn =
    "grid h-9 w-9 shrink-0 place-items-center rounded-ctl border border-line text-lg leading-none hover:bg-well disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <section aria-label="Month and history playback" className={`rounded-card bg-paper px-3 py-2 text-ink shadow-card sm:px-4 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => step(prev)} disabled={prev == null} className={iconBtn}>
            <span aria-hidden="true">‹</span>
            <span className="sr-only">Previous month</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (playing) onPlayingChange(false);
              else {
                // starting from outside the window: begin at the next in-window month (or the first one)
                if (seq && !seq.includes(monthIndex)) onMonthChange(nextIn(seq, monthIndex) ?? seq[0]);
                onPlayingChange(true);
              }
            }}
            aria-pressed={playing}
            className="inline-flex h-9 min-w-[7.5rem] items-center justify-center gap-2 rounded-ctl bg-action px-4 font-semibold text-on-action hover:bg-action-hover"
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2.5 1l8 5-8 5z" />}
            </svg>
            {playing ? "Pause" : "Play history"}
          </button>
          <button type="button" onClick={() => step(next)} disabled={next == null} className={iconBtn}>
            <span aria-hidden="true">›</span>
            <span className="sr-only">Next month</span>
          </button>
        </div>

        <div className="min-w-[8.5rem]">
          <p className="font-display text-xl leading-tight tnum" aria-live={playing ? "off" : "polite"}>{formatMonth(month)}</p>
          <p className="text-xs leading-tight text-ink-3 tnum">
            {seasonNote ? <>{seasonNote}, </> : null}
            {reducedMotion ? "plays only when you press Play" : "history, not forecast"}
          </p>
        </div>

        <div className="order-last min-w-[12rem] flex-1 basis-full md:order-none md:basis-0">
          <label htmlFor={`${id}-scrub`} className="sr-only">Month</label>
          <input
            id={`${id}-scrub`}
            type="range"
            min={0}
            max={n - 1}
            step={1}
            value={monthIndex}
            aria-valuetext={formatMonth(month)}
            onChange={(e) => { onPlayingChange(false); onMonthChange(Number(e.target.value)); }}
            className="block h-5 w-full accent-[var(--link)]"
          />
          <div aria-hidden="true" className="relative mx-2 h-[1.375rem] text-[0.6875rem] leading-none text-ink-3 tnum">
            {partial && seq && (
              <span
                className="absolute top-0 h-1.5 rounded-full bg-[var(--link)] opacity-20"
                style={{ left: `${(seq[0] / (n - 1)) * 100}%`, width: `${((seq[seq.length - 1] - seq[0]) / (n - 1)) * 100}%` }}
              />
            )}
            {partial &&
              runs.map(([a, b]) => (
                <span
                  key={a}
                  className="absolute top-0 h-1.5 rounded-full bg-[var(--link)] opacity-60"
                  style={{ left: `${(a / (n - 1)) * 100}%`, width: `max(3px, ${((b - a) / (n - 1)) * 100}%)` }}
                />
              ))}
            {years.map(({ year, i }) => (
              <span key={year} className="absolute top-1.5 -translate-x-1/2 text-center" style={{ left: `${(i / (n - 1)) * 100}%` }}>
                <span className={`mx-auto block w-px bg-[var(--viz-axis)] ${year % 5 === 0 ? "h-1.5" : "h-1"}`} />
                {year % 5 === 0 ? year : null}
              </span>
            ))}
          </div>
        </div>

        <label className="ml-auto flex items-center gap-1.5 text-sm text-ink-2 md:ml-0">
          Speed
          <select
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="rounded-ctl border border-line bg-paper px-2 py-1 text-ink"
          >
            {SPEEDS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      {win && yearRange && onWindowChange && (
        <div role="group" aria-label="Playback window" className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-1.5 text-sm text-ink-2">
          <span className="flex items-center gap-1.5">
            <label htmlFor={`${id}-from`}>Years</label>
            <select id={`${id}-from`} value={win.from} onChange={(e) => onWindowChange({ from: Number(e.target.value) })} className={sel}>
              {range(yearRange[0], yearRange[1]).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <label htmlFor={`${id}-to`}>to</label>
            <select id={`${id}-to`} value={win.to} onChange={(e) => onWindowChange({ to: Number(e.target.value) })} className={sel}>
              {range(yearRange[0], yearRange[1]).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </span>
          <span className="flex items-center gap-1.5">
            <label htmlFor={`${id}-sm`}>Season</label>
            <select id={`${id}-sm`} value={win.startMonth} onChange={(e) => onWindowChange({ startMonth: Number(e.target.value) })} className={sel}>
              {MONTH_SHORT_NAMES.map((m, k) => <option key={m} value={k + 1}>{m}</option>)}
            </select>
            <label htmlFor={`${id}-em`}>to</label>
            <select id={`${id}-em`} value={win.endMonth} onChange={(e) => onWindowChange({ endMonth: Number(e.target.value) })} className={sel}>
              {MONTH_SHORT_NAMES.map((m, k) => <option key={m} value={k + 1}>{m}</option>)}
            </select>
          </span>
          <span className="text-xs text-ink-3 tnum" aria-live="polite">
            {seq ? `${seq.length} months, ${win.startMonth === 1 && win.endMonth === 12 ? "" : `${seasonLabel(win.startMonth, win.endMonth)}, `}${win.from} to ${win.to}` : ""}
          </span>
          {!isDefault && (
            <button
              type="button"
              onClick={() => onWindowChange({ from: yearRange[0], to: yearRange[1], startMonth: 1, endMonth: 12 })}
              className="rounded-ctl text-sm text-link underline underline-offset-2 hover:no-underline"
            >
              Whole history
            </button>
          )}
        </div>
      )}

      {valuesFor && (
        <dl className="mt-3 grid gap-x-6 gap-y-1 border-t border-line pt-2 text-[0.9375rem] sm:grid-cols-2">
          {[...valuesFor, ...(valuesFor.includes("tair") ? [] : (["tair"] as VarId[]))].map((v) => {
            const m = VARIABLES[v];
            const x = series.values[v][monthIndex];
            return (
              <div key={v} className="flex items-baseline justify-between gap-3">
                <dt className="flex items-center gap-2 text-ink-2">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(${m.color})` }} />
                  {m.short}
                  {!m.target && <span className="text-xs text-ink-3">(context)</span>}
                </dt>
                <dd className="tnum">{Number.isNaN(x) ? <span className="text-ink-3">no data</span> : formatValue(v, x, true)}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}

const sel = "rounded-ctl border border-line bg-paper px-1.5 py-0.5 text-ink";
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

/** consecutive runs [first, last] in an ascending index list */
function runsOf(seq: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const i of seq) {
    const last = out[out.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

function yearTicks(months: string[]) {
  const out: { year: number; i: number }[] = [];
  months.forEach((m, i) => { if (m.endsWith("-01")) out.push({ year: Number(m.slice(0, 4)), i }); });
  return out;
}
