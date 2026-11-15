// Run from web/: npx tsx --test lib/detective/batchRun.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Region } from "../types";
import type { CategoryId, MonthlySeries, SelectResponse } from "./contracts";
import { CATEGORY_ORDER } from "./categories";
import { answerQuestion, jobKey, makeRegionLookup, resolveRegion, unusualVariables, type BatchDeps, type BatchJob } from "./batchRun";
import type { LayerInfo, VariableCatalog } from "./series";

/* ------------------------------------------------------------------ where */

const basin = (id: string, name: string, areaKm2: number, iso: string[]): Region =>
  ({ id, type: "basin4", name, surface: "land", areaKm2, centroid: [0, 0], iso });
const REGIONS = [
  basin("b4-1", "Indus basin (Pakistan)", 69_000, ["PAK"]),
  basin("b4-2", "Indus basin (Pakistan, Afghanistan)", 125_000, ["PAK", "AFG"]),
  basin("b4-3", "Basin 4558 (India, Pakistan)", 399_000, ["IND", "PAK"]),
  basin("b4-4", "Basin 4370 (Taiwan)", 36_000, ["TWN"]),
  basin("b4-5", "Murray basin (Australia)", 238_000, ["AUS"]),
];
const NO_SERIES = basin("b4-9", "Basin 9 (Nowhere)", 10, ["NWH"]);
const lookup = makeRegionLookup(
  new Map([...REGIONS, NO_SERIES].map((r) => [r.id, r])), REGIONS, new Map([["TWN", "臺灣"], ["PAK", "巴基斯坦"]]),
);
const ids = (rs: Region[]) => rs.map((r) => r.id);

test("region: an id is taken as written, and a wrong one is not replaced by a guess", () => {
  const r = resolveRegion({ region: "B4-4", question: "2022 Pakistan floods" }, lookup);
  assert.deepEqual([r.region?.id, r.via, r.problem], ["b4-4", "id", null]);
  assert.equal(resolveRegion({ region: "b4-777", question: "Pakistan" }, lookup).problem, "unknown-id");
  assert.equal(resolveRegion({ region: "b4-9", question: "Pakistan" }, lookup).problem, "no-series");
});

test("region: a river or a country in the cell; the largest match is used, the rest are candidates", () => {
  const river = resolveRegion({ region: "Indus", question: "floods" }, lookup);
  assert.deepEqual([river.region?.id, river.via], ["b4-2", "name"]);
  assert.deepEqual(ids(river.candidates), ["b4-2", "b4-1"]);
  const country = resolveRegion({ region: "Pakistan", question: "floods" }, lookup);
  assert.deepEqual(ids(country.candidates), ["b4-3", "b4-2", "b4-1"]);
  assert.equal(resolveRegion({ region: "台灣", question: "" }, lookup).region?.id, "b4-4");
  // words of a basin name that are neither a river nor a country
  assert.equal(resolveRegion({ region: "basin 4558", question: "" }, lookup).region?.id, "b4-3");
  assert.equal(resolveRegion({ region: "Atlantis", question: "Pakistan floods" }, lookup).problem, "not-found");
});

test("region: with an empty cell the place is read from the question, river before country", () => {
  const r = resolveRegion({ region: "", question: "2022 Pakistan floods along the Indus" }, lookup);
  assert.deepEqual([r.region?.id, r.via], ["b4-2", "question"]);
  assert.deepEqual(ids(r.candidates), ["b4-2", "b4-1", "b4-3"]);
  assert.equal(resolveRegion({ region: " ", question: "A dry spring in 2021" }, lookup).problem, "no-place");
});

/* ------------------------------------------------------------------ answer */

const layer = (id: string, category: CategoryId, temporalResolution: "monthly" | "annual" = "monthly"): LayerInfo =>
  ({ id, name: id, category, product: id.toUpperCase(), nasa: true, family: null, unit: "mm", temporalResolution, start: "2000-01", end: "2023-12", caveat: null });
const vc: VariableCatalog = {
  defaults: { precip: "p", soil: "sm", tair: "t", so2: "so2_emis" },
  layers: { p: layer("p", "precip"), sm: layer("sm", "soil"), t: layer("t", "tair"), so2_emis: layer("so2_emis", "so2", "annual") },
  order: ["p", "sm", "t", "so2_emis"],
};

