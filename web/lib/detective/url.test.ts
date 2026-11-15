// Run from web/: npx tsx --test lib/detective/url.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DetectiveQuery } from "./contracts";
import { suggestedTime } from "./keywords";
import { LAB_TOOLS } from "./lab";
import { TEST_IDS, decodeQuery, decodeState, encodeQuery, encodeState, formatRange, impliedWindow, suggestTime, urlCodec, windowOf } from "./url";
import { DEFAULT_WINDOW } from "./window";

describe("suggestTime (T from E)", () => {
  it("shares the API parser so input and selector suggestions cannot diverge", () => {
    assert.equal(suggestTime, suggestedTime);
    assert.deepEqual(suggestTime("2021 年二月至五月乾旱"), { start: "2021-02", end: "2021-05" });
  });
  const cases: [string, string | null][] = [
    ["2021 台灣春季大旱", "2021-01..2021-12"],
    ["2022 年 7 月巴基斯坦洪水", "2022-07..2022-07"],
    ["2022年7月巴基斯坦洪水", "2022-07..2022-07"],
    ["2021 年 2 月到 5 月台灣乾旱", "2021-02..2021-05"],
    ["2019 年 9 月至 2020 年 1 月 澳洲野火", "2019-09..2020-01"],
    ["2019–20 Australian bushfires", "2019-01..2020-12"],
    ["drought 2015-2018", "2015-01..2018-12"],
    ["Feb–May 2021 drought", "2021-02..2021-05"],
    ["September 2019 to January 2020 fires", "2019-09..2020-01"],
    ["Nov – Feb 2020 heat", "2019-11..2020-02"],
    ["2021-02..2021-05", "2021-02..2021-05"],
    ["flood in 2022-08", "2022-08..2022-08"],
    ["February 2021 Texas freeze", "2021-02..2021-02"],
    ["２０２１年台灣", "2021-01..2021-12"],
    ["Texas freeze", null],
    ["marine heatwave 2016", "2016-01..2016-12"],
    ["station 12345 record", null],
    ["", null],
  ];
  for (const [text, want] of cases) {
    it(`${JSON.stringify(text)} -> ${want}`, () => {
      const r = suggestTime(text);
      assert.equal(r ? `${r.start}..${r.end}` : null, want);
    });
  }
});

