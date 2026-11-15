import assert from "node:assert/strict";
import test from "node:test";
import { dailyDates, dayNumber, shortDailyRange, supportsDaily } from "./daily";

test("one calendar month requests its actual days, including leap February", () => {
  assert.deepEqual(shortDailyRange({ start: "2020-02", end: "2020-02" }), { start: "2020-02-01", end: "2020-02-29" });
  assert.deepEqual(shortDailyRange({ start: "2021-02", end: "2021-02" }), { start: "2021-02-01", end: "2021-02-28" });
  assert.deepEqual(shortDailyRange({ start: "2021-12", end: "2021-12" }), { start: "2021-12-01", end: "2021-12-31" });
});

test("long or invalid selections never qualify for automatic daily calls", () => {
  for (const time of [
    { start: "2021-01", end: "2021-02" },
    { start: "2021-01", end: "2021-06" },
    { start: "2021-01", end: "2021-12" },
    { start: "2021-02", end: "2021-01" },
    { start: "2021-00", end: "2021-01" },
  ]) assert.equal(shortDailyRange(time), null);
});

test("daily calendar neither normalizes impossible dates nor omits leap days", () => {
  assert.equal(dayNumber("2021-02-29"), null);
  assert.equal(dayNumber("2020-02-30"), null);
  assert.equal(dayNumber("2020-2-01"), null);
  assert.deepEqual(dailyDates({ start: "2020-02-28", end: "2020-03-01" }), ["2020-02-28", "2020-02-29", "2020-03-01"]);
  assert.deepEqual(dailyDates({ start: "2020-01-01", end: "2020-02-01" }), []);
});

test("monthly and annual products cannot silently acquire a daily adapter", () => {
  assert.equal(supportsDaily("tair"), true);
  assert.equal(supportsDaily("p_imerg"), true);
  for (const layer of ["tws", "so2_emis", "pet_gldas", "p_m2", "vpd"]) assert.equal(supportsDaily(layer), false);
});
