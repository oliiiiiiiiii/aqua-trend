// Value -> visual mappings for the crystal ball. Pure functions shared by the WebGL scene and the HTML legend,
// so the numbers in the legend always match what is drawn.
import type { OrbClimate } from "@/lib/contracts";
import type { Region, VarId } from "@/lib/types";
import { VARIABLES, formatValue } from "@/lib/variables";
import { seasonOf } from "./season";

/** Each particle stands for the same flux; the rate is per variable so the count stays readable on every shared domain. */
export type ParticleVar = "precip" | "et" | "runoff";
export const PARTICLE_VARS: ParticleVar[] = ["precip", "et", "runoff"];
export const PARTICLE_RATE: Record<ParticleVar, number> = { precip: 0.05, et: 0.05, runoff: 0.2 }; // mm/day per particle (runoff arrows are sparser: 30 at the 6 mm/day top of the domain)
export const PARTICLE_NOUN: Record<ParticleVar, [string, string]> = {
  precip: ["falling streak", "falling streaks"],
  et: ["rising wisp", "rising wisps"],
  runoff: ["runoff arrow", "runoff arrows"],
};
export const MAX_PARTICLES: Record<ParticleVar, number> = {
  precip: Math.round(VARIABLES.precip.domain[1] / PARTICLE_RATE.precip),
  et: Math.round(VARIABLES.et.domain[1] / PARTICLE_RATE.et),
  runoff: Math.round(VARIABLES.runoff.domain[1] / PARTICLE_RATE.runoff),
};
export const isParticleVar = (v: VarId): v is ParticleVar => v === "precip" || v === "et" || v === "runoff";

/** Soil moisture is shown twice, on the same fixed domain: the band's blue saturation and a count of water beads. */
export type SoilVar = "soil_top" | "root_zone";
export const BEAD_STEP: Record<SoilVar, number> = { soil_top: 0.4, root_zone: 4 }; // mm of water per bead
export const MAX_BEADS: Record<SoilVar, number> = {
  soil_top: Math.round(VARIABLES.soil_top.domain[1] / BEAD_STEP.soil_top),
  root_zone: Math.round(VARIABLES.root_zone.domain[1] / BEAD_STEP.root_zone),
};
export const beadCount = (id: SoilVar, drawn: number) => Math.max(0, Math.round(drawn / BEAD_STEP[id]));

/** Channels drawn inside the glass (the rest are gauges beside it). */
export const SCENE_VARS: VarId[] = ["precip", "et", "runoff", "soil_top", "root_zone", "swe"];
export const GAUGE_VARS: VarId[] = ["tws", "p_minus_et"];

/** Snow cap: height and width grow with the square root of SWE, reaching full size at the top of the domain. */
export const snowSize = (drawn: number) => Math.sqrt(Math.min(1, Math.max(0, drawn / VARIABLES.swe.domain[1])));

/** Share of precipitation falling as snow above which snow decoration is allowed on an open-sea scene's islet. */
export const SNOW_ISLET_MIN = 0.25;
/** Snow only sits on land or ice. An open-sea scene gets a snow cap on its islet only when the region's snowFrac is high. */
export const snowCapAllowed = (plan: SceneryPlan, hasIsle: boolean) => plan.kind !== "sea" || (hasIsle && plan.snow >= SNOW_ISLET_MIN);

export interface Reading {
  id: VarId;
  /** raw value, null when missing */
  value: number | null;
  missing: boolean;
  /** value clamped to the shared display domain (0 when missing - never drawn, only used for easing) */
  drawn: number;
  /** position on the shared domain, 0..1 */
  t: number;
  flag: "above" | "below" | null;
}

export function readValue(id: VarId, raw: number | null | undefined): Reading {
  const [lo, hi] = VARIABLES[id].domain;
  if (raw == null || !Number.isFinite(raw)) return { id, value: null, missing: true, drawn: 0, t: 0, flag: null };
  const drawn = Math.min(hi, Math.max(lo, raw));
  // tiny negative fluxes (e.g. dew, -0.004 mm/day) are clamped too, but only flagged when they would show as non-zero
  const eps = Math.pow(10, -VARIABLES[id].decimals) / 2;
  const flag = raw > hi + eps ? "above" : raw < lo - eps ? "below" : null;
  return { id, value: raw, missing: false, drawn, t: (drawn - lo) / (hi - lo), flag };
}