describe("URL codec", () => {
  const taiwan: DetectiveQuery = {
    event: "2021 Taiwan spring drought",
    time: { start: "2021-02", end: "2021-05" },
    region: "b4-4040046370",
    categories: ["precip", "soil", "tws", "ndvi"],
    padMonths: 24,
    active: "soil",
    layers: { precip: "p_gpcp" },
  };

  it("round-trips a full query", () => {
    assert.deepEqual(decodeQuery(encodeQuery(taiwan)), taiwan);
  });

  it("implements the UrlCodec contract", () => {
    assert.deepEqual(urlCodec.decodeQuery(`?${urlCodec.encodeQuery(taiwan)}`), taiwan);
  });

  it("reads the contract's example link", () => {
    const q = decodeQuery("?e=2021%20Taiwan&t=2021-02..2021-05&r=b4-4040046370&v=precip,soil,tws&pad=12&tab=precip");
    assert.deepEqual(q, {
      event: "2021 Taiwan",
      time: { start: "2021-02", end: "2021-05" },
      region: "b4-4040046370",
      categories: ["precip", "soil", "tws"],
      padMonths: 12,
      active: "precip",
    });
  });

  it("keeps links readable and leaves the default pad out", () => {
    const s = encodeQuery({ ...taiwan, padMonths: 12, layers: undefined, active: undefined });
    assert.equal(s, "e=2021+Taiwan+spring+drought&t=2021-02..2021-05&r=b4-4040046370&v=precip,soil,tws,ndvi");
  });

  it("drops junk instead of guessing", () => {
    const { query, rejectedRegion } = decodeState(
      "e=%20&t=2021-05..2021-02&r=hex-12345&v=precip,foo,precip,tair&pad=abc&tab=snow&l=precip:p_gpcp,bad,snow:x:y",
    );
    assert.deepEqual(query, { categories: ["precip", "tair"], layers: { precip: "p_gpcp" } });
    assert.equal(rejectedRegion, "hex-12345");
  });

  it("clamps pad to 3-60 and accepts a single month as the period", () => {
    assert.equal(decodeQuery("pad=999").padMonths, 60);
    assert.equal(decodeQuery("pad=1").padMonths, 3);
    assert.deepEqual(decodeQuery("t=2022-08").time, { start: "2022-08", end: "2022-08" });
    assert.equal(decodeQuery("t=2022-13").time, undefined);
  });

  it("orders categories canonically so one link means one set of tabs", () => {
    assert.deepEqual(decodeQuery("v=ndvi,precip,tws").categories, ["precip", "tws", "ndvi"]);
  });

  it("keeps the Step 1 draft (c) separate from the started analysis (v)", () => {
    const s = encodeState({ query: { event: "x", region: "b4-1" }, draft: ["soil", "precip"] });
    assert.equal(s, "e=x&r=b4-1&c=precip,soil");
    assert.deepEqual(decodeState(s).draft, ["precip", "soil"]);
    assert.equal(decodeState("e=x").draft, null);
    assert.deepEqual(decodeState("c=").draft, []);
    assert.equal("draft" in decodeQuery(s), false);
  });

  it("drops a layer override for a category that is not analysed", () => {
    assert.equal(encodeQuery({ ...taiwan, layers: { tair: "tsurf_m2", precip: "p_gpcp" } }).includes("tair"), false);
  });

  it("round-trips F's atmospheric and fire categories with their actual product ids", () => {
    const query: DetectiveQuery = {
      ...taiwan, categories: ["aod", "ozone", "vapor", "so2", "fire"], active: "fire",
      layers: { aod: "aod", ozone: "to3_m2", vapor: "tqv", so2: "so2_emis", fire: "fire_count" },
    };
    assert.deepEqual(decodeQuery(encodeQuery(query)), query);
  });
});

describe("workbench selection (sel)", () => {
  const query: Partial<DetectiveQuery> = { event: "x", time: { start: "2021-02", end: "2021-05" }, region: "b4-1", categories: ["soil"] };

  it("round-trips a selection that differs from the event", () => {
    const s = encodeState({ query, selection: { start: "2020-11", end: "2021-01" } });
    assert.equal(s, "e=x&t=2021-02..2021-05&r=b4-1&v=soil&sel=2020-11..2021-01");
    assert.deepEqual(decodeState(s).selection, { start: "2020-11", end: "2021-01" });
    assert.deepEqual(decodeState(s).query, query);
  });

  it("leaves the selection out when it equals the event", () => {
    assert.equal(encodeState({ query, selection: { start: "2021-02", end: "2021-05" } }).includes("sel"), false);
    assert.equal("selection" in decodeState("t=2021-02..2021-05&sel=2021-02..2021-05"), false);
    assert.equal(encodeState({ query, selection: null }).includes("sel"), false);
  });

  it("drops a malformed or reversed selection and keeps it out of the contract query", () => {
    assert.equal(decodeState("sel=2021-05..2021-02").selection, undefined);
    assert.equal(decodeState("sel=junk").selection, undefined);
    assert.deepEqual(decodeState("sel=2021-03").selection, { start: "2021-03", end: "2021-03" });
    assert.equal("selection" in decodeQuery("t=2021-02..2021-05&sel=2020-01..2020-02"), false);
  });
});

