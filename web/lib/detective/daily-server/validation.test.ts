import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDailyRequest } from "./validation";
import { DailyError } from "./errors";

const today = Date.parse("2026-11-15T12:00:00Z");
function request(values: Record<string, string> = {}) {
  return new URL(`http://localhost/api/daily-series?${new URLSearchParams({
    region: "b4-1040000010", layer: "et_gldas", start: "2021-01-01", end: "2021-01-03", ...values,
  })}`);
}

test("accepts three inclusive days, crossing a month, and a real leap date", () => {
  assert.equal(parseDailyRequest(request(), today).end, "2021-01-03");
  assert.equal(parseDailyRequest(request({ start: "2020-02-29", end: "2020-02-29" }), today).start, "2020-02-29");
  assert.equal(parseDailyRequest(request({ start: "2021-01-31", end: "2021-02-02" }), today).end, "2021-02-02");
});

const invalidCases: Record<string, Record<string, string>> = {
  "impossible date": { start: "2021-02-29" },
  "non-padded date": { start: "2021-1-01" },
  "reversed range": { start: "2021-07-01" },
  "over three days": { end: "2021-01-04" },
  "too many months": { end: "2022-01-01" },
  "arbitrary geometry URL": { region: "https://example.test/basin.json" },
  "path traversal": { region: "../../secret" },
  "unsupported variable": { layer: "et_modis" },
  "empty layer": { layer: "" },
  "current incomplete UTC day": { start: "2026-11-15", end: "2026-11-15" },
  "future date": { start: "2027-01-01", end: "2027-01-01" },
};
for (const [name, values] of Object.entries(invalidCases)) {
  test(`rejects ${name}`, () => {
    assert.throws(() => parseDailyRequest(request(values), today), (error) => error instanceof DailyError && error.status === 400);
  });
}

test("rejects extra fields and duplicate parameters", () => {
  const duplicate = request();
  duplicate.searchParams.append("region", "b4-1040000020");
  assert.throws(() => parseDailyRequest(duplicate, today), DailyError);
  const unknown = request();
  unknown.searchParams.set("token", "not-a-real-secret");
  assert.throws(() => parseDailyRequest(unknown, today), DailyError);
});

test("accepts yesterday based on UTC, not the server timezone", () => {
  assert.equal(parseDailyRequest(request({ start: "2026-11-14", end: "2026-11-14" }), today).end, "2026-11-14");
});
