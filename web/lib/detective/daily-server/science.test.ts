import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGldasAscii } from "./ascii";
import { aggregateGldas, GLDAS_LAYERS, gldasTimes, gldasUrl } from "./gldas";
import { basinGrid, regionalMean, type BasinGrid } from "./grid";
import { parseImergCsv, parseImergGranules } from "./imerg";

const grid: BasinGrid = { row0: 332, row1: 333, col0: 1204, col1: 1205,
  lat: [23.125, 23.375], lon: [121.125, 121.375], weights: [1, 1, 1, 1], totalWeight: 4 };
const sample = `Dataset: GLDAS_NOAH025_3H.A20200101.0300.021.nc4
lon, 121.125, 121.375
time, 10519200
lat, 23.125, 23.375
Evap_tavg.lon, 121.125, 121.375
Evap_tavg.Evap_tavg[Evap_tavg.time=10519200][Evap_tavg.lat=23.125], 4.1463e-05, -1.5037e-05
Evap_tavg.Evap_tavg[Evap_tavg.time=10519200][Evap_tavg.lat=23.375], -9999, 0`;

test("GLDAS ASCII keeps zero, negative evaporation and fill gaps distinct", () => {
  assert.deepEqual(parseGldasAscii(sample, ["Evap_tavg"], grid, 10519200).get("Evap_tavg"), [4.1463e-5, -1.5037e-5, null, 0]);
});

test("GLDAS ASCII rejects truncated rows, wrong grids/timestamps, malformed numbers and HTML", () => {
  for (const text of [sample.replace(", -9999, 0", ", -9999"), sample.replace("lat, 23.125", "lat, 22.125"),
    sample.replace("[Evap_tavg.lat=23.375]", "[Evap_tavg.lat=NaN]"), sample.replace("time, 10519200", "time, 10519201"),
    sample.replace(", -9999, 0", ", NaN, 0"), "<html>Login</html>"]) {
    assert.throws(() => parseGldasAscii(text, ["Evap_tavg"], grid, 10519200));
  }
});

test("GLDAS UTC flux intervals use 03:00 through the following midnight; state samples use 00:00 through 21:00", () => {
  assert.deepEqual(gldasTimes("2020-02-29", GLDAS_LAYERS.et_gldas).map((t) => new Date(t).toISOString()),
    ["03", "06", "09", "12", "15", "18", "21"].map((hour) => `2020-02-29T${hour}:00:00.000Z`).concat("2020-03-01T00:00:00.000Z"));
  const times = gldasTimes("2020-02-29", GLDAS_LAYERS.sm_root);
  assert.equal(new Date(times[0]).toISOString(), "2020-02-29T00:00:00.000Z");
  assert.equal(new Date(times[7]).toISOString(), "2020-02-29T21:00:00.000Z");
});

test("NASA Hyrax constraint expressions encode brackets that its HTTP server rejects raw", () => {
  const url = gldasUrl(Date.parse("2021-01-01T03:00:00Z"), GLDAS_LAYERS.et_gldas, grid);
  assert.ok(!url.search.includes("["));
  assert.ok(url.search.includes("%5B"));
  assert.ok(decodeURI(url.search).includes("Evap_tavg[0:1:0][332:1:333][1204:1:1205]"));
});

function constantSamples(bands: Record<string, number | null>) {
  return Array.from({ length: 8 }, () => new Map(Object.entries(bands).map(([key, value]) => [key, [value, value, value, value]])));
}

test("daily GLDAS conversions use rate integration, accumulation sum, native state means, and all component bands", () => {
  const calculate = (layer: keyof typeof GLDAS_LAYERS, bands: Record<string, number | null>) => aggregateGldas(constantSamples(bands), GLDAS_LAYERS[layer], grid);
  assert.ok(Math.abs(calculate("et_gldas", { Evap_tavg: 1 / 86400 })! - 1) < 1e-12);
  assert.equal(calculate("runoff", { Qs_acc: 1, Qsb_acc: 2 }), 24);
  assert.ok(Math.abs(calculate("tair", { Tair_f_inst: 300 })! - 26.85) < 1e-12);
  assert.equal(calculate("sm_root", { RootMoist_inst: 350 }), 350);
  assert.equal(calculate("sm_total", { SoilMoi0_10cm_inst: 10, SoilMoi10_40cm_inst: 30, SoilMoi40_100cm_inst: 60, SoilMoi100_200cm_inst: 100 }), 200);
  assert.equal(calculate("rn", { Swnet_tavg: 100, Lwnet_tavg: -30 }), 70);
  assert.equal(calculate("swe", { SWE_inst: 0 }), 0);
});

test("missing a temporal sample or component never becomes a lower daily total or false zero", () => {
  const samples = constantSamples({ Qs_acc: 1, Qsb_acc: 2 });
  assert.equal(aggregateGldas(samples.slice(1), GLDAS_LAYERS.runoff, grid), null);
  samples[3].set("Qsb_acc", [null, null, null, null]);
  assert.equal(aggregateGldas(samples, GLDAS_LAYERS.runoff, grid), null);
  assert.equal(aggregateGldas(constantSamples({ SWE_inst: null }), GLDAS_LAYERS.swe, grid), null);
});

