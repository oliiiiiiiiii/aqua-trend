"use client";
// The Tests area under the chart (docs/ANALYSIS_LAB.md), two columns: on the left the lab's 24 tests as small icons
// in LAB_GROUPS order (Trend · Mean · Extremes · Cycles · Machine learning; four rows of six) with Analyse under them, on the right the result. Picking a test does not run it; "Analyse" runs it on the anomaly of the shared
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

      {/* chooser (left): the 24 tests, six per row (five on phones), then Analyse. Result (right): description, progress, card.
          Below ~40rem of room the result goes under the chooser. */}
      <div className="@container mt-3">
        <div className="grid gap-x-8 gap-y-5 @[40rem]:grid-cols-[minmax(0,9fr)_minmax(0,11fr)]">
          <div className="min-w-0">
            {/* radios, so arrow keys move within the set */}
            <fieldset>
              <legend className="sr-only">{L.methodLegend}</legend>
              {/* one flowing grid; groups are display:contents (named groups for screen readers), no visual dividers */}
              <div className="grid grid-cols-5 gap-y-1 @[40rem]:grid-cols-6">
                {(() => { let n = 0; return GROUPS.map((g) => (
                  <div key={g} role="group" aria-label={L.group[g]} className="contents">
                    {testsIn(g).map((t, i) => {
                      const idx = n++;
                      return <TestButton key={t} name={`${uid}-t`} t={t} group={L.group[g]} first={i === 0 && idx > 0} on={t === lab.test} avail={a.avail[t]} onPick={() => lab.onTest(t)} />;
                    })}
                  </div>
                )); })()}
              </div>
            </fieldset>
            <button
              type="button"
              onClick={a.analyse}
              disabled={!ok || a.running != null}
              title={ok ? L.analyseTitle(L.test[lab.test]) : a.avail[lab.test].reason ?? undefined}
              className="mt-4 w-full rounded-ctl bg-action px-4 py-1.5 text-sm font-semibold text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {a.running ? L.analysing : L.analyse}
            </button>
          </div>

          <div className="min-w-0">
            <p className="text-sm text-ink">
              <span className="font-semibold">{L.test[lab.test]}</span>
              <span className="text-ink-2"> · {L.testTitle[lab.test]}</span>
            </p>
            {!ok && <p className="mt-1 text-xs text-ink-3 tnum">{a.avail[lab.test].reason}</p>}
            {a.running && <div className="mt-2"><Progress key={a.running.token} ms={a.running.ms} /></div>}
            {!a.running && a.stale && <p role="status" className="mt-2 text-sm text-synthetic">{L.stale[a.stale]}</p>}
            {a.run && (
              <div className={a.running ? "opacity-40 transition-opacity" : ""}>
                <ResultCard run={a.run} unit={unit} months={months} polarity={polarity} onShowAnomaly={onShowAnomaly} />
              </div>
            )}
            {!a.run && !a.running && <p className="mt-3 text-sm text-ink-3">{L.pickHint}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function TestButton({ name, t, group, first, on, avail, onPick }: {
  name: string; t: TestId; group: string; first: boolean; on: boolean; avail: { ok: boolean; need: number; reason: string | null }; onPick: () => void;
}) {
  const L = COPY.lab;
  return (
    <label
      title={`${group}: ${L.testTitle[t]}${avail.ok ? "" : `. ${avail.reason}`}`}
      className={`flex min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-[6px] px-0 py-1 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${
        on ? "bg-well text-ink" : avail.ok ? "text-ink-2 hover:bg-well/60 hover:text-ink" : "text-ink-3"
      }`}
    >
      <input type="radio" name={name} value={t} checked={on} onChange={onPick} aria-description={L.testTitle[t]} className="sr-only" />
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={avail.ok ? "" : "opacity-50"}>
        <path d={TEST_ICON[t]} />
      </svg>
      <span className={`max-w-full text-[9.5px] @[40rem]:text-[10.5px] leading-tight [overflow-wrap:anywhere] ${on ? "font-semibold" : ""}`}>{L.test[t]}</span>
    </label>
  );
}

/** a thin bar that fills in `ms` (pacing only) */
function Progress({ ms }: { ms: number }) {
  const [go, setGo] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setGo(true)); return () => cancelAnimationFrame(id); }, []);
  return (
    <span role="progressbar" aria-label={COPY.lab.analysing} className="relative block h-[3px] w-full max-w-60 overflow-hidden rounded-full bg-well">
      <span className="absolute inset-y-0 left-0 rounded-full bg-focus" style={{ width: go ? "100%" : "0%", transition: `width ${ms}ms linear` }} />
    </span>
  );
}
