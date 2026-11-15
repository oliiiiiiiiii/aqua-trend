// Classical (non-LLM) machine learning for one residual series. Everything is unsupervised,
// fitted on the series itself, deterministic (seeded where random), and small enough to run
// in the browser: about 300 monthly values is too little for anything bigger.
//
//   analog     nearest-neighbour search for past windows that look like the range (+ DTW)
//   hmm        Gaussian hidden Markov model regimes (2 or 3 states, chosen by BIC)
//   forecast   AR(p) fitted before the range, forecast across it with prediction intervals
//   discord    matrix profile: most unusual and most repeated windows
//   iforest    Isolation Forest on simple monthly features
//   bocpd      Bayesian online change-point detection (Adams & MacKay 2007)
//   gp         Gaussian-process smoothing with marginal-likelihood hyperparameters
import { mean, normalCdf } from "../stats";

export type MlToolId = "analog" | "hmm" | "forecast" | "discord" | "iforest" | "bocpd" | "gp";

/** A shaded span of months on the residual chart (inclusive month indices). */
export interface LabBand { x0: number; x1: number; tone: "cool" | "warm" | "focus" | "ink"; label?: string }

type Series = readonly (number | null)[];
const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sd(values: readonly number[]): number {
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) ** 2;
  return Math.sqrt(s / Math.max(1, values.length - 1));
}

/** Solve A x = b by Gaussian elimination with partial pivoting (A is small and square). */
function solve(Ain: number[][], bin: number[]): number[] | null {
  const n = bin.length;
  const A = Ain.map((r, i) => [...r, bin[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f) for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((r, i) => r[n] / r[i]);
}

/* ================================================================== analogues */

export interface AnalogMatch {
  start: number;
  /** root-mean-square difference to the query, residual units (for DTW: the warped RMS) */
  distance: number;
  /** Pearson correlation of the shapes; null when < 4 pairs */
  corr: number | null;
  values: (number | null)[];
  /** mean of the `horizon` months after the match; null when none observed */
  after: number | null;
}

export interface AnalogResult {
  tool: "analog";
  length: number;
  query: (number | null)[];
  matches: AnalogMatch[];
  /** best matches under dynamic time warping; empty when the query has missing months */
  dtw: AnalogMatch[];
  horizon: number;
  /** mean of the matches' `after`, a naive analogue forecast */
  analogAfter: number | null;
  /** what actually followed the query, if observed */
  actualAfter: number | null;
  /** the typical (median) distance of all candidate windows, for scale */
  typical: number;
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length < 4) return null;
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

function dtwRms(q: readonly number[], w: readonly number[], band: number): number {
  const L = q.length;
  const D = Array.from({ length: L + 1 }, () => new Float64Array(L + 1).fill(Infinity));
  const P = Array.from({ length: L + 1 }, () => new Int32Array(L + 1));
  D[0][0] = 0;
  for (let i = 1; i <= L; i++) {
    for (let j = Math.max(1, i - band); j <= Math.min(L, i + band); j++) {
      const cost = (q[i - 1] - w[j - 1]) ** 2;
      let best = D[i - 1][j - 1], len = P[i - 1][j - 1];
      if (D[i - 1][j] < best) { best = D[i - 1][j]; len = P[i - 1][j]; }
      if (D[i][j - 1] < best) { best = D[i][j - 1]; len = P[i][j - 1]; }
      D[i][j] = cost + best;
      P[i][j] = len + 1;
    }
  }
  return Math.sqrt(D[L][L] / P[L][L]);
}

/** Past windows whose anomalies most resemble months [start, end]. */
export function analogSearch(values: Series, start: number, end: number, top = 3): AnalogResult {
  const L = end - start + 1, N = values.length;
  const horizon = Math.min(L, 12);
  const query = values.slice(start, end + 1) as (number | null)[];
  const qFull = query.every(ok);
  const afterMean = (s: number) => {
    const v = values.slice(s + L, s + L + horizon).filter(ok);
    return v.length ? mean(v) : null;
  };
  const cands: AnalogMatch[] = [], dtwCands: AnalogMatch[] = [];
  const band = Math.max(1, Math.round(0.15 * L));
  for (let c = 0; c + L <= N; c++) {
    if (Math.abs(c - start) < L) continue;
    const a: number[] = [], b: number[] = [];
    for (let k = 0; k < L; k++) { const q = query[k], v = values[c + k]; if (ok(q) && ok(v)) { a.push(q); b.push(v); } }
    if (a.length < Math.max(3, Math.ceil(0.7 * L))) continue;
    let ss = 0;
    for (let k = 0; k < a.length; k++) ss += (a[k] - b[k]) ** 2;
    const win = values.slice(c, c + L) as (number | null)[];
    const m: AnalogMatch = { start: c, distance: Math.sqrt(ss / a.length), corr: pearson(a, b), values: win, after: afterMean(c) };
    cands.push(m);
    if (qFull && win.every(ok)) dtwCands.push({ ...m, distance: dtwRms(query as number[], win as number[], band) });
  }
  const pick = (list: AnalogMatch[]) => {
    const sorted = [...list].sort((p, q) => p.distance - q.distance);
    const out: AnalogMatch[] = [];
    for (const m of sorted) {
      if (out.every((o) => Math.abs(o.start - m.start) >= L)) out.push(m);
      if (out.length === top) break;
    }
    return out;
  };
  const matches = pick(cands);
  const afters = matches.map((m) => m.after).filter(ok);
  const dists = cands.map((c) => c.distance).sort((p, q) => p - q);
  return {
    tool: "analog", length: L, query, matches, dtw: pick(dtwCands), horizon,
    analogAfter: afters.length ? mean(afters) : null, actualAfter: afterMean(start),
    typical: dists.length ? dists[Math.floor(dists.length / 2)] : NaN,
  };
}

/* ================================================================== hidden Markov model */

export interface HmmState { mean: number; sd: number; share: number; expectedDuration: number }

export interface HmmResult {
  tool: "hmm";
  K: number;
  /** BIC of the 2- and 3-state fits (null when not fitted) */
  bic: { k2: number; k3: number | null };
  /** states sorted by mean, lowest first */
  states: HmmState[];
  transition: number[][];
  /** most likely state per month in [start, end] (Viterbi), indices into `states` */
  path: number[];
  /** posterior probability of the lowest and highest state per month */
  pLow: number[];
  pHigh: number[];
  /** longest Viterbi run in the lowest / highest state */
  longestLow: { from: number; to: number } | null;
  longestHigh: { from: number; to: number } | null;
  start: number;
}

interface HmmFit { means: number[]; sds: number[]; A: number[][]; pi: number[]; gamma: number[][]; logL: number }

function normPdf(x: number, m: number, s: number) {
  const z = (x - m) / s;
  return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI));
}

