// Run from web/: npx tsx --test lib/detective/analysis.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decompose, intervalStats, trendStats } from "./analysis";
import type { AnalysisApi, Decomposition, MonthlySeries } from "./contracts";

const api: AnalysisApi = { decompose, intervalStats, trendStats };
const event = { start: "2018-01", end: "2018-12" };

function month(index: number, start = "2000-01"): string {
  const date = new Date(`${start}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + index);
  return date.toISOString().slice(0, 7);
}

function close(actual: number | null, expected: number, tolerance = 1e-9) {
  assert.ok(actual !== null && Number.isFinite(actual), `Expected finite value, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

function finiteTree(value: unknown): void {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `Non-finite output: ${value}`);
  else if (Array.isArray(value)) value.forEach(finiteTree);
  else if (value && typeof value === "object") Object.values(value).forEach(finiteTree);
}

function noise(seed = 42) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 2 ** 32 - 0.5) * Math.sqrt(12);
  };
}

function synthetic(slope = 0.03, sigma = 0, start = "2000-01", length = 480): MonthlySeries {
  const random = noise();
  const offset = Number(start.slice(5)) - 1;
  return {
    layer: "test-synthetic", unit: "test-unit", start,
    values: Array.from({ length }, (_, i) =>
      100 + slope * i + 8 * Math.sin(2 * Math.PI * ((i + offset) % 12) / 12) + sigma * random()),
  };
}

function residualFixture(values: (number | null)[]): Decomposition {
  const months = values.map((_, i) => month(i));
  return {
    months, raw: values.slice(), residual: values.slice(), z: values.map(v => v === null ? null : v / 2),
    trend: values.map(() => 0), seasonal: values.map(() => 0),
    baseline: { months, n: values.filter(v => v !== null).length,
      excluded: { start: "1990-01", end: "1990-12" } },
  };
}

function correlatedSeries(slope: number): MonthlySeries {
  const random = noise();
  let ar = 0;
  const series = synthetic(slope, 0, "2000-01", 240);
  series.values = series.values.map(v => {
    ar = 0.7 * ar + random();
    return v! + ar;
  });
  return series;
}

describe("decompose", () => {
  it("recovers a known slope and calendar season despite an asymmetric excluded interval", () => {
    const series = synthetic(0.01, 0, "2000-07", 300);
    const d = api.decompose(series, { start: "2002-11", end: "2003-04" }, 12);
    close((d.trend.at(-1)! - d.trend[0]) / 299, 0.01, 1e-10);
    d.seasonal.forEach((v, i) => close(v, 8 * Math.sin(2 * Math.PI * (i + 6) / 12), 1e-8));
    d.residual.forEach(v => close(v, 0, 1e-8));
    assert.equal(d.months[0], "2000-07");
    assert.equal(d.months.at(-1), "2025-06");
    assert.deepEqual(d.baseline.excluded, { start: "2001-11", end: "2004-04" });
  });

  it("recovers trend within 5% and the seasonal cycle from noisy synthetic observations", () => {
    const d = decompose(synthetic(0.03, 1), event, 12);
    close((d.trend[479] - d.trend[0]) / 479, 0.03, 0.03 * 0.05);
    const mse = d.seasonal.slice(0, 12).reduce((s, v, m) =>
      s + (v - 8 * Math.sin(2 * Math.PI * m / 12)) ** 2, 0) / 12;
    assert.ok(Math.sqrt(mse) < 0.3, `Seasonal RMSE: ${Math.sqrt(mse)}`);
  });

  it("keeps the event and both pad boundaries out of trend, season, and sigma", () => {
    const series = synthetic(0.03, 1);
    const before = decompose(series, event, 12);
    const changed = { ...series, values: series.values.map((v, i) =>
      month(i) >= "2017-01" && month(i) <= "2019-12" ? v! + 1e20 : v) };
    const after = decompose(changed, event, 12);
    assert.deepEqual(after.trend, before.trend);
    assert.deepEqual(after.seasonal, before.seasonal);
    assert.deepEqual(after.baseline, before.baseline);
    assert.equal(before.baseline.n, 444);
    assert.equal(before.baseline.months.length, 444);
    before.months.forEach((m, i) => {
      if (m < "2017-01" || m > "2019-12") close(after.z[i], before.z[i]!, 1e-12);
    });
  });

  for (const missing of [3, 4]) {
    it(`uses the original calendar-year coverage rule with ${missing} missing months`, () => {
      const series = synthetic(0.03, 0.3);
      for (let m = 0; m < 12; m++) {
        const i = 10 * 12 + m;
        if (m < missing) series.values[i] = null;
      }
      const before = decompose(series, event, 12);
      for (let m = missing; m < 12; m++) series.values[120 + m]! += 5 + m;
      const after = decompose(series, event, 12);
      if (missing === 4) assert.deepEqual(after.seasonal, before.seasonal);
      else assert.ok(after.seasonal.some((v, i) => Math.abs(v - before.seasonal[i]) > 0.1));
      assert.notDeepEqual(after.trend, before.trend);
    });
  }

  it("preserves missing positions and input data without emitting NaN", () => {
    const series = synthetic(0.03, 1);
    for (const i of [0, 19, 99, 100, 101, 102, 240, 479]) series.values[i] = null;
    series.values[20] = NaN;
    series.values[21] = Infinity;
    const original = structuredClone(series);
    const d = decompose(series, event, 12);
    assert.deepEqual(series, original);
    assert.equal(d.raw.length, series.values.length);
    series.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        assert.equal(d.raw[i], null);
        assert.equal(d.residual[i], null);
        assert.equal(d.z[i], null);
      } else close(d.raw[i]! - d.trend[i] - d.seasonal[i], d.residual[i]!);
    });
    finiteTree(d);
    finiteTree(intervalStats(d, event));
    finiteTree(trendStats(series));
  });

  it("returns null z scores when a constant baseline has no residual variance", () => {
    const series = synthetic(0);
    series.values.fill(5);
    const d = decompose(series, event, 12);
    d.residual.forEach(v => close(v, 0));
    assert.ok(d.z.every(v => v === null));
    finiteTree(d);
  });

  it("rejects an unidentifiable baseline instead of inventing fitted curves", () => {
    assert.throws(() => decompose(synthetic(), { start: "1990-01", end: "2050-01" }, 12), RangeError);
    assert.throws(() => decompose({ ...synthetic(), values: [] }, event, 12), RangeError);
    assert.throws(() => decompose({ ...synthetic(), values: Array(48).fill(null) }, event, 12), RangeError);
    const noJanuary = synthetic();
    noJanuary.values = noJanuary.values.map((v, i) => i % 12 === 0 ? null : v);
    assert.throws(() => decompose(noJanuary, event, 12), RangeError);
  });

  it("rejects invalid dates, reversed intervals, and invalid padding", () => {
    for (const start of ["2020-13", "2020-00", "2020-1", "garbage"]) {
      assert.throws(() => decompose({ ...synthetic(), start }, event, 12), RangeError);
    }
    assert.throws(() => decompose(synthetic(), { start: "2019-01", end: "2018-01" }, 12), RangeError);
    for (const pad of [-1, 1.5, NaN, Infinity]) {
      assert.throws(() => decompose(synthetic(), event, pad), RangeError);
    }
  });
});

