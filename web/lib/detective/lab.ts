// Analysis "lab": single-variable tests run on the processed residual series
// (raw − seasonal cycle − long-term trend) over a chosen range of months.
//
// Every function takes x = month index (into Decomposition.months) and y = residual, with
// missing months already dropped, so gaps are never filled or bridged. Serial correlation
// is handled the same way as trendStats: lag-1 correlation over adjacent observed months,
// nEff = n (1 − ρ) / (1 + ρ) with ρ < 0 treated as 0, and variances inflated by n / nEff.
import {
  binomialTest,
  chiSquareSf,
  fSf,
  mannKendall,
  mean,
  median,
  normalCdf,
  normalQuantile,
  olsSlope,
  senSlope,
  tCdf,
  tQuantile,
} from "../stats";
import type { Decomposition } from "./contracts";
import {
  analogSearch, arForecast, bocpd, gpSmooth, hmmRegimes, isolationForest, matrixProfile,
  type LabBand, type MlStats, type MlToolId,
} from "./ml";

export type { LabBand } from "./ml";

export type LabToolId =
  | "ols" | "mk" | "piecewise" | "permutation" | "bootstrap"
  | "mean" | "wilcoxon" | "compare" | "variance" | "normality" | "monthly"
  | "cusum" | "runs" | "extremes" | "pettitt"
  | "acf" | "spectrum"
  | MlToolId;

/** Toolbar groups, in display order. */
export const LAB_GROUPS: readonly { label: string; tools: readonly LabToolId[] }[] = [
  { label: "趨勢", tools: ["ols", "mk", "piecewise", "permutation", "bootstrap"] },
  { label: "平均與分布", tools: ["mean", "wilcoxon", "compare", "variance", "normality", "monthly"] },
  { label: "持續與極端", tools: ["cusum", "runs", "extremes", "pettitt"] },
  { label: "週期與記憶", tools: ["acf", "spectrum"] },
  { label: "機器學習", tools: ["analog", "hmm", "forecast", "discord", "iforest", "bocpd", "gp"] },
];

export const LAB_TOOLS: readonly LabToolId[] = LAB_GROUPS.flatMap((g) => g.tools);

/**
 * Minimum observed steps (months, weeks or days) each tool needs: the smallest sample its statistic is defined on, so a
 * range of a week or a single day still gets an answer where one exists. Small samples give wide intervals and large
 * p values; the result card shows n. For compare/variance this is the range; the rest needs 12.
 */
export const LAB_MIN_N: Record<LabToolId, number> = {
  ols: 3, mk: 3, piecewise: 5, permutation: 3, bootstrap: 3,
  mean: 2, wilcoxon: 2, compare: 2, variance: 3, normality: 4, monthly: 2,
  cusum: 1, runs: 2, extremes: 1, pettitt: 2,
  acf: 4, spectrum: 4,
  analog: 3, hmm: 6, forecast: 1, discord: 3, iforest: 1, bocpd: 3, gp: 4,
};

/** Tools whose answer is ≈ 0 by construction when the range is the baseline the trend was fitted on. */
export const BASELINE_SENSITIVE: ReadonlySet<LabToolId> = new Set(["ols", "mk", "mean", "wilcoxon", "bootstrap", "permutation"]);

export interface LabSample {
  /** inclusive month indices of the requested range */
  start: number;
  end: number;
  x: number[];
  y: number[];
  n: number;
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Observed (x, y) pairs of `values` within [start, end] (inclusive indices). */
export function labSample(values: readonly (number | null)[], start: number, end: number): LabSample {
  const x: number[] = [], y: number[] = [];
  const lo = Math.max(0, start), hi = Math.min(values.length - 1, end);
  for (let i = lo; i <= hi; i++) if (finite(values[i])) { x.push(i); y.push(values[i] as number); }
  return { start, end, x, y, n: x.length };
}

/** Observed values OUTSIDE [start, end]. */
export function restSample(values: readonly (number | null)[], start: number, end: number): LabSample {
  const x: number[] = [], y: number[] = [];
  values.forEach((v, i) => { if ((i < start || i > end) && finite(v)) { x.push(i); y.push(v); } });
  return { start, end, x, y, n: x.length };
}

/* ------------------------------------------------------------------ serial correlation */

/** Autocorrelation at `lag` months using only pairs exactly `lag` calendar months apart. Null with < 3 pairs. */
export function lagCorrelation(x: readonly number[], e: readonly number[], lag: number): number | null {
  const n = e.length;
  if (n < 4) return null;
  const m = mean(e);
  let den = 0;
  for (const v of e) den += (v - m) ** 2;
  if (!(den > 0)) return null;
  const at = new Map<number, number>();
  x.forEach((xi, i) => at.set(xi, i));
  let num = 0, pairs = 0;
  for (let i = 0; i < n; i++) {
    const j = at.get(x[i] + lag);
    if (j === undefined) continue;
    num += (e[i] - m) * (e[j] - m);
    pairs++;
  }
  if (pairs < 3) return null;
  return (num / pairs) / (den / n);
}

/** Effective sample size from lag-1 correlation; negative ρ is treated as 0. */
export function effectiveN(n: number, rho: number | null): number {
  if (rho == null || !(rho > 0)) return n;
  const r = Math.min(rho, 0.99);
  return Math.min(n, Math.max(Math.min(n, 3), (n * (1 - r)) / (1 + r)));
}

const twoSidedT = (t: number, df: number) => Math.min(1, 2 * tCdf(-Math.abs(t), df));
const twoSidedZ = (z: number) => Math.min(1, 2 * normalCdf(-Math.abs(z)));

function sampleVariance(y: readonly number[]): number {
  const m = mean(y);
  let s = 0;
  for (const v of y) s += (v - m) ** 2;
  return s / (y.length - 1);
}

/** Average ranks (1-based) and tie-group sizes. */
function ranks(values: readonly number[]): { r: number[]; ties: number[] } {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(values.length);
  const ties: number[] = [];
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    if (j > i) ties.push(j - i + 1);
    i = j + 1;
  }
  return { r, ties };
}

