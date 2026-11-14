"""Shared result and API contracts for the Earth System Trend Detective.

This module is the single source of truth for every structure that crosses a
module boundary or the HTTP API (docs/earth-system-data-contracts.md §9).
The front-end mirrors it in web/lib/research/types.ts.

Rules
- Implementations may ADD optional fields; they must not rename or remove fields
  or change meanings. Flag any addition in the hand-off.
- Missing values are ``None`` (JSON null). Zero is a valid number. NaN/Infinity
  must never be serialised (see ``json_safe``).
- Months are "YYYY-MM"; periods are inclusive on both ends.
- Every period carries its purpose in the field name: requested / resolved /
  comparison / analysis / actual_support / full_history / baseline.
"""
from __future__ import annotations

import math
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# --------------------------------------------------------------------------- enums

FieldSource = Literal["user", "preset"]
Role = Literal["core_indicator", "related_condition", "response"]
DataKind = Literal["continuous", "count", "index", "categorical", "static"]

#: status of one data item (variable / indicator / metric); separate from job status
ItemStatus = Literal[
    "ok",
    "data_required",          # asset not delivered yet (pending)
    "insufficient_data",      # delivered, but not enough for this region/period
    "insufficient_baseline",  # fixed reference period not supported by the data
    "not_applicable",         # no scientifically meaningful quantity for this case
    "definition_required",    # no approved standard recipe exists
    "unsupported_resolution", # cadence / calendar / unit / kind not supported
    "no_common_period",
    "no_series",              # region has a boundary but no prepared series
]

JobStatus = Literal["queued", "running", "complete", "partial", "failed", "cancelled"]
JobStage = Literal[
    "validating", "selecting_variables", "resolving_defaults", "resolving_products",
    "analyzing", "correcting", "explaining", "complete",
]
STAGES: tuple[str, ...] = (
    "validating", "selecting_variables", "resolving_defaults", "resolving_products",
    "analyzing", "correcting", "explaining", "complete",
)

#: main significance label. "undetermined" (inference not applicable) is NOT "not_significant".
SignificanceLabel = Literal["significant", "not_significant", "undetermined", "provisional"]
FamilyScope = Literal["query", "preset_search"]
IndicatorKind = Literal["derived_indicator", "recorded_event"]
Completeness = Literal["complete", "partial", "unknown"]


class Model(BaseModel):
    model_config = ConfigDict(extra="allow")


# --------------------------------------------------------------------------- basics

class Period(Model):
    """Inclusive month range."""
    start: str  # YYYY-MM
    end: str    # YYYY-MM


class ScientificRef(Model):
    ref_id: str
    title: str
    url: Optional[str] = None
    doi: Optional[str] = None
    applies_to: Optional[str] = None      # what statement this reference supports
    curated_version: Optional[str] = None


class Diagnostic(Model):
    code: str                              # stable machine code, e.g. "gap_concentrated"
    severity: Literal["info", "warning", "blocking"]
    message: str


class Warning_(Model):
    code: str
    message: str
    subject: Optional[str] = None          # variable_id / indicator_id / "selection" / ...


class ApiError(Model):
    code: str                              # stable code, see errors.py
    message: str
    retryable: bool = False
    fields: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- request

class PresetRef(Model):
    id: str
    version: str


class RequestContext(Model):
    parent_research_id: Optional[str] = None
    preset_ref: Optional[PresetRef] = None


class RequestOptions(Model):
    #: explicit re-selection: ask the model again and create a new selection plan
    reselect: bool = False


class ResearchRequest(Model):
    phenomenon_query: str
    #: ONLY values the user picked with the region selector
    region_id: Optional[str] = None
    #: ONLY values the user picked with the period selector / time-series brush
    period: Optional[Period] = None
    context: RequestContext = Field(default_factory=RequestContext)
    options: RequestOptions = Field(default_factory=RequestOptions)


class UserConstraints(Model):
    phenomenon_query: str
    region_id: Optional[str] = None
    period: Optional[Period] = None


# --------------------------------------------------------------------------- selection plan

class SelectedVariable(Model):
    variable_id: str
    role: Role
    reason: str                            # must be traceable to catalogue text
    catalogue_refs: list[str] = Field(default_factory=list)   # ref_ids / context ids


class SelectorInfo(Model):
    provider: str                          # "anthropic" | "claude_cli" | "catalogue_lexical" | ...
    model: Optional[str] = None
    prompt_version: str
    is_language_model: bool


