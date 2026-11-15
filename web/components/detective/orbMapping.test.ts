import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decomposition } from "@/lib/detective/contracts";
import { ballValue, daysInMonth, gaugeOf, mapToBall, readMonth } from "./orbMapping";

const d: Decomposition = {
  months: ["2021-02", "2021-03", "2021-04"],
  raw: [30, null, 90],
  trend: [50, 50, 50],
  seasonal: [10, 20, 30],
  residual: [-30, null, 10],
  z: [-1, null, 0.3],
  baseline: { months: [], excluded: { start: "2021-02", end: "2021-04" }, n: 0 },
};

test("daysInMonth handles leap years", () => {
  assert.equal(daysInMonth("2020-02"), 29);
  assert.equal(daysInMonth("2021-02"), 28);
});

test("each mapped category lands on its channel", () => {
  const ch = (c: Parameters<typeof mapToBall>[0], l: string, u: string) => mapToBall(c, l, u).channel;
  assert.equal(ch("precip", "p_imerg", "mm/day"), "precip");
  assert.equal(ch("et", "et_m2", "mm/day"), "et");
  assert.equal(ch("runoff", "ro_m2", "mm/day"), "runoff");
  assert.equal(ch("soil", "sm_root", "mm"), "root_zone");
  assert.equal(ch("soil", "g1_soil_top", "mm"), "soil_top");
  assert.equal(ch("snow", "swe", "mm"), "swe");
});

test("units convert honestly", () => {
  const m = mapToBall("precip", "x", "mm/month");
  assert.ok(m.channel);
  if (m.channel) assert.equal(m.convert(300, "2021-04"), 10);
  const k = mapToBall("et", "x", "kg/m2/s");
  if (k.channel) assert.ok(Math.abs(k.convert(1e-5, "2021-04") - 0.864) < 1e-9);
});

test("unconvertible or different quantities stay unmapped", () => {
  assert.deepEqual(mapToBall("tws", "tws", "cm"), { channel: null, reason: "anomaly" });
  assert.deepEqual(mapToBall("soil", "sm_m2", "fraction"), { channel: null, reason: "layer" });
  assert.deepEqual(mapToBall("soil", "sm_total", "mm"), { channel: null, reason: "layer" });
  assert.deepEqual(mapToBall("snow", "snow_cover", "%"), { channel: null, reason: "unit" });
  assert.deepEqual(mapToBall("precip", "x", "W/m2"), { channel: null, reason: "unit" });
  assert.equal(mapToBall("tair", "tair", "°C").channel, null);
  for (const c of ["vpd", "energy", "wind", "ndvi", "sst", "aod", "ozone", "vapor", "fire", "so2"] as const) {
    assert.equal(mapToBall(c, "x", "1").channel, null);
  }
});

test("observed vs normal, and a missing month is null, never zero", () => {
  const m = mapToBall("soil", "sm_root", "mm");
  assert.deepEqual(readMonth(d, 0), { month: "2021-02", observed: 30, normal: 60 });
  assert.equal(ballValue(m, readMonth(d, 0), "observed"), 30);
  assert.equal(ballValue(m, readMonth(d, 0), "normal"), 60);
  assert.equal(ballValue(m, readMonth(d, 1), "observed"), null);
  assert.equal(ballValue(m, readMonth(d, 1), "normal"), 70);
});

test("gauge range, normal tick and anomaly sign", () => {
  const g = gaugeOf(d, readMonth(d, 0), "observed")!;
  assert.equal(g.lo, 30);
  assert.equal(g.hi, 90);
  assert.equal(g.sign, "below");
  assert.equal(g.anomaly, -30);
  assert.equal(g.pos, 0);
  assert.equal(g.normalPos, 0.5);
  const miss = gaugeOf(d, readMonth(d, 1), "observed")!;
  assert.equal(miss.pos, null);
  assert.equal(miss.sign, null);
});
