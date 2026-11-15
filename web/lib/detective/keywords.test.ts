import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_CATEGORIES, DEFAULT_CATEGORIES, keywordCategories, keywordSelect, matchedRules, suggestedTime } from "./keywords";

describe("keyword fallback", () => {
  it("recognizes Chinese and English events with complete deterministic votes", () => {
    for (const event of ["2021 台灣春季大旱", "2021 台灣干旱", "2021 Taiwan DROUGHT"]) {
      const result = keywordSelect(event);
      assert.equal(result.source, "keyword-fallback");
      assert.deepEqual(result.votes.map((v) => v.category), [...ALL_CATEGORIES]);
      assert.deepEqual(result.votes.filter((v) => v.selected).map((v) => v.category), ["precip", "soil", "tws", "ndvi"]);
      for (const vote of result.votes) assert.equal(vote.p, vote.selected ? 1 : 0);
      assert.deepEqual(result.suggestedTime, { start: "2021-01", end: "2021-12" });
    }
  });
  it("unions matching categories without duplicates", () => {
    assert.deepEqual(keywordCategories("drought and heatwave"), ["precip", "soil", "tws", "tair", "vpd", "energy", "ndvi"]);
  });
  it("uses Unicode word boundaries and normalizes decomposed letters", () => {
    assert.deepEqual(matchedRules("brainstorm warmup droughtness vpd2"), []);
    assert.deepEqual(keywordCategories("EL NIN\u0303O 2015"), ["precip", "tair", "sst"]);
  });
  it("uses the documented default only when no rules match", () => {
    assert.deepEqual(keywordCategories("an unfamiliar event"), []);
    const result = keywordSelect("an unfamiliar event");
    assert.deepEqual(result.votes.filter((v) => v.selected).map((v) => v.category), DEFAULT_CATEGORIES);
    assert.equal(result.suggestedTime, null);
  });
});

describe("suggested event time", () => {
  const cases: [string, string | null][] = [
    ["2021 台灣春季大旱", "2021-01..2021-12"],
    ["Texas winter storm 2021", "2021-01..2021-12"],
    ["marine heatwave 2016", "2016-01..2016-12"],
    ["2021 年 2 月到 5 月台灣乾旱", "2021-02..2021-05"],
    ["2021年2-5月台灣乾旱", "2021-02..2021-05"],
    ["2020 年 11 月至 2021 年 2 月", "2020-11..2021-02"],
    ["2020 年 11 月到 2 月", "2020-11..2021-02"],
    ["2021年十月颱風", "2021-10..2021-10"],
    ["2021年十一月", "2021-11..2021-11"],
    ["2021年十二月", "2021-12..2021-12"],
    ["2021-02..2021-05 drought", "2021-02..2021-05"],
    ["2021-02 to 2021-05", "2021-02..2021-05"],
    ["2022/07 Pakistan floods", "2022-07..2022-07"],
    ["Pakistan floods July 2022", "2022-07..2022-07"],
    ["Feb–May 2021 drought", "2021-02..2021-05"],
    ["Nov 2020 to Feb 2021 cold", "2020-11..2021-02"],
    ["Nov – Feb 2020", "2019-11..2020-02"],
    ["2022 August floods", "2022-08..2022-08"],
    ["2019–20 Australian bushfires", "2019-01..2020-12"],
    ["2019-2020 fires", "2019-01..2020-12"],
    ["2019–20 澳洲黑色夏季", "2019-01..2020-12"],
    ["夏威夷 2023 野火", "2023-01..2023-12"],
    ["El Niño 2015 to 2016", "2015-01..2016-12"],
    ["2011-12 drought", "2011-12..2011-12"],
    ["２０２１年２月", "2021-02..2021-02"],
    ["The Aral Sea has been shrinking since the 1960s", "1960-01..1969-12"],
    ["1990 年代的乾旱", "1990-01..1999-12"],
    ["Amazon drought", null],
    ["b4-4040046370 drought", null],
    ["station 12345", null],
    ["2021-05..2021-02", null],
    ["2021年5月到2021年2月", null],
    ["Nov 2020 to Feb 2020", null],
  ];
  for (const [event, expected] of cases) {
    it(`parses ${event}`, () => {
      const time = suggestedTime(event);
      assert.equal(time ? `${time.start}..${time.end}` : null, expected);
    });
  }
});