/* ------------------------------------------------------------------ results */

/** A straight segment drawn on the residual chart between the centres of months x0 and x1 (indices into d.months). */
export interface LabSegment { x0: number; y0: number; x1: number; y1: number; dashed?: boolean }

export interface OlsResult {
  tool: "ols";
  n: number;
  /** per month */
  slope: number;
  intercept: number;
  r2: number;
  lag1: number | null;
  nEff: number;
  /** naive OLS (independent errors) */
  naive: { se: number; t: number; df: number; p: number };
  /** autocorrelation-corrected */
  se: number; t: number; df: number; p: number;
  ci95: [number, number];
}

export interface MkResult {
  tool: "mk";
  n: number;
  S: number;
  tau: number;
  z: number;
  /** naive two-sided p */
  pNaive: number;
  /** autocorrelation-corrected p */
  p: number;
  lag1: number | null;
  nEff: number;
  /** Sen slope per month and its corrected 95 % rank interval */
  sen: number;
  senIntercept: number;
  ci95: [number, number];
}

export interface MeanResult {
  tool: "mean";
  n: number;
  mean: number;
  sd: number;
  lag1: number | null;
  nEff: number;
  se: number; t: number; df: number; p: number;
  ci95: [number, number];
  /** Cohen's d = mean / sd */
  effect: number;
}

export interface WilcoxonResult {
  tool: "wilcoxon";
  /** non-zero values used */
  n: number;
  median: number;
  wPlus: number;
  z: number;
  p: number;
  lag1: number | null;
  nEff: number;
  /** share of months above zero */
  positiveShare: number;
}

export interface CompareResult {
  tool: "compare";
  a: { n: number; mean: number; median: number; sd: number; nEff: number };
  b: { n: number; mean: number; median: number; sd: number; nEff: number };
  /** mean(a) − mean(b) */
  diff: number;
  welch: { se: number; t: number; df: number; p: number; ci95: [number, number] };
  mannWhitney: { U: number; z: number; p: number; /** P(a > b) + ½ P(a = b) */ probSuperiority: number };
}

export interface PettittResult {
  tool: "pettitt";
  n: number;
  K: number;
  p: number;
  /** month index of the LAST month before the shift */
  splitAt: number;
  meanBefore: number;
  meanAfter: number;
  nBefore: number;
  nAfter: number;
}

export interface AcfResult {
  tool: "acf";
  n: number;
  /** r at lags 1..maxLag; null when too few pairs */
  acf: (number | null)[];
  /** ±1.96 / √n */
  band: number;
  ljungBox: { Q: number; df: number; p: number };
}

export interface HistBin { x0: number; x1: number; count: number }

export interface NormalityResult {
  tool: "normality";
  n: number;
  mean: number;
  sd: number;
  skew: number;
  /** excess kurtosis */
  kurtosis: number;
  jb: number;
  p: number;
  hist: HistBin[];
}

export interface BootstrapResult {
  tool: "bootstrap";
  n: number;
  draws: number;
  block: number;
  mean: { est: number; ci95: [number, number]; p: number; hist: HistBin[] };
  /** per month */
  slope: { est: number; intercept: number; ci95: [number, number]; p: number; hist: HistBin[] };
}

export type LabStats =
  | OlsResult | MkResult | MeanResult | WilcoxonResult | CompareResult
  | PettittResult | AcfResult | NormalityResult | BootstrapResult
  | CusumResult | RunsResult | ExtremesResult | VarianceResult | SpectrumResult
  | MonthlyResult | PiecewiseResult | PermutationResult
  | MlStats;

export type LabOutcome =
  | { kind: "ok"; stats: LabStats; segments: LabSegment[]; bands?: LabBand[] }
  | { kind: "insufficient"; tool: LabToolId; n: number; need: number; what: string; note?: string };

/* ------------------------------------------------------------------ tools */

export function olsTest(s: LabSample): OlsResult {
  const fit = olsSlope(s.x, s.y);
  const e = s.y.map((v, i) => v - fit.intercept - fit.slope * s.x[i]);
  const lag1 = lagCorrelation(s.x, e, 1);
  const nEff = effectiveN(s.n, lag1);
  const naiveT = fit.slope / fit.se;
  const df = Math.max(1, nEff - 2);
  const se = fit.se * Math.sqrt(fit.df / df);
  const t = fit.slope / se;
  const q = tQuantile(0.975, df);
  return {
    tool: "ols", n: s.n, slope: fit.slope, intercept: fit.intercept, r2: fit.r2, lag1, nEff,
    naive: { se: fit.se, t: naiveT, df: fit.df, p: twoSidedT(naiveT, fit.df) },
    se, t, df, p: twoSidedT(t, df), ci95: [fit.slope - q * se, fit.slope + q * se],
  };
}

export function mkTest(s: LabSample): MkResult {
  const mk = mannKendall(s.y);
  const sen = senSlope(s.x, s.y);
  const e = s.y.map((v, i) => v - sen.intercept - sen.slope * s.x[i]);
  const lag1 = lagCorrelation(s.x, e, 1);
  const nEff = effectiveN(s.n, lag1);
  const inflation = s.n / nEff;
  const sd = Math.sqrt(mk.varS * inflation);
  const z = mk.S > 0 ? (mk.S - 1) / sd : mk.S < 0 ? (mk.S + 1) / sd : 0;
  // Inflating Var(S) by f widens the rank interval exactly like raising the z quantile by √f.
  const conf = 2 * normalCdf(normalQuantile(0.975) * Math.sqrt(inflation)) - 1;
  const ci = senSlope(s.x, s.y, Math.min(conf, 1 - 1e-12));
  return {
    tool: "mk", n: s.n, S: mk.S, tau: mk.tau, z, pNaive: mk.p, p: twoSidedZ(z), lag1, nEff,
    sen: sen.slope, senIntercept: sen.intercept, ci95: [ci.ciLow, ci.ciHigh],
  };
}

