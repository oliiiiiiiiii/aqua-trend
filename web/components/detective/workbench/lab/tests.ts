// The workbench "Tests" area, pure part: the lab's tools in its five groups (LAB_GROUPS), which ones
// the range can support, what each draws on the anomaly chart, and the multiple-testing log.
// Statistics live in lib/detective/lab.ts.
import { LAB_GROUPS, LAB_MIN_N, holm, labSample, primaryP, restSample, type LabBand, type LabOutcome, type LabSegment } from "@/lib/detective/lab";
import { TEST_IDS, type TestId } from "@/lib/detective/url";
import { labCopy, slopeFor, type LabStep } from "./step";

export type { TestId };
/** LAB_GROUPS in order: trend · mean and distribution · persistence and extremes · cycles and memory · machine learning */
export type TestGroup = "trend" | "mean" | "extremes" | "cycles" | "ml";

export const GROUPS: readonly TestGroup[] = ["trend", "mean", "extremes", "cycles", "ml"];

export const testsIn = (g: TestGroup): TestId[] => [...LAB_GROUPS[GROUPS.indexOf(g)].tools];
export const groupOf = (t: TestId): TestGroup => GROUPS.find((g) => testsIn(g).includes(t)) ?? "trend";

export const DEFAULT_TEST: TestId = "mean";
/** simulation- or fit-heavy tests (2000 draws, a dense periodogram, model fits) run only after Analyse and get a longer progress bar */
const SLOW: ReadonlySet<TestId> = new Set(["bootstrap", "permutation", "runs", "spectrum", "hmm", "gp", "iforest", "discord", "bocpd"]);
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

/** months the forecast needs before the range: rows with the 6 months before them all present (ml.ts arForecast asks for 30) */
export const FORECAST_TRAIN = 30;
function trainingRows(v: readonly (number | null)[], start: number): number {
  let run = 0, rows = 0;
  for (let t = 0; t < Math.min(start, v.length); t++) {
    run = v[t] != null && Number.isFinite(v[t] as number) ? run + 1 : 0;
    if (run >= 7) rows++;
  }
  return rows;
}

/** Which tests the residual months [start, end] (indices into d.months) can support, with the reason when not. */
export function availability(residual: readonly (number | null)[], start: number, end: number, step: LabStep = "month"): Record<TestId, Availability> {
  const COPY = { lab: labCopy(step) };
  const n = labSample(residual, start, end).n;
  const rest = restSample(residual, start, end).n;
  const out = {} as Record<TestId, Availability>;
  for (const t of TEST_IDS) {
    const need = LAB_MIN_N[t];
    if (n < need) out[t] = { ok: false, need, shortInRange: true, reason: `${COPY.lab.needs(need)} (${COPY.lab.have(n)})` };
    else if (NEEDS_REST.has(t) && rest < REST_MIN) out[t] = { ok: false, need, shortInRange: false, reason: COPY.lab.needsRest(REST_MIN) };
    else out[t] = { ok: true, need, shortInRange: false, reason: null };
  }
  if (out.forecast.ok && trainingRows(residual, start) < FORECAST_TRAIN) out.forecast = { ok: false, need: LAB_MIN_N.forecast, shortInRange: false, reason: COPY.lab.ml.needsTraining };
  // calendar months only exist in a monthly series
  if (step !== "month") out.monthly = { ok: false, need: LAB_MIN_N.monthly, shortInRange: false, reason: COPY.lab.monthlyOnly };
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
  return slopeFor("month", months);
}

/** Colour of a shaded span: the variable's low / high anomaly colours, or neutral focus / ink. */
export type BandFill = "low" | "high" | "focus" | "ink";
export interface OverlayBand { x0: number; x1: number; fill: BandFill; label?: string }
export interface OverlayLegend { fill: BandFill; text: string }

/**
 * What a test draws on the chart. `segments` and `breakAfter` are in anomaly units, so they show on the Anomaly layer only;
 * `bands` (shaded spans of months, indices into d.months) show on every layer, with a legend entry each.
 */
export interface LabOverlay { segments: LabSegment[]; breakAfter: number | null; bands: OverlayBand[]; legend: OverlayLegend[] }

const FILL: Record<LabBand["tone"], BandFill> = { cool: "low", warm: "high", focus: "focus", ink: "ink" };

/** Band legend wording per tool (the lab's own band labels are Chinese: they are replaced here). */
function bandView(o: Extract<LabOutcome, { kind: "ok" }>): { bands: OverlayBand[]; legend: OverlayLegend[] } {
  const raw = o.bands ?? [];
  const L = labCopy("month").band;
  const tool = o.stats.tool;
  let bands: OverlayBand[];
  if (tool === "discord") bands = raw.map((b) => ({ x0: b.x0, x1: b.x1, fill: b.label === "罕見" ? ("ink" as const) : ("focus" as const) }));
  else bands = raw.map((b) => ({ x0: b.x0, x1: b.x1, fill: FILL[b.tone], label: tool === "analog" ? b.label : undefined }));
  const has = (f: BandFill) => bands.some((b) => b.fill === f);
  const legend: OverlayLegend[] = [];
  if (tool === "analog" && bands.length) legend.push({ fill: "focus", text: L.similar });
  else if (tool === "hmm") { if (has("low")) legend.push({ fill: "low", text: L.lowState }); if (has("high")) legend.push({ fill: "high", text: L.highState }); }
  else if (tool === "discord") { if (has("ink")) legend.push({ fill: "ink", text: L.rare }); if (has("focus")) legend.push({ fill: "focus", text: L.repeat }); }
  else if (tool === "iforest") { if (has("low")) legend.push({ fill: "low", text: L.flaggedLow }); if (has("high")) legend.push({ fill: "high", text: L.flaggedHigh }); }
  return { bands, legend };
}

export function overlayFor(o: LabOutcome | null): LabOverlay | null {
  if (!o || o.kind !== "ok") return null;
  const breakAfter = o.stats.tool === "pettitt" ? o.stats.splitAt + 1 : null;
  const { bands, legend } = bandView(o);
  if (!o.segments.length && breakAfter == null && !bands.length) return null;
  return { segments: o.segments, breakAfter, bands, legend };
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
