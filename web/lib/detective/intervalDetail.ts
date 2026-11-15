// Interval statistics for the analysis workbench (UI/UX refresh). Additive to ./analysis.ts:
// nothing in ./contracts.ts changes. Pure functions, no DOM, runnable under `npx tsx --test`.
//
// Question answered: "is the mean anomaly over this month range distinguishable from the
// variable's ordinary month-to-month variability, once the seasonal cycle and trend are removed?"
// A small p says the interval is unusual. It never says the event caused it.
import { normalCdf } from "../stats";
import type { Decomposition, TimeRange, YearMonth } from "./contracts";

/** Noise model of the baseline residuals (everything outside `d.baseline.excluded`). */
export interface BaselineInfo {
  /** sample SD (n − 1) of the baseline residuals, original units; null when it cannot be estimated or is 0 */
  sigma: number | null;
  /** observed baseline months */
  n: number;
  /** lag-1 autocorrelation of baseline residuals over adjacent observed calendar months, clamped to [0, 0.99] */
  rho: number;
  /** the months left out of the baseline: event ± pad */
  excluded: TimeRange;
  /** first and last month of the record */
  record: TimeRange;
}

export type Verdict = "significant" | "mixed" | "not-significant" | "insufficient";

export interface IntervalDetail {
  range: TimeRange;
  /** calendar months in the range */
  months: number;
  /** months with an observed residual */
  n: number;
  /** mean residual, original units */
  meanAnomaly: number | null;
  /** 95% interval of the mean anomaly: meanAnomaly ± 1.96 · se */
  ci95: [number, number] | null;
  /** mean of the monthly z scores */
  meanZ: number | null;
  /**
   * 100 · meanAnomaly / mean(trend + seasonal) over the observed months. null unless every raw
   * value in the record is ≥ 0 and the expected mean is > 0 (a percentage of a temperature or of
   * a storage anomaly means nothing).
   */
  percentOfNormal: number | null;
  /**
   * z test of the mean against 0 with AR(1) noise:
   * se = sigma · sqrt( Σ_i Σ_j rho^|t_i − t_j| ) / n over the observed months' calendar positions t,
   * z = meanAnomaly / se, p two-sided normal. nEff = n / (Σ_i Σ_j rho^|t_i − t_j| / n).
   */
  test: { z: number; p: number; se: number; nEff: number } | null;
  /**
   * Where the interval mean falls among every complete window of the same calendar length that
   * lies wholly in the baseline. asExtreme counts windows with |mean| ≥ |meanAnomaly|;
   * p = (asExtreme + 1) / (windows + 1). null when the interval has a missing month or there are
   * fewer than 20 such windows.
   */
  empirical: { p: number; asExtreme: number; windows: number } | null;
  /**
   * The same calendar months in every year of the record (this interval included): position 1 is
   * the most extreme year in the interval's own direction ("2nd lowest of 24 Feb–May periods").
   * null when the interval is longer than 12 months, has a missing month, or fewer than 5 years qualify.
   */
  seasonRank: { position: number; of: number; direction: "low" | "high" } | null;
  /**
   * Both tests agree at α = 0.05 → "significant" / "not-significant"; they disagree → "mixed";
   * with only one test available that test decides; no test → "insufficient".
   */
  verdict: Verdict;
  direction: "low" | "high" | null;
  /** the month with the largest |z| */
  peak: { month: YearMonth; z: number; anomaly: number } | null;
  /** observed months with |z| ≥ 2 */
  beyond2Sigma: number;
  /** share (0–1) of observed months whose residual has the sign of the mean */
  signConsistency: number | null;
}

/** How a selected range sits relative to the event. */
export interface EventRelation {
  kind: "same" | "before" | "after" | "overlaps";
  /**
   * before: months from the end of the range to the start of the event (≥ 1, 1 = the month just before);
   * after: months from the end of the event to the start of the range (≥ 1); otherwise 0.
   */
  gapMonths: number;
}

const Z95 = 1.96;
const ALPHA = 0.05;
const MIN_EMPIRICAL_WINDOWS = 20;
const MIN_SEASON_YEARS = 5;
const MAX_RHO = 0.99;

function monthNumber(month: string): number {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError(`Invalid month: ${month}; expected YYYY-MM.`);
  }
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
}