class SelectionPlan(Model):
    selection_plan_id: str
    content_hash: str
    phenomenon_query: str                  # as typed
    normalized_query: str
    phenomenon_label: str
    status: Literal["ok", "partial", "unsupported_phenomenon"]
    variable_set: list[SelectedVariable]
    indicator_recipe_ids: list[str] = Field(default_factory=list)
    #: questions this plan cannot answer with the catalogue (shown to the user)
    unanswerable: list[str] = Field(default_factory=list)
    #: place/date words seen in the text that were deliberately NOT used as constraints
    ignored_text_constraints: list[str] = Field(default_factory=list)
    catalogue_version: str
    indicator_registry_version: str
    selector: SelectorInfo
    created_at: str
    reused: bool = False                   # set on the copy returned in a result


# --------------------------------------------------------------------------- resolved plan

class ResolvedRegion(Model):
    id: str
    name: str
    type: str
    geometry_ref: Optional[str] = None
    geometry_version: Optional[str] = None
    source: FieldSource


class ResolvedPeriod(Model):
    start: str
    end: str
    source: FieldSource


class ScoreComponents(Model):
    relevance: Optional[float] = None
    effect: Optional[float] = None
    quality: Optional[float] = None
    stability: Optional[float] = None


class PresetScore(Model):
    total: float
    components: ScoreComponents
    weights: dict[str, float]
    missing_components: list[str] = Field(default_factory=list)
    missing_rule: Optional[str] = None
    policy_version: str


class PresetReason(Model):
    text: str
    evidence_ids: list[str] = Field(default_factory=list)   # hypothesis ids / data facts


class Preset(Model):
    preset_id: str
    version: str
    source: Literal["automatic", "manual"]
    selection_plan_id: str
    variable_ids: list[str]
    indicator_ids: list[str] = Field(default_factory=list)
    region_id: str
    period: Period
    score: Optional[PresetScore] = None
    reasons: list[PresetReason] = Field(default_factory=list)
    rank: Optional[int] = None
    pinned: bool = False
    manual_note: Optional[str] = None
    family_id: Optional[str] = None          # preset-search family
    search_complete: bool = False
    dataset_version: str
    method_policy_version: str
    preset_policy_version: str


class ResolvedBlock(Model):
    region: Optional[ResolvedRegion] = None
    period: Optional[ResolvedPeriod] = None
    #: preset that filled the blanks (None when both fields came from the user)
    preset: Optional[Preset] = None
    #: "no_matching_preset" detail when a blank could not be filled
    preset_status: Literal["not_needed", "applied", "no_matching_preset", "opened"] = "not_needed"
    preset_missing: list[str] = Field(default_factory=list)   # which field could not be filled
    preset_reason: Optional[str] = None


# --------------------------------------------------------------------------- products / baselines

class ProductDecision(Model):
    variable_id: str
    selected_product_id: Optional[str] = None
    product_label: Optional[str] = None
    agency: Optional[str] = None
    priority_rank: Optional[int] = None       # 1 = primary
    fallback: bool = False
    fallback_reason: Optional[str] = None     # why every higher-priority product was not applicable
    rejected: list[dict[str, Any]] = Field(default_factory=list)  # [{product_id, rank, reason}]
    available_period: Optional[Period] = None  # product bounds in this region
    coverage: Optional[float] = None           # valid share inside the analysis period
    quality_flags: list[str] = Field(default_factory=list)
    status: ItemStatus = "ok"
    status_reason: Optional[str] = None
    source_refs: list[ScientificRef] = Field(default_factory=list)
    caveat: Optional[str] = None


class BaselineInfo(Model):
    baseline_id: str
    version: str
    kind: Literal["seasonal_reference", "calibration_reference"]
    start: str
    end: str
    rule: str
    #: "wmo_standard_normal" only for a full 1991-2020 style 30-year normal; otherwise "registered_reference_mean"
    designation: Literal["wmo_standard_normal", "registered_reference_mean", "recipe_calibration"]
    minimum_samples: int
    #: valid samples per season position (12 values for monthly data)
    samples_per_position: list[int] = Field(default_factory=list)
    actual_support: Optional[Period] = None
    status: ItemStatus = "ok"
    status_reason: Optional[str] = None
    refs: list[ScientificRef] = Field(default_factory=list)
    applies_to: list[str] = Field(default_factory=list)   # variable / indicator ids


# --------------------------------------------------------------------------- trend

class Interval(Model):
    lo: float
    hi: float


class TrendMethod(Model):
    estimator: str                 # "ols"
    covariance: Optional[str]      # e.g. "hac_bartlett_calendar_lag"; None when descriptive only
    lag: Optional[int] = None
    lag_policy: Optional[str] = None
    seasonal_adjustment: str       # "fixed_baseline_monthly_anomaly" | "none_annual" | "none_standardised"
    policy_version: str