function fitHmm(o: Series, K: number): HmmFit {
  const T = o.length;
  const obs = o.filter(ok);
  const sorted = [...obs].sort((a, b) => a - b);
  const total = sd(obs) || 1;
  const floor = 0.05 * total;
  let means = Array.from({ length: K }, (_, k) => sorted[Math.floor(((k + 0.5) / K) * (sorted.length - 1))]);
  let sds = new Array(K).fill(total / Math.sqrt(K));
  let A = Array.from({ length: K }, (_, j) => Array.from({ length: K }, (_, k) => (j === k ? 0.9 : 0.1 / (K - 1))));
  let pi = new Array(K).fill(1 / K);
  let gamma: number[][] = [];
  let logL = -Infinity;
  const emit = (t: number, k: number) => (ok(o[t]) ? Math.max(1e-300, normPdf(o[t] as number, means[k], sds[k])) : 1);
  for (let iter = 0; iter < 200; iter++) {
    const alpha = Array.from({ length: T }, () => new Array(K).fill(0));
    const c = new Array(T).fill(0);
    for (let k = 0; k < K; k++) alpha[0][k] = pi[k] * emit(0, k);
    for (let t = 0; t < T; t++) {
      if (t > 0) for (let k = 0; k < K; k++) {
        let s = 0;
        for (let j = 0; j < K; j++) s += alpha[t - 1][j] * A[j][k];
        alpha[t][k] = s * emit(t, k);
      }
      c[t] = alpha[t].reduce((a, b) => a + b, 0) || 1e-300;
      for (let k = 0; k < K; k++) alpha[t][k] /= c[t];
    }
    const beta = Array.from({ length: T }, () => new Array(K).fill(1));
    for (let t = T - 2; t >= 0; t--) for (let j = 0; j < K; j++) {
      let s = 0;
      for (let k = 0; k < K; k++) s += A[j][k] * emit(t + 1, k) * beta[t + 1][k];
      beta[t][j] = s / c[t + 1];
    }
    gamma = alpha.map((a, t) => { const g = a.map((v, k) => v * beta[t][k]); const s = g.reduce((x, y) => x + y, 0) || 1; return g.map((v) => v / s); });
    const xi = Array.from({ length: K }, () => new Array(K).fill(0));
    for (let t = 0; t < T - 1; t++) for (let j = 0; j < K; j++) for (let k = 0; k < K; k++) {
      xi[j][k] += (alpha[t][j] * A[j][k] * emit(t + 1, k) * beta[t + 1][k]) / c[t + 1];
    }
    const newL = c.reduce((s, v) => s + Math.log(v), 0);
    pi = gamma[0].slice();
    A = xi.map((row) => { const s = row.reduce((a, b) => a + b, 0) || 1; return row.map((v) => v / s); });
    means = means.map((m, k) => {
      let w = 0, s = 0;
      for (let t = 0; t < T; t++) if (ok(o[t])) { w += gamma[t][k]; s += gamma[t][k] * (o[t] as number); }
      return w > 1e-9 ? s / w : m;
    });
    sds = sds.map((sv, k) => {
      let w = 0, s = 0;
      for (let t = 0; t < T; t++) if (ok(o[t])) { w += gamma[t][k]; s += gamma[t][k] * ((o[t] as number) - means[k]) ** 2; }
      return w > 1e-9 ? Math.max(floor, Math.sqrt(s / w)) : sv;
    });
    const done = Math.abs(newL - logL) < 1e-7 * Math.max(1, Math.abs(newL));
    logL = newL;
    if (done) break;
  }
  return { means, sds, A, pi, gamma, logL };
}