describe("intervalStats", () => {
  it("finds an injected -3 sigma event as the lowest same-length historical interval", () => {
    const series = synthetic(0.03, 1);
    for (let i = 18 * 12; i < 19 * 12; i++) {
      series.values[i] = 100 + 0.03 * i + 8 * Math.sin(2 * Math.PI * (i % 12) / 12) - 3;
    }
    const d = decompose(series, event, 12);
    const result = intervalStats(d, event);
    close(result.meanZ, -3, 0.25);
    assert.equal(result.n, 12);
    assert.deepEqual(result.rank, { position: 1, of: 469, direction: "low" });
  });

  it("ranks all overlapping calendar windows in the direction of the anomaly", () => {
    const d = residualFixture([-4, -2, 2, 4, 6]);
    const low = intervalStats(d, { start: "2000-01", end: "2000-02" });
    close(low.meanResidual, -3);
    close(low.meanZ, -1.5);
    assert.deepEqual(low.rank, { position: 1, of: 4, direction: "low" });
    close(low.percentile, 12.5);
    const high = intervalStats(d, { start: "2000-04", end: "2000-05" });
    close(high.meanResidual, 5);
    assert.deepEqual(high.rank, { position: 1, of: 4, direction: "high" });
    close(high.percentile, 87.5);
  });

  it("uses competition ranks and a midpoint empirical percentile for ties", () => {
    const d = residualFixture([-2, -2, 1, 3]);
    for (const m of ["2000-01", "2000-02"]) {
      const result = intervalStats(d, { start: m, end: m });
      assert.deepEqual(result.rank, { position: 1, of: 4, direction: "low" });
      close(result.percentile, 25);
    }
    close(intervalStats(d, { start: "2000-01", end: "2000-04" }).percentile, 50);
  });

  it("keeps cancellation roundoff from ranking a window outside the comparison population", () => {
    const d = residualFixture([0.1, 0.2, -0.3, 0.1, 0.2, -0.3]);
    const result = intervalStats(d, { start: "2000-02", end: "2000-04" });
    assert.equal(result.rank?.position, 1);
    assert.equal(result.rank?.of, 4);
    close(result.percentile, 50);
    const tiny = residualFixture([-4e-20, -2e-20, 2e-20, 4e-20]);
    const distinct = intervalStats(tiny, { start: "2000-01", end: "2000-01" });
    assert.deepEqual(distinct.rank, { position: 1, of: 4, direction: "low" });
    close(distinct.percentile, 12.5);
  });

  it("keeps missing windows out of ranks and incomplete selections descriptive", () => {
    const d = residualFixture([-4, null, 2, 4, 6]);
    const complete = intervalStats(d, { start: "2000-04", end: "2000-05" });
    assert.deepEqual(complete.rank, { position: 1, of: 2, direction: "high" });
    const incomplete = intervalStats(d, { start: "2000-01", end: "2000-02" });
    assert.equal(incomplete.n, 1);
    close(incomplete.meanResidual, -4);
    assert.equal(incomplete.rank, null);
    assert.equal(incomplete.percentile, null);
    const beyond = intervalStats(d, { start: "1999-12", end: "2000-01" });
    assert.equal(beyond.n, 1);
    assert.equal(beyond.rank, null);
    const empty = intervalStats(d, { start: "1990-01", end: "1990-02" });
    assert.equal(empty.n, 0);
    for (const key of ["meanResidual", "meanZ", "percentile", "rank"] as const) assert.equal(empty[key], null);
    finiteTree([complete, incomplete, beyond, empty]);
  });
});

