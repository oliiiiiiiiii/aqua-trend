// STAND-IN for workstream D (web/lib/detective/keywords.ts): a small keyword table, English and Chinese.
// Used in the browser when /api/select-variables is missing (static export) or fails. Delete at integration.
import type { CategoryId, SelectResponse } from "@/lib/detective/contracts";
import { CATEGORY_IDS, suggestTime } from "@/lib/detective/url";

const DROUGHT = ["drought", "dry", "旱", "乾"];
const FLOOD = ["flood", "inundat", "洪", "水災", "淹"];
const STORM = ["typhoon", "hurricane", "cyclone", "storm", "颱風", "颶風", "風暴"];
const FIRE = ["fire", "bushfire", "wildfire", "火"];
const HEAT = ["heat", "hot", "warm", "熱", "高溫"];
const ENSO = ["el niño", "el nino", "la niña", "la nina", "enso", "聖嬰", "反聖嬰"];

const TABLE: Record<CategoryId, string[]> = {
  precip: ["rain", "precip", "monsoon", "snowfall", "雨", "降水", "季風", ...DROUGHT, ...FLOOD, ...STORM, ...ENSO],
  et: ["evapor", "transpir", "蒸發", "蒸散", ...DROUGHT, ...HEAT],
  soil: ["soil", "crop", "farm", "agricult", "harvest", "土壤", "農", ...DROUGHT, ...FLOOD],
  tws: ["groundwater", "aquifer", "reservoir", "water storage", "glacier", "lake", "地下水", "水庫", "儲水", "冰川", "湖", ...DROUGHT, ...FLOOD],
  runoff: ["river", "runoff", "streamflow", "discharge", "河", "逕流", "溪", ...FLOOD, ...STORM],
  snow: ["snow", "blizzard", "glacier", "雪", "冰川"],
  tair: ["temperature", "cold", "freeze", "frost", "溫", "寒", "凍", ...HEAT, ...FIRE],
  vpd: ["humid", "濕度", ...DROUGHT, ...HEAT, ...FIRE],
  energy: ["sunshine", "radiation", "solar", "cloud", "日照", "輻射", "雲", ...HEAT],
  wind: ["wind", "dust", "風", "沙塵", ...STORM],
  ndvi: ["vegetation", "green", "forest", "crop", "plant", "植", "森林", "作物", ...FIRE, ...DROUGHT],
  sst: ["ocean", "sea surface", "marine", "coral", "海", ...ENSO],
};

export function standinKeywordVotes(event: string): SelectResponse {
  const text = event.toLowerCase();
  const votes = CATEGORY_IDS.map((category) => {
    const hit = TABLE[category].some((k) => text.includes(k));
    return { category, p: hit ? 1 : 0, selected: hit };
  });
  return { votes, suggestedTime: suggestTime(event), source: "keyword-fallback" };
}
