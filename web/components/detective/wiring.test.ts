import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { keywordSelect } from "../../lib/detective/keywords";
import { CATEGORY_ORDER } from "../../lib/detective/categories";
import { decodeQuery, encodeQuery } from "../../lib/detective/url";
import type { LayerInfo } from "../../lib/detective/series";
import { baselineInfo, intervalDetail } from "../../lib/detective/intervalDetail";
import { LAYER_TEXT, withEnglishText } from "../../lib/detective/layerText";
import StatsPanel from "./workbench/StatsPanel";
import { ExpandedLane, type Shared } from "./workbench/Lanes";
import { itemsFromLanes } from "./picker/fromLanes";
import VariableSelect from "./picker/VariableSelect";
import { COPY } from "./workbench/copy";
import type { LaneModel, LaneReady } from "./workbench/types";
import { CATEGORIES, PRESETS, analysis, cleanSelectResponse, requestVotes, variableMetadata } from "./wiring";

describe("selector integration", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("keeps online-model provenance and explicit picks even when they use a different threshold", async () => {
    globalThis.fetch = async () => Response.json({
      source: "online-model",
      votes: [
        { category: "soil", p: 0.4, selected: true },
        { category: "precip", p: 0.8, selected: false },
      ],
      suggestedTime: { start: "2021-02", end: "2021-05" },
    });
    const result = await requestVotes("2021 drought", new AbortController().signal);
    assert.equal(result.source, "online-model");
    assert.deepEqual(result.votes.filter((v) => v.selected).map((v) => v.category), ["soil"]);
    assert.equal(result.votes.find((v) => v.category === "precip")?.p, 0.8);
    assert.deepEqual(result.suggestedTime, { start: "2021-02", end: "2021-05" });
    assert.deepEqual(result.votes.map((v) => v.category), CATEGORY_ORDER);
  });

  it("uses D's complete browser fallback when a static host has no API", async () => {
    globalThis.fetch = async () => new Response("Not found", { status: 404 });
    const event = "2022 年七月洪水";
    assert.deepEqual(await requestVotes(event, new AbortController().signal), keywordSelect(event));
  });

  it("rejects an invalid API response and falls back", async () => {
    globalThis.fetch = async () => Response.json({ source: "unknown", votes: [] });
    const event = "2021 drought";
    assert.deepEqual(await requestVotes(event, new AbortController().signal), keywordSelect(event));
    assert.equal(cleanSelectResponse({ source: "local-model", votes: [{ category: "unknown", p: 1 }] }), null);
  });

  it("does not turn a cancelled request into keyword suggestions", async () => {
    const ctl = new AbortController();
    globalThis.fetch = async () => {
      ctl.abort();
      return Response.json(keywordSelect("old drought"));
    };
    await assert.rejects(requestVotes("old drought", ctl.signal), { name: "AbortError" });
  });
});

const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
const event = { start: "2010-02", end: "2010-05" };
const eventSpan = { s: 2010 * 12 + 1, e: 2010 * 12 + 4 };

function fixture(layer: string, category: LayerInfo["category"], opts: { unit?: string; product?: string; caveat?: string | null; values?: (number | null)[] } = {}) {
  const info: LayerInfo = {
    id: layer, category, name: layer, product: opts.product ?? layer.toUpperCase(), nasa: true, family: null,
    unit: opts.unit ?? "mm", temporalResolution: "monthly", start: "2000-01", end: "2019-12",
    caveat: opts.caveat === undefined ? "Product-specific caution" : opts.caveat,
  };
  const series = {
    layer, unit: info.unit, start: "2000-01",
    values: opts.values ?? Array.from({ length: 240 }, (_, i) => 100 + i * 0.02 + Math.sin(i * Math.PI / 6) * 4 + Math.cos(i * 1.7)),
  };
  const d = analysis.decompose(series, event, 12);
  const base = 2000 * 12;
  const ready: LaneReady = {
    kind: "ready", meta: variableMetadata(info, series.unit), d, base, baseline: baselineInfo(d),
    trend: analysis.trendStats(series), record: { s: base, e: base + 239 }, outside: false,
  };
  const detail = intervalDetail(d, event, ready.baseline);
  const lane: LaneModel = {
    c: category, name: CATEGORIES[category].name.en, res: ready, detail, polarity: "cool", choices: [], layer,
  };
  return { info, series, d, ready, detail, lane };
}

const shared: Shared = {
  view: { s: eventSpan.s - 12, e: eventSpan.e + 12 }, event: eventSpan, sel: eventSpan, hover: null,
  onSel: () => {}, onCommit: () => {}, onHover: () => {},
};
const lanesOf = (lane: LaneModel) => ({
  lane, shared, vc: null, catalog: null, regionId: "b4-4040046370", relation: "overlaps the event",
  onLayer: () => {}, onRetry: () => {}, onKeyDown: () => {},
});

