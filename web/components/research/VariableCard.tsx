"use client";
// One variable of the result (spec §9 items 4–5; acceptance D03–D09): product decision, status, three linked
// views (raw full history, fixed seasonal pattern, de-seasonalised anomaly with the fitted line), trend numbers,
// data table and limitations. A variable that could not be analysed keeps its card and says why.
import { agencyKind, decimalsFor, fixed, pct, periodLabel, ROLE_LABEL, timeLabel, timeX } from "@/lib/research/format";
import type { EvidenceFamily, Period, ProductDecision, VariableResult } from "@/lib/research/types";
import CycleChart from "./CycleChart";
import HistoryChart, { ChartKey } from "./HistoryChart";
import { SeriesTable } from "./SeriesTable";
import { TrendBlock } from "./TrendBlock";
import { Card, Facts, ItemStatusPill, Notice, Pill, RefList, summaryCls } from "./ui";

/** Shared time state of the result (spec §9): the view range and the cursor never change a number. */
export interface TimeView {
  /** visible range; null = each series' full history */
  view: Period | null;
  cursor: string | null;
  setCursor: (t: string | null) => void;
  /** pending selection that can be applied as a new analysis period */
  brush: Period | null;
  setBrush: (p: Period | null) => void;
}

export const viewDomain = (view: Period | null): [number, number] | null =>
  view ? [timeX(view.start) - 0.5 / 12, timeX(view.end) + 0.5 / 12] : null;

export function ProductBlock({ decision, heading = "Data product" }: { decision: ProductDecision; heading?: string }) {
  const kind = agencyKind(decision.agency, decision.nasa);
  const chosen = decision.selected_product_id;
  return (
    <div data-testid="product-decision">
      <h4 className="text-base">{heading}</h4>
      {chosen ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
          <span className="font-semibold">{decision.product_label ?? chosen}</span>
          <code className="text-[0.8125rem] text-ink-3">{chosen}</code>
          {decision.agency && <span className="text-ink-2">{decision.agency}</span>}
          {kind && <Pill>{kind}</Pill>}
          {decision.fallback ? (
            <Pill tone="warn"><span aria-hidden="true">!</span> Fallback product, priority {decision.priority_rank ?? "?"}</Pill>
          ) : decision.priority_rank != null ? (
            <Pill>{decision.priority_rank === 1 ? "Primary product (priority 1)" : `Priority ${decision.priority_rank}`}</Pill>
          ) : null}
        </p>
      ) : (
        <p className="mt-1 text-ink-2">No approved product could be used for this variable.</p>
      )}
      {decision.fallback && (
        <Notice tone="warn" className="mt-2">
          A lower-priority approved product is used for the whole analysis.{" "}
          {decision.fallback_reason ? <>Why the higher-priority products were not used: {decision.fallback_reason}</> : null}
        </Notice>
      )}
      {decision.status !== "ok" && decision.status_reason && <Notice tone="warn" className="mt-2">{decision.status_reason}</Notice>}
      <Facts
        className="mt-2"
        rows={[
          ["Product record in this region", periodLabel(decision.available_period)],
          ["Valid share of the analysis period", decision.coverage == null ? "—" : pct(decision.coverage, 1)],
          ...(decision.quality_flags.length ? [["Quality flags", decision.quality_flags.join(", ")] as [string, string]] : []),
          ...(decision.product_version ? [["Product version", decision.product_version] as [string, string]] : []),
          ...(decision.suitability ? [["What it supports here", decision.suitability] as [string, string]] : []),
          ...(decision.caveat ? [["Caveat", decision.caveat] as [string, string]] : []),
          ...(decision.quality_limits?.length ? [["Known limits", decision.quality_limits.join(" ")] as [string, string]] : []),
        ]}
      />
      {decision.rejected.length > 0 && (
        <details className="mt-1">
          <summary className={summaryCls}>Approved products that were not used ({decision.rejected.length})</summary>
          <ul className="mt-1 space-y-1 text-sm text-ink-2">
            {decision.rejected.map((r, i) => (
              <li key={`${r.product_id}-${i}`}>
                <code className="text-[0.8125rem]">{r.product_id ?? "?"}</code>
                {r.rank != null ? ` (priority ${r.rank})` : ""}: {r.reason ?? "no reason recorded"}
              </li>
            ))}
          </ul>
        </details>
      )}
      {decision.source_refs.length > 0 && (
        <details className="mt-1">
          <summary className={summaryCls}>Product sources</summary>
          <div className="mt-1"><RefList refs={decision.source_refs} title="Sources" /></div>
        </details>
      )}
    </div>
  );
}

