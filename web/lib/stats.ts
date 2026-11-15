// Small, dependency-free trend statistics for annual means of regional series.
// Everything here is NaN-aware: a missing value is NaN, never zero, and is dropped (or breaks a year) explicitly.
// The tests are preliminary by design: normal approximations, no correction for serial correlation or for
// testing many variables and regions. The UI discloses that wherever a result is shown.

/* ------------------------------------------------------------------ basic helpers */

const isNum = (v: number) => Number.isFinite(v);

export function mean(a: ArrayLike<number>): number {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (isNum(a[i])) { s += a[i]; n++; }
  return n ? s / n : NaN;
}

/** Median of a numeric array (copies; does not mutate). Empty -> NaN. */
export function median(a: ArrayLike<number>): number {
  const s = Float64Array.from(a as ArrayLike<number>).filter(isNum).sort();
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Quantile of an ascending-sorted array at fractional 0-based position pos, linear interpolation. */
function atPosition(sorted: Float64Array, pos: number): number {
  const p = Math.min(sorted.length - 1, Math.max(0, pos));
  const lo = Math.floor(p), hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
}

/* ------------------------------------------------------------------ special functions */

/** Complementary error function, relative error < 1.2e-7 everywhere (Numerical Recipes erfccheb-style fit). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

function lgamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9)
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the regularised incomplete beta function (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

function betaInc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Regularised upper incomplete gamma Q(a, x) (series below a + 1, Lentz continued fraction above). */
function gammaQ(a: number, x: number): number {
  if (!(x > 0)) return 1;
  const lga = lgamma(a);
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let k = 0; k < 500; k++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - lga));
  }
  const TINY = 1e-300;
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lga) * h;
}

/** Upper tail P(X >= x) of the chi-square distribution with df degrees of freedom. */
export function chiSquareSf(x: number, df: number): number {
  if (!(df > 0) || Number.isNaN(x)) return NaN;
  return gammaQ(df / 2, x / 2);
}

/** CDF of Student's t with df degrees of freedom. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * betaInc(df / 2, 0.5, x);
  return t >= 0 ? 1 - tail : tail;
}

/** Upper tail P(X >= F) of the F distribution with (d1, d2) degrees of freedom. */
export function fSf(F: number, d1: number, d2: number): number {
  if (!(d1 > 0 && d2 > 0) || Number.isNaN(F)) return NaN;
  if (F <= 0) return 1;
  return betaInc(d2 / 2, d1 / 2, d2 / (d2 + d1 * F));
}

/** Exact binomial test of k successes in n trials with success probability p. */
export function binomialTest(k: number, n: number, p: number): { pTwoSided: number; pUpper: number; pLower: number } {
  if (!(n >= 0) || !(p >= 0 && p <= 1) || k < 0 || k > n) return { pTwoSided: NaN, pUpper: NaN, pLower: NaN };
  const logPmf = (i: number) => {
    if (p === 0) return i === 0 ? 0 : -Infinity;
    if (p === 1) return i === n ? 0 : -Infinity;
    return lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log(1 - p);
  };
  const pmf = Array.from({ length: n + 1 }, (_, i) => Math.exp(logPmf(i)));
  const at = pmf[k];
  let two = 0, upper = 0, lower = 0;
  pmf.forEach((v, i) => {
    if (v <= at * (1 + 1e-7)) two += v;
    if (i >= k) upper += v;
    if (i <= k) lower += v;
  });
  return { pTwoSided: Math.min(1, two), pUpper: Math.min(1, upper), pLower: Math.min(1, lower) };
}

/** Quantile (inverse CDF) of Student's t, by bisection on the exact CDF. p in (0, 1). */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return NaN;
  if (p === 0.5) return 0;
  const sign = p < 0.5 ? -1 : 1;
  const target = p < 0.5 ? 1 - p : p;
  let lo = 0, hi = 1;
  while (tCdf(hi, df) < target && hi < 1e8) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < target) lo = mid; else hi = mid;
    if (hi - lo < 1e-12 * Math.max(1, hi)) break;
  }
  return (sign * (lo + hi)) / 2;
}