export const particleCount = (id: ParticleVar, drawn: number) => Math.max(0, Math.round(drawn / PARTICLE_RATE[id]));

export function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo) return m;
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/* ------------------------------------------------------------------------------------------------- scenery */
export type Biome = "lush" | "temperate" | "savanna" | "desert" | "taiga" | "alpine";
export const BIOME_LABEL: Record<Biome, string> = {
  lush: "wet tropical forest",
  temperate: "temperate hills",
  savanna: "semi-arid savanna",
  desert: "dry desert",
  taiga: "cold snowy forest",
  alpine: "cold mountains",
};

/** Illustrative biome from the long-term regional means; temperate when there is no land-model series. */
export function chooseBiome(c: OrbClimate | null): Biome {
  if (!c) return "temperate";
  const ok = [c.precip, c.et, c.swe, c.tair].every(Number.isFinite);
  if (!ok) return "temperate";
  if (c.tair < 8 || c.swe > 3) return c.tair < -3 || c.swe > 20 ? "taiga" : "alpine";
  if (c.precip < 0.6 && c.et < 0.6) return "desert";
  if (c.et >= 2.4 || c.precip >= 3.5) return "lush";
  if (c.tair >= 20 && c.precip < 2.5) return "savanna";
  return "temperate";
}

/** Diorama style: the glass ball with a smooth landscape, the same ball with a hex-tile board, or a floating hex sky island. */
export type OrbVariant = "glass" | "hex-glass" | "hex-island";
export const VARIANT_LABEL: Record<OrbVariant, string> = { glass: "Glass ball", "hex-glass": "Hex board", "hex-island": "Sky island" };
/** Does the scene show soil strata? The hex variants show them on the side faces, so an island board has them too (glass island: no). */
export const sceneHasSoil = (plan: { kind: SceneryKind; landSide: "land" | "ice" }, variant: OrbVariant = "glass") =>
  plan.kind === "land" || (plan.kind === "coast" && plan.landSide === "land") || (variant !== "glass" && plan.kind === "island" && plan.landSide === "land");

export type SceneryKind = "sea" | "coast" | "island" | "ice" | "land";
/** What the diorama is made of. Chosen once per region from surface shares (README section 15) and long-term means. */
export interface SceneryPlan {
  kind: SceneryKind;
  /** style of the land part (ignored for open sea / ice) */
  biome: Biome;
  /** what the land side of a coast, or the whole of an "ice" scene, stands on */
  landSide: "land" | "ice";
  /** normalised area shares: bare land (land minus ice), ice, ocean; sum 1 */
  share: { land: number; ice: number; sea: number };
  /** share of GLDAS precipitation falling as snow (drives snowy touches on land), 0-1 */
  snow: number;
  /** the sea is drawn because the region borders the sea (coastShare), not because the polygon holds ocean */
  seaFromBorder?: boolean;
  /** a small islet is drawn in an open-sea scene */
  islet: boolean;
  /** the region has a land-model series */
  hasSeries: boolean;
  label: string;
}
export const SCENERY_LABEL: Record<SceneryKind, string> = { sea: "Open sea", coast: "Coast", island: "Island", ice: "Ice sheet", land: "Land" };

