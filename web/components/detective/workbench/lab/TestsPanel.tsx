"use client";
// The expanded lane's "Tests" disclosure (docs/ANALYSIS_LAB.md): the 17 lab tests on the anomaly of
// the shared selection (or, toggled, the whole record). Closed by default so the selection's verdict and
// key numbers stay the first thing read; open ⇔ the URL has `test`.
import { useId } from "react";
import type { YearMonth } from "@/lib/detective/contracts";
import { formatRange } from "@/lib/detective/url";
import { COPY } from "../copy";
import { toRange } from "../model";
import ResultCard from "./ResultCard";
import ToolPicker from "./ToolPicker";
import type { TestId } from "./tests";
import type { LabRun } from "./useLabRun";

/** The Tests state shared by every lane (kept by AnalysisView). */
export interface LabControl {
  /** the open test; null = Tests closed */
  test: TestId | null;
  /** test the whole record instead of the selection */
  whole: boolean;
  /** open with the last used test */
  onOpen: () => void;
  onTest: (t: TestId | null) => void;
  onWhole: (whole: boolean) => void;
}

export interface TestsPanelProps {
  lab: LabControl;
  /** the result for the open test (useLabRun) */
  run: LabRun | null;
  /** d.months of the lane, to name months */
  months: readonly YearMonth[];
  unit: string;
  /** which sign reads cool (anomaly colours in the figures) */
  polarity: "cool" | "warm";
  /** set when the chart is not on the Anomaly layer */
  onShowAnomaly?: () => void;
}

export default function TestsPanel({ lab, run, months, unit, polarity, onShowAnomaly }: TestsPanelProps) {
  const L = COPY.lab;
  const open = lab.test != null;
  const bodyId = useId();
  const range = run ? toRange(run.span) : null;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          title={L.toggleTitle}
          onClick={() => (open ? lab.onTest(null) : lab.onOpen())}
          className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2 text-left text-sm"
        >
          <span aria-hidden="true" className={`inline-block w-3 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          <span className="font-semibold text-ink">{L.heading}</span>
          {!open && <span className="text-ink-3">{L.hint}</span>}
          {open && range && (
            <span className="text-ink-2 tnum">{formatRange(range)} · {COPY.toolbar.months(run!.span.e - run!.span.s + 1)}</span>
          )}
        </button>
        {open && (
          <label title={L.wholeTitle} className="flex cursor-pointer items-center gap-1.5 py-1 text-xs text-ink-2 hover:text-ink">
            <input type="checkbox" checked={lab.whole} onChange={(e) => lab.onWhole(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--focus)]" />
            {L.whole}
          </label>
        )}
      </div>
      {open && run && (
        <div id={bodyId} className="pb-3 sm:pl-5">
          <ToolPicker test={run.test} avail={run.avail} onChange={(t) => lab.onTest(t)} />
          <ResultCard run={run} unit={unit} months={months} polarity={polarity} onShowAnomaly={onShowAnomaly} />
        </div>
      )}
    </div>
  );
}
