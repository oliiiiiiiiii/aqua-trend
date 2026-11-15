// Browser-side loaders for the Trend Detective (workstream C).
// Reads the series-2 bundle that `npm run setup` unpacks into web/public/data (never the team data share):
//   catalog/variables.json     layer metadata (unit, product, caveat) and category_default_layer
//   catalog/series_index.json  which layers each region has a series for
//   series/<region id>.json    {"id", "version": "series-2", "layers": {"<layer>": {"start": "YYYY-MM", "values": [...]}}}
// Missing values stay null: never NaN, never 0.
//
// Region ids: the globe and the search read public/data/gen/catalog.json (built by `npm run prep` from
// catalog/regions.json), the series read series/<id>.json. Both use the regions.json ids, so a basin4 id from the globe
// ("b4-4040046370") is also the series file name. `seriesRegionId` is the one place to map them if that ever changes.
import type { CategoryId, LayerId, MonthlySeries, RegionId, YearMonth } from "./contracts";
import { CATEGORY_IDS, isCategory, isYearMonth } from "./url";
import { withEnglishText } from "./layerText";

const BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data`;

const cache = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make().catch((e) => { cache.delete(key); throw e; });
    cache.set(key, p);
  }
  return p;
}
async function json<T>(path: string, what: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`Could not load ${what} (${res.status}). Run "npm run setup" in web/.`);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ variables.json */

export interface LayerInfo {
  id: LayerId;
  /** short name from the catalogue (Chinese in data-v0) */
  name: string;
  category: CategoryId;
  product: string;
  /** false for non-NASA products (GPCP, OISST): the UI names the agency */
  nasa: boolean;
  family: string | null;
  unit: string;
  temporalResolution: "monthly" | "annual";
  start: YearMonth;
  end: YearMonth;
  /** must be shown whenever it is not null (SPEC §4) */
  caveat: string | null;
}

export interface VariableCatalog {
  /** the default layer of each category (category_default_layer) */
  defaults: Partial<Record<CategoryId, LayerId>>;
  layers: Record<LayerId, LayerInfo>;
  /** layer ids in catalogue order */
  order: LayerId[];
}

interface RawLayer {
  name?: string; category?: string; product?: string; nasa?: boolean; family?: string | null;
  unit?: string; start?: string; end?: string; caveat?: string | null;
  temporal_resolution?: "monthly" | "annual";
}

export function loadVariableCatalog(): Promise<VariableCatalog> {
  return once("variables", async () => {
    const raw = await json<{ category_default_layer?: Record<string, string>; layers?: Record<string, RawLayer> }>(
      "catalog/variables.json",
      "the variable catalogue",
    );
    const layers: Record<LayerId, LayerInfo> = {};
    const order: LayerId[] = [];
    for (const [id, l] of Object.entries(raw.layers ?? {})) {
      if (!l.category || !isCategory(l.category) || !l.start || !isYearMonth(l.start) || !l.end || !isYearMonth(l.end)) continue;
      layers[id] = withEnglishText({
        id,
        name: l.name ?? id,
        category: l.category,
        product: l.product ?? id,
        nasa: l.nasa !== false,
        family: l.family ?? null,
        unit: l.unit ?? "",
        // F's original SO₂ bundle omitted this field although its yearly totals repeat in every month.
        temporalResolution: id === "so2_emis" ? "annual" : l.temporal_resolution ?? "monthly",
        start: l.start,
        end: l.end,
        caveat: l.caveat ? l.caveat : null,
      });
      order.push(id);
    }
    const defaults: Partial<Record<CategoryId, LayerId>> = {};
    for (const [c, l] of Object.entries(raw.category_default_layer ?? {})) {
      if (isCategory(c) && layers[l]?.category === c) defaults[c] = l;
    }
    return { defaults, layers, order };
  });
}

/** every layer of a category: the default first, then the others in catalogue order */
export function categoryLayers(vc: VariableCatalog, category: CategoryId): LayerId[] {
  const d = vc.defaults[category];
  const rest = vc.order.filter((l) => vc.layers[l].category === category && l !== d);
  return d ? [d, ...rest] : rest;
}

/**
 * The layer to analyse for a category in a region: the requested one if the region has it, else the default,
 * else the first other layer of the category the region has. null = no series of this category here.
 */
export function resolveLayer(
  vc: VariableCatalog,
  category: CategoryId,
  available: ReadonlySet<LayerId>,
  requested?: LayerId,
): LayerId | null {
  if (requested && vc.layers[requested]?.category === category && vc.layers[requested].temporalResolution === "monthly" && available.has(requested)) return requested;
  return categoryLayers(vc, category).find((l) => available.has(l) && vc.layers[l].temporalResolution === "monthly") ?? null;
}

/* ------------------------------------------------------------------ series_index.json */

/** region id -> layers with a series. Regions without any series are absent (e.g. hex cells). */
export function loadSeriesIndex(): Promise<Map<RegionId, ReadonlySet<LayerId>>> {
  return once("series-index", async () => {
    const raw = await json<{ regions?: Record<string, string[]> }>("catalog/series_index.json", "the series index");
    return new Map(Object.entries(raw.regions ?? {}).map(([id, layers]) => [id, new Set(layers)]));
  });
}

/** the globe / search id of a sub-basin -> the id of its series file (identical in data-v0; see the header) */
export const seriesRegionId = (region: RegionId): RegionId => region;

const NONE: ReadonlySet<LayerId> = new Set();

/** layers that have a series for this region (empty set when it has none) */
export async function regionLayers(region: RegionId): Promise<ReadonlySet<LayerId>> {
  return (await loadSeriesIndex()).get(seriesRegionId(region)) ?? NONE;
}

export interface CategoryAvailability {
  /** the layer each category would use; null = the region has no series of that category */
  layer: Record<CategoryId, LayerId | null>;
  /** every layer of each category that the region has, default first */
  choices: Record<CategoryId, LayerId[]>;
  /** Explanation when a region has this category only at an unsupported time resolution. */
  unavailableReason: Partial<Record<CategoryId, string>>;
}

const ANNUAL_ONLY = "Annual data only; monthly analysis is unavailable.";

export function categoryAvailability(
  vc: VariableCatalog,
  available: ReadonlySet<LayerId>,
  requested: Partial<Record<CategoryId, LayerId>> = {},
): CategoryAvailability {
  const layer = {} as Record<CategoryId, LayerId | null>;
  const choices = {} as Record<CategoryId, LayerId[]>;
  const unavailableReason: Partial<Record<CategoryId, string>> = {};
  for (const c of CATEGORY_IDS) {
    const here = categoryLayers(vc, c).filter((l) => available.has(l));
    choices[c] = here.filter((l) => vc.layers[l].temporalResolution === "monthly");
    layer[c] = resolveLayer(vc, c, available, requested[c]);
    if (!choices[c].length && here.some((l) => vc.layers[l].temporalResolution === "annual")) unavailableReason[c] = ANNUAL_ONLY;
  }
  return { layer, choices, unavailableReason };
}

/** ISO code -> Chinese country name (catalog/countries.json), for reading a place from Chinese event text */
export function loadCountryNames(): Promise<ReadonlyMap<string, string>> {
  return once("countries", async () => {
    const raw = await json<Record<string, { zh?: string }>>("catalog/countries.json", "the country list");
    return new Map(Object.entries(raw).filter(([, v]) => v.zh).map(([iso, v]) => [iso, v.zh as string]));
  });
}

/* ------------------------------------------------------------------ series/<id>.json */

interface RawSeriesFile {
  id?: string;
  version?: string;
  layers?: Record<string, { start?: string; values?: unknown[] }>;
}

function loadSeriesFile(region: RegionId): Promise<RawSeriesFile> {
  const id = seriesRegionId(region);
  return once(`series:${id}`, async () => {
    const raw = await json<RawSeriesFile>(`series/${encodeURIComponent(id)}.json`, `the monthly series of ${id}`);
    if (raw.version !== "series-2") throw new Error(`The series of ${id} has version "${raw.version}", expected "series-2".`);
    return raw;
  });
}

/** One layer's monthly series for a region, unit from variables.json. Rejects when the region has no such layer. */
export async function loadSeries(region: RegionId, layer: LayerId): Promise<MonthlySeries> {
  const [file, vc] = await Promise.all([loadSeriesFile(region), loadVariableCatalog()]);
  if (layer === "so2_emis" || vc.layers[layer]?.temporalResolution === "annual") {
    throw new Error(`${vc.layers[layer]?.product ?? layer}: ${ANNUAL_ONLY}`);
  }
  const s = file.layers?.[layer];
  if (!s || !s.start || !isYearMonth(s.start) || !Array.isArray(s.values)) {
    throw new Error(`${region} has no ${layer} series.`);
  }
  return {
    layer,
    start: s.start,
    values: s.values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)),
    unit: vc.layers[layer]?.unit ?? "",
  };
}
