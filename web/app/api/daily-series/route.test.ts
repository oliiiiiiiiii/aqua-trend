import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET } from "./route";
import { basinGeometry } from "@/lib/detective/daily-server/regions";
import { basinGrid } from "@/lib/detective/daily-server/grid";

const realFetch = globalThis.fetch;
const savedToken = process.env.EDL_TOKEN, savedFile = process.env.EDL_TOKEN_FILE;
beforeEach(() => {
  delete process.env.EDL_TOKEN; delete process.env.EDL_TOKEN_FILE;
  globalThis.fetch = async () => { throw new Error("unexpected network request"); };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedToken === undefined) delete process.env.EDL_TOKEN; else process.env.EDL_TOKEN = savedToken;
  if (savedFile === undefined) delete process.env.EDL_TOKEN_FILE; else process.env.EDL_TOKEN_FILE = savedFile;
});
function request(params: Record<string, string> = {}) {
  return new Request(`http://localhost/api/daily-series/?${new URLSearchParams({
    region: "b4-4040046370", layer: "et_gldas", start: "2021-01-01", end: "2021-01-01", ...params,
  })}`);
}

test("route rejects oversized/invalid queries before any credentials or network use", async () => {
  const response = await GET(request({ end: "2021-01-04" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_request");
});

test("unconfigured route reports 503 with no fabricated daily values", async () => {
  const response = await GET(request());
  assert.equal(response.status, 503);
  const json = await response.json();
  assert.equal(json.code, "not_configured");
  assert.equal(json.values, undefined);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("route only resolves server-known basin IDs", async () => {
  process.env.EDL_TOKEN = "test-only-token";
  const response = await GET(request({ region: "b4-9999999999" }));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "unknown_region");
});

test("route preserves a real missing day and zero day, then serves aggregate cache without further downloads", async () => {
  process.env.EDL_TOKEN = "test-only-token";
  const grid = basinGrid(await basinGeometry("b4-4040046370"))!;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    const target = new URL(String(url));
    const match = /A(\d{4})(\d{2})(\d{2})\.(\d{2})00/.exec(decodeURIComponent(target.pathname))!;
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    if (date === "2021-01-03" && match[4] === "00") return new Response("missing granule", { status: 404 });
    const time = (Date.parse(`${date}T${match[4]}:00:00Z`) - Date.parse("2000-01-01T03:00:00Z")) / 60_000;
    return new Response([
      "Dataset: GLDAS_NOAH025_3H.test.nc4", `lon,${grid.lon.join(",")}`, `lat,${grid.lat.join(",")}`, `time,${time}`,
      `Evap_tavg.lon,${grid.lon.join(",")}`,
      ...grid.lat.map((lat) => `Evap_tavg.Evap_tavg[Evap_tavg.time=${time}][Evap_tavg.lat=${lat}],${grid.lon.map(() => "0").join(",")}`),
    ].join("\n"));
  };
  const first = await GET(request({ end: "2021-01-02" }));
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.deepEqual(result.dates, ["2021-01-01", "2021-01-02"]);
  assert.deepEqual(result.values, [0, null]);
  assert.equal(result.resolution, "daily");
  assert.equal(result.unit, "mm/day");
  assert.equal(result.source.provider, "earthdata");
  assert.equal(calls, 16);
  assert.deepEqual(await (await GET(request({ end: "2021-01-02" }))).json(), result);
  assert.equal(calls, 16);
});

test("route never exposes remote error text, credentials, or raw payloads", async () => {
  process.env.EDL_TOKEN = "test-only-token";
  globalThis.fetch = async () => { throw new Error("Authorization: Bearer test-only-token; secret path"); };
  const response = await GET(request({ start: "2021-02-01", end: "2021-02-01" }));
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.ok(!text.includes("test-only-token"));
  assert.ok(!text.includes("secret"));
});