export function meanTest(s: LabSample): MeanResult {
  const m = mean(s.y);
  const sd = Math.sqrt(sampleVariance(s.y));
  const lag1 = lagCorrelation(s.x, s.y, 1);
  const nEff = effectiveN(s.n, lag1);
  const se = sd / Math.sqrt(nEff);
  const df = Math.max(1, nEff - 1);
  const t = m / se;
  const q = tQuantile(0.975, df);
  return { tool: "mean", n: s.n, mean: m, sd, lag1, nEff, se, t, df, p: twoSidedT(t, df), ci95: [m - q * se, m + q * se], effect: m / sd };
}

export function wilcoxonTest(s: LabSample): WilcoxonResult {
  const nz = s.y.filter((v) => v !== 0);
  const n = nz.length;
  const { r, ties } = ranks(nz.map(Math.abs));
  let wPlus = 0;
  nz.forEach((v, i) => { if (v > 0) wPlus += r[i]; });
  const lag1 = lagCorrelation(s.x, s.y, 1);
  const nEff = effectiveN(s.n, lag1);
  let variance = (n * (n + 1) * (2 * n + 1)) / 24;
  for (const t of ties) variance -= (t ** 3 - t) / 48;
  variance *= s.n / nEff;
  const d = wPlus - (n * (n + 1)) / 4;
  const z = variance > 0 ? (d - Math.sign(d) * 0.5) / Math.sqrt(variance) : 0;
  return {
    tool: "wilcoxon", n, median: median(s.y), wPlus, z, p: twoSidedZ(z), lag1, nEff,
    positiveShare: s.y.filter((v) => v > 0).length / s.n,
  };
}

function describe(s: LabSample) {
  const lag1 = lagCorrelation(s.x, s.y, 1);
  return { n: s.n, mean: mean(s.y), median: median(s.y), sd: Math.sqrt(sampleVariance(s.y)), nEff: effectiveN(s.n, lag1) };
}

/** Range (a) versus every other observed month (b): Welch t (autocorrelation-corrected) and Mann–Whitney U. */
export function compareTest(a: LabSample, b: LabSample): CompareResult {
  const A = describe(a), B = describe(b);
  const va = A.sd ** 2 / A.nEff, vb = B.sd ** 2 / B.nEff;
  const se = Math.sqrt(va + vb);
  const diff = A.mean - B.mean;
  const df = Math.max(1, (va + vb) ** 2 / (va ** 2 / Math.max(1, A.nEff - 1) + vb ** 2 / Math.max(1, B.nEff - 1)));
  const t = diff / se;
  const q = tQuantile(0.975, df);

  const all = [...a.y, ...b.y];
  const { r, ties } = ranks(all);
  const n1 = a.n, n2 = b.n, N = n1 + n2;
  let R1 = 0;
  for (let i = 0; i < n1; i++) R1 += r[i];
  const U = R1 - (n1 * (n1 + 1)) / 2;
  const tieSum = ties.reduce((acc, t) => acc + t ** 3 - t, 0);
  const varU = ((n1 * n2) / 12) * (N + 1 - tieSum / (N * (N - 1)));
  const dU = U - (n1 * n2) / 2;
  const zU = varU > 0 ? (dU - Math.sign(dU) * 0.5) / Math.sqrt(varU) : 0;
  return {
    tool: "compare", a: A, b: B, diff,
    welch: { se, t, df, p: twoSidedT(t, df), ci95: [diff - q * se, diff + q * se] },
    mannWhitney: { U, z: zU, p: twoSidedZ(zU), probSuperiority: U / (n1 * n2) },
  };
}

/** Pettitt (1979) test for a single change point in the median, with its approximate p-value. */
export function pettittTest(s: LabSample): PettittResult {
  const { y, n } = s;
  let U = 0, K = 0, at = 0;
  for (let t = 0; t < n - 1; t++) {
    let v = 0;
    for (let j = 0; j < n; j++) v += Math.sign(y[t] - y[j]);
    U += v;
    if (Math.abs(U) > K) { K = Math.abs(U); at = t; }
  }
  const p = Math.min(1, 2 * Math.exp((-6 * K * K) / (n ** 3 + n ** 2)));
  const before = y.slice(0, at + 1), after = y.slice(at + 1);
  return {
    tool: "pettitt", n, K, p, splitAt: s.x[at],
    meanBefore: mean(before), meanAfter: mean(after), nBefore: before.length, nAfter: after.length,
  };
}

export function acfTest(s: LabSample, maxLag = 12): AcfResult {
  const h = Math.max(1, Math.min(maxLag, Math.floor(s.n / 4)));
  const acf: (number | null)[] = [];
  let Q = 0, used = 0;
  for (let k = 1; k <= maxLag; k++) {
    const r = k <= h ? lagCorrelation(s.x, s.y, k) : null;
    acf.push(r);
    if (r != null) { Q += (r * r) / (s.n - k); used++; }
  }
  Q *= s.n * (s.n + 2);
  return { tool: "acf", n: s.n, acf, band: 1.96 / Math.sqrt(s.n), ljungBox: { Q, df: used, p: used ? chiSquareSf(Q, used) : NaN } };
}

export function histogram(values: ArrayLike<number>, bins = 16): HistBin[] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return [];
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const w = (hi - lo) / bins;
  const out: HistBin[] = Array.from({ length: bins }, (_, k) => ({ x0: lo + k * w, x1: lo + (k + 1) * w, count: 0 }));
  for (let i = 0; i < values.length; i++) out[Math.min(bins - 1, Math.floor((values[i] - lo) / w))].count++;
  return out;
}

/** Skewness, excess kurtosis and the Jarque–Bera test (χ², 2 df ⇒ p = exp(−JB/2)). */
export function normalityTest(s: LabSample): NormalityResult {
  const n = s.n, m = mean(s.y);
  let m2 = 0, m3 = 0, m4 = 0;
  for (const v of s.y) { const d = v - m; m2 += d * d; m3 += d ** 3; m4 += d ** 4; }
  m2 /= n; m3 /= n; m4 /= n;
  const skew = m3 / m2 ** 1.5;
  const kurtosis = m4 / (m2 * m2) - 3;
  const jb = (n / 6) * (skew * skew + (kurtosis * kurtosis) / 4);
  return {
    tool: "normality", n, mean: m, sd: Math.sqrt(sampleVariance(s.y)), skew, kurtosis, jb,
    p: Math.exp(-jb / 2), hist: histogram(s.y, Math.max(8, Math.min(24, Math.round(Math.sqrt(n))))),
  };
}