export function BrushHint({ time, onApply, busy }: { time: TimeView; onApply: () => void; busy: boolean }) {
  if (!time.brush) {
    return (
      <p className="text-[0.8125rem] text-ink-3">
        Drag across the chart to select a period. With the keyboard: arrow keys move the cursor, [ and ] set the start and end of the selection, Escape clears it.
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
      <span>Selected: <span className="font-semibold text-ink">{periodLabel(time.brush)}</span>. This only marks a range; no number has changed.</span>
      <button type="button" disabled={busy} onClick={onApply} className="rounded-ctl bg-action px-3 py-1 text-sm font-semibold text-on-action hover:bg-action-hover disabled:opacity-60">
        Apply as analysis period
      </button>
      <button type="button" onClick={() => time.setBrush(null)} className="text-link underline underline-offset-2">Clear selection</button>
    </p>
  );
}

export function VariableCard({
  v,
  families,
  time,
  onApplyBrush,
  busy,
}: {
  v: VariableResult;
  families: EvidenceFamily[];
  time: TimeView;
  onApplyBrush: () => void;
  busy: boolean;
}) {
  const s = v.series;
  const unit = v.unit ?? "";
  const dec = typeof v.display?.decimals === "number" ? v.display.decimals : decimalsFor(s?.raw ?? []);
  const domain = viewDomain(time.view);
  const cursorMonth = time.cursor && time.cursor.length >= 7 ? Number(time.cursor.slice(5, 7)) - 1 : null;
  const analysis = v.analysis_period ?? null;
  const support = v.actual_support;
  const headingId = `var-${v.variable_id}`;

  return (
    <Card aria-labelledby={headingId} data-testid="variable-card" data-variable={v.variable_id} data-status={v.status}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-xl">
            {v.label}
            {v.label_zh ? <span lang="zh-Hant" className="ml-2 text-base font-normal text-ink-2">{v.label_zh}</span> : null}
          </h3>
          <p className="text-sm text-ink-3">
            {unit ? `${unit}` : "no unit"}{v.temporal_support ? `, ${v.temporal_support.replace(/_/g, " ")}` : ""} · <code>{v.variable_id}</code>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill>{ROLE_LABEL[v.role]}</Pill>
          <ItemStatusPill status={v.status} />
        </div>
      </div>

      {v.status !== "ok" && (
        <Notice tone="warn" role="status" className="mt-3">
          <span className="font-semibold text-ink">This variable was not analysed.</span>{" "}
          {v.status_reason ?? "The backend gave no reason."} Your region and period were not changed to make it work.
        </Notice>
      )}

      <p className="mt-3 max-w-[72ch] text-ink-2"><span className="font-semibold text-ink">Why it was selected:</span> {v.reason}</p>

      <div className="mt-4 grid gap-6 border-t border-line pt-4 lg:grid-cols-2">
        <ProductBlock decision={v.product} />
        <div>
          <h4 className="text-base">Periods</h4>
          <Facts
            className="mt-1"
            rows={[
              ["Period you asked for", v.requested_period ? periodLabel(v.requested_period) : "None (left open)"],
              ["Analysis period (fitted)", <span key="a" data-testid="analysis-period">{periodLabel(analysis)}</span>],
              [
                "Data actually present in it",
                support ? (
                  <span key="s" className="tnum">
                    {support.start ? `${timeLabel(support.start)} to ${timeLabel(support.end)}` : "no valid month"}, {support.n_valid} of {support.n_expected} months ({pct(support.coverage, 1)})
                    {support.longest_gap > 0 ? `, longest gap ${support.longest_gap} months` : ""}
                  </span>
                ) : "—",
              ],
              ["Full history of this product", periodLabel(v.full_history)],
              [
                "In the common comparison",
                v.in_comparison ? "Yes" : `No${v.comparison_exclusion_reason ? `: ${v.comparison_exclusion_reason}` : ""}`,
              ],
              ["Fixed seasonal reference", v.baseline_id ? <code key="b" className="text-[0.8125rem]">{v.baseline_id}</code> : "—"],
            ]}
          />
          {support && support.n_valid < support.n_expected && (
            <Notice tone="warn" className="mt-2">
              The analysis period is not fully covered: {support.n_expected - support.n_valid} of {support.n_expected} months are missing. They stay missing; the period was not shortened.
            </Notice>
          )}
        </div>
      </div>

      {s && (
        <div className="mt-5 space-y-5 border-t border-line pt-4">
          <figure>
            <figcaption className="font-semibold text-ink">Raw values, full history</figcaption>
            <HistoryChart
              times={s.times}
              values={s.raw}
              unit={unit}
              seriesName="raw monthly value"
              analysis={analysis}
              view={domain}
              cursor={time.cursor}
              onCursor={time.setCursor}
              brush={time.brush}
              onBrush={time.setBrush}
              decimals={dec}
              label={`${v.label}, raw values over the full history. Arrow keys move the cursor; bracket keys set a selection.`}
            />
            <ChartKey items={[
              { kind: "line", label: "Raw monthly value" },
              { kind: "analysis", label: "Analysis period" },
              { kind: "missing", label: "Missing months (not zero)" },
              ...(time.brush ? [{ kind: "brush" as const, label: "Your selection (not applied)" }] : []),
            ]} />
            <div className="mt-1.5"><BrushHint time={time} onApply={onApplyBrush} busy={busy} /></div>
          </figure>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <figure className="min-w-0">
              <figcaption className="font-semibold text-ink">Fixed seasonal pattern</figcaption>
              {s.seasonal_cycle ? (
                <>
                  <CycleChart
                    cycle={s.seasonal_cycle}
                    unit={unit}
                    decimals={dec}
                    cursorMonth={cursorMonth}
                    label={`${v.label}, mean of each calendar month in the fixed reference period`}
                  />
                  <p className="mt-1 text-[0.8125rem] text-ink-3">
                    Calendar-month means of the registered reference period. They stay the same when the analysis period changes.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-ink-2">No seasonal pattern was returned for this series.</p>
              )}
            </figure>
            <figure className="min-w-0">
              <figcaption className="font-semibold text-ink">De-seasonalised anomaly and fitted line</figcaption>
              {s.anomaly ? (
                <>
                  <HistoryChart
                    times={s.times}
                    values={s.anomaly}
                    fit={s.fit}
                    unit={unit}
                    seriesName="anomaly from the fixed seasonal pattern"
                    color="--viz-violet"
                    analysis={analysis}
                    view={domain}
                    cursor={time.cursor}
                    onCursor={time.setCursor}
                    brush={time.brush}
                    onBrush={time.setBrush}
                    decimals={dec}
                    zeroLine
                    label={`${v.label}, anomaly from the fixed seasonal pattern with the fitted line`}
                  />
                  <ChartKey items={[
                    { kind: "line", label: "Anomaly (raw minus reference month)", color: "--viz-violet" },
                    ...(s.fit ? [{ kind: "fit" as const, label: "Fitted line, analysis period only" }] : []),
                    { kind: "analysis", label: "Analysis period" },
                  ]} />
                </>
              ) : (
                <p className="mt-1 text-sm text-ink-2">No anomaly series was returned{v.status_reason ? `: ${v.status_reason}` : "."}</p>
              )}
            </figure>
          </div>

          <SeriesTable
            title={`${v.label} (${unit})`}
            times={s.times}
            analysis={analysis}
            columns={[
              { header: `Raw (${unit})`, value: (i) => s.raw[i], decimals: dec },
              ...(s.seasonal_cycle ? [{ header: "Reference month mean", value: (i: number) => s.seasonal_cycle![Number(s.times[i].slice(5, 7)) - 1], decimals: dec }] : []),
              ...(s.anomaly ? [{ header: "Anomaly", value: (i: number) => s.anomaly![i], decimals: dec }] : []),
              ...(s.fit ? [{ header: "Fitted line", value: (i: number) => s.fit![i], decimals: dec }] : []),
            ]}
          />
        </div>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <h4 className="text-base">Trend of the de-seasonalised series</h4>
        <div className="mt-2">
          {v.trend ? (
            <TrendBlock trend={v.trend} families={families} />
          ) : (
            <p className="text-ink-2">No trend was computed for this variable{v.status_reason ? `: ${v.status_reason}` : "."}</p>
          )}
        </div>
        {v.stability_half_slopes_per_year && v.stability_half_slopes_per_year.length === 2 && (
          <p className="mt-2 text-sm text-ink-2 tnum">
            Descriptive stability check, slope per year in the first and second half of the analysis period:{" "}
            {fixed(v.stability_half_slopes_per_year[0], decimalsFor(v.stability_half_slopes_per_year), true)} and{" "}
            {fixed(v.stability_half_slopes_per_year[1], decimalsFor(v.stability_half_slopes_per_year), true)} {unit}. Not a test.
          </p>
        )}
      </div>

      {(v.limitations.length > 0 || v.region_warning_zh) && (
        <div className="mt-4 border-t border-line pt-4">
          <h4 className="text-base">Limitations</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-2 marker:text-ink-3">
            {v.limitations.map((l) => <li key={l} className="max-w-[80ch]">{l}</li>)}
            {v.region_warning_zh && <li lang="zh-Hant" className="max-w-[80ch]">{v.region_warning_zh}</li>}
          </ul>
        </div>
      )}

      {(v.description || v.catalogue_refs.length > 0) && (
        <details className="mt-3">
          <summary className={summaryCls}>About this variable and its references</summary>
          <div className="mt-2 space-y-2">
            {v.description && <p className="max-w-[72ch] text-sm text-ink-2">{v.description}</p>}
            <RefList refs={v.catalogue_refs} />
          </div>
        </details>
      )}
    </Card>
  );
}
