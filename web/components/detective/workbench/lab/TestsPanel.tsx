"use client";
// The Tests area under the chart (docs/ANALYSIS_LAB.md): the lab's 17 tests as icon buttons grouped like LAB_GROUPS
// (Trend · Mean · Extremes · Cycles). Picking a test does not run it; "Analyse" runs it on the anomaly of the shared
// selection (or the whole record) after a short progress bar, then the result card (verdict, key numbers, figure,
// chart overlay, collapsed details and the multiple-testing log) appears. A result whose range or test no longer
// matches is dimmed with "Selection changed — Analyse again". The picked test is the URL `test`.
import { useEffect, useId, useState } from "react";
import type { YearMonth } from "@/lib/detective/contracts";
import { formatRange } from "@/lib/detective/url";
import { COPY } from "../copy";
import { toRange } from "../model";
import ResultCard from "./ResultCard";
import { TEST_ICON } from "./icons";
import { GROUPS, testsIn, type TestId } from "./tests";
import type { LabAnalysis } from "./useLabRun";

/** The Tests state shared by every variable (kept by AnalysisView). */
export interface LabControl {
  /** the picked test (URL `test`, else the default) */
  test: TestId;
  /** test the whole record instead of the selection */
  whole: boolean;
  onTest: (t: TestId) => void;
  onWhole: (whole: boolean) => void;
}

export interface TestsPanelProps {
  lab: LabControl;
  analysis: LabAnalysis | null;
  /** d.months of the lane, to name months */
  months: readonly YearMonth[];
  unit: string;
  /** which sign reads cool (anomaly colours in the figures) */
  polarity: "cool" | "warm";
  /** set when the chart is not on the Anomaly layer */
  onShowAnomaly?: () => void;
}

export default function TestsPanel({ lab, analysis: a, months, unit, polarity, onShowAnomaly }: TestsPanelProps) {
  const L = COPY.lab;
  const uid = useId();
  if (!a) return null;
  const range = toRange(a.span);
  const ok = a.avail[lab.test].ok;
  return (
    <section aria-labelledby={`${uid}-h`} className="border-t border-line pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={`${uid}-h`} className="font-[family-name:var(--font-body-active)] text-sm font-semibold text-ink">
          {L.heading} <span className="font-normal text-ink-2 tnum">{L.on(formatRange(range), COPY.toolbar.months(a.span.e - a.span.s + 1))}</span>
        </h3>
        <label title={L.wholeTitle} className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-2 hover:text-ink">
          <input type="checkbox" checked={lab.whole} onChange={(e) => lab.onWhole(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--focus)]" />
          {L.whole}
        </label>
      </div>

      {/* the 17 tests, grouped; radios, so arrow keys move within the set */}
      <fieldset className="mt-2">
        <legend className="sr-only">{L.methodLegend}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {GROUPS.map((g) => (
            <div key={g} role="group" aria-label={L.group[g]} title={L.groupTitle[g]} className="min-w-0">
              <p aria-hidden="true" className="mb-0.5 text-[11px] text-ink-3">{L.group[g]}</p>
              <div className="flex flex-wrap">
                {testsIn(g).map((t) => (
                  <TestButton key={t} name={`${uid}-t`} t={t} on={t === lab.test} avail={a.avail[t]} onPick={() => lab.onTest(t)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      {/* the picked test, Analyse, progress */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 text-sm text-ink">
          <span className="font-semibold">{L.test[lab.test]}</span>
          <span className="text-ink-2"> · {L.testTitle[lab.test]}</span>
        </p>
        <button
          type="button"
          onClick={a.analyse}
          disabled={!ok || a.running != null}
          title={ok ? L.analyseTitle(L.test[lab.test]) : a.avail[lab.test].reason ?? undefined}
          className="rounded-ctl bg-action px-4 py-1 text-sm font-semibold text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {a.running ? L.analysing : L.analyse}
        </button>
        {!ok && <span className="text-xs text-ink-3 tnum">{a.avail[lab.test].reason}</span>}
        {a.running && <Progress key={a.running.token} ms={a.running.ms} />}
        {!a.running && a.stale && <span role="status" className="text-sm text-synthetic">{L.stale[a.stale]}</span>}
      </div>

      {a.run && (
        <div className={a.running ? "opacity-40 transition-opacity" : ""}>
          <ResultCard run={a.run} unit={unit} months={months} polarity={polarity} onShowAnomaly={onShowAnomaly} />
        </div>
      )}
      {!a.run && !a.running && <p className="mt-2 text-xs text-ink-3">{L.pickHint}</p>}
    </section>
  );
}

function TestButton({ name, t, on, avail, onPick }: {
  name: string; t: TestId; on: boolean; avail: { ok: boolean; need: number; reason: string | null }; onPick: () => void;
}) {
  const L = COPY.lab;
  return (
    <label
      title={avail.ok ? L.testTitle[t] : `${L.testTitle[t]}. ${avail.reason}`}
      className={`flex min-w-[3.75rem] cursor-pointer flex-col items-center gap-0.5 rounded-[6px] px-1.5 pt-1 pb-0.5 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${
        on ? "text-ink" : avail.ok ? "text-ink-2 hover:text-ink" : "text-ink-3"
      }`}
    >
      <input type="radio" name={name} value={t} checked={on} onChange={onPick} aria-description={L.testTitle[t]} className="sr-only" />
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={avail.ok ? "" : "opacity-50"}>
        <path d={TEST_ICON[t]} />
      </svg>
      <span className={`border-b-2 text-[11px] leading-tight ${on ? "border-ink font-semibold" : "border-transparent"}`}>{L.test[t]}</span>
      {!avail.ok && <span aria-hidden="true" className="text-[10px] leading-none tnum">≥{avail.need}</span>}
    </label>
  );
}

/** a thin bar that fills in `ms` (pacing only) */
function Progress({ ms }: { ms: number }) {
  const [go, setGo] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setGo(true)); return () => cancelAnimationFrame(id); }, []);
  return (
    <span role="progressbar" aria-label={COPY.lab.analysing} className="relative block h-[3px] w-40 overflow-hidden rounded-full bg-well">
      <span className="absolute inset-y-0 left-0 rounded-full bg-focus" style={{ width: go ? "100%" : "0%", transition: `width ${ms}ms linear` }} />
    </span>
  );
}
