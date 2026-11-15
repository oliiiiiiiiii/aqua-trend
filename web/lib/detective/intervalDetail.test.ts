// Run from web/: npx tsx --test lib/detective/intervalDetail.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decompose } from "./analysis";
import type { Decomposition, MonthlySeries, TimeRange } from "./contracts";
import { baselineInfo, intervalDetail, relationToEvent, type BaselineInfo } from "./intervalDetail";

const event: TimeRange = { start: "2010-01", end: "2010-04" };
const PAD = 12;
// Record 2000-01..2019-12 (240 months); excluded block 2009-01..2011-04 (index 108..135).

function month(index: number, start = "2000-01"): string {
  const date = new Date(`${start}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + index);
  return date.toISOString().slice(0, 7);
}

function indexOf(ym: string): number {
  return (Number(ym.slice(0, 4)) - 2000) * 12 + Number(ym.slice(5)) - 1;
}

function lcg(seed = 7) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 2 ** 32 - 0.5) * Math.sqrt(12); // unit variance
  };
}

interface Options {
  base?: number;
  phi?: number;
  seed?: number;
  length?: number;
  plant?: { range: TimeRange; delta: number };
  missing?: string[];
}

function makeSeries(o: Options = {}): MonthlySeries {
  const { base = 100, phi = 0, seed = 7, length = 240 } = o;
  const random = lcg(seed);
  let ar = 0;
  const values: (number | null)[] = Array.from({ length }, (_, i) => {
    ar = phi * ar + Math.sqrt(1 - phi * phi) * random();
    let v = base + 0.02 * i + 8 * Math.sin(2 * Math.PI * (i % 12) / 12) + ar;
    if (o.plant && i >= indexOf(o.plant.range.start) && i <= indexOf(o.plant.range.end)) v += o.plant.delta;
    return v;
  });
  for (const m of o.missing ?? []) values[indexOf(m)] = null;
  return { layer: "test", unit: "u", start: "2000-01", values };
}

function build(o: Options = {}): Decomposition {
  return decompose(makeSeries(o), event, PAD);
}

function finiteTree(value: unknown): void {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `Non-finite output: ${value}`);
  else if (Array.isArray(value)) value.forEach(finiteTree);
  else if (value && typeof value === "object") Object.values(value).forEach(finiteTree);
}

function close(actual: number | null | undefined, expected: number, tolerance = 1e-9) {
  assert.ok(actual !== null && actual !== undefined && Number.isFinite(actual), `Expected finite, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} within ${tolerance} of ${expected}`);
}

function fixture(residual: (number | null)[]): Decomposition {
  const months = residual.map((_, i) => month(i));
  return {
    months, raw: residual.slice(), residual: residual.slice(), z: residual.map((v) => (v === null ? null : v / 2)),
    trend: residual.map(() => 0), seasonal: residual.map(() => 0),
    baseline: { months, n: residual.filter((v) => v !== null).length, excluded: { start: "1990-01", end: "1990-12" } },
  };
}

describe("baselineInfo", () => {
  it("matches decompose's sigma, baseline count, excluded block and record", () => {
    const d = build();
    const b = baselineInfo(d);
    assert.equal(b.n, d.baseline.n);
    assert.deepEqual(b.excluded, { start: "2009-01", end: "2011-04" });
    assert.deepEqual(b.record, { start: "2000-01", end: "2019-12" });
    assert.ok(b.sigma !== null);
    // z = residual / sigma, so any observed month recovers sigma.
    const i = 20;
    close(b.sigma, d.residual[i]! / d.z[i]!, 1e-9);
    assert.ok(b.rho >= 0 && b.rho <= 0.99);
  });

  it("estimates positive rho for autocorrelated noise and sigma null for an exact fit", () => {
    assert.ok(baselineInfo(build({ phi: 0.7 })).rho > 0.4);
    const exact = decompose(
      { layer: "t", unit: "u", start: "2000-01", values: Array.from({ length: 240 }, (_, i) => 50 + 0.1 * i + 5 * Math.sin(2 * Math.PI * (i % 12) / 12)) },
      event, PAD);
    const b = baselineInfo(exact);
    assert.equal(b.sigma, null);
    const detail = intervalDetail(exact, { start: "2015-01", end: "2015-04" });
    assert.equal(detail.test, null);
    assert.equal(detail.peak, null);
    finiteTree(detail);
  });
});

describe("intervalDetail", () => {
  it("planted strong negative anomaly is significant, low, and the lowest of 20 years", () => {
    const range = { start: "2010-02", end: "2010-05" };
    const d = build({ plant: { range, delta: -6 } });
    const r = intervalDetail(d, range);
    assert.equal(r.verdict, "significant");
    assert.equal(r.direction, "low");
    assert.ok(r.meanAnomaly! < -4);
    assert.ok(r.test!.p < 1e-6);
    assert.ok(r.empirical!.p < 0.05);
    assert.deepEqual(r.seasonRank, { position: 1, of: 20, direction: "low" });
    assert.equal(r.n, 4);
    assert.equal(r.months, 4);
    assert.equal(r.signConsistency, 1);
    assert.ok(r.beyond2Sigma >= 3);
    assert.ok(r.peak!.z < -3 && r.peak!.anomaly < 0);
    assert.ok(indexOf(r.peak!.month) >= indexOf(range.start) && indexOf(r.peak!.month) <= indexOf(range.end));
    assert.ok(r.ci95![1] < 0);
    finiteTree(r);
  });

  it("planted positive anomaly gives direction high", () => {
    const range = { start: "2010-06", end: "2010-09" };
    const r = intervalDetail(build({ plant: { range, delta: 5 } }), range);
    assert.equal(r.direction, "high");
    assert.equal(r.verdict, "significant");
    assert.equal(r.seasonRank!.direction, "high");
    assert.equal(r.seasonRank!.position, 1);
  });

  it("a quiet interval is not significant", () => {
    const d = build();
    const r = intervalDetail(d, { start: "2015-03", end: "2015-06" });
    assert.equal(r.verdict, "not-significant");
    assert.ok(r.test!.p > 0.05);
    assert.ok(r.empirical!.p > 0.05);
    finiteTree(r);
  });

  it("AR(1) standard error exceeds the white-noise one when rho > 0", () => {
    const range = { start: "2015-01", end: "2015-12" };
    const d = build({ phi: 0.7 });
    const b = baselineInfo(d);
    assert.ok(b.rho > 0.3);
    const r = intervalDetail(d, range, b);
    assert.ok(r.test!.se > b.sigma! / Math.sqrt(r.n));
    assert.ok(r.test!.nEff < r.n);
    // With rho forced to 0 the test reduces to the white-noise standard error.
    const white = intervalDetail(d, range, { ...b, rho: 0 });
    close(white.test!.se, b.sigma! / Math.sqrt(12));
    close(white.test!.nEff, 12);
  });

  it("matches a hand computation of se and nEff with a gap in the interval", () => {
    // Months 2000-01..2000-05 are the interval; 2000-03 is missing, so t = {0, 1, 3}.
    const d = fixture([2, 4, null, 6, 8, 0, 0, 0]);
    const base: BaselineInfo = {
      sigma: 2, n: 5, rho: 0.5, excluded: { start: "1990-01", end: "1990-12" },
      record: { start: "2000-01", end: "2000-08" },
    };
    const r = intervalDetail(d, { start: "2000-01", end: "2000-04" }, base);
    // residuals 2, 4, 6 -> mean 4; S = 3 + 2(0.5^1 + 0.5^3 + 0.5^2) = 4.75.
    assert.equal(r.n, 3);
    assert.equal(r.months, 4);
    close(r.meanAnomaly, 4);
    close(r.test!.se, (2 * Math.sqrt(4.75)) / 3);
    close(r.test!.nEff, 9 / 4.75);
    close(r.test!.z, 4 / ((2 * Math.sqrt(4.75)) / 3));
    close(r.ci95![0], 4 - 1.96 * r.test!.se);
    close(r.ci95![1], 4 + 1.96 * r.test!.se);
    close(r.meanZ, 2); // z = residual / 2
  });

  it("a missing month leaves empirical and seasonRank null but keeps the test", () => {
    const range = { start: "2015-03", end: "2015-06" };
    const d = build({ missing: ["2015-04"] });
    const r = intervalDetail(d, range);
    assert.equal(r.n, 3);
    assert.equal(r.months, 4);
    assert.equal(r.empirical, null);
    assert.equal(r.seasonRank, null);
    assert.ok(r.test !== null);
    assert.notEqual(r.verdict, "insufficient");
    finiteTree(r);
  });

  it("a single month reduces to z = residual / sigma", () => {
    const d = build();
    const b = baselineInfo(d);
    const i = indexOf("2015-07");
    const r = intervalDetail(d, { start: "2015-07", end: "2015-07" }, b);
    assert.equal(r.n, 1);
    close(r.test!.se, b.sigma!);
    close(r.test!.z, d.residual[i]! / b.sigma!);
    close(r.test!.nEff, 1);
    close(r.meanZ, d.z[i]!);
    assert.equal(r.peak!.month, "2015-07");
  });

  it("a range wholly outside the record is insufficient with null statistics", () => {
    const r = intervalDetail(build(), { start: "2025-01", end: "2025-06" });
    assert.equal(r.n, 0);
    assert.equal(r.months, 6);
    assert.equal(r.verdict, "insufficient");
    for (const key of ["meanAnomaly", "ci95", "meanZ", "percentOfNormal", "test", "empirical", "seasonRank", "direction", "peak", "signConsistency"] as const) {
      assert.equal(r[key], null, key);
    }
    assert.equal(r.beyond2Sigma, 0);
  });

  it("percentOfNormal is null with negative values and correct for a positive series", () => {
    const range = { start: "2015-03", end: "2015-06" };
    assert.equal(intervalDetail(build({ base: 0 }), range).percentOfNormal, null);
    const d = build({ base: 100 });
    const r = intervalDetail(d, range);
    let expected = 0;
    let sum = 0;
    for (let i = indexOf(range.start); i <= indexOf(range.end); i++) {
      expected += d.trend[i] + d.seasonal[i];
      sum += d.residual[i]!;
    }
    close(r.percentOfNormal, (100 * sum) / expected, 1e-9);
  });

  it("empirical windows never straddle the excluded block", () => {
    // Length-L windows in a 240-month record with 28 excluded months: (109 - L) before + (105 - L) after.
    const r = intervalDetail(build(), { start: "2015-03", end: "2015-06" });
    assert.equal(r.empirical!.windows, 214 - 2 * 4);
    close(r.empirical!.p, (r.empirical!.asExtreme + 1) / (r.empirical!.windows + 1));
  });

  it("seasonRank needs a range of at most 12 months", () => {
    const d = build();
    assert.ok(intervalDetail(d, { start: "2015-01", end: "2015-12" }).seasonRank !== null);
    assert.equal(intervalDetail(d, { start: "2015-01", end: "2016-01" }).seasonRank, null);
  });

  it("returns null empirical when fewer than 20 baseline windows exist", () => {
    // 30 observed months, excluded block in the middle leaves only short stretches for a 12-month window.
    const d = fixture(Array.from({ length: 30 }, (_, i) => Math.sin(i)));
    const base: BaselineInfo = {
      sigma: 1, n: 30, rho: 0, excluded: { start: "2000-12", end: "2001-02" },
      record: { start: "2000-01", end: "2002-06" },
    };
    const r = intervalDetail(d, { start: "2001-03", end: "2001-12" }, base);
    assert.equal(r.empirical, null);
  });

  it("throws RangeError on malformed input and returns finite outputs otherwise", () => {
    const d = build();
    assert.throws(() => intervalDetail(d, { start: "2015-13", end: "2015-14" }), RangeError);
    assert.throws(() => intervalDetail(d, { start: "2015/01", end: "2015-02" }), RangeError);
    assert.throws(() => intervalDetail(d, { start: "2015-05", end: "2015-04" }), RangeError);
    assert.throws(() => relationToEvent({ start: "2015-05", end: "2015-04" }, event), RangeError);
    assert.throws(() => relationToEvent({ start: "2015-01", end: "2015-02" }, { start: "x", end: "2010-01" }), RangeError);
  });
});

describe("relationToEvent", () => {
  const ev = { start: "2010-03", end: "2010-06" };
  it("classifies same, before, after and overlaps with gapMonths", () => {
    assert.deepEqual(relationToEvent({ ...ev }, ev), { kind: "same", gapMonths: 0 });
    assert.deepEqual(relationToEvent({ start: "2009-10", end: "2010-02" }, ev), { kind: "before", gapMonths: 1 });
    assert.deepEqual(relationToEvent({ start: "2009-01", end: "2009-12" }, ev), { kind: "before", gapMonths: 3 });
    assert.deepEqual(relationToEvent({ start: "2010-07", end: "2010-09" }, ev), { kind: "after", gapMonths: 1 });
    assert.deepEqual(relationToEvent({ start: "2011-06", end: "2011-08" }, ev), { kind: "after", gapMonths: 12 });
    assert.deepEqual(relationToEvent({ start: "2010-05", end: "2010-08" }, ev), { kind: "overlaps", gapMonths: 0 });
    assert.deepEqual(relationToEvent({ start: "2010-04", end: "2010-05" }, ev), { kind: "overlaps", gapMonths: 0 });
    assert.deepEqual(relationToEvent({ start: "2010-01", end: "2010-03" }, ev), { kind: "overlaps", gapMonths: 0 });
  });
});
