// Server-side reader for the data catalogue shown on /data. Reads web/public/data/catalog/variables.json and
// web/data.lock.json at build (or request) time; both are installed by `npm run setup`, so either may be absent
// in a fresh clone and the page then says so instead of failing.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CATEGORY_ORDER } from "@/lib/detective/categories";
import type { CategoryId } from "@/lib/detective/contracts";
import { withEnglishText } from "@/lib/detective/layerText";

export interface LayerRow {
  id: string;
  category: CategoryId;
  name: string;
  product: string;
  family: string | null;
  nasa: boolean;
  unit: string;
  start: string;
  end: string;
  resolution: "monthly" | "annual";
  caveat: string | null;
  isDefault: boolean;
}

export interface DataLock { repo: string; tag: string; asset: string; sha256: string }

/** English names for the catalogue layers (variables.json names are Chinese). Unlisted ids show the id. */
const LAYER_NAME: Record<string, string> = {
  tws: "Terrestrial water storage anomaly",
  p_imerg: "Precipitation",
  p_gpcp: "Precipitation",
  p_m2: "Precipitation (bias-corrected)",
  p_m2land: "Precipitation over land",
  et_m2: "Evaporation",
  et_m2land: "Evaporation over land",
  et_gldas: "Evapotranspiration",
  sm_root: "Root-zone soil moisture",
  sm_total: "Soil moisture, 0–2 m",
  g1_soil_top: "Top-layer soil moisture, 0–10 cm",
  sm_m2: "Root-zone soil wetness (0–1)",
  runoff: "Runoff",
  ro_m2: "Runoff",
  swe: "Snow water equivalent",
  snow_cover: "Snow-cover fraction",
  tair: "Near-surface air temperature",
  tsurf_m2: "Surface temperature",
  lst_day: "Daytime land-surface temperature",
  lst_night: "Night-time land-surface temperature",
  vpd: "Vapour pressure deficit",
  pet_gldas: "Potential evapotranspiration",
  rn: "Net radiation",
  rn_m2: "Net radiation",
  rn_ceres: "Surface net radiation",
  swdown: "Downward shortwave radiation",
  wind: "Wind speed",
  ndvi: "Vegetation index (NDVI)",
  sst: "Sea surface temperature",
  aod: "Aerosol optical depth (550 nm)",
  to3_m2: "Total-column ozone",
  tqv: "Precipitable water vapour",
  so2_emis: "SO₂ point-source emissions",
  fire_count: "Vegetation-fire detections",
};

/** What kind of product a family is, for the "Type" column. */
export const FAMILY_KIND: Record<string, string> = {
  GLDAS: "Land-surface model",
  "MERRA-2": "Reanalysis",
  IMERG: "Satellite, gauge-adjusted",
  GPCP: "Satellite and gauges",
  GRACE: "Satellite gravimetry",
  MODIS: "Satellite",
  CERES: "Satellite and radiative model",
  FIRMS: "Satellite detections",
  MSAQSO2L4: "Satellite-derived catalogue",
  OISST: "Satellite and in situ",
};

const DATA = path.join(process.cwd(), "public", "data");

type RawLayer = {
  name?: string; category?: string; product?: string; nasa?: boolean; family?: string | null; unit?: string;
  start?: string; end?: string; caveat?: string | null; temporal_resolution?: "monthly" | "annual";
};

/** Layers grouped in category order (default layer first), or null when the catalogue is not installed. */
export async function readLayerRows(): Promise<LayerRow[] | null> {
  let raw: { category_default_layer?: Record<string, string>; layers?: Record<string, RawLayer> };
  try {
    raw = JSON.parse(await readFile(path.join(DATA, "catalog", "variables.json"), "utf8"));
  } catch {
    return null;
  }
  const defaults = raw.category_default_layer ?? {};
  const rows: LayerRow[] = [];
  for (const [id, l] of Object.entries(raw.layers ?? {})) {
    const category = l.category as CategoryId;
    if (!CATEGORY_ORDER.includes(category)) continue;
    const text = withEnglishText({ id, product: l.product ?? id, caveat: l.caveat ?? null });
    rows.push({
      id,
      category,
      name: LAYER_NAME[id] ?? id,
      product: text.product,
      family: l.family ?? null,
      nasa: l.nasa !== false,
      unit: l.unit ?? "",
      start: l.start ?? "",
      end: l.end ?? "",
      // the original SO₂ bundle omitted this field although its yearly totals repeat in every month (as lib/detective/series.ts)
      resolution: id === "so2_emis" ? "annual" : l.temporal_resolution ?? "monthly",
      caveat: text.caveat || null,
      isDefault: defaults[category] === id,
    });
  }
  const order = (r: LayerRow) => CATEGORY_ORDER.indexOf(r.category) * 2 + (r.isDefault ? 0 : 1);
  return rows.map((r, i) => [r, i] as const).sort((a, b) => order(a[0]) - order(b[0]) || a[1] - b[1]).map(([r]) => r);
}

export async function readDataLock(): Promise<DataLock | null> {
  try {
    const j = JSON.parse(await readFile(path.join(process.cwd(), "data.lock.json"), "utf8"));
    return typeof j.tag === "string" && typeof j.sha256 === "string" ? j : null;
  } catch {
    return null;
  }
}
