import type { CategoryId, Decomposition, LayerId, TrendStats } from "@/lib/detective/contracts";
import type { BaselineInfo, IntervalDetail } from "@/lib/detective/intervalDetail";
import type { Span } from "./model";

/** Display metadata for one variable (built by `variableMetadata` from categories.ts + variables.json). */
export interface VariableMeta {
  category: CategoryId;
  layer: LayerId;
  /** English name of the quantity, e.g. "Soil moisture" */
  name: string;
  /** one plain-language sentence */
  definition: string;
  /** product, e.g. "GPM IMERG monthly" */
  product: string;
  unit: string;
  /** must be shown when not null */
  caveat: string | null;
}

export interface LaneReady {
  kind: "ready";
  meta: VariableMeta;
  d: Decomposition;
  /** absolute month index (ymIndex) of d.months[0] */
  base: number;
  baseline: BaselineInfo;
  trend: TrendStats;
  /** first and last month of the record, absolute */
  record: Span;
  /** the product does not cover the event period */
  outside: boolean;
}

export type LaneResult =
  | { kind: "loading" }
  | { kind: "nodata"; reason: string | null }
  | { kind: "error"; message: string }
  | LaneReady;

export interface LaneModel {
  c: CategoryId;
  name: string;
  res: LaneResult;
  /** statistics of the current selection; null unless ready */
  detail: IntervalDetail | null;
  expected?: "high" | "low";
  polarity: "cool" | "warm";
  /** monthly products available here, and the one in use */
  choices: LayerId[];
  layer: LayerId | null;
}

/** colour of an anomaly of sign `positive` for a variable whose high values read `polarity` */
export const anomalyColor = (positive: boolean, polarity: "cool" | "warm") =>
  positive === (polarity === "cool") ? "var(--viz-cool)" : "var(--viz-warm)";