/** z quantile of the standard normal (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -normalQuantile(1 - p);
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/* ------------------------------------------------------------------ annual means */

export interface AnnualMeans {
  /** every calendar year that appears in `months`, ascending */
  years: number[];
  /** mean of the 12 months; NaN for a year that is not complete */
  means: number[];
  /** true only when all 12 months are present and finite */
  complete: boolean[];
  /** number of finite months in each year */
  counts: number[];
}

/** Annual means from monthly values. A year counts only if all 12 months are present and finite. */
export function annualMeans(months: string[], values: ArrayLike<number>): AnnualMeans {
  const order: number[] = [];
  const acc = new Map<number, { sum: number; n: number; seen: number }>();
  for (let i = 0; i < months.length; i++) {
    const y = Number(months[i].slice(0, 4));
    let a = acc.get(y);
    if (!a) { a = { sum: 0, n: 0, seen: 0 }; acc.set(y, a); order.push(y); }
    a.seen++;
    const v = values[i];
    if (isNum(v)) { a.sum += v; a.n++; }
  }
  const years = order.slice().sort((p, q) => p - q);
  const means: number[] = [], complete: boolean[] = [], counts: number[] = [];
  for (const y of years) {
    const a = acc.get(y)!;
    const ok = a.n === 12 && a.seen === 12;
    complete.push(ok);
    counts.push(a.n);
    means.push(ok ? a.sum / 12 : NaN);
  }
  return { years, means, complete, counts };
}

/** Pair up the complete years as (x, y) arrays for the trend functions. */
export function completePairs(a: AnnualMeans): { x: number[]; y: number[] } {
  const x: number[] = [], y: number[] = [];
  a.years.forEach((yr, i) => { if (a.complete[i] && isNum(a.means[i])) { x.push(yr); y.push(a.means[i]); } });
  return { x, y };
}

/* ------------------------------------------------------------------ Mann-Kendall */

export interface MannKendall {
  /** the S statistic (concordant minus discordant pairs) */
  S: number;
  /** variance of S under no trend, with tie correction */
  varS: number;
  /** standardised statistic with continuity correction */
  z: number;
  /** two-sided p-value from the normal approximation. Can underflow to 0: always format with formatP(). */
  p: number;
  /** Kendall's tau-b */
  tau: number;
  n: number;
}

/** Group sizes of tied values (only groups of size >= 2). */
function tieGroups(y: number[]): number[] {
  const s = y.slice().sort((a, b) => a - b);
  const out: number[] = [];
  let run = 1;
  for (let i = 1; i <= s.length; i++) {
    if (i < s.length && s[i] === s[i - 1]) run++;
    else { if (run > 1) out.push(run); run = 1; }
  }
  return out;
}

/** Variance of S for n points with tie groups t (the standard formula). */
function mkVariance(n: number, ties: number[]): number {
  let v = n * (n - 1) * (2 * n + 5);
  for (const t of ties) v -= t * (t - 1) * (2 * t + 5);
  return v / 18;
}

/** Mann-Kendall test for a monotonic trend in y (assumed equally spaced, in time order). Non-finite values are dropped. */
export function mannKendall(yIn: ArrayLike<number>): MannKendall {
  const y: number[] = [];
  for (let i = 0; i < yIn.length; i++) if (isNum(yIn[i])) y.push(yIn[i]);
  const n = y.length;
  if (n < 3) return { S: NaN, varS: NaN, z: NaN, p: NaN, tau: NaN, n };
  let S = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(y[j] - y[i]);
  const ties = tieGroups(y);
  const varS = mkVariance(n, ties);
  const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const p = Math.min(1, erfc(Math.abs(z) / Math.SQRT2)); // = 2 * (1 - Phi(|z|)), without cancellation
  const n0 = (n * (n - 1)) / 2;
  const n1 = ties.reduce((s, t) => s + (t * (t - 1)) / 2, 0);
  const tau = S / Math.sqrt((n0 - n1) * n0);
  return { S, varS, z, p, tau, n };
}

