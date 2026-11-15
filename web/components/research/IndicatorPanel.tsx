"use client";
// Phenomenon indicators (spec §7.4, §9 item 6; acceptance E02–E04, E10): standard DERIVED indicators and
// RECORDED events are tagged apart, each with its source, definition, calibration period and limits.
// "data not delivered", "not applicable" and "no approved definition" are shown as states; they are never
// turned into a zero count or an empty timeline that looks like "nothing happened".
import { useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { useElementWidth } from "@/components/charts/useElementWidth";
import { decimalsFor, fixed, isYm, periodLabel, timeLabel, timeX } from "@/lib/research/format";
import type { BaselineInfo, DerivedEvent, EvidenceFamily, IndicatorMetric, IndicatorResult, Period } from "@/lib/research/types";
import HistoryChart, { ChartKey } from "./HistoryChart";
import { designationText } from "./ConditionsPanel";
import { SeriesTable } from "./SeriesTable";
import { TrendBlock } from "./TrendBlock";
import { Card, Facts, ItemStatusPill, Notice, Pill, RefList, summaryCls, tdCls, thCls } from "./ui";
import { ProductBlock, viewDomain, type TimeView } from "./VariableCard";

const KIND_COPY = {
  derived_indicator: {
    tag: "Derived indicator",
    help: "Computed from a data product with a registered standard recipe. It is an index, not a record of observed events.",
  },
  recorded_event: {
    tag: "Recorded events",
    help: "Statistics of an event catalogue. They depend on what the catalogue recorded and on its coverage.",
  },
} as const;

const CENSOR_TEXT: Record<string, string> = {
  left: "started before the available record or the analysis window (left-censored)",
  right: "continues past the end of the record or the analysis window (right-censored)",
  ongoing: "had not ended at the last available month",
  gap: "touches a data gap, so its true extent is unknown",
};
const censorWords = (c: string[]) => (c.length ? c.map((k) => CENSOR_TEXT[k] ?? k).join("; ") : "complete");

const STATE_NOTE: Record<string, string> = {
  data_required: "The data this needs has not been delivered. No count, duration or timeline is shown, and nothing is assumed to be zero.",
  not_applicable: "There is no scientifically meaningful indicator of this kind for this case. Nothing is substituted for it.",
  definition_required: "No approved standard definition exists in the registry. A formula is never made up at query time.",
  insufficient_data: "The data is delivered but does not support this indicator for this region and period.",
  insufficient_baseline: "The fixed calibration period is not supported by the data, and it is not shortened to fit the query.",
  unsupported_resolution: "The prepared data does not have the resolution this indicator needs.",
  no_series: "This region has no prepared series for the input product.",
};

function monthStartX(t: string) { return isYm(t) ? timeX(t) - 0.5 / 12 : Number(t.slice(0, 4)); }
function monthEndX(t: string) { return isYm(t) ? timeX(t) + 0.5 / 12 : Number(t.slice(0, 4)) + 1; }

/** Events on one time line. Hollow marks are censored events; the table below carries the exact words. */
function EventsTimeline({ events, analysis, domain, unitLabel }: { events: DerivedEvent[]; analysis: Period | null; domain: [number, number]; unitLabel: string }) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const left = 12, right = 12, height = 86, top = 26, barH = 22;
  const iw = Math.max(40, width - left - right);
  const x = useMemo(() => scaleLinear().domain(domain).range([0, iw]), [domain, iw]);
  const span = domain[1] - domain[0];
  const step = [1, 2, 5, 10, 20, 50].find((s) => span / s <= (iw < 420 ? 5 : 9)) ?? 100;
  const ticks: number[] = [];
  for (let t = Math.ceil(domain[0] / step) * step; t <= domain[1]; t += step) ticks.push(t);
  const clampX = (v: number) => Math.min(iw, Math.max(0, v));
  const a = analysis ? [clampX(x(monthStartX(analysis.start))), clampX(x(monthEndX(analysis.end)))] : null;
  const axisText = { fill: "var(--ink-2)", fontSize: 11 } as const;
  const h = hover != null ? events[hover] : null;
  return (
    <div ref={wrapRef} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true" className="block overflow-visible">
          <g transform={`translate(${left},0)`}>
            {a && a[1] > a[0] && (
              <>
                <rect x={a[0]} width={a[1] - a[0]} y={top - 8} height={barH + 16} style={{ fill: "var(--action)", opacity: 0.16 }} />
                {a[1] - a[0] > 96 && <text x={(a[0] + a[1]) / 2} y={12} textAnchor="middle" style={{ ...axisText, fill: "var(--ink)", fontWeight: 600 }}>Analysis period</text>}
              </>
            )}
            <line x1={0} x2={iw} y1={top + barH + 8} y2={top + barH + 8} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
            {ticks.map((t) => (
              <g key={t} transform={`translate(${x(t)},${top + barH + 8})`}>
                <line y2={4} strokeWidth={1} style={{ stroke: "var(--viz-axis)" }} />
                <text y={17} textAnchor="middle" className="tnum" style={axisText}>{t}</text>
              </g>
            ))}
            {events.map((e, i) => {
              const x0 = x(monthStartX(e.start)), x1 = x(monthEndX(e.end ?? e.start));
              if (x1 < 0 || x0 > iw) return null;
              const xa = clampX(x0), w = Math.max(3, clampX(x1) - xa);
              const censored = e.censoring.length > 0;
              return (
                <rect
                  key={e.event_id}
                  x={xa} y={top} width={w} height={barH} rx={Math.min(4, w / 2)}
                  strokeWidth={2}
                  strokeDasharray={censored ? "4 3" : undefined}
                  style={{ fill: censored ? "var(--paper)" : "var(--viz-orange)", stroke: "var(--viz-orange)", opacity: hover == null || hover === i ? 1 : 0.55 }}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover((cur) => (cur === i ? null : cur))}
                />
              );
            })}
          </g>
        </svg>
      )}
      {width > 0 && h && (
        <ChartTooltip x={left + clampX(x(monthStartX(h.start)))} width={width}>
          <div className="font-semibold">{timeLabel(h.start)} to {h.end ? timeLabel(h.end) : "not ended"}</div>
          {h.duration_months != null && <div className="tnum">{h.duration_months} months</div>}
          {h.severity != null && <div className="tnum">severity {fixed(h.severity, 2)} {unitLabel}</div>}
          {h.peak != null && <div className="tnum">peak {fixed(h.peak, 2)}</div>}
          <div className="text-ink-2">{censorWords(h.censoring)}</div>
        </ChartTooltip>
      )}
    </div>
  );
}

