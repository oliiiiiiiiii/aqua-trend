// Day- and week-step analysis of the daily anomaly (the Days and Weeks windows of the workbench).
//
// The daily anomaly (daily/plan.ts: value − the monthly series' trend + seasonal cycle, read at each day) is turned
// into a series of points: one per day, or one per 7-day block ("week"). A selection of points is then compared with
// a baseline of the same kind of points:
//
//   window  the other loaded points around the selection (instant; "different from the surrounding days/weeks")
//   years   the same calendar days in earlier years, fetched on request ("unusual for this time of year")
//
// The statistics mirror intervalDetail.ts on months: the mean difference from the baseline's level with an AR(1) z
// test, an empirical test against every same-length window of the baseline, the rank among years (years only), and
// a verdict. Pure, no DOM: run under `npx tsx --test lib/detective/fine.test.ts`.
import { normalCdf } from "../stats";
import type { Decomposition } from "./contracts";
import type { Verdict } from "./intervalDetail";

export type FineStep = "day" | "week";

const DAY_MS = 86_400_000;
export const dayNum = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
export const dayStr = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

export interface DayRange { start: string; end: string }
/** Inclusive point indices of a FineSeries. */
export interface PointRange { a: number; b: number }

export interface FineSeries {
  step: FineStep;
  /** first and last day of each point, "YYYY-MM-DD" */
  start: string[];
  end: string[];
  /** mean of the observed days of the point; null when too few are observed */
  value: (number | null)[];
  /** mean of the point's daily normal (trend + seasonal cycle, at the daily product's level) */
  normal: (number | null)[];
  /** mean of the point's daily anomalies */
  anomaly: (number | null)[];
  /** days with an anomaly in each point */
  days: number[];
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** One point per day. */
export function dailySeries(dates: string[], value: (number | null)[], normal: (number | null)[], anomaly: (number | null)[]): FineSeries {
  return {
    step: "day", start: dates.slice(), end: dates.slice(),
    value: dates.map((_, i) => (finite(value[i]) ? value[i] : null)),
    normal: dates.map((_, i) => (finite(normal[i]) ? normal[i] : null)),
    anomaly: dates.map((_, i) => (finite(anomaly[i]) ? anomaly[i] : null)),
    days: dates.map((_, i) => (finite(anomaly[i]) ? 1 : 0)),
  };
}

/** A week needs this many observed days for a value (a mean of fewer would be mostly noise). */
export const WEEK_MIN_DAYS = 4;

/** Blocks of 7 days from the first day of `d` (a trailing block may be shorter); means of the observed days. */
export function weeklySeries(d: FineSeries): FineSeries {
  const out: FineSeries = { step: "week", start: [], end: [], value: [], normal: [], anomaly: [], days: [] };
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter(finite);
    return { n: v.length, m: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null };
  };
  for (let i = 0; i < d.start.length; i += 7) {
    const j = Math.min(d.start.length, i + 7);
    const v = mean(d.value.slice(i, j)), nrm = mean(d.normal.slice(i, j)), a = mean(d.anomaly.slice(i, j));
    out.start.push(d.start[i]);
    out.end.push(d.end[j - 1]);
    out.value.push(v.n >= WEEK_MIN_DAYS ? v.m : null);
    out.normal.push(nrm.m);
    out.anomaly.push(a.n >= WEEK_MIN_DAYS ? a.m : null);
    out.days.push(a.n);
  }
  return out;
}

/** The points that overlap a day range; null when none do. */
export function pointsOf(s: FineSeries, r: DayRange): PointRange | null {
  let a = -1, b = -1;
  s.start.forEach((st, i) => {
    if (s.end[i] >= r.start && st <= r.end) { if (a < 0) a = i; b = i; }
  });
  return a < 0 ? null : { a, b };
}

/** The days covered by points [a, b]. */
export const daysOfPoints = (s: FineSeries, p: PointRange): DayRange => ({ start: s.start[p.a], end: s.end[p.b] });

/* ------------------------------------------------------------------ earlier years */