test("region mean uses area weights and rejects below 30% valid area", () => {
  const weighted = { ...grid, weights: [1, 0.5, 0, 0], totalWeight: 1.5 };
  assert.equal(regionalMean([10, 40, 999, 999], weighted), 20);
  assert.equal(regionalMean([null, 0, null, null], weighted), 0);
  assert.equal(regionalMean([null, 5, null, null], { ...weighted, weights: [1.3, 0.2, 0, 0] }), null);
  assert.equal(regionalMean([null, 0, null, null], { ...weighted, weights: [1.05, 0.45, 0, 0] }), 0);
  assert.equal(regionalMean([null, null, null, null], weighted), null);
});

test("native center-in-polygon membership respects holes without filling a basin smaller than a cell", () => {
  const spec = { lat0: 0, lon0: 0, step: 1, rows: 5, cols: 5 };
  const basin = basinGrid({ type: "Polygon", coordinates: [
    [[-0.4, -0.4], [3.4, -0.4], [3.4, 3.4], [-0.4, 3.4], [-0.4, -0.4]],
    [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]],
  ] }, spec)!;
  assert.equal(basin.weights.filter((weight) => weight > 0).length, 15);
  assert.equal(basin.weights[5], 0);
  assert.ok(basin.weights[12] < basin.weights[0]);
  assert.equal(basinGrid({ type: "Polygon", coordinates: [[[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.1]]] }, spec), null);
});

const imergGrid: BasinGrid = { ...grid, lat: [23.05, 23.15], lon: [121.05, 121.15] };
const imergSample = `Dataset: 3B-DAY.MS.MRG.3IMERG.20210101-S000000-E235959.V07B.nc4
/lat, 23.05, 23.15
/lon, 121.05, 121.15
/time, 14971
/precipitation[0][0], 0, 2
/precipitation[0][1], 3, -9999.900391
/precipitation_cnt[0][0], 48, 48
/precipitation_cnt[0][1], 48, 0`;
test("IMERG transposes lon/lat into the basin grid, retains its daily units and preserves zero/missing", () => {
  assert.deepEqual(parseImergCsv(imergSample, imergGrid, "2021-01-01"), [0, 3, 2, null]);
  assert.throws(() => parseImergCsv(imergSample.replace("121.15", "NaN"), imergGrid, "2021-01-01"));
  assert.throws(() => parseImergCsv(imergSample.replace("14971", "14972"), imergGrid, "2021-01-01"));
  assert.throws(() => parseImergCsv(imergSample.replace("/precipitation[0][1]", "/precipitation[0][2]"), imergGrid, "2021-01-01"));
  assert.throws(() => parseImergCsv(imergSample.replace(", 3, -9999.900391", ", 3"), imergGrid, "2021-01-01"));
});

test("IMERG rejects partial days before computing valid area and never converts them into dry days", () => {
  const partial = imergSample.replace("_cnt[0][0], 48, 48", "_cnt[0][0], 47, 48");
  assert.deepEqual(parseImergCsv(partial, imergGrid, "2021-01-01"), [null, 3, 2, null]);
  const allPartial = partial.replace("_cnt[0][0], 47, 48", "_cnt[0][0], 47, 47").replace("_cnt[0][1], 48, 0", "_cnt[0][1], 47, 0");
  assert.equal(regionalMean(parseImergCsv(allPartial, imergGrid, "2021-01-01"), imergGrid), null);
  assert.throws(() => parseImergCsv(imergSample.split("/precipitation_cnt")[0], imergGrid, "2021-01-01"));
  assert.throws(() => parseImergCsv(imergSample.replace("_cnt[0][0], 48, 48", "_cnt[0][0], 49, 48"), imergGrid, "2021-01-01"));
});

test("IMERG discovers exact Final Run V07 revisions without replacing them with another product", () => {
  const item = { meta: { "collection-concept-id": "C2723754864-GES_DISC" }, umm: { GranuleUR: "GPM_3IMERGDF.07:3B-DAY.MS.MRG.3IMERG.20210101-S000000-E235959.V07A.nc4" } };
  assert.ok(parseImergGranules(JSON.stringify({ items: [item] }), ["2021-01-01"]).get("2021-01-01")?.endsWith("V07A.nc4"));
  assert.equal(parseImergGranules('{"items":[]}', ["2021-01-01"]).size, 0);
  assert.throws(() => parseImergGranules(JSON.stringify({ items: [item, item] }), ["2021-01-01"]));
  assert.throws(() => parseImergGranules(JSON.stringify({ items: [{ ...item, meta: { "collection-concept-id": "wrong" } }] }), ["2021-01-01"]));
});