function rangeNumbers(range: TimeRange): [number, number] {
  const start = monthNumber(range.start);
  const end = monthNumber(range.end);
  if (end < start) throw new RangeError("The range end precedes its start.");
  return [start, end];
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Compensated mean; `magnitude` is the mean absolute constituent, used to scale tie tolerances. */
function windowSummary(values: number[]): { mean: number; magnitude: number } {
  let sum = 0;
  let correction = 0;
  let magnitude = 0;
  for (const value of values) {
    const term = value / values.length;
    const next = sum + term;
    correction += Math.abs(sum) >= Math.abs(term) ? (sum - next) + term : (term - next) + sum;
    sum = next;
    magnitude += Math.abs(term);
  }
  return { mean: sum + correction, magnitude };
}

function checkLengths(d: Decomposition): void {
  const n = d.months.length;
  if (d.residual.length !== n || d.z.length !== n || d.raw.length !== n ||
      d.trend.length !== n || d.seasonal.length !== n) {
    throw new RangeError("Decomposition arrays must have equal lengths.");
  }
}

/** Noise model of the baseline: sigma (sample SD), observed count, and lag-1 autocorrelation. */
export function baselineInfo(d: Decomposition): BaselineInfo {
  checkLengths(d);
  const [exStart, exEnd] = rangeNumbers(d.baseline.excluded);
  const months = d.months.map(monthNumber);
  const record: TimeRange = months.length
    ? { start: d.months[months.indexOf(Math.min(...months))], end: d.months[months.indexOf(Math.max(...months))] }
    : { ...d.baseline.excluded };

  // Dense residual lookup over the record so adjacent calendar months are found by position.
  const byMonth = new Map<number, number>();
  const values: number[] = [];
  let scale = 0;
  months.forEach((m, i) => {
    if (m >= exStart && m <= exEnd) return;
    const r = finiteOrNull(d.residual[i]);
    if (r === null) return;
    byMonth.set(m, r);
    values.push(r);
    const raw = finiteOrNull(d.raw[i]);
    scale = Math.max(scale, Math.abs(raw ?? 0));
  });
  const n = values.length;

  let sigma: number | null = null;
  let rho = 0;
  if (n >= 2) {
    const center = windowSummary(values).mean;
    let squares = 0;
    for (const v of values) squares += (v - center) ** 2;
    const sd = Math.sqrt(squares / (n - 1));
    // Exact fits leave a few ulps of cancellation error, not measurable noise (same rule as decompose).
    if (Number.isFinite(sd) && sd > Number.EPSILON * scale * 32 && sd > 0) sigma = sd;

    let numerator = 0;
    let pairs = 0;
    for (const [m, r] of byMonth) {
      const next = byMonth.get(m + 1);
      if (next === undefined) continue;
      numerator += (r - center) * (next - center);
      pairs++;
    }
    const denominator = squares;
    if (pairs >= 3 && denominator > 0) {
      const raw = numerator / denominator;
      if (Number.isFinite(raw)) rho = Math.max(0, Math.min(MAX_RHO, raw));
    }
  }
  return { sigma, n, rho, excluded: { ...d.baseline.excluded }, record };
}

function emptyDetail(range: TimeRange, months: number): IntervalDetail {
  return {
    range: { ...range }, months, n: 0, meanAnomaly: null, ci95: null, meanZ: null, percentOfNormal: null,
    test: null, empirical: null, seasonRank: null, verdict: "insufficient", direction: null,
    peak: null, beyond2Sigma: 0, signConsistency: null,
  };
}

/** `baseline` defaults to `baselineInfo(d)`; pass it when summarising many ranges of one decomposition. */
export function intervalDetail(d: Decomposition, range: TimeRange, baseline?: BaselineInfo): IntervalDetail {
  const [start, end] = rangeNumbers(range);
  checkLengths(d);
  const base = baseline ?? baselineInfo(d);
  const [exStart, exEnd] = rangeNumbers(base.excluded);
  const length = end - start + 1;

  const monthNums = d.months.map(monthNumber);
  const first = monthNums.length ? Math.min(...monthNums) : 0;
  const last = monthNums.length ? Math.max(...monthNums) : -1;
  const span = last - first + 1;
  // Dense lookups by calendar position; -1 marks months absent from the record.
  const index = new Array<number>(Math.max(span, 0)).fill(-1);
  monthNums.forEach((m, i) => { index[m - first] = i; });
  const residualAt = (m: number): number | null =>
    m < first || m > last || index[m - first] < 0 ? null : finiteOrNull(d.residual[index[m - first]]);

  // Observed months in the range.
  const obsMonths: number[] = [];
  const obsIdx: number[] = [];
  for (let m = Math.max(start, first); m <= Math.min(end, last); m++) {
    if (residualAt(m) !== null) { obsMonths.push(m); obsIdx.push(index[m - first]); }
  }
  const n = obsMonths.length;
  if (n === 0) return emptyDetail(range, length);

  const residuals = obsIdx.map((i) => d.residual[i] as number);
  const summary = windowSummary(residuals);
  const meanAnomaly = finiteOrNull(summary.mean);
  if (meanAnomaly === null) return emptyDetail(range, length);
  const direction: "low" | "high" = meanAnomaly < 0 ? "low" : "high";
  const complete = n === length;

  // z scores, peak, sign consistency.
  const zs: number[] = [];
  let peak: IntervalDetail["peak"] = null;
  let beyond2Sigma = 0;
  let consistent = 0;
  obsIdx.forEach((i, k) => {
    const r = residuals[k];
    if (direction === "low" ? r < 0 : r > 0) consistent++;
    const z = finiteOrNull(d.z[i]);
    if (z === null) return;
    zs.push(z);
    if (Math.abs(z) >= 2) beyond2Sigma++;
    if (peak === null || Math.abs(z) > Math.abs(peak.z)) peak = { month: d.months[i], z, anomaly: r };
  });
  const meanZ = zs.length ? finiteOrNull(windowSummary(zs).mean) : null;

  // Percent of the expected (trend + seasonal) level.
  let percentOfNormal: number | null = null;
  if (d.raw.every((v) => v === null || (Number.isFinite(v) && v >= 0))) {
    const expected = windowSummary(obsIdx.map((i) => d.trend[i] + d.seasonal[i])).mean;
    if (Number.isFinite(expected) && expected > 0) percentOfNormal = finiteOrNull(100 * meanAnomaly / expected);
  }

  // AR(1) z test of the mean against 0.
  let test: IntervalDetail["test"] = null;
  let ci95: [number, number] | null = null;
  if (base.sigma !== null && Number.isFinite(base.sigma) && base.sigma > 0) {
    const rho = Math.max(0, Math.min(MAX_RHO, Number.isFinite(base.rho) ? base.rho : 0));
    const maxLag = obsMonths[n - 1] - obsMonths[0];
    const powers = new Array<number>(maxLag + 1);
    for (let k = 0; k <= maxLag; k++) powers[k] = Math.pow(rho, k);
    let total = 0;
    for (let i = 0; i < n; i++) {
      total += 1;
      for (let j = i + 1; j < n; j++) total += 2 * powers[obsMonths[j] - obsMonths[i]];
    }
    const se = base.sigma * Math.sqrt(total) / n;
    const z = meanAnomaly / se;
    const p = Math.min(1, Math.max(0, 2 * normalCdf(-Math.abs(z))));
    const nEff = n / (total / n);
    if ([se, z, p, nEff].every(Number.isFinite) && se > 0) {
      test = { z, p, se, nEff };
      const lo = meanAnomaly - Z95 * se;
      const hi = meanAnomaly + Z95 * se;
      if (Number.isFinite(lo) && Number.isFinite(hi)) ci95 = [lo, hi];
      else test = null;
    }
  }

  // Empirical: same-length windows wholly inside the baseline and fully observed.
  let empirical: IntervalDetail["empirical"] = null;
  if (complete) {
    let windows = 0;
    let asExtreme = 0;
    const target = Math.abs(meanAnomaly);
    for (let s = first; s + length - 1 <= last; s++) {
      if (s <= exEnd && s + length - 1 >= exStart) continue;
      const vals: number[] = [];
      for (let m = s; m < s + length; m++) {
        const r = residualAt(m);
        if (r === null) break;
        vals.push(r);
      }
      if (vals.length !== length) continue;
      const w = windowSummary(vals);
      const tol = 32 * Number.EPSILON * Math.max(w.magnitude, summary.magnitude);
      windows++;
      if (Math.abs(w.mean) >= target - tol) asExtreme++;
    }
    if (windows >= MIN_EMPIRICAL_WINDOWS) {
      empirical = { p: (asExtreme + 1) / (windows + 1), asExtreme, windows };
    }
  }

  // Season rank: the same calendar months in every year of the record.
  let seasonRank: IntervalDetail["seasonRank"] = null;
  if (complete && length <= 12) {
    const means: number[] = [];
    const mags: number[] = [];
    let own = -1;
    const kMin = Math.ceil((first - start) / 12);
    const kMax = Math.floor((last - end) / 12);
    for (let k = kMin; k <= kMax; k++) {
      const vals: number[] = [];
      for (let m = start + 12 * k; m <= end + 12 * k; m++) {
        const r = residualAt(m);
        if (r === null) break;
        vals.push(r);
      }
      if (vals.length !== length) continue;
      const w = windowSummary(vals);
      if (k === 0) own = means.length;
      means.push(w.mean);
      mags.push(w.magnitude);
    }
    if (own >= 0 && means.length >= MIN_SEASON_YEARS) {
      let beyond = 0;
      means.forEach((m, i) => {
        const tol = 32 * Number.EPSILON * Math.max(mags[i], summary.magnitude);
        if (direction === "low" ? m < meanAnomaly - tol : m > meanAnomaly + tol) beyond++;
      });
      seasonRank = { position: 1 + beyond, of: means.length, direction };
    }
  }

  const verdicts: boolean[] = [];
  if (test) verdicts.push(test.p < ALPHA);
  if (empirical) verdicts.push(empirical.p < ALPHA);
  let verdict: Verdict;
  if (verdicts.length === 0) verdict = "insufficient";
  else if (verdicts.every((v) => v)) verdict = "significant";
  else if (verdicts.every((v) => !v)) verdict = "not-significant";
  else verdict = "mixed";

  return {
    range: { ...range }, months: length, n, meanAnomaly, ci95, meanZ, percentOfNormal, test,
    empirical, seasonRank, verdict, direction, peak, beyond2Sigma, signConsistency: consistent / n,
  };
}

export function relationToEvent(range: TimeRange, event: TimeRange): EventRelation {
  const [rs, re] = rangeNumbers(range);
  const [es, ee] = rangeNumbers(event);
  if (rs === es && re === ee) return { kind: "same", gapMonths: 0 };
  if (re < es) return { kind: "before", gapMonths: es - re };
  if (rs > ee) return { kind: "after", gapMonths: rs - ee };
  return { kind: "overlaps", gapMonths: 0 };
}
