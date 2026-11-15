"use client";
// The statistics column of the Days and Weeks windows: the verdict for the selected days (or weeks), the difference
// from the baseline with its σ, p and rank, and the baseline chooser (the surrounding points, or the same days of
// earlier years, loaded on request). Same grammar as StatsPanel: verdict first, numbers one per row, method last.
import { useId } from "react";
import type { FineDetail } from "@/lib/detective/fine";
import { BASELINE_YEAR_CHOICES, MIN_EMPIRICAL_WINDOWS } from "@/lib/detective/fine";
import { num, pValue } from "../format";
import { COPY } from "../copy/fine";
import { COPY as DAILY } from "../copy/daily";
import { sigmaText } from "../workbench/model";
import { anomalyColor } from "../workbench/types";
import { Segmented } from "@/components/ui/Segmented";
import type { BaselineKind, FineModel } from "./useFineModel";

export function FineStats({ m, unit, polarity, years, onBaseline }: {
  m: FineModel; unit: string; polarity: "cool" | "warm";
  /** earlier years asked for */
  years: number;
  onBaseline: (b: { kind: BaselineKind; years: number }) => void;
}) {
  const d = m.detail;
  const step = m.step;
  const uid = useId();
  const label = (i: number) => m.lab?.axis.label(i) ?? "";
  const v = verdict(d);
  const color = v.emphasis && d?.direction ? anomalyColor(d.direction === "high", polarity) : "var(--ink-2)";
  return (
    <div className="min-w-0">
      <h3 id={`${uid}-h`} className="sr-only">{COPY.heading(step)}</h3>
      <p className="text-xs text-ink-2 tnum">{m.lab ? COPY.selection(m.lab.axis.span(m.lab.sel.s, m.lab.sel.e), m.lab.sel.e - m.lab.sel.s + 1, step) : ""}</p>
      <p aria-live="polite" className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 self-center rounded-full" style={v.mark === "●" ? { background: color } : { border: `1.5px solid ${color}` }} />
        <span className="text-lg leading-tight font-semibold text-ink">{v.label}</span>
      </p>
      <p className="mt-0.5 text-sm text-ink-2">{m.baselineInUse === "years" ? COPY.verdict.vsYears(m.years.years.length) : COPY.verdict.vsWindow(step)}</p>
      <p className="mt-0.5 text-xs text-ink-3">{COPY.verdict.notCause}</p>

      <dl className="mt-3 tnum">
        <Row label={COPY.difference}
          value={d?.difference != null ? `${num(d.difference, 2, true)} ${unit}` : "—"}
          sub={[
            d?.meanAnomaly != null && d.reference != null ? COPY.differenceSub(num(d.meanAnomaly, 2, true), num(d.reference, 2, true)) : null,
            d?.ci95 ? COPY.ci(num(d.ci95[0], 2, true), num(d.ci95[1], 2, true)) : null,
          ]} />
        <Row label={COPY.standardised} value={sigmaText(d?.meanZ, 2)}
          sub={[d?.noise ? COPY.sigmaSub(`${num(d.noise.sigma, 2)} ${unit}`, num(d.noise.rho, 2)) : null]} />
        <Row label={COPY.significance}
          value={d?.test ? `p ${pValue(d.test.p).startsWith("<") ? "" : "= "}${pValue(d.test.p)}` : "—"}
          sub={[d?.empirical ? COPY.windows(d.empirical.asExtreme, d.empirical.windows) : COPY.noWindows(MIN_EMPIRICAL_WINDOWS)]} />
        <Row label={COPY.rank}
          value={d?.seasonRank ? COPY.rankValue(d.seasonRank.position, d.seasonRank.of, d.seasonRank.direction) : COPY.noRank}
          sub={[d?.seasonRank ? COPY.rankSub : COPY.noRankWhy]} />
      </dl>
      {d && d.n > 0 && (
        <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-ink-2 tnum">
          {[d.peak ? COPY.peak(label(d.peak.index), sigmaText(d.peak.z)) : null, COPY.beyond2(d.beyond2Sigma, d.n, step), COPY.n(d.n, d.points)]
            .filter(Boolean).join(" · ")}
        </p>
      )}

      <Baseline m={m} years={years} onBaseline={onBaseline} />
      <p className="mt-2 text-xs leading-relaxed text-ink-3">{m.baselineInUse === "years" ? COPY.method.years(step) : COPY.method.window(step)}</p>
    </div>
  );
}

