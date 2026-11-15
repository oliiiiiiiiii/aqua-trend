// Run from web/: npx tsx --test components/detective/summary.test.ts
// The analysis workbench's pure helpers and the statistics panel (English copy, tiers in order).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Decomposition, TrendStats } from "../../lib/detective/contracts";
import { decompose } from "../../lib/detective/analysis";
import { baselineInfo, intervalDetail, type IntervalDetail } from "../../lib/detective/intervalDetail";
import { clampSpan, orderLanes, presetSpans, resizeSpan, selectionLabel, shiftSpan, toSpan, verdictView } from "./workbench/model";
import { selectionCsv } from "./workbench/csv";
import { gapRuns, timeScale, timeTicks } from "./workbench/axis";
import StatsPanel, { trendLine } from "./workbench/StatsPanel";

const event = toSpan({ start: "2021-02", end: "2021-05" });
const view = { s: event.s - 12, e: event.e + 12 };

describe("selection helpers", () => {
  it("Before / Event / After fill the window either side of the event", () => {
    const p = presetSpans(view, event);
    assert.deepEqual(p.before, { s: view.s, e: event.s - 1 });
    assert.deepEqual(p.event, event);
    assert.deepEqual(p.after, { s: event.e + 1, e: view.e });
    assert.equal(presetSpans({ s: event.s, e: event.e }, event).before, null);
  });

  it("clamps to the window and falls back to the event when nothing is left", () => {
    assert.deepEqual(clampSpan({ s: view.s - 5, e: event.s }, view, event), { s: view.s, e: event.s });
    assert.deepEqual(clampSpan({ s: view.e + 2, e: view.e + 4 }, view, event), event);
  });

  it("arrow keys move and resize inside the window", () => {
    assert.deepEqual(shiftSpan({ s: view.e - 2, e: view.e }, 1, view), { s: view.e - 2, e: view.e });
    assert.deepEqual(shiftSpan(event, -1, view), { s: event.s - 1, e: event.e - 1 });
    assert.deepEqual(resizeSpan({ s: event.s, e: event.s }, -1, view), { s: event.s, e: event.s });
    assert.deepEqual(resizeSpan(event, 1, view), { s: event.s, e: event.e + 1 });
  });

  it("words the selection relative to the event", () => {
    assert.deepEqual(selectionLabel(event, event), { range: "Feb – May 2021", length: "4 mo", relation: "the event" });
    assert.equal(selectionLabel(toSpan({ start: "2020-11", end: "2021-01" }), event).relation, "ends just before");
    assert.equal(selectionLabel(toSpan({ start: "2020-08", end: "2020-11" }), event).relation, "ends 2 mo before");
    assert.equal(selectionLabel(toSpan({ start: "2021-08", end: "2021-09" }), event).relation, "starts 2 mo after");
    assert.equal(selectionLabel(toSpan({ start: "2021-04", end: "2021-07" }), event).relation, "overlaps the event");
  });

  it("orders lanes by |mean z| without moving unknowns ahead", () => {
    const z: Record<string, number | null> = { a: 0.5, b: null, c: 2, d: 0.5 };
    assert.deepEqual(orderLanes(["a", "b", "c", "d"], "unusual", (k) => z[k]), ["c", "a", "d", "b"]);
    assert.deepEqual(orderLanes(["a", "b", "c", "d"], "picked", (k) => z[k]), ["a", "b", "c", "d"]);
  });
});

describe("time axis", () => {
  it("shares one x for a month across widths and lists missing runs", () => {
    const t = timeScale(view, 52 + 36 + 280);
    assert.equal(t.x(view.s), 0);
    assert.equal(t.at(t.cx(event.s)), event.s);
    assert.ok(timeTicks(t).some((k) => k.label === "2021" && k.major));
    const base = view.s;
    assert.deepEqual(gapRuns([1, null, null, 2, null], base, view), [{ s: base + 1, e: base + 2 }, { s: base + 4, e: base + 4 }]);
  });
});

/* ------------------------------------------------------------------ the panel, on real decompositions */