class TrendResult(Model):
    hypothesis_id: str
    metric_id: str                 # e.g. "anomaly_linear_trend", "spi3.drought_months_per_year"
    unit: str
    #: descriptive slope in original units; present whenever a slope can be described
    slope_per_year: Optional[float] = None
    slope_per_decade: Optional[float] = None
    intercept: Optional[float] = None          # fitted value at analysis_period.start
    ci95_per_decade: Optional[Interval] = None  # None when inference is not applicable
    ci_level: float = 0.95
    interval_scope: Literal["pointwise"] = "pointwise"
    p_raw: Optional[float] = None
    #: adjusted p per family id (query family and, if any, preset-search family)
    p_adjusted: dict[str, float] = Field(default_factory=dict)
    primary_family_id: Optional[str] = None
    significant: Optional[bool] = None          # None = undetermined, never "not significant"
    significance_label: SignificanceLabel = "undetermined"
    inference_status: Literal["ok", "not_applicable"] = "not_applicable"
    inference_reason: Optional[str] = None
    method: TrendMethod
    n_valid: int
    n_expected: int
    coverage: float
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    #: only when the variable definition approves a denominator; otherwise None
    relative_change_per_decade_pct: Optional[float] = None
    relative_change_basis: Optional[str] = None


class ActualSupport(Model):
    start: Optional[str] = None     # first valid sample inside the analysis period
    end: Optional[str] = None
    n_valid: int = 0
    n_expected: int = 0
    coverage: float = 0.0
    longest_gap: int = 0


class SeriesBlock(Model):
    """Full-history arrays on one explicit time axis. null = missing (drawn as a break)."""
    cadence: Literal["monthly", "annual"]
    times: list[str]                         # YYYY-MM or YYYY
    raw: list[Optional[float]]
    #: fixed-baseline seasonal pattern, 12 values (Jan..Dec); None for annual series
    seasonal_cycle: Optional[list[Optional[float]]] = None
    anomaly: Optional[list[Optional[float]]] = None
    #: fitted line over the analysis period only, aligned to `times` (null outside it)
    fit: Optional[list[Optional[float]]] = None
    quality_flags: Optional[list[Optional[str]]] = None


class VariableResult(Model):
    variable_id: str
    label: str
    label_zh: Optional[str] = None
    description: Optional[str] = None
    role: Role
    reason: str
    catalogue_refs: list[ScientificRef] = Field(default_factory=list)
    unit: Optional[str] = None
    data_kind: Optional[DataKind] = None
    temporal_support: Optional[str] = None
    status: ItemStatus
    status_reason: Optional[str] = None
    product: ProductDecision
    baseline_id: Optional[str] = None
    requested_period: Optional[Period] = None     # the user's period, verbatim, or None
    analysis_period: Optional[Period] = None      # window the fit used (resolved period)
    actual_support: Optional[ActualSupport] = None
    full_history: Optional[Period] = None
    in_comparison: bool = False
    comparison_exclusion_reason: Optional[str] = None
    series: Optional[SeriesBlock] = None
    trend: Optional[TrendResult] = None
    limitations: list[str] = Field(default_factory=list)
    display: dict[str, Any] = Field(default_factory=dict)   # display_semantics from the catalogue


# --------------------------------------------------------------------------- indicators / events

class DerivedEvent(Model):
    event_id: str
    start: str
    end: Optional[str] = None
    duration_months: Optional[int] = None
    severity: Optional[float] = None
    peak: Optional[float] = None
    censoring: list[str] = Field(default_factory=list)   # "left", "right", "gap", "ongoing"


class IndicatorMetric(Model):
    metric_id: str                # "<indicator_id>.<metric>", distinct hypothesis per metric
    label: str
    unit: str
    cadence: Literal["monthly", "annual"]
    status: ItemStatus
    status_reason: Optional[str] = None
    series: Optional[SeriesBlock] = None
    trend: Optional[TrendResult] = None
    aggregation_rule: Optional[str] = None
    limitations: list[str] = Field(default_factory=list)


