// STAND-IN for workstream E (web/lib/detective/categories.ts). Text from SPEC §4; delete at integration.
import type { CategoryId } from "@/lib/detective/contracts";
import type { CategoryInfo } from "../wiring";

const c = (id: CategoryId, name: string, nameZh: string, plain: string, plainZh: string): CategoryInfo => ({ id, name, nameZh, plain, plainZh });

export const STANDIN_CATEGORIES: Record<CategoryId, CategoryInfo> = {
  precip: c("precip", "Precipitation", "降水", "How much rain and snow falls from the sky.", "從天上落下的雨和雪有多少"),
  et: c("et", "Evapotranspiration", "蒸散", "Water that the ground and plants send back into the air.", "地面和植物把水送回空氣中的量"),
  soil: c("soil", "Soil moisture", "土壤水", "How much water is in the soil where plant roots grow.", "植物根部所在土層裡有多少水"),
  tws: c("tws", "Total water storage", "陸地儲水", "Change in all the water on and under the land, added up.", "地表、土壤、地下水加起來的總水量變化"),
  runoff: c("runoff", "Runoff", "逕流", "Rain that is not soaked up and flows into rivers.", "下雨後沒被吸收、流進河裡的水"),
  snow: c("snow", "Snow", "積雪", "How much water the snow would make if it melted.", "積雪融化後等於多少水"),
  tair: c("tair", "Air temperature", "氣溫", "How warm the air is near the ground.", "地面附近的空氣溫度"),
  vpd: c("vpd", "Air dryness", "空氣乾燥度", "How thirsty the air is: higher pulls water away faster.", "空氣有多「渴」，越大越容易把水吸走"),
  energy: c("energy", "Surface energy", "地表能量", "The net radiation energy the ground takes in.", "地表吸收的淨輻射能量"),
  wind: c("wind", "Wind", "風", "Wind speed near the ground.", "近地面風速"),
  ndvi: c("ndvi", "Vegetation", "植被", "How green and leafy the plants are.", "植物有多綠、多茂盛"),
  sst: c("sst", "Sea surface temperature", "海溫", "Temperature of the sea surface (rarely available for land basins).", "海表溫度（子流域多為陸地，通常不可用）"),
};