describe("workbench test (test)", () => {
  const query: Partial<DetectiveQuery> = { event: "x", time: { start: "2021-02", end: "2021-05" }, region: "b4-1", categories: ["soil"] };

  it("round-trips a known test after the selection", () => {
    const s = encodeState({ query, selection: { start: "2020-11", end: "2021-01" }, test: "mk" });
    assert.equal(s, "e=x&t=2021-02..2021-05&r=b4-1&v=soil&sel=2020-11..2021-01&test=mk");
    assert.equal(decodeState(s).test, "mk");
    assert.deepEqual(decodeState(s).query, query);
  });

  it("is absent when closed and drops unknown ids", () => {
    assert.equal(encodeState({ query, test: null }).includes("test"), false);
    assert.equal("test" in decodeState("t=2021-02..2021-05"), false);
    assert.equal(decodeState("test=bogus").test, undefined);
    assert.equal(decodeState("test=bootmean").test, undefined);
    assert.equal("test" in decodeQuery("t=2021-02..2021-05&test=mean"), false);
    for (const id of TEST_IDS) assert.equal(decodeState(encodeState({ query, test: id })).test, id);
    assert.deepEqual([...TEST_IDS], [...LAB_TOOLS]);
  });
});

describe("view window (win)", () => {
  const query: Partial<DetectiveQuery> = { event: "x", time: { start: "2021-02", end: "2021-05" }, region: "b4-1", categories: ["soil"] };

  it("is left out at the default and round-trips otherwise", () => {
    assert.equal(encodeState({ query, window: DEFAULT_WINDOW }).includes("win"), false);
    assert.equal(encodeState({ query, window: null }).includes("win"), false);
    for (const w of [{ unit: "week", n: 2 }, { unit: "month", n: 8 }, { unit: "year", n: 3 }, "all"] as const) {
      const s = encodeState({ query, window: w });
      assert.match(s, /&win=(2w|8m|3y|all)$/);
      assert.deepEqual(windowOf(decodeState(s)), w);
    }
    assert.equal(encodeState({ query, window: { unit: "month", n: 8 }, test: "mk" }), "e=x&t=2021-02..2021-05&r=b4-1&v=soil&test=mk&win=8m");
  });

  it("drops junk and clamps out-of-range counts", () => {
    assert.equal("window" in decodeState("win=9q"), false);
    assert.equal("window" in decodeState("win="), false);
    assert.deepEqual(decodeState("win=40y").window, { unit: "year", n: 10 });
    assert.equal("win" in decodeQuery("win=8m"), false);
  });

  it("keeps older links that only carry pad: pad stays the baseline exclusion and still sets the view", () => {
    const old = decodeState("t=2021-02..2021-05&pad=24");
    assert.equal(old.query.padMonths, 24);
    assert.equal(old.window, undefined);
    assert.deepEqual(windowOf(old), { unit: "year", n: 2 });
    assert.deepEqual(windowOf(decodeState("t=2021-02..2021-05&pad=6")), { unit: "month", n: 6 });
    assert.deepEqual(windowOf(decodeState("t=2021-02..2021-05")), DEFAULT_WINDOW);
    assert.deepEqual(impliedWindow(12), DEFAULT_WINDOW);
    // with a non-default pad, the default window must be written or the link would reopen on ±2 years
    const q24 = { ...query, padMonths: 24 };
    const s = encodeState({ query: q24, window: DEFAULT_WINDOW });
    assert.match(s, /pad=24.*win=12m/);
    assert.deepEqual(windowOf(decodeState(s)), DEFAULT_WINDOW);
    assert.equal(encodeState({ query: q24, window: { unit: "year", n: 2 } }).includes("win"), false);
  });
});

describe("formatRange", () => {
  it("reads naturally", () => {
    assert.equal(formatRange({ start: "2021-02", end: "2021-05" }), "Feb – May 2021");
    assert.equal(formatRange({ start: "2019-09", end: "2020-01" }), "Sep 2019 – Jan 2020");
    assert.equal(formatRange({ start: "2021-01", end: "2021-12" }), "2021");
    assert.equal(formatRange({ start: "2019-01", end: "2020-12" }), "2019 – 2020");
    assert.equal(formatRange({ start: "2022-08", end: "2022-08" }), "Aug 2022");
  });
});