describe("trendStats", () => {
  it("matches an independent AR(1) reference for corrected MK, Sen CI, and additional years", () => {
    const result = trendStats(correlatedSeries(0.003));
    // Reference: Python dummy-variable OLS (13 columns, pivoted elimination),
    // pairwise Sen ranks and tie-corrected MK with n*(1-rho)/(1+rho).
    close(result.senPerDecade, 0.5863321957607815, 1e-6);
    close(result.nEff, 40.23706326944503, 1e-6);
    close(result.mkP, 0.1628680659780168, 1e-6);
    assert.ok(result.ci95);
    close(result.ci95[0], -0.24832167277329945, 1e-6);
    close(result.ci95[1], 1.4164499353979916, 1e-6);
    assert.equal(result.significant, false);
    close(result.yearsToSignificance, 5.2629431584817965, 1e-5);
    finiteTree(result);
  });

  it("matches a calendar-gap reference without treating separated observations as lag-1 pairs", () => {
    const series = correlatedSeries(0.003);
    series.values = series.values.map((v, i) =>
      (i % 12 - Math.floor(i / 12) + 24) % 12 < 3 ? null : v);
    const result = trendStats(series);
    close(result.senPerDecade, 0.6747344842815597, 1e-6);
    close(result.nEff, 41.04057212948884, 1e-6);
    close(result.mkP, 0.10667606402007847, 1e-6);
    assert.ok(result.ci95);
    close(result.ci95[0], -0.14225334588488275, 1e-6);
    close(result.ci95[1], 1.455265371425885, 1e-6);
    close(result.yearsToSignificance, 2.3515365871078764, 1e-5);
  });

  it("returns additional years near significance, and null for a forecast over 50 years", () => {
    const near = trendStats(correlatedSeries(0.005));
    assert.equal(near.significant, false);
    close(near.mkP, 0.05195069860919321, 1e-6);
    close(near.yearsToSignificance, 0.0975594881778008, 1e-5);
    const distant = trendStats(correlatedSeries(-0.0018));
    assert.equal(distant.significant, false);
    close(distant.senPerDecade, 0.01033219576085022, 1e-6);
    assert.equal(distant.yearsToSignificance, null);
  });

  for (const slope of [-0.04, 0.04]) {
    it(`retains a ${slope}/month trend after removing seasonality and scales by 120`, () => {
      const result = trendStats(synthetic(slope, 0.3));
      close(result.senPerDecade, slope * 120, Math.abs(slope * 120) * 0.05);
      assert.ok(result.ci95 && result.ci95[0] < result.ci95[1]);
      assert.ok(result.ci95[0] <= slope * 120 && result.ci95[1] >= slope * 120);
      assert.equal(result.significant, true);
      assert.ok(result.mkP !== null && result.mkP < 0.05);
      assert.equal(result.yearsToSignificance, null);
      assert.ok(result.nEff !== null && result.nEff > 0 && result.nEff <= 480);
      finiteTree(result);
    });
  }

  it("uses actual calendar gaps for Sen slope instead of compressing observed months", () => {
    const series = synthetic(1, 0, "2000-01", 120);
    series.values = series.values.map((v, i) => i > 60 && i % 2 === 0 ? null : v);
    const result = trendStats(series);
    close(result.senPerDecade, 120, 1e-8);
    finiteTree(result);
  });

  it("does not report a trend from a repeated annual cycle or a constant series", () => {
    for (const series of [synthetic(0), { ...synthetic(0), values: Array(480).fill(5) }]) {
      const result = trendStats(series);
      close(result.senPerDecade, 0, 1e-9);
      close(result.mkP, 1);
      assert.equal(result.significant, false);
      assert.equal(result.yearsToSignificance, null);
      finiteTree(result);
    }
  });

  it("reports unavailable statistics for empty or unidentifiable seasonal data", () => {
    for (const values of [[], [1, 2], Array(48).fill(null)]) {
      const result = trendStats({ ...synthetic(), values });
      assert.equal(result.senPerDecade, null);
      assert.equal(result.mkP, null);
      assert.equal(result.significant, null);
      assert.equal(result.yearsToSignificance, null);
      finiteTree(result);
    }
  });
});
