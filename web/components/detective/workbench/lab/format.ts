// The "Tests" result card, pure part: one test's statistics turned into the card's verdict, 2–4 key
// numbers and the details table, all as strings. Mirrors StatsPanel: verdict first, method last.
import type { LabStats } from "@/lib/detective/lab";
import { num, pValue } from "../../format";
import { COPY } from "../copy";
import { slopeScale } from "./tests";

export type Tag = "uncorrected" | "optimistic";
export interface ResultCell { label: string; value: string; sub?: string | null; tag?: Tag }
export interface DetailRow { label: string; value: string; tag?: Tag }
export type FigureKind = "acf" | "hist" | "boot" | "perm" | "cusum" | "monthly" | "spectrum";

export interface ResultView {
  /** null for descriptive tools (no p value) */
  significant: boolean | null;
  headline: string;
  note: string | null;
  cells: ResultCell[];
  details: DetailRow[];
  method: string;
  figure: FigureKind | null;
}

export interface ResultContext {
  unit: string;
  /** length of the tested range in months (slope unit) */
  months: number;
  /** "Mar 2021" for an index into d.months */
  monthLabel: (i: number) => string;
}

const ALPHA = 0.05;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "p = 0.03", "p < 0.001" */
export const pText = (p: number | null | undefined) => {
  const v = pValue(p);
  return `p ${v.startsWith("<") ? "" : "= "}${v}`;
};
/** whole numbers as they are, others with one decimal */
export const countText = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const pct = (x: number) => Math.round(x * 100);
const rText = (r: number | null) => (r == null ? "—" : num(r, 2, true));

