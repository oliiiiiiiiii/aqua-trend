// 工作線 D：關鍵字備案（模型不可用或逾時時使用）與 E 文字中的時間建議。
// 純函式、不依賴 DOM 或 Node API：API route 與瀏覽器（靜態部署時）都直接呼叫。
// 規格：/SPEC.md §3 Step 1、/docs/INTEGRATION.md「D — AI 選變數」。

import type { CategoryId, CategoryVote, SelectResponse, TimeRange } from "./contracts";

/** 全部 12 個類別，順序同 SPEC §4。下方的型別檢查確保與 contracts 的 CategoryId 一致。 */
export const ALL_CATEGORIES = [
  "precip", "et", "soil", "tws", "runoff", "snow",
  "tair", "vpd", "energy", "wind", "ndvi", "sst",
] as const satisfies readonly CategoryId[];

// 若 contracts 新增類別而這裡沒有加，這行會編譯失敗。
type _MissingCategory = Exclude<CategoryId, (typeof ALL_CATEGORIES)[number]>;
const _exhaustive: [_MissingCategory] extends [never] ? true : never = true;
void _exhaustive;

/** 模型機率 ≥ 門檻就預先勾選（eval.md 依 10 個測試事件調整）。 */
export const SELECT_THRESHOLD = 0.5;

/** 一條規則：任一個樣式出現在事件文字中，就勾選這些類別。 */
export interface KeywordRule {
  /** 規則名稱（除錯、eval 用）。 */
  id: string;
  /** 中文直接比對子字串；英文以單字邊界比對、不分大小寫。 */
  zh: string[];
  en: string[];
  categories: CategoryId[];
}

/**
 * 中英文關鍵字表。先列「事件」規則（一個事件帶出多個類別），再列「變數名稱」規則
 * （使用者直接說出某個量）。中文同時收繁體與常見簡體寫法。
 */
