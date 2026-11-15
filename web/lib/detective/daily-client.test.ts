// Run from web/: npx tsx --test lib/detective/daily-client.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyDates, type DailyRequest, type DailySeries } from "./daily";
import { DailyLoadError, completedDailyRange, normalizeDailySeries, requestDailySeries, type DailyProgress } from "./daily-client";

const request: DailyRequest = { region: "b4-4040046370", layer: "sm_root", start: "2024-02-26", end: "2024-02-29" };
function fixture(query: DailyRequest = request): DailySeries {
  const dates = dailyDates(query);
  return {
    ...query, resolution: "daily", dates, values: dates.map((_, i) => i === 1 ? null : i), unit: "kg/m²",
    source: { provider: "earthdata", dataset: "Test fixture", url: "https://example.org/daily-fixture", aggregation: "Test daily mean", spatialMethod: "Test region mean" },
    retrievedAt: "2026-11-15T00:00:00Z",
  };
}
function queryFrom(input: RequestInfo | URL): DailyRequest {
  const query = new URL(String(input), "http://localhost").searchParams;
  return { region: query.get("region")!, layer: query.get("layer") as DailyRequest["layer"], start: query.get("start")!, end: query.get("end")! };
}

test("only completed UTC days are requested from a current month", () => {
  const month = { start: "2024-02-01", end: "2024-02-29" };
  assert.deepEqual(completedDailyRange(month, Date.parse("2024-02-15T23:59:59Z")), { start: month.start, end: "2024-02-14" });
  assert.deepEqual(completedDailyRange(month, Date.parse("2024-02-16T00:00:00Z")), { start: month.start, end: "2024-02-15" });
  assert.deepEqual(completedDailyRange(month, Date.parse("2024-03-01T00:00:00Z")), month);
  assert.equal(completedDailyRange(month, Date.parse("2024-02-01T23:59:59Z")), null);
  assert.equal(completedDailyRange(month, Date.parse("2024-01-31T23:59:59Z")), null);
  assert.equal(completedDailyRange({ start: "2024-02-30", end: "2024-02-30" }), null);
});

test("sparse daily dates preserve the leap day and distinguish missing observations from zero", () => {
  const sparse = { ...fixture(), dates: ["2024-02-26", "2024-02-29"], values: [0, 5] };
  const result = normalizeDailySeries(sparse, request);
  assert.deepEqual(result.dates, ["2024-02-26", "2024-02-27", "2024-02-28", "2024-02-29"]);
  assert.deepEqual(result.values, [0, null, null, 5]);
  assert.deepEqual(normalizeDailySeries({ ...fixture(), dates: [], values: [] }, request).values, [null, null, null, null]);
});

test("responses must match the query and contain valid, unique dates and finite values", () => {
  for (const change of [
    { region: "b4-4040879050" }, { layer: "tair" }, { start: "2024-02-25" },
    { dates: ["2024-02-30"], values: [1] },
    { dates: ["2024-02-26", "2024-02-26"], values: [1, 2] },
    { dates: ["2024-02-26"], values: [NaN] },
    { dates: ["2024-02-26"], values: [Infinity] },
    { dates: ["2024-02-26"], values: ["0"] },
    { dates: ["2024-02-26"], values: [] },
    { source: { ...fixture().source, url: "javascript:alert(1)" } },
    { retrievedAt: "not a timestamp" },
  ]) assert.throws(() => normalizeDailySeries({ ...fixture(), ...change }, request), DailyLoadError);
});

test("daily requests are sequential three-day chunks with partial calendar progress", async (t) => {
  const requested: DailyRequest[] = [];
  const progress: DailyProgress[] = [];
  let active = 0;
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    assert.equal(++active, 1);
    const query = queryFrom(url);
    requested.push(query);
    await Promise.resolve();
    active--;
    return Response.json(fixture(query));
  });
  const series = await requestDailySeries(request, new AbortController().signal, (update) => progress.push(update));
  assert.deepEqual(requested.map(({ start, end }) => [start, end]), [["2024-02-26", "2024-02-28"], ["2024-02-29", "2024-02-29"]]);
  assert.deepEqual(progress.map((update) => update.completedDays), [3, 4]);
  assert.deepEqual(progress[0].series.values, [0, null, 2, null]);
  assert.deepEqual(series.values, [0, null, 2, 0]);
  assert.equal(series.start, request.start);
  assert.equal(series.end, request.end);
});

test("a failed chunk keeps previously delivered progress and does not expose server details", async (t) => {
  let calls = 0;
  const progress: DailyProgress[] = [];
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => ++calls === 1
    ? Response.json(fixture(queryFrom(url)))
    : Response.json({ error: { code: "unconfigured", message: "Private authentication detail" } }, { status: 503 }));
  await assert.rejects(requestDailySeries(request, new AbortController().signal, (update) => progress.push(update)), (error: unknown) => {
    assert.ok(error instanceof DailyLoadError);
    assert.equal(error.code, "unavailable");
    assert.doesNotMatch(error.message, /Private|authentication/);
    return true;
  });
  assert.equal(calls, 2);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].completedDays, 3);
  assert.deepEqual(progress[0].series.values, [0, null, 2, null]);
});

test("cancellation after progress stops all remaining chunks", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => { calls++; return Response.json(fixture(queryFrom(url))); });
  await assert.rejects(requestDailySeries(request, controller.signal, () => controller.abort()), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("a late response after cancellation cannot publish progress", async (t) => {
  const controller = new AbortController();
  let publish = 0;
  let release!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { release = resolve; }));
  const pending = requestDailySeries(request, controller.signal, () => publish++);
  controller.abort();
  release(Response.json(fixture({ ...request, end: "2024-02-28" })));
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(publish, 0);
});

test("a malformed later chunk cannot replace valid partial observations", async (t) => {
  let calls = 0;
  const progress: DailyProgress[] = [];
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => Response.json({ ...fixture(queryFrom(url)), ...(++calls === 2 ? { unit: "incorrect unit" } : {}) }));
  await assert.rejects(requestDailySeries(request, new AbortController().signal, (update) => progress.push(update)), DailyLoadError);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].series.unit, "kg/m²");
});

test("a stalled chunk times out with a retryable public error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (_url: RequestInfo | URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  }));
  const pending = requestDailySeries(request, new AbortController().signal);
  t.mock.timers.tick(65_000);
  await assert.rejects(pending, (error: unknown) => error instanceof DailyLoadError && error.code === "timeout");
});
