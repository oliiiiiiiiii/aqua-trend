// Run from web/: npx tsx --test lib/detective/lab.test.ts
// Reference values from scipy 1.18 (linregress, ttest_1samp, wilcoxon, ttest_ind(equal_var=False),
// mannwhitneyu, jarque_bera, chi2.sf). The samples have lag-1 correlation < 0, so nEff = n and
// the autocorrelation correction is inactive: the results must match the textbook tests exactly.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { binomialTest, chiSquareSf, fSf } from "../stats";
import {
  LAB_TOOLS, acfTest, bootstrapTest, compareTest, cusumTest, effectiveN, extremesTest, holm, labSample, lagCorrelation, meanTest, mkTest,
  monthlyTest, normalityTest, olsTest, permutationTest, pettittTest, piecewiseTest, runLabTool, runsTest, spectrumTest,
  varianceTest, wilcoxonTest,
} from "./lab";
import type { Decomposition } from "./contracts";

const Y = [2.341, -2.236, 0.758, -0.208, -0.073, 0.184, -1.6, 0.208, -0.405, 3.803, 0.726, 0.167, 0.259, -0.108, -0.475, 0.209, 1.102, 0.401, 1.618, 0.48, 0.724, 2.266, 1.285, 0.255, 0.597, 1.341, 2.755, 0.57, 0.616, 1.882, 0.014, 0.628, 1.823, 1.54, 1.072, 1.67, -1.808, 2.061, 0.1, -0.589];
const B = [0.359, 0.911, -0.578, -1.399, 0.034, -0.069, 1.827, 0.972, 0.252, 1.445, -0.267, -1.204, 0.759, 0.757, -0.279, -1.018, 0.298, -3.242, 0.897, 0.639, -2.131, 0.08, -1.253, 0.984, -2.644, -1.189, 0.922, 1.503, -2.805, -0.647, 0.426, -0.792, 2.068, -1.549, 0.461, -1.363, 1.828, -0.028, -0.484, -2.234, 2.186, 0.979, 0.98, 1.479, 0.454, -0.831, -1.04, -1.04, 1.781, -1.898, -0.775, -0.418, 0.292, 0.748, -1.624, -2.249, -0.006, 1.578, 0.984, 0.28];

const close = (a: number, e: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - e) <= tol * Math.max(1, Math.abs(e)), `expected ${a} ≈ ${e}`);

/** y placed at month indices offset.. (earlier months missing). */
const sample = (y: number[], offset = 0) =>
  labSample([...new Array<null>(offset).fill(null), ...y], offset, offset + y.length - 1);
const ys = sample(Y);

describe("chiSquareSf", () => {
  it("matches scipy chi2.sf", () => {
    close(chiSquareSf(3.7, 1), 0.054412467991601404);
    close(chiSquareSf(25, 12), 0.014822874597441575);
    close(chiSquareSf(0.4, 7), 0.9997365611075912);
    close(chiSquareSf(80, 30), 1.9756232434910563e-06, 1e-5);
  });
});

describe("serial correlation", () => {
  it("only pairs months exactly `lag` apart", () => {
    const s = labSample([1, 2, null, 4, 5, null, 7, 8], 0, 7);
    assert.equal(s.n, 6);
    assert.equal(lagCorrelation(s.x, s.y, 1), (() => {
      const m = (1 + 2 + 4 + 5 + 7 + 8) / 6;
      const den = [1, 2, 4, 5, 7, 8].reduce((a, v) => a + (v - m) ** 2, 0) / 6;
      return (((1 - m) * (2 - m) + (4 - m) * (5 - m) + (7 - m) * (8 - m)) / 3) / den;
    })());
  });
  it("treats negative correlation as independent and shrinks n for positive", () => {
    assert.equal(effectiveN(100, -0.3), 100);
    close(effectiveN(100, 0.5), 100 / 3);
  });
});

describe("tests without autocorrelation match scipy", () => {
  it("OLS t-test", () => {
    const r = olsTest(ys);
    close(r.slope, 0.019674015009380878);
    close(r.r2, 0.036891886989890904);
    close(r.naive.se, 0.016306970513595916);
    close(r.naive.p, 0.2350905356590765);
    assert.equal(r.nEff, 40);
    close(r.p, r.naive.p);
  });
  it("one-sample t-test", () => {
    const r = meanTest(ys);
    close(r.t, 3.426878497691535);
    close(r.p, 0.0014526121834286352);
    assert.ok(r.ci95[0] > 0);
  });
  it("Wilcoxon signed-rank (normal approx., continuity)", () => {
    close(wilcoxonTest(ys).p, 0.0006090103523592707, 1e-5);
  });
  it("Welch t and Mann–Whitney U", () => {
    const r = compareTest(ys, sample(B, 100));
    close(r.welch.t, 2.9436816258187193);
    close(r.welch.p, 0.0041396900405705084);
    assert.equal(r.mannWhitney.U, 1546);
    close(r.mannWhitney.p, 0.015059537619802256, 1e-5);
  });
  it("skewness, kurtosis and Jarque–Bera", () => {
    const r = normalityTest(ys);
    close(r.skew, 0.03737182635247211);
    close(r.kurtosis, 0.6200014090833763);
    close(r.jb, 0.6499806014750824);
    close(r.p, 0.722534361658495);
    assert.equal(r.hist.reduce((a, b) => a + b.count, 0), 40);
  });
});

