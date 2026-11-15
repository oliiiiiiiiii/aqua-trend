// Which way "above normal" reads for a variable (docs/ux-refresh.md "Colour").
// More water reads cool; less water, more heat, more smoke or fire reads warm.
import type { CategoryId } from "./contracts";

const HIGH_READS: Record<CategoryId, "cool" | "warm"> = {
  precip: "cool", et: "cool", soil: "cool", tws: "cool", runoff: "cool", snow: "cool", vapor: "cool", ndvi: "cool",
  tair: "warm", vpd: "warm", energy: "warm", sst: "warm", aod: "warm", fire: "warm", so2: "warm",
  // no physical "wet/dry" reading: high = warm by convention, stated in the legend
  wind: "warm", ozone: "warm",
};

/** Colour that an above-normal value of this category wears. */
export const anomalyPolarity = (c: CategoryId): "cool" | "warm" => HIGH_READS[c];

/** true when the colour choice is a convention rather than a meaning (the legend says so) */
export const polarityIsArbitrary = (c: CategoryId): boolean => c === "wind" || c === "ozone";
