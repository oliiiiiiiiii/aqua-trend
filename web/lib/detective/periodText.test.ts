// Run from web/: npx tsx --test lib/detective/periodText.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDay, parsePeriod } from "./periodText";

const NOW = Date.UTC(2026, 10, 15, 12); // 15 Nov 2026: yesterday is 14 Nov

describe("parsePeriod", () => {
  it("reads single days written any common way", () => {
    for (const t of ["2021-03-05", "2021/3/5", "5 Mar 2021", "Mar 5, 2021", "March 5th 2021", "2021年3月5日", "２０２１年３月５日"]) {
      assert.deepEqual(parsePeriod(t, NOW), { start: "2021-03-05", end: "2021-03-05" }, t);
    }
    assert.equal(parseDay("2021-02-30"), null);
  });
  it("reads day ranges", () => {
    const r = { start: "2021-03-05", end: "2021-03-12" };
    for (const t of ["5–12 Mar 2021", "5-12 March 2021", "Mar 5–12, 2021", "2021-03-05 to 2021-03-12", "2021/3/5 .. 2021/3/12", "2021年3月5日到12日", "5 Mar 2021 – 12 Mar 2021"]) {
      assert.deepEqual(parsePeriod(t, NOW), r, t);
    }
    assert.deepEqual(parsePeriod("28 Feb – 6 Mar 2021", NOW), { start: "2021-02-28", end: "2021-03-06" });
    assert.deepEqual(parsePeriod("2021年2月27日到3月2日", NOW), { start: "2021-02-27", end: "2021-03-02" });
    assert.equal(parsePeriod("2021-03-12 to 2021-03-05", NOW), null);
  });
  it("reads relative phrases, ending yesterday", () => {
    assert.deepEqual(parsePeriod("yesterday", NOW), { start: "2026-11-14", end: "2026-11-14" });
    assert.deepEqual(parsePeriod("last 7 days", NOW), { start: "2026-11-08", end: "2026-11-14" });
    assert.deepEqual(parsePeriod("past 2 weeks", NOW), { start: "2026-11-01", end: "2026-11-14" });
    assert.deepEqual(parsePeriod("最近 7 天", NOW), { start: "2026-11-08", end: "2026-11-14" });
    assert.deepEqual(parsePeriod("last 3 months", NOW), { start: "2026-08-15", end: "2026-11-14" });
    assert.deepEqual(parsePeriod("last month", NOW), { start: "2026-10-01", end: "2026-10-31" });
    assert.deepEqual(parsePeriod("上個月", NOW), { start: "2026-10-01", end: "2026-10-31" });
    assert.deepEqual(parsePeriod("this year", NOW), { start: "2026-01-01", end: "2026-11-14" });
    assert.deepEqual(parsePeriod("去年", NOW), { start: "2025-01-01", end: "2025-12-31" });
  });
  it("falls back to months and years", () => {
    assert.deepEqual(parsePeriod("Feb–May 2021", NOW), { start: "2021-02", end: "2021-05" });
    assert.deepEqual(parsePeriod("Mar 2021", NOW), { start: "2021-03", end: "2021-03" });
    assert.deepEqual(parsePeriod("2021", NOW), { start: "2021-01", end: "2021-12" });
    assert.deepEqual(parsePeriod("2021 年 2 月到 5 月", NOW), { start: "2021-02", end: "2021-05" });
    assert.equal(parsePeriod("drought", NOW), null);
    assert.equal(parsePeriod("", NOW), null);
  });
});