export function chooseScenery(region: Region, climate: OrbClimate | null): SceneryPlan {
  const f = region.surfaceFrac ?? (region.surface === "ocean" ? { land: 0, ocean: 1, ice: 0 } : region.surface === "ice" ? { land: 0, ocean: 0, ice: 1 } : { land: 1, ocean: 0, ice: 0 });
  // ice overlaps land (Greenland basins count as both): ice share = ice, bare land = land - ice, ocean = ocean
  const raw = { land: Math.max(0, f.land - f.ice), ice: Math.max(0, f.ice), sea: Math.max(0, f.ocean) };
  const sum = raw.land + raw.ice + raw.sea || 1;
  let share = { land: raw.land / sum, ice: raw.ice / sum, sea: raw.sea / sum };
  const landSide = share.ice > share.land ? "ice" : "land";
  // coastShare: how much of the region's boundary touches the sea (0 inland .. 1 island). It adds sea to a polygon that is all land.
  const cs = Math.min(1, Math.max(0, Number.isFinite(region.coastShare) ? region.coastShare! : 0));
  const withSea = (sea: number) => { const k = (1 - sea) / (1 - share.sea || 1); share = { land: share.land * k, ice: share.ice * k, sea }; };
  let seaFromBorder = false;
  let kind: SceneryKind = share.sea >= 0.7 ? "sea" : share.sea >= 0.15 ? "coast" : landSide === "ice" ? "ice" : "land";
  if (kind === "ice" || kind === "land") {
    if (cs >= 0.6) { kind = "island"; withSea(0.3); seaFromBorder = true; }
    else if (cs >= 0.12) { kind = "coast"; withSea(0.5); seaFromBorder = true; } // drawn half land, half sea
  }
  const hasSeries = climate != null;
  const snow = Number.isFinite(region.snowFrac) ? Math.min(1, Math.max(0, region.snowFrac!)) : 0;
  return {
    kind, biome: chooseBiome(climate), landSide, share, snow, hasSeries, seaFromBorder,
    islet: kind === "island" || (kind === "sea" && (share.land + share.ice >= 0.005 || hasSeries)),
    label: SCENERY_LABEL[kind],
  };
}

/** One sentence naming the scenery for the legend. */
export function sceneryWords(p: SceneryPlan, variant: OrbVariant = "glass"): string {
  return sceneryBase(p, variant) + VARIANT_NOTE[variant];
}
const VARIANT_NOTE: Record<OrbVariant, string> = {
  glass: "",
  "hex-glass": " Drawn as a hex board: biomes are clusters of hex tiles inside the glass, and the tile heights, props and layout are decoration.",
  "hex-island": " Drawn as a sky island: a floating hex board with its soil strata on the side; the rock below, the roots and the clouds are decoration.",
};
function sceneryBase(p: SceneryPlan, variant: OrbVariant): string {
  const pc = (x: number) => `${Math.round(x * 100)} %`;
  switch (p.kind) {
    case "sea": return `An open-sea scene (${pc(p.share.sea)} ocean in the region)${p.islet ? " with a small islet standing for its land share" : ""}.`;
    case "coast": if (variant !== "glass") return `A coast: ${p.landSide === "ice" ? "an ice plateau" : BIOME_LABEL[p.biome]} on one side and sea on the other, drawn about half land and half sea. The sizes are illustrative.`;
      return `A coast: ${p.landSide === "ice" ? "an ice plateau" : BIOME_LABEL[p.biome]} on one side and sea on the other, ${p.seaFromBorder ? "drawn because the region borders the sea; the size of the sea is illustrative" : `sized by the region's ${100 - Math.round(p.share.sea * 100)} % land / ${Math.round(p.share.sea * 100)} % ocean split`}.`;
    case "island": if (variant !== "glass") return `An island: ${p.landSide === "ice" ? "an ice plateau" : BIOME_LABEL[p.biome]} with a beach, surrounded by sea along about two thirds of the board's edge. Land reaches the edge along the remaining third, where the soil strata show on the side. The sea is drawn because the region borders the sea; the sizes are illustrative.`;
      return `An island: ${p.landSide === "ice" ? "an ice plateau" : BIOME_LABEL[p.biome]} in the middle of the ground with a beach ring and sea all around. The sea is drawn because the region borders the sea; the size of the island and the sea is illustrative.`;
    case "ice": return "An ice-sheet plateau with ice blocks: no soil, no trees.";
    default: return `${BIOME_LABEL[p.biome][0].toUpperCase()}${BIOME_LABEL[p.biome].slice(1)}, picked from the region's long-term means${p.snow >= 0.25 ? ", dusted with snow because a large share of its precipitation falls as snow" : ""}.`;
  }
}

/* ------------------------------------------------------------------------------------------------- colour */
export type RGB = [number, number, number]; // sRGB 0..1