/** The same calendar days `years` years earlier: same month and day (29 Feb becomes 28 Feb), same number of days. */
export function yearsBack(r: DayRange, years: number): DayRange {
  const y = Number(r.start.slice(0, 4)) - years;
  let md = r.start.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (md === "02-29" && !leap) md = "02-28";
  const start = `${String(y).padStart(4, "0")}-${md}`;
  return { start, end: dayStr(dayNum(start) + dayNum(r.end) - dayNum(r.start)) };
}

/** Margin around the selection fetched in earlier years: more same-length windows for the empirical test. */
export const BASELINE_MARGIN: Record<FineStep, number> = { day: 7, week: 14 };
export const BASELINE_YEAR_CHOICES = [5, 10, 20] as const;

/** Day spans of the baseline: the selection ± margin in each of `years` earlier years, newest first, none before `earliest`. */
export function baselineSpans(sel: DayRange, step: FineStep, years: number, earliest: string): { year: number; span: DayRange }[] {
  const m = BASELINE_MARGIN[step];
  const out: { year: number; span: DayRange }[] = [];
  for (let k = 1; k <= years; k++) {
    // the selection lands on the same calendar days; the margin is counted from there
    const past = yearsBack(sel, k);
    const span = { start: dayStr(dayNum(past.start) - m), end: dayStr(dayNum(past.end) + m) };
    if (span.start < earliest) break;
    out.push({ year: Number(past.start.slice(0, 4)), span });
  }
  return out;
}

/* ------------------------------------------------------------------ baseline */

export interface FineBaseline {
  kind: "window" | "years";
  /** baseline anomalies, one array per unbroken stretch (the window either side of the selection, or one past year) */
  segments: (number | null)[][];
  /** years: the mean anomaly over the selection's own points in each complete past year, newest first */
  sameDays: { year: number; mean: number }[];
}

/** The loaded points either side of the selection. */
export function windowBaseline(s: FineSeries, sel: PointRange): FineBaseline {
  return { kind: "window", segments: [s.anomaly.slice(0, sel.a), s.anomaly.slice(sel.b + 1)].filter((x) => x.length), sameDays: [] };
}

/**
 * Earlier years. Each past series covers the selection ± margin of that year with the same point layout as the
 * selection's own span, so `sel` (the selection's points within it) is the same for every year.
 */
export function yearsBaseline(past: { year: number; series: FineSeries; sel: PointRange | null }[]): FineBaseline {
  const sameDays: FineBaseline["sameDays"] = [];
  for (const p of past) {
    if (!p.sel) continue;
    const v = p.series.anomaly.slice(p.sel.a, p.sel.b + 1);
    if (v.length && v.every(finite)) sameDays.push({ year: p.year, mean: (v as number[]).reduce((t, x) => t + x, 0) / v.length });
  }
  return { kind: "years", segments: past.map((p) => p.series.anomaly), sameDays };
}

export interface NoiseModel {
  /** mean of the baseline anomalies: the level the selection is compared with */
  level: number;
  /** sample SD of the baseline anomalies */
  sigma: number;
  /** lag-1 autocorrelation within segments, clamped to [0, 0.99] */
  rho: number;
  n: number;
}

const MAX_RHO = 0.99;

export function noiseModel(b: FineBaseline): NoiseModel | null {
  const all = b.segments.flat().filter(finite);
  const n = all.length;
  if (n < 2) return null;
  const level = all.reduce((t, x) => t + x, 0) / n;
  const ss = all.reduce((t, x) => t + (x - level) ** 2, 0);
  const sigma = Math.sqrt(ss / (n - 1));
  if (!(sigma > 0) || !Number.isFinite(sigma)) return null;
  let num = 0, pairs = 0;
  for (const seg of b.segments) {
    for (let i = 0; i + 1 < seg.length; i++) {
      const x = seg[i], y = seg[i + 1];
      if (finite(x) && finite(y)) { num += (x - level) * (y - level); pairs++; }
    }
  }
  const rho = pairs >= 3 && ss > 0 ? Math.max(0, Math.min(MAX_RHO, num / ss)) : 0;
  return { level, sigma, rho, n };
}

/* ------------------------------------------------------------------ the selection */

