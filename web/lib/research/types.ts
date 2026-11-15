// TypeScript mirror of backend/aqua_trend/contracts.py (docs/earth-system-data-contracts.md §9).
// Rules carried over from the contract:
// - null = missing; zero is a valid number. The API never sends NaN / Infinity.
// - months are "YYYY-MM", periods are inclusive on both ends, and every period names its purpose
//   (requested / resolved / comparison / analysis / actual_support / full_history / baseline).
// - the backend may ADD optional fields (pydantic extra="allow"); nothing here may be renamed.
// The browser only displays these numbers. It never computes a slope, a p-value or a significance label.

export type FieldSource = "user" | "preset";
export type Role = "core_indicator" | "related_condition" | "response";
export type DataKind = "continuous" | "count" | "index" | "categorical" | "static";

/** status of one data item (variable / indicator / metric); separate from the job status */
export type ItemStatus =
  | "ok"
  | "data_required"
  | "insufficient_data"
  | "insufficient_baseline"
  | "not_applicable"
  | "definition_required"
  | "unsupported_resolution"
  | "no_common_period"
  | "no_series";

export type JobStatus = "queued" | "running" | "complete" | "partial" | "failed" | "cancelled";
export type JobStage =
  | "validating"
  | "selecting_variables"
  | "resolving_defaults"
  | "resolving_products"
  | "analyzing"
  | "correcting"
  | "explaining"
  | "complete";

export const STAGES: readonly JobStage[] = [
  "validating",
  "selecting_variables",
  "resolving_defaults",
  "resolving_products",
  "analyzing",
  "correcting",
  "explaining",
  "complete",
];

/** "undetermined" (inference not applicable) is NOT "not_significant". */
export type SignificanceLabel = "significant" | "not_significant" | "undetermined" | "provisional";
export type FamilyScope = "query" | "preset_search";
export type IndicatorKind = "derived_indicator" | "recorded_event";
export type Completeness = "complete" | "partial" | "unknown";

/* ------------------------------------------------------------------ basics */

export interface Period {
  start: string;
  end: string;
}

export interface ScientificRef {
  ref_id: string;
  title: string;
  url?: string | null;
  doi?: string | null;
  applies_to?: string | null;
  curated_version?: string | null;
}

export interface Diagnostic {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
}

export interface ResultWarning {
  code: string;
  message: string;
  subject?: string | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  fields: string[];
}

/* ------------------------------------------------------------------ request */

export interface PresetRef {
  id: string;
  version: string;
}

export interface RequestContext {
  parent_research_id: string | null;
  preset_ref: PresetRef | null;
}

export interface RequestOptions {
  reselect: boolean;
}

export interface ResearchRequest {
  phenomenon_query: string;
  /** ONLY a value the user picked with the region selector */
  region_id: string | null;
  /** ONLY a value the user picked with the period selector or the time-series brush */
  period: Period | null;
  context: RequestContext;
  options?: RequestOptions;
}

export interface UserConstraints {
  phenomenon_query: string;
  region_id?: string | null;
  period?: Period | null;
}

/* ------------------------------------------------------------------ selection plan */

export interface SelectedVariable {
  variable_id: string;
  role: Role;
  reason: string;
  catalogue_refs: string[];
}

export interface SelectorInfo {
  provider: string;
  model?: string | null;
  prompt_version: string;
  is_language_model: boolean;
}

export interface SelectionPlan {
  selection_plan_id: string;
  content_hash: string;
  phenomenon_query: string;
  normalized_query: string;
  phenomenon_label: string;
  status: "ok" | "partial" | "unsupported_phenomenon";
  variable_set: SelectedVariable[];
  indicator_recipe_ids: string[];
  unanswerable: string[];
  ignored_text_constraints: string[];
  catalogue_version: string;
  indicator_registry_version: string;
  selector: SelectorInfo;
  created_at: string;
  reused: boolean;
  reuse_reason?: string | null;
  served_model?: string | null;
  validation_notes?: string[] | null;
}

