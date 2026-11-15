// Run from web/: npx tsx --test lib/detective/series.test.ts
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  categoryAvailability, categoryLayers, loadSeries, regionLayers, resolveLayer, type LayerInfo, type VariableCatalog,
} from "./series";

const layer = (id: string, category: LayerInfo["category"], unit = "mm/day"): LayerInfo => ({
  id, name: id, category, product: id.toUpperCase(), nasa: true, family: null, unit, start: "2000-01", end: "2025-12", caveat: null,
});
const vc: VariableCatalog = {
  defaults: { precip: "p_imerg", soil: "sm_root" },
  layers: { p_gpcp: layer("p_gpcp", "precip"), p_imerg: layer("p_imerg", "precip"), sm_root: layer("sm_root", "soil", "mm"), sm_m2: layer("sm_m2", "soil", "fraction") },
  order: ["p_gpcp", "p_imerg", "sm_root", "sm_m2"],
};

describe("layer choice", () => {
  it("lists the default layer first", () => {
    assert.deepEqual(categoryLayers(vc, "precip"), ["p_imerg", "p_gpcp"]);
  });
  it("uses the requested layer only when the region has it and it belongs to the category", () => {
    const here = new Set(["p_imerg", "p_gpcp", "sm_m2"]);
    assert.equal(resolveLayer(vc, "precip", here, "p_gpcp"), "p_gpcp");
    assert.equal(resolveLayer(vc, "precip", here, "sm_m2"), "p_imerg");
    assert.equal(resolveLayer(vc, "soil", here), "sm_m2"); // default missing here: next layer of the category
    assert.equal(resolveLayer(vc, "tws", here), null);
  });
  it("reports every category, unavailable ones as null", () => {
    const a = categoryAvailability(vc, new Set(["p_gpcp"]));
    assert.equal(a.layer.precip, "p_gpcp");
    assert.deepEqual(a.choices.precip, ["p_gpcp"]);
    assert.equal(a.layer.soil, null);
    assert.equal(Object.keys(a.layer).length, 12);
  });
});

describe("loading series-2", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  const serve = (files: Record<string, unknown>) => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = String(input).replace(/^\/data\//, "");
      return path in files
        ? new Response(JSON.stringify(files[path]), { status: 200 })
        : new Response("not found", { status: 404 });
    }) as typeof fetch;
  };

  it("keeps missing months as null, never 0 or NaN, and takes the unit from variables.json", async () => {
    serve({
      "catalog/variables.json": {
        category_default_layer: { tws: "tws" },
        layers: { tws: { name: "TWS", category: "tws", product: "GRACE", unit: "cm", start: "2002-04", end: "2026-09", caveat: "300 km" } },
      },
      "catalog/series_index.json": { regions: { "b4-1": ["tws"] } },
      "series/b4-1.json": { id: "b4-1", version: "series-2", layers: { tws: { start: "2002-04", values: [1.5, null, "x", -2] } } },
    });
    const s = await loadSeries("b4-1", "tws");
    assert.deepEqual(s, { layer: "tws", start: "2002-04", values: [1.5, null, null, -2], unit: "cm" });
    assert.deepEqual([...(await regionLayers("b4-1"))], ["tws"]);
    assert.equal((await regionLayers("b4-404")).size, 0);
    await assert.rejects(loadSeries("b4-1", "p_imerg"), /no p_imerg series/);
  });
});