export function resultView(s: LabStats, ctx: ResultContext): ResultView {
  const L = COPY.lab, C = L.cell, R = L.row, V = L.verdict, S = L.sub, RV = L.rowValue, M = L.method;
  const u = ctx.unit;
  const val = (x: number) => `${num(x, 2, true)} ${u}`;
  const ci = (c: [number, number], k = 1) => S.ci(num(c[0] * k, 2, true), num(c[1] * k, 2, true));
  const sc = slopeScale(ctx.months);
  const per = sc.per === "decade" ? L.perDecade(u) : L.perYear(u);
  const slope = (x: number) => `${num(x * sc.k, 2, true)} ${per}`;
  const n = (k: number): DetailRow => ({ label: R.n, value: RV.months(k) });
  const corr = (nEff: number, lag1: number | null): DetailRow[] => [
    { label: R.nEff, value: num(nEff, 2) },
    { label: R.lag1, value: rText(lag1) },
  ];
  const sig = (p: number) => p < ALPHA;
  const ym = ctx.monthLabel;

  switch (s.tool) {
    case "mean": return {
      significant: sig(s.p), headline: V.shift(sig(s.p), s.mean > 0), note: null,
      cells: [
        { label: C.mean, value: val(s.mean), sub: ci(s.ci95) },
        { label: C.t, value: num(s.t, 2, true), sub: S.df(num(s.df, 1)) },
        { label: C.p, value: pText(s.p) },
        { label: C.effect, value: num(s.effect, 2, true), sub: S.large },
      ],
      details: [n(s.n), ...corr(s.nEff, s.lag1), { label: R.sd, value: `${num(s.sd)} ${u}` }, { label: R.se, value: `${num(s.se)} ${u}` },
        { label: R.t, value: RV.tdf(num(s.t, 2, true), num(s.df, 1)) }, { label: R.p, value: pValue(s.p) }],
      method: M.corrected, figure: null,
    };
    case "wilcoxon": return {
      significant: sig(s.p), headline: V.shift(sig(s.p), s.z > 0), note: null,
      cells: [
        { label: C.median, value: val(s.median), sub: S.above(pct(s.positiveShare)) },
        { label: C.wPlus, value: countText(s.wPlus), sub: S.z(num(s.z, 2, true)) },
        { label: C.p, value: pText(s.p) },
      ],
      details: [n(s.n), ...corr(s.nEff, s.lag1), { label: R.median, value: val(s.median) }, { label: R.wPlus, value: countText(s.wPlus) },
        { label: R.z, value: num(s.z, 2, true) }, { label: R.p, value: pValue(s.p) }],
      method: M.corrected, figure: null,
    };
    case "ols": return {
      significant: sig(s.p), headline: V.trend(sig(s.p), s.slope > 0), note: null,
      cells: [
        { label: C.slope, value: slope(s.slope), sub: ci(s.ci95, sc.k) },
        { label: C.t, value: num(s.t, 2, true), sub: S.df(num(s.df, 1)) },
        { label: C.p, value: pText(s.p) },
        { label: C.r2, value: num(s.r2, 2) },
      ],
      details: [n(s.n), ...corr(s.nEff, s.lag1), { label: R.se, value: slope(s.se) },
        { label: R.t, value: RV.tdf(num(s.t, 2, true), num(s.df, 1)) }, { label: R.p, value: pValue(s.p) },
        { label: R.pNaive, value: pValue(s.naive.p), tag: "uncorrected" }, { label: R.r2, value: num(s.r2, 2) }],
      method: M.corrected, figure: null,
    };
    case "mk": return {
      significant: sig(s.p), headline: V.trend(sig(s.p), s.sen > 0), note: null,
      cells: [
        { label: C.sen, value: slope(s.sen), sub: ci(s.ci95, sc.k) },
        { label: C.tau, value: num(s.tau, 2, true), sub: S.S(String(s.S)) },
        { label: C.p, value: pText(s.p), sub: S.z(num(s.z, 2, true)) },
      ],
      details: [n(s.n), ...corr(s.nEff, s.lag1), { label: R.S, value: String(s.S) }, { label: R.tau, value: num(s.tau, 2, true) },
        { label: R.z, value: num(s.z, 2, true) }, { label: R.p, value: pValue(s.p) },
        { label: R.pNaive, value: pValue(s.pNaive), tag: "uncorrected" }],
      method: M.corrected, figure: null,
    };
    case "piecewise": {
      const at = ym(s.breakAt);
      return {
        significant: sig(s.p), headline: V.bend(sig(s.p), at), note: null,
        cells: [
          { label: C.bend, value: at },
          { label: C.before, value: slope(s.slopeBefore) },
          { label: C.after, value: slope(s.slopeAfter) },
          { label: C.p, value: pText(s.p), sub: S.F(num(s.F, 2)), tag: "optimistic" },
        ],
        details: [n(s.n), { label: R.nEff, value: num(s.nEff, 2) },
          { label: R.r2Bend, value: `${num(s.r2Line, 2)} → ${num(s.r2Piecewise, 2)}` },
          { label: R.F, value: RV.Fdf(num(s.F, 2), num(s.df2, 1)) }, { label: R.p, value: pValue(s.p), tag: "optimistic" }],
        method: M.piecewise, figure: null,
      };
    }
    case "permutation": return {
      significant: sig(s.p), headline: V.trend(sig(s.p), s.slope > 0),
      note: sig(s.pNaive) && !sig(s.p) ? V.naiveOnly : null,
      cells: [
        { label: C.slope, value: slope(s.slope) },
        { label: C.blockP, value: pText(s.p), sub: S.block(s.block) },
        { label: C.monthP, value: pText(s.pNaive), tag: "uncorrected" },
      ],
      details: [n(s.n), { label: R.draws, value: String(s.draws) }, { label: R.block, value: RV.months(s.block) },
        { label: R.blockP, value: pValue(s.p) }, { label: R.monthP, value: pValue(s.pNaive), tag: "uncorrected" }],
      method: M.permutation, figure: "perm",
    };
    case "bootstrap": return {
      significant: sig(s.slope.p), headline: V.trend(sig(s.slope.p), s.slope.est > 0), note: null,
      cells: [
        { label: C.slope, value: slope(s.slope.est), sub: ci(s.slope.ci95, sc.k) },
        { label: C.p, value: pText(s.slope.p), sub: S.draws(s.draws, s.block) },
        { label: C.bootMean, value: val(s.mean.est), sub: `${ci(s.mean.ci95)} · ${pText(s.mean.p)}` },
      ],
      details: [n(s.n), { label: R.draws, value: String(s.draws) }, { label: R.block, value: RV.months(s.block) },
        { label: R.slopeCi, value: `${slope(s.slope.est)} · ${ci(s.slope.ci95, sc.k)} · ${pText(s.slope.p)}` },
        { label: R.meanCi, value: `${val(s.mean.est)} · ${ci(s.mean.ci95)} · ${pText(s.mean.p)}` }],
      method: M.boot, figure: "boot",
    };
    case "compare": {
      const sw = sig(s.welch.p), smw = sig(s.mannWhitney.p);
      return {
        significant: sw, headline: V.compare(sw, s.diff > 0), note: sw !== smw ? V.mwDisagrees : null,
        cells: [
          { label: C.diff, value: val(s.diff), sub: ci(s.welch.ci95) },
          { label: C.welch, value: pText(s.welch.p), sub: S.t(num(s.welch.t, 2, true)) },
          { label: C.mw, value: pText(s.mannWhitney.p), sub: S.superiority(pct(s.mannWhitney.probSuperiority)), tag: "uncorrected" },
        ],
        details: [
          { label: R.range, value: RV.meanN(val(s.a.mean), s.a.n) },
          { label: R.rest, value: RV.meanN(val(s.b.mean), s.b.n) },
          { label: R.nEff, value: `${num(s.a.nEff, 2)} · ${num(s.b.nEff, 2)}` },
          { label: R.welch, value: `${RV.tdf(num(s.welch.t, 2, true), num(s.welch.df, 1))}, ${pText(s.welch.p)}` },
          { label: R.mw, value: RV.Up(countText(s.mannWhitney.U), pValue(s.mannWhitney.p)), tag: "uncorrected" },
          { label: R.superiority, value: `${pct(s.mannWhitney.probSuperiority)} %` },
        ],
        method: M.compare, figure: null,
      };
    }
    case "variance": return {
      significant: sig(s.p), headline: V.spread(sig(s.p), s.ratio > 1), note: null,
      cells: [
        { label: C.ratio, value: RV.ratio(num(s.ratio, 2)), sub: S.sds(`${num(s.a.sd)} ${u}`, `${num(s.b.sd)} ${u}`) },
        { label: C.p, value: pText(s.p), sub: S.t(num(s.t, 2, true)) },
      ],
      details: [{ label: R.sdRange, value: RV.meanN(`${num(s.a.sd)} ${u}`, s.a.n) }, { label: R.sdRest, value: RV.meanN(`${num(s.b.sd)} ${u}`, s.b.n) },
        { label: R.ratio, value: RV.ratio(num(s.ratio, 2)) }, { label: R.t, value: RV.tdf(num(s.t, 2, true), num(s.df, 1)) },
        { label: R.p, value: pValue(s.p) }],
      method: M.variance, figure: null,
    };
    case "monthly": {
      const top = s.byMonth.map((g, m) => ({ m, mean: g.mean })).filter((g) => Number.isFinite(g.mean))
        .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean))[0];
      return {
        significant: sig(s.p), headline: V.monthly(sig(s.p)), note: null,
        cells: [
          { label: C.strongest, value: top ? MONTHS[top.m] : "—", sub: top ? val(top.mean) : null },
          { label: C.kw, value: pText(s.p), sub: S.H(num(s.H, 2), s.df), tag: "uncorrected" },
        ],
        details: [n(s.n), { label: R.H, value: num(s.H, 2) }, { label: R.df, value: String(s.df) }, { label: R.p, value: pValue(s.p), tag: "uncorrected" },
          ...s.byMonth.flatMap((g, m) => (g.n ? [{ label: MONTHS[m], value: RV.meanN(val(g.mean), g.n) }] : []))],
        method: M.monthly, figure: "monthly",
      };
    }
    case "cusum": {
      const d = s.deficit, su = s.surplus;
      const main = d && (!su || d.amount >= su.amount) ? { deficit: true, x: d } : su ? { deficit: false, x: su } : null;
      const span = (x: { from: number; to: number }) => S.span(ym(x.from), ym(x.to), x.to - x.from + 1);
      return {
        significant: null,
        headline: main ? V.cusum(main.deficit, val(main.deficit ? -main.x.amount : main.x.amount), main.x.to - main.x.from + 1) : V.cusumNone,
        note: L.descriptive,
        cells: [
          { label: C.total, value: val(s.total) },
          { label: C.deficit, value: d ? val(-d.amount) : "—", sub: d ? span(d) : null },
          { label: C.surplus, value: su ? val(su.amount) : "—", sub: su ? span(su) : null },
        ],
        details: [n(s.n), { label: R.total, value: val(s.total) },
          { label: R.deficit, value: d ? `${val(-d.amount)} · ${span(d)}` : "—" },
          { label: R.surplus, value: su ? `${val(su.amount)} · ${span(su)}` : "—" }],
        method: M.cusum, figure: "cusum",
      };
    }
    case "runs": {
      const low = s.longest.sign < 0;
      return {
        significant: sig(s.pPersistent), headline: V.runs(sig(s.pPersistent), s.longest.length, low), note: null,
        cells: [
          { label: C.streak, value: S.streak(s.longest.length, low), sub: `${ym(s.longest.from)} → ${ym(s.longest.to)}` },
          { label: C.persistent, value: pText(s.pPersistent), sub: S.rho(num(s.rho, 2)) },
          { label: C.independent, value: pText(s.pIndependent), tag: "uncorrected" },
          { label: C.runsTest, value: pText(s.p), sub: S.runs(s.runs, num(s.expectedRuns, 1)), tag: "uncorrected" },
        ],
        details: [n(s.n), { label: R.streak, value: `${S.streak(s.longest.length, low)} · ${ym(s.longest.from)} → ${ym(s.longest.to)}` },
          { label: R.streakMean, value: val(s.longest.mean) }, { label: R.rho, value: num(s.rho, 2) },
          { label: R.pPersistent, value: pValue(s.pPersistent) }, { label: R.pIndependent, value: pValue(s.pIndependent), tag: "uncorrected" },
          { label: R.runs, value: S.runs(s.runs, num(s.expectedRuns, 1)) }, { label: R.z, value: num(s.z, 2, true) },
          { label: R.p, value: pValue(s.p), tag: "uncorrected" }],
        method: M.runs, figure: null,
      };
    }
    case "extremes": return {
      significant: sig(s.p), headline: V.extremes(sig(s.p), s.count > s.expected), note: null,
      cells: [
        { label: C.beyond, value: S.of(s.count, s.n), sub: S.highLow(s.high, s.low) },
        { label: C.expected, value: num(s.expected, 1), sub: S.rate(num(100 * s.rate, 1)) },
        { label: C.p, value: pText(s.p), sub: S.upper(pValue(s.pUpper)), tag: "uncorrected" },
      ],
      details: [n(s.n), { label: R.high, value: String(s.high) }, { label: R.low, value: String(s.low) },
        { label: R.expected, value: num(s.expected, 1) }, { label: R.rate, value: `${num(100 * s.rate, 1)} %` },
        { label: R.p, value: pValue(s.p), tag: "uncorrected" }, { label: R.pUpper, value: pValue(s.pUpper), tag: "uncorrected" }],
      method: M.extremes, figure: null,
    };
    case "pettitt": {
      const first = ym(s.splitAt + 1);
      return {
        significant: sig(s.p), headline: V.break(sig(s.p), first), note: null,
        cells: [
          { label: C.change, value: first },
          { label: C.jump, value: val(s.meanAfter - s.meanBefore), sub: S.means(num(s.meanBefore, 2, true), num(s.meanAfter, 2, true)) },
          { label: C.p, value: pText(s.p), sub: S.K(String(s.K)), tag: "uncorrected" },
        ],
        details: [n(s.n), { label: R.before, value: RV.meanN(val(s.meanBefore), s.nBefore) },
          { label: R.after, value: RV.meanN(val(s.meanAfter), s.nAfter) }, { label: R.K, value: String(s.K) },
          { label: R.p, value: pValue(s.p), tag: "uncorrected" }],
        method: M.pettitt, figure: null,
      };
    }
    case "acf": {
      const p = s.ljungBox.p;
      return {
        significant: sig(p), headline: V.acf(sig(p)), note: null,
        cells: [
          { label: C.lag1, value: rText(s.acf[0]) },
          { label: C.ljung, value: pText(p), sub: S.Q(num(s.ljungBox.Q, 2), s.ljungBox.df) },
        ],
        details: [n(s.n), { label: R.band, value: `± ${num(s.band, 2)}` }, { label: R.Q, value: num(s.ljungBox.Q, 2) },
          { label: R.lags, value: String(s.ljungBox.df) }, { label: R.p, value: pValue(p) }],
        method: M.noise, figure: "acf",
      };
    }
    case "spectrum": {
      const top = s.peaks[0];
      const P = L.fig.period;
      return {
        significant: top ? top.significant : false, headline: V.spectrum(top?.significant ? P(top.period) : null), note: null,
        cells: s.peaks.map((pk, k) => ({ label: C.peak(k + 1), value: P(pk.period), sub: S.power(num(pk.power, 2), num(pk.threshold, 2), pk.significant) })),
        details: [n(s.n), { label: R.rho, value: num(s.rho, 2) },
          ...s.peaks.map((pk, k) => ({ label: R.peak(k + 1), value: `${P(pk.period)} · ${S.power(num(pk.power, 2), num(pk.threshold, 2), pk.significant)}` }))],
        method: M.spectrum, figure: "spectrum",
      };
    }
    case "normality": return {
      significant: sig(s.p), headline: V.normality(sig(s.p)), note: null,
      cells: [
        { label: C.skew, value: num(s.skew, 2, true) },
        { label: C.kurt, value: num(s.kurtosis, 2, true) },
        { label: C.jb, value: pText(s.p), sub: S.JB(num(s.jb, 2)) },
      ],
      details: [n(s.n), { label: R.mean, value: val(s.mean) }, { label: R.sd, value: `${num(s.sd)} ${u}` },
        { label: R.skew, value: num(s.skew, 2, true) }, { label: R.kurt, value: num(s.kurtosis, 2, true) },
        { label: R.jb, value: num(s.jb, 2) }, { label: R.p, value: pValue(s.p) }],
      method: M.noise, figure: "hist",
    };
  }
}
