"use client";
// One water target: headline, evidence, main chart, seasonal chart, read-out, caveat.
import { useId, useMemo } from "react";
import type { RegionSeries } from "@/lib/types";
import { formatValue } from "@/lib/variables";
import { formatP, AUTOCORR_WARN } from "@/lib/stats";
import TimeSeriesChart, { type ChartView } from "@/components/charts/TimeSeriesChart";
import SeasonalChart from "@/components/charts/SeasonalChart";
import { TipRow } from "@/components/charts/ChartTooltip";
import { scrubKey } from "@/components/charts/scrubKeys";
import { MONTH_NAMES, monthLabel, monthLong, plain, signed, type TimeAxis } from "@/components/charts/time";
import {
  TIER_CLEAR_P, TIER_LABEL, TIER_SUGGESTIVE_P, headline, rateLine, type TargetAnalysis,
} from "./analysis";

interface Props {
  analysis: TargetAnalysis;
  series: RegionSeries;
  axis: TimeAxis;
  view: ChartView;
  cursorIndex: number;
  onPick: (i: number) => void;
  hoverIndex: number | null;
  onHover: (i: number | null) => void;
}

function Key({ kind, color }: { kind: "line" | "dot" | "trend" | "band" | "gap"; color?: string }) {
  const c = color ? `var(${color})` : "var(--ink)";
  return (
    <svg width="22" height="10" aria-hidden="true" className="shrink-0">
      {kind === "line" && <line x1="1" x2="21" y1="5" y2="5" strokeWidth="1.25" strokeLinecap="round" style={{ stroke: c, opacity: 0.7 }} />}
      {kind === "dot" && (<><line x1="1" x2="21" y1="5" y2="5" strokeWidth="2" strokeLinecap="round" style={{ stroke: c }} /><circle cx="11" cy="5" r="3.5" strokeWidth="2" style={{ fill: c, stroke: "var(--paper)" }} /></>)}
      {kind === "trend" && <line x1="1" x2="21" y1="5" y2="5" strokeWidth="2" strokeLinecap="round" style={{ stroke: "var(--ink)" }} />}
      {kind === "band" && <rect x="1" y="1" width="20" height="8" style={{ fill: c, opacity: 0.14 }} />}
      {kind === "gap" && <rect x="1" y="0" width="20" height="10" style={{ fill: "var(--ink)", opacity: 0.12 }} />}
    </svg>
  );
}

function LegendItem({ children }: { children: React.ReactNode }) {
  return <li className="flex items-center gap-1.5">{children}</li>;
}

