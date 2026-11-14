import type { VarId } from "./types";

export type VarKind = "flux-down" | "flux-up" | "flux-lateral" | "net" | "stock" | "temperature";

export interface VariableMeta {
  id: VarId;
  label: string;
  short: string;
  unit: string;
  /** unit of the Sen slope shown to people: unit per decade */
  trendUnit: string;
  kind: VarKind;
  /** GLDAS_NOAH10_M 2.1 source fields */
  source: string[];
  what: string;
  /** scientific boundary that must stay visible wherever the variable is interpreted */
  caveat: string;
  /** fixed display domain shared by every region, so regions stay comparable (values outside are clamped and flagged) */
  domain: [number, number];
  decimals: number;
  /** CSS custom property holding this variable's series colour (identity colour, see globals.css) */
  color: string;
  /** which way "more" points on a diverging trend scale: water gains read cool, warming reads warm */
  increaseReads: "cool" | "warm";
  /** how the crystal ball encodes it */
  orbChannel: string;
  /** can be picked as one of the (max 3) water targets; tair is context only */
  target: boolean;
}

export const MAX_TARGETS = 3;

export const VARIABLES: Record<VarId, VariableMeta> = {
  precip: {
    id: "precip", label: "Precipitation", short: "Precip", unit: "mm/day", trendUnit: "mm/day per decade",
    kind: "flux-down", source: ["Rainf_f_tavg"],
    what: "Average rain and snowfall rate over the month — the water arriving from the atmosphere.",
    caveat: "GLDAS forcing field (Rainf_f_tavg), not GPM IMERG. Precipitation is not river flow.",
    domain: [0, 12], decimals: 2, color: "--viz-blue", increaseReads: "cool",
    orbChannel: "Falling drops: count is proportional to the monthly mean rate.", target: true,
  },
  et: {
    id: "et", label: "Evapotranspiration", short: "ET", unit: "mm/day", trendUnit: "mm/day per decade",
    kind: "flux-up", source: ["Evap_tavg"],
    what: "Water returned to the air by soil evaporation and plant transpiration.",
    caveat: "Actual ET from the Noah land model, not a direct satellite measurement. More ET does not by itself mean more water stored in the air.",
    domain: [0, 6], decimals: 2, color: "--viz-orange", increaseReads: "cool",
    orbChannel: "Rising vapour puffs: count is proportional to the flux; colour can carry near-surface air temperature.", target: true,
  },
  p_minus_et: {
    id: "p_minus_et", label: "Precipitation minus ET", short: "P − ET", unit: "mm/day", trendUnit: "mm/day per decade",
    kind: "net", source: ["Rainf_f_tavg", "Evap_tavg"],
    what: "Net vertical exchange at the surface: positive when more water arrives than leaves upward.",
    caveat: "Runoff and lateral flow are not subtracted, so this is not a storage change or 'available water'.",
    domain: [-6, 8], decimals: 2, color: "--viz-aqua", increaseReads: "cool",
    orbChannel: "A gauge with a zero line beside the ball; it does not drive the storage level.", target: true,
  },
  runoff: {
    id: "runoff", label: "Runoff (surface + baseflow)", short: "Runoff", unit: "mm/day", trendUnit: "mm/day per decade",
    kind: "flux-lateral", source: ["Qs_acc", "Qsb_acc"],
    what: "Water the model sheds sideways: storm runoff plus sub-surface baseflow.",
    caveat: "Modelled runoff generation, not gauged streamflow at a basin outlet. No river channel is drawn without river data.",
    domain: [0, 6], decimals: 2, color: "--viz-violet", increaseReads: "cool",
    orbChannel: "Sideways chevrons leaving the land surface: count is proportional to the flux. Modelled runoff generation, not a river.", target: true,
  },
  soil_top: {
    id: "soil_top", label: "Topsoil moisture, 0–10 cm", short: "Topsoil", unit: "mm", trendUnit: "mm per decade",
    kind: "stock", source: ["SoilMoi0_10cm_inst"],
    what: "Water held in the top 10 cm of soil, the layer that reacts fastest to rain and heat.",
    caveat: "A thin surface layer in mm water equivalent. It is not groundwater.",
    domain: [0, 50], decimals: 1, color: "--viz-green", increaseReads: "cool",
    orbChannel: "Colour of the top soil band in the cut-away.", target: true,
  },
  root_zone: {
    id: "root_zone", label: "Root-zone moisture", short: "Root zone", unit: "mm", trendUnit: "mm per decade",
    kind: "stock", source: ["RootMoist_inst"],
    what: "Water in the soil depth that plant roots can reach, as defined by the Noah model.",
    caveat: "Model-defined depth that varies with vegetation type. It is not groundwater.",
    domain: [0, 700], decimals: 0, color: "--viz-yellow", increaseReads: "cool",
    orbChannel: "Colour of the root-zone soil band in the cut-away.", target: true,
  },
  tws: {
    id: "tws", label: "Modelled land water storage", short: "Storage", unit: "mm", trendUnit: "mm per decade",
    kind: "stock", source: ["SoilMoi0_10cm_inst", "SoilMoi10_40cm_inst", "SoilMoi40_100cm_inst", "SoilMoi100_200cm_inst", "SWE_inst", "CanopInt_inst"],
    what: "Soil water down to 2 m plus snow plus canopy water, summed by the Noah model.",
    caveat: "Not GRACE terrestrial water storage: deep groundwater and surface water bodies are not included. Over ice sheets (Greenland) the Noah model accumulates snow year after year, so large rising values there are a model artefact, not observed snow gain.",
    domain: [0, 1200], decimals: 0, color: "--viz-magenta", increaseReads: "cool",
    orbChannel: "Storage tube beside the ball, labelled with what the model sum contains.", target: true,
  },
  swe: {
    id: "swe", label: "Snow water equivalent", short: "Snow", unit: "mm", trendUnit: "mm per decade",
    kind: "stock", source: ["SWE_inst"],
    what: "Depth of water you would get if the snowpack melted.",
    caveat: "Water equivalent, not snow depth or snow-covered area. Over ice sheets (Greenland) the Noah model accumulates snow year after year, so large rising values there are a model artefact, not observed snow gain.",
    domain: [0, 300], decimals: 1, color: "--viz-ink", increaseReads: "cool",
    orbChannel: "Snow store on the hill: its size follows water equivalent, not snow depth.", target: true,
  },
  tair: {
    id: "tair", label: "Near-surface air temperature", short: "Air temp", unit: "°C", trendUnit: "°C per decade",
    kind: "temperature", source: ["Tair_f_inst"],
    what: "Air temperature just above the ground.",
    caveat: "Air temperature, not land-surface temperature and not the temperature of the vapour itself.",
    domain: [-30, 40], decimals: 1, color: "--viz-red", increaseReads: "warm",
    orbChannel: "Colour scale for the air and for ET vapour puffs.", target: false,
  },
};

export const VAR_ORDER: VarId[] = ["precip", "et", "p_minus_et", "runoff", "soil_top", "root_zone", "tws", "swe", "tair"];
export const TARGET_VARS: VarId[] = VAR_ORDER.filter((v) => VARIABLES[v].target);

/** Format a value with its variable's precision; missing values read as an em dash, never as zero. */
export function formatValue(v: VarId, x: number | null | undefined, withUnit = false): string {
  if (x == null || Number.isNaN(x)) return "—";
  const m = VARIABLES[v];
  const s = x.toLocaleString("en-US", { minimumFractionDigits: m.decimals, maximumFractionDigits: m.decimals });
  return withUnit ? `${s} ${m.unit}` : s;
}

export const DATASET = {
  short: "GLDAS_NOAH10_M 2.1",
  long: "GLDAS Noah Land Surface Model L4 monthly 1.0° × 1.0°, version 2.1",
  agency: "NASA GSFC / GES DISC",
  period: "2000-01 to 2026-07",
  trendPeriod: "2000–2025 (26 complete years)",
  nature: "Observation-forced land-surface model (open loop). All nine variables come from this one product, so agreement between them is not independent evidence.",
};
