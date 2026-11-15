// 變數類別的名稱、淺白定義、預設資料層與圖示（工作線 E）。
// 規格：/SPEC.md §4。中文名稱與 web/public/data/catalog/regions.json 的 categories 一致。
//
// - definition 給高中生看：一句話，中文不超過 30 字（含標點）。D 的 AI 投票也用中文定義當問題文字。
// - defaultLayer 必須存在於 catalog/variables.json 的 layers，且等於 category_default_layer。
// - icon 是 24×24 viewBox 的 SVG path `d`，以 stroke 繪製（fill="none" stroke="currentColor"
//   stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"），不依賴圖示套件。

import type { CategoryId, LayerId } from "./contracts";

export interface CategoryInfo {
  id: CategoryId;
  name: { zh: string; en: string };
  /** 一句話淺白定義。 */
  definition: { zh: string; en: string };
  /** 預設資料層（variables.json 的 layers 鍵）。 */
  defaultLayer: LayerId;
  /** 24×24 stroke 圖示的 SVG path。 */
  icon: string;
}

export const CATEGORY_ORDER = [
  "precip", "et", "soil", "tws", "runoff", "snow",
  "tair", "vpd", "energy", "wind", "ndvi", "sst",
  "aod", "ozone", "vapor", "so2", "fire",
] as const satisfies readonly CategoryId[];

type MissingCategory = Exclude<CategoryId, (typeof CATEGORY_ORDER)[number]>;
const exhaustive: [MissingCategory] extends [never] ? true : false = true;
void exhaustive;