describe("autocorrelation correction", () => {
  // AR(1)-like noise around a weak trend: strong positive lag-1 correlation.
  const ar: number[] = [];
  let v = 0, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < 120; i++) { v = 0.8 * v + rnd(); ar.push(v + 0.002 * i); }
  const s = sample(ar);
  it("makes OLS and MK p-values larger than the naive ones", () => {
    const o = olsTest(s);
    assert.ok(o.lag1! > 0.5 && o.nEff < 40);
    assert.ok(o.p > o.naive.p);
    const m = mkTest(s);
    assert.ok(m.p > m.pNaive);
    assert.ok(m.ci95[0] <= m.sen && m.sen <= m.ci95[1]);
  });
  it("Ljung–Box flags it", () => {
    const r = acfTest(s);
    assert.ok(r.acf[0]! > 0.5);
    assert.ok(r.ljungBox.p < 0.001);
    assert.equal(r.ljungBox.df, 12);
  });
});

describe("Pettitt", () => {
  it("finds the step and its side means", () => {
    const y = Array.from({ length: 30 }, (_, i) => (i < 18 ? 0 : 2) + 0.1 * Math.sin(i * 1.7));
    const r = pettittTest(sample(y, 5));
    assert.equal(r.splitAt, 5 + 17);
    assert.equal(r.nBefore, 18);
    assert.ok(r.p < 0.01);
    assert.ok(r.meanAfter - r.meanBefore > 1.8);
  });
});

describe("bootstrap", () => {
  it("is deterministic and brackets the estimates", () => {
    const a = bootstrapTest(ys), b = bootstrapTest(ys);
    assert.deepEqual(a.mean.ci95, b.mean.ci95);
    assert.ok(a.mean.ci95[0] < a.mean.est && a.mean.est < a.mean.ci95[1]);
    assert.ok(a.slope.ci95[0] < a.slope.est && a.slope.est < a.slope.ci95[1]);
    assert.ok(a.mean.p < 0.05);
    assert.ok(a.slope.p > 0.05);
  });
});

