// Run from web/: npx tsx --test lib/detective/fine.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baselineSpans, dailySeries, daysOfPoints, fineDecomposition, fineDetail, noiseModel, pointsOf, weeklySeries,
  windowBaseline, yearsBack, yearsBaseline, type FineSeries,
} from "./fine";
import { runLabTool } from "./lab";

const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
/** deterministic noise in [−1, 1] */
function noise(seed: number) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return 2 * (s / 2147483648) - 0.5 * 2; }; }
function series(start: string, anomalies: (number | null)[]): FineSeries {
  const d = days(start, anomalies.length);
  return dailySeries(d, anomalies.map((a) => (a == null ? null : 10 + a)), d.map(() => 10), anomalies);
}

test("weeks: blocks of 7 days from the first day; a week needs 4 observed days", () => {
  const a = [1, 1, 1, 1, 1, 1, 1, 2, null, null, null, 2, 2, 2, 5, 5, 5];
  const w = weeklySeries(series("2021-03-01", a));
  assert.deepEqual(w.start, ["2021-03-01", "2021-03-08", "2021-03-15"]);
  assert.deepEqual(w.end, ["2021-03-07", "2021-03-14", "2021-03-17"]);
  assert.deepEqual(w.anomaly, [1, 2, null]);           // week 2: 4 of 7 observed; week 3: only 3 days
  assert.deepEqual(w.days, [7, 4, 3]);
  assert.deepEqual(w.value, [11, 12, null]);
  assert.deepEqual(w.normal, [10, 10, 10]);
});

test("points of a day range, and back", () => {
  const w = weeklySeries(series("2021-03-01", new Array(28).fill(0)));
  assert.deepEqual(pointsOf(w, { start: "2021-03-09", end: "2021-03-16" }), { a: 1, b: 2 });
  assert.deepEqual(daysOfPoints(w, { a: 1, b: 2 }), { start: "2021-03-08", end: "2021-03-21" });
  assert.equal(pointsOf(w, { start: "2021-05-01", end: "2021-05-02" }), null);
});

test("earlier years: same calendar days, 29 Feb becomes 28 Feb, nothing before the record", () => {
  assert.deepEqual(yearsBack({ start: "2021-03-04", end: "2021-03-17" }, 3), { start: "2018-03-04", end: "2018-03-17" });
  assert.deepEqual(yearsBack({ start: "2020-02-29", end: "2020-03-02" }, 1), { start: "2019-02-28", end: "2019-03-02" });
  const spans = baselineSpans({ start: "2021-03-04", end: "2021-03-17" }, "day", 10, "2015-01-01");
  assert.deepEqual(spans.map((s) => s.year), [2020, 2019, 2018, 2017, 2016, 2015]);
  assert.deepEqual(spans[0].span, { start: "2020-02-26", end: "2020-03-24" });   // ± 7 days
  assert.deepEqual(baselineSpans({ start: "2021-03-01", end: "2021-03-28" }, "week", 1, "2000-01-01")[0].span, { start: "2020-02-16", end: "2020-04-11" });
});

test("noise model: level, σ and lag-1 correlation within segments only", () => {
  const m = noiseModel({ kind: "window", segments: [[1, 2, 3, 4], [10, 11]], sameDays: [] })!;
  assert.equal(m.n, 6);
  assert.ok(Math.abs(m.level - 31 / 6) < 1e-12);
  assert.ok(m.rho > 0);                                                   // the jump 4 → 10 is not a pair
  assert.equal(noiseModel({ kind: "window", segments: [[1]], sameDays: [] }), null);
  assert.equal(noiseModel({ kind: "window", segments: [[2, 2, 2]], sameDays: [] }), null);
});

test("window baseline: a clear dip against the surrounding days is unusual; ordinary days are not", () => {
  const r = noise(7);
  const a = Array.from({ length: 60 }, () => r());
  for (let i = 25; i < 35; i++) a[i] -= 4;
  const s = series("2021-03-01", a);
  const sel = { a: 25, b: 34 };
  const d = fineDetail(s, sel, windowBaseline(s, sel));
  assert.equal(d.kind, "window");
  assert.equal(d.n, 10);
  assert.equal(d.direction, "low");
  assert.equal(d.verdict, "significant");
  assert.ok(d.test!.p < 0.001);
  assert.ok(d.empirical && d.empirical.windows >= 20 && d.empirical.asExtreme === 0);
  assert.ok(d.difference! < -3.5 && d.difference! > -4.5);
  assert.equal(d.seasonRank, null);
  const calm = fineDetail(s, { a: 5, b: 14 }, windowBaseline(s, { a: 5, b: 14 }));
  assert.notEqual(calm.verdict, "significant");
});