/** Small deterministic PRNG so the same range always gives the same bootstrap. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: Float64Array, q: number): number {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Moving-block bootstrap (block ≈ n^⅓ months, which keeps short-range autocorrelation inside each
 * block) for the mean and for the OLS slope (residual blocks added back to the fitted line).
 * Percentile 95 % intervals; p is the share of null-centred draws at least as far from 0 as the estimate.
 */
export function bootstrapTest(s: LabSample, draws = 2000, seed = 1): BootstrapResult {
  const { x, y, n } = s;
  const block = Math.max(1, Math.min(n, Math.ceil(Math.cbrt(n))));
  const rand = mulberry32(seed ^ (n * 2654435761) ^ (x[0] ?? 0));
  const fit = olsSlope(x, y);
  const fitted = x.map((xi) => fit.intercept + fit.slope * xi);
  const e = y.map((v, i) => v - fitted[i]);
  const mx = mean(x);
  let sxx = 0;
  for (const xi of x) sxx += (xi - mx) ** 2;
  const m0 = mean(y);

  const means = new Float64Array(draws), slopes = new Float64Array(draws);
  const pick = new Int32Array(n);
  for (let b = 0; b < draws; b++) {
    for (let k = 0; k < n;) {
      const s0 = Math.floor(rand() * (n - block + 1));
      for (let j = 0; j < block && k < n; j++, k++) pick[k] = s0 + j;
    }
    let sum = 0, sxy = 0;
    for (let k = 0; k < n; k++) {
      sum += y[pick[k]];
      sxy += (x[k] - mx) * (fitted[k] + e[pick[k]]);
    }
    means[b] = sum / n;
    slopes[b] = sxx > 0 ? sxy / sxx : NaN;
  }
  const summarise = (d: Float64Array, est: number) => {
    const sorted = Float64Array.from(d).sort();
    let far = 0;
    for (const v of d) if (Math.abs(v - est) >= Math.abs(est)) far++;
    return { est, ci95: [percentile(sorted, 0.025), percentile(sorted, 0.975)] as [number, number], p: (far + 1) / (draws + 1), hist: histogram(d, 24) };
  };
  return {
    tool: "bootstrap", n, draws, block,
    mean: summarise(means, m0),
    slope: { ...summarise(slopes, fit.slope), intercept: fit.intercept },
  };
}

/* ------------------------------------------------------------------ one entry point */

const WHAT: Record<LabToolId, string> = {
  ols: "迴歸", mk: "Mann–Kendall", mean: "t 檢定", wilcoxon: "符號秩檢定", compare: "比較",
  pettitt: "轉折點檢定", acf: "自相關", normality: "常態性檢定", bootstrap: "拔靴法",
  piecewise: "分段迴歸", permutation: "置換檢定", variance: "變異比較", monthly: "逐月比較",
  cusum: "累積異常", runs: "連續性檢定", extremes: "極端月份計數", spectrum: "週期分析",
  analog: "相似期間搜尋", hmm: "狀態模型", forecast: "預測", discord: "罕見片段搜尋",
  iforest: "孤立森林", bocpd: "貝氏轉折偵測", gp: "高斯過程平滑",
};

/** Consecutive-month polyline as chart segments. */
function polyline(x0: number, ys: readonly number[], dashed = false): LabSegment[] {
  const out: LabSegment[] = [];
  for (let k = 1; k < ys.length; k++) out.push({ x0: x0 + k - 1, x1: x0 + k, y0: ys[k - 1], y1: ys[k], dashed });
  return out;
}

/** Runs of `path === state` as bands. */
function stateBands(start: number, path: readonly number[], state: number, tone: LabBand["tone"]): LabBand[] {
  const out: LabBand[] = [];
  for (let i = 0; i < path.length;) {
    let j = i;
    while (j + 1 < path.length && path[j + 1] === path[i]) j++;
    if (path[i] === state) out.push({ x0: start + i, x1: start + j, tone });
    i = j + 1;
  }
  return out;
}

function runMlTool(tool: MlToolId, d: Decomposition, start: number, end: number, short: (n: number, note?: string) => LabOutcome): LabOutcome {
  const v = d.residual;
  const x0 = Math.max(0, start), x1 = Math.min(v.length - 1, end);
  switch (tool) {
    case "analog": {
      const r = analogSearch(v, x0, x1);
      if (!r.matches.length) return short(x1 - x0 + 1, "整段資料裡找不到不重疊、資料夠完整的候選期間；請選短一點的範圍。");
      return { kind: "ok", stats: r, segments: [], bands: r.matches.map((m, k) => ({ x0: m.start, x1: m.start + r.length - 1, tone: "focus", label: String(k + 1) })) };
    }
    case "hmm": {
      const r = hmmRegimes(v, x0, x1);
      return { kind: "ok", stats: r, segments: [], bands: [...stateBands(x0, r.path, 0, "cool"), ...stateBands(x0, r.path, r.K - 1, "warm")] };
    }
    case "forecast": {
      const r = arForecast(v, x0, x1);
      if (!r) return short(0, "預測需要範圍開始前至少約 3 年連續的資料來訓練模型；請選較晚開始的範圍。");
      return { kind: "ok", stats: r, segments: [...polyline(x0, r.forecast), ...polyline(x0, r.lo, true), ...polyline(x0, r.hi, true)] };
    }
    case "discord": {
      const r = matrixProfile(v, x0, x1);
      const w = r.windows.find((q) => q.m === r.profileM) ?? r.windows[r.windows.length - 1];
      const bands: LabBand[] = [];
      if (w?.discord) bands.push({ x0: w.discord.start, x1: w.discord.start + w.m - 1, tone: "warm", label: "罕見" });
      if (w?.motif) for (const s of [w.motif.a, w.motif.b]) bands.push({ x0: s, x1: s + w.m - 1, tone: "ink", label: "重複" });
      return { kind: "ok", stats: r, segments: [], bands };
    }
    case "iforest": {
      const r = isolationForest(v, x0, x1);
      if (r.n < 36) return short(r.n, "孤立森林需要整段資料至少 36 個有完整前 6 個月的月份。");
      return { kind: "ok", stats: r, segments: [], bands: r.flagged.map((f) => ({ x0: f.x, x1: f.x, tone: f.value >= 0 ? "warm" : "cool" })) };
    }
    case "bocpd": {
      const r = bocpd(v, x0, x1);
      return { kind: "ok", stats: r, segments: r.segments.map((g) => ({ x0: g.x0, x1: g.x1, y0: g.mean, y1: g.mean })) };
    }
    case "gp": {
      const r = gpSmooth(v, x0, x1);
      if (!r) return short(0);
      return { kind: "ok", stats: r, segments: [...polyline(x0, r.mean), ...polyline(x0, r.lo, true), ...polyline(x0, r.hi, true)] };
    }
  }
}