export function parseColor(s: string, fallback: RGB = [0.5, 0.5, 0.5]): RGB {
  const str = s.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(str);
  if (m) return m[1].split("").map((h) => parseInt(h + h, 16) / 255) as RGB;
  m = /^#([0-9a-f]{6})/i.exec(str);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16) / 255) as RGB;
  m = /^rgba?\(([^)]+)\)/i.exec(str);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (p.length === 3 && p.every(Number.isFinite)) return p.map((x) => x / 255) as RGB;
  }
  return fallback;
}
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE: RGB = [1, 1, 1];
const BLACK: RGB = [0, 0, 0];

/**
 * Soil moisture colour on the shared domain: dry tan (t = 0) -> light water blue (t = 0.35) -> full water blue (t = 1),
 * i.e. a blue overlay whose opacity follows the value. The CSS twins are `soilRampCss` / `soilCssAt`.
 */
export const SOIL_DRY: RGB = [0.84, 0.69, 0.47];
const SOIL_MID_T = 0.35; // position of the light-blue stop on the domain
const SOIL_MID_WHITE = 0.5; // share of white in the light-blue middle stop
const SOIL_WET_BLACK = 0.12; // share of black in the full-blue end stop
const rgbCss = (c: RGB) => `rgb(${c.map((x) => Math.round(x * 255)).join(" ")})`;
export function soilColor(blue: RGB, t: number): RGB {
  const x = Math.min(1, Math.max(0, t));
  const light = mix(blue, WHITE, SOIL_MID_WHITE), full = mix(blue, BLACK, SOIL_WET_BLACK);
  return x <= SOIL_MID_T ? mix(SOIL_DRY, light, x / SOIL_MID_T) : mix(light, full, (x - SOIL_MID_T) / (1 - SOIL_MID_T));
}
export function soilCssAt(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  const light = `color-mix(in srgb, var(--viz-blue) ${Math.round((1 - SOIL_MID_WHITE) * 100)}%, white)`;
  const full = `color-mix(in srgb, var(--viz-blue) ${Math.round((1 - SOIL_WET_BLACK) * 100)}%, black)`;
  const dry = rgbCss(SOIL_DRY);
  if (x <= SOIL_MID_T) return `color-mix(in srgb, ${light} ${((x / SOIL_MID_T) * 100).toFixed(1)}%, ${dry})`;
  return `color-mix(in srgb, ${full} ${(((x - SOIL_MID_T) / (1 - SOIL_MID_T)) * 100).toFixed(1)}%, ${light})`;
}
export const soilRampCss = () => {
  const light = `color-mix(in srgb, var(--viz-blue) ${Math.round((1 - SOIL_MID_WHITE) * 100)}%, white)`;
  const full = `color-mix(in srgb, var(--viz-blue) ${Math.round((1 - SOIL_WET_BLACK) * 100)}%, black)`;
  return `linear-gradient(to right, ${rgbCss(SOIL_DRY)} 0%, ${light} ${SOIL_MID_T * 100}%, ${full} 100%)`;
};

/** Air-temperature scale: diverging around 0 °C (freezing) on the fixed tair domain, cool -> mid -> warm. */
export const TAIR_DOMAIN = VARIABLES.tair.domain;
export const TAIR_ZERO_T = (0 - TAIR_DOMAIN[0]) / (TAIR_DOMAIN[1] - TAIR_DOMAIN[0]);
export function tairColor(t: number, cool: RGB, mid: RGB, warm: RGB): RGB {
  return t <= TAIR_ZERO_T ? mix(cool, mid, t / TAIR_ZERO_T) : mix(mid, warm, (t - TAIR_ZERO_T) / (1 - TAIR_ZERO_T));
}
export const TAIR_GRADIENT_CSS = `linear-gradient(to right, var(--viz-cool) 0%, var(--viz-mid) ${(TAIR_ZERO_T * 100).toFixed(2)}%, var(--viz-warm) 100%)`;

