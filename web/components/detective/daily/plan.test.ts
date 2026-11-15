// Run from web/: npx tsx --test components/detective/daily/plan.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decomposition } from "@/lib/detective/contracts";
import { autoRange, dailyAnomaly, dailyNormal, daysOf, estimateSeconds, needsConfirm, planPieces, runs, sameUnit, selectionSummary, splitRange } from "./plan";

test("days of a range longer than a month, across a leap day", () => {
  const d = daysOf({ start: "2020-02-27", end: "2020-03-02" });
  assert.deepEqual(d, ["2020-02-27", "2020-02-28", "2020-02-29", "2020-03-01", "2020-03-02"]);
  assert.equal(daysOf({ start: "2021-01-01", end: "2021-12-31" }).length, 365);
  assert.deepEqual(daysOf({ start: "2021-03-02", end: "2021-03-01" }), []);
  assert.deepEqual(daysOf({ start: "nope", end: "2021-03-01" }), []);
});

test("pieces of at most three days cover the range exactly", () => {
  const p = splitRange({ start: "2021-02-22", end: "2021-04-07" });
  assert.equal(p.length, 15);
  assert.deepEqual(p[0], { start: "2021-02-22", end: "2021-02-24" });
  assert.deepEqual(p.at(-1), { start: "2021-04-05", end: "2021-04-07" });
  const covered = p.flatMap(daysOf);
  assert.deepEqual(covered, daysOf({ start: "2021-02-22", end: "2021-04-07" }));
  assert.ok(p.every((x) => daysOf(x).length <= 3));
  assert.deepEqual(splitRange({ start: "2021-03-01", end: "2021-03-04" }), [{ start: "2021-03-01", end: "2021-03-03" }, { start: "2021-03-04", end: "2021-03-04" }]);
});

test("auto-load up to 62 days; about a minute per month", () => {
  assert.equal(needsConfirm(62), false);
  assert.equal(needsConfirm(63), true);
  assert.equal(Math.round(estimateSeconds(31)), 60);
  assert.equal(Math.round(estimateSeconds(124)), 240);
});

// 36 months from Jan 2020: trend 100, 101, … and a peaked seasonal cycle (a wet season in June–August)
const CYCLE = [0, 0, 5, 10, 30, 80, 120, 70, 20, 5, 0, 0];
const model = {
  months: Array.from({ length: 36 }, (_, i) => `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`),
  trend: Array.from({ length: 36 }, (_, i) => 100 + i),
  seasonal: Array.from({ length: 36 }, (_, i) => CYCLE[i % 12]),
} as unknown as Decomposition;
const monthOf = (ym: string) => daysOf({ start: `${ym}-01`, end: `${ym}-${new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).getUTCDate()}` });
const mean = (a: (number | null)[]) => a.reduce<number>((s, v) => s + (v as number), 0) / a.length;

test("daily normal: every month's mean is that month's trend + seasonal normal, with no step on the 1st", () => {
  // the peak (July 2021: 118 + 120), a trough and the months between: the monthly mean is kept exactly
  for (const [ym, i] of [["2021-07", 18], ["2021-06", 17], ["2021-01", 12], ["2021-02", 13], ["2020-02", 1]] as const) {
    const monthly = (model.trend[i] as number) + (model.seasonal[i] as number);
    assert.ok(Math.abs(mean(dailyNormal(model, monthOf(ym))) - monthly) < 1e-6, `${ym}: ${mean(dailyNormal(model, monthOf(ym)))} vs ${monthly}`);
  }
  // asked for a span that crosses months: the same values as month by month
  const span = dailyNormal(model, daysOf({ start: "2021-05-20", end: "2021-08-10" }));
  assert.ok(Math.abs(mean(span.slice(12, 42)) - (117 + 80)) < 1e-6); // June 2021
  // smooth: the step across a month boundary is an ordinary daily step, not the 50 between the monthly normals
  const steps = span.slice(1).map((v, i) => Math.abs((v as number) - (span[i] as number)));
  assert.ok(Math.max(...steps) < 4, String(Math.max(...steps)));
  // the peak of the daily normal is above the July monthly normal, as it must be to keep the mean
  assert.ok(Math.max(...(span as number[])) > 238);
});

test("daily normal: a pure linear trend stays on its line; outside the monthly record there is none", () => {
  const line = { ...model, seasonal: model.seasonal.map(() => 0) } as unknown as Decomposition;
  const [mid, next] = dailyNormal(line, ["2021-03-16", "2021-03-17"]) as number[];
  assert.ok(Math.abs(mid - 114) < 0.02, String(mid));          // the middle of March 2021 = its monthly trend value
  assert.ok(Math.abs(next - mid - 1 / 31) < 0.005, String(next - mid));
  assert.deepEqual(dailyNormal(model, ["2019-12-31", "2023-01-01"]), [null, null]);
  assert.ok(dailyNormal(model, ["2020-01-01", "2022-12-31"]).every((v) => v !== null && Number.isFinite(v)));
  assert.deepEqual(dailyNormal(null, ["2021-02-01"]), [null]);
});

