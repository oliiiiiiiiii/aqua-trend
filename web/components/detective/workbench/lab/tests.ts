// The workbench "Tests" area, pure part: the lab's tools in its four groups (LAB_GROUPS), which ones
// the range can support, what each draws on the anomaly chart, and the multiple-testing log.
// Statistics live in lib/detective/lab.ts.
import { LAB_GROUPS, LAB_MIN_N, holm, labSample, primaryP, restSample, type LabOutcome, type LabSegment } from "@/lib/detective/lab";
import { TEST_IDS, type TestId } from "@/lib/detective/url";
import { COPY } from "../copy";

export type { TestId };
/** LAB_GROUPS in order: trend · mean and distribution · persistence and extremes · cycles and memory */
export type TestGroup = "trend" | "mean" | "extremes" | "cycles";

export const GROUPS: readonly TestGroup[] = ["trend", "mean", "extremes", "cycles"];

export const testsIn = (g: TestGroup): TestId[] => [...LAB_GROUPS[GROUPS.indexOf(g)].tools];
export const groupOf = (t: TestId): TestGroup => GROUPS.find((g) => testsIn(g).includes(t)) ?? "trend";

export const DEFAULT_TEST: TestId = "mean";
/** simulation-heavy tests (2000 draws, or a dense periodogram) wait until the selection stops moving */
const SLOW: ReadonlySet<TestId> = new Set(["bootstrap", "permutation", "runs", "spectrum"]);
export const isSlow = (t: TestId) => SLOW.has(t);

/**
 * How long the "Analyse" progress bar runs (ms): 600 for quick tests, more for the simulation-heavy ones and longer
 * ranges, at most 1200; 0 with reduced motion. A pacing cue only — the computation itself is synchronous.
 */
export function analyseMs(t: TestId, months: number, reducedMotion = false): number {
  if (reducedMotion) return 0;
  const ms = 600 + (isSlow(t) ? 400 : 0) + Math.min(200, Math.max(0, months - 12) * 2);
  return Math.min(1200, ms);
}

/** The analysed result no longer matches what is on screen: another range (or variable), or another test. */
export function staleReason(result: { key: string; test: TestId } | null, key: string, test: TestId): "range" | "test" | null {
  if (!result) return null;
  if (result.key !== key) return "range";
  return result.test !== test ? "test" : null;
}

/** months "compare" and "variance" need outside the range (see runLabTool) */
export const REST_MIN = 12;
const NEEDS_REST: ReadonlySet<TestId> = new Set(["compare", "variance"]);

export interface Availability {
  ok: boolean;
  /** months the range must have */
  need: number;
  /** false when only the months outside the range are short */
  shortInRange: boolean;
  reason: string | null;
}

/** Which tests the residual months [start, end] (indices into d.months) can support, with the reason when not. */
export function availability(residual: readonly (number | null)[], start: number, end: number): Record<TestId, Availability> {
  const n = labSample(residual, start, end).n;
  const rest = restSample(residual, start, end).n;
  const out = {} as Record<TestId, Availability>;
  for (const t of TEST_IDS) {
    const need = LAB_MIN_N[t];
    if (n < need) out[t] = { ok: false, need, shortInRange: true, reason: `${COPY.lab.needs(need)} (${COPY.lab.have(n)})` };
    else if (NEEDS_REST.has(t) && rest < REST_MIN) out[t] = { ok: false, need, shortInRange: false, reason: COPY.lab.needsRest(REST_MIN) };
    else out[t] = { ok: true, need, shortInRange: false, reason: null };
  }
  return out;
}

/** The test to open for a group: the remembered one if it is in that group and available, else the first available. */
export function pickInGroup(g: TestGroup, remembered: TestId | null | undefined, avail: Record<TestId, Availability>): TestId {
  const list = testsIn(g);
  if (remembered && list.includes(remembered) && avail[remembered].ok) return remembered;
  return list.find((t) => avail[t].ok) ?? list[0];
}

/** Slopes are reported per decade for ranges of ten years or more, else per year. `k` converts per-month values. */
export function slopeScale(months: number): { k: number; per: "decade" | "year" } {
  return months >= 120 ? { k: 120, per: "decade" } : { k: 12, per: "year" };
}

/** What a test draws on the anomaly layer: fit segments (indices into d.months) and, for Pettitt, the first month after the break. */
export interface LabOverlay { segments: LabSegment[]; breakAfter: number | null }

export function overlayFor(o: LabOutcome | null): LabOverlay | null {
  if (!o || o.kind !== "ok") return null;
  const breakAfter = o.stats.tool === "pettitt" ? o.stats.splitAt + 1 : null;
  if (!o.segments.length && breakAfter == null) return null;
  return { segments: o.segments, breakAfter };
}

/* ------------------------------------------------------------------ multiple-testing log */

export type HolmStatus = "holds" | "uncorrected-only" | "not-significant";
export interface LogEntry { test: TestId; p: number; status: HolmStatus }
export interface TestLog {
  entries: LogEntry[];
  /** tests with p < 0.05 before correction */
  significant: number;
  /** how many of them chance alone would give at α = 0.05 */
  expected: number;
}

/** Tests run on one range, in the order run; descriptive tests (no p) are left out. Holm at α = 0.05. */
export function testLog(runs: readonly { test: TestId; outcome: LabOutcome | null | undefined }[], alpha = 0.05): TestLog {
  const withP = runs.flatMap(({ test, outcome }) => {
    const p = outcome?.kind === "ok" ? primaryP(outcome.stats) : null;
    return p != null && Number.isFinite(p) ? [{ test, p }] : [];
  });
  const keep = holm(withP.map((e) => e.p), alpha);
  const entries = withP.map((e, i) => ({ ...e, status: (keep[i] ? "holds" : e.p < alpha ? "uncorrected-only" : "not-significant") as HolmStatus }));
  return { entries, significant: entries.filter((e) => e.p < alpha).length, expected: entries.length * alpha };
}