/* ------------------------------------------------------------------------------------------------- words */
export function encodingWords(id: VarId, r: Reading, plan: SceneryPlan, variant: OrbVariant = "glass"): string {
  const hex = variant !== "glass";
  const toSea = plan.kind === "coast" || plan.kind === "island" || (hex && plan.kind === "sea");
  const lateral = toSea ? "drifting from the land toward the sea" : hex ? "sliding toward the edge of the board" : "sliding toward the rim";
  if (isParticleVar(id)) {
    const n = particleCount(id, r.drawn);
    const [one, many] = PARTICLE_NOUN[id];
    return `${n} ${n === 1 ? one : many}, 1 per ${PARTICLE_RATE[id]} mm/day${id === "runoff" ? `, ${lateral}` : ""}`;
  }
  switch (id) {
    case "soil_top":
    case "root_zone": {
      const n = beadCount(id, r.drawn);
      const band = id === "soil_top" ? "0–10 cm" : "root-zone";
      return `${n} water ${n === 1 ? "bead" : "beads"} in the ${band} soil band${variant === "hex-island" ? " on the island's side" : ""} (1 per ${BEAD_STEP[id]} mm) and its blue saturation: tan is dry, deep blue is full`;
    }
    case "swe":
      if (plan.kind === "sea" && plan.snow < SNOW_ISLET_MIN) return "No snow cap is drawn in an open-sea scene: the value is listed here, not drawn";
      return hex
        ? `Snow caps on the highest tiles: height and width grow with the square root of SWE (more caps appear as it grows), full size = ${VARIABLES.swe.domain[1]} mm`
        : `Snow cap on the ${plan.kind === "ice" ? "ice" : "hill"}: height and width grow with the square root of SWE, full size = ${VARIABLES.swe.domain[1]} mm`;
    case "tws": return "Fill of the storage tube: modelled soil + snow + canopy water";
    case "p_minus_et": return "Gauge around a zero line; not a storage change";
    default: return "";
  }
}

export function ariaSummary(regionName: string, month: string, targets: VarId[], values: Partial<Record<VarId, number | null>>, tempColour: boolean, scenery: SceneryPlan): string {
  const parts = targets.map((id) => {
    const r = readValue(id, values[id]);
    const label = VARIABLES[id].label.toLowerCase();
    if (r.missing) return `${label}: no data this month`;
    let s = `${label} ${formatValue(id, r.value, true)}`;
    if (isParticleVar(id)) s += ` (${particleCount(id, r.drawn)} ${PARTICLE_NOUN[id][1]})`;
    if (id === "et" && tempColour) {
      const ta = readValue("tair", values.tair);
      s += ta.missing ? ", air temperature missing" : `, coloured by air temperature ${formatValue("tair", ta.value, true)}`;
    }
    return s;
  });
  return `Crystal ball for ${regionName}, ${monthLabel(month)}: ${parts.join("; ")}. ${scenery.label} scenery is illustrative.`;
}

/** CSS colour of the air-temperature scale at t (twin of tairColor). */
export function tairCssAt(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  if (x <= TAIR_ZERO_T) return `color-mix(in srgb, var(--viz-mid) ${((x / TAIR_ZERO_T) * 100).toFixed(1)}%, var(--viz-cool))`;
  return `color-mix(in srgb, var(--viz-warm) ${(((x - TAIR_ZERO_T) / (1 - TAIR_ZERO_T)) * 100).toFixed(1)}%, var(--viz-mid))`;
}
export const HATCH_CSS = "repeating-linear-gradient(135deg, var(--viz-grid) 0 3px, var(--viz-axis) 3px 6px)";

/** Legend line for the seasonal leaves (illustrative calendar cue, not a measured vegetation variable). */
export const LEAVES_NOTE =
  "Leaf size and colour show the season, taken from this region's average year (temperature outside the tropics, rainfall in the tropics) and repeated every year. Evergreens barely change. It is an illustrative cue, not measured vegetation.";

/**
 * Short label of the illustrative leaf season for a month, e.g. "Autumn (N. Hemisphere)", "Spring (S. Hemisphere)",
 * "Wet season", "Dry season", "Evergreen, little seasonality". It comes from the region's long-term monthly climatology
 * (the same every year), not from measured vegetation. Returns "" when the region has no climate series.
 */
export function seasonWords(region: Region, climate: OrbClimate | null, month: string): string {
  if (!climate) return "";
  return seasonOf(region, climate, month).label;
}
