"use client";
// Statistics for the selection, by importance: verdict → effect / σ / p / rank → shape → trend → method.
import type { ReactNode } from "react";
import type { TrendStats } from "@/lib/detective/contracts";
import type { BaselineInfo, IntervalDetail } from "@/lib/detective/intervalDetail";
import { formatRange, formatYm } from "@/lib/detective/url";
import { num, pValue, percentMakesSense } from "../format";
import { COPY } from "./copy";
import { HypothesisChip, VerdictMark } from "./bits";
import { monthAbbr, sigmaText, toSpan, verdictView, type Span } from "./model";

export interface StatsPanelProps {
  d: IntervalDetail | null;
  unit: string;
  polarity: "cool" | "warm";
  expected?: "high" | "low";
  baseline: BaselineInfo;
  trend: TrendStats;
  /** relation to the event, already worded ("ends just before") */
  relation: string;
  onCsv?: () => void;
  /** the collapsible Tests area, placed after the shape line and before trend / method */
  tests?: ReactNode;
}

export default function StatsPanel(p: StatsPanelProps) {
  const { d, unit } = p;
  const v = verdictView(d);
  const S = COPY.stats;
  const sel: Span | null = d ? toSpan(d.range) : null;
  const pctShown = d?.percentOfNormal != null && percentMakesSense(unit) ? d.percentOfNormal : null;
  const missing = d ? d.months - d.n : 0;
  const sameSign = d?.signConsistency != null ? Math.round(d.signConsistency * d.n) : null;

  return (
    <section aria-label={S.heading} className="rounded-card border border-line bg-paper px-4 py-3 sm:px-5 sm:py-4" style={{ borderRadius: "min(var(--r-card), 14px)" }}>
      {/* tier 1: verdict */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p aria-live="polite" className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <VerdictMark d={d} polarity={p.polarity} size={14} className="self-center" />
          <span className="text-lg font-semibold text-ink">{v.label}</span>
          {v.note && <span className="text-sm text-ink-2 tnum">{v.note}</span>}
          <HypothesisChip expected={p.expected} d={d} />
        </p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-3">{COPY.verdict.notCause}</span>
          {p.onCsv && (
            <button type="button" onClick={p.onCsv} title={S.csvTitle}
              className="rounded-ctl border border-line px-2.5 py-0.5 text-xs font-semibold text-ink-2 hover:bg-well hover:text-ink">
              {S.csv}
            </button>
          )}
        </div>
      </div>

      {/* tier 1: the four numbers */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 tnum md:grid-cols-4">
        <Cell label={S.meanAnomaly}
          value={d?.meanAnomaly != null ? `${num(d.meanAnomaly, 2, true)} ${unit}` : "—"}
          sub={[pctShown != null ? S.ofNormal(num(pctShown, 2, true)) : null, d?.ci95 ? S.ci(num(d.ci95[0], 2, true), num(d.ci95[1], 2, true)) : null]} />
        <Cell label={S.standardised} value={sigmaText(d?.meanZ, 2)} sub={[]} />
        <Cell label={S.significance}
          value={d?.test ? `p ${pValue(d.test.p).startsWith("<") ? "" : "= "}${pValue(d.test.p)}` : "—"}
          sub={[d?.empirical ? S.windows(d.empirical.asExtreme, d.empirical.windows) : S.noWindows]} />
        <Cell label={S.rank}
          value={d?.seasonRank ? S.rankValue(d.seasonRank.position, d.seasonRank.of, d.seasonRank.direction) : S.noRank}
          sub={[d?.seasonRank && sel ? S.rankPeriods(monthAbbr(sel.s), monthAbbr(sel.e)) : S.noRankWhy]} />
      </dl>

      {/* tier 2: shape */}
      {d && d.n > 0 && (
        <p className="mt-3 flex flex-wrap gap-x-2 gap-y-0.5 border-t border-line pt-2.5 text-sm text-ink-2 tnum">
          {joinDots([
            d.peak ? S.peak(formatYm(d.peak.month), sigmaText(d.peak.z)) : null,
            S.beyond2(d.beyond2Sigma, d.n),
            sameSign != null && d.direction ? S.sameSign(sameSign, d.n, d.direction) : null,
            S.n(d.n, missing),
            p.relation,
          ])}
        </p>
      )}

      {/* Tests (lab) */}
      {p.tests && <div className="mt-2 border-t border-line">{p.tests}</div>}

      {/* tier 3: trend and method */}
      <div className={`${p.tests ? "" : "mt-2 "}border-t border-line`}>
        <TrendDisclosure trend={p.trend} unit={unit} record={formatRange(p.baseline.record)} />
        <MethodDisclosure baseline={p.baseline} unit={unit} nEff={d?.test?.nEff ?? null} />
      </div>
    </section>
  );
}

function Cell({ label, value, sub }: { label: string; value: string; sub: (string | null)[] }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-lg leading-tight font-semibold text-ink">{value}</dd>
      {sub.filter(Boolean).map((s) => <dd key={s} className="text-xs text-ink-2">{s}</dd>)}
    </div>
  );
}

function joinDots(parts: (string | null)[]): ReactNode[] {
  const xs = parts.filter((s): s is string => !!s);
  return xs.map((s, i) => (
    <span key={i} className="whitespace-nowrap">{s}{i < xs.length - 1 && <span aria-hidden="true" className="pl-2 text-ink-3">·</span>}</span>
  ));
}

const summaryCls = "flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2 text-sm [&::-webkit-details-marker]:hidden";
const chevron = <span aria-hidden="true" className="inline-block w-3 text-ink-3 transition-transform group-open:rotate-90">▸</span>;

export function trendLine(s: TrendStats, unit: string): string {
  const T = COPY.trend;
  if (s.senPerDecade == null) return T.insufficient;
  const parts = [T.perDecade(num(s.senPerDecade, 2, true), unit)];
  if (s.mkP != null) parts.push(T.p(pValue(s.mkP)));
  if (s.significant != null) parts.push(s.significant ? T.significant : T.notSignificant);
  return parts.join(", ");
}

export function TrendDisclosure({ trend: s, unit, record }: { trend: TrendStats; unit: string; record: string }) {
  const T = COPY.trend;
  return (
    <details className="group">
      <summary className={summaryCls}>
        {chevron}
        <span className="font-semibold text-ink">{T.heading}</span>
        <span className="min-w-0 text-ink-2 tnum">{trendLine(s, unit)}</span>
      </summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pb-3 pl-5 text-sm tnum">
        <dt className="text-ink-2">{T.slope}</dt>
        <dd className="text-ink">{s.senPerDecade == null ? "—" : T.perDecade(num(s.senPerDecade, 2, true), unit)}</dd>
        <dt className="text-ink-2">{T.ci}</dt>
        <dd className="text-ink">{s.ci95 ? `${num(s.ci95[0], 2, true)} … ${num(s.ci95[1], 2, true)}` : "—"}</dd>
        <dt className="text-ink-2">{T.mk}</dt>
        <dd className="text-ink">{pValue(s.mkP)}{s.nEff != null && <span className="text-ink-2"> · {T.nEff} {Math.round(s.nEff)}</span>}</dd>
        {s.significant === false && (
          <>
            <dt className="text-ink-2">{T.needed}</dt>
            <dd className="text-ink">{s.yearsToSignificance != null ? T.years(Math.ceil(s.yearsToSignificance)) : T.unknownYears}</dd>
          </>
        )}
        <dd className="col-span-2 text-xs text-ink-3">{T.note(record)}</dd>
      </dl>
    </details>
  );
}

export function MethodDisclosure({ baseline: b, unit, nEff }: { baseline: BaselineInfo; unit: string; nEff: number | null }) {
  const M = COPY.method;
  return (
    <details className="group border-t border-line">
      <summary className={summaryCls}>
        {chevron}
        <span className="font-semibold text-ink">{M.heading}</span>
      </summary>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pb-3 pl-5 text-sm tnum">
        <dt className="text-ink-2">{M.baseline}</dt>
        <dd className="text-ink">{M.baselineValue(formatRange(b.record), formatRange(b.excluded))} · {M.baselineN(b.n)}</dd>
        <dt className="text-ink-2">{M.sigma}</dt>
        <dd className="text-ink">{b.sigma != null ? `${num(b.sigma)} ${unit}` : "—"}</dd>
        <dt className="text-ink-2">{M.rho}</dt>
        <dd className="text-ink">{b.rho.toFixed(2)}</dd>
        <dt className="text-ink-2">{M.nEff}</dt>
        <dd className="text-ink">{nEff != null ? nEff.toFixed(1) : "—"}</dd>
        <dt className="text-ink-2">{M.removed}</dt>
        <dd className="text-ink">{M.removedValue}</dd>
        <dt className="text-ink-2">{M.tests}</dt>
        <dd className="text-ink">{M.testsValue}</dd>
        <dd className="col-span-2 text-xs text-ink-3">{M.exploratory}</dd>
      </dl>
    </details>
  );
}
