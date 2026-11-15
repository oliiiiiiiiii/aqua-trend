// STAND-IN for workstream A (web/lib/detective/analysis.ts): a compact version of the same rules, so the C flow runs
// end to end before A is merged. Simplifications: no autocorrelation correction in the trend test, no
// yearsToSignificance. Delete at integration and use A's implementation.
import type { AnalysisApi, Decomposition, IntervalStats, MonthlySeries, TimeRange, TrendStats } from "@/lib/detective/contracts";
import { mannKendall, mean, olsSlope, senSlope } from "@/lib/stats";
import { rangeLength, ymFromIndex, ymIndex } from "@/lib/detective/url";

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** calendar-month means of y over the months where use(i) holds; years with > 3 missing months are skipped */
function climatology(start: number, y: (number | null)[], use: (i: number) => boolean): number[] | null {
  const perYear = new Map<number, number>();
  y.forEach((v, i) => { if (finite(v)) perYear.set(Math.floor((start + i) / 12), (perYear.get(Math.floor((start + i) / 12)) ?? 0) + 1); });
  const sum = new Array(12).fill(0), n = new Array(12).fill(0);
  y.forEach((v, i) => {
    if (!finite(v) || !use(i) || (perYear.get(Math.floor((start + i) / 12)) ?? 0) < 9) return;
    const m = (start + i) % 12;
    sum[m] += v; n[m]++;
  });
  if (n.some((k) => k === 0)) return null;
  const clim = sum.map((s, m) => s / n[m]);
  const c = mean(clim);
  return clim.map((v) => v - c);
}

function decompose(series: MonthlySeries, event: TimeRange, padMonths: number): Decomposition {
  const s0 = ymIndex(series.start);
  const raw = series.values.map((v) => (finite(v) ? v : null));
  const ex0 = ymIndex(event.start) - padMonths, ex1 = ymIndex(event.end) + padMonths;
  const inBase = (i: number) => s0 + i < ex0 || s0 + i > ex1;
  const months = raw.map((_, i) => ymFromIndex(s0 + i));
  // seasonal cycle, then the linear trend of what is left, both from the baseline only
  const clim0 = climatology(s0, raw, inBase);
  if (!clim0) throw new RangeError("Insufficient baseline: every calendar month needs baseline data.");
  const xs: number[] = [], ys: number[] = [];
  raw.forEach((v, i) => { if (v !== null && inBase(i)) { xs.push(i); ys.push(v - clim0[(s0 + i) % 12]); } });
  const fit = olsSlope(xs, ys);
  if (!finite(fit.slope)) throw new RangeError("Insufficient baseline for a trend.");
  const trend = raw.map((_, i) => fit.intercept + fit.slope * i);
  const clim = climatology(s0, raw.map((v, i) => (v === null ? null : v - trend[i] + fit.intercept)), inBase) ?? clim0;
  const seasonal = raw.map((_, i) => clim[(s0 + i) % 12]);
  const residual = raw.map((v, i) => (v === null ? null : v - trend[i] - seasonal[i]));
  const base = residual.filter((v, i): v is number => v !== null && inBase(i));
  const mu = mean(base);
  const sigma = Math.sqrt(base.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, base.length - 1));
  const z = residual.map((v) => (v === null || !(sigma > 0) ? null : v / sigma));
  return {
    months, raw, trend, seasonal, residual, z,
    baseline: { months: months.filter((_, i) => inBase(i)), excluded: { start: ymFromIndex(ex0), end: ymFromIndex(ex1) }, n: base.length },
  };
}

function intervalStats(d: Decomposition, range: TimeRange): IntervalStats {
  const a = ymIndex(range.start), b = ymIndex(range.end);
  const idx = d.months.map(ymIndex);
  const sel = idx.map((m, i) => (m >= a && m <= b ? i : -1)).filter((i) => i >= 0);
  const res = sel.map((i) => d.residual[i]).filter(finite);
  const zs = sel.map((i) => d.z[i]).filter(finite);
  const meanResidual = res.length ? mean(res) : null;
  const out: IntervalStats = { range, n: res.length, meanResidual, meanZ: zs.length ? mean(zs) : null, percentile: null, rank: null };
  const len = rangeLength(range);
  if (meanResidual === null || res.length !== len) return out;
  let less = 0, greater = 0, equal = 0;
  for (let i = 0; i + len <= d.residual.length; i++) {
    const w = d.residual.slice(i, i + len);
    if (!w.every(finite)) continue;
    const m = mean(w as number[]);
    if (Math.abs(m - meanResidual) < 1e-12 * Math.max(1, Math.abs(meanResidual))) equal++;
    else if (m < meanResidual) less++;
    else greater++;
  }
  const total = less + greater + equal;
  if (!total) return out;
  const direction = meanResidual < 0 ? "low" : "high";
  out.percentile = (100 * (less + equal / 2)) / total;
  out.rank = { position: 1 + (direction === "low" ? less : greater), of: total, direction };
  return out;
}

function trendStats(series: MonthlySeries): TrendStats {
  const none: TrendStats = { senPerDecade: null, ci95: null, mkP: null, significant: null, yearsToSignificance: null, nEff: null };
  const s0 = ymIndex(series.start);
  const raw = series.values.map((v) => (finite(v) ? v : null));
  const clim = climatology(s0, raw, () => true);
  if (!clim) return none;
  const xs: number[] = [], ys: number[] = [];
  raw.forEach((v, i) => { if (v !== null) { xs.push(i); ys.push(v - clim[(s0 + i) % 12]); } });
  const sen = senSlope(xs, ys);
  const mk = mannKendall(ys);
  if (!finite(sen.slope) || !finite(mk.p)) return none;
  return {
    senPerDecade: sen.slope * 120,
    ci95: finite(sen.ciLow) && finite(sen.ciHigh) ? [sen.ciLow * 120, sen.ciHigh * 120] : null,
    mkP: mk.p,
    significant: mk.p < 0.05,
    yearsToSignificance: null,
    nEff: xs.length,
  };
}

export const standinAnalysis: AnalysisApi = { decompose, intervalStats, trendStats };
