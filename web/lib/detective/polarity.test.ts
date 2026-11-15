// Run from web/: npx tsx --test lib/detective/polarity.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORY_ORDER } from "./categories";
import { anomalyPolarity, polarityIsArbitrary } from "./polarity";

test("more water reads cool, heat / smoke / fire reads warm", () => {
  for (const c of ["precip", "et", "soil", "tws", "runoff", "snow", "vapor", "ndvi"] as const) assert.equal(anomalyPolarity(c), "cool", c);
  for (const c of ["tair", "vpd", "energy", "sst", "aod", "fire", "so2", "wind", "ozone"] as const) assert.equal(anomalyPolarity(c), "warm", c);
});

test("every category has a polarity; only wind and ozone are conventions", () => {
  for (const c of CATEGORY_ORDER) assert.ok(["cool", "warm"].includes(anomalyPolarity(c)));
  assert.deepEqual(CATEGORY_ORDER.filter(polarityIsArbitrary), ["wind", "ozone"]);
});