/* ------------------------------------------------------------------ resolved plan */

export interface ResolvedRegion {
  id: string;
  name: string;
  type: string;
  geometry_ref?: string | null;
  geometry_version?: string | null;
  source: FieldSource;
}

export interface ResolvedPeriod {
  start: string;
  end: string;
  source: FieldSource;
}

export interface ScoreComponents {
  relevance?: number | null;
  effect?: number | null;
  quality?: number | null;
  stability?: number | null;
}

export interface PresetScore {
  total: number;
  components: ScoreComponents;
  weights: Record<string, number>;
  missing_components: string[];
  missing_rule?: string | null;
  policy_version: string;
}

export interface PresetReason {
  text: string;
  evidence_ids: string[];
}

export interface Preset {
  preset_id: string;
  version: string;
  source: "automatic" | "manual";
  selection_plan_id: string;
  variable_ids: string[];
  indicator_ids: string[];
  region_id: string;
  period: Period;
  score?: PresetScore | null;
  reasons: PresetReason[];
  rank?: number | null;
  pinned: boolean;
  manual_note?: string | null;
  family_id?: string | null;
  search_complete: boolean;
  dataset_version: string;
  method_policy_version: string;
  preset_policy_version: string;
}

export interface ResolvedBlock {
  region?: ResolvedRegion | null;
  period?: ResolvedPeriod | null;
  preset?: Preset | null;
  preset_status: "not_needed" | "applied" | "no_matching_preset" | "opened";
  preset_missing: string[];
  preset_reason?: string | null;
}

/* ------------------------------------------------------------------ products / baselines */

export interface RejectedProduct {
  product_id?: string;
  rank?: number;
  reason?: string;
}

export interface ProductDecision {
  variable_id: string;
  selected_product_id?: string | null;
  product_label?: string | null;
  agency?: string | null;
  priority_rank?: number | null;
  fallback: boolean;
  fallback_reason?: string | null;
  rejected: RejectedProduct[];
  available_period?: Period | null;
  coverage?: number | null;
  quality_flags: string[];
  status: ItemStatus;
  status_reason?: string | null;
  source_refs: ScientificRef[];
  caveat?: string | null;
  /** optional extras added by the resolver */
  nasa?: boolean | null;
  product_version?: string | null;
  quality_limits?: string[] | null;
  suitability?: string | null;
}

export interface BaselineInfo {
  baseline_id: string;
  version: string;
  kind: "seasonal_reference" | "calibration_reference";
  start: string;
  end: string;
  rule: string;
  designation: "wmo_standard_normal" | "registered_reference_mean" | "recipe_calibration";
  minimum_samples: number;
  samples_per_position: number[];
  actual_support?: Period | null;
  status: ItemStatus;
  status_reason?: string | null;
  refs: ScientificRef[];
  applies_to: string[];
}

/* ------------------------------------------------------------------ trend */

export interface Interval {
  lo: number;
  hi: number;
}

export interface TrendMethod {
  estimator: string;
  covariance: string | null;
  lag?: number | null;
  lag_policy?: string | null;
  seasonal_adjustment: string;
  policy_version: string;
  stats_policy_version?: string | null;
  dof?: number | null;
  prewhiten_rho?: number | null;
  se_per_decade?: number | null;
}

export interface TrendResult {
  hypothesis_id: string;
  metric_id: string;
  unit: string;
  slope_per_year?: number | null;
  slope_per_decade?: number | null;
  intercept?: number | null;
  /** null when inference is not applicable */
  ci95_per_decade?: Interval | null;
  ci_level: number;
  interval_scope: "pointwise";
  p_raw?: number | null;
  /** adjusted p per family id */
  p_adjusted: Record<string, number>;
  primary_family_id?: string | null;
  /** null = undetermined, never "not significant" */
  significant?: boolean | null;
  significance_label: SignificanceLabel;
  inference_status: "ok" | "not_applicable";
  inference_reason?: string | null;
  method: TrendMethod;
  n_valid: number;
  n_expected: number;
  coverage: number;
  diagnostics: Diagnostic[];
  relative_change_per_decade_pct?: number | null;
  relative_change_basis?: string | null;
}

