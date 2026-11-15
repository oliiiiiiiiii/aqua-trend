// Dev-only stand-ins for workstream A (analysis.ts), so workstream B can be built and tested on its own.
// NOT the real statistics: no Hamed–Rao correction, no missing-year rule. Do not import outside /dev.
import type { AnalysisApi, Decomposition, IntervalStats, MonthlySeries, TimeRange, TrendStats } from "@/lib/detective/contracts";

const ym = (k: number) => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
const ymi = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Deterministic PRNG so screenshots are stable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

export type FakeKind = "precip" | "tair" | "tws";

/** Synthetic monthly series 1998-01..2025-09 with a known trend, a seasonal cycle, gaps and an event anomaly. */
export function fakeSeries(kind: FakeKind, event: TimeRange, eventZ: number): MonthlySeries {
  const start = ymi("1998-01"), n = 333;
  const r = rng(kind === "precip" ? 7 : kind === "tair" ? 11 : 13);
  const cfg = {
    precip: { mean: 6, amp: 4, slope: -0.004, sd: 1.6, unit: "mm/day", floor: 0 },
    tair: { mean: 23, amp: 5, slope: 0.0025, sd: 0.6, unit: "°C", floor: -Infinity },
    tws: { mean: 0, amp: 6, slope: -0.03, sd: 2.5, unit: "cm", floor: -Infinity },
  }[kind];
  const es = ymi(event.start) - start, ee = ymi(event.end) - start;
  const values: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const m = (start + i) % 12;
    let v = cfg.mean + cfg.slope * i + cfg.amp * Math.sin(((m - 3) / 12) * 2 * Math.PI) + cfg.sd * gauss(r);
    if (i >= es && i <= ee) v += eventZ * cfg.sd;
    values.push(Math.max(cfg.floor, v));
  }
  // gaps: a run (like the GRACE gap) and a lone month
  if (kind === "tws") for (let i = 234; i < 245; i++) values[i] = null;
  values[60] = null;
  values[62] = null;
  return { layer: kind, start: ym(start), values, unit: cfg.unit };
}

export const fakeAnalysis: AnalysisApi = {
  decompose(s, event, pad) {
    const start = ymi(s.start), n = s.values.length;
    const months = Array.from({ length: n }, (_, i) => ym(start + i));
    const ex0 = ymi(event.start) - start - pad, ex1 = ymi(event.end) - start + pad;
    const inBase = (i: number) => (i < ex0 || i > ex1) && isNum(s.values[i]);
    // OLS on baseline, then monthly climatology of the detrended baseline
    let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0;
    for (let i = 0; i < n; i++) if (inBase(i)) { const v = s.values[i] as number; sx += i; sy += v; sxx += i * i; sxy += i * v; k++; }
    const slope = (k * sxy - sx * sy) / (k * sxx - sx * sx), icpt = (sy - slope * sx) / k;
    const trend = months.map((_, i) => icpt + slope * i);
    const sum = new Array(12).fill(0), cnt = new Array(12).fill(0);
    for (let i = 0; i < n; i++) if (inBase(i)) { const m = (start + i) % 12; sum[m] += (s.values[i] as number) - trend[i]; cnt[m]++; }
    const clim = sum.map((v, m) => (cnt[m] ? v / cnt[m] : 0));
    const seasonal = months.map((_, i) => clim[(start + i) % 12]);
    const residual = s.values.map((v, i) => (isNum(v) ? v - trend[i] - seasonal[i] : null));
    const br = residual.filter((v, i): v is number => isNum(v) && inBase(i));
    const sd = Math.sqrt(br.reduce((a, v) => a + v * v, 0) / Math.max(1, br.length - 1));
    return {
      months, raw: s.values, trend, seasonal, residual,
      z: residual.map((v) => (isNum(v) ? v / sd : null)),
      baseline: { months: months.filter((_, i) => inBase(i)), excluded: { start: ym(start + ex0), end: ym(start + ex1) }, n: br.length },
    } satisfies Decomposition;
  },

  intervalStats(d, range): IntervalStats {
    const base = ymi(d.months[0]);
    const s = Math.max(0, ymi(range.start) - base), e = Math.min(d.months.length - 1, ymi(range.end) - base);
    const L = e - s + 1;
    const meanOf = (a: number, b: number) => {
      let t = 0, c = 0;
      for (let i = a; i <= b; i++) { const v = d.residual[i]; if (isNum(v)) { t += v; c++; } }
      return c >= Math.ceil((b - a + 1) / 2) ? t / c : null;
    };
    const meanZOf = (a: number, b: number) => {
      let t = 0, c = 0;
      for (let i = a; i <= b; i++) { const v = d.z[i]; if (isNum(v)) { t += v; c++; } }
      return c ? t / c : null;
    };
    const m = L > 0 ? meanOf(s, e) : null;
    if (m == null) return { range, n: Math.max(0, L), meanResidual: null, meanZ: null, percentile: null, rank: null };
    const all: number[] = [];
    for (let a = 0; a + L - 1 < d.months.length; a++) { const v = meanOf(a, a + L - 1); if (v != null) all.push(v); }
    const below = all.filter((v) => v < m).length, above = all.filter((v) => v > m).length;
    const direction = m < 0 ? "low" : "high";
    return {
      range, n: L, meanResidual: m, meanZ: meanZOf(s, e),
      percentile: (100 * (below + 0.5)) / all.length,
      rank: { position: (direction === "low" ? below : above) + 1, of: all.length, direction },
    };
  },

  trendStats(s): TrendStats {
    const sig = s.unit !== "mm/day";
    return {
      senPerDecade: s.unit === "mm/day" ? -0.41 : s.unit === "°C" ? 0.3 : -3.6,
      ci95: s.unit === "mm/day" ? [-1.02, 0.18] : s.unit === "°C" ? [0.21, 0.39] : [-4.4, -2.8],
      mkP: sig ? 0.0004 : 0.21,
      significant: sig,
      yearsToSignificance: sig ? null : 14,
      nEff: sig ? 96 : 211,
    };
  },
};
