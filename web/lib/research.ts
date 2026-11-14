export interface Period {
  start: string;
  end: string;
}
export type Datum = number | null;
export type MetadataRecord = Record<string, unknown>;
export interface Source {
  id?: string;
  title?: string;
  url?: string;
  statement?: string;
}
export interface PresetRef {
  id: string;
  version: string;
}
export interface Preset extends PresetRef {
  phenomenon_query: string;
  region_id: string;
  region_name: string;
  period: Period;
  reason: string;
  source?: string;
  score?: number;
  components?: MetadataRecord;
}
export interface ResearchRequest {
  phenomenon_query: string;
  region_id: string | null;
  period: Period | null;
  context: { parent_research_id: string | null; preset_ref: PresetRef | null };
}
export interface SelectionItem {
  variable_id: string;
  label?: string;
  role: string;
  reason: string;
  scientific_refs?: Source[];
  catalogue_ref?: string;
}
export interface HistorySeries {
  times: string[];
  values: Datum[];
  anomalies: Datum[];
  fitted: Datum[];
}
export interface Trend {
  slope_per_year: Datum;
  slope_per_decade: Datum;
  ci_95: [number, number] | null;
  interval_scope: string;
  p_raw: Datum;
  p_adjusted: Record<string, Datum>;
  primary_family_id?: string;
  significant: boolean | null;
  method: string;
  lag?: number;
  n_valid?: number;
  coverage?: number;
  diagnostics?: string[];
}
export interface Baseline extends MetadataRecord {
  baseline_id?: string;
  version?: string;
  start?: string;
  end?: string;
  rule?: string;
  minimum_samples?: number;
  counts?: number[];
}
export interface Analysis {
  status: string;
  reason?: string;
  label: string;
  unit?: string;
  requested_period?: Period | null;
  analysis_period?: Period | null;
  actual_support?: {
    start?: string;
    end?: string;
    n_valid?: number;
    n_expected?: number;
    coverage?: number;
  } | null;
  full_history?: HistorySeries | null;
  seasonal_pattern?: Datum[];
  baseline?: Baseline | null;
  trend?: Trend | null;
}
export interface VariableResult extends Analysis {
  variable_id: string;
  role?: string;
  selection_reason?: string;
  product?:
    | (MetadataRecord & {
        selected_product_id?: string;
        label?: string;
        fallback_reason?: string;
        fallback?: boolean;
      })
    | null;
  scientific_refs?: Source[];
}
export interface Indicator {
  indicator_id?: string;
  kind: string;
  label?: string;
  status: string;
  reason?: string;
  recipe?: MetadataRecord & {
    standard_refs?: Source[];
    version?: string;
    interpretation?: string;
    computation?: string;
    aggregation?: string;
    event_rule?: string;
    calibration_reference?: { start?: string; end?: string; version?: string };
  };
  evidence_source?: {
    inputs?: Record<string, string>;
    event?: { catalogue_id?: string; version?: string } | null;
  };
  metrics?: (Analysis & { metric_id: string })[];
  events?: MetadataRecord[];
}
export interface EvidenceFamily extends MetadataRecord {
  family_id: string;
  scope: string;
  method?: string;
  tested_count?: number;
  candidate_count?: number;
}
export interface ResearchResult {
  identity: { id: string; status: string; created_at: string; [key: string]: unknown };
  user_constraints: Omit<ResearchRequest, "context">;
  selection: { phenomenon?: string; variable_set?: SelectionItem[]; [key: string]: unknown };
  resolved: {
    region_id: string | null;
    region_name?: string;
    region_source?: string;
    period?: Period | null;
    period_source?: string;
    preset?: Preset | null;
  };
  comparison: { period?: Period | null; variable_ids?: string[]; reason?: string };
  baselines?: unknown;
  variables: VariableResult[];
  indicators: Indicator[];
  evidence_families: EvidenceFamily[];
  summary: { text: string; evidence_ids?: string[] }[];
  warnings: string[];
}
export interface ResearchError {
  code: string;
  message: string;
  retryable?: boolean;
  field?: string;
  evidence_family?: EvidenceFamily;
}
export interface Job {
  request?: ResearchRequest;
  id: string;
  status: string;
  stage: string;
  completed?: number;
  total?: number;
  result?: ResearchResult | null;
  error?: ResearchError | null;
}
export interface ResearchCatalogue {
  regions: { id: string; name: string; type: string; series_available: boolean }[];
  variables: {
    variable_id: string;
    label: string;
    description?: string;
    unit?: string;
    scientific_refs?: Source[];
  }[];
  products?: (MetadataRecord & { product_id: string; label?: string; scientific_refs?: Source[] })[];
  recipes?: MetadataRecord[];
  curated_phenomena?: string[];
  selector?: { mode: string; custom_queries_available: boolean };
  presets?: Preset[];
  versions?: MetadataRecord;
}

export function validateMonths({ start, end }: Period, optional: boolean): string {
  if (!start && !end && optional) return "";
  if (!start || !end) {
    return optional
      ? "Enter both months, or clear both to use a preset period."
      : "Choose both months and enter a four-digit year for each.";
  }
  const validMonth = /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/;
  if (!validMonth.test(start) || !validMonth.test(end)) {
    return "Choose both months and enter a four-digit year from 0001 to 9999 for each.";
  }
  return start > end ? "The start month must be on or before the end month." : "";
}

export function periodText(period?: { start?: string; end?: string } | null) {
  return period?.start && period.end ? `${period.start} – ${period.end}` : "Unavailable";
}
export function words(value?: string | null) {
  return value ? value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) : "Unavailable";
}
export function numberText(value?: Datum) {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  if (value !== 0 && Math.abs(value) < 0.0001) return value.toExponential(3);
  return value.toLocaleString("en-US", { maximumSignificantDigits: 5 });
}

export class RequestError extends Error {
  detail: ResearchError;
  constructor(detail: ResearchError) {
    super(detail.message);
    this.detail = detail;
  }
}
export async function researchApi<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new RequestError({
      code: "service_unavailable",
      message: "The research service could not be reached. Check the connection and try again.",
      retryable: true,
    });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body == null) {
    const detail = body?.error ?? body?.detail ?? body;
    throw new RequestError(
      typeof detail?.message === "string"
        ? detail
        : {
            code: "service_unavailable",
            message: `The research service returned an unreadable response (HTTP ${response.status}).`,
            retryable: true,
          },
    );
  }
  return body as T;
}
export function errorDetail(error: unknown): ResearchError {
  return error instanceof RequestError
    ? error.detail
    : {
        code: "invalid_response",
        message: error instanceof Error ? error.message : "The research response could not be read.",
        retryable: true,
      };
}
