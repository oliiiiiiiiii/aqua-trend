// Shared domain types. Owned by the PM - do not edit without flagging it in your hand-off.

export type VarId =
  | "precip" | "et" | "p_minus_et" | "runoff"
  | "soil_top" | "root_zone" | "tws" | "swe" | "tair";

/** Region layers that have a 0.25° id raster (pickable on the globe). */
export type LayerId = "basin3" | "basin4" | "hex" | "lme" | "sea" | "ice";
export type RegionType = LayerId | "named";

export interface Region {
  id: string;
  type: RegionType;
  /** English display name built by scripts/prep-data.mjs */
  name: string;
  /** Dominant surface label from the catalogue; mixed regions exist (see landFrac). */
  surface: "land" | "ocean" | "ice";
  areaKm2: number;
  /** [lon, lat] in degrees */
  centroid: [number, number];
  /** [west, south, east, north] */
  bbox?: [number, number, number, number];
  iso?: string[];
  parent?: string;
  pfaf?: number;
  /** 1-based id of this region inside its layer raster (absent for "named" and for regions smaller than a pixel) */
  gridIndex?: number;
  /** land + ice share of the geometry, 0-1 */
  landFrac?: number;
  /** area shares of the geometry from the catalogue's 0.5° check (README section 15): land (basin3), ocean, ice (Antarctic ice sheets + Greenland basins). Sum ≈ 1. */
  surfaceFrac?: { land: number; ocean: number; ice: number };
  /** share of GLDAS precipitation falling as snow, 0-1 (absent for most ocean regions) */
  snowFrac?: number;
  /** share of the region's boundary where land meets sea (0.25° raster edges): 0 inland, ~1 an island. Absent for sub-pixel regions. */
  coastShare?: number;
  /** number of 1° GLDAS cells that contribute to the regional series; undefined = no GLDAS data here */
  cells?: number;
  /** the same expressed as full-cell equivalents inside the boundary */
  cellEquiv?: number;
  /** true when the region is smaller than the raster and the containing 1° cell is used instead */
  fallback?: boolean;
}

export interface Catalog {
  dataset: string;
  grid: string;
  /** "YYYY-MM", 2000-01 … 2026-07 */
  months: string[];
  vars: VarId[];
  raster: { w: number; h: number; px: number; layers: LayerId[] };
  regions: Region[];
  byId: Map<string, Region>;
  /** byGrid[layer][gridIndex] -> Region */
  byGrid: Record<LayerId, (Region | undefined)[]>;
}

/** Area-weighted monthly means of the 1° GLDAS cells inside a region. NaN = missing month. */
export interface RegionSeries {
  regionId: string;
  months: string[];
  values: Record<VarId, Float32Array>;
}

export interface TrendGrid {
  /** 360 x 180, row 0 = 89.5°N, col 0 = 179.5°W; NaN outside the GLDAS land domain */
  sen: Float32Array;
  p: Float32Array;
}
