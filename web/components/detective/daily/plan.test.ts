// Run from web/: npx tsx --test components/detective/daily/plan.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decomposition } from "@/lib/detective/contracts";
import { autoRange, daysOf, estimateSeconds, monthlyNormalByDay, needsConfirm, planPieces, runs, sameUnit, splitRange } from "./plan";

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

test("monthly normal per day = trend + seasonal of that month, null outside the record", () => {
  const d = { months: ["2021-02", "2021-03"], trend: [1, 2], seasonal: [10, 20] } as unknown as Decomposition;
  assert.deepEqual(monthlyNormalByDay(d, ["2021-01-31", "2021-02-01", "2021-03-15"]), [null, 11, 22]);
  assert.deepEqual(monthlyNormalByDay(null, ["2021-02-01"]), [null]);
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