export default function TargetBlock({ analysis: a, series, axis, view, cursorIndex, onPick, hoverIndex, onHover }: Props) {
  const m = a.meta;
  const uid = useId();
  const months = series.months;
  const dec = m.decimals;
  const usualFmt = (x: number) => formatValue(m.id, x);

  /* ----- what is plotted in the current view */
  const monthly = view === "anomaly" ? a.anomalies : a.values;
  const shift = view === "anomaly" ? a.trend.meanOfAnnual : 0;
  const annualYears = a.trend.years;
  const annualValues = useMemo(() => a.trend.annual.map((v) => v - shift), [a, shift]);
  const trend = a.tier === "insufficient" || !Number.isFinite(a.trend.sen.slope) ? null : { intercept: a.trend.sen.intercept - shift, slope: a.trend.sen.slope };
  const last = a.annual.years.length - 1;
  const partialFromYear = last >= 0 && !a.annual.complete[last] ? a.annual.years[last] : null;
  const partialMonths = last >= 0 ? a.annual.counts[last] : 0;

  /* ----- cursor read-out (always the month, whatever the view) */
  const ci = Math.min(axis.n - 1, Math.max(0, cursorIndex));
  const cv = a.values[ci];
  const cm = axis.monthOf(ci);
  const usual = a.clim.mean[cm];
  const anom = Number.isFinite(cv) ? cv - usual : NaN;

  const tooltip = (i: number) => {
    const ym = months[i];
    const y = axis.yearOf(i);
    if (view === "annual") {
      const k = a.annual.years.indexOf(y);
      const ok = k >= 0 && a.annual.complete[k];
      if (!ok) {
        return (
          <div>
            <div className="font-semibold">{y}</div>
            <div className="text-ink-2">{a.annual.counts[k] ?? 0} of 12 months, not a complete year. Not in the trend fit and no annual mean is drawn.</div>
          </div>
        );
      }
      const mean = a.annual.means[k];
      return (
        <div>
          <div className="mb-1 text-ink-2">{y}, annual mean</div>
          <TipRow color={m.color} value={`${usualFmt(mean)} ${m.unit}`} label="mean of 12 months" />
          <TipRow value={`${signed(mean - a.trend.meanOfAnnual, dec)} ${m.unit}`} label={`vs ${a.trend.firstYear}–${a.trend.lastYear} mean ${usualFmt(a.trend.meanOfAnnual)}`} />
        </div>
      );
    }
    const v = a.values[i];
    if (!Number.isFinite(v)) {
      return (
        <div>
          <div className="font-semibold">{monthLong(ym)}</div>
          <div className="text-ink-2">No data for this month. It is left blank, not read as zero.</div>
        </div>
      );
    }
    const u = a.clim.mean[axis.monthOf(i)];
    const d = v - u;
    return (
      <div>
        <div className="mb-1 text-ink-2">{monthLong(ym)}</div>
        <TipRow color={m.color} value={`${usualFmt(v)} ${m.unit}`} label="monthly value" />
        <TipRow value={`${signed(d, dec)} ${m.unit}`} label={`vs usual ${MONTH_NAMES[axis.monthOf(i)]} (${usualFmt(u)})`} />
      </div>
    );
  };

  /* ----- seasonal chart: the year under the cursor */
  const selYear = axis.yearOf(ci);
  const selected = useMemo(
    () => Array.from({ length: 12 }, (_, mo) => {
      const idx = (selYear - axis.firstYear) * 12 + mo - axis.firstMonth;
      return idx >= 0 && idx < axis.n ? a.values[idx] : NaN;
    }),
    [a, axis, selYear],
  );
  const seasonalTip = (mo: number) => {
    const sel = selected[mo];
    return (
      <div>
        <div className="mb-1 text-ink-2">{MONTH_NAMES[mo]}, {a.trend.firstYear}–{a.trend.lastYear}</div>
        <TipRow color={m.color} value={`${usualFmt(a.clim.mean[mo])} ${m.unit}`} label="usual (mean)" />
        <TipRow color={m.color} dashed value={`${usualFmt(a.clim.min[mo])} to ${usualFmt(a.clim.max[mo])}`} label="lowest to highest" />
        <TipRow value={Number.isFinite(sel) ? `${usualFmt(sel)} ${m.unit}` : "no data"} label={String(selYear)} />
      </div>
    );
  };

  const tl = a.trend;
  const headId = `${uid}-h`;
  const valueText = Number.isFinite(cv)
    ? `${monthLong(months[ci])}: ${usualFmt(cv)} ${m.unit}, ${signed(anom, dec)} ${m.unit} versus the usual ${MONTH_NAMES[cm]}`
    : `${monthLong(months[ci])}: no data`;

  return (
    <article aria-labelledby={headId} className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={headId} className="flex items-center gap-2 text-lg">
          <svg width="22" height="10" aria-hidden="true" className="shrink-0"><line x1="1" x2="21" y1="5" y2="5" strokeWidth="3" strokeLinecap="round" style={{ stroke: `var(${m.color})` }} /></svg>
          <span>{m.label}</span>
          <span className="text-sm font-normal text-ink-2" style={{ fontFamily: "var(--font-body-active)" }}>{m.unit}</span>
        </h3>
        <span
          className="rounded-ctl border border-line bg-well px-3 py-0.5 text-sm font-semibold text-ink"
          title={`Wording tiers on the Mann–Kendall p-value: clear trend p < ${TIER_CLEAR_P}; suggestive ${TIER_CLEAR_P} to < ${TIER_SUGGESTIVE_P}; no clear trend otherwise. Reading aids only; the test is preliminary.`}
        >
          {TIER_LABEL[a.tier]}
        </span>
      </div>

      <p className="font-display mt-2 text-xl text-ink">{headline(a)}</p>
      <p className="mt-0.5 text-sm text-ink-2">{rateLine(a)}</p>

      {(m.id === "swe" || m.id === "tws") && a.trend.meanOfAnnual > 2000 && (
        <p className="mt-2 text-sm text-ink">A store this large (mean {usualFmt(a.trend.meanOfAnnual)} mm) is ice-sheet-like. The model has no ice flow or calving, so snow can pile up year after year; read this rise as model behaviour, not as observed ice gain.</p>
      )}
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div><dt className="text-ink-2">Mann–Kendall p</dt><dd className="tnum font-semibold text-ink">{formatP(tl.mk.p)}</dd></div>
        <div><dt className="text-ink-2">Complete years</dt><dd className="tnum font-semibold text-ink">{tl.n}{tl.n ? ` (${tl.firstYear}–${tl.lastYear})` : ""}</dd></div>
        <div><dt className="text-ink-2">Residual autocorrelation, lag 1</dt><dd className="tnum font-semibold text-ink">{Number.isFinite(tl.lag1) ? plain(tl.lag1, 2) : "—"}</dd></div>
      </dl>

      {a.highAutocorr && (
        <p className="mt-2 flex items-start gap-2 rounded-ctl bg-well px-3 py-2 text-sm text-ink" style={{ borderRadius: "min(var(--r-ctl), 10px)" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="mt-[3px] shrink-0">
            <path d="M8 1.8 15 14H1z" fill="none" strokeWidth="1.6" strokeLinejoin="round" style={{ stroke: "var(--ink)" }} />
            <path d="M8 6.2v4M8 11.6v.2" strokeWidth="1.6" strokeLinecap="round" style={{ stroke: "var(--ink)" }} />
          </svg>
          <span>Neighbouring years are correlated (lag-1 r above {AUTOCORR_WARN}). That makes the p-value look stronger than it is, so read this result as weaker than it appears.</span>
        </p>
      )}
      <p className="mt-2 text-[0.8125rem] leading-snug text-ink-2">
        Preliminary: Mann–Kendall test on annual means. It is not corrected for serial correlation or for testing several variables and regions.
      </p>

      {/* cursor read-out */}
      <p className="mt-4 rounded-ctl bg-well px-3 py-2 text-sm text-ink" style={{ borderRadius: "min(var(--r-ctl), 10px)" }}>
        <span className="font-semibold">{monthLabel(months[ci])}</span>{": "}
        {Number.isFinite(cv) ? (
          <>
            <span className="tnum font-semibold">{usualFmt(cv)} {m.unit}</span>
            <span className="text-ink-2">, </span>
            <span className="tnum">{signed(anom, dec)} {m.unit}</span>
            <span className="text-ink-2"> versus the usual {MONTH_NAMES[cm]} ({usualFmt(usual)} {m.unit})</span>
          </>
        ) : (
          <span className="text-ink-2">no data for this month; it is left blank, not read as zero</span>
        )}
      </p>

      <div className="mt-3 grid gap-x-5 gap-y-5 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-ink-2" aria-label="Chart key">
            {view === "monthly" && <LegendItem><Key kind="line" color={m.color} />Monthly value</LegendItem>}
            {view === "anomaly" && <LegendItem><Key kind="line" color={m.color} />Monthly departure from the usual value for that month</LegendItem>}
            <LegendItem><Key kind="dot" color={m.color} />{view === "anomaly" ? "Annual mean departure" : "Annual mean, complete years"}</LegendItem>
            {trend && <LegendItem><Key kind="trend" />Sen trend line</LegendItem>}
            {a.missingMonths > 0 && view !== "annual" && <LegendItem><Key kind="gap" />{a.missingMonths} missing {a.missingMonths === 1 ? "month" : "months"}, left blank</LegendItem>}
          </ul>
          <TimeSeriesChart
            view={view}
            axis={axis}
            monthly={monthly}
            annualYears={annualYears}
            annualValues={annualValues}
            trend={trend}
            partialFromYear={partialFromYear}
            unit={view === "anomaly" ? `${m.unit} (departure)` : m.unit}
            color={m.color}
            cursorIndex={ci}
            hoverIndex={hoverIndex}
            onHover={onHover}
            onPick={onPick}
            tooltip={tooltip}
            label={`${m.label} chart. Left and right arrow keys move one month, shift plus arrow moves one year.`}
            valueText={valueText}
          />
          {partialFromYear != null && (
            <p className="mt-1 text-[0.8125rem] text-ink-2">{partialFromYear} has {partialMonths} of 12 months, so it is shaded and left out of the trend fit and the annual means.</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Seasonal cycle</p>
          <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-ink-2" aria-label="Seasonal chart key">
            <LegendItem><Key kind="dot" color={m.color} />Usual month</LegendItem>
            <LegendItem><Key kind="band" color={m.color} />Lowest to highest</LegendItem>
            <LegendItem><Key kind="trend" />{selYear}</LegendItem>
          </ul>
          <SeasonalChart
            mean={a.clim.mean}
            min={a.clim.min}
            max={a.clim.max}
            selected={selected}
            selectedYear={selYear}
            cursorMonth={cm}
            unit={m.unit}
            color={m.color}
            tooltip={seasonalTip}
            onPickMonth={(mo) => onPick(axis.indexOf(selYear, mo))}
            onKey={(e) => { scrubKey(e, ci, axis.n, onPick); }}
            label={`${m.label} seasonal cycle. Left and right arrow keys move one month, shift plus arrow moves one year.`}
            valueText={valueText}
          />
        </div>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer rounded-ctl py-1 font-semibold text-ink">What this is and is not</summary>
        <div className="mt-1 space-y-1.5 text-ink-2">
          <p>{m.what}</p>
          <p className="text-ink">{m.caveat}</p>
          <p className="text-[0.8125rem]">GLDAS field{m.source.length > 1 ? "s" : ""}: {m.source.join(", ")}.</p>
        </div>
      </details>
    </article>
  );
}
