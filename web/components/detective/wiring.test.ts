import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { keywordSelect } from "../../lib/detective/keywords";
import { CATEGORY_ORDER } from "../../lib/detective/categories";
import { decodeQuery, encodeQuery } from "../../lib/detective/url";
import { CATEGORIES, PRESETS, VariableTab, analysis, cleanSelectResponse, requestVotes } from "./wiring";

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

describe("analysis page integration", () => {
  it("keeps E's Taiwan case unchanged when shared through the URL", () => {
    const preset = PRESETS.find((p) => p.id === "taiwan-2021-drought")!;
    const shared = decodeQuery(encodeQuery(preset));
    assert.equal(shared.region, "b4-4040046370");
    assert.deepEqual(shared.time, { start: "2021-02", end: "2021-05" });
    assert.deepEqual(shared.categories, ["precip", "soil", "tws", "ndvi"]);
    assert.equal(shared.active, preset.active);
  });

  it("feeds A's decomposition to B's chart with E's metadata and the catalogue caveat", () => {
    const event = { start: "2010-02", end: "2010-05" };
    const series = {
      layer: "sm_root", unit: "mm", start: "2000-01",
      values: Array.from({ length: 240 }, (_, i) => 100 + i * 0.02 + Math.sin(i * Math.PI / 6) * 4 + Math.cos(i * 1.7)),
    };
    const d = analysis.decompose(series, event, 12);
    const category = CATEGORIES.soil;
    const html = renderToStaticMarkup(createElement(VariableTab, {
      meta: { category: "soil", name: category.name.en, definition: category.definition.en, product: "GLDAS", unit: series.unit, caveat: "Product-specific caution" },
      d, event, padMonths: 12,
      trend: analysis.trendStats(series), intervalStats: analysis.intervalStats,
    }));
    assert.match(html, /Soil moisture/);
    assert.match(html, /Product-specific caution/);
    assert.match(html, /圖層/);
    assert.match(html, /長期趨勢/);
    assert.doesNotMatch(html, /stand-in|Development build/);
  });
});
