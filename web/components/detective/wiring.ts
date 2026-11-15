// Integration seam of workstream C: the only file that names the other workstreams' modules.
//
// Until A, B, D and E are on main, every export below is a stand-in written against contracts.ts only
// (docs/INTEGRATION.md §0 rule 3). At integration (§3 step 4) point each export at the real module, adapt the
// adapter if its shape differs, then delete ./standins/. Nothing else in workstream C imports a stand-in directly.
//
//   analysis       A  @/lib/detective/analysis        (AnalysisApi: decompose, intervalStats, trendStats)
//   VariableTab    B  @/components/detective/VariableTab
//   keywordVotes   D  @/lib/detective/keywords         (browser-side fallback when /api/select-variables fails)
//   PRESETS        E  @/lib/detective/presets
//   CATEGORIES     E  @/lib/detective/categories
import type { ComponentType } from "react";
import type {
  AnalysisApi, CategoryId, Decomposition, IntervalStats, LayerId, PresetEvent, SelectResponse, TimeRange, TrendStats,
} from "@/lib/detective/contracts";
import { standinAnalysis } from "./standins/analysis";
import { STANDIN_CATEGORIES } from "./standins/categories";
import { standinKeywordVotes } from "./standins/keywords";
import { STANDIN_PRESETS } from "./standins/presets";
import StandinVariableTab from "./standins/VariableTab";

/* ------------------------------------------------------------------ what C needs from E */

/** One of the 12 categories, as shown in the picker and on the tabs. */
export interface CategoryInfo {
  id: CategoryId;
  /** short English name, e.g. "Precipitation" */
  name: string;
  nameZh: string;
  /** one plain sentence for students (SPEC §4); also the question text D asks the model */
  plain: string;
  plainZh: string;
}

/* ------------------------------------------------------------------ what C hands to B */

/** Layer metadata for one tab (from variables.json). `caveat` must be shown when not null. */
export interface VariableMeta {
  category: CategoryId;
  /** category name and plain definition (E) */
  name: string;
  definition: string;
  layer: LayerId;
  /** layer name from the catalogue */
  layerName: string;
  product: string;
  unit: string;
  /** false for NOAA products: name the agency */
  nasa: boolean;
  caveat: string | null;
}

export interface VariableTabProps {
  meta: VariableMeta;
  /** A's decomposition of the whole series (baseline = all months outside event ± pad) */
  decomposition: Decomposition;
  event: TimeRange;
  padMonths: number;
  /** A's intervalStats over the event period (for the conclusion card) */
  eventStats: IntervalStats;
  /** A's trendStats over the whole series (for the collapsed trend panel) */
  trend: TrendStats;
  /** A's intervalStats bound to this decomposition, for the user's own selection on the chart */
  intervalStats: (range: TimeRange) => IntervalStats;
  /** hypothesis from a preset event, when the query is one */
  expected?: "high" | "low";
}

/* ------------------------------------------------------------------ exports (swap at integration) */

export const analysis: AnalysisApi = standinAnalysis;
export const VariableTab: ComponentType<VariableTabProps> = StandinVariableTab;
export const keywordVotes: (event: string) => SelectResponse = standinKeywordVotes;
export const PRESETS: readonly PresetEvent[] = STANDIN_PRESETS;
export const CATEGORIES: Readonly<Record<CategoryId, CategoryInfo>> = STANDIN_CATEGORIES;

/** true while any export above is still a stand-in; the page shows a small "development build" note */
export const USING_STANDINS = true;