const ML_TOOLS: ReadonlySet<LabToolId> = new Set<MlToolId>(["analog", "hmm", "forecast", "discord", "iforest", "bocpd", "gp"]);

/** Share of baseline months with |z| > 2 (the expected rate of extreme months). */
function baselineExtremeRate(d: Decomposition): number {
  const base = new Set(d.baseline.months);
  let hit = 0, total = 0;
  d.months.forEach((m, i) => {
    const z = d.z[i];
    if (!base.has(m) || !finite(z)) return;
    total++;
    if (Math.abs(z) > 2) hit++;
  });
  return total ? hit / total : 0;
}

/** Share of the baseline's observed months that fall inside [start, end]. */
export function baselineShare(d: Decomposition, start: number, end: number): number {
  const base = new Set(d.baseline.months);
  let inside = 0, total = 0;
  d.months.forEach((m, i) => {
    if (!base.has(m) || !finite(d.residual[i])) return;
    total++;
    if (i >= start && i <= end) inside++;
  });
  return total ? inside / total : 0;
}

/**
 * Run one tool on the residuals of `d` over months [start, end] (inclusive indices). The tools work in index steps,
 * so a day or week series (lib/detective/fine.ts) runs the same way; `opts.extremeRate` replaces the baseline's share
 * of |z| > 2 when the baseline is not part of `d` (earlier years).
 */
export function runLabTool(tool: LabToolId, d: Decomposition, start: number, end: number, opts: { extremeRate?: number } = {}): LabOutcome {
  const s = labSample(d.residual, start, end);
  const need = LAB_MIN_N[tool];
  const short = (n: number, note?: string): LabOutcome => ({ kind: "insufficient", tool, n, need, what: WHAT[tool], note });
  const x0 = Math.max(0, start), x1 = Math.min(d.months.length - 1, end);

  if (ML_TOOLS.has(tool)) {
    if (s.n < need) return short(s.n);
    return runMlTool(tool as MlToolId, d, start, end, short);
  }
  if (tool === "variance") {
    const rest = restSample(d.residual, start, end);
    if (s.n < need || rest.n < 12) return short(s.n);
    return { kind: "ok", stats: varianceTest(s, rest), segments: [] };
  }
  if (tool === "compare") {
    const rest = restSample(d.residual, start, end);
    if (s.n < need || rest.n < 12) return short(s.n);
    const r = compareTest(s, rest);
    return { kind: "ok", stats: r, segments: [
      { x0, x1, y0: r.a.mean, y1: r.a.mean },
      { x0: 0, x1: d.months.length - 1, y0: r.b.mean, y1: r.b.mean, dashed: true },
    ] };
  }
  if (s.n < need) return short(s.n);

  switch (tool) {
    case "ols": {
      const r = olsTest(s);
      return { kind: "ok", stats: r, segments: [{ x0, x1, y0: r.intercept + r.slope * x0, y1: r.intercept + r.slope * x1 }] };
    }
    case "mk": {
      const r = mkTest(s);
      return { kind: "ok", stats: r, segments: [{ x0, x1, y0: r.senIntercept + r.sen * x0, y1: r.senIntercept + r.sen * x1 }] };
    }
    case "mean": {
      const r = meanTest(s);
      return { kind: "ok", stats: r, segments: [{ x0, x1, y0: r.mean, y1: r.mean }] };
    }
    case "wilcoxon": {
      const r = wilcoxonTest(s);
      return { kind: "ok", stats: r, segments: [{ x0, x1, y0: r.median, y1: r.median }] };
    }
    case "pettitt": {
      const r = pettittTest(s);
      return { kind: "ok", stats: r, segments: [
        { x0, x1: r.splitAt, y0: r.meanBefore, y1: r.meanBefore },
        { x0: r.splitAt + 1, x1, y0: r.meanAfter, y1: r.meanAfter },
      ] };
    }
    case "acf": return { kind: "ok", stats: acfTest(s), segments: [] };
    case "spectrum": return { kind: "ok", stats: spectrumTest(s), segments: [] };
    case "monthly": {
      // Kruskal–Wallis needs at least two calendar months in the range
      const r = monthlyTest(s, d.months);
      return r.df < 1 ? short(s.n) : { kind: "ok", stats: r, segments: [] };
    }
    case "cusum": return { kind: "ok", stats: cusumTest(s), segments: [] };
    case "extremes": return { kind: "ok", stats: extremesTest(labSample(d.z, start, end), opts.extremeRate ?? baselineExtremeRate(d)), segments: [] };
    case "runs": {
      const all = labSample(d.residual, 0, d.months.length - 1);
      const r = runsTest(s, lagCorrelation(all.x, all.y, 1));
      return { kind: "ok", stats: r, segments: [{ x0: r.longest.from, x1: r.longest.to, y0: r.longest.mean, y1: r.longest.mean }] };
    }
    case "piecewise": {
      const r = piecewiseTest(s);
      if (!r) return short(s.n);
      const at = (t: number) => r.intercept + r.slopeBefore * t + (r.slopeAfter - r.slopeBefore) * Math.max(0, t - r.breakAt);
      return { kind: "ok", stats: r, segments: [
        { x0, x1: r.breakAt, y0: at(x0), y1: at(r.breakAt) },
        { x0: r.breakAt, x1, y0: at(r.breakAt), y1: at(x1) },
      ] };
    }
    case "permutation": {
      const r = permutationTest(s);
      return { kind: "ok", stats: r, segments: [{ x0, x1, y0: r.intercept + r.slope * x0, y1: r.intercept + r.slope * x1 }] };
    }
    case "normality": return { kind: "ok", stats: normalityTest(s), segments: [] };
    case "bootstrap": {
      const r = bootstrapTest(s);
      return { kind: "ok", stats: r, segments: [{ x0, x1, y0: r.slope.intercept + r.slope.est * x0, y1: r.slope.intercept + r.slope.est * x1 }] };
    }
    default: return short(s.n);
  }
}

