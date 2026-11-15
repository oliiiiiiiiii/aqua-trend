// The "Tests" result card, pure part: one test's statistics turned into the card's verdict, 2–4 key
// numbers and the details table, all as strings. Mirrors StatsPanel: verdict first, method last.
import type { LabStats } from "@/lib/detective/lab";
import { num, pValue } from "../../format";
import { labCopy, slopeFor, type LabStep } from "./step";

type GpSpan = { x0: number; x1: number; sign: 1 | -1 };

export type Tag = "uncorrected" | "optimistic";
export interface ResultCell { label: string; value: string; sub?: string | null; tag?: Tag }
export interface DetailRow { label: string; value: string; tag?: Tag }
export type FigureKind = "acf" | "hist" | "boot" | "perm" | "cusum" | "monthly" | "spectrum" | "analog" | "hmm" | "forecast" | "discord" | "iforest" | "bocpd" | "gp";

export interface ResultView {
  /** null for descriptive tools (no p value) */
  significant: boolean | null;
  headline: string;
  note: string | null;
  cells: ResultCell[];
  details: DetailRow[];
  method: string;
  figure: FigureKind | null;
  /** one short honesty line shown under the key numbers (machine-learning tools) */
  caveat?: string | null;
}

export interface ResultContext {
  unit: string;
  /** length of the tested range in months (slope unit) */
  months: number;
  /** "Mar 2021" for an index into d.months */
  monthLabel: (i: number) => string;
  /** "Mar – Jun 2002" for a span of indices into d.months (default: "Mar 2002 – Jun 2002") */
  monthSpan?: (a: number, b: number) => string;
  /** the step of the tested series (default months): words and slope units follow it */
  step?: LabStep;
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
  const L = labCopy(ctx.step), C = L.cell, R = L.row, V = L.verdict, S = L.sub, RV = L.rowValue, M = L.method;
  const u = ctx.unit;
  const val = (x: number) => `${num(x, 2, true)} ${u}`;
  const ci = (c: [number, number], k = 1) => S.ci(num(c[0] * k, 2, true), num(c[1] * k, 2, true));
  const sc = slopeFor(ctx.step ?? "month", ctx.months);
  const per = sc.per === "decade" ? L.perDecade(u) : L.perYear(u);
  const slope = (x: number) => `${num(x * sc.k, 2, true)} ${per}`;
  const n = (k: number): DetailRow => ({ label: R.n, value: RV.months(k) });
  const corr = (nEff: number, lag1: number | null): DetailRow[] => [
    { label: R.nEff, value: num(nEff, 2) },
    { label: R.lag1, value: rText(lag1) },
  ];
  const sig = (p: number) => p < ALPHA;
  const ym = ctx.monthLabel;
  const span = (a: number, b: number) => (ctx.monthSpan ? ctx.monthSpan(a, b) : a === b ? ym(a) : `${ym(a)} – ${ym(b)}`);
  const ML = L.ml;

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
      method: `${M.corrected} ${M.meanRho}`, figure: null,
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
    case "analog": {
      const m0 = s.matches[0];
      const at = (st: number) => span(st, st + s.length - 1);
      const dtw0 = s.dtw[0];
      const after = (x: number | null) => (x == null ? "—" : val(x));
      return {
        significant: null, headline: ML.verdict.analog(s.matches.length, at(m0.start)), note: L.descriptive,
        cells: [
          { label: ML.cell.closest, value: `${num(m0.distance)} ${u}`, sub: ML.sub.typical(`${num(s.typical)} ${u}`) },
          { label: ML.cell.shape, value: rText(m0.corr) },
          { label: ML.cell.then(s.horizon), value: after(s.analogAfter), sub: s.actualAfter != null ? ML.sub.followed(val(s.actualAfter)) : ML.sub.notObserved },
          ...(dtw0 ? [{ label: ML.cell.dtw, value: at(dtw0.start), sub: `RMS ${num(dtw0.distance)} ${u}` }] : []),
        ],
        details: [
          { label: R.n, value: RV.months(s.length) },
          ...s.matches.map((m, k) => ({ label: ML.row.match(k + 1), value: `${at(m.start)} · ${ML.rowValue.match(`${num(m.distance)} ${u}`, rText(m.corr), after(m.after))}` })),
          ...s.dtw.map((m, k) => ({ label: ML.row.dtwMatch(k + 1), value: `${at(m.start)} · RMS ${num(m.distance)} ${u}` })),
          { label: ML.row.typical, value: `${num(s.typical)} ${u}` },
          { label: ML.row.horizon(s.horizon), value: `${after(s.analogAfter)} · ${ML.row.actual.toLowerCase()} ${after(s.actualAfter)}` },
        ],
        method: ML.method.analog, figure: "analog", caveat: ML.caveat.analog,
      };
    }
    case "hmm": {
      const lo = s.states[0], hi = s.states[s.K - 1];
      const len = (r: { from: number; to: number } | null) => (r ? r.to - r.from + 1 : 0);
      // the headline is about the rarer state (the one the range may be an event of), falling back to the other
      const preferLow = lo.share <= hi.share;
      const useLow = (preferLow ? len(s.longestLow) > 0 : len(s.longestHigh) === 0) && len(s.longestLow) > 0;
      const best = useLow ? s.longestLow : s.longestHigh;
      const stateCell = (label: string, st: typeof lo) => ({ label, value: val(st.mean), sub: ML.sub.shareLasts(pct(st.share), num(st.expectedDuration, 2)) });
      return {
        significant: null, note: L.descriptive,
        headline: best ? ML.verdict.hmm(useLow, ym(best.from), len(best)) : ML.verdict.hmmNone,
        cells: [
          { label: ML.cell.states, value: String(s.K), sub: ML.sub.byBic },
          stateCell(ML.cell.low, lo), stateCell(ML.cell.high, hi),
        ],
        details: [
          { label: ML.row.bic, value: ML.rowValue.states(num(s.bic.k2, 4), s.bic.k3 != null ? num(s.bic.k3, 4) : "—") },
          ...s.states.map((st, k) => ({ label: ML.row.state(k + 1), value: ML.rowValue.stateRow(val(st.mean), `${num(st.sd)} ${u}`, pct(st.share), num(st.expectedDuration, 2)) })),
          ...(s.longestLow ? [{ label: ML.cell.low, value: span(s.longestLow.from, s.longestLow.to) }] : []),
          ...(s.longestHigh ? [{ label: ML.cell.high, value: span(s.longestHigh.from, s.longestHigh.to) }] : []),
        ],
        method: ML.method.hmm, figure: "hmm", caveat: ML.caveat.hmm,
      };
    }
    case "forecast": {
      const p = s.pValue, up = s.meanError > 0;
      return {
        significant: sig(p), headline: ML.verdict.forecast(sig(p), up), note: null,
        cells: [
          { label: ML.cell.meanError, value: val(s.meanError), sub: ML.sub.actualMinusForecast },
          { label: ML.cell.outside, value: S.of(s.outside, s.observed), },
          { label: C.p, value: pText(p), sub: ML.sub.z(num(s.z, 2, true)) },
          { label: ML.cell.model, value: `AR(${s.p})`, sub: ML.sub.trained(s.trainN) },
        ],
        details: [
          { label: ML.row.order, value: `AR(${s.p})` }, { label: ML.row.trained, value: RV.months(s.trainN) },
          { label: ML.row.sigma, value: `${num(s.sigma)} ${u}` }, { label: ML.row.observed, value: RV.months(s.observed) },
          { label: ML.cell.meanError, value: val(s.meanError) },
          { label: R.z, value: num(s.z, 2, true) }, { label: R.p, value: pValue(p) },
        ],
        method: ML.method.forecast, figure: "forecast", caveat: ML.caveat.forecast,
      };
    }
    case "discord": {
      const w = s.windows.find((q) => q.m === s.profileM) ?? s.windows[s.windows.length - 1];
      const at = (st: number, m: number) => span(st, st + m - 1);
      return {
        significant: null, note: L.descriptive,
        headline: w?.discord ? ML.verdict.discord(w.m, at(w.discord.start, w.m)) : ML.verdict.discordNone,
        cells: [
          ...s.windows.filter((q) => q.discord).map((q) => ({
            label: ML.cell.rarest(q.m), value: at(q.discord!.start, q.m), sub: ML.sub.rms(`${num(q.discord!.distance)} ${u}`, `${num(q.typical)} ${u}`),
          })),
          ...(w?.motif ? [{ label: ML.cell.pair, value: `${ym(w.motif.a)} ≈ ${ym(w.motif.b)}`, sub: `${w.m} mo · RMS ${num(w.motif.distance)} ${u}` }] : []),
        ].slice(0, 4),
        details: s.windows.flatMap((q) => [
          ...(q.discord ? [{ label: ML.cell.rarest(q.m), value: ML.rowValue.window(at(q.discord.start, q.m), `${num(q.discord.distance)} ${u}`, `${num(q.typical)} ${u}`) }] : []),
          ...(q.motif ? [{ label: ML.row.pair(q.m), value: ML.rowValue.pair(at(q.motif.a, q.m), at(q.motif.b, q.m), `${num(q.motif.distance)} ${u}`) }] : []),
        ]),
        method: ML.method.discord, figure: "discord", caveat: ML.caveat.discord,
      };
    }
    case "iforest": {
      const top = s.flagged[0];
      return {
        significant: null, note: L.descriptive,
        headline: top ? ML.verdict.iforest(s.flagged.length, ym(top.x)) : ML.verdict.iforestNone,
        cells: [
          { label: ML.cell.flagged, value: String(s.flagged.length), sub: ML.sub.percentile },
          ...(top ? [{ label: ML.cell.strongest, value: ym(top.x), sub: `${val(top.value)} · ${ML.sub.score(num(top.score, 2))}` }] : []),
          { label: ML.cell.threshold, value: num(s.threshold, 2) },
        ],
        details: [
          { label: ML.row.records, value: RV.months(s.n) }, { label: ML.row.trees, value: String(s.trees) }, { label: ML.row.sample, value: RV.months(s.sample) },
          { label: ML.cell.threshold, value: num(s.threshold, 2) },
          ...s.flagged.map((f) => ({ label: ML.cell.flagged, value: ML.rowValue.flagged(ym(f.x), val(f.value), ML.sub.score(num(f.score, 2))) })),
        ],
        method: ML.method.iforest, figure: "iforest", caveat: ML.caveat.iforest,
      };
    }
    case "bocpd": {
      const first = s.changes[0];
      let step: { size: number; at: number } | null = null;
      for (let i = 1; i < s.segments.length; i++) {
        const d = s.segments[i].mean - s.segments[i - 1].mean;
        if (Number.isFinite(d) && (!step || Math.abs(d) > Math.abs(step.size))) step = { size: d, at: s.segments[i].x0 };
      }
      const sure = s.changes.reduce<{ x: number; p: number } | null>((b, c) => (!b || c.p > b.p ? c : b), null);
      return {
        significant: null, note: L.descriptive,
        headline: first ? ML.verdict.bocpd(s.changes.length, ym(first.x)) : ML.verdict.bocpdNone,
        cells: [
          { label: ML.cell.changes, value: String(s.changes.length), sub: ML.sub.steps(s.segments.length) },
          ...(step ? [{ label: ML.cell.largestStep, value: val(step.size), sub: ym(step.at) }] : []),
          ...(sure ? [{ label: ML.cell.mostCertain, value: `${pct(sure.p)} %`, sub: ym(sure.x) }] : []),
        ],
        details: [
          { label: ML.row.hazard, value: ML.rowValue.hazard },
          ...s.changes.map((c, k) => ({ label: ML.row.changeRow(k + 1), value: ML.rowValue.change(ym(c.x), pct(c.p)) })),
          ...s.segments.map((g, k) => ({ label: ML.row.segment(k + 1), value: ML.rowValue.segment(span(g.x0, g.x1), val(g.mean)) })),
        ],
        method: ML.method.bocpd, figure: "bocpd", caveat: ML.caveat.bocpd,
      };
    }
    case "gp": {
      let long: GpSpan | null = null;
      for (const g of s.spans) if (!long || g.x1 - g.x0 > long.x1 - long.x0) long = g;
      const len = (g: GpSpan) => g.x1 - g.x0 + 1;
      return {
        significant: null, note: L.descriptive,
        headline: long ? ML.verdict.gp(long.sign < 0, span(long.x0, long.x1)) : ML.verdict.gpNone,
        cells: [
          { label: ML.cell.departures, value: String(s.spans.length) },
          ...(long ? [{ label: ML.cell.longest, value: RV.months(len(long)), sub: span(long.x0, long.x1) }] : []),
          { label: ML.cell.smoothness, value: RV.months(s.lengthScale), sub: ML.sub.scale },
        ],
        details: [
          { label: ML.row.n, value: RV.months(s.n) }, { label: ML.row.scaleRow, value: RV.months(s.lengthScale) },
          { label: ML.row.share, value: `${pct(s.signalShare)} %` },
          ...s.spans.map((g) => ({ label: g.sign > 0 ? ML.row.above : ML.row.below, value: ML.sub.spanMonths(span(g.x0, g.x1), len(g)) })),
        ],
        method: ML.method.gp, figure: "gp", caveat: ML.caveat.gp,
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
