// Run from web/: npx tsx --test components/detective/lab-ui.test.ts
// The workbench "Tests" area's pure helpers: grouping, availability, slope units, overlays, result
// wording and the multiple-testing log.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Decomposition, YearMonth } from "../../lib/detective/contracts";
import { LAB_GROUPS, LAB_TOOLS, runLabTool, type LabOutcome } from "../../lib/detective/lab";
import { TEST_IDS, ymFromIndex } from "../../lib/detective/url";
import { COPY } from "./workbench/copy";
import { GROUPS, analyseMs, availability, groupOf, overlayFor, pickInGroup, slopeScale, staleReason, testLog, testsIn } from "./workbench/lab/tests";
import { TEST_ICON } from "./workbench/lab/icons";
import { countText, pText, resultView } from "./workbench/lab/format";

/** a fake decomposition: months, residual and z are what runLabTool reads */
function fake(residual: (number | null)[]): Decomposition {
  const months = residual.map((_, i) => ymFromIndex(2000 * 12 + i) as YearMonth);
  return {
    months, residual, raw: residual, trend: residual.map(() => 0), seasonal: residual.map(() => 0), z: residual,
    baseline: { months, excluded: { start: months[0], end: months[0] }, n: months.length },
  };
}
const noise = (n: number, seed = 3) => Array.from({ length: n }, (_, i) => Math.sin(i * 1.7 + seed) * 0.5 + Math.cos(i * 0.9) * 0.3);
const ok = (o: LabOutcome) => { assert.equal(o.kind, "ok"); return o as Extract<LabOutcome, { kind: "ok" }>; };
const ctx = { unit: "mm", months: 24, monthLabel: (i: number) => `m${i}` };

describe("test grouping", () => {
  it("follows the lab's four groups, every tool once, English labels", () => {
    assert.equal(LAB_GROUPS.length, GROUPS.length);
    assert.deepEqual(GROUPS.flatMap(testsIn), [...LAB_TOOLS]);
    assert.deepEqual([...TEST_IDS], [...LAB_TOOLS]);
    assert.equal(groupOf("pettitt"), "extremes");
    assert.equal(groupOf("spectrum"), "cycles");
    for (const t of TEST_IDS) assert.match(COPY.lab.test[t], /^[\x20-\x7E–σ]+$/, t);
    for (const g of GROUPS) assert.ok(COPY.lab.group[g].split(" ").length <= 3);
  });
});

describe("availability", () => {
  const r = noise(60);
  it("disables tests short of months with the reason", () => {
    const a = availability(r, 10, 13); // 4 months
    assert.equal(a.mean.ok, true);
    assert.equal(a.compare.ok, true);
    assert.equal(a.cusum.ok, true);
    assert.equal(a.mk.ok, false);
    assert.equal(a.mk.reason, "Needs ≥ 10 months (4 in range)");
    assert.equal(a.spectrum.need, 48);
  });
  it("counts observed months only; compare and spread need 12 months outside", () => {
    const gappy = r.map((v, i) => (i % 2 ? null : v));
    assert.equal(availability(gappy, 0, 19).mk.ok, true); // 10 observed
    assert.equal(availability(gappy, 0, 17).mk.ok, false); // 9 observed
    const all = availability(r, 0, 59);
    for (const t of ["compare", "variance"] as const) {
      assert.equal(all[t].ok, false);
      assert.equal(all[t].shortInRange, false);
      assert.equal(all[t].reason, "Needs ≥ 12 months outside the range");
    }
  });
  it("picks the remembered test of a group, else the first available", () => {
    const a = availability(r, 10, 13);
    assert.equal(pickInGroup("mean", "wilcoxon", a), "mean");
    assert.equal(pickInGroup("trend", null, availability(r, 0, 29)), "ols");
    assert.equal(pickInGroup("trend", "mk", availability(r, 0, 29)), "mk");
  });
});

describe("slope units", () => {
  it("per decade from ten years, else per year", () => {
    assert.deepEqual(slopeScale(119), { k: 12, per: "year" });
    assert.deepEqual(slopeScale(120), { k: 120, per: "decade" });
  });
});

describe("overlays", () => {
  const d = fake(noise(48).map((v, i) => v + (i >= 24 ? 2 : 0)));
  it("passes the lab's fit segments through (two for the hinge)", () => {
    const o = ok(runLabTool("piecewise", d, 0, 47));
    assert.equal(overlayFor(o)!.segments.length, 2);
  });
  it("Pettitt marks the first month after the break; nothing for an insufficient run or a figure-only test", () => {
    const o = ok(runLabTool("pettitt", d, 0, 47));
    assert.equal(overlayFor(o)!.breakAfter, 24);
    assert.equal(overlayFor(runLabTool("mk", d, 0, 3)), null);
    assert.equal(overlayFor(ok(runLabTool("acf", d, 0, 47))), null);
  });
});

