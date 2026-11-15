import { dailyDates, type DailyLayerId, type DailyRequest, type DailySeries } from "../daily";
import { parseGldasAscii } from "./ascii";
import { basinGrid, regionalMean, type BasinGrid } from "./grid";
import { nasaText, NasaMissingGranule } from "./nasa-http";
import { mapSamples, nasaSlot } from "./pool";
import type { BasinGeometry } from "./regions";

export interface GldasLayer {
  bands: readonly string[]; unit: string; timing: "point" | "preceding";
  temporal: "mean" | "sum"; scale: number; offset: number;
}
export const GLDAS_LAYERS: Record<Exclude<DailyLayerId, "p_imerg">, GldasLayer> = {
  et_gldas: { bands: ["Evap_tavg"], unit: "mm/day", timing: "preceding", temporal: "mean", scale: 86400, offset: 0 },
  sm_root: { bands: ["RootMoist_inst"], unit: "mm", timing: "point", temporal: "mean", scale: 1, offset: 0 },
  sm_total: { bands: ["SoilMoi0_10cm_inst", "SoilMoi10_40cm_inst", "SoilMoi40_100cm_inst", "SoilMoi100_200cm_inst"], unit: "mm", timing: "point", temporal: "mean", scale: 1, offset: 0 },
  runoff: { bands: ["Qs_acc", "Qsb_acc"], unit: "mm/day", timing: "preceding", temporal: "sum", scale: 1, offset: 0 },
  swe: { bands: ["SWE_inst"], unit: "mm", timing: "point", temporal: "mean", scale: 1, offset: 0 },
  tair: { bands: ["Tair_f_inst"], unit: "°C", timing: "point", temporal: "mean", scale: 1, offset: -273.15 },
  rn: { bands: ["Swnet_tavg", "Lwnet_tavg"], unit: "W/m²", timing: "preceding", temporal: "mean", scale: 1, offset: 0 },
  swdown: { bands: ["SWdown_f_tavg"], unit: "W/m²", timing: "preceding", temporal: "mean", scale: 1, offset: 0 },
  wind: { bands: ["Wind_f_inst"], unit: "m/s", timing: "point", temporal: "mean", scale: 1, offset: 0 },
};
const COLLECTION = "C1342986035-GES_DISC";
const MINUTE = 60_000;
const TIME_EPOCH = Date.parse("2000-01-01T03:00:00Z");

export function gldasTimes(date: string, layer: GldasLayer): number[] {
  const start = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: 8 }, (_, i) => start + (i + (layer.timing === "preceding" ? 1 : 0)) * 3 * 60 * MINUTE);
}

export function aggregateGldas(samples: (Map<string, (number | null)[]> | null)[], layer: GldasLayer, grid: BasinGrid): number | null {
  if (samples.length !== 8 || samples.some((sample) => sample === null)) return null;
  const values = grid.weights.map((_weight, cell) => {
    let sum = 0;
    for (const sample of samples) for (const band of layer.bands) {
      const value = sample?.get(band)?.[cell];
      if (value === undefined || value === null || !Number.isFinite(value)) return null;
      sum += value;
    }
    return sum / (layer.temporal === "mean" ? 8 : 1) * layer.scale + layer.offset;
  });
  return regionalMean(values, grid);
}

export function gldasUrl(timestamp: number, layer: GldasLayer, grid: BasinGrid): URL {
  const iso = new Date(timestamp).toISOString();
  const granule = `GLDAS_NOAH025_3H.2.1:GLDAS_NOAH025_3H.A${iso.slice(0, 10).replaceAll("-", "")}.${iso.slice(11, 13)}00.021.nc4`;
  const subset = `[0:1:0][${grid.row0}:1:${grid.row1}][${grid.col0}:1:${grid.col1}]`;
  const ce = [...layer.bands.map((band) => `${band}${subset}`), `lat[${grid.row0}:1:${grid.row1}]`, `lon[${grid.col0}:1:${grid.col1}]`, "time"].join(",");
  return new URL(`https://opendap.earthdata.nasa.gov/collections/${COLLECTION}/granules/${encodeURIComponent(granule)}.ascii?${encodeURI(ce)}`);
}

export async function gldasSeries(request: DailyRequest & { layer: Exclude<DailyLayerId, "p_imerg"> }, geometry: BasinGeometry, token: string, signal: AbortSignal): Promise<DailySeries> {
  const layer = GLDAS_LAYERS[request.layer];
  const grid = basinGrid(geometry);
  const dates = dailyDates(request), values: (number | null)[] = [];
  for (const day of dates) {
    signal.throwIfAborted();
    if (!grid || day < "2000-01-01") { values.push(null); continue; }
    const samples = await mapSamples(gldasTimes(day, layer), signal, (stamp, abort) => nasaSlot(abort, async () => {
      try {
        return parseGldasAscii(await nasaText(gldasUrl(stamp, layer, grid), token, abort), layer.bands, grid, (stamp - TIME_EPOCH) / MINUTE);
      } catch (error) {
        if (error instanceof NasaMissingGranule) return null;
        throw error;
      }
    }));
    values.push(aggregateGldas(samples, layer, grid));
  }
  const timing = layer.timing === "preceding" ? "03:00–next 00:00 UTC (each preceding 3 h)" : "00:00–21:00 UTC (instantaneous samples)";
  return {
    ...request, resolution: "daily", dates, values, unit: layer.unit,
    source: {
      provider: "earthdata", dataset: "GLDAS_NOAH025_3H 2.1", url: "https://disc.gsfc.nasa.gov/datasets/GLDAS_NOAH025_3H_2.1/summary",
      aggregation: `${layer.bands.join(" + ")}; ${layer.temporal} of 8 complete samples/pixel, ${timing}; ×${layer.scale}${layer.offset ? ` ${layer.offset}` : ""}.`,
      spatialMethod: "Native 0.25° cell centers inside basin polygon; cos(latitude) area weights; ≥30% complete-day valid area; no subpixel fallback. Differs from monthly 0.5° raster mask.",
    },
    retrievedAt: new Date().toISOString(),
  };
}