function viterbi(o: Series, f: HmmFit): number[] {
  const T = o.length, K = f.means.length;
  const lA = f.A.map((r) => r.map((v) => Math.log(Math.max(v, 1e-300))));
  const le = (t: number, k: number) => (ok(o[t]) ? Math.log(Math.max(1e-300, normPdf(o[t] as number, f.means[k], f.sds[k]))) : 0);
  let d = f.pi.map((p, k) => Math.log(Math.max(p, 1e-300)) + le(0, k));
  const back: number[][] = [];
  for (let t = 1; t < T; t++) {
    const nd: number[] = [], bk: number[] = [];
    for (let k = 0; k < K; k++) {
      let best = -Infinity, arg = 0;
      for (let j = 0; j < K; j++) { const v = d[j] + lA[j][k]; if (v > best) { best = v; arg = j; } }
      nd.push(best + le(t, k)); bk.push(arg);
    }
    d = nd; back.push(bk);
  }
  const path = new Array(T).fill(0);
  path[T - 1] = d.indexOf(Math.max(...d));
  for (let t = T - 1; t > 0; t--) path[t - 1] = back[t - 1][path[t]];
  return path;
}

/** Gaussian HMM regimes over months [start, end]; 2 vs 3 states chosen by BIC. */
export function hmmRegimes(values: Series, start: number, end: number): HmmResult {
  const o = values.slice(start, end + 1);
  const nObs = o.filter(ok).length;
  const bicOf = (f: HmmFit, K: number) => -2 * f.logL + (K - 1 + K * (K - 1) + 2 * K) * Math.log(nObs);
  const f2 = fitHmm(o, 2);
  const f3 = nObs >= 60 ? fitHmm(o, 3) : null;
  const b2 = bicOf(f2, 2), b3 = f3 ? bicOf(f3, 3) : null;
  const f = f3 && b3! < b2 ? f3 : f2;
  const K = f.means.length;
  const order = f.means.map((m, k) => [m, k] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const rank = new Array(K);
  order.forEach((k, r) => { rank[k] = r; });
  const raw = viterbi(o, f);
  const path = raw.map((k) => rank[k]);
  const states: HmmState[] = order.map((k, r) => ({
    mean: f.means[k], sd: f.sds[k],
    share: path.filter((s) => s === r).length / path.length,
    expectedDuration: 1 / Math.max(1e-9, 1 - f.A[k][k]),
  }));
  const transition = order.map((j) => order.map((k) => f.A[j][k]));
  const longest = (state: number) => {
    let best: { from: number; to: number } | null = null;
    for (let i = 0; i < path.length;) {
      let j = i;
      while (j + 1 < path.length && path[j + 1] === path[i]) j++;
      if (path[i] === state && (!best || j - i > best.to - best.from)) best = { from: start + i, to: start + j };
      i = j + 1;
    }
    return best;
  };
  return {
    tool: "hmm", K, bic: { k2: b2, k3: b3 }, states, transition, path,
    pLow: f.gamma.map((g) => g[order[0]]), pHigh: f.gamma.map((g) => g[order[K - 1]]),
    longestLow: longest(0), longestHigh: longest(K - 1), start,
  };
}

/* ================================================================== AR forecast */

export interface ForecastResult {
  tool: "forecast";
  p: number;
  coef: number[];
  intercept: number;
  sigma: number;
  trainN: number;
  start: number;
  forecast: number[];
  lo: number[];
  hi: number[];
  actual: (number | null)[];
  /** observed months outside the 95 % band */
  outside: number;
  observed: number;
  /** mean of (actual − forecast) over observed months, and its test against "no surprise" */
  meanError: number;
  z: number;
  pValue: number;
}

/** Fit AR(p), p = 1..6 by AIC, on months before `start`; forecast [start, end] with 95 % intervals. */
export function arForecast(values: Series, start: number, end: number): ForecastResult | null {
  const maxP = 6;
  const rowsFor = (p: number) => {
    const rows: number[] = [];
    for (let t = p; t < start; t++) {
      let all = ok(values[t]);
      for (let j = 1; j <= p && all; j++) all = ok(values[t - j]);
      if (all) rows.push(t);
    }
    return rows;
  };
  const fit = (p: number, rows: number[]) => {
    const X = rows.map((t) => [1, ...Array.from({ length: p }, (_, j) => values[t - j - 1] as number)]);
    const y = rows.map((t) => values[t] as number);
    const XtX = Array.from({ length: p + 1 }, (_, a) => Array.from({ length: p + 1 }, (_, b) => X.reduce((s, r) => s + r[a] * r[b], 0)));
    const Xty = Array.from({ length: p + 1 }, (_, a) => X.reduce((s, r, i) => s + r[a] * y[i], 0));
    const beta = solve(XtX, Xty);
    if (!beta) return null;
    const sse = X.reduce((s, r, i) => s + (y[i] - r.reduce((acc, v, k) => acc + v * beta[k], 0)) ** 2, 0);
    return { beta, sse, n: rows.length };
  };
  const common = rowsFor(maxP);
  if (common.length < 30) return null;
  let bestP = 1, bestAic = Infinity;
  for (let p = 1; p <= maxP; p++) {
    const f = fit(p, common);
    if (!f) continue;
    const aic = f.n * Math.log(f.sse / f.n) + 2 * (p + 1);
    if (aic < bestAic) { bestAic = aic; bestP = p; }
  }
  const rows = rowsFor(bestP);
  const f = fit(bestP, rows);
  if (!f) return null;
  const [c, ...phi] = f.beta;
  const sigma = Math.sqrt(f.sse / Math.max(1, f.n - bestP - 1));
  const phiSum = phi.reduce((a, b) => a + b, 0);
  const mu = Math.abs(1 - phiSum) > 0.05 ? c / (1 - phiSum) : mean(rows.map((t) => values[t] as number));
  const H = end - start + 1;
  const hist = (t: number) => (ok(values[t]) ? (values[t] as number) : mu);
  const fc: number[] = [];
  for (let h = 0; h < H; h++) {
    let v = c;
    for (let j = 1; j <= bestP; j++) { const t = start + h - j; v += phi[j - 1] * (t >= start ? fc[t - start] : t >= 0 ? hist(t) : mu); }
    fc.push(v);
  }
  const psi = [1];
  for (let k = 1; k < H; k++) { let s = 0; for (let j = 1; j <= Math.min(k, bestP); j++) s += phi[j - 1] * psi[k - j]; psi.push(s); }
  const lo: number[] = [], hi: number[] = [];
  let cum = 0;
  for (let h = 0; h < H; h++) { cum += psi[h] ** 2; const w = 1.959964 * sigma * Math.sqrt(cum); lo.push(fc[h] - w); hi.push(fc[h] + w); }
  const actual = values.slice(start, end + 1) as (number | null)[];
  const obsH = actual.map((v, h) => (ok(v) ? h : -1)).filter((h) => h >= 0);
  let S = 0, outside = 0;
  for (const h of obsH) { const e = (actual[h] as number) - fc[h]; S += e; if (actual[h]! < lo[h] || actual[h]! > hi[h]) outside++; }
  // Var(sum of errors) = σ² Σ_u (Σ_{h observed, h ≥ u} ψ_{h−u})²
  let V = 0;
  for (let u = 0; u < H; u++) { let s = 0; for (const h of obsH) if (h >= u) s += psi[h - u]; V += s * s; }
  V *= sigma * sigma;
  const z = V > 0 ? S / Math.sqrt(V) : 0;
  return {
    tool: "forecast", p: bestP, coef: phi, intercept: c, sigma, trainN: f.n, start,
    forecast: fc, lo, hi, actual, outside, observed: obsH.length,
    meanError: obsH.length ? S / obsH.length : NaN, z, pValue: Math.min(1, 2 * normalCdf(-Math.abs(z))),
  };
}

/* ================================================================== matrix profile */

export interface DiscordWindow { m: number; discord: { start: number; distance: number; neighbour: number } | null; motif: { a: number; b: number; distance: number } | null; typical: number }

export interface DiscordResult {
  tool: "discord";
  windows: DiscordWindow[];
  /** nearest-neighbour distance of each window start in the range, for the middle window length */
  profile: { x: number; d: number }[];
  profileM: number;
}

/** Matrix profile (plain Euclidean RMS, exclusion zone m): most unusual and most repeated windows. */
export function matrixProfile(values: Series, start: number, end: number): DiscordResult {
  const N = values.length;
  const valid = (s: number, m: number) => { for (let k = 0; k < m; k++) if (!ok(values[s + k])) return false; return true; };
  const dist = (a: number, b: number, m: number) => { let s = 0; for (let k = 0; k < m; k++) s += ((values[a + k] as number) - (values[b + k] as number)) ** 2; return Math.sqrt(s / m); };
  const L = end - start + 1;
  const ms = [3, 6, 12].filter((m) => L >= m);
  let profile: { x: number; d: number }[] = [], profileM = 0;
  const windows = ms.map((m) => {
    const all: number[] = [];
    for (let s = 0; s + m <= N; s++) if (valid(s, m)) all.push(s);
    const inRange = all.filter((s) => s >= start && s + m - 1 <= end);
    let discord: DiscordWindow["discord"] = null, motif: DiscordWindow["motif"] = null;
    const nnAll: number[] = [];
    const prof: { x: number; d: number }[] = [];
    for (const a of inRange) {
      let best = Infinity, arg = -1, bestIn = Infinity, argIn = -1;
      for (const b of all) {
        if (Math.abs(a - b) < m) continue;
        const d = dist(a, b, m);
        if (d < best) { best = d; arg = b; }
        if (b >= start && b + m - 1 <= end && d < bestIn) { bestIn = d; argIn = b; }
      }
      if (arg < 0) continue;
      nnAll.push(best);
      prof.push({ x: a, d: best });
      if (!discord || best > discord.distance) discord = { start: a, distance: best, neighbour: arg };
      if (argIn >= 0 && (!motif || bestIn < motif.distance)) motif = { a: Math.min(a, argIn), b: Math.max(a, argIn), distance: bestIn };
    }
    if (m === 6 || (!profile.length && m === ms[ms.length - 1])) { profile = prof; profileM = m; }
    const sorted = nnAll.sort((p, q) => p - q);
    return { m, discord, motif, typical: sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN };
  });
  return { tool: "discord", windows, profile, profileM };
}

/* ================================================================== isolation forest */

export interface IForestResult {
  tool: "iforest";
  trees: number;
  sample: number;
  /** anomaly score 0..1 per month in [start, end] (null when features are missing) */
  scores: (number | null)[];
  /** score above which a month is flagged: the record's 97th percentile */
  threshold: number;
  /** flagged months in the range, highest score first */
  flagged: { x: number; score: number; value: number; mean6: number }[];
  start: number;
  /** months in the whole record with features */
  n: number;
}

const FEATURES = 5;

function harmonicC(n: number) {
  return n > 2 ? 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n : n === 2 ? 1 : 0;
}

/** Isolation Forest (Liu et al. 2008) on [anomaly, 3-month mean, 6-month mean, 6-month sd, month-to-month change]. */
export function isolationForest(values: Series, start: number, end: number, trees = 200): IForestResult {
  const feats: { x: number; f: number[] }[] = [];
  for (let i = 5; i < values.length; i++) {
    const w = values.slice(i - 5, i + 1);
    if (!w.every(ok)) continue;
    const v = w as number[];
    const m6 = mean(v), m3 = mean(v.slice(3));
    feats.push({ x: i, f: [v[5], m3, m6, sd(v), v[5] - v[4]] });
  }
  const n = feats.length;
  const psi = Math.min(256, n);
  const limit = Math.ceil(Math.log2(Math.max(2, psi)));
  const rand = rng(4242 + n);
  type Node = { leaf: true; size: number } | { leaf: false; f: number; split: number; l: Node; r: Node };
  const build = (idx: number[], depth: number): Node => {
    if (depth >= limit || idx.length <= 1) return { leaf: true, size: idx.length };
    const f = Math.floor(rand() * FEATURES);
    let lo = Infinity, hi = -Infinity;
    for (const i of idx) { const v = feats[i].f[f]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!(hi > lo)) return { leaf: true, size: idx.length };
    const split = lo + rand() * (hi - lo);
    return { leaf: false, f, split, l: build(idx.filter((i) => feats[i].f[f] < split), depth + 1), r: build(idx.filter((i) => feats[i].f[f] >= split), depth + 1) };
  };
  const forest: Node[] = [];
  for (let t = 0; t < trees; t++) {
    const pool = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < psi; i++) { const j = i + Math.floor(rand() * (n - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    forest.push(build(pool.slice(0, psi), 0));
  }
  const pathLen = (node: Node, f: number[], depth: number): number =>
    node.leaf ? depth + harmonicC(node.size) : pathLen(f[node.f] < node.split ? node.l : node.r, f, depth + 1);
  const cPsi = harmonicC(psi) || 1;
  const scoreOf = new Map<number, number>();
  for (const { x, f } of feats) {
    let s = 0;
    for (const t of forest) s += pathLen(t, f, 0);
    scoreOf.set(x, Math.pow(2, -(s / trees) / cPsi));
  }
  const all = [...scoreOf.values()].sort((a, b) => a - b);
  const threshold = all.length ? all[Math.floor(0.97 * (all.length - 1))] : 1;
  const scores: (number | null)[] = [];
  const flagged: IForestResult["flagged"] = [];
  for (let i = start; i <= end; i++) {
    const s = scoreOf.get(i);
    scores.push(s ?? null);
    if (s != null && s >= threshold) {
      const f = feats.find((p) => p.x === i)!.f;
      flagged.push({ x: i, score: s, value: f[0], mean6: f[2] });
    }
  }
  flagged.sort((a, b) => b.score - a.score);
  return { tool: "iforest", trees, sample: psi, scores, threshold, flagged, start, n };
}

/* ================================================================== Bayesian online change points */

export interface BocpdResult {
  tool: "bocpd";
  /** expected run length between changes (months) */
  hazard: number;
  /** probability that a new regime began at each observed month (judged 3 months later) */
  prob: { x: number; p: number }[];
  /** detected changes: likeliest month, and the probability of a change within ±1 month of it */
  changes: { x: number; p: number }[];
  /** mean of each segment between changes, residual units */
  segments: { x0: number; x1: number; mean: number }[];
}

/** Adams & MacKay (2007) with a Normal–Gamma prior on standardised data and a constant hazard. */
export function bocpd(values: Series, start: number, end: number, hazard = 60): BocpdResult {
  const xs: number[] = [], ys: number[] = [];
  for (let i = start; i <= end; i++) if (ok(values[i])) { xs.push(i); ys.push(values[i] as number); }
  const n = ys.length;
  const m0 = mean(ys), s0 = sd(ys) || 1;
  const z = ys.map((v) => (v - m0) / s0);
  const H = 1 / hazard;
  const prior = { mu: 0, kappa: 1, alpha: 1, beta: 1 };
  type P = typeof prior;
  const update = (p: P, x: number): P => ({
    mu: (p.kappa * p.mu + x) / (p.kappa + 1), kappa: p.kappa + 1, alpha: p.alpha + 0.5,
    beta: p.beta + (p.kappa * (x - p.mu) ** 2) / (2 * (p.kappa + 1)),
  });
  const lgam = (x: number): number => {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (const k of c) ser += k / ++y;
    return -tmp + Math.log((2.5066282746310005 * ser) / x);
  };
  const pred = (p: P, x: number) => {
    const nu = 2 * p.alpha, scale2 = (p.beta * (p.kappa + 1)) / (p.alpha * p.kappa);
    const t = (x - p.mu) ** 2 / (nu * scale2);
    return Math.exp(lgam((nu + 1) / 2) - lgam(nu / 2) - 0.5 * Math.log(nu * Math.PI * scale2) - ((nu + 1) / 2) * Math.log(1 + t));
  };
  // R[t][k]: P(the current run holds the last k + 1 observations | x_0..x_t)
  const R: Float64Array[] = [];
  let params: P[] = [];
  let probs = new Float64Array(0);
  for (let t = 0; t < n; t++) {
    const x = z[t];
    if (t === 0) { probs = Float64Array.of(1); params = [update(prior, x)]; R.push(probs); continue; }
    const next = new Float64Array(t + 1);
    const pp = pred(prior, x);
    let cp = 0;
    for (let k = 0; k < probs.length; k++) { cp += probs[k] * H * pp; next[k + 1] = probs[k] * (1 - H) * pred(params[k], x); }
    next[0] = cp;
    let s = 0;
    for (const v of next) s += v;
    for (let k = 0; k < next.length; k++) next[k] /= s || 1;
    params = [update(prior, x), ...params.map((p) => update(p, x))];
    probs = next;
    R.push(next);
  }
  const lag = 3;
  const prob: { x: number; p: number }[] = [];
  for (let t = 1; t + lag < n; t++) prob.push({ x: xs[t], p: R[t + lag][lag] });
  // Timing is uncertain by a month or so: judge "a change within ±1 month" and report its likeliest month.
  const near = prob.map((q, i) => q.p + (prob[i - 1]?.p ?? 0) + (prob[i + 1]?.p ?? 0));
  const changes: { x: number; p: number }[] = [];
  for (let i = 0; i < prob.length; i++) {
    const p = Math.min(1, near[i]);
    if (p < 0.5) continue;
    if ((i > 0 && prob[i - 1].p > prob[i].p) || (i + 1 < prob.length && prob[i + 1].p >= prob[i].p)) continue;
    if (changes.length && prob[i].x - changes[changes.length - 1].x < 6) {
      if (p > changes[changes.length - 1].p) changes[changes.length - 1] = { x: prob[i].x, p };
      continue;
    }
    changes.push({ x: prob[i].x, p });
  }
  const cuts = [xs[0], ...changes.map((c) => c.x), (xs[n - 1] ?? start) + 1];
  const segments = cuts.slice(0, -1).map((a, i) => {
    const b = cuts[i + 1] - 1;
    const v = ys.filter((_, k) => xs[k] >= a && xs[k] <= b);
    return { x0: a, x1: b, mean: v.length ? mean(v) : NaN };
  });
  return { tool: "bocpd", hazard, prob, changes, segments };
}

/* ================================================================== Gaussian process */

export interface GpResult {
  tool: "gp";
  /** chosen RBF length scale in months, and the signal share of the variance */
  lengthScale: number;
  signalShare: number;
  logML: number;
  start: number;
  mean: number[];
  lo: number[];
  hi: number[];
  /** spans where the 95 % band excludes 0 (the smooth anomaly is clearly above or below normal) */
  spans: { x0: number; x1: number; sign: 1 | -1 }[];
  n: number;
}

function cholesky(K: Float64Array, n: number): Float64Array | null {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = K[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) { if (!(s > 0)) return null; L[i * n + i] = Math.sqrt(s); }
      else L[i * n + j] = s / L[j * n + j];
    }
  }
  return L;
}

function forwardSub(L: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}

function backSub(L: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}

/** GP regression with an RBF kernel; length scale and signal/noise split chosen by marginal likelihood on a grid. */
export function gpSmooth(values: Series, start: number, end: number): GpResult | null {
  const xs: number[] = [], raw: number[] = [];
  for (let i = start; i <= end; i++) if (ok(values[i])) { xs.push(i); raw.push(values[i] as number); }
  const n = xs.length;
  if (n < 4) return null;
  const m0 = mean(raw), s0 = sd(raw) || 1;
  const y = raw.map((v) => (v - m0) / s0);
  const span = xs[n - 1] - xs[0] + 1;
  // ≥ 6 months: shorter scales just re-trace month-to-month noise, which is what this tool is meant to remove.
  const scales = [6, 12, 24, 48].filter((l) => l <= span / 2);
  if (!scales.length) scales.push(Math.max(2, Math.round(span / 4)));
  let best: { l: number; rho: number; lml: number; L: Float64Array; alpha: Float64Array } | null = null;
  for (const l of scales) for (const rho of [0.2, 0.5, 0.8]) {
    const K = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      const v = rho * Math.exp(-((xs[i] - xs[j]) ** 2) / (2 * l * l)) + (i === j ? 1 - rho : 0);
      K[i * n + j] = v; K[j * n + i] = v;
    }
    const L = cholesky(K, n);
    if (!L) continue;
    const alpha = backSub(L, n, forwardSub(L, n, y));
    let fit = 0, logdet = 0;
    for (let i = 0; i < n; i++) { fit += y[i] * alpha[i]; logdet += Math.log(L[i * n + i]); }
    const lml = -0.5 * fit - logdet - 0.5 * n * Math.log(2 * Math.PI);
    if (!best || lml > best.lml) best = { l, rho, lml, L, alpha };
  }
  if (!best) return null;
  const { l, rho, L, alpha } = best;
  const meanOut: number[] = [], lo: number[] = [], hi: number[] = [];
  const kstar = new Float64Array(n);
  for (let x = start; x <= end; x++) {
    for (let i = 0; i < n; i++) kstar[i] = rho * Math.exp(-((x - xs[i]) ** 2) / (2 * l * l));
    let mu = 0;
    for (let i = 0; i < n; i++) mu += kstar[i] * alpha[i];
    const v = forwardSub(L, n, kstar);
    let vv = 0;
    for (let i = 0; i < n; i++) vv += v[i] * v[i];
    const sdv = Math.sqrt(Math.max(0, rho - vv));
    meanOut.push(m0 + s0 * mu);
    lo.push(m0 + s0 * (mu - 1.959964 * sdv));
    hi.push(m0 + s0 * (mu + 1.959964 * sdv));
  }
  const spans: GpResult["spans"] = [];
  for (let k = 0; k < meanOut.length;) {
    const sign = lo[k] > 0 ? 1 : hi[k] < 0 ? -1 : 0;
    let j = k;
    while (j + 1 < meanOut.length && (sign === 1 ? lo[j + 1] > 0 : sign === -1 ? hi[j + 1] < 0 : !(lo[j + 1] > 0 || hi[j + 1] < 0))) j++;
    if (sign) spans.push({ x0: start + k, x1: start + j, sign });
    k = j + 1;
  }
  return { tool: "gp", lengthScale: l, signalShare: rho, logML: best.lml, start, mean: meanOut, lo, hi, spans, n };
}

export type MlStats = AnalogResult | HmmResult | ForecastResult | DiscordResult | IForestResult | BocpdResult | GpResult;