/** 24 years of a seasonal cycle with small deterministic noise; `dip` is added to the months of Feb–May 2021 */
function series(dip: number, end = 288, seed = 12345): MonthlySeries {
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  const values = Array.from({ length: end }, (_, i) => {
    const noise = rand() * 4;
    const event = i >= 253 && i <= 256 ? dip : 0; // 2000-01 + 253 months = 2021-02
    return 50 + 20 * Math.sin((2 * Math.PI * (i % 12)) / 12) + 0.01 * i + noise + event;
  });
  return { layer: "x", start: "2000-01", values, unit: "mm" };
}

const votes = (...on: CategoryId[]): SelectResponse => ({
  votes: CATEGORY_ORDER.map((category) => ({ category, p: on.includes(category) ? 0.9 : 0.1, selected: on.includes(category) })),
  suggestedTime: null, source: "local-model",
});

function deps(over: Partial<BatchDeps> = {}): BatchDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked, vc,
    layersOf: () => new Set(["p", "sm", "so2_emis"]),
    loadSeries: async (_region, l) => (l === "p" ? series(-25) : series(0, 288, 777)),
    suggest: async (event) => { asked.push(event); return votes("precip", "soil", "tair"); },
    ...over,
  };
}
const job: BatchJob = { question: "2021 Taiwan spring drought", time: { start: "2021-02", end: "2021-05" }, region: "b4-4", categories: ["precip", "soil"], padMonths: 12 };
const live = () => new AbortController().signal;

test("answer: the CSV's variables are analysed for the event period, without asking the suggester", async () => {
  const d = deps();
  const a = await answerQuestion(job, d, live());
  assert.deepEqual(d.asked, []);
  assert.equal(a.chosenBy, "csv");
  assert.deepEqual(a.variables.map((v) => [v.category, v.layer, v.status]), [["precip", "p", "ok"], ["soil", "sm", "ok"]]);
  const [precip, soil] = a.variables;
  assert.equal(precip.detail?.verdict, "significant");
  assert.equal(precip.detail?.direction, "low");
  assert.ok((precip.detail?.meanZ ?? 0) < -3);
  assert.deepEqual(precip.detail?.range, job.time);
  assert.notEqual(soil.detail?.verdict, "significant");
  assert.deepEqual(unusualVariables(a).map((v) => v.category), ["precip"]);
});

test("answer: without variables the suggester chooses; what the sub-basin lacks is left out and reported", async () => {
  const d = deps();
  const a = await answerQuestion({ ...job, categories: null }, d, live());
  assert.deepEqual(d.asked, ["2021 Taiwan spring drought"]);
  assert.equal(a.chosenBy, "local-model");
  assert.deepEqual(a.variables.map((v) => v.category), ["precip", "soil"]);
  assert.deepEqual(a.dropped, ["tair"]);
});

test("answer: a variable the CSV names is never dropped: no data, annual only, outside the record and failures are stated", async () => {
  const a = await answerQuestion({ ...job, categories: ["precip", "soil", "tair", "so2"] }, deps({
    loadSeries: async (_region, l) => { if (l === "sm") throw new Error("Could not load the monthly series"); return series(0, 120); }, // 2000–2009
  }), live());
  assert.deepEqual(a.variables.map((v) => [v.category, v.status]), [["precip", "outside"], ["soil", "error"], ["tair", "no-data"], ["so2", "no-data"]]);
  assert.equal(a.variables[1].message, "Could not load the monthly series");
  assert.match(a.variables[3].message ?? "", /Annual/);
  assert.ok(a.variables.every((v) => v.detail === null));
});

test("answer: an aborted run rejects instead of returning half an answer", async () => {
  const ctl = new AbortController();
  const p = answerQuestion({ ...job, categories: null }, deps({ suggest: async () => { ctl.abort(); return votes("precip"); } }), ctl.signal);
  await assert.rejects(p);
});

test("job key: the same question asked the same way has the same key", () => {
  assert.equal(jobKey(job), jobKey({ ...job, categories: ["precip", "soil"] }));
  assert.notEqual(jobKey(job), jobKey({ ...job, categories: null }));
  assert.notEqual(jobKey(job), jobKey({ ...job, padMonths: 24 }));
  assert.notEqual(jobKey(job), jobKey({ ...job, region: "b4-5" }));
});
