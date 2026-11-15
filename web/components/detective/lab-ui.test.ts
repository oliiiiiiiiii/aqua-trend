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
  it("follows the lab's five groups, every tool once, English labels", () => {
    assert.equal(LAB_GROUPS.length, GROUPS.length);
    assert.deepEqual(GROUPS.flatMap(testsIn), [...LAB_TOOLS]);
    assert.deepEqual([...TEST_IDS], [...LAB_TOOLS]);
    assert.equal(groupOf("pettitt"), "extremes");
    assert.equal(groupOf("spectrum"), "cycles");
    assert.equal(groupOf("gp"), "ml");
    assert.equal(testsIn("ml").length, 7);
    for (const t of TEST_IDS) assert.match(COPY.lab.test[t], /^[\x20-\x7E–σ]+$/, t);
    for (const g of GROUPS) assert.ok(COPY.lab.group[g].split(" ").length <= 3);
  });
});

describe("availability", () => {
  const r = noise(60);
  it("disables tests short of months with the reason", () => {
    const a = availability(r, 10, 11); // 2 months
    assert.equal(a.mean.ok, true);
    assert.equal(a.compare.ok, true);
    assert.equal(a.cusum.ok, true);
    assert.equal(a.mk.ok, false);
    assert.equal(a.mk.reason, "Needs ≥ 3 months (2 in range)");
    assert.equal(a.spectrum.need, 4);
    assert.equal(availability(r, 10, 10).cusum.ok, true); // a single month
  });
  it("counts observed months only; compare and spread need 12 months outside", () => {
    const gappy = r.map((v, i) => (i % 2 ? null : v));
    assert.equal(availability(gappy, 0, 5).mk.ok, true); // 3 observed
    assert.equal(availability(gappy, 0, 3).mk.ok, false); // 2 observed
    const all = availability(r, 0, 59);
    for (const t of ["compare", "variance"] as const) {
      assert.equal(all[t].ok, false);
      assert.equal(all[t].shortInRange, false);
      assert.equal(all[t].reason, "Needs ≥ 12 months outside the range");
    }
  });
  it("picks the remembered test of a group, else the first available", () => {
    const a = availability(r, 10, 10); // one month: no mean-group test, so the first; cusum is the first extremes test
    assert.equal(pickInGroup("mean", "wilcoxon", a), "mean");
    assert.equal(pickInGroup("extremes", "runs", a), "cusum");
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
    assert.equal(overlayFor(runLabTool("mk", d, 0, 1)), null);
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
    for (const t of TEST_IDS.filter((x) => groupOf(x) !== "ml")) {
      const v = resultView(ok(runLabTool(t, d, 0, 47)).stats, ctx);
      assert.ok(v.headline.length > 0 && v.headline.length < 64, `${t}: ${v.headline}`);
      assert.ok(v.cells.length >= 1 && v.cells.length <= 4, t);
      assert.doesNotMatch(JSON.stringify(v), /[一-鿿]/, t);
    }
  });
  it("machine-learning tools: a plain verdict, 1–4 numbers, a caveat, English only", () => {
    const d2 = fake(noise(120, 5).map((v, i) => v + (i >= 80 && i < 92 ? 2.5 : 0)));
    for (const t of testsIn("ml")) {
      const o = ok(runLabTool(t, d2, 70, 105));
      const v = resultView(o.stats, ctx);
      assert.ok(v.headline.length > 0 && v.headline.length < 64, `${t}: ${v.headline}`);
      assert.ok(v.cells.length >= 1 && v.cells.length <= 4, t);
      assert.ok(v.caveat && v.caveat.length < 90, t);
      assert.doesNotMatch(JSON.stringify(v), /[一-鿿]/, t);
      const ov = overlayFor(o);
      assert.doesNotMatch(JSON.stringify(ov), /[一-鿿]/, t);
      if (ov?.bands.length) assert.ok(ov.bands.every((b) => b.x1 >= b.x0), t);
      if (ov && ov.bands.length && t !== "analog") assert.ok(ov.legend.length > 0, t);
    }
    assert.equal(resultView(ok(runLabTool("forecast", d2, 70, 105)).stats, ctx).significant !== null, true);
    assert.equal(resultView(ok(runLabTool("gp", d2, 70, 105)).stats, ctx).significant, null);
  });
  it("band overlays are marked (similar periods numbered, states low / high); a forecast with no history is unavailable", () => {
    const d2 = fake(noise(120, 5).map((v, i) => v + (i >= 80 && i < 92 ? 2.5 : 0)));
    const a = overlayFor(ok(runLabTool("analog", d2, 70, 105)))!;
    assert.deepEqual(a.bands.map((b) => b.label), a.bands.map((_, k) => String(k + 1)));
    const h = overlayFor(ok(runLabTool("hmm", d2, 0, 119)))!;
    assert.ok(h.bands.some((b) => b.fill === "high") && h.bands.some((b) => b.fill === "low"));
    const av = availability(d2.residual, 10, 30);
    assert.equal(av.forecast.ok, false);
    assert.match(av.forecast.reason!, /3 years/);
    assert.equal(availability(d2.residual, 70, 105).forecast.ok, true);
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

describe("the Tests area in days and weeks", () => {
  it("speaks in the step of the series: month words become day or week words, slopes per week", async () => {
    const { labCopy, unitize, slopeFor, pointAxis, monthAxis, formatDays } = await import("./workbench/lab/step");
    assert.equal(unitize("Needs ≥ 12 months", "day"), "Needs ≥ 12 days");
    assert.equal(unitize("3-month means, 6-month SD and the monthly change", "week"), "3-week means, 6-week SD and the weekly change");
    assert.equal(unitize("Largest deficit over 4 mo", "day"), "Largest deficit over 4 d");
    assert.equal(unitize("Months with |z| > 2", "week"), "Weeks with |z| > 2");
    assert.equal(unitize("A forecast needs about 3 years of unbroken data before the range", "day"), "A forecast needs about 30 days of unbroken data before the range");
    assert.equal(unitize("Needs ≥ 12 months", "month"), "Needs ≥ 12 months");
    const day = labCopy("day");
    assert.equal(day.needs(3), "Needs ≥ 3 days");
    assert.equal(day.perYear("mm"), "mm/wk");
    assert.equal(day.fig.lag, "lag (d)");
    assert.equal(day.fig.period(10), "10 d");
    assert.equal(day.fig.period(21), "3 wk");
    assert.equal(labCopy("week").fig.period(4), "4 wk");
    assert.equal(labCopy("month"), labCopy("month"));
    assert.deepEqual(slopeFor("day", 30), { k: 7, per: "year" });
    assert.deepEqual(slopeFor("month", 150), { k: 120, per: "decade" });
    const ax = pointAxis("week", ["2021-03-01", "2021-03-08"], ["2021-03-07", "2021-03-14"]);
    assert.equal(ax.label(0), "1 – 7 Mar 2021");
    assert.equal(ax.span(0, 1), "1 – 14 Mar 2021");
    assert.equal(ax.count(2), "2 weeks");
    assert.equal(monthAxis(["2021-02", "2021-03"]).span(0, 1), "Feb – Mar 2021");
    assert.equal(formatDays("2020-12-28", "2021-01-03"), "28 Dec 2020 – 3 Jan 2021");
    assert.equal(formatDays("2021-02-28", "2021-03-06"), "28 Feb – 6 Mar 2021");
  });
  it("the calendar-month test is not offered on days or weeks", async () => {
    const { availability } = await import("./workbench/lab/tests");
    const v = Array.from({ length: 60 }, (_, i) => Math.sin(i));
    assert.equal(availability(v, 0, 59).monthly.ok, true);
    const a = availability(v, 0, 59, "day");
    assert.equal(a.monthly.ok, false);
    assert.equal(a.monthly.reason, "Monthly series only");
    assert.equal(availability(v, 0, 0, "week").mean.reason, "Needs ≥ 2 weeks (1 in range)");
    // a week of days is enough for the mean, a trend and the change-point tools
    const week = availability(v, 0, 6, "day");
    for (const t of ["mean", "ols", "mk", "wilcoxon", "pettitt", "cusum", "bocpd", "gp"] as const) assert.equal(week[t].ok, true, t);
    assert.equal(availability(v, 3, 3, "day").cusum.ok, true); // a single day
  });
});
