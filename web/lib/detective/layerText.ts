// English product names and caveats for catalogue layers whose text in variables.json is Chinese.
// A layer that is not listed keeps the catalogue text. Every scientific limitation of the original
// caveat is kept; internal references (team notes, branch names) are not.
import type { LayerInfo } from "./series";

export interface LayerText { product?: string; caveat?: string }

export const LAYER_TEXT: Record<string, LayerText> = {
  tws: {
    caveat: "GRACE resolves roughly 300 km, so small basins are smoothed. Large earthquakes cause gravity jumps that are not hydrological.",
  },
  p_imerg: { product: "GPM IMERG monthly" },
  p_gpcp: {
    product: "GPCP v2.3 (published by NOAA PSL)",
    caveat: "GPCP is published by NOAA PSL, not through a NASA portal.",
  },
  et_gldas: {
    caveat: "GLDAS-2.1 evapotranspiration has a known long-term drift, so its trend is unreliable.",
  },
  pet_gldas: {
    caveat: "GLDAS-2.1 potential evapotranspiration has a known long-term drift, so its trend is unreliable.",
  },
  vpd: { product: "GLDAS Noah 2.1 forcing (derived)" },
  lst_day: {
    product: "MODIS Terra LST (orbit drift after 2020)",
    caveat: "MODIS Terra's orbit has drifted since 2020, which creates a false cooling trend.",
  },
  sst: { caveat: "NOAA OISST, not a NASA product." },
  aod: {
    caveat: "A reanalysis model that assimilates satellite AOD (MODIS and others). Before 2000 fewer observations could be assimilated.",
  },
  fire_count: {
    product: "MODIS FIRMS fire hotspots (Terra, national zips merged and de-duplicated)",
    caveat:
      "Counts Terra MODIS vegetation fires only (type 0; volcano, industrial and offshore excluded), with no confidence filter. Only Terra is used so that Aqua joining in 2002-07 does not double the counts, but Terra's orbit has drifted since about 2020 and its overpass is earlier, so later counts may be slightly off. A hotspot is a detection at the moment of the satellite pass, not a burned area. Values are empty before 2000-11; months with no detection in the region are 0.",
  },
  snow_cover: {
    product: "MODIS Terra MOD10CM v6.1 monthly snow cover (CMG 0.05°)",
    caveat:
      "Only valid values 0 to 100 are used. Cloud, polar night and water are excluded, so high-latitude winter regions often have no value. Antarctica is fixed as snow by the product and is masked. No file exists for 2000-08, 2001-06, 2002-03, 2003-12, 2016-02 and 2022-10 (empty).",
  },
  so2_emis: {
    product: "MSAQSO2L4 v2 multi-satellite SO₂ emission catalogue (OMI, OMPS, TROPOMI)",
    caveat:
      "This is an annual point-source catalogue (780 large polluters and volcanoes), not gridded concentration. Each year's value is repeated across all 12 months, so there is no monthly variation. Regions with no catalogued source are empty. Overall uncertainty is about 50%. The regional totals may count missing sources as 0, and the raw files were not reprocessed. Monthly anomaly and trend tests are not provided.",
  },
  lst_night: {
    product: "MODIS Terra MOD11C3 LST_Night (0.05° to 0.25° to 0.5°)",
    caveat: "Terra's orbit has drifted since 2020, so its overpass time is earlier.",
  },
  rn_ceres: {
    caveat:
      "Surface fluxes are inferred from satellite top-of-atmosphere radiation with a radiative transfer model, on a 1° grid, so small regions are poorly represented.",
  },
  ndvi: { product: "MODIS (0.05° to 0.5°)" },
  g1_soil_top: { product: "GLDAS_NOAH10_M 2.1 (1°)" },
};

/** the layer with English product and caveat text where the catalogue has none */
export function withEnglishText<T extends Pick<LayerInfo, "id" | "product" | "caveat">>(info: T): T {
  const t = LAYER_TEXT[info.id];
  if (!t) return info;
  return {
    ...info,
    product: t.product ?? info.product,
    caveat: t.caveat !== undefined && info.caveat != null ? t.caveat : info.caveat,
  };
}