export const KEYWORD_RULES: KeywordRule[] = [
  // ---- 事件 ----
  {
    id: "drought",
    zh: ["乾旱", "干旱", "旱災", "旱灾", "大旱", "旱象", "缺水", "少雨", "枯水", "限水", "停灌"],
    en: ["drought", "droughts", "dry spell", "water shortage", "water crisis", "megadrought"],
    categories: ["precip", "soil", "tws", "ndvi"],
  },
  {
    id: "flood",
    zh: ["洪水", "水災", "水灾", "淹水", "洪災", "洪灾", "氾濫", "泛滥", "豪雨", "暴雨", "強降雨", "强降雨", "土石流", "泥石流", "潰堤", "溃堤"],
    en: ["flood", "floods", "flooding", "inundation", "heavy rain", "torrential", "deluge", "extreme rainfall", "flash flood", "landslide"],
    categories: ["precip", "runoff", "soil", "tws"],
  },
  {
    id: "heatwave",
    zh: ["熱浪", "热浪", "高溫", "高温", "酷暑", "極端高溫", "热穹", "熱穹", "熱圓頂"],
    en: ["heatwave", "heat wave", "heat waves", "heat dome", "extreme heat", "record heat", "scorching"],
    categories: ["tair", "vpd", "energy", "soil"],
  },
  {
    id: "wildfire",
    zh: ["野火", "山火", "森林火災", "森林火灾", "林火", "大火", "火災季", "黑色夏季"],
    en: ["wildfire", "wildfires", "bushfire", "bushfires", "forest fire", "fire season", "black summer", "megafire"],
    categories: ["precip", "soil", "tair", "vpd", "wind", "ndvi"],
  },
  {
    id: "blizzard",
    zh: ["暴雪", "暴風雪", "暴风雪", "大雪", "雪災", "雪灾", "寒潮", "寒流", "冰風暴", "冰风暴", "霸王級寒流"],
    en: ["blizzard", "blizzards", "snowstorm", "snow storm", "winter storm", "ice storm", "cold wave", "cold snap", "polar vortex", "deep freeze"],
    categories: ["snow", "tair", "precip", "wind"],
  },
  {
    id: "tropical-cyclone",
    zh: ["颱風", "台风", "台風", "颶風", "飓风", "氣旋", "气旋", "熱帶風暴", "热带风暴"],
    en: ["typhoon", "typhoons", "hurricane", "hurricanes", "cyclone", "cyclones", "tropical storm"],
    categories: ["precip", "wind", "runoff", "sst"],
  },
  {
    id: "enso",
    zh: ["聖嬰", "圣婴", "厄爾尼諾", "厄尔尼诺", "反聖嬰", "拉尼娜", "反圣婴", "聖嬰現象"],
    en: ["el nino", "el niño", "la nina", "la niña", "enso"],
    categories: ["sst", "precip", "tair"],
  },
  {
    id: "monsoon",
    zh: ["季風", "季风", "梅雨", "雨季"],
    en: ["monsoon", "rainy season", "plum rain", "meiyu"],
    categories: ["precip", "runoff", "soil"],
  },
  {
    id: "snowmelt",
    zh: ["融雪", "融冰", "冰川", "冰河", "雪線"],
    en: ["snowmelt", "glacier", "glaciers", "glacial", "melt season"],
    categories: ["snow", "tair", "runoff", "tws"],
  },
  {
    id: "marine-heat",
    zh: ["海洋熱浪", "海洋热浪", "珊瑚白化", "海水暖化"],
    en: ["marine heatwave", "coral bleaching", "ocean warming", "blob"],
    categories: ["sst", "tair"],
  },
  {
    id: "crop",
    zh: ["歉收", "饑荒", "饥荒", "糧食", "粮食", "農業", "农业", "作物", "收成", "蝗災"],
    en: ["crop failure", "harvest", "famine", "agricultural", "crops", "food crisis", "locust"],
    categories: ["ndvi", "precip", "soil"],
  },
  {
    id: "dust",
    zh: ["沙塵暴", "沙尘暴", "沙塵", "沙尘"],
    en: ["dust storm", "dust bowl", "sandstorm", "haboob"],
    categories: ["wind", "soil", "precip"],
  },
  // ---- 變數名稱 ----
  {
    id: "v-precip",
    zh: ["降雨", "雨量", "降水", "下雨", "降雪量"],
    en: ["rain", "rainfall", "precipitation", "rainy"],
    categories: ["precip"],
  },
  {
    id: "v-et",
    zh: ["蒸散", "蒸發", "蒸发"],
    en: ["evapotranspiration", "evaporation", "transpiration"],
    categories: ["et"],
  },
  {
    id: "v-soil",
    zh: ["土壤", "土壤水", "土壤濕度"],
    en: ["soil", "soil moisture"],
    categories: ["soil"],
  },
  {
    id: "v-tws",
    zh: ["地下水", "儲水", "储水", "蓄水", "水庫", "水库", "水資源", "陸地水"],
    en: ["groundwater", "aquifer", "water storage", "grace", "reservoir", "reservoirs"],
    categories: ["tws"],
  },
  {
    id: "v-runoff",
    zh: ["逕流", "径流", "河川", "河水", "河流", "流量", "溪流"],
    en: ["runoff", "streamflow", "river", "rivers", "discharge"],
    categories: ["runoff"],
  },
  {
    id: "v-snow",
    zh: ["積雪", "积雪", "雪量", "下雪", "降雪"],
    en: ["snow", "snowpack", "snowfall", "snow water"],
    categories: ["snow"],
  },
  {
    id: "v-tair",
    zh: ["氣溫", "气温", "溫度", "温度", "炎熱", "炎热", "低溫", "低温", "暖冬", "酷寒", "嚴寒", "暖化"],
    en: ["temperature", "temperatures", "heat", "hot", "cold", "warm", "warming", "freezing"],
    categories: ["tair"],
  },
  {
    id: "v-vpd",
    zh: ["濕度", "湿度", "乾燥", "干燥", "飽和差"],
    en: ["humidity", "vapor pressure deficit", "vapour pressure deficit", "vpd", "dry air"],
    categories: ["vpd"],
  },
  {
    id: "v-energy",
    zh: ["輻射", "辐射", "日照", "太陽能", "太阳能", "陽光", "阳光"],
    en: ["radiation", "sunshine", "solar", "sunlight", "net radiation"],
    categories: ["energy"],
  },
  {
    id: "v-wind",
    zh: ["風速", "风速", "強風", "强风", "大風", "大风", "狂風", "風暴", "风暴"],
    en: ["wind", "winds", "windstorm", "gale", "gust", "storm"],
    categories: ["wind"],
  },
  {
    id: "v-ndvi",
    zh: ["植被", "植物", "森林", "綠度", "绿度", "草原", "樹木", "树木", "枯黃", "枯黄"],
    en: ["vegetation", "ndvi", "greenness", "forest", "forests", "plants", "greening", "browning"],
    categories: ["ndvi"],
  },
  {
    id: "v-sst",
    zh: ["海溫", "海温", "海表溫度", "海表温度", "海水溫度", "海面溫度", "海洋"],
    en: ["sea surface temperature", "sst", "ocean temperature", "ocean"],
    categories: ["sst"],
  },
];

