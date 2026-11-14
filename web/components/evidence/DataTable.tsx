"use client";
import type { TargetAnalysis } from "./analysis";
import { slopeDecimals, TIER_LABEL } from "./analysis";
import { formatValue } from "@/lib/variables";
import { formatP } from "@/lib/stats";
import { plain } from "@/components/charts/time";

const th = "px-3 py-2 text-left align-bottom text-[0.8125rem] font-semibold text-ink-2";
const td = "px-3 py-1.5 align-top tnum";

/** Accessible alternative to the charts: trend statistics and annual means for the selected targets. */
export default function DataTable({ analyses, years }: { analyses: TargetAnalysis[]; years: { year: number; complete: boolean; months: number }[] }) {
  return (
    <div className="space-y-6" id="evidence-table">
      <div>
        <div role="region" aria-label="Trend statistics table, scrollable" tabIndex={0} className="overflow-x-auto rounded-ctl" style={{ borderRadius: "min(var(--r-ctl), 8px)" }}>
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="pb-2 text-left font-semibold text-ink">Trend statistics, complete years only</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={th}>Target</th>
                <th scope="col" className={th}>Sen slope per decade (95 % interval)</th>
                <th scope="col" className={th}>Percent of mean per decade</th>
                <th scope="col" className={th}>Mann–Kendall p</th>
                <th scope="col" className={th}>Kendall tau</th>
                <th scope="col" className={th}>Years</th>
                <th scope="col" className={th}>Lag-1 autocorrelation</th>
                <th scope="col" className={th}>OLS slope per decade (OLS 95 % interval)</th>
                <th scope="col" className={th}>Reading</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a) => {
                const d = slopeDecimals(a.perDecade, a.perDecadeLow, a.perDecadeHigh);
                const o = a.trend.ols;
                const od = slopeDecimals(o.slope * 10, o.ciLow * 10, o.ciHigh * 10);
                return (
                  <tr key={a.id} className="border-b border-line align-top">
                    <th scope="row" className="px-3 py-1.5 text-left font-semibold text-ink">{a.meta.label}<span className="block text-[0.8125rem] font-normal text-ink-2">{a.meta.trendUnit}</span></th>
                    <td className={td}>{plain(a.perDecade, d)} ({plain(a.perDecadeLow, d)} to {plain(a.perDecadeHigh, d)})</td>
                    <td className={td}>{a.pctPerDecade != null ? `${plain(a.pctPerDecade, 1)} %` : "not shown"}</td>
                    <td className={td}>{formatP(a.trend.mk.p)}</td>
                    <td className={td}>{plain(a.trend.mk.tau, 2)}</td>
                    <td className={`${td} whitespace-nowrap`}>{a.trend.n} ({a.trend.firstYear}–{a.trend.lastYear})</td>
                    <td className={td}>{plain(a.trend.lag1, 2)}</td>
                    <td className={td}>{plain(o.slope * 10, od)} ({plain(o.ciLow * 10, od)} to {plain(o.ciHigh * 10, od)})</td>
                    <td className="px-3 py-1.5 align-top">{TIER_LABEL[a.tier]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[0.8125rem] text-ink-2">The Sen interval belongs to the Sen slope; the OLS interval belongs to the least-squares slope. They are different estimates and are not interchangeable. Preliminary, not corrected for serial correlation or multiple testing.</p>
      </div>

      <div role="region" aria-label="Annual means table, scrollable" tabIndex={0} className="max-h-96 overflow-auto rounded-ctl" style={{ borderRadius: "min(var(--r-ctl), 8px)" }}>
        <table className="w-full border-collapse text-sm">
          <caption className="pb-2 text-left font-semibold text-ink">Annual means (a year is complete only with all 12 months)</caption>
          <thead className="sticky top-0 bg-paper">
            <tr className="border-b border-line">
              <th scope="col" className={th}>Year</th>
              {analyses.map((a) => <th key={a.id} scope="col" className={th}>{a.meta.short}, {a.meta.unit}</th>)}
            </tr>
          </thead>
          <tbody>
            {years.map((y, i) => (
              <tr key={y.year} className="border-b border-line">
                <th scope="row" className="px-3 py-1 text-left font-normal tnum text-ink">{y.year}{y.complete ? "" : ` (${y.months} months, not used)`}</th>
                {analyses.map((a) => <td key={a.id} className="px-3 py-1 tnum text-ink">{y.complete ? formatValue(a.id, a.annual.means[i]) : "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
