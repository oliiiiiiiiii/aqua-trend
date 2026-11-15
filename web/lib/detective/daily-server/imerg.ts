import { dailyDates, type DailyRequest, type DailySeries } from "../daily";
import { basinGrid, regionalMean, type BasinGrid, type GridSpec } from "./grid";
import { nasaText } from "./nasa-http";
import { mapSamples, nasaSlot } from "./pool";
import type { BasinGeometry } from "./regions";

const COLLECTION = "C2723754864-GES_DISC";
const IMERG_GRID: GridSpec = { lat0: -89.95, lon0: -179.95, step: 0.1, rows: 1800, cols: 3600 };
const TIME_EPOCH = Date.parse("1980-01-06T00:00:00Z");

export function parseImergGranules(text: string, dates: string[]): Map<string, string> {
  const json = JSON.parse(text) as { items?: { meta?: { "collection-concept-id"?: string }; umm?: { GranuleUR?: string } }[] };
  if (!Array.isArray(json?.items)) throw new Error("invalid CMR result");
  const granules = new Map<string, string>();
  for (const item of json.items) {
    const ur = item?.umm?.GranuleUR;
    const match = typeof ur === "string" && /^GPM_3IMERGDF\.07:3B-DAY\.MS\.MRG\.3IMERG\.(\d{4})(\d{2})(\d{2})-S000000-E235959\.V07[A-Z]\.nc4$/.exec(ur);
    if (item?.meta?.["collection-concept-id"] !== COLLECTION || !match) throw new Error("unexpected IMERG product");
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    if (!dates.includes(date)) continue;
    if (granules.has(date)) throw new Error("ambiguous IMERG granule version");
    granules.set(date, ur!);
  }
  return granules;
}

export function parseImergCsv(text: string, grid: BasinGrid, date: string): (number | null)[] {
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith(`Dataset: 3B-DAY.MS.MRG.3IMERG.${date.replaceAll("-", "")}-S000000-E235959.V07`)) {
    throw new Error("unexpected IMERG CSV dataset");
  }
  const expectedTime = (Date.parse(`${date}T00:00:00Z`) - TIME_EPOCH) / 86_400_000;
  for (const [axis, expected] of [["lat", grid.lat], ["lon", grid.lon], ["time", [expectedTime]]] as const) {
    const actual = lines.find((line) => line.startsWith(`/${axis},`))?.split(",").slice(1).map(Number);
    if (!actual || actual.length !== expected.length || actual.some((value, i) => !Number.isFinite(value) || Math.abs(value - expected[i]) > 1e-5)) {
      throw new Error("unexpected IMERG CSV coordinates");
    }
  }
  const values = parseImergBand(lines, grid, "precipitation");
  const counts = parseImergBand(lines, grid, "precipitation_cnt");
  return values.map((value, index) => {
    const count = counts[index];
    if (count !== null && (!Number.isInteger(count) || count > 48)) throw new Error("invalid IMERG sample count");
    return count === 48 ? value : null;
  });
}

function parseImergBand(lines: string[], grid: BasinGrid, band: string): (number | null)[] {
  const rows = lines.filter((line) => line.startsWith(`/${band}[`));
  if (rows.length !== grid.lon.length) throw new Error("incomplete IMERG longitude rows");
  const values: (number | null)[] = new Array(grid.weights.length);
  rows.forEach((line, col) => {
    const match = new RegExp(`^/${band}\\[0\\]\\[${col}\\],(.*)$`).exec(line);
    if (!match) throw new Error("unexpected IMERG CSV array indices");
    const fields = match[1].split(",").map((part) => part.trim());
    if (fields.length !== grid.lat.length || fields.some((value) => !value || !Number.isFinite(Number(value)))) throw new Error("invalid IMERG CSV values");
    fields.forEach((field, row) => {
      const value = Number(field);
      values[row * grid.lon.length + col] = value < 0 ? null : value;
    });
  });
  return values;
}

export async function imergSeries(request: DailyRequest, geometry: BasinGeometry, token: string, signal: AbortSignal): Promise<DailySeries> {
  const dates = dailyDates(request), grid = basinGrid(geometry, IMERG_GRID);
  let values: (number | null)[] = dates.map(() => null);
  if (grid) {
    const cmr = new URL("https://cmr.earthdata.nasa.gov/search/granules.umm_json");
    cmr.search = new URLSearchParams({ collection_concept_id: COLLECTION,
      temporal: `${request.start}T00:00:00Z,${request.end}T23:59:59Z`, page_size: "100", sort_key: "start_date" }).toString();
    const granules = parseImergGranules(await nasaSlot(signal, () => nasaText(cmr, null, signal, 2 * 1024 * 1024)), dates);
    values = await mapSamples(dates, signal, (date, abort) => nasaSlot(abort, async () => {
      const granule = granules.get(date);
      if (!granule) return null;
      const subset = `[0:1:0][${grid.col0}:1:${grid.col1}][${grid.row0}:1:${grid.row1}]`;
      const ce = [...["precipitation", "precipitation_cnt"].map((band) => `${band}${subset}`),
        `lat[${grid.row0}:1:${grid.row1}]`, `lon[${grid.col0}:1:${grid.col1}]`, "time"].join(";");
      // The Int8 count requires DAP4; DAP2 .ascii rejects that variable.
      const url = new URL(`https://opendap.earthdata.nasa.gov/collections/${COLLECTION}/granules/${encodeURIComponent(granule)}.dap.csv`);
      url.search = new URLSearchParams({ "dap4.ce": ce }).toString();
      return regionalMean(parseImergCsv(await nasaText(url, token, abort), grid, date), grid);
    }));
  }
  return { ...request, resolution: "daily", dates, values, unit: "mm/day", source: {
    provider: "earthdata", dataset: "GPM_3IMERGDF 07 (Final Run daily)",
    url: "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDF_07/summary",
    aggregation: "NASA Final Run daily precipitation, 00:00–23:59:59 UTC; require precipitation_cnt = 48 valid half-hours/pixel before spatial averaging; native mm/day, no rate conversion. Exact V07 revision discovered through CMR; no Early/Late substitution.",
    spatialMethod: "Native 0.1° cell centers inside basin polygon; cos(latitude) area weights; ≥30% valid area; no subpixel fallback. Differs from monthly 0.5° raster mask.",
  }, retrievedAt: new Date().toISOString() };
}
