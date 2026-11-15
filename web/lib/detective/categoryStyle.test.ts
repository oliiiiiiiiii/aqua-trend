// Run from web/: npx tsx --test lib/detective/categoryStyle.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORIES, CATEGORY_ORDER } from "./categories";
import { CATEGORY_FAMILY, FAMILIES, categoryStyle } from "./categoryStyle";

const ALLOWED = new Set(["--viz-blue", "--viz-aqua", "--viz-orange", "--viz-green", "--viz-violet", "--viz-yellow", "--viz-magenta"]);

test("every category has a family, an icon and an allowed categorical token", () => {
  for (const c of CATEGORY_ORDER) {
    const s = categoryStyle(c);
    assert.ok(FAMILIES[CATEGORY_FAMILY[c]], c);
    assert.ok(ALLOWED.has(s.token), `${c}: ${s.token}`);
    assert.equal(s.color, `var(${s.token})`);
    assert.equal(s.icon, CATEGORIES[c].icon);
  }
});

test("anomaly polarity colours are never identity colours", () => {
  for (const f of Object.values(FAMILIES)) assert.ok(!["--viz-cool", "--viz-warm", "--viz-red"].includes(f.token), f.id);
});

test("variables of the same kind share a colour; different families do not", () => {
  const same = (a: string[]) => new Set(a.map((c) => categoryStyle(c as never).token)).size === 1;
  assert.ok(same(["precip", "soil", "tws", "runoff", "snow"]));
  assert.ok(same(["et", "vapor", "vpd"]));
  assert.ok(same(["tair", "energy", "sst"]));
  assert.ok(same(["ndvi", "fire"]));
  assert.ok(same(["aod", "ozone", "so2"]));
  const tokens = Object.values(FAMILIES).map((f) => f.token);
  assert.equal(new Set(tokens).size, tokens.length);
});

test("family colours: the validated assignment (heat and vegetation no longer orange beside green)", () => {
  assert.deepEqual(Object.values(FAMILIES).map((f) => f.token), ["--viz-blue", "--viz-aqua", "--viz-yellow", "--viz-magenta", "--viz-violet", "--viz-green"]);
  assert.notEqual(categoryStyle("tair").token, "--viz-orange");
  assert.notEqual(categoryStyle("ndvi").token, categoryStyle("tair").token);
  assert.notEqual(categoryStyle("so2").token, categoryStyle("tair").token);
});
