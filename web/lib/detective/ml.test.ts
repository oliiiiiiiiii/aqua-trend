// Run from web/: npx tsx --test lib/detective/ml.test.ts
// Each test plants a known structure in synthetic data and checks that the method recovers it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analogSearch, arForecast, bocpd, gpSmooth, hmmRegimes, isolationForest, matrixProfile } from "./ml";

function noise(seed: number) {
  let s = seed;
  return () => {
    // sum of uniforms ≈ standard normal, deterministic
    let t = 0;
    for (let k = 0; k < 6; k++) { s = (s * 16807) % 2147483647; t += s / 2147483647; }
    return (t - 3) * Math.SQRT2;
  };
}

describe("analogue search", () => {
  it("finds the planted repeat of the query's shape", () => {
    const e = noise(5);
    const v: (number | null)[] = Array.from({ length: 240 }, () => 0.3 * e());
    const shape = [-1, -2, -3, -2.5, -1.5, -0.5];
    shape.forEach((s, k) => { v[150 + k] = s; v[40 + k] = s + 0.05 * e(); });
    v[100] = null;
    const r = analogSearch(v, 150, 155);
    assert.equal(r.matches[0].start, 40);
    assert.ok(r.matches[0].corr! > 0.95);
    assert.ok(r.matches[0].distance < r.typical / 5);
    assert.equal(r.dtw[0].start, 40);
    assert.equal(r.matches.length, 3);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.abs(r.matches[i].start - r.matches[j].start) >= 6);
  });
});

describe("hidden Markov model", () => {
  it("recovers dry and wet regimes", () => {
    const e = noise(9);
    const truth = Array.from({ length: 180 }, (_, i) => (Math.floor(i / 30) % 2 ? 1 : 0));
    const v = truth.map((s) => (s ? 2 : -2) + 0.5 * e());
    const r = hmmRegimes(v, 0, 179);
    const low = 0, high = r.K - 1;
    let agree = 0;
    r.path.forEach((s, i) => { if ((truth[i] === 0 && s === low) || (truth[i] === 1 && s === high)) agree++; });
    assert.ok(agree / 180 > 0.95, `agreement ${agree / 180}`);
    assert.ok(r.states[0].mean < -1.5 && r.states[r.K - 1].mean > 1.5);
    assert.ok(r.states[0].expectedDuration > 10);
    assert.equal(r.longestLow!.to - r.longestLow!.from + 1, 30);
  });
});

describe("AR forecast", () => {
  const e = noise(3);
  const v: number[] = [];
  let x = 0;
  for (let i = 0; i < 200; i++) { x = 0.7 * x + e(); v.push(x); }
  it("recovers the AR coefficient and is not surprised by more of the same", () => {
    const r = arForecast(v, 170, 181)!;
    assert.ok(Math.abs(r.coef[0] - 0.7) < 0.15, `phi ${r.coef[0]}`);
    assert.ok(r.pValue > 0.05);
    assert.ok(r.hi[11] - r.lo[11] > r.hi[0] - r.lo[0]);
  });
  it("flags a planted shift as a surprise", () => {
    const shifted = v.map((y, i) => (i >= 170 && i <= 181 ? y + 4 : y));
    const r = arForecast(shifted, 170, 181)!;
    assert.ok(r.pValue < 0.001);
    assert.ok(r.outside >= 6);
  });
  it("needs training data before the range", () => {
    assert.equal(arForecast(v, 10, 20), null);
  });
});

describe("matrix profile", () => {
  it("finds the planted odd window and a planted repeat", () => {
    const v: (number | null)[] = Array.from({ length: 200 }, (_, i) => Math.sin(i / 3));
    [3, -3, 3, -3, 3, -3].forEach((s, k) => { v[120 + k] = s; });
    const r = matrixProfile(v, 0, 199);
    const w6 = r.windows.find((w) => w.m === 6)!;
    assert.ok(Math.abs(w6.discord!.start - 120) <= 2, `discord ${w6.discord!.start}`);
    assert.ok(w6.motif!.distance < w6.discord!.distance / 100);
    assert.equal(r.profileM, 6);
  });
});

describe("isolation forest", () => {
  it("flags planted extreme months", () => {
    const e = noise(11);
    const v = Array.from({ length: 300 }, () => 0.5 * e());
    v[200] = 6; v[250] = -6;
    const r = isolationForest(v, 0, 299);
    const flagged = new Set(r.flagged.map((f) => f.x));
    assert.ok(flagged.has(200) && flagged.has(250));
    assert.ok(r.scores[200]! > 0.6);
    assert.deepEqual(isolationForest(v, 0, 299).flagged, r.flagged);
  });
});

describe("Bayesian change points", () => {
  it("detects a mean shift near where it was planted", () => {
    const e = noise(13);
    const v = Array.from({ length: 160 }, (_, i) => (i < 80 ? 0 : 2.5) + 0.6 * e());
    const r = bocpd(v, 0, 159);
    assert.ok(r.changes.some((c) => Math.abs(c.x - 80) <= 2), JSON.stringify(r.changes));
    assert.ok(r.segments[r.segments.length - 1].mean > 2);
  });
});

describe("Gaussian process", () => {
  it("smooths a noisy slow cycle and marks where it is clearly above zero", () => {
    const e = noise(17);
    const truth = Array.from({ length: 120 }, (_, i) => 2 * Math.sin((2 * Math.PI * i) / 60));
    const v: (number | null)[] = truth.map((t) => t + 0.6 * e());
    v[20] = null;
    const r = gpSmooth(v, 0, 119)!;
    const err = Math.sqrt(r.mean.reduce((s, m, i) => s + (m - truth[i]) ** 2, 0) / 120);
    assert.ok(err < 0.4, `rmse ${err}`);
    assert.ok(r.lengthScale >= 6);
    assert.ok(r.spans.some((s) => s.sign === 1 && s.x0 < 15 && s.x1 > 15));
  });
});