describe("analysis page integration", () => {
  it("keeps E's Taiwan case unchanged when shared through the URL", () => {
    const preset = PRESETS.find((p) => p.id === "taiwan-2021-drought")!;
    const shared = decodeQuery(encodeQuery(preset));
    assert.equal(shared.region, "b4-4040046370");
    assert.deepEqual(shared.time, { start: "2021-02", end: "2021-05" });
    assert.deepEqual(shared.categories, ["precip", "soil", "tws", "ndvi"]);
    assert.equal(shared.active, preset.active);
  });

  it("feeds A's decomposition to the workbench with E's metadata and the catalogue caveat", () => {
    const f = fixture("sm_root", "soil", { product: "GLDAS" });
    const html = renderToStaticMarkup(createElement(ExpandedLane, lanesOf(f.lane)));
    assert.match(html, /Soil moisture/);
    assert.match(html, /<p role="note"[^>]*>.*Product-specific caution/);
    // product · unit is named in the variable dropdown above the lane
    const pick = renderToStaticMarkup(createElement(VariableSelect, { items: itemsFromLanes([f.lane]), value: "soil", onChange: () => {}, view: shared.view, event: shared.event, sel: shared.sel }));
    assert.match(pick, /GLDAS · mm/);
    assert.doesNotMatch(html, /stand-in|Development build/);
    assert.doesNotMatch(html, CJK);
    const stats = renderToStaticMarkup(createElement(StatsPanel, {
      d: f.detail, unit: "mm", polarity: "cool", baseline: f.ready.baseline, trend: f.ready.trend, relation: "overlaps the event",
    }));
    assert.ok(stats.includes(COPY.stats.heading));
    assert.ok(stats.includes(COPY.verdict.notCause));
    assert.ok(stats.includes(COPY.stats.meanAnomaly));
    assert.ok(stats.includes(COPY.trend.heading));
    assert.doesNotMatch(stats, CJK);
  });

  it("shows the insufficient-data state when the selection has no data", () => {
    const f = fixture("sm_root", "soil");
    assert.throws(() => analysis.decompose({ layer: "sm_root", unit: "mm", start: "2000-01", values: Array.from({ length: 240 }, () => null) }, event, 12));
    const nodata = renderToStaticMarkup(createElement(ExpandedLane, lanesOf({ ...f.lane, res: { kind: "nodata", reason: null }, detail: null })));
    assert.ok(nodata.includes(COPY.lanes.noData));
    const html = renderToStaticMarkup(createElement(StatsPanel, {
      d: null, unit: "mm", polarity: "cool", baseline: f.ready.baseline, trend: f.ready.trend, relation: "",
    }));
    assert.ok(html.includes(COPY.verdict.insufficient));
    assert.ok(html.includes(COPY.stats.noRank));
    assert.doesNotMatch(html, /Unusually (low|high)/);
  });

  it("names the unit and product of a variable that has no statistics yet in the dropdown", () => {
    const f = fixture("sm_root", "soil");
    const items = itemsFromLanes([{ ...f.lane, detail: null }]);
    const html = renderToStaticMarkup(createElement(VariableSelect, { items, value: "soil", onChange: () => {}, view: shared.view, event: shared.event, sel: shared.sel }));
    assert.match(html, /SM_ROOT · mm/);
    assert.match(html, /Soil moisture/);
  });
});

describe("temperature product labels", () => {
  for (const [layer, name, definition] of [
    ["lst_day", "Daytime land-surface temperature", "daytime overpass"],
    ["lst_night", "Nighttime land-surface temperature", "nighttime overpass"],
    ["tsurf_m2", "Land-surface temperature", "MERRA-2 reanalysis"],
  ]) {
    it(`${layer} names land surface in the lane heading`, () => {
      const f = fixture(layer, "tair", { unit: "°C" });
      assert.equal(f.ready.meta.name, name);
      assert.ok(f.ready.meta.definition.includes(definition));
      const html = renderToStaticMarkup(createElement(ExpandedLane, lanesOf(f.lane)));
      assert.ok(html.includes(name));
      assert.doesNotMatch(html, /Air temperature/);
      assert.doesNotMatch(f.ready.meta.definition, /Temperature of the air near the ground/);
      assert.equal(f.ready.meta.product, LAYER_TEXT[layer]?.product ?? layer.toUpperCase());
      assert.ok(f.ready.meta.caveat);
    });
  }

  it("keeps the actual air-temperature product's E label and definition", () => {
    const meta = fixture("tair", "tair").ready.meta;
    assert.equal(meta.name, CATEGORIES.tair.name.en);
    assert.equal(meta.definition, CATEGORIES.tair.definition.en);
    assert.equal(meta.product, "TAIR");
    assert.equal(meta.caveat, "Product-specific caution");
  });
});

describe("English layer text", () => {
  it("replaces Chinese product and caveat text and leaves other layers alone", () => {
    const zh = { id: "p_imerg", product: "GPM IMERG 月資料", caveat: null };
    assert.deepEqual(withEnglishText(zh), { id: "p_imerg", product: "GPM IMERG monthly", caveat: null });
    const other = { id: "tair_x", product: "ERA5", caveat: "kept" };
    assert.equal(withEnglishText(other), other);
    // a layer with no caveat in the catalogue never gains one
    assert.equal(withEnglishText({ id: "sst", product: "NOAA OISST v2.1", caveat: null }).caveat, null);
  });

  it("covers every layer of the real catalogue", { skip: !existsSync("public/data/catalog/variables.json") }, () => {
    const raw = JSON.parse(readFileSync("public/data/catalog/variables.json", "utf8")) as {
      layers: Record<string, { category?: string; product?: string; caveat?: string | null }>;
    };
    let shown = 0;
    for (const [id, l] of Object.entries(raw.layers)) {
      const info = { id, product: l.product ?? id, caveat: l.caveat ? l.caveat : null };
      const out = withEnglishText(info);
      assert.doesNotMatch(out.product, CJK, `${id} product`);
      assert.doesNotMatch(out.caveat ?? "", CJK, `${id} caveat`);
      // a caveat the catalogue has is still shown
      assert.equal(out.caveat != null, info.caveat != null, `${id} caveat presence`);
      shown++;
    }
    assert.ok(shown > 10);
  });
});