/* ================================================================== more tools */

/** Gaussian draws from a seeded uniform PRNG (Box–Muller). */
function gaussian(rand: () => number) {
  return () => {
    const u = Math.max(rand(), 1e-12), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

export interface CusumResult {
  tool: "cusum";
  n: number;
  /** running sum at each observed month (missing months add nothing) */
  points: { x: number; c: number }[];
  total: number;
  /** largest peak-to-trough fall of the running sum (a deficit), months inclusive */
  deficit: { from: number; to: number; amount: number } | null;
  /** largest trough-to-peak rise (a surplus) */
  surplus: { from: number; to: number; amount: number } | null;
}

/** Cumulative anomaly: the running total of the residuals, and its largest sustained fall and rise. */
export function cusumTest(s: LabSample): CusumResult {
  const points: { x: number; c: number }[] = [];
  let c = 0;
  s.y.forEach((v, i) => { c += v; points.push({ x: s.x[i], c }); });
  const swing = (sign: 1 | -1) => {
    // best (sign * (c_peak - c_trough)) with peak before trough; start from 0 before the first month
    let best: { from: number; to: number; amount: number } | null = null;
    let refC = 0, refX = s.x[0] ?? 0;
    for (const p of points) {
      const amount = sign * (refC - p.c);
      if (amount > 0 && (!best || amount > best.amount)) best = { from: refX, to: p.x, amount };
      if (sign * p.c > sign * refC) { refC = p.c; refX = p.x + 1; }
    }
    return best;
  };
  return { tool: "cusum", n: s.n, points, total: c, deficit: swing(1), surplus: swing(-1) };
}

export interface RunsResult {
  tool: "runs";
  n: number;
  nPos: number;
  nNeg: number;
  runs: number;
  expectedRuns: number;
  /** Wald–Wolfowitz runs test (assumes independent months) */
  z: number;
  p: number;
  /** longest streak of consecutive observed months with the same sign */
  longest: { sign: 1 | -1; from: number; to: number; length: number; mean: number };
  /** chance of a same-sign streak at least this long: independent months, and with the record's own persistence */
  pIndependent: number;
  pPersistent: number;
  /** lag-1 correlation of the full residual record used for pPersistent */
  rho: number;
}

function longestRun(signs: Float64Array | number[], target: number): number {
  let best = 0, run = 0;
  for (const v of signs) { run = Math.sign(v) === target ? run + 1 : 0; if (run > best) best = run; }
  return best;
}

/** Runs test on the signs, plus a simulation of how long the longest same-sign streak would be by chance. */
export function runsTest(s: LabSample, rhoFull: number | null, draws = 2000): RunsResult {
  const nz = s.y.map((v, i) => ({ v, x: s.x[i] })).filter((p) => p.v !== 0);
  const nPos = nz.filter((p) => p.v > 0).length, nNeg = nz.length - nPos, n = nz.length;
  let runs = n ? 1 : 0;
  for (let i = 1; i < n; i++) if (Math.sign(nz[i].v) !== Math.sign(nz[i - 1].v)) runs++;
  const mu = (2 * nPos * nNeg) / n + 1;
  const variance = (2 * nPos * nNeg * (2 * nPos * nNeg - n)) / (n * n * (n - 1));
  const z = variance > 0 ? (runs - mu) / Math.sqrt(variance) : 0;

  let longest = { sign: 1 as 1 | -1, from: s.x[0], to: s.x[0], length: 0, mean: 0 };
  for (let i = 0; i < s.n;) {
    const sg = Math.sign(s.y[i]);
    let j = i;
    while (j + 1 < s.n && s.x[j + 1] === s.x[j] + 1 && Math.sign(s.y[j + 1]) === sg && sg !== 0) j++;
    const len = j - i + 1;
    if (sg !== 0 && len > longest.length) {
      longest = { sign: sg as 1 | -1, from: s.x[i], to: s.x[j], length: len, mean: mean(s.y.slice(i, j + 1)) };
    }
    i = j + 1;
  }

  const rho = Math.max(0, Math.min(0.99, rhoFull ?? 0));
  const simulate = (r: number, seed: number) => {
    const g = gaussian(mulberry32(seed));
    const series = new Float64Array(s.n);
    let hits = 0;
    const innov = Math.sqrt(1 - r * r);
    for (let b = 0; b < draws; b++) {
      let v = g();
      for (let k = 0; k < s.n; k++) { v = k ? r * v + innov * g() : v; series[k] = v; }
      if (longestRun(series, longest.sign) >= longest.length) hits++;
    }
    return (hits + 1) / (draws + 1);
  };
  return {
    tool: "runs", n, nPos, nNeg, runs, expectedRuns: mu, z, p: twoSidedZ(z), longest,
    pIndependent: simulate(0, 11 + s.n), pPersistent: simulate(rho, 29 + s.n), rho,
  };
}

export interface ExtremesResult {
  tool: "extremes";
  n: number;
  high: number;
  low: number;
  count: number;
  /** share of baseline months with |z| > 2, the expected rate */
  rate: number;
  expected: number;
  p: number;
  pUpper: number;
  /** month indices of the extreme months */
  months: number[];
}

/** How many months in the range have |z| > 2, against the baseline's own rate (exact binomial test). */
export function extremesTest(z: LabSample, rate: number): ExtremesResult {
  const months: number[] = [];
  let high = 0, low = 0;
  z.y.forEach((v, i) => { if (v > 2) { high++; months.push(z.x[i]); } else if (v < -2) { low++; months.push(z.x[i]); } });
  const count = high + low;
  const r = rate > 0 ? rate : 0.0455;
  const b = binomialTest(count, z.n, r);
  return { tool: "extremes", n: z.n, high, low, count, rate: r, expected: z.n * r, p: b.pTwoSided, pUpper: b.pUpper, months };
}

export interface VarianceResult {
  tool: "variance";
  a: { n: number; sd: number };
  b: { n: number; sd: number };
  /** sd(a) / sd(b) */
  ratio: number;
  /** Brown–Forsythe: Welch t on absolute deviations from each group's median (autocorrelation-corrected) */
  t: number;
  df: number;
  p: number;
}

/** Is the range more (or less) variable than the rest of the record? Brown–Forsythe test. */
export function varianceTest(a: LabSample, b: LabSample): VarianceResult {
  const dev = (s: LabSample): LabSample => { const m = median(s.y); return { ...s, y: s.y.map((v) => Math.abs(v - m)) }; };
  const w = compareTest(dev(a), dev(b)).welch;
  const sa = Math.sqrt(sampleVariance(a.y)), sb = Math.sqrt(sampleVariance(b.y));
  return { tool: "variance", a: { n: a.n, sd: sa }, b: { n: b.n, sd: sb }, ratio: sa / sb, t: w.t, df: w.df, p: w.p };
}

export interface SpectrumPeak { period: number; power: number; threshold: number; significant: boolean }

export interface SpectrumResult {
  tool: "spectrum";
  n: number;
  /** ascending frequency, cycles per month */
  freq: number[];
  /** Lomb–Scargle power normalised by the variance (mean ≈ 1 for white noise) */
  power: number[];
  /** 95 % red-noise (AR(1)) threshold at each frequency */
  threshold: number[];
  rho: number;
  /** up to 3 highest local peaks (by power), period in months */
  peaks: SpectrumPeak[];
}

/**
 * Lomb–Scargle periodogram (handles missing months), with a 95 % AR(1) red-noise background:
 * P_red(f) = (1 − ρ²) / (1 + ρ² − 2ρ cos 2πf), which has unit mean over [0, ½], times χ²₂(0.95)/2.
 */
export function spectrumTest(s: LabSample): SpectrumResult {
  const { x, y, n } = s;
  const m = mean(y);
  const variance = sampleVariance(y);
  const yc = y.map((v) => v - m);
  const span = x[n - 1] - x[0] + 1;
  const rho = Math.max(0, Math.min(0.99, lagCorrelation(x, y, 1) ?? 0));
  const q95 = 2.995732273553991; // −ln(0.05) = χ²₂(0.95) / 2
  const freq: number[] = [], power: number[] = [], threshold: number[] = [];
  const steps = Math.max(32, Math.floor(4 * span));
  for (let k = 1; k <= steps; k++) {
    const f = Math.max(1 / span, (0.5 * k) / steps);
    if (freq.length && f <= freq[freq.length - 1]) continue;
    const w = 2 * Math.PI * f;
    let s2 = 0, c2 = 0;
    for (const t of x) { s2 += Math.sin(2 * w * t); c2 += Math.cos(2 * w * t); }
    const tau = Math.atan2(s2, c2) / (2 * w);
    let yc_c = 0, yc_s = 0, cc = 0, ss = 0;
    for (let i = 0; i < n; i++) {
      const a = w * (x[i] - tau), c = Math.cos(a), sn = Math.sin(a);
      yc_c += yc[i] * c; yc_s += yc[i] * sn; cc += c * c; ss += sn * sn;
    }
    freq.push(f);
    power.push(((cc > 0 ? yc_c * yc_c / cc : 0) + (ss > 0 ? yc_s * yc_s / ss : 0)) / (2 * variance));
    threshold.push(((1 - rho * rho) / (1 + rho * rho - 2 * rho * Math.cos(2 * Math.PI * f))) * q95);
  }
  const peaks: SpectrumPeak[] = [];
  for (let i = 0; i < freq.length; i++) {
    const left = i === 0 ? -Infinity : power[i - 1], right = i === freq.length - 1 ? -Infinity : power[i + 1];
    if (power[i] >= left && power[i] >= right) peaks.push({ period: 1 / freq[i], power: power[i], threshold: threshold[i], significant: power[i] > threshold[i] });
  }
  peaks.sort((p, q) => q.power - p.power);
  return { tool: "spectrum", n, freq, power, threshold, rho, peaks: peaks.slice(0, 3) };
}

export interface MonthlyResult {
  tool: "monthly";
  n: number;
  /** January first */
  byMonth: { n: number; mean: number; values: number[] }[];
  /** Kruskal–Wallis test that the calendar months differ */
  H: number;
  df: number;
  p: number;
}

/** Residuals grouped by calendar month, with a Kruskal–Wallis test across months. */
export function monthlyTest(s: LabSample, months: readonly string[]): MonthlyResult {
  const byMonth = Array.from({ length: 12 }, () => ({ n: 0, mean: NaN, values: [] as number[] }));
  s.x.forEach((xi, i) => byMonth[Number(months[xi].slice(5, 7)) - 1].values.push(s.y[i]));
  byMonth.forEach((g) => { g.n = g.values.length; g.mean = g.n ? mean(g.values) : NaN; });
  const used = byMonth.filter((g) => g.n > 0);
  const all = used.flatMap((g) => g.values);
  const N = all.length;
  const { r, ties } = ranks(all);
  let H = 0, k = 0;
  for (const g of used) { let R = 0; for (let j = 0; j < g.n; j++) R += r[k++]; H += (R * R) / g.n; }
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
  const tieFix = 1 - ties.reduce((acc, t) => acc + t ** 3 - t, 0) / (N ** 3 - N);
  if (tieFix > 0) H /= tieFix;
  const df = used.length - 1;
  return { tool: "monthly", n: s.n, byMonth, H, df, p: df > 0 ? chiSquareSf(H, df) : NaN };
}

export interface PiecewiseResult {
  tool: "piecewise";
  n: number;
  /** month index of the breakpoint (the hinge) */
  breakAt: number;
  /** per month */
  slopeBefore: number;
  slopeAfter: number;
  intercept: number;
  r2Line: number;
  r2Piecewise: number;
  /** F test of the hinge against one straight line, autocorrelation-scaled */
  F: number;
  df2: number;
  p: number;
  nEff: number;
}

function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** Continuous two-segment ("hinge") regression with the breakpoint chosen by least squares. */
export function piecewiseTest(s: LabSample): PiecewiseResult | null {
  const { x, y, n } = s;
  const line = olsSlope(x, y);
  let syy = 0;
  const my = mean(y);
  for (const v of y) syy += (v - my) ** 2;
  const sse1 = (1 - line.r2) * syy;
  // at least 2 points either side of the hinge; 6 once the range is long enough (≥ 25), as before
  const edge = Math.max(2, Math.min(6, Math.floor((n - 1) / 4)), Math.floor(0.1 * n));
  let best: { k: number; coef: number[]; sse: number } | null = null;
  for (let i = edge; i < n - edge; i++) {
    const k = x[i];
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bb = [0, 0, 0];
    for (let j = 0; j < n; j++) {
      const row = [1, x[j], Math.max(0, x[j] - k)];
      for (let a = 0; a < 3; a++) { bb[a] += row[a] * y[j]; for (let c = 0; c < 3; c++) A[a][c] += row[a] * row[c]; }
    }
    const coef = solve3(A, bb);
    if (!coef) continue;
    let sse = 0;
    for (let j = 0; j < n; j++) sse += (y[j] - coef[0] - coef[1] * x[j] - coef[2] * Math.max(0, x[j] - k)) ** 2;
    if (!best || sse < best.sse) best = { k, coef, sse };
  }
  if (!best) return null;
  const [a, b1, c] = best.coef;
  const e = y.map((v, j) => v - a - b1 * x[j] - c * Math.max(0, x[j] - best!.k));
  const nEff = effectiveN(n, lagCorrelation(x, e, 1));
  const F = ((sse1 - best.sse) / 2) / (best.sse / (n - 4));
  const df2 = Math.max(1, nEff - 4);
  const Fadj = F * (nEff / n);
  return {
    tool: "piecewise", n, breakAt: best.k, slopeBefore: b1, slopeAfter: b1 + c, intercept: a,
    r2Line: line.r2, r2Piecewise: syy > 0 ? 1 - best.sse / syy : NaN, F: Fadj, df2, p: fSf(Fadj, 2, df2), nEff,
  };
}

export interface PermutationResult {
  tool: "permutation";
  n: number;
  draws: number;
  block: number;
  /** per month */
  slope: number;
  intercept: number;
  /** p from shuffling single months (ignores persistence) */
  pNaive: number;
  /** p from shuffling blocks of consecutive months */
  p: number;
  hist: HistBin[];
}

/** Permutation test for the OLS slope: shuffle single months, and shuffle blocks of months. */
export function permutationTest(s: LabSample, draws = 2000): PermutationResult {
  const { x, y, n } = s;
  const fit = olsSlope(x, y);
  const mx = mean(x);
  let sxx = 0;
  for (const xi of x) sxx += (xi - mx) ** 2;
  const slopeOf = (v: ArrayLike<number>) => { let sxy = 0; for (let k = 0; k < n; k++) sxy += (x[k] - mx) * v[k]; return sxy / sxx; };
  const block = Math.max(2, Math.ceil(Math.cbrt(n)));
  const rand = mulberry32(97 ^ n ^ (x[0] ?? 0));
  const arr = Float64Array.from(y);
  let naiveHits = 0, blockHits = 0;
  const blockSlopes = new Float64Array(draws);
  const blocks: number[][] = [];
  for (let i = 0; i < n; i += block) blocks.push(y.slice(i, i + block));
  const order = blocks.map((_, i) => i);
  const out = new Float64Array(n);
  const obs = Math.abs(fit.slope) * (1 - 1e-12);
  for (let b = 0; b < draws; b++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    if (Math.abs(slopeOf(arr)) >= obs) naiveHits++;
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    let k = 0;
    for (const bi of order) for (const v of blocks[bi]) out[k++] = v;
    blockSlopes[b] = slopeOf(out);
    if (Math.abs(blockSlopes[b]) >= obs) blockHits++;
  }
  return {
    tool: "permutation", n, draws, block, slope: fit.slope, intercept: fit.intercept,
    pNaive: (naiveHits + 1) / (draws + 1), p: (blockHits + 1) / (draws + 1), hist: histogram(blockSlopes, 24),
  };
}

/** The single p-value a tool reports, for the multiple-testing log. Null for descriptive tools. */
export function primaryP(s: LabStats): number | null {
  switch (s.tool) {
    case "ols": case "mk": case "mean": case "wilcoxon": case "pettitt": case "normality":
    case "extremes": case "variance": case "monthly": case "piecewise": case "permutation":
      return s.p;
    case "compare": return s.welch.p;
    case "acf": return s.ljungBox.p;
    case "bootstrap": return s.slope.p;
    case "runs": return s.pPersistent;
    case "forecast": return s.pValue;
    case "cusum": case "spectrum": case "analog": case "hmm": case "discord": case "iforest": case "bocpd": case "gp":
      return null;
  }
}

/** Holm step-down: which of the p-values stay significant at `alpha` after correcting for their number. */
export function holm(ps: readonly number[], alpha = 0.05): boolean[] {
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const keep = new Array<boolean>(ps.length).fill(false);
  for (let r = 0; r < order.length; r++) {
    if (!(order[r][0] <= alpha / (order.length - r))) break;
    keep[order[r][1]] = true;
  }
  return keep;
}
