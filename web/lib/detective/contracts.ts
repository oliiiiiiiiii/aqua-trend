// Earth System Trend Detective — 共用介面約定（所有工作線都依此實作）。
// 規格：/SPEC.md　整合說明：/docs/INTEGRATION.md
// 修改本檔需在 PR 說明中標註「contract change」，並同步更新 INTEGRATION.md。

/** 月份字串 "YYYY-MM"。 */
export type YearMonth = string;

/** 變數類別 id，對應 web/public/data/catalog/variables.json 的 category_default_layer 鍵。 */
export type CategoryId =
  | "precip" | "et" | "soil" | "tws" | "runoff" | "snow"
  | "tair" | "vpd" | "energy" | "wind" | "ndvi" | "sst"
  // 工作線 F 新增（2026-11-15）：aod（MERRA-2 AOD）、ozone（MERRA-2 TO3）、
  // vapor（MERRA-2 可降水量）、so2（MSAQSO2L4 點源年排放）、fire（MODIS FIRMS 火點數）
  | "aod" | "ozone" | "vapor" | "so2" | "fire";

/** 資料層 id，對應 variables.json 的 layers 鍵（例如 "p_imerg"、"sm_root"）。 */
export type LayerId = string;

/** basin4 子流域 id，例如 "b4-4040046370"。MVP 只接受 b4- 開頭。 */
export type RegionId = string;

export interface TimeRange {
  start: YearMonth;
  /** 含當月。 */
  end: YearMonth;
}

// ---------------------------------------------------------------------------
// 輸入（Step 0）
// ---------------------------------------------------------------------------

/** 完整的偵探查詢狀態；全部序列化進 URL（見 encodeQuery / decodeQuery）。 */
export interface DetectiveQuery {
  /** E：自然語言事件描述。 */
  event: string;
  /** T：事件期間。 */
  time: TimeRange;
  /** L：子流域。 */
  region: RegionId;
  /** 使用者勾選的變數類別（Step 1 結果，可被使用者修改）。 */
  categories: CategoryId[];
  /** 每個類別實際使用的資料層；未指定時用 category_default_layer。 */
  layers?: Partial<Record<CategoryId, LayerId>>;
  /** 事件前後顯示的月數，預設 12，範圍 3–60。 */
  padMonths?: number;
  /** 目前開啟的變數分頁。 */
  active?: CategoryId;
}

/** 預設事件（工作線 E 維護於 web/lib/detective/presets.ts）。 */
export interface PresetEvent extends DetectiveQuery {
  id: string;
  title: string;
  /** 給學生看的一句話背景。 */
  blurb: string;
  /** 每個類別預期的異常方向（作為「假說」）。 */
  expected: Partial<Record<CategoryId, "high" | "low">>;
}

// ---------------------------------------------------------------------------
// Step 1：事件 → 變數（工作線 D）
// ---------------------------------------------------------------------------

/** POST /api/select-variables 的請求內容。 */
export interface SelectRequest {
  event: string;
}

export interface CategoryVote {
  category: CategoryId;
  /** 模型回答「有關」的機率，0–1。關鍵字備案時為 1 或 0。 */
  p: number;
  /** 是否預先勾選（p >= 門檻）。 */
  selected: boolean;
}

/** POST /api/select-variables 的回應。 */
export interface SelectResponse {
  votes: CategoryVote[];
  /** 從 E 解析出的建議時間；解析不到時為 null。 */
  suggestedTime: TimeRange | null;
  /** 實際使用的方法，畫面上要標示。 */
  source: "local-model" | "keyword-fallback";
}

// ---------------------------------------------------------------------------
// Step 2：分析（工作線 A，純函式，瀏覽器內執行）
// ---------------------------------------------------------------------------

/** 從 series-2 JSON 取出的單一資料層序列。 */
export interface MonthlySeries {
  layer: LayerId;
  start: YearMonth;
  /** null = 缺值，絕不可當 0。 */
  values: (number | null)[];
  unit: string;
}

export interface Decomposition {
  months: YearMonth[];
  raw: (number | null)[];
  /** 基準期擬合的線性趨勢，延伸到全期間。 */
  trend: number[];
  /** 季節循環（12 個月氣候值展開到全期間）。 */
  seasonal: number[];
  /** raw − trend − seasonal。 */
  residual: (number | null)[];
  /** residual / σ（σ 只用基準期殘差計算）。 */
  z: (number | null)[];
  /** 實際基準期：全期間扣除 [事件起 − pad, 事件止 + pad]。 */
  baseline: { months: YearMonth[]; excluded: TimeRange; n: number };
}

export interface IntervalStats {
  range: TimeRange;
  n: number;
  meanResidual: number | null;
  meanZ: number | null;
  /** 區間平均殘差在「全部同長度滑動區間」中的百分位，0–100。 */
  percentile: number | null;
  /** 例如「1998 年以來第 2 低」。 */
  rank: { position: number; of: number; direction: "low" | "high" } | null;
}

export interface TrendStats {
  /** 原單位／十年。 */
  senPerDecade: number | null;
  ci95: [number, number] | null;
  mkP: number | null;
  significant: boolean | null;
  /** 不顯著時，估計還需幾年資料才可能顯著；無法估計為 null。 */
  yearsToSignificance: number | null;
  nEff: number | null;
}

/** 工作線 A 必須匯出的函式簽章（web/lib/detective/analysis.ts）。 */
export interface AnalysisApi {
  decompose(series: MonthlySeries, event: TimeRange, padMonths: number): Decomposition;
  intervalStats(d: Decomposition, range: TimeRange): IntervalStats;
  trendStats(series: MonthlySeries): TrendStats;
}

// ---------------------------------------------------------------------------
// URL 狀態（工作線 C 實作於 web/lib/detective/url.ts）
// ---------------------------------------------------------------------------
// /detective?e=<event>&t=2021-02..2021-05&r=b4-4040046370&v=precip,soil,tws&pad=12&tab=precip
// 版面：/detective（輸入頁，無 r 參數時）→ 同一路由帶齊參數即顯示分析分頁。
export interface UrlCodec {
  encodeQuery(q: DetectiveQuery): string;
  decodeQuery(search: string): Partial<DetectiveQuery>;
}