test("daily normal of a quantity that cannot be negative stays ≥ 0 next to a very wet month", () => {
  const rain = {
    months: model.months,
    trend: model.months.map(() => 0),
    seasonal: model.months.map((_, i) => (i % 12 === 6 ? 30 : 0.1)),
  } as unknown as Decomposition;
  const year = dailyNormal(rain, daysOf({ start: "2021-01-01", end: "2021-12-31" })) as number[];
  assert.ok(year.every((v) => v >= 0), String(Math.min(...year)));
  assert.ok(Math.max(...year) > 30);
});

test("daily anomaly removes that normal; a series that is exactly normal has no anomaly", () => {
  const days = daysOf({ start: "2021-06-10", end: "2021-06-14" });
  const normal = dailyNormal(model, days);
  assert.deepEqual(dailyAnomaly(normal, normal), [0, 0, 0, 0, 0]);
  const values = normal.map((v, i) => (i === 2 ? null : (v as number) + 5));
  assert.deepEqual(dailyAnomaly(values, normal).map((v) => (v === null ? null : Math.round(v * 1e9) / 1e9)), [5, 5, null, 5, 5]);
  assert.deepEqual(dailyAnomaly([3, 4], [null, 1]), [null, 3]);
});

test("the selection's days are summarised, not the event's or the whole span", () => {
  const dates = daysOf({ start: "2021-02-26", end: "2021-03-05" });      // 26, 27, 28 Feb, 1–5 Mar
  const values = [1, 1, 1, 10, null, 20, 30, 1];
  const anomaly = [0, 0, 0, 2, null, 4, null, 0];
  const sum = selectionSummary(dates, values, anomaly, { start: "2021-03-01", end: "2021-03-04" });
  assert.deepEqual(sum, { days: 4, observed: 3, meanValue: 20, n: 2, meanAnomaly: 3 });
  assert.deepEqual(selectionSummary(dates, values, anomaly, { start: "2021-04-01", end: "2021-04-30" }),
    { days: 0, observed: 0, meanValue: null, n: 0, meanAnomaly: null });
});

test("units and runs", () => {
  assert.ok(sameUnit("W/m2", "W/m²"));
  assert.ok(!sameUnit("mm", "mm/day"));
  assert.deepEqual(runs(6, (i) => i === 1 || i === 2 || i === 5), [[1, 2], [5, 5]]);
  assert.deepEqual(runs(0, () => true), []);
});

test("what loads by itself: the whole span up to 62 days, else the event's days when ≤ 31, else nothing", () => {
  const ev = { start: "2021-03-01", end: "2021-03-31" };
  // March ± 1 week = 45 days: everything
  const short = { start: "2021-02-22", end: "2021-04-07" };
  assert.deepEqual(autoRange(short, ev), short);
  // March ± 5 weeks = 101 days: only March
  const long = { start: "2021-01-25", end: "2021-05-05" };
  assert.deepEqual(autoRange(long, ev), ev);
  // Feb–May ± 1 week: the event alone is 120 days, so nothing loads without a click
  assert.equal(autoRange({ start: "2021-01-25", end: "2021-06-07" }, { start: "2021-02-01", end: "2021-05-31" }), null);
  // the event clipped to finished days
  assert.deepEqual(autoRange({ start: "2021-01-25", end: "2021-03-20" }, ev), { start: "2021-01-25", end: "2021-03-20" });
  assert.deepEqual(autoRange({ start: "2020-12-01", end: "2021-03-10" }, ev), { start: "2021-03-01", end: "2021-03-10" });
  assert.equal(autoRange({ start: "2021-03-02", end: "2021-03-01" }, ev), null);
});

test("pieces never straddle the automatic part and cover the range in order", () => {
  const range = { start: "2021-01-25", end: "2021-05-05" };
  const ev = { start: "2021-03-01", end: "2021-03-31" };
  const p = planPieces(range, ev);
  assert.deepEqual(p.flatMap(daysOf), daysOf(range));
  assert.ok(p.every((x) => daysOf(x).length <= 3));
  const autoDays = p.filter((x) => x.auto).flatMap(daysOf);
  assert.deepEqual(autoDays, daysOf(ev));
  assert.equal(p.filter((x) => x.auto).length, 11);
  // all automatic, or none
  assert.ok(planPieces(ev, ev).every((x) => x.auto));
  assert.ok(planPieces(range, null).every((x) => !x.auto));
});