export interface FineDetail {
  kind: FineBaseline["kind"];
  step: FineStep;
  /** points in the selection, and those with an anomaly */
  points: number;
  n: number;
  /** mean anomaly of the selection (against the daily normal) */
  meanAnomaly: number | null;
  /** the baseline's mean anomaly */
  reference: number | null;
  /** meanAnomaly − reference: what the tests are about */
  difference: number | null;
  ci95: [number, number] | null;
  /** difference / σ */
  meanZ: number | null;
  /** the noise the test used: the baseline's level, and its σ and r (window: pooled with the selection) */
  noise: NoiseModel | null;
  /** AR(1) z test of the difference; se includes the uncertainty of the baseline's level */
  test: { z: number; p: number; se: number; nEff: number } | null;
  /** every same-length window wholly inside the baseline: how many are at least as far from the level */
  empirical: { p: number; asExtreme: number; windows: number } | null;
  /** years only: this year's selection among the same days of every year (position 1 = most extreme) */
  seasonRank: { position: number; of: number; direction: "low" | "high" } | null;
  verdict: Verdict;
  direction: "low" | "high" | null;
  /** the point with the largest |z| (index into the series) */
  peak: { index: number; z: number; anomaly: number } | null;
  beyond2Sigma: number;
  signConsistency: number | null;
}

const Z95 = 1.96;
const ALPHA = 0.05;
export const MIN_EMPIRICAL_WINDOWS = 20;
const MIN_SEASON_YEARS = 5;

export function fineDetail(s: FineSeries, sel: PointRange, b: FineBaseline): FineDetail {
  const points = sel.b - sel.a + 1;
  const obs: { t: number; v: number }[] = [];
  for (let t = sel.a; t <= sel.b; t++) { const v = s.anomaly[t]; if (finite(v)) obs.push({ t, v }); }
  const n = obs.length;
  const noise = noiseModel(b);
  const empty: FineDetail = {
    kind: b.kind, step: s.step, points, n, meanAnomaly: null, reference: noise?.level ?? null, difference: null, ci95: null,
    meanZ: null, noise, test: null, empirical: null, seasonRank: null, verdict: "insufficient", direction: null, peak: null,
    beyond2Sigma: 0, signConsistency: null,
  };
  if (!n) return empty;
  const meanAnomaly = obs.reduce((t, o) => t + o.v, 0) / n;
  if (!noise) return { ...empty, meanAnomaly };
  const { level } = noise;
  // Earlier years are a long baseline: its σ and r describe the noise. The surrounding window is short, and with a
  // persistent variable (soil moisture) its few points can be far calmer than the selection, so the window test uses
  // the pooled σ and r of both groups, each about its own mean (a two-sample test, like the lab's Welch test).
  let { sigma, rho } = noise;
  if (b.kind === "window" && n >= 2) {
    let ss = 0, num = 0;
    for (const o of obs) ss += (o.v - meanAnomaly) ** 2;
    for (let i = 0; i + 1 < n; i++) if (obs[i + 1].t === obs[i].t + 1) num += (obs[i].v - meanAnomaly) * (obs[i + 1].v - meanAnomaly);
    for (const seg of b.segments) {
      seg.forEach((x, i) => {
        if (!finite(x)) return;
        ss += (x - level) ** 2;
        const y = seg[i + 1];
        if (finite(y)) num += (x - level) * (y - level);
      });
    }
    const pooled = Math.sqrt(ss / Math.max(1, n + noise.n - 2));
    if (pooled > 0 && Number.isFinite(pooled)) {
      sigma = pooled;
      rho = Math.max(0, Math.min(MAX_RHO, num / ss));
    }
  }
  const used: NoiseModel = { level, sigma, rho, n: noise.n };
  const difference = meanAnomaly - level;
  const direction: "low" | "high" = difference < 0 ? "low" : "high";

  // AR(1) z test: Var(mean of selection) + Var(baseline level)
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += 1;
    for (let j = i + 1; j < n; j++) total += 2 * rho ** (obs[j].t - obs[i].t);
  }
  const nEff = n / (total / n);
  const nEffBase = Math.max(1, noise.n * (1 - rho) / (1 + rho));
  const se = Math.sqrt(sigma ** 2 * total / n ** 2 + sigma ** 2 / nEffBase);
  let test: FineDetail["test"] = null, ci95: FineDetail["ci95"] = null;
  if (se > 0 && Number.isFinite(se)) {
    const z = difference / se;
    test = { z, p: Math.min(1, 2 * normalCdf(-Math.abs(z))), se, nEff };
    ci95 = [difference - Z95 * se, difference + Z95 * se];
  }

  // empirical: windows of the selection's length inside each baseline segment, fully observed
  let empirical: FineDetail["empirical"] = null;
  if (n === points) {
    let windows = 0, asExtreme = 0;
    const target = Math.abs(difference), tol = 1e-12 * Math.max(1, Math.abs(level), target);
    for (const seg of b.segments) {
      for (let i = 0; i + points <= seg.length; i++) {
        const w = seg.slice(i, i + points);
        if (!w.every(finite)) continue;
        windows++;
        if (Math.abs((w as number[]).reduce((t, x) => t + x, 0) / points - level) >= target - tol) asExtreme++;
      }
    }
    if (windows >= MIN_EMPIRICAL_WINDOWS) empirical = { p: (asExtreme + 1) / (windows + 1), asExtreme, windows };
  }

  // rank among years: the same calendar days of every complete year, this one included
  let seasonRank: FineDetail["seasonRank"] = null;
  if (b.kind === "years" && n === points && b.sameDays.length + 1 >= MIN_SEASON_YEARS) {
    const beyond = b.sameDays.filter((y) => (direction === "low" ? y.mean < meanAnomaly : y.mean > meanAnomaly)).length;
    seasonRank = { position: beyond + 1, of: b.sameDays.length + 1, direction };
  }

  const verdicts: boolean[] = [];
  if (test) verdicts.push(test.p < ALPHA);
  if (empirical) verdicts.push(empirical.p < ALPHA);
  const verdict: Verdict = !verdicts.length ? "insufficient"
    : verdicts.every((v) => v) ? "significant" : verdicts.every((v) => !v) ? "not-significant" : "mixed";

  let peak: FineDetail["peak"] = null, beyond2Sigma = 0, same = 0;
  for (const o of obs) {
    const z = (o.v - level) / sigma;
    if (Math.abs(z) >= 2) beyond2Sigma++;
    if (!peak || Math.abs(z) > Math.abs(peak.z)) peak = { index: o.t, z, anomaly: o.v };
    if (direction === "low" ? o.v < level : o.v > level) same++;
  }
  return {
    ...empty, noise: used, meanAnomaly, difference, ci95, meanZ: difference / sigma, test, empirical, seasonRank, verdict, direction,
    peak, beyond2Sigma, signConsistency: same / n,
  };
}