const series = (bump: number) => ({
  layer: "sm_root", unit: "mm", start: "2000-01",
  values: Array.from({ length: 300 }, (_, i) => 100 + i * 0.01 + Math.sin(i * Math.PI / 6) * 4 + Math.cos(i * 1.7) * 1.5
    + (i >= 253 && i <= 256 ? bump : 0)),
});
const ev = { start: "2021-02", end: "2021-05" };
const trend: TrendStats = { senPerDecade: -5.25, ci95: [-9, -1], mkP: 0.07, significant: false, yearsToSignificance: 12.2, nEff: 80 };

function panel(d: Decomposition, detail: IntervalDetail, expected?: "high" | "low") {
  return renderToStaticMarkup(createElement(StatsPanel, {
    d: detail, unit: "mm", polarity: "cool", expected, baseline: baselineInfo(d), trend, relation: "the event", onCsv: () => {},
  }));
}

describe("statistics panel", () => {
  it("leads with the verdict, then the four numbers, then shape, trend and method", () => {
    const d = decompose(series(-12), ev, 12);
    const detail = intervalDetail(d, ev);
    assert.equal(detail.verdict, "significant");
    const html = panel(d, detail, "low");
    const order = ["Unusually low", "Timing match, not proof of cause.", "Mean anomaly", "Standardised", "Significance", "Rank", "Peak", "Long-term trend", "Baseline and method"];
    let at = -1;
    for (const s of order) {
      const i = html.indexOf(s);
      assert.ok(i > at, `${s} after the previous tier`);
      at = i;
    }
    assert.match(html, /[Ll]owest of \d+/);
    assert.match(html, /Feb–May periods/);
    assert.match(html, /✓/);
    assert.doesNotMatch(html, /[一-鿿]/, "no Chinese copy on the workbench");
  });

  it("says when the interval is ordinary or the hypothesis fails", () => {
    const d = decompose(series(0), ev, 12);
    const detail = intervalDetail(d, ev);
    const html = panel(d, detail, detail.direction === "low" ? "high" : "low");
    assert.match(html, /Within normal variability|Tests disagree/);
    assert.match(html, /✗/);
    // right direction but not significant: a neutral "~" chip, not a ✓
    const weak = panel(d, detail, detail.direction ?? "low");
    assert.match(weak, /Right direction, not significant/);
    assert.doesNotMatch(weak, /✓/);
  });

  it("maps every verdict to a mark that carries a label", () => {
    const base = intervalDetail(decompose(series(-12), ev, 12), ev);
    for (const [verdict, mark] of [["significant", "●"], ["mixed", "◐"], ["not-significant", "○"], ["insufficient", "–"]] as const) {
      const v = verdictView({ ...base, verdict });
      assert.equal(v.mark, mark);
      assert.ok(v.title.length > 3 && v.label.length > 3);
    }
    assert.equal(verdictView(null).mark, "–");
  });

  it("states the trend in one line and admits when it cannot", () => {
    assert.equal(trendLine(trend, "mm"), "−5.25 mm/decade, p = 0.07, not significant");
    assert.equal(trendLine({ ...trend, senPerDecade: null }, "mm"), "Not enough data for a trend");
  });
});

describe("selection CSV", () => {
  it("writes one row per variable with empty cells for missing statistics", () => {
    const d = decompose(series(-12), ev, 12);
    const detail = intervalDetail(d, ev);
    const csv = selectionCsv(
      { event: "2021 Taiwan, spring drought", period: ev, region: "b4-1 Taiwan", selection: ev, pad: 12 },
      [
        { category: "soil", name: "Soil moisture", product: "GLDAS", layer: "sm_root", unit: "mm", expected: "low", d: detail },
        { category: "tws", name: "Terrestrial water storage", product: "GRACE", layer: "tws", unit: "cm", d: null },
      ],
    );
    const rows = csv.trim().split("\n").filter((l) => !l.startsWith("#"));
    assert.equal(rows.length, 3);
    const head = rows[0].split(",");
    const soil = rows[1].split(",");
    assert.equal(soil[head.indexOf("verdict")], "significant");
    assert.equal(soil[head.indexOf("expected")], "low");
    assert.equal(rows[2].split(",")[head.indexOf("mean_z")], "");
    assert.match(csv, /# Event: 2021 Taiwan, spring drought/);
  });
});