function MetricBlock({ m, analysis, families, time }: { m: IndicatorMetric; analysis: Period | null; families: EvidenceFamily[]; time: TimeView }) {
  const s = m.series;
  const dec = decimalsFor(s?.raw ?? [], 3);
  const isCount = m.cadence === "annual" && m.data_kind === "count";
  return (
    <div data-testid="indicator-metric" data-metric={m.metric_id} data-status={m.status} className="border-t border-line pt-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <h4 className="text-base">{m.label} <span className="font-normal text-ink-3">({m.unit}, {m.cadence})</span></h4>
        <ItemStatusPill status={m.status} />
      </div>
      {m.status !== "ok" && (
        <Notice tone="warn" className="mt-2">{m.status_reason ?? STATE_NOTE[m.status] ?? "No value is available for this metric."}</Notice>
      )}
      {m.aggregation_rule && <p className="mt-1 max-w-[80ch] text-sm text-ink-2">Aggregation rule: {m.aggregation_rule}</p>}
      {s && s.times.length > 0 && (
        <figure className="mt-2">
          <HistoryChart
            times={s.times}
            values={s.raw}
            fit={s.fit}
            unit={m.unit}
            seriesName={m.label}
            color="--viz-orange"
            mark={isCount ? "bar" : "line"}
            analysis={analysis}
            view={viewDomain(time.view)}
            cursor={time.cursor}
            onCursor={time.setCursor}
            decimals={dec}
            zeroLine={m.cadence === "monthly"}
            label={`${m.label}, ${m.cadence} values over the full history`}
            height={190}
          />
          <ChartKey items={[
            { kind: isCount ? "bar" : "line", label: m.label, color: "--viz-orange" },
            ...(s.fit ? [{ kind: "fit" as const, label: "Fitted line, analysis period only" }] : []),
            { kind: "analysis", label: "Analysis period" },
            { kind: "missing", label: m.cadence === "annual" ? "Years without a value (not zero)" : "Missing months (not zero)" },
          ]} />
        </figure>
      )}
      {m.trend && (
        <div className="mt-3">
          {m.fit_window && <p className="mb-1 text-sm text-ink-3">Fitted on {periodLabel(m.fit_window)}{m.cadence === "annual" ? " (complete calendar years inside the analysis period)" : ""}.</p>}
          <TrendBlock trend={m.trend} families={families} />
        </div>
      )}
      {m.limitations.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2 marker:text-ink-3">
          {m.limitations.map((l) => <li key={l} className="max-w-[80ch]">{l}</li>)}
        </ul>
      )}
      {s && s.times.length > 0 && (
        <div className="mt-2">
          <SeriesTable
            title={`${m.label} (${m.unit})`}
            times={s.times}
            analysis={analysis}
            inAnalysis={m.in_analysis}
            columns={[
              { header: `${m.label} (${m.unit})`, value: (i) => s.raw[i], decimals: dec },
              ...(s.fit ? [{ header: "Fitted line", value: (i: number) => s.fit![i], decimals: dec }] : []),
            ]}
          />
        </div>
      )}
    </div>
  );
}