/* ------------------------------------------------------------------ the lab's input */

/**
 * The series as a Decomposition for the lab's tools (lib/detective/lab.ts), which work on index steps: `months` holds
 * each point's first day, the residual is the anomaly measured from the baseline's level, z divides it by the
 * baseline's σ. In the window baseline the points outside the selection are the lab's baseline; with earlier years
 * the lab's baseline is empty and `extremeRate` (the share of baseline points with |z| > 2) is passed separately.
 */
export function fineDecomposition(s: FineSeries, sel: PointRange, b: FineBaseline): { d: Decomposition; extremeRate: number | undefined } {
  const noise = noiseModel(b);
  const level = noise?.level ?? 0;
  const residual = s.anomaly.map((v) => (finite(v) ? v - level : null));
  const z = residual.map((v) => (v != null && noise ? v / noise.sigma : null));
  const outside = s.start.filter((_, i) => i < sel.a || i > sel.b);
  let extremeRate: number | undefined;
  if (b.kind === "years" && noise) {
    const all = b.segments.flat().filter(finite);
    extremeRate = all.length ? all.filter((x) => Math.abs(x - level) / noise.sigma > 2).length / all.length : 0;
  }
  const baseMonths = b.kind === "window" ? outside : [];
  return {
    d: {
      months: s.start.slice(),
      raw: s.value.slice(),
      trend: s.normal.map((v) => (finite(v) ? v : NaN)),
      seasonal: s.start.map(() => 0),
      residual,
      z,
      baseline: {
        months: baseMonths,
        excluded: { start: s.start[sel.a].slice(0, 7), end: s.end[sel.b].slice(0, 7) },
        n: baseMonths.filter((m) => finite(residual[s.start.indexOf(m)])).length,
      },
    },
    extremeRate,
  };
}
