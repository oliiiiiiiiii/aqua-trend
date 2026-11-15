"use client";
import { useId } from "react";
import { SPEEDS } from "@/components/explore/PlaybackBar";
import { formatMonth } from "@/components/explore/regionUtils";
import type { ExploreState } from "@/components/explore/useExploreState";
import type { RegionSeries, VarId } from "@/lib/types";
import { VARIABLES } from "@/lib/variables";

/**
 * The timeline written as a dated entry: the month in large type, transport controls, and a ruler to scrub on.
 * The ruler has a tick per month, a longer one each January, and a pencil trace of the first target above it.
 */
export function Entry({ s }: { s: ExploreState }) {
  const { series, region } = s;
  const ready = s.seriesStatus === "ready";
  const noData = ready && series === null;

  if (!region) return null;
  if (!series) {
    return (
      <section aria-label="Month and history playback" className="border-t border-[var(--on-stage)] pt-3 text-[0.9375rem] text-ink-2" role={ready ? undefined : "status"}>
        {noData
          ? "No monthly series for this region, so history playback is unavailable. Missing data is not a dry or frozen result."
          : s.seriesStatus === "error"
            ? "History playback needs the monthly series."
            : "Loading the monthly series…"}
      </section>
    );
  }
  return <Dated s={s} series={series} />;
}

function Dated({ s, series }: { s: ExploreState; series: RegionSeries }) {
  const id = useId();
  const { monthIndex, playing, setPlaying, setMonthIndex } = s;
  const n = series.months.length;
  const month = series.months[monthIndex];
  const atEnd = monthIndex >= n - 1;
  const trace = s.targets[0];

  const step = (d: number) => {
    setPlaying(false);
    setMonthIndex(Math.max(0, Math.min(n - 1, monthIndex + d)));
  };
  const btn =
    "grid h-9 w-9 shrink-0 place-items-center rounded-ctl border border-[var(--on-stage)] text-lg leading-none hover:bg-well disabled:opacity-35 disabled:hover:bg-transparent";

  return (
    <section aria-label="Month and history playback" className="border-t border-[var(--on-stage)] pt-2.5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="min-w-[13rem]">
          <p className="font-display text-[2.5rem] leading-none tnum sm:text-[2.75rem]" aria-live={playing ? "off" : "polite"}>
            {formatMonth(month)}
          </p>
          <p className="mt-1 text-[0.8125rem] leading-tight text-ink-2 tnum">
            {s.reducedMotion ? "Plays only when you press Play. " : ""}Month {monthIndex + 1} of {n}, history not forecast
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => step(-1)} disabled={monthIndex === 0} className={btn}>
            <span aria-hidden="true">‹</span>
            <span className="sr-only">Previous month</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (playing) setPlaying(false);
              else {
                if (atEnd) setMonthIndex(0);
                setPlaying(true);
              }
            }}
            aria-pressed={playing}
            className="inline-flex h-9 min-w-[8rem] items-center justify-center gap-2 rounded-ctl bg-action px-4 font-semibold text-on-action hover:bg-action-hover"
          >
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2.5 1l8 5-8 5z" />}
            </svg>
            {playing ? "Pause" : atEnd ? "Replay" : "Play history"}
          </button>
          <button type="button" onClick={() => step(1)} disabled={atEnd} className={btn}>
            <span aria-hidden="true">›</span>
            <span className="sr-only">Next month</span>
          </button>
        </div>

        <label className="flex items-center gap-1.5 text-sm text-ink-2">
          Speed
          <select
            value={s.speed}
            onChange={(e) => s.setSpeed(Number(e.target.value))}
            className="rounded-ctl border border-[var(--on-stage)] bg-paper px-2 py-1 text-ink"
          >
            {SPEEDS.map((x) => (
              <option key={x.value} value={x.value}>{x.label}</option>
            ))}
          </select>
        </label>

        {trace && (
          <p className="ml-auto max-w-[16rem] text-right text-xs leading-tight text-ink-3">
            Pencil trace: {VARIABLES[trace].short} ({VARIABLES[trace].unit}), fixed range {VARIABLES[trace].domain[0]} to {VARIABLES[trace].domain[1]}. Gaps are missing months.
          </p>
        )}
      </div>

      <Ruler
        id={`${id}-ruler`}
        months={series.months}
        index={monthIndex}
        valueText={formatMonth(month)}
        onChange={(i) => { setPlaying(false); setMonthIndex(i); }}
        trace={trace ? { v: trace, data: series.values[trace] } : null}
      />
    </section>
  );
}

