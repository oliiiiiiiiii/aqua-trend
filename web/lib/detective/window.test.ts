// Run from web/: npx tsx --test lib/detective/window.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_WINDOW, clampWindow, convertWindow, dailySpan, decodeWindow, encodeWindow, eventDays, isDailyWindow, monthView,
  sameWindow, windowFromPad, windowLabel, windowMonths, workbenchView,
} from "./window";

test("URL round trip: 8m, 3y, 2w, all", () => {
  for (const s of ["8m", "3y", "2w", "all"]) assert.equal(encodeWindow(decodeWindow(s)!), s);
  assert.deepEqual(decodeWindow("8m"), { unit: "month", n: 8 });
  assert.deepEqual(decodeWindow(" 3Y "), { unit: "year", n: 3 });
  assert.equal(decodeWindow("all"), "all");
});

test("decode clamps out-of-range numbers and rejects junk", () => {
  assert.deepEqual(decodeWindow("40m"), { unit: "month", n: 12 });
  assert.deepEqual(decodeWindow("9w"), { unit: "week", n: 5 });
  assert.deepEqual(decodeWindow("0y"), { unit: "year", n: 1 });
  for (const s of [null, undefined, "", "m", "8", "8h", "-2m", "1.5m", "8 m", "alll", "1234m"]) assert.equal(decodeWindow(s as string), null, String(s));
});

test("encode clamps and rounds", () => {
  assert.equal(encodeWindow({ unit: "month", n: 30 }), "12m");
  assert.equal(encodeWindow({ unit: "week", n: 2.4 }), "2w");
  assert.deepEqual(clampWindow({ unit: "year", n: Number.NaN }), { unit: "year", n: 1 });
});

test("months either side of the event", () => {
  assert.equal(windowMonths({ unit: "month", n: 8 }), 8);
  assert.equal(windowMonths({ unit: "year", n: 3 }), 36);
  assert.equal(windowMonths({ unit: "week", n: 1 }), 1);
  assert.equal(windowMonths({ unit: "week", n: 5 }), 2);
  assert.equal(windowMonths("all"), "all");
});

test("month view around the event; all = union with the record", () => {
  const ev = { s: 100, e: 103 };
  assert.deepEqual(monthView({ unit: "month", n: 6 }, ev), { s: 94, e: 109 });
  assert.deepEqual(monthView({ unit: "year", n: 2 }, ev), { s: 76, e: 127 });
  assert.deepEqual(monthView("all", ev, { s: 10, e: 200 }), { s: 10, e: 200 });
  assert.deepEqual(monthView("all", ev, { s: 95, e: 104 }), { s: 88, e: 115 });
  assert.deepEqual(monthView("all", ev), monthView(DEFAULT_WINDOW, ev));
});

test("unit changes keep the reach, clamped", () => {
  assert.deepEqual(convertWindow({ unit: "month", n: 12 }, "year"), { unit: "year", n: 1 });
  assert.deepEqual(convertWindow({ unit: "year", n: 2 }, "month"), { unit: "month", n: 12 });
  assert.deepEqual(convertWindow({ unit: "month", n: 1 }, "week"), { unit: "week", n: 4 });
  assert.deepEqual(convertWindow({ unit: "week", n: 2 }, "month"), { unit: "month", n: 1 });
  assert.deepEqual(convertWindow("all", "year"), { unit: "year", n: 10 });
});

test("legacy pad -> window", () => {
  assert.deepEqual(windowFromPad(12), { unit: "month", n: 12 });
  assert.deepEqual(windowFromPad(6), { unit: "month", n: 6 });
  assert.deepEqual(windowFromPad(24), { unit: "year", n: 2 });
  assert.deepEqual(windowFromPad(60), { unit: "year", n: 5 });
});

test("labels", () => {
  assert.equal(windowLabel({ unit: "month", n: 8 }), "± 8 months");
  assert.equal(windowLabel({ unit: "week", n: 1 }), "± 1 week");
  assert.equal(windowLabel({ unit: "year", n: 10 }), "± 10 years");
  assert.equal(windowLabel("all"), "All");
  assert.ok(sameWindow({ unit: "month", n: 3 }, { unit: "month", n: 3 }));
  assert.ok(!sameWindow({ unit: "month", n: 3 }, "all"));
});

test("daily span of a weeks window, leap years included", () => {
  assert.deepEqual(eventDays({ start: "2021-02", end: "2021-05" }), { start: "2021-02-01", end: "2021-05-31" });
  assert.deepEqual(dailySpan({ start: "2021-03", end: "2021-03" }, 1), { start: "2021-02-22", end: "2021-04-07", days: 45 });
  assert.deepEqual(dailySpan({ start: "2020-02", end: "2020-02" }, 2), { start: "2020-01-18", end: "2020-03-14", days: 57 });
  assert.equal(dailySpan({ start: "2021-02", end: "2021-05" }, 9).days, 120 + 70);
});

test("a days window: URL form, limits, reach, label", () => {
  assert.deepEqual(decodeWindow("3d"), { unit: "day", n: 3 });
  assert.deepEqual(decodeWindow("40d"), { unit: "day", n: 14 });
  assert.equal(encodeWindow({ unit: "day", n: 7 }), "7d");
  assert.equal(windowMonths({ unit: "day", n: 14 }), 1);
  assert.equal(windowLabel({ unit: "day", n: 1 }), "± 1 day");
  assert.equal(windowLabel({ unit: "day", n: 10 }), "± 10 days");
  assert.deepEqual(convertWindow({ unit: "week", n: 1 }, "day"), { unit: "day", n: 7 });
  assert.deepEqual(convertWindow({ unit: "day", n: 14 }, "week"), { unit: "week", n: 2 });
  assert.ok(isDailyWindow({ unit: "day", n: 3 }) && isDailyWindow({ unit: "week", n: 2 }));
  assert.ok(!isDailyWindow({ unit: "month", n: 3 }) && !isDailyWindow("all"));
});

test("the daily span is built around the given range (the selection), in days or weeks", () => {
  assert.deepEqual(dailySpan({ start: "2021-03", end: "2021-03" }, 3, "day"), { start: "2021-02-26", end: "2021-04-03", days: 37 });
  assert.deepEqual(dailySpan({ start: "2021-03", end: "2021-03" }, 99, "day"), { start: "2021-02-15", end: "2021-04-14", days: 59 });
  // a selection three months before a Feb–May 2021 event: the span is around the selection, not the event
  assert.deepEqual(dailySpan({ start: "2020-11", end: "2020-11" }, 1, "week"), { start: "2020-10-25", end: "2020-12-07", days: 44 });
});

test("a days or weeks window keeps a selection made away from the event; months and years do not move", () => {
  const event = { s: 24253, e: 24256 };       // Feb–May 2021
  const far = { s: 24240, e: 24241 };         // Jan–Feb 2020
  assert.deepEqual(workbenchView({ unit: "month", n: 6 }, event, far), monthView({ unit: "month", n: 6 }, event));
  assert.deepEqual(workbenchView("all", event, far, { s: 24000, e: 24300 }), { s: 24000, e: 24300 });
  assert.deepEqual(workbenchView({ unit: "week", n: 2 }, event, far), { s: 24239, e: 24257 });
  assert.deepEqual(workbenchView({ unit: "day", n: 5 }, event, far), { s: 24239, e: 24257 });
  // the selection on the event: exactly the old weeks view
  assert.deepEqual(workbenchView({ unit: "week", n: 5 }, event, event), monthView({ unit: "week", n: 5 }, event));
});