/** 沒有任何關鍵字命中時預先勾選的類別（最常用的兩個，讓使用者自己再改）。 */
export const DEFAULT_CATEGORIES: CategoryId[] = ["precip", "tair"];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 把 ñ 這類變音字母也算進單字字元，"el niño" 才能正確比對。
const compiledRules = KEYWORD_RULES.map((rule) => ({
  rule,
  en: rule.en.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${rule.en.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "iu")
    : null,
}));

/** 事件文字命中的規則 id（eval 與除錯用）。 */
export function matchedRules(event: string): string[] {
  const text = event.normalize("NFC");
  return compiledRules
    .filter(({ rule, en }) => rule.zh.some((k) => text.includes(k)) || (en !== null && en.test(text)))
    .map(({ rule }) => rule.id);
}

/** 關鍵字投票：命中的類別 p = 1，其餘 p = 0；都沒命中時勾 DEFAULT_CATEGORIES。 */
export function keywordVotes(event: string): CategoryVote[] {
  const ids = new Set(matchedRules(event));
  const hit = new Set<CategoryId>();
  for (const rule of KEYWORD_RULES) if (ids.has(rule.id)) rule.categories.forEach((c) => hit.add(c));
  const chosen = hit.size ? hit : new Set(DEFAULT_CATEGORIES);
  return ALL_CATEGORIES.map((category) => {
    const on = chosen.has(category);
    return { category, p: on ? 1 : 0, selected: on };
  });
}

/** 完整的關鍵字備案回應。瀏覽器在 API 不存在（靜態部署）時直接呼叫這個。 */
export function keywordSelect(event: string): SelectResponse {
  return { votes: keywordVotes(event), suggestedTime: suggestedTime(event), source: "keyword-fallback" };
}

// ---------------------------------------------------------------------------
// 時間建議
// ---------------------------------------------------------------------------

const MONTHS_EN: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_EN = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const YEAR = "((?:19|20)\\d{2})";
const NB = "(?<!\\d)"; // 前面不是數字（避免抓到 b4-4040046370 這類 id 的片段）
const NA = "(?!\\d)";
const DASH = "\\s*(?:-|–|—|~|～|〜|至|到|to|through|until|thru)\\s*";

const ZH_MONTH_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
};
const ZH_M = "(1[0-2]|0?[1-9]|十[一二]?|[一二三四五六七八九])";

function ym(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}
function zhMonth(s: string): number {
  return ZH_MONTH_NUM[s] ?? Number(s);
}
function enMonth(s: string): number {
  return MONTHS_EN[s.toLowerCase().replace(/\.$/, "")] ?? NaN;
}
function range(y1: number, m1: number, y2: number, m2: number): TimeRange | null {
  if (!(m1 >= 1 && m1 <= 12 && m2 >= 1 && m2 <= 12)) return null;
  // 「2020 年 11 月到 2 月」這種跨年的寫法：結束月較小就算到隔年。
  if (y2 === y1 && m2 < m1) y2 += 1;
  if (y2 * 12 + m2 < y1 * 12 + m1) return null;
  return { start: ym(y1, m1), end: ym(y2, m2) };
}

const SEASONS: { zh: string[]; en: string[]; months: [number, number] }[] = [
  // 只收兩字詞：單字「夏」會誤中「夏威夷」。
  { zh: ["春季", "春天", "春旱"], en: ["spring"], months: [3, 5] },
  { zh: ["夏季", "夏天", "夏旱"], en: ["summer"], months: [6, 8] },
  { zh: ["秋季", "秋天"], en: ["autumn", "fall"], months: [9, 11] },
  // 冬季跨年：「2021 冬季」取 2020-12..2021-02（例如 2021 年 2 月德州寒流）。
  { zh: ["冬季", "冬天", "暖冬"], en: ["winter"], months: [12, 2] },
];