class IndicatorResult(Model):
    indicator_id: str
    version: Optional[str] = None
    label: str
    kind: IndicatorKind
    status: ItemStatus
    status_reason: Optional[str] = None
    phenomenon_applicability: Optional[str] = None
    standard_refs: list[ScientificRef] = Field(default_factory=list)
    definition: Optional[str] = None            # formula / thresholds / event rule in words
    interpretation: Optional[str] = None        # what it can / cannot represent
    #: derived_indicator: input product; recorded_event: None
    input_product: Optional[ProductDecision] = None
    calibration_baseline_id: Optional[str] = None
    #: recorded_event: catalogue provenance
    event_catalogue_id: Optional[str] = None
    event_catalogue_version: Optional[str] = None
    event_coverage: Optional[dict[str, Any]] = None   # {completeness, start, end, known_gaps, policy_version}
    requested_period: Optional[Period] = None
    analysis_period: Optional[Period] = None
    full_history: Optional[Period] = None
    metrics: list[IndicatorMetric] = Field(default_factory=list)
    events: list[DerivedEvent] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- evidence families

class HypothesisRecord(Model):
    hypothesis_id: str
    #: components that make the id (region, geometry version, period, metric, variable/indicator,
    #: product or event catalogue, dataset/coverage version, baseline, recipe, method policy)
    components: dict[str, Any]
    p_raw: Optional[float] = None
    p_adjusted: Optional[float] = None
    significant: Optional[bool] = None
    tested: bool = True
    untested_reason: Optional[str] = None


class EvidenceFamily(Model):
    family_id: str
    scope: FamilyScope
    candidate_policy: dict[str, Any]         # pre-declared policy (id, version, description)
    method: str                              # "benjamini_yekutieli"
    alpha: float
    n_candidates: int
    n_tested: int
    n_untested: int
    complete: bool
    #: full list, or a sample plus `external_ref` when large
    hypotheses: list[HypothesisRecord] = Field(default_factory=list)
    hypotheses_truncated: bool = False
    external_ref: Optional[str] = None       # locator of the stored full record
    content_hash: Optional[str] = None
    created_at: Optional[str] = None


# --------------------------------------------------------------------------- result

class Identity(Model):
    research_id: str
    created_at: str
    status: JobStatus
    dataset_version: str
    catalogue_version: str
    region_catalogue_version: str
    indicator_registry_version: str
    method_policy_version: str
    preset_policy_version: str
    quality_policy_version: str
    engine_version: str
    selection_plan_id: Optional[str] = None
    parent_research_id: Optional[str] = None
    preset_ref: Optional[PresetRef] = None
    cache_key: Optional[str] = None


class ComparisonBlock(Model):
    status: Literal["ok", "no_common_period", "single_variable", "not_available"]
    period: Optional[Period] = None
    eligible_variable_ids: list[str] = Field(default_factory=list)
    excluded: list[dict[str, Any]] = Field(default_factory=list)   # [{variable_id, reason}]
    sample_support: dict[str, ActualSupport] = Field(default_factory=dict)
    note: Optional[str] = None


class SummaryStatement(Model):
    text: str
    evidence_ids: list[str] = Field(default_factory=list)


class SummaryBlock(Model):
    status: Literal["ok", "unavailable"]
    statements: list[SummaryStatement] = Field(default_factory=list)
    generator: dict[str, Any] = Field(default_factory=dict)   # {kind: "template"|"model", version}
    unavailable_reason: Optional[str] = None


class ResearchResult(Model):
    identity: Identity
    user_constraints: UserConstraints
    selection: Optional[SelectionPlan] = None
    resolved: ResolvedBlock = Field(default_factory=ResolvedBlock)
    comparison: Optional[ComparisonBlock] = None
    baselines: list[BaselineInfo] = Field(default_factory=list)
    variables: list[VariableResult] = Field(default_factory=list)
    indicators: list[IndicatorResult] = Field(default_factory=list)
    evidence_families: list[EvidenceFamily] = Field(default_factory=list)
    summary: Optional[SummaryBlock] = None
    warnings: list[Warning_] = Field(default_factory=list)
    #: True while the correction family is incomplete: labels are "provisional"
    provisional: bool = False


class JobProgress(Model):
    completed: int = 0
    total: int = 0


class ResearchJob(Model):
    research_id: str
    status: JobStatus
    stage: JobStage
    progress: JobProgress = Field(default_factory=JobProgress)
    stage_detail: Optional[str] = None
    error: Optional[ApiError] = None
    request: ResearchRequest
    result: Optional[ResearchResult] = None
    created_at: str
    updated_at: str


# --------------------------------------------------------------------------- helpers

def json_safe(obj: Any) -> Any:
    """Recursively replace NaN / +-Infinity with None so the API never emits them."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    try:  # numpy scalars
        import numpy as np
        if isinstance(obj, np.generic):
            return json_safe(obj.item())
        if isinstance(obj, np.ndarray):
            return json_safe(obj.tolist())
    except Exception:  # pragma: no cover
        pass
    return obj
