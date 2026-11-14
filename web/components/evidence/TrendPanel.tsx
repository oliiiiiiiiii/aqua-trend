"use client";
// Evidence section: how each selected water target changed, by how much, and how strong the evidence is.
// Real GLDAS monthly regional series. Stats are computed in lib/stats.ts from complete years only.
import { useId, useMemo, useState } from "react";
import type { TrendPanelProps } from "@/lib/contracts";
import { DATASET } from "@/lib/variables";
import { Provenance } from "@/components/ui/Provenance";
import type { ChartView } from "@/components/charts/TimeSeriesChart";
import { timeAxis } from "@/components/charts/time";
import { analyseTarget, TIER_CLEAR_P, TIER_SUGGESTIVE_P, MIN_YEARS } from "./analysis";
import TargetBlock from "./TargetBlock";
import RegionContext from "./RegionContext";
import DataTable from "./DataTable";
import { buildCsv, downloadText } from "./csv";
import { AUTOCORR_WARN } from "@/lib/stats";

export interface TrendPanelExtraProps {
  className?: string;
  /** which view is shown first (default "monthly") */
  defaultView?: ChartView;
  /** open the table view initially */
  defaultShowTable?: boolean;
}

const VIEWS: { id: ChartView; label: string; note: string }[] = [
  { id: "monthly", label: "Monthly values", note: "Monthly values and the mean of each complete year, with the Sen trend line." },
  { id: "anomaly", label: "Seasonal cycle removed", note: "Each month minus the average of that calendar month. Take the seasons out and a slow trend that they hide becomes visible." },
  { id: "annual", label: "Yearly means", note: "One point per complete year, the data the trend test actually uses." },
];

const btn = "rounded-ctl border border-line bg-paper px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-well";

export default function TrendPanel({ region, series, targets, monthIndex, onMonthChange, className = "", defaultView = "monthly", defaultShowTable = false }: TrendPanelProps & TrendPanelExtraProps) {
  const uid = useId();
  const [view, setView] = useState<ChartView>(defaultView);
  const [showTable, setShowTable] = useState(defaultShowTable);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const axis = useMemo(() => timeAxis(series.months), [series.months]);
  const analyses = useMemo(() => targets.map((t) => analyseTarget(series, t)), [series, targets]);
  const cursor = Math.min(axis.n - 1, Math.max(0, monthIndex));
  const years = useMemo(() => {
    const a = analyses[0]?.annual;
    return a ? a.years.map((year, i) => ({ year, complete: a.complete[i], months: a.counts[i] })) : [];
  }, [analyses]);
  const viewNote = VIEWS.find((v) => v.id === view)!.note;
  const first = analyses[0]?.trend;
  const period = first && first.n ? `${first.firstYear}–${first.lastYear}` : "2000–2025";

  const onDownload = () => downloadText(`aqua-trend_${region.id}_${targets.join("-")}.csv`, buildCsv(region, series, targets));

  return (
    <section aria-labelledby={`${uid}-title`} className={`@container text-ink ${className}`}>
      <h2 id={`${uid}-title`} className="text-2xl">Trend evidence</h2>
      <p className="mt-1 max-w-prose text-ink-2">How each selected water target changed from {axis.firstYear} to {axis.yearOf(axis.n - 1)}, how fast, and how strong the evidence for a trend is.</p>
      <p className="mt-3"><Provenance kind="real">Real NASA data: {DATASET.short}</Provenance></p>

      <div className="mt-4"><RegionContext region={region} /></div>

      {analyses.length === 0 ? (
        <p className="mt-6 rounded-card bg-well px-4 py-6 text-ink-2" style={{ borderRadius: "min(var(--r-card), 14px)" }}>Choose one to three water targets to see how they changed in this region.</p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div role="group" aria-label="Chart view, applies to every chart" className="inline-flex flex-wrap gap-1 rounded-ctl border border-line bg-well p-1" style={{ borderRadius: "min(var(--r-ctl), 12px)" }}>
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === v.id}
                  onClick={() => setView(v.id)}
                  className={`rounded-ctl px-3 py-1.5 text-sm ${view === v.id ? "border border-line bg-paper font-semibold text-ink shadow-sm" : "border border-transparent text-ink-2 hover:text-ink"}`}
                  style={{ borderRadius: "min(var(--r-ctl), 9px)" }}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" className={btn} aria-expanded={showTable} aria-controls="evidence-table" onClick={() => setShowTable((s) => !s)}>{showTable ? "Hide table" : "Show table"}</button>
              <button type="button" className={btn} onClick={onDownload}>Download CSV</button>
            </div>
          </div>
          <p className="mt-2 max-w-prose text-sm text-ink-2" aria-live="polite">{viewNote}</p>

          <div className="mt-6 space-y-8" onPointerLeave={() => setHoverIndex(null)}>
            {analyses.map((a) => (
              <TargetBlock key={a.id} analysis={a} series={series} axis={axis} view={view} cursorIndex={cursor} onPick={onMonthChange} hoverIndex={hoverIndex} onHover={setHoverIndex} />
            ))}
          </div>

          {showTable && <div className="mt-8"><DataTable analyses={analyses} years={years} /></div>}

          <div className="mt-8 space-y-1.5 border-t border-line pt-4 text-[0.8125rem] leading-snug text-ink-2">
            <p>Trend statistics use complete calendar years only ({period}); a year with any missing month is dropped, and the partial final year is shown but never fitted. The rate is the Sen slope (median of all pairwise yearly slopes) with its own rank-based 95 % interval. At least {MIN_YEARS} complete years are required.</p>
            <p>Evidence wording follows the Mann–Kendall p-value: clear trend when p &lt; {TIER_CLEAR_P}, suggestive when {TIER_CLEAR_P} ≤ p &lt; {TIER_SUGGESTIVE_P}, no clear trend otherwise. These cut-offs are reading aids for a preliminary test, not proof. A lag-1 autocorrelation of the residuals above {AUTOCORR_WARN} triggers a warning because serial correlation inflates apparent significance.</p>
            <p>A trend in one variable says nothing about why it changed. All variables come from one model product ({DATASET.short}), so agreement between them is not independent evidence.</p>
          </div>
        </>
      )}
    </section>
  );
}