function IndicatorCard({ ind, baselines, families, time }: { ind: IndicatorResult; baselines: BaselineInfo[]; families: EvidenceFamily[]; time: TimeView }) {
  const copy = KIND_COPY[ind.kind] ?? KIND_COPY.derived_indicator;
  const analysis = ind.analysis_period ?? null;
  // several recipes can share one calibration id; prefer the record that names this indicator
  const sameId = baselines.filter((b) => b.baseline_id === ind.calibration_baseline_id);
  const calibration = sameId.find((b) => b.applies_to.includes(ind.indicator_id)) ?? sameId[0] ?? null;
  const headingId = `ind-${ind.indicator_id}`;
  const cov = ind.event_coverage;
  const view = viewDomain(time.view);
  const eventDomain: [number, number] | null = view
    ?? (ind.full_history ? [monthStartX(ind.full_history.start), monthEndX(ind.full_history.end)] : null)
    ?? (analysis ? [monthStartX(analysis.start), monthEndX(analysis.end)] : null);

  return (
    <Card aria-labelledby={headingId} data-testid="indicator-card" data-indicator={ind.indicator_id} data-kind={ind.kind} data-status={ind.status}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-xl">{ind.label}</h3>
          <p className="text-sm text-ink-3"><code>{ind.indicator_id}</code>{ind.version ? `, recipe version ${ind.version}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={ind.kind === "recorded_event" ? "plain" : "plain"}>
            <span aria-hidden="true">{ind.kind === "recorded_event" ? "▣" : "ƒ"}</span> {copy.tag}
          </Pill>
          <ItemStatusPill status={ind.status} />
        </div>
      </div>
      <p className="mt-2 max-w-[80ch] text-sm text-ink-2">{copy.help}</p>

      {ind.status !== "ok" && (
        <Notice tone="warn" role="status" className="mt-3">
          <span className="font-semibold text-ink">{STATE_NOTE[ind.status] ?? "This indicator has no result."}</span>
          {ind.status_reason ? <> Detail: {ind.status_reason}</> : null}
        </Notice>
      )}

      <div className="mt-4 grid gap-6 border-t border-line pt-4 lg:grid-cols-2">
        <div>
          <h4 className="text-base">Source</h4>
          {ind.kind === "derived_indicator" ? (
            ind.input_product ? <div className="mt-1"><ProductBlock decision={ind.input_product} heading="Input product" /></div>
              : <p className="mt-1 text-sm text-ink-2">No input product is attached to this indicator.</p>
          ) : (
            <Facts
              className="mt-1"
              rows={[
                ["Event catalogue", ind.event_catalogue_id ? <code key="c">{ind.event_catalogue_id}</code> : "None delivered"],
                ["Catalogue version", ind.event_catalogue_version ?? "—"],
                ["Declared completeness", cov?.completeness ?? "Unknown (no coverage record)"],
                ["Coverage period", cov?.start && cov?.end ? periodLabel({ start: cov.start, end: cov.end }) : "—"],
                ["Coverage policy version", cov?.policy_version ?? "—"],
              ]}
            />
          )}
          {ind.kind === "recorded_event" && cov?.completeness && cov.completeness !== "complete" && (
            <Notice tone="warn" className="mt-2">Coverage is {cov.completeness}: a period without recorded events is not counted as zero events.</Notice>
          )}
        </div>
        <div>
          <h4 className="text-base">Definition</h4>
          <Facts
            className="mt-1"
            rows={[
              ["Analysis period", periodLabel(analysis)],
              ["Full history used", periodLabel(ind.full_history)],
              ...(ind.kind === "derived_indicator"
                ? [[
                    "Fixed calibration period",
                    calibration
                      ? `${periodLabel(calibration)} (${designationText(calibration.designation)}; ${calibration.rule})`
                      : ind.calibration_baseline_id ?? "—",
                  ] as [string, string]]
                : []),
              ...(ind.phenomenon_applicability ? [["Applies to", ind.phenomenon_applicability] as [string, string]] : []),
            ]}
          />
          {calibration && calibration.status !== "ok" && (
            <Notice tone="warn" className="mt-2">Calibration period: {calibration.status_reason ?? calibration.status}</Notice>
          )}
          {ind.definition && (
            <details className="mt-1" open={ind.status === "ok" ? undefined : false}>
              <summary className={summaryCls}>Formula, thresholds and event rule</summary>
              <p className="mt-1 max-w-[80ch] text-sm text-ink-2">{ind.definition}</p>
            </details>
          )}
          {ind.interpretation && (
            <details className="mt-1">
              <summary className={summaryCls}>What it can and cannot represent</summary>
              <p className="mt-1 max-w-[80ch] text-sm text-ink-2">{ind.interpretation}</p>
            </details>
          )}
          {ind.standard_refs.length > 0 && (
            <details className="mt-1">
              <summary className={summaryCls}>Standard references</summary>
              <div className="mt-1"><RefList refs={ind.standard_refs} title="References" /></div>
            </details>
          )}
        </div>
      </div>

      {ind.status === "ok" && eventDomain && (ind.events.length > 0 || ind.kind === "derived_indicator") && (
        <div className="mt-4 border-t border-line pt-4" data-testid="indicator-events">
          <h4 className="text-base">{ind.kind === "derived_indicator" ? "Events found by the rule" : "Recorded events"} related to the analysis period</h4>
          {ind.events.length === 0 ? (
            <p className="mt-1 text-sm text-ink-2">
              {ind.kind === "derived_indicator"
                ? "The event rule found no event that touches the analysis period. This is a result of the rule on the calibrated index, not missing data."
                : "No recorded event touches the analysis period."}
            </p>
          ) : (
            <>
              <EventsTimeline events={ind.events} analysis={analysis} domain={eventDomain} unitLabel="" />
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-ink-2">
                <li className="flex items-center gap-1.5">
                  <svg width="18" height="10" aria-hidden="true"><rect x="1" y="1" width="16" height="8" rx="3" style={{ fill: "var(--viz-orange)" }} /></svg>
                  Complete event
                </li>
                <li className="flex items-center gap-1.5">
                  <svg width="18" height="10" aria-hidden="true"><rect x="1" y="1" width="16" height="8" rx="3" strokeWidth="1.5" strokeDasharray="3 2" style={{ fill: "none", stroke: "var(--viz-orange)" }} /></svg>
                  Censored event (extent cut by the record, the window or a gap)
                </li>
              </ul>
              <details className="mt-1">
                <summary className={summaryCls}>Event table ({ind.events.length})</summary>
                <div role="region" aria-label="Event table, scrollable" tabIndex={0} className="mt-2 max-h-80 overflow-auto border border-line" style={{ borderRadius: "min(var(--r-ctl), 8px)" }}>
                  <table className="w-full min-w-[36rem] border-collapse text-sm">
                    <thead className="sticky top-0 bg-paper">
                      <tr className="border-b border-line">
                        <th scope="col" className={thCls}>Start</th>
                        <th scope="col" className={thCls}>End</th>
                        <th scope="col" className={thCls}>Duration (months)</th>
                        <th scope="col" className={thCls}>Severity</th>
                        <th scope="col" className={thCls}>Peak</th>
                        <th scope="col" className={thCls}>Censoring</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ind.events.map((e) => (
                        <tr key={e.event_id} className="border-b border-line">
                          <td className={tdCls}>{timeLabel(e.start)}</td>
                          <td className={tdCls}>{e.end ? timeLabel(e.end) : "not ended"}</td>
                          <td className={tdCls}>{e.duration_months ?? "—"}</td>
                          <td className={tdCls}>{fixed(e.severity, 2)}</td>
                          <td className={tdCls}>{fixed(e.peak, 2)}</td>
                          <td className="px-3 py-1.5 align-top">{censorWords(e.censoring)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </div>
      )}

      {ind.metrics.length > 0 && (
        <div className="mt-4 space-y-4">
          {ind.metrics.map((m) => <MetricBlock key={m.metric_id} m={m} analysis={analysis} families={families} time={time} />)}
        </div>
      )}

      {ind.limitations.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <h4 className="text-base">Limitations</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-2 marker:text-ink-3">
            {ind.limitations.map((l) => <li key={l} className="max-w-[80ch]">{l}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function IndicatorPanel({ indicators, baselines, families, time }: { indicators: IndicatorResult[]; baselines: BaselineInfo[]; families: EvidenceFamily[]; time: TimeView }) {
  return (
    <section aria-labelledby="indicators-h" className="space-y-4" data-testid="indicators">
      <div className="on-stage">
        <h2 id="indicators-h" className="text-2xl text-on-stage">Indicators of the phenomenon itself</h2>
        <p className="mt-1 max-w-[72ch] text-on-stage-2">
          Standard derived indicators and recorded events are different kinds of evidence and are labelled apart. A monthly variable above is never relabelled as an event count.
        </p>
      </div>
      {indicators.length === 0 ? (
        <Card><p className="text-ink-2">The result contains no indicator block for this phenomenon. Only the variable trends above are available.</p></Card>
      ) : (
        indicators.map((ind) => <IndicatorCard key={ind.indicator_id} ind={ind} baselines={baselines} families={families} time={time} />)
      )}
    </section>
  );
}