export interface ActualSupport {
  start?: string | null;
  end?: string | null;
  n_valid: number;
  n_expected: number;
  coverage: number;
  longest_gap: number;
}

/** Full-history arrays on one explicit time axis. null = missing (drawn as a break). */
export interface SeriesBlock {
  cadence: "monthly" | "annual";
  /** YYYY-MM or YYYY */
  times: string[];
  raw: (number | null)[];
  /** fixed-baseline seasonal pattern, Jan..Dec; null for annual series */
  seasonal_cycle?: (number | null)[] | null;
  anomaly?: (number | null)[] | null;
  /** fitted line over the analysis period only, aligned to `times` (null outside it) */
  fit?: (number | null)[] | null;
  quality_flags?: (string | null)[] | null;
}

export interface DisplaySemantics {
  color?: string;
  increase_reads?: string;
  decimals?: number;
  orb_channel?: string | null;
  [key: string]: unknown;
}

export interface VariableResult {
  variable_id: string;
  label: string;
  label_zh?: string | null;
  description?: string | null;
  role: Role;
  reason: string;
  catalogue_refs: ScientificRef[];
  unit?: string | null;
  data_kind?: DataKind | null;
  temporal_support?: string | null;
  status: ItemStatus;
  status_reason?: string | null;
  product: ProductDecision;
  baseline_id?: string | null;
  requested_period?: Period | null;
  analysis_period?: Period | null;
  actual_support?: ActualSupport | null;
  full_history?: Period | null;
  in_comparison: boolean;
  comparison_exclusion_reason?: string | null;
  series?: SeriesBlock | null;
  trend?: TrendResult | null;
  limitations: string[];
  display: DisplaySemantics;
  /** optional extras added by the engine */
  region_warning_zh?: string | null;
  stability_half_slopes_per_year?: (number | null)[] | null;
}

/* ------------------------------------------------------------------ indicators / events */

export interface DerivedEvent {
  event_id: string;
  start: string;
  end?: string | null;
  duration_months?: number | null;
  severity?: number | null;
  peak?: number | null;
  /** "left", "right", "gap", "ongoing" */
  censoring: string[];
}

export interface IndicatorMetric {
  metric_id: string;
  label: string;
  unit: string;
  cadence: "monthly" | "annual";
  status: ItemStatus;
  status_reason?: string | null;
  series?: SeriesBlock | null;
  trend?: TrendResult | null;
  aggregation_rule?: string | null;
  limitations: string[];
  /** optional extras */
  data_kind?: string | null;
  seasonal_adjustment?: string | null;
  in_analysis?: boolean[] | null;
  actual_support?: ActualSupport | null;
  fit_window?: Period | null;
}

export interface EventCoverage {
  completeness?: Completeness;
  start?: string | null;
  end?: string | null;
  known_gaps?: unknown;
  policy_version?: string | null;
  [key: string]: unknown;
}

export interface IndicatorResult {
  indicator_id: string;
  version?: string | null;
  label: string;
  kind: IndicatorKind;
  status: ItemStatus;
  status_reason?: string | null;
  phenomenon_applicability?: string | null;
  standard_refs: ScientificRef[];
  definition?: string | null;
  interpretation?: string | null;
  input_product?: ProductDecision | null;
  calibration_baseline_id?: string | null;
  event_catalogue_id?: string | null;
  event_catalogue_version?: string | null;
  event_coverage?: EventCoverage | null;
  requested_period?: Period | null;
  analysis_period?: Period | null;
  full_history?: Period | null;
  metrics: IndicatorMetric[];
  events: DerivedEvent[];
  limitations: string[];
  phenomenon_id?: string | null;
}

/* ------------------------------------------------------------------ evidence families */