/** p-value text for display. Never prints 0: anything below 0.001 reads "< 0.001". */
export function formatP(p: number | null | undefined): string {
  if (p == null || !isNum(p)) return "—";
  if (p < 0.001) return "< 0.001";
  if (p < 0.1) return p.toFixed(3);
  return p.toFixed(2);
}

/* ------------------------------------------------------------------ Sen slope */

export interface SenSlope {
  /** median of pairwise slopes, y units per x unit */
  slope: number;
  /** median of y - slope * x */
  intercept: number;
  /** 95 % interval of the Sen slope itself (rank-based, from the Mann-Kendall variance) */
  ciLow: number;
  ciHigh: number;
  /** number of pairwise slopes used */
  pairs: number;
  n: number;
}

/** Theil-Sen estimator with the standard rank-based confidence interval (Gilbert 1987 / Sen 1968). */
export function senSlope(xIn: ArrayLike<number>, yIn: ArrayLike<number>, confidence = 0.95): SenSlope {
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < xIn.length; i++) if (isNum(xIn[i]) && isNum(yIn[i])) { x.push(xIn[i]); y.push(yIn[i]); }
  const n = x.length;
  const nan: SenSlope = { slope: NaN, intercept: NaN, ciLow: NaN, ciHigh: NaN, pairs: 0, n };
  if (n < 3) return nan;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) if (x[j] !== x[i]) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
  const N = slopes.length;
  if (!N) return nan;
  const sorted = Float64Array.from(slopes).sort();
  const slope = N % 2 ? sorted[(N - 1) / 2] : (sorted[N / 2 - 1] + sorted[N / 2]) / 2;
  const intercept = median(y.map((v, i) => v - slope * x[i]));
  // Interval: C = z * sqrt(Var(S)); lower rank M1 = (N - C) / 2, upper rank M2 + 1 = (N + C) / 2 + 1 (1-based, ascending).
  const varS = mkVariance(n, tieGroups(y));
  const C = normalQuantile(1 - (1 - confidence) / 2) * Math.sqrt(varS);
  const m1 = (N - C) / 2, m2 = (N + C) / 2;
  const ciLow = atPosition(sorted, m1 - 1);
  const ciHigh = atPosition(sorted, m2);
  return { slope, intercept, ciLow, ciHigh, pairs: N, n };
}

/* ------------------------------------------------------------------ OLS */

export interface Ols {
  slope: number;
  intercept: number;
  /** standard error of the slope */
  se: number;
  /** 95 % interval of the OLS slope (Student's t, n - 2 df). It belongs to the OLS slope, not to the Sen slope. */
  ciLow: number;
  ciHigh: number;
  r2: number;
  n: number;
  df: number;
}

export function olsSlope(xIn: ArrayLike<number>, yIn: ArrayLike<number>, confidence = 0.95): Ols {
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < xIn.length; i++) if (isNum(xIn[i]) && isNum(yIn[i])) { x.push(xIn[i]); y.push(yIn[i]); }
  const n = x.length;
  const nan: Ols = { slope: NaN, intercept: NaN, se: NaN, ciLow: NaN, ciHigh: NaN, r2: NaN, n, df: n - 2 };
  if (n < 3) return nan;
  const mx = mean(x), my = mean(y);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2; }
  if (sxx === 0) return nan;
  const slope = sxy / sxx, intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - intercept - slope * x[i]) ** 2;
  const df = n - 2;
  const se = Math.sqrt(sse / df / sxx);
  const t = tQuantile(1 - (1 - confidence) / 2, df);
  const r2 = syy === 0 ? NaN : 1 - sse / syy;
  return { slope, intercept, se, ciLow: slope - t * se, ciHigh: slope + t * se, r2, n, df };
}

/* ------------------------------------------------------------------ serial correlation */

/** Lag-1 autocorrelation of a residual series (sample autocorrelation about its mean). NaN when undefined. */
export function lag1Autocorrelation(res: ArrayLike<number>): number {
  const r: number[] = [];
  for (let i = 0; i < res.length; i++) r.push(res[i]);
  const n = r.length;
  if (n < 4) return NaN;
  const m = mean(r);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { den += (r[i] - m) ** 2; if (i < n - 1) num += (r[i] - m) * (r[i + 1] - m); }
  return den === 0 ? NaN : num / den;
}