function Baseline({ m, years, onBaseline }: { m: FineModel; years: number; onBaseline: (b: { kind: BaselineKind; years: number }) => void }) {
  const B = COPY.baseline;
  const y = m.years;
  const btn = "rounded-ctl border border-line px-2.5 py-0.5 text-sm font-semibold text-ink hover:border-ink-3";
  const r = { borderRadius: "min(var(--r-ctl), 8px)" };
  const pct = y.totalDays ? (100 * y.doneDays) / y.totalDays : 0;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <Segmented legend={B.heading} tone="paper" look="underline" value={m.baselineKind}
        options={[{ value: "window", label: B.window(m.step), title: B.windowTitle }, { value: "years", label: B.years, title: B.yearsTitle }]}
        onChange={(kind) => onBaseline({ kind, years })} />
      {m.baselineKind === "years" && (
        <div className="mt-2 space-y-1.5 text-sm text-ink-2">
          {m.yearsPossible === 0 ? <p>{B.none}</p> : (
            <>
              <label className="flex flex-wrap items-baseline gap-x-2">
                <span>{B.howMany}</span>
                <select value={Math.min(years, m.yearsPossible)} onChange={(e) => onBaseline({ kind: "years", years: Number(e.target.value) })}
                  className="border-b border-line bg-transparent py-0.5 pr-1 text-ink hover:border-ink-3">
                  {[...new Set(BASELINE_YEAR_CHOICES.map((n) => Math.min(n, m.yearsPossible)))].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="text-xs text-ink-3">{B.possible(m.yearsPossible)}</span>
              </label>
              {y.phase === "idle" && (
                <p className="flex flex-col items-start gap-1">
                  <button type="button" onClick={y.start} className={`${btn} border-transparent bg-action text-on-action hover:bg-action-hover`} style={r}>
                    {B.build(y.totalDays - y.doneDays, DAILY.seconds(y.etaSeconds))}
                  </button>
                  <span className="text-xs text-ink-3">{B.buildHint}</span>
                </p>
              )}
              {(y.phase === "loading" || y.phase === "stopped") && (
                <div role="status" aria-busy={y.phase === "loading"} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="relative block h-[3px] w-32 overflow-hidden rounded-full bg-well" aria-hidden="true">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-focus transition-[width] duration-300" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="tnum">{B.progress(y.doneDays, y.totalDays)}{y.phase === "loading" ? ` · ${B.left(DAILY.seconds(y.etaSeconds))}` : ""}</span>
                  {y.phase === "loading"
                    ? <button type="button" onClick={y.stop} className="text-sm text-link hover:underline">{B.stop}</button>
                    : <button type="button" onClick={y.start} className={btn} style={r}>{B.resume}</button>}
                </div>
              )}
              {y.phase === "error" && (
                <p role="status" className="flex flex-wrap items-center gap-x-3">
                  <span className="text-ink">{B.failed}</span>
                  <button type="button" onClick={y.start} className={btn} style={r}>{B.retry}</button>
                </p>
              )}
              {y.phase !== "done" && <p className="text-xs text-ink-3">{B.pending}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function verdict(d: FineDetail | null): { mark: "●" | "◐" | "○" | "–"; label: string; emphasis: boolean } {
  const V = COPY.verdict;
  if (!d || d.verdict === "insufficient" || !d.direction) return { mark: "–", label: V.insufficient, emphasis: false };
  if (d.verdict === "significant") return { mark: "●", label: V.significant[d.direction], emphasis: true };
  if (d.verdict === "mixed") return { mark: "◐", label: V.mixed, emphasis: false };
  return { mark: "○", label: V.notSignificant, emphasis: false };
}

function Row({ label, value, sub }: { label: string; value: string; sub: (string | null)[] }) {
  return (
    <div className="flex items-baseline justify-between gap-x-3 border-t border-line py-2">
      <dt className="shrink-0 text-sm text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="block text-base leading-tight font-semibold text-ink">{value}</span>
        {sub.filter(Boolean).map((t) => <span key={t} className="block text-xs text-ink-3">{t}</span>)}
      </dd>
    </div>
  );
}