const PAD = 8; // half the thumb width, so the ticks line up with where the thumb stops

function Ruler({
  id, months, index, valueText, onChange, trace,
}: {
  id: string;
  months: string[];
  index: number;
  valueText: string;
  onChange: (i: number) => void;
  trace: { v: VarId; data: ArrayLike<number> } | null;
}) {
  const n = months.length;
  const last = Math.max(1, n - 1);
  const TRACE_H = 22;
  const TICK_H = 16;
  const m = trace ? VARIABLES[trace.v] : null;

  // pencil trace as separate segments, so a missing month leaves a gap
  let tracePath = "";
  if (trace && m) {
    const [lo, hi] = m.domain;
    let pen = false;
    for (let i = 0; i < n; i++) {
      const raw = trace.data[i];
      if (!Number.isFinite(raw)) { pen = false; continue; }
      const t = Math.min(1, Math.max(0, (raw - lo) / (hi - lo)));
      tracePath += `${pen ? "L" : "M"}${i} ${(TRACE_H - 1 - t * (TRACE_H - 2)).toFixed(1)}`;
      pen = true;
    }
  }
  const years: { year: number; i: number }[] = [];
  months.forEach((mo, i) => { if (mo.endsWith("-01")) years.push({ year: Number(mo.slice(0, 4)), i }); });
  const left = (i: number) => `calc(${PAD}px + (100% - ${PAD * 2}px) * ${i / last})`;

  return (
    <div className="relative mt-1.5" style={{ height: TRACE_H + TICK_H + 20 }}>
      <div className="absolute inset-x-0 top-0" style={{ paddingInline: PAD }} aria-hidden="true">
        <svg width="100%" height={TRACE_H} viewBox={`0 0 ${last} ${TRACE_H}`} preserveAspectRatio="none" className="block overflow-visible">
          <path d={tracePath} fill="none" stroke={m ? `var(${m.color})` : "currentColor"} strokeWidth={1.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <svg width="100%" height={TICK_H} viewBox={`0 0 ${last} ${TICK_H}`} preserveAspectRatio="none" className="block overflow-visible text-ink-2">
          <line x1={0} x2={last} y1={0.5} y2={0.5} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {months.map((mo, i) => {
            const jan = mo.endsWith("-01");
            const y = Number(mo.slice(0, 4));
            const h = jan ? (y % 5 === 0 ? TICK_H : TICK_H * 0.62) : TICK_H * 0.3;
            return <line key={mo} x1={i} x2={i} y1={0} y2={h} stroke="currentColor" strokeWidth={1} strokeOpacity={jan ? 0.95 : 0.55} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
        {years.filter((y) => y.year % 5 === 0).map(({ year, i }) => (
          <span key={year} className="absolute top-full mt-1 -translate-x-1/2 text-xs leading-none text-ink-2 tnum" style={{ left: left(i) }}>
            {year}
          </span>
        ))}
      </div>
      <label htmlFor={id} className="sr-only">Month</label>
      <div className="absolute inset-x-0 top-0" style={{ height: TRACE_H + TICK_H + 2 }}>
        <input
          id={id}
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={index}
          aria-valuetext={valueText}
          onChange={(e) => onChange(Number(e.target.value))}
          className="j-ruler-input"
        />
      </div>
    </div>
  );
}