/** Residuals y - (intercept + slope * x). */
export function residuals(x: ArrayLike<number>, y: ArrayLike<number>, intercept: number, slope: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) out.push(y[i] - (intercept + slope * x[i]));
  return out;
}

/** Above this lag-1 autocorrelation of the trend residuals the UI warns: it is about 2 / sqrt(26), the rough noise band. */
export const AUTOCORR_WARN = 0.4;

/* ------------------------------------------------------------------ climatology and anomalies */

export interface Climatology {
  /** 12 means, January first; NaN when a calendar month has no usable value */
  mean: number[];
  min: number[];
  max: number[];
  /** number of values behind each calendar month */
  n: number[];
}

/** calendar month index 0-11 from "YYYY-MM" */
export const calendarMonth = (ym: string) => Number(ym.slice(5, 7)) - 1;
export const yearOf = (ym: string) => Number(ym.slice(0, 4));

/**
 * Mean, min and max of each calendar month. The baseline is the complete years only (2000-2025), so the
 * partial 2026 never pulls the January-July means; if no year is complete, every finite month is used.
 */
export function monthlyClimatology(months: string[], values: ArrayLike<number>): Climatology {
  const am = annualMeans(months, values);
  const full = new Set(am.years.filter((_, i) => am.complete[i]));
  const useAll = full.size === 0;
  const sum = new Array(12).fill(0), n = new Array(12).fill(0);
  const mn = new Array(12).fill(Infinity), mx = new Array(12).fill(-Infinity);
  for (let i = 0; i < months.length; i++) {
    const v = values[i];
    if (!isNum(v) || (!useAll && !full.has(yearOf(months[i])))) continue;
    const m = calendarMonth(months[i]);
    sum[m] += v; n[m]++;
    if (v < mn[m]) mn[m] = v;
    if (v > mx[m]) mx[m] = v;
  }
  return {
    mean: sum.map((s, m) => (n[m] ? s / n[m] : NaN)),
    min: mn.map((v, m) => (n[m] ? v : NaN)),
    max: mx.map((v, m) => (n[m] ? v : NaN)),
    n,
  };
}

/** Anomalies: each month minus the mean of its calendar month. Missing stays NaN. */
export function deseasonalise(months: string[], values: ArrayLike<number>, clim: Climatology = monthlyClimatology(months, values)): Float64Array {
  const out = new Float64Array(months.length);
  for (let i = 0; i < months.length; i++) {
    const v = values[i];
    out[i] = isNum(v) ? v - clim.mean[calendarMonth(months[i])] : NaN;
  }
  return out;
}

/** "This month versus its usual value": the value, the usual value for that calendar month, and the departure. */
export function departure(months: string[], values: ArrayLike<number>, index: number, clim: Climatology): { value: number; usual: number; anomaly: number } {
  const v = values[index];
  const usual = clim.mean[calendarMonth(months[index])];
  return { value: isNum(v) ? v : NaN, usual, anomaly: isNum(v) ? v - usual : NaN };
}

/* ------------------------------------------------------------------ one-call trend summary */

export interface TrendSummary {
  n: number;
  firstYear: number;
  lastYear: number;
  /** annual means of the complete years used in the fit */
  years: number[];
  annual: number[];
  meanOfAnnual: number;
  sen: SenSlope;
  mk: MannKendall;
  ols: Ols;
  /** lag-1 autocorrelation of the residuals around the Sen line */
  lag1: number;
}

/** Everything the evidence panel needs about one monthly series, using complete years only. */
export function summariseTrend(months: string[], values: ArrayLike<number>): TrendSummary {
  const am = annualMeans(months, values);
  const { x, y } = completePairs(am);
  const sen = senSlope(x, y);
  return {
    n: x.length,
    firstYear: x[0] ?? NaN,
    lastYear: x[x.length - 1] ?? NaN,
    years: x,
    annual: y,
    meanOfAnnual: mean(y),
    sen,
    mk: mannKendall(y),
    ols: olsSlope(x, y),
    lag1: lag1Autocorrelation(residuals(x, y, sen.intercept, sen.slope)),
  };
}
