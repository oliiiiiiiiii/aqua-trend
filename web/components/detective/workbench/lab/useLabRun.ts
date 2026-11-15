"use client";
// The Tests area's state for the chosen variable: picking a test does not run it; analyse() runs it on the residuals of
// the shared selection (or the whole record) after a short progress bar (analyseMs; instant with reduced motion). The
// result is kept until the next Analyse and marked stale when the range or the test changes. Every test analysed on
// one range goes into the multiple-testing log (Holm), which resets when the range changes.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BASELINE_SENSITIVE, baselineShare, runLabTool, type LabOutcome } from "@/lib/detective/lab";
import type { Decomposition } from "@/lib/detective/contracts";
import type { Span } from "../model";
import type { LabStep } from "./step";
import { analyseMs, availability, overlayFor, staleReason, testLog, type Availability, type LabOverlay, type TestId, type TestLog } from "./tests";

/** One analysed test, as ResultCard reads it. */
export interface LabRun {
  test: TestId;
  /** the tested months (absolute indices) */
  span: Span;
  avail: Record<TestId, Availability>;
  outcome: LabOutcome;
  overlay: LabOverlay | null;
  /** d.residual, for figures that draw the observed anomaly */
  residual: readonly (number | null)[];
  /** kept for ResultCard: true dims the result (it is stale) */
  pending: boolean;
  /** the range covers ≥ 80 % of the baseline, so residual mean / slope are ≈ 0 by construction */
  baselineWarning: boolean;
  /** tests analysed on this range, with Holm status */
  log: TestLog;
  /** the log belongs to another range */
  logPending: boolean;
}

export interface LabAnalysis {
  /** the range the next Analyse uses (absolute indices) */
  span: Span;
  /** availability of every test on that range */
  avail: Record<TestId, Availability>;
  /** a progress bar is running for this many ms */
  running: { ms: number; token: number } | null;
  /** the last analysed result (dimmed when stale) */
  run: LabRun | null;
  stale: "range" | "test" | null;
  analyse: () => void;
}

const subscribeReduced = (cb: () => void) => {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const useReducedMotion = () => useSyncExternalStore(subscribeReduced, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);

interface Result { key: string; test: TestId; span: Span; outcome: LabOutcome; share: number }

/**
 * What the Tests area tests: a lane's monthly decomposition (LaneReady fits), or the day / week series of the daily view
 * (lib/detective/fine.ts fineDecomposition) with its step, its baseline's extreme rate and a key naming that series.
 */
export interface LabSource {
  d: Decomposition;
  /** absolute index of d.months[0] (months: ymIndex; days and weeks: 0) */
  base: number;
  record: Span;
  meta: { layer: string };
  step?: LabStep;
  /** share of baseline points with |z| > 2 when the baseline is not part of d */
  extremeRate?: number;
  /** what else identifies the series (the baseline in use), so a result on another one reads as stale */
  key?: string;
}

export function useLabAnalysis(lane: LabSource | null, sel: Span, test: TestId, whole: boolean): LabAnalysis | null {
  const reduced = useReducedMotion();
  const span: Span = lane && whole ? lane.record : sel;
  const layer = lane?.meta.layer ?? "";
  const step = lane?.step ?? "month";
  const extremeRate = lane?.extremeRate;
  const key = `${layer}|${step}|${lane?.key ?? ""}|${span.s}..${span.e}`;
  const [result, setResult] = useState<Result | null>(null);
  const [log, setLog] = useState<{ key: string; runs: { test: TestId; outcome: LabOutcome }[] }>({ key: "", runs: [] });
  const [running, setRunning] = useState<{ ms: number; token: number } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);

  const d = lane?.d ?? null, base = lane?.base ?? 0;
  const analyse = useCallback(() => {
    if (!d) return;
    const s = span.s - base, e = span.e - base;
    const done = () => {
      timer.current = null;
      const outcome = runLabTool(test, d, s, e, { extremeRate });
      setResult({ key, test, span, outcome, share: baselineShare(d, s, e) });
      setLog((l) => {
        const runs = l.key === key ? l.runs.filter((r) => r.test !== test) : [];
        return { key, runs: [...runs, { test, outcome }] };
      });
      setRunning(null);
    };
    if (timer.current != null) window.clearTimeout(timer.current);
    const ms = analyseMs(test, span.e - span.s + 1, reduced);
    if (ms === 0) { done(); return; }
    setRunning((r) => ({ ms, token: (r?.token ?? 0) + 1 }));
    timer.current = window.setTimeout(done, ms);
  }, [d, base, span.s, span.e, test, key, reduced, extremeRate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lane || !d) return null;
  const avail = availability(d.residual, span.s - base, span.e - base, step);
  const stale = staleReason(result, key, test);
  const run: LabRun | null = result ? {
    test: result.test, span: result.span, outcome: result.outcome,
    avail: availability(d.residual, result.span.s - base, result.span.e - base, step),
    overlay: stale ? null : overlayFor(result.outcome),
    residual: d.residual,
    pending: stale != null,
    baselineWarning: BASELINE_SENSITIVE.has(result.test) && result.share >= 0.8,
    log: testLog(log.key === result.key ? log.runs : []),
    logPending: log.key !== key,
  } : null;
  return { span, avail, running, run, stale, analyse };
}