test("years baseline: the same days of earlier years give the level, the rank and many windows", () => {
  const r = noise(11);
  const past = Array.from({ length: 10 }, (_, k) => {
    const s = series(`${2020 - k}-02-22`, Array.from({ length: 28 }, () => r()));
    return { year: 2020 - k, series: s, sel: { a: 7, b: 20 } };
  });
  const now = series("2021-02-22", Array.from({ length: 28 }, (_, i) => r() + (i >= 7 && i <= 20 ? 3 : 0)));
  const b = yearsBaseline(past);
  assert.equal(b.sameDays.length, 10);
  const d = fineDetail(now, { a: 7, b: 20 }, b);
  assert.equal(d.kind, "years");
  assert.deepEqual(d.seasonRank, { position: 1, of: 11, direction: "high" });
  assert.equal(d.empirical!.windows, 150);                               // 15 windows of 14 days in each of 10 years
  assert.equal(d.verdict, "significant");
  // a gap in the selection: no empirical test, no rank, but the z test still runs
  const gappy = { ...now, anomaly: now.anomaly.map((v, i) => (i === 10 ? null : v)) };
  const g = fineDetail(gappy, { a: 7, b: 20 }, b);
  assert.equal(g.empirical, null);
  assert.equal(g.seasonRank, null);
  assert.ok(g.test);
});

test("nothing to compare with, or nothing selected: insufficient, never a guess", () => {
  const s = series("2021-03-01", [1, 2, 3, null, null]);
  assert.equal(fineDetail(s, { a: 3, b: 4 }, windowBaseline(s, { a: 3, b: 4 })).verdict, "insufficient");
  assert.equal(fineDetail(s, { a: 0, b: 4 }, windowBaseline(s, { a: 0, b: 4 })).verdict, "insufficient");
});

test("the lab's tools run on the day series: residual from the baseline level, months = the days", () => {
  const r = noise(3);
  const a = Array.from({ length: 50 }, (_, i) => r() + (i >= 20 && i < 30 ? -3 : 0));
  const s = series("2021-03-01", a);
  const sel = { a: 20, b: 29 };
  const { d, extremeRate } = fineDecomposition(s, sel, windowBaseline(s, sel));
  assert.equal(extremeRate, undefined);
  assert.equal(d.months[0], "2021-03-01");
  assert.equal(d.baseline.months.length, 40);
  const mean = runLabTool("mean", d, sel.a, sel.b);
  assert.equal(mean.kind, "ok");
  if (mean.kind === "ok" && mean.stats.tool === "mean") assert.ok(mean.stats.mean < -2.5 && mean.stats.p < 0.01);
  const vs = runLabTool("compare", d, sel.a, sel.b);
  assert.equal(vs.kind, "ok");
  // with earlier years the extreme rate comes from those years
  const past = [{ year: 2020, series: series("2020-03-01", Array.from({ length: 50 }, (_, i) => (i === 3 ? 9 : r()))), sel }];
  const y = fineDecomposition(s, sel, yearsBaseline(past));
  assert.ok(y.extremeRate! > 0 && y.extremeRate! < 0.1);
  assert.equal(y.d.baseline.months.length, 0);
  const ex = runLabTool("extremes", y.d, 0, 49, { extremeRate: y.extremeRate });
  assert.equal(ex.kind, "ok");
});

test("window baseline: a calm, short surround does not make a busy selection look extreme (pooled σ, like Welch)", () => {
  // a selection that drifts down from 0 to −30 over 31 days, with 7 calm days of about −13 either side
  const a = [...Array(7).fill(-13), ...Array.from({ length: 31 }, (_, i) => -i), ...Array(7).fill(-13)].map((v, i) => v + (i % 2 ? 0.3 : -0.3));
  const s = series("2021-02-22", a);
  const sel = { a: 7, b: 37 };
  const d = fineDetail(s, sel, windowBaseline(s, sel));
  assert.ok(d.noise!.sigma > 5, String(d.noise!.sigma));            // not the 0.3 of the calm days alone
  assert.notEqual(d.verdict, "significant");
  assert.ok(d.test!.p > 0.05, String(d.test!.p));
});