export interface HypothesisRecord {
  hypothesis_id: string;
  components: Record<string, unknown>;
  p_raw?: number | null;
  p_adjusted?: number | null;
  significant?: boolean | null;
  tested: boolean;
  untested_reason?: string | null;
}

export interface EvidenceFamily {
  family_id: string;
  scope: FamilyScope;
  candidate_policy: Record<string, unknown>;
  method: string;
  alpha: number;
  n_candidates: number;
  n_tested: number;
  n_untested: number;
  complete: boolean;
  hypotheses: HypothesisRecord[];
  hypotheses_truncated: boolean;
  external_ref?: string | null;
  content_hash?: string | null;
  created_at?: string | null;
}

/* ------------------------------------------------------------------ result */

export interface Identity {
  research_id: string;
  created_at: string;
  status: JobStatus;
  dataset_version: string;
  catalogue_version: string;
  region_catalogue_version: string;
  indicator_registry_version: string;
  method_policy_version: string;
  preset_policy_version: string;
  quality_policy_version: string;
  engine_version: string;
  selection_plan_id?: string | null;
  parent_research_id?: string | null;
  preset_ref?: PresetRef | null;
  cache_key?: string | null;
}

export interface ComparisonExclusion {
  variable_id?: string;
  reason?: string;
}

export interface ComparisonBlock {
  status: "ok" | "no_common_period" | "single_variable" | "not_available";
  period?: Period | null;
  eligible_variable_ids: string[];
  excluded: ComparisonExclusion[];
  sample_support: Record<string, ActualSupport>;
  note?: string | null;
}

export interface SummaryStatement {
  text: string;
  evidence_ids: string[];
}

export interface SummaryBlock {
  status: "ok" | "unavailable";
  statements: SummaryStatement[];
  generator: Record<string, unknown>;
  unavailable_reason?: string | null;
}

export interface ResearchResult {
  identity: Identity;
  user_constraints: UserConstraints;
  selection?: SelectionPlan | null;
  resolved: ResolvedBlock;
  comparison?: ComparisonBlock | null;
  baselines: BaselineInfo[];
  variables: VariableResult[];
  indicators: IndicatorResult[];
  evidence_families: EvidenceFamily[];
  summary?: SummaryBlock | null;
  warnings: ResultWarning[];
  /** true while the correction family is incomplete: labels are "provisional" */
  provisional: boolean;
}

export interface JobProgress {
  completed: number;
  total: number;
}

export interface ResearchJob {
  research_id: string;
  status: JobStatus;
  stage: JobStage;
  progress: JobProgress;
  stage_detail?: string | null;
  error?: ApiErrorBody | null;
  request?: ResearchRequest | null;
  result?: ResearchResult | null;
  created_at?: string;
  updated_at?: string;
}

/** 202 body of POST /api/research */
export interface ResearchAccepted {
  research_id: string;
  status: JobStatus;
  stage: JobStage;
  progress: JobProgress;
}

/* ------------------------------------------------------------------ catalogue (GET /api/catalogue…) */

export interface CataloguePhenomenon {
  phenomenon_id: string;
  label: string;
  label_zh?: string | null;
}

/** Only the parts of the catalogue response this page reads; everything is optional so a richer response still parses. */
export interface CatalogueSummary {
  versions?: Record<string, string>;
  phenomena?: CataloguePhenomenon[];
  selector?: Partial<SelectorInfo> & { available?: boolean; reason?: string | null };
  [key: string]: unknown;
}

/** GET /api/catalogue/regions/{id} */
export interface CatalogueRegion {
  id: string;
  name: string;
  type: string;
  series_available?: boolean;
  n_products?: number;
  geometry_ref?: string | null;
  geometry_version?: string | null;
  [key: string]: unknown;
}

export const TERMINAL_STATUSES: readonly JobStatus[] = ["complete", "partial", "failed", "cancelled"];
export const isTerminal = (s: JobStatus) => TERMINAL_STATUSES.includes(s);
