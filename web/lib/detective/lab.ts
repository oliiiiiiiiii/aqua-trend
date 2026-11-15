// Analysis "lab": single-variable tests run on the processed residual series
// (raw − seasonal cycle − long-term trend) over a chosen range of months.
//
// Every function takes x = month index (into Decomposition.months) and y = residual, with
// missing months already dropped, so gaps are never filled or bridged. Serial correlation
// is handled the same way as trendStats: lag-1 correlation over adjacent observed months,
// nEff = n (1 − ρ) / (1 + ρ) with ρ < 0 treated as 0, and variances inflated by n / nEff.
import {
  chiSquareSf,
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

export type LabToolId = "ols" | "mk" | "mean" | "wilcoxon" | "compare" | "pettitt" | "acf" | "normality" | "bootstrap";

export const LAB_TOOLS: readonly LabToolId[] = ["ols", "mk", "mean", "wilcoxon", "compare", "pettitt", "acf", "normality", "bootstrap"];

/** Minimum observed months each tool needs. */
export const LAB_MIN_N: Record<LabToolId, number> = {
  ols: 10, mk: 10, mean: 3, wilcoxon: 10, compare: 3, pettitt: 10, acf: 24, normality: 20, bootstrap: 12,
};

/** Tools whose answer is ≈ 0 by construction when the range is the baseline the trend was fitted on. */
export const BASELINE_SENSITIVE: ReadonlySet<LabToolId> = new Set(["ols", "mk", "mean", "wilcoxon", "bootstrap"]);

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
  | PettittResult | AcfResult | NormalityResult | BootstrapResult;

export type LabOutcome =
  | { kind: "ok"; stats: LabStats; segments: LabSegment[] }
  | { kind: "insufficient"; tool: LabToolId; n: number; need: number; what: string };

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
};

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

/** Run one tool on the residuals of `d` over months [start, end] (inclusive indices). */
export function runLabTool(tool: LabToolId, d: Decomposition, start: number, end: number): LabOutcome {
  const s = labSample(d.residual, start, end);
  const need = LAB_MIN_N[tool];
  const short = (n: number): LabOutcome => ({ kind: "insufficient", tool, n, need, what: WHAT[tool] });
  const x0 = Math.max(0, start), x1 = Math.min(d.months.length - 1, end);

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
    case "normality": return { kind: "ok", stats: normalityTest(s), segments: [] };
    case "bootstrap": {
      const r = bootstrapTest(s);
      return { kind: "ok", stats: r, segments: [{ x0, x1, y0: r.slope.intercept + r.slope.est * x0, y1: r.slope.intercept + r.slope.est * x1 }] };
    }
  }
}
