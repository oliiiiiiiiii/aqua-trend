import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Decomposition, TrendStats } from "../../lib/detective/contracts";
import { conclusionText } from "./ConclusionCard";
import TrendPanel from "./TrendPanel";

test("anomaly strength uses the measured z, even when the displayed value rounds to 2", () => {
  const d: Decomposition = {
    months: ["2021-02"], raw: [9], trend: [10], seasonal: [0],
    residual: [-1], z: [-1.96],
    baseline: { months: [], n: 0, excluded: { start: "2020-02", end: "2022-02" } },
  };
  for (const [meanZ, expected] of [[-1.96, "moderate"], [1.96, "moderate"], [-2, "strong"], [2, "strong"]] as const) {
    const text = conclusionText({
      name: "降水", unit: "mm/day", d,
      stats: { range: { start: "2021-02", end: "2021-02" }, n: 1,
        meanResidual: -1, meanZ, percentile: null, rank: null },
    });
    assert.equal(text.strength, expected);
  }
});

test("an unavailable significance forecast does not assert a 50-year prediction", () => {
  const stats: TrendStats = { senPerDecade: 0, ci95: [-1, 1], mkP: 1,
    significant: false, yearsToSignificance: null, nEff: 120 };
  const markup = renderToStaticMarkup(createElement(TrendPanel, { stats, unit: "mm/day" }));
  assert.match(markup, /無法估計/);
  assert.doesNotMatch(markup, /50 年/);
});