export const CATEGORIES: Record<CategoryId, CategoryInfo> = {
  precip: {
    id: "precip",
    name: { zh: "降水", en: "Precipitation" },
    definition: { zh: "從天上落下的雨和雪有多少", en: "How much rain and snow falls from the sky." },
    defaultLayer: "p_imerg",
    // 雲 + 雨滴
    icon: "M7 15a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 0 7H7 M8 18v2 M12 18v3 M16 18v2",
  },
  et: {
    id: "et",
    name: { zh: "蒸發散", en: "Evapotranspiration" },
    definition: { zh: "地面和植物把水送回空氣中的量", en: "Water that soil and plants send back into the air." },
    defaultLayer: "et_m2",
    // 葉子 + 上升的水氣
    icon: "M5 21c0-6 4-10 10-10 0 6-4 10-10 10Z M5 21l6-6 M15 3c1 1.5-1 2.5 0 4 M19 5c1 1.5-1 2.5 0 4",
  },
  soil: {
    id: "soil",
    name: { zh: "土壤水", en: "Soil moisture" },
    definition: { zh: "植物根部所在土層裡有多少水", en: "How much water is in the soil where plant roots grow." },
    defaultLayer: "sm_root",
    // 地面線 + 根 + 水滴
    icon: "M3 9h18 M12 9v8 M12 13l-3 3 M12 12l3 3 M18 14c0 1.1-.9 2-2 2",
  },
  tws: {
    id: "tws",
    name: { zh: "陸地總儲水量", en: "Terrestrial water storage" },
    definition: { zh: "地表、土壤、地下水加起來的總水量變化", en: "Change in all water on land: surface, soil and groundwater." },
    defaultLayer: "tws",
    // 分層的地殼剖面
    icon: "M3 6h18 M3 11h18 M3 16h18 M3 6v14h18V6 M8 13.5c.8-.7 1.6-.7 2.4 0s1.6.7 2.4 0 1.6-.7 2.4 0",
  },
  runoff: {
    id: "runoff",
    name: { zh: "逕流", en: "Runoff" },
    definition: { zh: "下雨後沒被吸收、流進河裡的水", en: "Rain that the ground does not soak up and flows to rivers." },
    defaultLayer: "runoff",
    // 斜坡 + 水流
    icon: "M3 20 21 8 M4 14c2-1.5 4 1.5 6 0s4-1.5 6 0 M4 10c2-1.5 4 1.5 6 0",
  },
  snow: {
    id: "snow",
    name: { zh: "積雪", en: "Snow water" },
    definition: { zh: "地上的積雪融化後等於多少水", en: "How much water the snow on the ground would melt into." },
    defaultLayer: "swe",
    // 雪花
    icon: "M12 2v20 M3.3 7l17.4 10 M20.7 7 3.3 17 M9.5 3.5 12 5l2.5-1.5 M9.5 20.5 12 19l2.5 1.5",
  },
  tair: {
    id: "tair",
    name: { zh: "氣溫", en: "Air temperature" },
    definition: { zh: "地面附近的空氣溫度", en: "Temperature of the air near the ground." },
    defaultLayer: "tair",
    // 溫度計
    icon: "M14 14.76V4a2 2 0 0 0-4 0v10.76a4 4 0 1 0 4 0Z M12 9v7",
  },
  vpd: {
    id: "vpd",
    name: { zh: "空氣乾燥度", en: "Air dryness (VPD)" },
    definition: { zh: "空氣有多「渴」，越大越容易把水吸走", en: "How thirsty the air is; higher pulls water out faster." },
    defaultLayer: "vpd",
    // 水滴 + 斜線（缺水）
    icon: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z M4 20 20 4",
  },
  energy: {
    id: "energy",
    name: { zh: "日照與能量", en: "Net radiation" },
    definition: { zh: "地面從陽光和天空淨得到的熱能", en: "Heat energy the ground gains from sunlight and the sky." },
    defaultLayer: "rn",
    // 太陽
    icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  },
  wind: {
    id: "wind",
    name: { zh: "風", en: "Wind speed" },
    definition: { zh: "地面附近的風吹得多快", en: "How fast the wind blows near the ground." },
    defaultLayer: "wind",
    // 風線
    icon: "M3 8h11a3 3 0 1 0-3-3 M3 12h16a3 3 0 1 1-3 3 M3 16h8",
  },
  ndvi: {
    id: "ndvi",
    name: { zh: "植被", en: "Vegetation greenness" },
    definition: { zh: "植物有多綠、多茂盛", en: "How green and leafy the plants are." },
    defaultLayer: "ndvi",
    // 樹苗
    icon: "M12 21v-9 M12 12c0-4 3-7 7-7 0 4-3 7-7 7Z M12 15c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5Z",
  },
  sst: {
    id: "sst",
    name: { zh: "海溫", en: "Sea surface temperature" },
    definition: { zh: "海面的水有多溫暖", en: "How warm the water at the sea surface is." },
    defaultLayer: "sst",
    // 波浪 + 溫度計
    icon: "M3 17c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0 M3 21c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0 M12 3v9 M10 12a2 2 0 1 0 4 0",
  },
  aod: {
    id: "aod",
    name: { zh: "氣膠光學厚度", en: "Aerosol optical depth" },
    definition: { zh: "整柱空氣中的粒子削弱光線的程度", en: "How strongly particles in the atmospheric column block light." },
    defaultLayer: "aod",
    icon: "M3 7h18 M5 12h14 M3 17h18 M7 4v16 M12 4v16 M17 4v16",
  },
  ozone: {
    id: "ozone",
    name: { zh: "臭氧柱總量", en: "Total-column ozone" },
    definition: { zh: "從地面到高空整柱空氣中的臭氧總量", en: "The total amount of ozone in the atmospheric column." },
    defaultLayer: "to3_m2",
    icon: "M3 18a9 9 0 0 1 18 0 M5 18a7 7 0 0 1 14 0 M8 18a4 4 0 0 1 8 0",
  },
  vapor: {
    id: "vapor",
    name: { zh: "大氣可降水量", en: "Atmospheric water vapour" },
    definition: { zh: "整柱空氣中的水蒸氣凝結後有多少水", en: "How much water all the water vapour in the atmospheric column would make if condensed." },
    defaultLayer: "tqv",
    icon: "M7 4c3 2-3 4 0 6s-3 4 0 6 M12 4c3 2-3 4 0 6s-3 4 0 6 M17 4c3 2-3 4 0 6s-3 4 0 6 M4 21h16",
  },
  so2: {
    id: "so2",
    name: { zh: "SO₂ 年排放量", en: "Annual SO₂ emissions" },
    definition: { zh: "區域內大型點源每年排放多少二氧化硫", en: "How much sulfur dioxide large point sources emit each year." },
    defaultLayer: "so2_emis",
    icon: "M4 21V11h5v10 M9 21V8h5v13 M14 21V4h5v17 M2 21h20",
  },
  fire: {
    id: "fire",
    name: { zh: "植被火熱點偵測數", en: "Vegetation-fire detections" },
    definition: { zh: "衛星每月偵測到的植被火熱點次數", en: "How many vegetation-fire detections satellites record each month." },
    defaultLayer: "fire_count",
    icon: "M12 2c2 5 7 8 7 13a7 7 0 0 1-14 0c0-3 2-5 4-7 0 3 1 4 2 5 2-3 2-7 1-11Z",
  },
};

/** 依固定順序回傳全部類別。 */
export function listCategories(): CategoryInfo[] {
  return CATEGORY_ORDER.map((id) => CATEGORIES[id]);
}
