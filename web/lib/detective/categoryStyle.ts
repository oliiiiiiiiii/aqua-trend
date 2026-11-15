// Identity of a variable in the analysis workbench: an icon and a family colour (UI/UX refresh).
//
// Variables of the same kind share a colour. The colour is used ONLY for the icon chip and small accents (a dot, a
// short rule). It is never used for anomaly bars (those keep --viz-cool / --viz-warm by anomalyPolarity) and never for
// text. Every use sits beside the icon and the name, so identity is never carried by colour alone.
//
// Tokens are the validated categorical steps in globals.css (light + night). --viz-cool / --viz-warm / --viz-red are
// reserved for anomaly polarity and are not used here.
//
// Colours follow intuition (water blue, heat orange, vegetation green), chosen by the product owner over colour-blind
// separation (orange vs green is hard for protan/deutan viewers). Identity is never colour-only: every chip has its icon
// and name beside it.
import type { CategoryId } from "./contracts";
import { CATEGORIES } from "./categories";

export type FamilyId = "land-water" | "air-water" | "heat" | "life" | "air" | "wind";

export interface FamilyInfo {
  id: FamilyId;
  /** short English name, for a legend or a tooltip */
  name: string;
  /** CSS custom property of the colour, e.g. "--viz-blue" */
  token: `--viz-${string}`;
}

export const FAMILIES: Record<FamilyId, FamilyInfo> = {
  "land-water": { id: "land-water", name: "Water on land", token: "--viz-blue" },
  "air-water": { id: "air-water", name: "Water in the air", token: "--viz-aqua" },
  heat: { id: "heat", name: "Heat and radiation", token: "--viz-orange" },
  life: { id: "life", name: "Vegetation and fire", token: "--viz-green" },
  air: { id: "air", name: "Air composition", token: "--viz-violet" },
  wind: { id: "wind", name: "Wind", token: "--viz-magenta" },
};

export const CATEGORY_FAMILY: Record<CategoryId, FamilyId> = {
  precip: "land-water", soil: "land-water", tws: "land-water", runoff: "land-water", snow: "land-water",
  et: "air-water", vapor: "air-water", vpd: "air-water",
  tair: "heat", energy: "heat", sst: "heat",
  ndvi: "life", fire: "life",
  aod: "air", ozone: "air", so2: "air",
  wind: "wind",
};

export interface CategoryStyle {
  family: FamilyId;
  /** CSS colour value, e.g. "var(--viz-blue)" */
  color: string;
  token: string;
  /** 24×24 stroke path (CATEGORIES[c].icon) */
  icon: string;
}

export function categoryStyle(c: CategoryId): CategoryStyle {
  const family = CATEGORY_FAMILY[c];
  const token = FAMILIES[family].token;
  return { family, token, color: `var(${token})`, icon: CATEGORIES[c].icon };
}

/**
 * Chip colours for an icon: a light wash of the family colour behind a stroke mixed toward ink, so the glyph keeps
 * contrast on paper in both themes (yellow-ish or light steps alone would not).
 */
export function chipColors(color: string): { background: string; stroke: string } {
  return {
    background: `color-mix(in srgb, ${color} 16%, transparent)`,
    stroke: `color-mix(in srgb, ${color} 72%, var(--ink))`,
  };
}