describe("runLabTool", () => {
  const months = Array.from({ length: 48 }, (_, i) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
  const residual: (number | null)[] = months.map((_, i) => (i === 5 ? null : Math.sin(i)));
  const d = {
    months, residual, raw: residual, trend: months.map(() => 0), seasonal: months.map(() => 0), z: residual,
    baseline: { months, excluded: { start: "2003-12", end: "2003-12" }, n: 48 },
  } as unknown as Decomposition;

  it("refuses ranges that are too short", () => {
    const r = runLabTool("acf", d, 4, 6); // index 5 is missing: 2 observed
    assert.equal(r.kind, "insufficient");
    if (r.kind === "insufficient") { assert.equal(r.n, 2); assert.equal(r.need, 4); }
  });
  it("draws the fitted line across the range", () => {
    const r = runLabTool("ols", d, 10, 40);
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") { assert.equal(r.segments[0].x0, 10); assert.equal(r.segments[0].x1, 40); }
  });
  it("compares the range with every other month", () => {
    const r = runLabTool("compare", d, 0, 11);
    assert.equal(r.kind, "ok");
    if (r.kind === "ok" && r.stats.tool === "compare") { assert.equal(r.stats.a.n, 11); assert.equal(r.stats.b.n, 36); }
  });
});

describe("distribution helpers", () => {
  it("F tail and exact binomial match scipy", () => {
    close(fSf(3.2, 2, 40), 0.051385456071628095);
    close(fSf(0.5, 1, 10), 0.4956475043831199);
    close(binomialTest(7, 40, 0.05).pTwoSided, 0.0033918975779359773);
    close(binomialTest(7, 40, 0.05).pUpper, 0.0033918975779359773);
    close(binomialTest(0, 60, 0.05).pTwoSided, 0.07576390094183538);
  });
  it("Holm keeps only what survives the step-down", () => {
    assert.deepEqual(holm([0.01, 0.04, 0.03, 0.2]), [true, false, false, false]);
    assert.deepEqual(holm([0.001, 0.012, 0.03]), [true, true, true]);
  });
});

describe("more tools", () => {
  const months = Array.from({ length: 40 }, (_, i) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
  it("Kruskal–Wallis across calendar months matches scipy", () => {
    const r = monthlyTest(ys, months);
    close(r.H, 9.510975609756088);
    close(r.p, 0.574835314272611);
    assert.equal(r.byMonth[0].n, 4);
  });
  it("cumulative anomaly finds the deficit", () => {
    const y = [1, 1, -2, -3, -1, 0.5, 2];
    const r = cusumTest(sample(y));
    close(r.total, -1.5);
    assert.deepEqual(r.deficit, { from: 2, to: 4, amount: 6 });
    assert.equal(r.surplus!.amount, 2.5);
  });
  it("finds the longest streak; persistence makes it less surprising", () => {
    const y = Array.from({ length: 60 }, (_, i) => (i >= 20 && i < 34 ? -1 - (i % 3) * 0.1 : (i % 2 ? 1 : -1) * 0.5));
    const r = runsTest(sample(y), 0.6);
    assert.equal(r.longest.length, 15);
    assert.equal(r.longest.sign, -1);
    assert.ok(r.pIndependent < 0.05);
    assert.ok(r.pPersistent > r.pIndependent);
  });
  it("counts extreme months against the baseline rate", () => {
    const z = [3, -2.5, 0, 0.1, 2.1, ...new Array(35).fill(0.2)];
    const r = extremesTest(sample(z), 0.05);
    assert.equal(r.high, 2);
    assert.equal(r.low, 1);
    close(r.expected, 2);
  });
  it("detects higher variability", () => {
    const calm = Array.from({ length: 60 }, (_, i) => 0.2 * Math.sin(i * 2.1));
    const wild = Array.from({ length: 24 }, (_, i) => 2 * Math.sin(i * 2.1));
    const r = varianceTest(sample(wild, 100), sample(calm));
    assert.ok(r.ratio > 5);
    assert.ok(r.p < 0.001);
  });
  it("Lomb–Scargle finds a 40-month cycle through missing months", () => {
    const y: (number | null)[] = Array.from({ length: 240 }, (_, i) => (i % 17 === 3 ? null : Math.sin((2 * Math.PI * i) / 40) + 0.3 * Math.sin(i * 1.3)));
    const r = spectrumTest(labSample(y, 0, 239));
    assert.ok(Math.abs(r.peaks[0].period - 40) < 2, `peak at ${r.peaks[0].period}`);
    assert.ok(r.peaks[0].significant);
  });
  it("hinge regression finds the break and both slopes", () => {
    const y = Array.from({ length: 80 }, (_, i) => (i < 50 ? 0.0 : 0.1 * (i - 50)) + 0.05 * Math.sin(i * 2.3));
    const r = piecewiseTest(sample(y))!;
    assert.ok(Math.abs(r.breakAt - 50) <= 1);
    assert.ok(Math.abs(r.slopeBefore) < 0.01);
    close(r.slopeAfter, 0.1, 0.05);
    assert.ok(r.p < 0.001);
  });
  it("permutation: block shuffling is more cautious than single-month shuffling", () => {
    const ar: number[] = [];
    let v = 0, seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < 120; i++) { v = 0.85 * v + rnd(); ar.push(v + 0.004 * i); }
    const r = permutationTest(sample(ar));
    assert.ok(r.p >= r.pNaive);
    assert.equal(permutationTest(sample(ar)).p, r.p);
  });
});

describe("short ranges", () => {
  const steps = (n: number) => {
    const months = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2021, 2, 1 + i)).toISOString().slice(0, 10));
    const residual = months.map((_, i) => Math.sin(i) + i * 0.1);
    return { months, residual, raw: residual, trend: months.map(() => 0), seasonal: months.map(() => 0), z: residual.map(() => null),
      baseline: { months: [], excluded: { start: "2021-03", end: "2021-03" }, n: 0 } } as unknown as Decomposition;
  };
  it("every tool answers or says insufficient on 1, 2, 7 and 30 steps, never throws", () => {
    for (const n of [1, 2, 7, 30]) {
      const d = steps(n);
      for (const t of LAB_TOOLS) {
        const o = runLabTool(t, d, 0, n - 1);
        assert.ok(o.kind === "ok" || o.kind === "insufficient", `${t} on ${n}`);
      }
    }
  });
  it("seven days get a mean test and a trend; one day gets the cumulative anomaly", () => {
    const d = steps(7);
    assert.equal(runLabTool("mean", d, 0, 6).kind, "ok");
    assert.equal(runLabTool("mk", d, 0, 6).kind, "ok");
    assert.equal(runLabTool("ols", d, 0, 6).kind, "ok");
    assert.equal(runLabTool("cusum", d, 3, 3).kind, "ok");
  });
});