/**
 * 從事件文字抽取建議期間。支援（依優先順序）：
 * - 中文：`2021 年 2 月到 5 月`、`2021年2-5月`、`2020 年 11 月至 2021 年 2 月`、`2021 年 2 月`
 * - 數字：`2021-02..2021-05`、`2021-02 to 2021-05`、`2021/02`、`2021-02`
 * - 英文：`Feb–May 2021`、`February 2021`、`2021 February`、`Nov 2020 to Feb 2021`
 * - 年份區間：`2019–20`、`2019-2020`、`2019 到 2020 年`
 * - 單一年份（可帶季節，例如「2021 春季」→ 2021-03..2021-05）；無月份時為全年。
 * 解析不到年份時回傳 null。
 */
export function suggestedTime(event: string): TimeRange | null {
  const t = event.normalize("NFKC"); // 全形數字、全形波浪號轉半形
  let m: RegExpMatchArray | null;

  // 中文：YYYY 年 M 月 [到 [YYYY 年] M 月]
  m = t.match(new RegExp(`${NB}${YEAR}\\s*年\\s*${ZH_M}\\s*月?(?:${DASH}(?:${YEAR}\\s*年\\s*)?${ZH_M}\\s*月)?`));
  if (m && (m[0].includes("月") || m[4])) {
    const y1 = Number(m[1]);
    const m1 = zhMonth(m[2]);
    if (m[4]) return range(y1, m1, m[3] ? Number(m[3]) : y1, zhMonth(m[4]));
    if (m[0].includes("月")) return range(y1, m1, y1, m1);
  }

  // 數字：YYYY-MM [.. YYYY-MM]
  const NUM_YM = `${YEAR}\\s*[-/.]\\s*(1[0-2]|0[1-9]|[1-9])${NA}`;
  m = t.match(new RegExp(`${NB}${NUM_YM}(?:\\s*(?:\\.\\.|-|–|—|~|～|至|到|to|through|until)\\s*${NUM_YM})?`, "i"));
  // 月份的樣式要求後面不是數字，所以「2019-20」不會被當成 20 月，而是交給下面的年份區間。
  if (m) {
    if (m[3]) return range(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
    return range(Number(m[1]), Number(m[2]), Number(m[1]), Number(m[2]));
  }

  // 英文：Mon [YYYY] – Mon YYYY，或 Mon YYYY，或 YYYY Mon
  m = t.match(new RegExp(`(?<![a-z])${MONTH_EN}(?:\\s+${YEAR})?${DASH}${MONTH_EN}\\s+${YEAR}${NA}`, "i"));
  if (m) {
    const y2 = Number(m[4]);
    const y1 = m[2] ? Number(m[2]) : y2;
    return range(y1, enMonth(m[1]), y2, enMonth(m[3]));
  }
  m = t.match(new RegExp(`(?<![a-z])${MONTH_EN},?\\s+${YEAR}${NA}`, "i"));
  if (m) return range(Number(m[2]), enMonth(m[1]), Number(m[2]), enMonth(m[1]));
  m = t.match(new RegExp(`${NB}${YEAR},?\\s+${MONTH_EN}(?![a-z])`, "i"));
  if (m) return range(Number(m[1]), enMonth(m[2]), Number(m[1]), enMonth(m[2]));

  // 年份區間：2019–20、2019-2020、2019 到 2020
  m = t.match(new RegExp(`${NB}${YEAR}\\s*年?${DASH}((?:19|20)?\\d{2})${NA}`, "i"));
  if (m) {
    const y1 = Number(m[1]);
    const y2 = m[2].length === 2 ? Math.floor(y1 / 100) * 100 + Number(m[2]) : Number(m[2]);
    if (y2 > y1 && y2 - y1 <= 30) return { start: ym(y1, 1), end: ym(y2, 12) };
  }

  // 單一年份（＋季節）；多個年份取最早到最晚。
  const years = [...t.matchAll(new RegExp(`${NB}${YEAR}${NA}`, "g"))].map((x) => Number(x[1]));
  if (!years.length) return null;
  const y1 = Math.min(...years);
  const y2 = Math.max(...years);
  if (y1 === y2) {
    const lower = t.toLowerCase();
    for (const s of SEASONS) {
      const hit = s.zh.some((k) => t.includes(k)) ||
        s.en.some((k) => new RegExp(`(?<![a-z])${k}(?![a-z])`).test(lower));
      if (hit) {
        const [a, b] = s.months;
        return b < a ? { start: ym(y1 - 1, a), end: ym(y1, b) } : { start: ym(y1, a), end: ym(y1, b) };
      }
    }
  }
  return { start: ym(y1, 1), end: ym(y2, 12) };
}
