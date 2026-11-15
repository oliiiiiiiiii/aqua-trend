"use client";
// Runs the open test on the expanded lane's residuals over the shared selection (or the whole record),
// and keeps the multiple-testing log of every test run on that range.
// Fast tests recompute live while the selection is dragged; simulation-heavy ones (isSlow) and the log
// wait until the selection has been still for SETTLE_MS.
import { useEffect, useMemo, useState } from "react";
import { BASELINE_SENSITIVE, baselineShare, runLabTool, type LabOutcome } from "@/lib/detective/lab";
import type { Span } from "../model";
import type { LaneReady } from "../types";
import { availability, isSlow, overlayFor, testLog, type Availability, type LabOverlay, type TestId, type TestLog } from "./tests";

const SETTLE_MS = 220;

export interface LabRun {
  test: TestId;
  /** the tested months (absolute indices) */
  span: Span;
  avail: Record<TestId, Availability>;
  outcome: LabOutcome;
  overlay: LabOverlay | null;
  /** the result belongs to an earlier span and is being recomputed */
  pending: boolean;
  /** the range covers ≥ 80 % of the baseline, so residual mean / slope are ≈ 0 by construction */
  baselineWarning: boolean;
  /** tests run on this range (settled), with Holm status */
  log: TestLog;
  /** the selection moved and the log is about to reset */
  logPending: boolean;
}

/** `value` once `key` has stopped changing for `ms` */
function useSettled<T>(value: T, key: string, ms: number): { value: T; key: string } {
  const [v, setV] = useState({ value, key });
  useEffect(() => {
    if (v.key === key) return;
    const id = window.setTimeout(() => setV({ value, key }), ms);
    return () => window.clearTimeout(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

export function useLabRun(lane: LaneReady | null, sel: Span, test: TestId | null, whole: boolean): LabRun | null {
  const live: Span = lane && whole ? lane.record : sel;
  const liveKey = `${live.s}..${live.e}`;
  const settled = useSettled(live, liveKey, SETTLE_MS);
  const d = lane?.d ?? null;
  const base = lane?.base ?? 0;

  // the log: tests run on the settled range of this series, in the order run; reset when either changes
  const logKey = `${lane?.meta.layer ?? ""}|${settled.key}`;
  const [used, setUsed] = useState<{ key: string; tests: TestId[] }>({ key: "", tests: [] });
  const tests = useMemo(() => {
    const prior = used.key === logKey ? used.tests : [];
    return test && !prior.includes(test) ? [...prior, test] : prior;
  }, [used, logKey, test]);
  useEffect(() => {
    if (used.key !== logKey || used.tests !== tests) setUsed({ key: logKey, tests });
  }, [logKey, tests]); // eslint-disable-line react-hooks/exhaustive-deps

  const ss = settled.value.s - base, se = settled.value.e - base;
  const logged = useMemo(() => {
    const out = new Map<TestId, LabOutcome>();
    if (d) for (const t of tests) out.set(t, runLabTool(t, d, ss, se));
    return out;
  }, [d, tests, ss, se]);

  const slow = test != null && isSlow(test);
  const span = slow ? settled.value : live;
  const s = span.s - base, e = span.e - base;
  const avail = useMemo(() => (d ? availability(d.residual, live.s - base, live.e - base) : null), [d, base, live.s, live.e]);
  const fast = useMemo(() => (d && test && !slow ? runLabTool(test, d, s, e) : null), [d, test, slow, s, e]);
  const share = useMemo(() => (d ? baselineShare(d, s, e) : 0), [d, s, e]);
  const outcome = slow && test ? logged.get(test) ?? (d ? runLabTool(test, d, ss, se) : null) : fast;
  const log = useMemo(() => testLog(tests.map((t) => ({ test: t, outcome: logged.get(t) }))), [tests, logged]);

  if (!lane || !test || !avail || !outcome) return null;
  return {
    test, span, avail, outcome, log,
    overlay: overlayFor(outcome),
    pending: slow && settled.key !== liveKey,
    logPending: settled.key !== liveKey,
    baselineWarning: BASELINE_SENSITIVE.has(test) && share >= 0.8,
  };
}
