import {
  lag1Autocorrelation,
  mannKendall,
  mean,
  normalCdf,
  normalQuantile,
  olsSlope,
  senSlope,
} from "../stats";
import type {
  Decomposition,
  IntervalStats,
  MonthlySeries,
  TimeRange,
  TrendStats,
} from "./contracts";

const MONTHS_PER_DECADE = 120;
const Z95 = normalQuantile(0.975);
const LAST_MONTH = 9999 * 12 + 11;

function monthNumber(month: string): number {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError(`Invalid month: ${month}; expected YYYY-MM.`);
  }
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
}

function monthString(month: number): string {
  if (!Number.isSafeInteger(month) || month < 0 || month > LAST_MONTH) {
    throw new RangeError("Month falls outside the YYYY-MM calendar range.");
  }
  return `${String(Math.floor(month / 12)).padStart(4, "0")}-${String(month % 12 + 1).padStart(2, "0")}`;
}

function rangeNumbers(range: TimeRange): [number, number] {
  const start = monthNumber(range.start);
  const end = monthNumber(range.end);
  if (end < start) throw new RangeError("The range end precedes its start.");
  return [start, end];
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function readSeries(series: MonthlySeries) {
  const start = monthNumber(series.start);
  if (series.values.length && start + series.values.length - 1 > LAST_MONTH) {
    throw new RangeError("The series extends beyond the YYYY-MM calendar range.");
  }
  const values = series.values.map(finiteOrNull);
  const yearCounts = new Map<number, number>();
  values.forEach((value, i) => {
    if (value === null) return;
    const year = Math.floor((start + i) / 12);
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
  });
  return { start, values, yearCounts };
}

interface SeasonalFit {
  intercept: number;
  slope: number;
  seasonal: number[];
}

function fitSeasonalTrend(
  start: number,
  values: (number | null)[],
  yearCounts: Map<number, number>,
  include: (index: number) => boolean,
): SeasonalFit | null {
  const x: number[] = [];
  const y: number[] = [];
  const eligible: number[] = [];
  const monthX = new Array<number>(12).fill(0);
  const monthY = new Array<number>(12).fill(0);
  const counts = new Array<number>(12).fill(0);

  values.forEach((value, i) => {
    if (value === null || !include(i)) return;
    x.push(i);
    y.push(value);
    if ((yearCounts.get(Math.floor((start + i) / 12)) ?? 0) < 9) return;
    const month = (start + i) % 12;
    eligible.push(i);
    counts[month]++;
    monthX[month] += (i - monthX[month]) / counts[month];
    monthY[month] += (value - monthY[month]) / counts[month];
  });
  if (x.length < 14 || counts.some((count) => count === 0)) return null;

  // Within-month centering is the joint OLS fit of time and month fixed effects.
  let denominator = 0;
  let numerator = 0;
  for (const i of eligible) {
    const month = (start + i) % 12;
    const dx = i - monthX[month];
    denominator += dx * dx;
    numerator += dx * (values[i]! - monthY[month]);
  }
  if (!(denominator > 0) || !Number.isFinite(denominator)) return null;
  const jointSlope = numerator / denominator;
  const monthIntercepts = monthY.map((value, month) => value - jointSlope * monthX[month]);
  const center = mean(monthIntercepts);
  const seasonal = monthIntercepts.map((value) => value - center);

  // Poor-coverage years can inform the trend, but cannot change the seasonal fit.
  const trend = olsSlope(x, y.map((value, i) => value - seasonal[(start + x[i]) % 12]));
  if (![trend.slope, trend.intercept, ...seasonal].every(Number.isFinite)) return null;
  return { intercept: trend.intercept, slope: trend.slope, seasonal };
}

function sampleDeviation(values: number[]): number {
  const center = mean(values);
  let squares = 0;
  for (const value of values) squares += (value - center) ** 2;
  return Math.sqrt(squares / (values.length - 1));
}

function windowSummary(values: number[]): { mean: number; magnitude: number } {
  let sum = 0;
  let correction = 0;
  let magnitude = 0;
  for (const value of values) {
    const term = value / values.length;
    const next = sum + term;
    correction += Math.abs(sum) >= Math.abs(term)
      ? (sum - next) + term
      : (term - next) + sum;
    sum = next;
    magnitude += Math.abs(term);
  }
  return { mean: sum + correction, magnitude };
}

/**
 * Fit only outside the inclusive event +/- pad window. Dates must be YYYY-MM,
 * ranges ordered, and pad a nonnegative safe integer; invalid inputs throw
 * RangeError. Nonfinite observations are treated as null without interpolation.
 *
 * Seasonal eligibility requires at least 9 ORIGINAL observed months in a calendar
 * year, before event exclusion (unrepresented months count as missing). A joint
 * OLS fit of time and month effects on eligible baseline observations identifies
 * a zero-mean seasonal cycle. Holding that cycle fixed, OLS uses every observed
 * baseline month for the final trend. Both fits therefore exclude the event.
 *
 * Throws RangeError if fewer than 14 baseline observations remain, any calendar
 * month lacks an eligible baseline observation, or the joint fit is unidentified.
 * Sigma is the sample SD of all baseline residuals (n - 1 denominator). A zero
 * sigma gives null z scores. Missing raw/residual/z positions stay null; fitted
 * trend and seasonal values extend through missing months. baseline.months lists
 * all baseline calendar months, while baseline.n counts finite observations.
 */
export function decompose(series: MonthlySeries, event: TimeRange, padMonths: number): Decomposition {
  const [eventStart, eventEnd] = rangeNumbers(event);
  if (!Number.isSafeInteger(padMonths) || padMonths < 0) {
    throw new RangeError("padMonths must be a nonnegative safe integer.");
  }
  const excludedStart = eventStart - padMonths;
  const excludedEnd = eventEnd + padMonths;
  const excluded = { start: monthString(excludedStart), end: monthString(excludedEnd) };
  const { start, values, yearCounts } = readSeries(series);
  const inBaseline = (i: number) => start + i < excludedStart || start + i > excludedEnd;
  const fit = fitSeasonalTrend(start, values, yearCounts, inBaseline);
  if (!fit) {
    throw new RangeError("Insufficient baseline: need 14 observations, all 12 eligible calendar months, and an identifiable trend.");
  }

  const months = values.map((_, i) => monthString(start + i));
  const trend = values.map((_, i) => fit.intercept + fit.slope * i);
  const seasonal = values.map((_, i) => fit.seasonal[(start + i) % 12]);
  const residual = values.map((value, i) => value === null ? null : value - trend[i] - seasonal[i]);
  if (![...trend, ...seasonal].every(Number.isFinite) || residual.some((value) => value !== null && !Number.isFinite(value))) {
    throw new RangeError("The decomposition exceeds finite numeric precision.");
  }
  const baselineResiduals = residual.filter((value, i): value is number => inBaseline(i) && value !== null);
  let sigma = sampleDeviation(baselineResiduals);
  // Exact fits can leave a few ulps of cancellation error, not measurable noise.
  const scale = values.reduce<number>((maximum, value, i) =>
    inBaseline(i) ? Math.max(maximum, Math.abs(value ?? 0)) : maximum, 0);
  if (sigma <= Number.EPSILON * scale * 32) sigma = 0;
  const z = residual.map((value) => value === null || !(sigma > 0) ? null : finiteOrNull(value / sigma));
  return {
    months,
    raw: values,
    trend,
    seasonal,
    residual,
    z,
    baseline: { months: months.filter((_, i) => inBaseline(i)), excluded, n: baselineResiduals.length },
  };
}

/**
 * Summarize observed months inside an inclusive, ordered YYYY-MM range. n counts
 * finite residuals; each mean uses its available finite observations. An empty
 * selection has null means. Nonfinite values are missing, never zero.
 *
 * Ranking requires every calendar month in the requested range to be observed.
 * Compare against ALL complete same-calendar-length sliding windows, including
 * the selected event. Missing values and absent calendar months break windows.
 * Ties use competition rank and percentile 100 * (less + equal / 2) / N. Negative
 * means rank from the low end; zero and positive means rank from the high end.
 * Window means use compensated summation; tie tolerance scales with the mean
 * absolute constituent values of those two windows, without an absolute floor.
 * Malformed dates, unordered/duplicate months, or array lengths throw RangeError.
 */
export function intervalStats(d: Decomposition, range: TimeRange): IntervalStats {
  const [start, end] = rangeNumbers(range);
  if (d.months.length !== d.residual.length || d.months.length !== d.z.length) {
    throw new RangeError("Decomposition month, residual and z arrays must have equal lengths.");
  }
  const months = d.months.map(monthNumber);
  if (months.some((month, i) => i > 0 && month <= months[i - 1])) {
    throw new RangeError("Decomposition months must be unique and increasing.");
  }
  const residual = d.residual.map(finiteOrNull);
  const z = d.z.map(finiteOrNull);
  const selected: number[] = [];
  const selectedZ: number[] = [];
  months.forEach((month, i) => {
    if (month < start || month > end) return;
    if (residual[i] !== null) selected.push(residual[i]);
    if (z[i] !== null) selectedZ.push(z[i]);
  });
  const selectedSummary = selected.length ? windowSummary(selected) : null;
  const meanResidual = selectedSummary ? finiteOrNull(selectedSummary.mean) : null;
  const result: IntervalStats = {
    range: { ...range },
    n: selected.length,
    meanResidual,
    meanZ: selectedZ.length ? finiteOrNull(windowSummary(selectedZ).mean) : null,
    percentile: null,
    rank: null,
  };
  const length = end - start + 1;
  if (selected.length !== length || meanResidual === null) return result;

  let less = 0;
  let greater = 0;
  let equal = 0;
  for (let first = 0; first + length <= residual.length; first++) {
    if (months[first + length - 1] - months[first] !== length - 1) continue;
    const window: number[] = [];
    for (let i = first; i < first + length; i++) {
      const value = residual[i];
      if (value === null) break;
      window.push(value);
    }
    if (window.length !== length) continue;
    // Recompute each window so a departing large value leaves no rounding error.
    const candidate = windowSummary(window);
    const tolerance = 32 * Number.EPSILON * Math.max(candidate.magnitude, selectedSummary!.magnitude);
    if (candidate.mean < meanResidual - tolerance) less++;
    else if (candidate.mean > meanResidual + tolerance) greater++;
    else equal++;
  }
  const total = less + equal + greater;
  if (!total) return result;
  const direction = meanResidual < 0 ? "low" : "high";
  result.percentile = 100 * (less + equal / 2) / total;
  result.rank = { position: 1 + (direction === "low" ? less : greater), of: total, direction };
  return result;
}

function calendarLag1(x: number[], residual: number[]): number {
  const center = mean(residual);
  let numerator = 0;
  let denominator = 0;
  let pairs = 0;
  for (let i = 0; i < residual.length; i++) {
    denominator += (residual[i] - center) ** 2;
    if (i > 0 && x[i] - x[i - 1] === 1) {
      numerator += (residual[i - 1] - center) * (residual[i] - center);
      pairs++;
    }
  }
  if (pairs < 3 || denominator === 0) return 0;
  const correlation = pairs === residual.length - 1
    ? lag1Autocorrelation(residual)
    : numerator / denominator;
  return Number.isFinite(correlation) ? Math.max(0, Math.min(1, correlation)) : 0;
}

function slopeInterval(x: number[], y: number[], variance: number): [number, number] {
  const slopes: number[] = [];
  for (let i = 0; i < x.length - 1; i++) {
    for (let j = i + 1; j < x.length; j++) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
  }
  slopes.sort((a, b) => a - b);
  const at = (position: number) => {
    const index = Math.max(0, Math.min(slopes.length - 1, position));
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return slopes[lower] + (slopes[upper] - slopes[lower]) * (index - lower);
  };
  const width = Z95 * Math.sqrt(variance);
  return [at((slopes.length - width) / 2 - 1), at((slopes.length + width) / 2)];
}

/**
 * Estimate the full-series trend after removing only the seasonal cycle, using
 * the same >=9 ORIGINAL months/year eligibility and joint OLS seasonal fit as
 * decompose. The secular trend remains in the data. Sen slopes use actual elapsed
 * calendar months, multiplied by 120 for units/decade. The 95% interval is the
 * interpolated Sen/Gilbert rank interval, using tie-adjusted MK variance.
 *
 * Detrended lag-1 residual correlation uses only adjacent observed calendar
 * months. nEff = n * (1-rho)/(1+rho), bounded to [1,n]; negative correlation is
 * conservatively treated as zero. Both MK variance and the slope interval use
 * the inflation n/nEff. MK uses a continuity correction and a two-sided normal
 * approximation. This lag-1 adjustment is approximate, not a power guarantee.
 *
 * For a nonsignificant, nonzero slope, yearsToSignificance is ADDITIONAL years:
 * current observed span * ((1.96*SE/|slope|)^(2/3) - 1), assuming unchanged slope,
 * sampling density and autocorrelation, with SE from the corrected Sen interval.
 * Already significant, zero-slope, unavailable, and >50-year estimates are null.
 * Invalid dates throw RangeError; nonfinite data become missing. Insufficient or
 * unidentifiable seasonal fits return all-null fields rather than NaN/Infinity.
 *
 * Rank CI: https://search.r-project.org/CRAN/refmans/EnvStats/html/kendallTrendTest.html
 * Detrended lag-1 correction: https://search.r-project.org/CRAN/refmans/modifiedmk/html/mmky1lag.html
 */
export function trendStats(series: MonthlySeries): TrendStats {
  const unavailable: TrendStats = {
    senPerDecade: null,
    ci95: null,
    mkP: null,
    significant: null,
    yearsToSignificance: null,
    nEff: null,
  };
  const { start, values, yearCounts } = readSeries(series);
  const fit = fitSeasonalTrend(start, values, yearCounts, () => true);
  if (!fit) return unavailable;
  const x: number[] = [];
  const y: number[] = [];
  values.forEach((value, i) => {
    if (value === null) return;
    x.push(i);
    y.push(value - fit.seasonal[(start + i) % 12]);
  });
  if (!y.every(Number.isFinite)) return unavailable;
  const sen = senSlope(x, y);
  const mk = mannKendall(y);
  if (![sen.slope, sen.intercept, mk.varS].every(Number.isFinite)) return unavailable;
  const residual = y.map((value, i) => value - sen.intercept - sen.slope * x[i]);
  const rho = calendarLag1(x, residual);
  const nEff = Math.max(1, Math.min(x.length, x.length * (1 - rho) / (1 + rho)));
  const variance = mk.varS * x.length / nEff;
  const z = mk.S === 0 ? 0 : (mk.S - Math.sign(mk.S)) / Math.sqrt(variance);
  const mkP = Math.min(1, 2 * normalCdf(-Math.abs(z)));
  const significant = mkP < 0.05;
  const ci = slopeInterval(x, y, variance);
  const ci95: [number, number] = [ci[0] * MONTHS_PER_DECADE, ci[1] * MONTHS_PER_DECADE];
  const senPerDecade = sen.slope * MONTHS_PER_DECADE;
  if (![senPerDecade, ...ci95, mkP, nEff].every(Number.isFinite)) return unavailable;

  let yearsToSignificance: number | null = null;
  if (!significant && sen.slope !== 0) {
    const standardError = (ci[1] - ci[0]) / (2 * Z95);
    const spanYears = (x[x.length - 1] - x[0] + 1) / 12;
    const additional = spanYears * ((Z95 * standardError / Math.abs(sen.slope)) ** (2 / 3) - 1);
    if (Number.isFinite(additional) && additional > 0 && additional <= 50) yearsToSignificance = additional;
  }
  return { senPerDecade, ci95, mkP, significant, yearsToSignificance, nEff };
}