describe("result wording", () => {
  const d = fake(noise(60).map((v, i) => v + (i >= 24 ? 2 : 0) + i * 0.01));
  it("formats p and counts like the stats panel", () => {
    assert.equal(pText(0.031), "p = 0.03");
    assert.equal(pText(0.0001), "p < 0.001");
    assert.equal(countText(3), "3");
    assert.equal(countText(3.5), "3.5");
  });
  it("every tool gives a verdict and 1–4 key numbers in English", () => {
    for (const t of TEST_IDS) {
      const v = resultView(ok(runLabTool(t, d, 0, 47)).stats, ctx);
      assert.ok(v.headline.length > 0 && v.headline.length < 48, `${t}: ${v.headline}`);
      assert.ok(v.cells.length >= 1 && v.cells.length <= 4, t);
      assert.doesNotMatch(JSON.stringify(v), /[一-鿿]/, t);
    }
  });
  it("shift: verdict first, 4 key numbers with unit and CI", () => {
    const v = resultView(ok(runLabTool("mean", d, 30, 40)).stats, ctx);
    assert.equal(v.significant, true);
    assert.equal(v.headline, "Significant shift up");
    assert.match(v.cells[0].value, /^\+.* mm$/);
    assert.match(v.cells[0].sub!, /^95 % CI /);
    assert.equal(v.cells[2].label, "Significance");
  });
  it("trend: slope per year for short ranges, per decade for long ones", () => {
    const o = ok(runLabTool("ols", d, 0, 47)).stats;
    assert.match(resultView(o, { ...ctx, months: 48 }).cells[0].value, / mm\/yr$/);
    assert.match(resultView(o, { ...ctx, months: 120 }).cells[0].value, / mm\/decade$/);
  });
  it("tags p values that are not autocorrelation-corrected, or optimistic", () => {
    const c = resultView(ok(runLabTool("compare", d, 30, 40)).stats, ctx);
    assert.equal(c.cells.find((x) => x.label === "Mann–Whitney U")?.tag, "uncorrected");
    assert.equal(c.cells.find((x) => x.label === "Welch t")?.tag, undefined);
    const p = resultView(ok(runLabTool("pettitt", d, 0, 47)).stats, ctx);
    assert.equal(p.headline, "Break at m24");
    assert.equal(p.cells.find((x) => x.label === "Significance")?.tag, "uncorrected");
    assert.equal(resultView(ok(runLabTool("piecewise", d, 0, 59)).stats, ctx).cells.at(-1)?.tag, "optimistic");
  });
  it("descriptive CUSUM has no significance", () => {
    const v = resultView(ok(runLabTool("cusum", d, 0, 59)).stats, ctx);
    assert.equal(v.significant, null);
    assert.match(v.headline, /^Largest (deficit|surplus) /);
  });
});

describe("multiple-testing log", () => {
  const d = fake(noise(60).map((v, i) => v + (i >= 30 ? 1.5 : 0)));
  const run = (t: (typeof TEST_IDS)[number]) => ({ test: t, outcome: runLabTool(t, d, 0, 59) });
  it("leaves out descriptive tests and counts chance hits", () => {
    const log = testLog([run("mk"), run("cusum"), run("spectrum"), run("pettitt"), run("acf")]);
    assert.deepEqual(log.entries.map((e) => e.test), ["mk", "pettitt", "acf"]);
    assert.equal(log.expected, 3 * 0.05);
    assert.equal(log.significant, log.entries.filter((e) => e.p < 0.05).length);
  });
  it("Holm: holds / uncorrected only / not significant", () => {
    const fakeOk = (p: number): LabOutcome => ({ kind: "ok", segments: [], stats: { ...(ok(runLabTool("pettitt", d, 0, 59)).stats as object), p } as never });
    const log = testLog([
      { test: "pettitt", outcome: fakeOk(0.001) },
      { test: "mean", outcome: { kind: "ok", segments: [], stats: { ...(ok(runLabTool("mean", d, 0, 59)).stats as object), p: 0.04 } as never } },
      { test: "mk", outcome: { kind: "ok", segments: [], stats: { ...(ok(runLabTool("mk", d, 0, 59)).stats as object), p: 0.5 } as never } },
    ]);
    assert.deepEqual(log.entries.map((e) => e.status), ["holds", "uncorrected-only", "not-significant"]);
    assert.equal(log.significant, 2);
  });
});

describe("Analyse", () => {
  it("paces the progress bar 600–1200 ms by test weight and range; instant with reduced motion", () => {
    assert.equal(analyseMs("mean", 4), 600);
    assert.ok(analyseMs("bootstrap", 4) > analyseMs("mean", 4));
    assert.ok(analyseMs("mk", 120) > analyseMs("mk", 12));
    for (const t of TEST_IDS) for (const n of [1, 24, 600]) {
      const ms = analyseMs(t, n);
      assert.ok(ms >= 600 && ms <= 1200, `${t} ${n}: ${ms}`);
      assert.equal(analyseMs(t, n, true), 0);
    }
  });
  it("marks a result stale when the range or the test changes", () => {
    const r = { key: "sm|10..13", test: "mean" as const };
    assert.equal(staleReason(null, "sm|10..13", "mean"), null);
    assert.equal(staleReason(r, "sm|10..13", "mean"), null);
    assert.equal(staleReason(r, "sm|10..14", "mean"), "range");
    assert.equal(staleReason(r, "sm|10..13", "mk"), "test");
    assert.equal(staleReason(r, "tws|10..13", "mk"), "range");
  });
  it("every test has an icon", () => {
    for (const t of TEST_IDS) assert.match(TEST_ICON[t], /^M[\d.]/, t);
  });
});
