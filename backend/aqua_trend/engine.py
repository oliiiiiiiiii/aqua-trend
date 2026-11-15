"""ResearchEngine: one research from request to result (spec §3, §4, §6, §7, §10).

Entry point ``ResearchEngine.run(request, catalogue_snapshot, policy_snapshot)``; the query
flow, the preset search (``analyse_candidate``) and the exports all read numbers produced by
ONE code path (``_analyse``), so a preset and the research it opens can never disagree.

Stage order (spec §10): validating → selecting_variables → resolving_defaults →
resolving_products → analyzing → correcting → explaining → complete.

Responsibilities kept here
* the request's ``region_id`` / ``period`` are the only source of user constraints; nothing in
  the query text or in the selection plan can set them (acceptance S05, P04);
* one product per concept, decided by ``PlanResolver`` before any trend exists (D03, D04);
* fixed seasonal baseline from the registered reference period only — changing the analysis
  period changes the fit and nothing else (T02); an unsupported baseline is
  ``insufficient_baseline``, never a re-computation on the query window (T07);
* every hypothesis of the research enters the query family, tested or not (T09); labels are
  attached per family, "undetermined" is never "not significant" (T12 keeps the CI pointwise);
* a pending event catalogue yields ``data_required`` and removes nothing else (E04); monthly
  precipitation is never relabelled as flood frequency (E10);
* missing values stay missing: NaN internally, ``null`` in the result, never zero or interpolated.
"""
from __future__ import annotations

import hashlib
import json
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Callable, Optional, Protocol, Sequence

import numpy as np

from . import contracts as C
from .errors import AquaError
from .indicators import IndicatorComputation, IndicatorRegistry
from .indicators import events as ev_rules
from .present import ResultPresenter
from .resolve import FLAG_PARTIAL_PERIOD, PlanResolver, period_bounds, to_ref
from .selection.plans import normalize_query
from .stats import (
    STATS_POLICY_VERSION, Climatology, EvidenceController, TrendFit, anomalies, attach_families, climatology,
    fit_trend, fit_trend_batch, half_slopes, hypothesis_components, hypothesis_id, to_trend_result,
)
from .stats.evidence import record_for
from .timeaxis import index_to_ym, is_ym, ym_to_index

ENGINE_VERSION = "engine-1.0.0"
#: metric id of the trend of a variable's fixed-baseline anomalies
VARIABLE_METRIC_ID = "anomaly_linear_trend"
VARIABLE_SEASONAL_ADJUSTMENT = "fixed_baseline_monthly_anomaly"
QUERY_FAMILY_POLICY_ID = "query_family"
_PREPARED_CACHE = 256
_COMPUTATION_CACHE = 256

StageCallback = Callable[[str, int, int, Optional[str]], None]


# --------------------------------------------------------------------------- preset protocol

@dataclass
class PresetFill:
    """What a preset engine returns for the blanks of a request (spec §8.1).

    ``region_id`` / ``period`` are the values to analyse: the user's own value for every field
    the user filled, the preset's value for a blank one.  ``status``:
    ``"applied"`` (blanks filled), ``"no_matching_preset"`` (``missing`` names the fields that
    stay blank, ``reason`` says why) or ``"opened"`` (an existing preset was opened).
    ``family`` is the FULL preset-search family of the preset, when there is one.
    """

    region_id: Optional[str] = None
    period: Optional[C.Period] = None
    preset: Optional[C.Preset] = None
    family: Optional[C.EvidenceFamily] = None
    status: str = "no_matching_preset"
    missing: list[str] = field(default_factory=list)
    reason: str = ""
    #: plan snapshot the preset engine stored with its search (used when the selector lost the plan)
    plan: Optional[C.SelectionPlan] = None


class PresetEngineProtocol(Protocol):
    """The small surface of ``aqua_trend.presets`` that the research engine calls."""

    def fill(self, plan: C.SelectionPlan, user_constraints: C.UserConstraints,
             context: C.RequestContext) -> Any:
        """Return an object with the attributes of ``PresetFill``; never change a user field."""

    # optional: ``fill_for_run(plan, user_constraints, context, cancel=, on_progress=)`` -> as ``fill``, with
    # the run's cancel signal and a progress callback ``on_progress(stage, done, total)`` (T10).
    # optional: ``open_for_run(preset_ref, cancel=, on_progress=)`` or ``open(preset_ref)`` -> PresetFill-like (status
    # "opened"); ``open_for_run`` is preferred because it may rebuild the evidence of a preset whose
    # data / policy versions changed (T16).  Without either the engine loads the preset and its
    # family from storage.


# --------------------------------------------------------------------------- analysis records

@dataclass
class PreparedVariable:
    """Full history of one product in one region with its FIXED seasonal reference (spec §7.1)."""

    series: Any                              # store.PreparedSeries
    baseline: dict[str, Any]                 # catalogue record of the registered baseline
    clim: Climatology
    anomaly: Optional[np.ndarray]            # None when the baseline is not supported
    baseline_mean: Optional[float]           # mean of the fixed monthly pattern
    anomaly_sd_baseline: Optional[float]     # sd of the anomalies inside the reference period


@dataclass
class MetricOutcome:
    """One hypothesis of a research: the trend of a variable or of one indicator metric."""

    kind: str                                # "variable" | "derived_indicator" | "recorded_event"
    item_id: str                             # variable_id or indicator_id
    metric_id: str
    unit: str
    cadence: str
    status: str
    status_reason: Optional[str]
    components: dict[str, Any]
    hypothesis_id: str
    record: C.HypothesisRecord
    seasonal_adjustment: str
    data_kind: str = "continuous"
    product_id: Optional[str] = None
    fit: Optional[TrendFit] = None
    trend: Optional[C.TrendResult] = None
    #: descriptive first-half / second-half slopes per year (stability check of the method policy)
    half_slopes: tuple[Optional[float], Optional[float]] = (None, None)
    #: sd of the fixed-baseline anomalies in the reference period (variables only; preset effect scale)
    scale_sd: Optional[float] = None
    #: native time axis, values and the positions that entered the fit (full mode and tests)
    t: Optional[np.ndarray] = None
    values: Optional[np.ndarray] = None
    in_analysis: Optional[np.ndarray] = None


@dataclass
class VariableOutcome:
    selected: C.SelectedVariable
    decision: C.ProductDecision
    status: str
    status_reason: Optional[str]
    prepared: Optional[PreparedVariable]
    metric: Optional[MetricOutcome]
    relative_note: Optional[str] = None

    @property
    def variable_id(self) -> str:
        return self.selected.variable_id


@dataclass
class IndicatorOutcome:
    indicator_id: str
    kind: str
    status: str
    status_reason: Optional[str]
    decision: Optional[C.ProductDecision]
    computation: IndicatorComputation        # full-history computation (period-independent values)
    metrics: list[MetricOutcome] = field(default_factory=list)
    phenomenon_id: Optional[str] = None


@dataclass
class CandidateAnalysis:
    """Trend-level results of one (plan, region, period) — no series blocks."""

    region_id: str
    period: C.Period
    decisions: list[C.ProductDecision]
    recipe_decisions: dict[str, C.ProductDecision]
    variables: list[VariableOutcome]
    indicators: list[IndicatorOutcome]

    def metrics(self) -> list[MetricOutcome]:
        out = [v.metric for v in self.variables if v.metric is not None]
        for ind in self.indicators:
            out.extend(ind.metrics)
        return out

    def records(self) -> list[C.HypothesisRecord]:
        """Every hypothesis of the candidate, tested or not (the family must hold them all)."""
        return [m.record for m in self.metrics()]


# --------------------------------------------------------------------------- helpers

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _nullable(values: Any) -> list[Optional[float]]:
    """NaN / Infinity -> None (JSON null); zero stays zero."""
    return [float(v) if np.isfinite(v) else None for v in np.asarray(values, dtype=np.float64)]


def _is_cancelled(cancel: Any) -> bool:
    if cancel is None:
        return False
    if hasattr(cancel, "is_set"):
        return bool(cancel.is_set())
    return bool(cancel())


def _digest(payload: Any) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class _Progress:
    """Stage reporting and cancellation for one run."""

    def __init__(self, on_stage: Optional[StageCallback], cancel: Any):
        self._on_stage, self._cancel = on_stage, cancel
        self.cancel = lambda: _is_cancelled(cancel)           # handed to a preset search
        self.stage = C.STAGES[0]

    def enter(self, stage: str, completed: int = 0, total: int = 0, detail: Optional[str] = None) -> None:
        self.check()
        self.stage = stage
        self.report(completed, total, detail)

    def report(self, completed: int, total: int, detail: Optional[str] = None) -> None:
        if self._on_stage is not None:
            self._on_stage(self.stage, completed, total, detail)

    def check(self) -> None:
        if _is_cancelled(self._cancel):
            raise AquaError("cancelled", "The research was cancelled before its correction family was complete; "
                                         "no final significance label was published.")


# --------------------------------------------------------------------------- engine

class ResearchEngine:
    """Shared analysis engine for queries, preset search and exports (spec §4)."""

    def __init__(self, store: Any, selector: Any, indicators: Optional[IndicatorRegistry] = None,
                 preset_engine: Optional[PresetEngineProtocol] = None, storage: Any = None):
        self.store = store
        self.selector = selector
        self.indicators = indicators if indicators is not None else IndicatorRegistry(store)
        self.preset_engine = preset_engine
        self.storage = storage
        self.resolver = PlanResolver(store, self.indicators)
        self.presenter = ResultPresenter()
        self._prepared: OrderedDict[tuple[str, str], PreparedVariable] = OrderedDict()
        self._computations: OrderedDict[tuple[str, str, Optional[str]], IndicatorComputation] = OrderedDict()
        self._lock = threading.RLock()                         # jobs may share one engine across threads

    # ------------------------------------------------------------------ versions

    @property
    def method_policy(self) -> dict:
        return self.store.policy("method_policy")

    def catalogue_snapshot(self) -> str:
        """Snapshot id of data + catalogue (fixed for the duration of one job, spec §4)."""
        return self.store.snapshot_id()

    def policy_snapshot(self) -> str:
        """Snapshot id of every policy / code version that can change a number."""
        v = self.store.versions
        return "pol-" + _digest([v["method_policy_version"], v["preset_policy_version"], v["quality_policy_version"],
                                 STATS_POLICY_VERSION, ENGINE_VERSION])[:16]

    def cache_key(self, request: C.ResearchRequest, plan: C.SelectionPlan) -> str:
        """Hash of everything that can change the numbers of a result (spec §10)."""
        ctx = request.context
        v = self.store.versions
        return "rk-" + _digest({
            "query": normalize_query(request.phenomenon_query or ""),
            "region_id": request.region_id,
            "period": request.period.model_dump() if request.period else None,
            "parent_research_id": ctx.parent_research_id,
            "preset_ref": ctx.preset_ref.model_dump() if ctx.preset_ref else None,
            "selection_plan_content_hash": plan.content_hash,
            "snapshot_id": self.store.snapshot_id(),
            "policy_versions": [v["method_policy_version"], v["preset_policy_version"], v["quality_policy_version"],
                                STATS_POLICY_VERSION],
            "engine_version": ENGINE_VERSION,
        })[:32]

    # ------------------------------------------------------------------ prepared data (cached)

    def prepared(self, region_id: str, product_id: str) -> Optional[PreparedVariable]:
        """Full history + fixed seasonal reference of one product; ``None`` without a series.

        The monthly pattern is computed on the REGISTERED reference period only (T02); when the
        data do not support it the anomalies are ``None`` (T07) — nothing is re-computed on an
        analysis window.
        """
        key = (region_id, product_id)
        with self._lock:
            hit = self._prepared.get(key)
            if hit is not None:
                self._prepared.move_to_end(key)
                return hit
        series = self.store.series(region_id, product_id)
        base = self.store.baseline_for(series.variable_id, product_id) if series is not None else None
        if series is None or base is None:
            return None
        clim = climatology(series.t, series.values, base["start"], base["end"], int(base["minimum_samples"]))
        anomaly = mean = sd = None
        if clim.ok:
            anomaly = anomalies(series.t, series.values, clim.cycle)
            mean = float(np.mean(clim.cycle))
            inside = anomaly[(series.t >= clim.base_start) & (series.t <= clim.base_end)]
            inside = inside[np.isfinite(inside)]
            sd = float(np.std(inside, ddof=1)) if inside.size > 1 else None
        out = PreparedVariable(series=series, baseline=base, clim=clim, anomaly=anomaly,
                               baseline_mean=mean, anomaly_sd_baseline=sd)
        with self._lock:
            self._prepared[key] = out
            while len(self._prepared) > _PREPARED_CACHE:
                self._prepared.popitem(last=False)
        return out

    def _computation(self, indicator_id: str, region_id: str, product_id: Optional[str]) -> IndicatorComputation:
        """Full-history indicator computation (values do not depend on the analysis period, E09)."""
        key = (indicator_id, region_id, product_id)
        with self._lock:
            hit = self._computations.get(key)
            if hit is not None:
                self._computations.move_to_end(key)
                return hit
        series = self.store.series(region_id, product_id) if product_id else None
        comp = self.indicators.compute(indicator_id, series=series, region_id=region_id, analysis_period=None)
        with self._lock:
            self._computations[key] = comp
            while len(self._computations) > _COMPUTATION_CACHE:
                self._computations.popitem(last=False)
        return comp

    # ------------------------------------------------------------------ hypothesis identity

    def _components(self, region_id: str, period: C.Period, metric_id: str, **more: Any) -> dict[str, Any]:
        region = self.store.region(region_id)
        v = self.store.versions
        return hypothesis_components(
            region_id=region_id,
            geometry_version=region.get("geometry_version") or f"no-geometry@{v['region_catalogue_version']}",
            analysis_period={"start": period.start, "end": period.end}, metric_id=metric_id,
            dataset_version=v["dataset_version"], method_policy_version=v["method_policy_version"], **more)

    @staticmethod
    def _untested(components: dict[str, Any], reason: str) -> C.HypothesisRecord:
        return C.HypothesisRecord(hypothesis_id=hypothesis_id(components), components=components,
                                  tested=False, untested_reason=reason)

    # ------------------------------------------------------------------ fitting

    def _fit(self, t: np.ndarray, y: np.ndarray, *, cadence: str, data_kind: str, period: tuple[int, int],
             light: bool, fixed_lag: Optional[int] = None) -> TrendFit:
        """The one place where a trend is fitted (spec §7.2). ``light`` skips informational diagnostics only."""
        if light:
            return fit_trend_batch(t, np.asarray(y, dtype=np.float64)[None, :], cadence=cadence,
                                   policy=self.method_policy, data_kind=data_kind, period=period,
                                   fixed_lag=fixed_lag).row(0)
        return fit_trend(t, y, cadence=cadence, policy=self.method_policy, data_kind=data_kind, period=period,
                         fixed_lag=fixed_lag)

    def _fit_index(self, t: np.ndarray, y: np.ndarray, period: tuple[int, int], scale: int,
                   light: bool) -> tuple[TrendFit, Optional[str]]:
        """Monthly accumulated-index metric: HAC lag at least ``scale - 1`` or no inference.

        ``method_policy.monthly_index_metric``: a k-month index is autocorrelated by construction
        over k-1 months.  Returns the fit and, when the lag was raised, a label for the lag policy.
        """
        fit = self._fit(t, y, cadence="monthly", data_kind="index", period=period, light=light)
        need = max(int(scale) - 1, 0)
        if fit.inference_status != "ok" or (fit.lag or 0) >= need:
            return fit, None
        rule = self.method_policy["monthly_index_metric"]["rule"]
        refit = self._fit(t, y, cadence="monthly", data_kind="index", period=period, light=light, fixed_lag=need)
        if refit.inference_status == "ok" and (refit.lag or 0) >= need:
            refit.diagnostics.append(C.Diagnostic(
                code="index_overlap_lag", severity="warning",
                message=(f"HAC lag raised from {fit.lag} to {need} months because consecutive values of a "
                         f"{scale}-month index share {need} months ({rule}). This lag is larger than the one the "
                         "calibration study evaluated; read the interval and p-value with caution.")))
            return refit, f"{refit.lag_policy}+min_lag_{need}"
        reason = (f"the HAC lag of at least {need} months required for a {scale}-month accumulated index "
                  "cannot be reached with the data inside the analysis period; inference is not applicable")
        blocked = replace(
            refit, ci95_per_decade=None, p_raw=None, inference_status="not_applicable", inference_reason=reason,
            reason_code="index_overlap_lag_unavailable", lag=None, covariance=None, se_per_decade=None, dof=None,
            prewhiten_rho=None,
            diagnostics=[*refit.diagnostics, C.Diagnostic(code="index_overlap_lag_unavailable", severity="blocking",
                                                          message=reason)])
        return blocked, None

    def _trend(self, fit: TrendFit, components: dict[str, Any], *, metric_id: str, unit: str,
               seasonal_adjustment: str, lag_label: Optional[str] = None,
               relative: tuple[Optional[float], Optional[str]] = (None, None)) -> C.TrendResult:
        trend = to_trend_result(fit, hypothesis_id=hypothesis_id(components), metric_id=metric_id, unit=unit,
                                seasonal_adjustment=seasonal_adjustment, policy=self.method_policy,
                                relative_change_per_decade_pct=relative[0], relative_change_basis=relative[1])
        ok = fit.inference_status == "ok"
        method = trend.method.model_copy(update={
            "stats_policy_version": STATS_POLICY_VERSION,
            "lag_policy": lag_label or trend.method.lag_policy,
            "dof": fit.dof if ok else None, "prewhiten_rho": fit.prewhiten_rho if ok else None,
            "se_per_decade": fit.se_per_decade if ok else None})
        return trend.model_copy(update={"method": method})

    def _relative_change(self, concept: dict, prep: PreparedVariable,
                         fit: TrendFit) -> tuple[Optional[float], Optional[str], Optional[str]]:
        """(percent per decade, basis, note-when-omitted) — spec §7.2, acceptance T13.

        A percentage exists only when the concept registers a denominator AND the policy rule
        holds; °C, anomalies and near-zero means never get one.
        """
        registered = concept.get("relative_change")
        if not registered or fit.slope_per_decade is None:
            return None, None, None
        rule = self.method_policy["relative_change"]
        mean, sd = prep.baseline_mean, prep.anomaly_sd_baseline
        if registered.get("denominator") != "fixed_baseline_mean":
            return None, None, (f"relative change omitted: the registered denominator "
                                f"{registered.get('denominator')!r} is not implemented")
        if mean is None or not np.isfinite(mean) or mean <= 0:
            return None, None, "relative change omitted: the fixed-baseline mean is not strictly positive"
        ratio_min = float(rule["min_abs_baseline_mean_over_anomaly_sd"])
        if sd is not None and sd > 0 and abs(mean) / sd < ratio_min:
            return None, None, (f"relative change omitted: the fixed-baseline mean ({mean:.4g}) is less than "
                                f"{ratio_min:g} standard deviation(s) of the baseline anomalies ({sd:.4g}); "
                                "a percentage would not be meaningful")
        basis = (f"100 × slope per decade ÷ mean of the fixed seasonal baseline {prep.baseline['baseline_id']} "
                 f"({mean:.6g} {prep.series.unit}, {prep.baseline['start']}..{prep.baseline['end']})")
        return 100.0 * fit.slope_per_decade / mean, basis, None

    # ------------------------------------------------------------------ analysis core

    def analyse_candidate(self, plan: C.SelectionPlan, region_id: str, period: Any,
                          decisions: Optional[Sequence[C.ProductDecision]] = None, *,
                          light: bool = True) -> CandidateAnalysis:
        """Trend-level results and hypothesis records of one candidate, without series blocks.

        This is the reusable core for the preset search: it is cheap (cached series, baselines
        and index computations; no informational diagnostics when ``light``) and it is the same
        code path ``run()`` uses, so its slopes, intervals, p-values and hypothesis ids are the
        ones a research on the same region and period reports.
        """
        bounds = period_bounds(period)
        if bounds is None:
            raise AquaError("invalid_period", "A candidate needs an analysis period.", fields=["period"])
        resolved = C.Period(start=index_to_ym(bounds[0]), end=index_to_ym(bounds[1]))
        decisions = list(decisions) if decisions is not None else \
            self.resolver.resolve_products(plan, region_id, resolved)
        return self._analyse(plan, region_id, resolved, decisions, light=light)

    def _analyse(self, plan: C.SelectionPlan, region_id: str, period: C.Period,
                 decisions: Sequence[C.ProductDecision], *, light: bool,
                 progress: Optional[_Progress] = None) -> CandidateAnalysis:
        by_var = {d.variable_id: d for d in decisions}
        recipe_decisions = self.resolver.resolve_recipe_inputs(plan, region_id, period, decisions)
        units = [("variable", v) for v in plan.variable_set]
        units += [("recipe", rid) for rid in plan.indicator_recipe_ids]
        units += [("recorded", pid) for pid in self.recorded_phenomena(plan)]
        variables: list[VariableOutcome] = []
        indicators: list[IndicatorOutcome] = []
        for done, (kind, item) in enumerate(units):
            if progress is not None:
                progress.check()
                progress.report(done, len(units), item.variable_id if kind == "variable" else str(item))
            if kind == "variable":
                variables.append(self._analyse_variable(item, by_var[item.variable_id], region_id, period, light))
            elif kind == "recipe":
                indicators.append(self._analyse_recipe(item, recipe_decisions, region_id, period, light))
            else:
                indicators.append(self._analyse_recorded(item, region_id, period, light))
        if progress is not None:
            progress.report(len(units), len(units), None)
        return CandidateAnalysis(region_id=region_id, period=period, decisions=list(decisions),
                                 recipe_decisions=recipe_decisions, variables=variables, indicators=indicators)

    def _analyse_variable(self, selected: C.SelectedVariable, decision: C.ProductDecision, region_id: str,
                          period: C.Period, light: bool) -> VariableOutcome:
        """Fixed-baseline anomaly trend of one variable on its ONE resolved product (spec §7.1–§7.2)."""
        concept = self.store.concept(selected.variable_id)
        approved = concept.get("approved_product_ids") or []
        product_id = decision.selected_product_id
        prep = self.prepared(region_id, product_id) if product_id else None
        base = prep.baseline if prep else None
        components = self._components(
            region_id, period, VARIABLE_METRIC_ID, variable_id=selected.variable_id,
            product_id=product_id or (approved[0] if approved else "no_approved_product"),
            baseline_id=base["baseline_id"] if base else None, baseline_version=str(base["version"]) if base else None)
        unit = prep.series.unit if prep else str(concept.get("unit") or "")

        def outcome(status: str, reason: Optional[str], fit: Optional[TrendFit] = None,
                    trend: Optional[C.TrendResult] = None, note: Optional[str] = None,
                    halves: tuple = (None, None)) -> VariableOutcome:
            record = record_for(trend, components) if trend is not None else \
                self._untested(components, reason or status)
            metric = MetricOutcome(
                kind="variable", item_id=selected.variable_id, metric_id=VARIABLE_METRIC_ID, unit=unit,
                cadence="monthly", status=status, status_reason=reason, components=components,
                hypothesis_id=record.hypothesis_id, record=record,
                seasonal_adjustment=VARIABLE_SEASONAL_ADJUSTMENT,
                data_kind=str(concept.get("data_kind") or "continuous"), product_id=product_id, fit=fit, trend=trend,
                half_slopes=halves, scale_sd=prep.anomaly_sd_baseline if prep else None,
                t=prep.series.t if prep else None, values=prep.anomaly if prep else None)
            return VariableOutcome(selected=selected, decision=decision, status=status, status_reason=reason,
                                   prepared=prep, metric=metric, relative_note=note)

        if prep is None:
            return outcome(decision.status if decision.status != "ok" else "no_series",
                           decision.status_reason or "no prepared series for the selected product")
        if not prep.clim.ok:
            return outcome("insufficient_baseline", prep.clim.reason)
        bounds = period_bounds(period)
        fit = self._fit(prep.series.t, prep.anomaly, cadence="monthly",
                        data_kind=str(concept.get("data_kind") or "continuous"), period=bounds, light=light)
        if fit.n_valid == 0:
            return outcome("insufficient_data",
                           f"{product_id} has no valid month inside the analysis period {period.start}..{period.end}",
                           fit=fit)
        pct, basis, note = self._relative_change(concept, prep, fit)
        trend = self._trend(fit, components, metric_id=VARIABLE_METRIC_ID, unit=unit,
                            seasonal_adjustment=VARIABLE_SEASONAL_ADJUSTMENT, relative=(pct, basis))
        halves = half_slopes(prep.series.t, prep.anomaly, cadence="monthly", period=bounds)
        status, reason = decision.status, decision.status_reason
        if fit.slope_per_year is None:
            status, reason = "insufficient_data", fit.inference_reason
        return outcome(status, reason, fit=fit, trend=trend, note=note, halves=halves)

    def _metric_outcomes(self, comp: IndicatorComputation, region_id: str, period: C.Period, light: bool, *,
                         kind: str, base_components: dict[str, Any], scale: Optional[int],
                         blocked: Optional[tuple[str, Optional[str]]] = None) -> list[MetricOutcome]:
        """Fit every metric of an indicator on its in-analysis values (spec §7.1, §7.4; T15).

        Monthly index metrics use the months inside the analysis period; annual metrics use only
        calendar years lying completely inside it and are never de-seasonalised again.
        """
        a, b = period_bounds(period)
        out: list[MetricOutcome] = []
        for metric in comp.metrics.values():
            components = self._components(region_id, period, metric.metric_id, **base_components)
            common = dict(kind=kind, item_id=comp.indicator_id, metric_id=metric.metric_id, unit=metric.unit,
                          cadence=metric.cadence, components=components, hypothesis_id=hypothesis_id(components),
                          seasonal_adjustment=metric.seasonal_adjustment, data_kind=metric.data_kind,
                          product_id=base_components.get("product_id"))
            status, reason = blocked or (metric.status, metric.status_reason)
            if metric.t.size == 0 or (blocked is None and metric.status not in ("ok", "insufficient_data")) \
                    or (blocked is not None):
                out.append(MetricOutcome(status=status if status != "ok" else "insufficient_data",
                                         status_reason=reason,
                                         record=self._untested(components, reason or status), **common))
                continue
            if metric.cadence == "monthly":
                mask = (metric.t >= a) & (metric.t <= b)
                window = (a, b)
            else:
                mask = ev_rules.years_inside(metric.t, a, b)
                years = metric.t[mask]
                window = (int(years[0]), int(years[-1])) if years.size else None
            if window is None or not np.isfinite(metric.values[mask]).any():
                unit = "month" if metric.cadence == "monthly" else "complete calendar year"
                why = f"no valid {unit} of this metric inside the analysis period {period.start}..{period.end}"
                out.append(MetricOutcome(status="insufficient_data", status_reason=why,
                                         record=self._untested(components, why), t=metric.t, values=metric.values,
                                         in_analysis=mask, **common))
                continue
            lag_label = None
            if metric.cadence == "monthly" and scale:
                fit, lag_label = self._fit_index(metric.t, metric.values, window, scale, light)
            else:
                fit = self._fit(metric.t, metric.values, cadence=metric.cadence, data_kind=metric.data_kind,
                                period=window, light=light)
            trend = self._trend(fit, components, metric_id=metric.metric_id, unit=metric.unit,
                                seasonal_adjustment=metric.seasonal_adjustment, lag_label=lag_label)
            halves = half_slopes(metric.t, metric.values, cadence=metric.cadence, period=window)
            describable = fit.slope_per_year is not None
            out.append(MetricOutcome(status="ok" if describable else "insufficient_data",
                                     status_reason=None if describable else fit.inference_reason,
                                     record=record_for(trend, components),
                                     fit=fit, trend=trend, half_slopes=halves, t=metric.t, values=metric.values,
                                     in_analysis=mask, **common))
        return out

    def _analyse_recipe(self, indicator_id: str, recipe_decisions: dict[str, C.ProductDecision], region_id: str,
                        period: C.Period, light: bool) -> IndicatorOutcome:
        """Derived indicator on the product resolved for its input concept (E03, D10)."""
        req = self.indicators.requirements(indicator_id)
        recipe = self.indicators.recipe(indicator_id)
        decision = recipe_decisions[req["variable_id"]]
        product_id = decision.selected_product_id
        comp = self._computation(indicator_id, region_id, product_id)
        approved = self.store.concept(req["variable_id"]).get("approved_product_ids") or []
        base_components = dict(
            indicator_id=indicator_id, variable_id=req["variable_id"],
            product_id=product_id or (approved[0] if approved else "no_approved_product"),
            baseline_id=req["baseline_id"], baseline_version=str(req["baseline_version"]),
            recipe_version=str(recipe["version"]), aggregation_version=str(recipe["version"]))
        blocked = None
        if comp.status not in ("ok", "insufficient_data"):
            blocked = (comp.status, comp.status_reason)
        scale = int(recipe["computation"]["parameters"].get("scale_months", 1))
        metrics = self._metric_outcomes(comp, region_id, period, light, kind="derived_indicator",
                                        base_components=base_components, scale=scale, blocked=blocked)
        usable = any(m.status == "ok" for m in metrics)
        status = comp.status if blocked else ("ok" if usable else "insufficient_data")
        reason = comp.status_reason if blocked else (None if usable else (
            "the index is calibrated, but it has no valid month and no complete calendar year inside the "
            "analysis period; the full history is still returned"))
        return IndicatorOutcome(indicator_id=indicator_id, kind="derived_indicator", status=status,
                                status_reason=reason, decision=decision, computation=comp, metrics=metrics)

    def _analyse_recorded(self, phenomenon_id: str, region_id: str, period: C.Period,
                          light: bool) -> IndicatorOutcome:
        """Recorded-event statistics of one phenomenon; ``data_required`` while nothing is delivered (E04)."""
        try:
            comp = self.indicators.compute_recorded(phenomenon_id, region_id=region_id,
                                                    analysis_period={"start": period.start, "end": period.end})
        except AquaError as exc:
            # a defective delivery is the indicator's problem only: valid variable results stay (spec §10)
            comp = IndicatorComputation(
                indicator_id=f"recorded.{phenomenon_id}", kind="recorded_event",
                label=f"Recorded {phenomenon_id} events", status="data_required", region_id=region_id,
                analysis_period={"start": period.start, "end": period.end},
                status_reason=f"the delivered event catalogue cannot be used ({exc.message}); no event statistic "
                              "is reported and no zero count is assumed")
        registered = sorted((c for c in self.store.event_catalogues() if c.get("phenomenon_id") == phenomenon_id),
                            key=lambda c: (c.get("priority", 1 << 30), str(c.get("catalogue_id"))))
        catalogue_id = comp.event_catalogue_id or (registered[0]["catalogue_id"] if registered else "not_registered")
        base_components = dict(
            indicator_id=comp.indicator_id, event_catalogue_id=str(catalogue_id),
            coverage_version=str(comp.event_catalogue_version or "not_delivered"),
            recipe_version=str(comp.version), aggregation_version=str(comp.version))
        blocked = None if comp.status in ("ok", "insufficient_data") else (comp.status, comp.status_reason)
        metrics = self._metric_outcomes(comp, region_id, period, light, kind="recorded_event",
                                        base_components=base_components, scale=None, blocked=blocked)
        return IndicatorOutcome(indicator_id=comp.indicator_id, kind="recorded_event", status=comp.status,
                                status_reason=comp.status_reason, decision=None, computation=comp, metrics=metrics,
                                phenomenon_id=phenomenon_id)

    # ------------------------------------------------------------------ phenomena of a plan

    def plan_phenomena(self, plan: C.SelectionPlan) -> list[str]:
        """Catalogue phenomenon ids the plan's reasons point to (context ids in ``catalogue_refs``)."""
        known = [str(p.get("phenomenon_id")) for p in self.store.phenomena()]
        cited = {ref for v in plan.variable_set for ref in v.catalogue_refs}
        return [pid for pid in known if pid in cited]

    def recorded_phenomena(self, plan: C.SelectionPlan) -> list[str]:
        """Phenomena of the plan for which an event catalogue is registered (delivered or pending)."""
        registered = {c.get("phenomenon_id") for c in self.store.event_catalogues()}
        return [pid for pid in self.plan_phenomena(plan) if pid in registered]

    # ------------------------------------------------------------------ run: validation / selection

    def _check_snapshots(self, catalogue_snapshot: Optional[str], policy_snapshot: Optional[str]) -> None:
        """A job keeps one snapshot for its whole duration (spec §4)."""
        if catalogue_snapshot is not None and catalogue_snapshot != self.catalogue_snapshot():
            raise AquaError("data_release_invalid",
                            f"The job was created for data snapshot {catalogue_snapshot}, but the loaded release is "
                            f"{self.catalogue_snapshot()}; start a new research.", retryable=True)
        if policy_snapshot is not None and policy_snapshot != self.policy_snapshot():
            raise AquaError("data_release_invalid",
                            f"The job was created for policy snapshot {policy_snapshot}, but the loaded policy is "
                            f"{self.policy_snapshot()}; start a new research.", retryable=True)

    def _validate(self, request: C.ResearchRequest) -> C.UserConstraints:
        """Structured constraints only: one catalogue region id, a complete period, or blanks (spec §6 step 1)."""
        if request.region_id is not None:
            if not isinstance(request.region_id, str) or not request.region_id.strip():
                raise AquaError("unknown_region", "The region id is empty; select one region or leave it blank.",
                                fields=["region_id"])
            self.store.region(request.region_id)            # unknown id -> AquaError("unknown_region")
        if request.period is not None:
            start, end = getattr(request.period, "start", None), getattr(request.period, "end", None)
            if not start or not end:
                raise AquaError("invalid_period", "A period needs both a start and an end month; complete it or "
                                                  "clear the whole selection.", fields=["period"])
            if not (is_ym(start) and is_ym(end)):
                raise AquaError("invalid_period", "Period months must be written YYYY-MM.", fields=["period"])
            if ym_to_index(start) > ym_to_index(end):
                raise AquaError("invalid_period", "The period start is after its end.", fields=["period"])
        return C.UserConstraints(phenomenon_query=request.phenomenon_query or "", region_id=request.region_id,
                                 period=request.period.model_copy() if request.period else None)

    def _plan_is_current(self, plan: C.SelectionPlan) -> bool:
        """A saved plan can be replayed only while every id it names still exists in the catalogue."""
        concepts, recipes = self.store.concepts(), self.indicators.recipes()
        return all(v.variable_id in concepts for v in plan.variable_set) and \
            all(r in recipes for r in plan.indicator_recipe_ids)

    def _load_plan(self, selection_plan_id: Optional[str], embedded: Optional[C.SelectionPlan]) -> Optional[C.SelectionPlan]:
        """A saved plan for a numeric replay — the model is never asked again (spec §10)."""
        plan = None
        if selection_plan_id:
            try:
                plan = self.selector.load(selection_plan_id)
            except AquaError:
                plan = None
        if plan is None and embedded is not None and embedded.selection_plan_id == selection_plan_id:
            plan = embedded
        return plan.model_copy(update={"reused": True, "reuse_reason": "replay_of_saved_plan"}) if plan else None

    @staticmethod
    def _preset_hooks(progress: Optional["_Progress"]) -> dict[str, Any]:
        """Cancel signal and progress callback handed to a preset search (it can take many seconds)."""
        if progress is None:
            return {}
        return {"cancel": progress.cancel,
                "on_progress": lambda stage, done, total: progress.report(
                    done, total, f"preset search: {stage.replace('_', ' ')}")}

    def _open_preset(self, ref: C.PresetRef, progress: Optional["_Progress"] = None) -> PresetFill:
        """Load a preset and its FULL search family from the backend's own records (contract §9.1)."""
        try:
            runner = getattr(self.preset_engine, "open_for_run", None)
            opener = runner or getattr(self.preset_engine, "open", None)
            if callable(opener):
                # ``open_for_run`` may repeat a search (T16): it gets the run's cancel signal and progress
                got = runner(ref, **self._preset_hooks(progress)) if callable(runner) and progress else opener(ref)
                return PresetFill(region_id=got.region_id, period=got.period, preset=got.preset,
                                  family=got.family, status="opened", missing=[], reason=getattr(got, "reason", ""),
                                  plan=getattr(got, "plan", None))
            if self.storage is None:
                raise AquaError("invalid_context", "Presets cannot be opened: no result storage is configured.",
                                fields=["context.preset_ref"])
            preset = self.storage.load_preset(ref.id, ref.version)
            family = self.storage.load_family(preset.family_id) if preset.family_id else None
        except AquaError as exc:
            if exc.code == "invalid_context":
                raise
            raise AquaError("invalid_context", f"The referenced preset {ref.id} (version {ref.version}) cannot be "
                                               f"loaded: {exc.message}", fields=["context.preset_ref"]) from exc
        return PresetFill(region_id=preset.region_id, period=preset.period, preset=preset, family=family,
                          status="opened", reason="; ".join(r.text for r in preset.reasons))

    def _select(self, request: C.ResearchRequest, user: C.UserConstraints, warnings: list[C.Warning_],
                progress: Optional["_Progress"] = None) -> tuple[C.SelectionPlan, Optional[PresetFill], Optional[C.ResearchResult]]:
        """Selection plan of the run, plus an opened preset / parent research when the context names one."""
        ctx = request.context
        query = normalize_query(request.phenomenon_query or "")
        opened: Optional[PresetFill] = None
        parent: Optional[C.ResearchResult] = None
        if ctx.parent_research_id:
            if self.storage is None:
                raise AquaError("invalid_context", "A parent research cannot be loaded: no result storage is "
                                                   "configured.", fields=["context.parent_research_id"])
            try:
                parent = self.storage.load_result(ctx.parent_research_id)
            except AquaError as exc:
                raise AquaError("invalid_context", f"The parent research {ctx.parent_research_id} cannot be loaded: "
                                                   f"{exc.message}", fields=["context.parent_research_id"]) from exc
        if ctx.preset_ref is not None:
            opened = self._open_preset(ctx.preset_ref, progress)
            preset = opened.preset
            if user.region_id is not None and user.region_id != preset.region_id:
                raise AquaError("invalid_context",
                                f"The opened preset is for region {preset.region_id}, but the selected region is "
                                f"{user.region_id}. The selection is kept; clear the preset reference to analyse it.",
                                fields=["context.preset_ref", "region_id"])
            if user.period is not None and (user.period.start, user.period.end) != \
                    (preset.period.start, preset.period.end):
                raise AquaError("invalid_context",
                                f"The opened preset is for {preset.period.start}..{preset.period.end}, but the "
                                f"selected period is {user.period.start}..{user.period.end}. The selection is kept; "
                                "clear the preset reference to analyse it.",
                                fields=["context.preset_ref", "period"])
            plan = self._load_plan(preset.selection_plan_id, opened.plan)
            if plan is None or not self._plan_is_current(plan):
                raise AquaError("invalid_context", f"The selection plan {preset.selection_plan_id} of the opened "
                                                   "preset is not available for the current catalogue.",
                                fields=["context.preset_ref"])
            if query and query != plan.normalized_query:
                raise AquaError("invalid_context",
                                f"The opened preset was created for the phenomenon text {plan.phenomenon_query!r}; "
                                "clear the preset reference to analyse another phenomenon.",
                                fields=["context.preset_ref", "phenomenon_query"])
            return plan, opened, parent
        if parent is not None and not request.options.reselect and parent.selection is not None \
                and query == parent.selection.normalized_query:
            plan = self._load_plan(parent.identity.selection_plan_id, parent.selection)
            if plan is not None and self._plan_is_current(plan):
                return plan, None, parent
            warnings.append(C.Warning_(code="parent_plan_not_reusable", subject="selection",
                                       message="The parent research's selection plan does not match the current "
                                               "catalogue; a new plan was selected."))
        plan = self.selector.select(request.phenomenon_query, reselect=request.options.reselect)
        return plan, None, parent

    # ------------------------------------------------------------------ run: defaults

    def _resolve_defaults(self, request: C.ResearchRequest, user: C.UserConstraints, plan: C.SelectionPlan,
                          opened: Optional[PresetFill], progress: Optional["_Progress"] = None,
                          ) -> tuple[C.ResolvedBlock, Optional[PresetFill]]:
        """Keep every user field; let a preset fill only the blanks (spec §8.1; P02–P05)."""
        missing = [name for name, value in (("region_id", user.region_id), ("period", user.period)) if value is None]
        fill: Optional[PresetFill] = None
        status, reason, preset, still_missing = "not_needed", None, None, []
        region_id, period = user.region_id, user.period
        if opened is not None:
            fill, status, preset, reason = opened, "opened", opened.preset, opened.reason or None
            region_id = region_id or opened.preset.region_id
            period = period or opened.preset.period
        elif missing:
            if self.preset_engine is None:
                status, reason, still_missing = "no_matching_preset", "preset engine not configured", missing
            else:
                # ``fill_for_run`` (optional) is ``fill`` with the run's cancel signal and progress
                runner = getattr(self.preset_engine, "fill_for_run", None)
                got = runner(plan, user, request.context, **self._preset_hooks(progress)) \
                    if callable(runner) else self.preset_engine.fill(plan, user, request.context)
                fill = PresetFill(region_id=got.region_id, period=got.period, preset=got.preset, family=got.family,
                                  status=got.status, missing=list(got.missing or []), reason=got.reason or "")
                if fill.status == "applied":
                    self._check_fill(user, fill)
                    status, preset, reason = "applied", fill.preset, fill.reason or None
                    region_id, period = region_id or fill.region_id, period or fill.period
                else:
                    status, reason = "no_matching_preset", fill.reason or "no candidate matched the filled conditions"
                    still_missing = fill.missing or missing
                    fill = None
        block = C.ResolvedBlock(
            region=self._resolved_region(region_id, "user" if user.region_id is not None else "preset"),
            period=C.ResolvedPeriod(start=period.start, end=period.end,
                                    source="user" if user.period is not None else "preset") if period else None,
            preset=preset, preset_status=status, preset_missing=still_missing, preset_reason=reason)
        return block, fill

    def _check_fill(self, user: C.UserConstraints, fill: PresetFill) -> None:
        """A preset can never override a user field or return an unusable value (P06)."""
        if not fill.region_id or fill.period is None:
            raise AquaError("internal_error", "The preset engine reported 'applied' without a region and a period.")
        self.store.region(fill.region_id)
        period_bounds(fill.period)
        if user.region_id is not None and fill.region_id != user.region_id:
            raise AquaError("internal_error", "The preset engine changed the region the user selected.")
        if user.period is not None and (fill.period.start, fill.period.end) != (user.period.start, user.period.end):
            raise AquaError("internal_error", "The preset engine changed the period the user selected.")

    def _resolved_region(self, region_id: Optional[str], source: str) -> Optional[C.ResolvedRegion]:
        if region_id is None:
            return None
        region = self.store.region(region_id)
        return C.ResolvedRegion(id=region["id"], name=region["name"], type=region["type"],
                                geometry_ref=region.get("geometry_ref"),
                                geometry_version=region.get("geometry_version"), source=source,
                                name_zh=region.get("name_zh"), series_available=region.get("series_available"),
                                surface=region.get("surface"), area_km2=region.get("area_km2"))

    # ------------------------------------------------------------------ run: result building

    def _refs(self, ids: Sequence[str]) -> list[C.ScientificRef]:
        refs = self.store.refs()
        return [to_ref(refs[i]) for i in ids if i in refs]

    def _variable_base(self, selected: C.SelectedVariable, decision: C.ProductDecision,
                       user: C.UserConstraints) -> dict[str, Any]:
        concept = self.store.concept(selected.variable_id)
        product = self.store.product(decision.selected_product_id) if decision.selected_product_id else {}
        return dict(
            variable_id=selected.variable_id, label=concept.get("label") or selected.variable_id,
            label_zh=concept.get("label_zh"), description=concept.get("description"), role=selected.role,
            reason=selected.reason, catalogue_refs=self._refs(selected.catalogue_refs),
            unit=product.get("unit") or concept.get("unit"), data_kind=concept.get("data_kind"),
            temporal_support=product.get("temporal_support") or concept.get("temporal_support"),
            product=decision, requested_period=user.period, display=dict(concept.get("display_semantics") or {}),
            catalogue_context_ids=[r for r in selected.catalogue_refs if r not in self.store.refs()],
            relative_change_note=concept.get("relative_change_note"),
        )

    def _baseline_info(self, prep: PreparedVariable, variable_id: str) -> C.BaselineInfo:
        base, clim = prep.baseline, prep.clim
        support = None
        if clim.actual_start is not None:
            support = C.Period(start=index_to_ym(clim.actual_start), end=index_to_ym(clim.actual_end))
        return C.BaselineInfo(
            baseline_id=base["baseline_id"], version=str(base["version"]), kind="seasonal_reference",
            start=base["start"], end=base["end"], rule=base["rule"], designation=base["designation"],
            minimum_samples=int(base["minimum_samples"]), samples_per_position=clim.samples_per_position,
            actual_support=support, status=clim.status, status_reason=clim.reason,
            refs=self._refs(base.get("refs") or []), applies_to=[variable_id], product_id=prep.series.product_id)

    def _series_block(self, prep: PreparedVariable, fit: Optional[TrendFit],
                      bounds: Optional[tuple[int, int]]) -> C.SeriesBlock:
        """Full history on one explicit axis; the fitted line exists only inside the analysis period."""
        t = prep.series.t
        line: Optional[list[Optional[float]]] = None
        if fit is not None and bounds is not None and fit.slope_per_year is not None:
            fitted = np.full(t.shape, np.nan)
            inside = (t >= bounds[0]) & (t <= bounds[1])
            fitted[inside] = fit.fitted(t[inside])
            line = _nullable(fitted)
        return C.SeriesBlock(
            cadence="monthly", times=prep.series.times(), raw=_nullable(prep.series.values),
            seasonal_cycle=_nullable(prep.clim.cycle),
            anomaly=_nullable(prep.anomaly) if prep.anomaly is not None else None, fit=line,
            quality_flags=prep.series.quality_flags)

    @staticmethod
    def _support(fit: TrendFit) -> C.ActualSupport:
        return C.ActualSupport(
            start=index_to_ym(fit.first_valid) if fit.first_valid is not None else None,
            end=index_to_ym(fit.last_valid) if fit.last_valid is not None else None,
            n_valid=fit.n_valid, n_expected=fit.n_expected, coverage=fit.coverage, longest_gap=fit.longest_gap)

    def _region_warning(self, region_id: str, selected: C.SelectedVariable,
                        decision: C.ProductDecision) -> Optional[str]:
        """Source warning the region catalogue carries for this product / variable (zh-TW, as delivered)."""
        notes = self.store.region(region_id).get("source_warnings_zh") or {}
        channel = (self.store.concept(selected.variable_id).get("display_semantics") or {}).get("orb_channel")
        for key in (decision.selected_product_id, selected.variable_id, channel):
            if key and key in notes:
                return str(notes[key])
        return None

    def _variable_result(self, out: VariableOutcome, user: C.UserConstraints, region_id: str,
                         period: Optional[C.Period], comparison: C.ComparisonBlock) -> C.VariableResult:
        decision, prep, metric = out.decision, out.prepared, out.metric
        fields = self._variable_base(out.selected, decision, user)
        limitations: list[str] = []
        if decision.fallback and decision.fallback_reason:
            limitations.append(f"Fallback product {decision.selected_product_id} (priority "
                               f"{decision.priority_rank}) is used for the whole analysis: {decision.fallback_reason}")
        if decision.caveat:
            limitations.append(decision.caveat)
        fit = metric.fit if metric else None
        bounds = period_bounds(period)
        if fit is not None and period is not None and fit.n_valid < fit.n_expected:
            first = index_to_ym(fit.first_valid) if fit.first_valid is not None else "none"
            last = index_to_ym(fit.last_valid) if fit.last_valid is not None else "none"
            limitations.append(
                f"Requested period {period.start}..{period.end}: {fit.n_valid} of {fit.n_expected} months have data "
                f"(first {first}, last {last}, longest gap {fit.longest_gap} months). Missing months stay missing; "
                "the period was not shortened.")
        if out.status != "ok" and out.status_reason:
            limitations.append(out.status_reason)
        if out.relative_note:
            limitations.append(out.relative_note)
        if metric and metric.trend is not None:
            if metric.trend.inference_status != "ok" and metric.trend.inference_reason:
                limitations.append("Inference not applicable (descriptive slope only): "
                                   + metric.trend.inference_reason)
            limitations += [d.message for d in metric.trend.diagnostics if d.severity == "warning"]
        zh_warning = self._region_warning(region_id, out.selected, decision)
        if zh_warning:
            limitations.append("The region catalogue carries a source warning for this variable in this region "
                               "(see region_warning_zh).")
        excluded = next((e for e in comparison.excluded if e.get("variable_id") == out.variable_id), None)
        return C.VariableResult(
            **fields, status=out.status, status_reason=out.status_reason,
            baseline_id=prep.baseline["baseline_id"] if prep else None,
            analysis_period=period, actual_support=self._support(fit) if fit is not None else None,
            full_history=C.Period(start=prep.series.start, end=prep.series.end) if prep else None,
            in_comparison=out.variable_id in comparison.eligible_variable_ids,
            comparison_exclusion_reason=excluded.get("reason") if excluded else None,
            series=self._series_block(prep, fit, bounds) if prep else None,
            trend=metric.trend if metric else None, limitations=_unique(limitations),
            region_warning_zh=zh_warning,
            stability_half_slopes_per_year=list(metric.half_slopes) if metric and metric.trend else None,
        )

    def _indicator_result(self, out: IndicatorOutcome, user: C.UserConstraints, region_id: str,
                          period: C.Period) -> C.IndicatorResult:
        """Contract block of one indicator: registry description + the engine's trends per metric."""
        if out.kind == "derived_indicator":
            product_id = out.decision.selected_product_id if out.decision else None
            series = self.store.series(region_id, product_id) if product_id else None
            comp = self.indicators.compute(out.indicator_id, series=series, region_id=region_id,
                                           analysis_period={"start": period.start, "end": period.end},
                                           product_decision=out.decision)
            result = comp.to_contract(out.decision)
        else:
            comp = out.computation
            result = comp.to_contract()
        by_id = {m.metric_id: m for m in out.metrics}
        metrics: list[C.IndicatorMetric] = []
        for block in result.metrics:
            mine = by_id[block.metric_id]
            declared = getattr(block, "in_analysis", None) or []
            if mine.in_analysis is not None and declared and list(map(bool, mine.in_analysis)) != list(declared):
                raise AquaError("internal_error", f"analysis mask of {block.metric_id} differs between the indicator "
                                                  "registry and the engine")
            series_block = block.series
            if series_block is not None and mine.fit is not None and mine.fit.slope_per_year is not None:
                line = np.full(mine.t.shape, np.nan)
                inside = (mine.t >= mine.fit.t_start) & (mine.t <= mine.fit.t_end)
                line[inside] = mine.fit.fitted(mine.t[inside])
                series_block = series_block.model_copy(update={"fit": _nullable(line)})
            limitations = list(block.limitations)
            if mine.trend is not None:
                if mine.trend.inference_status != "ok" and mine.trend.inference_reason:
                    limitations.append("Inference not applicable (descriptive slope only): "
                                       + mine.trend.inference_reason)
                limitations += [d.message for d in mine.trend.diagnostics if d.severity == "warning"]
            metrics.append(block.model_copy(update={
                "status": mine.status, "status_reason": mine.status_reason, "series": series_block,
                "trend": mine.trend, "limitations": _unique(limitations),
                "actual_support": self._support(mine.fit).model_dump() if mine.fit is not None else None,
                "fit_window": _fit_window(mine)}))
        return result.model_copy(update={
            "status": out.status, "status_reason": out.status_reason, "metrics": metrics,
            "requested_period": user.period, "analysis_period": period,
            "phenomenon_id": out.phenomenon_id})

    def _no_recipe_results(self, plan: C.SelectionPlan) -> list[C.IndicatorResult]:
        """Phenomena without an approved derived recipe: a status and a reason, never a formula (E10)."""
        if plan.indicator_recipe_ids:
            return []
        out: list[C.IndicatorResult] = []
        for pid in self.plan_phenomena(plan) or ["unregistered_phenomenon"]:
            if self.store.versions.get("indicator_registry_version") == "not_delivered":
                out.append(C.IndicatorResult(
                    indicator_id=f"derived.{pid}", label=f"Standard derived indicator for {pid}",
                    kind="derived_indicator", status="data_required", phenomenon_id=pid,
                    status_reason="the indicator registry (indicators.json) has not been delivered, so no standard "
                                  "recipe can be applied; a formula is never made up at query time"))
                continue
            comp = self.indicators.derived_availability(pid)
            if comp is not None:
                out.append(comp.to_contract().model_copy(update={"phenomenon_id": pid}))
        return out

    # ------------------------------------------------------------------ run: evidence

    def _query_family(self, plan: C.SelectionPlan, analysis: CandidateAnalysis,
                      created_at: str) -> C.EvidenceFamily:
        """Query family: EVERY hypothesis of this research, BY-adjusted together (spec §7.3, T09)."""
        policy = {
            "id": QUERY_FAMILY_POLICY_ID, "version": ENGINE_VERSION,
            "description": "every variable trend and every indicator / event metric of one research: the selected "
                           "variables and recipes of the selection plan, one region, one analysis period",
            "selection_plan_content_hash": plan.content_hash, "region_id": analysis.region_id,
            "analysis_period": analysis.period.model_dump(),
        }
        controller = EvidenceController(self.method_policy)
        return controller.build_family("query", policy, analysis.records(), complete=True, created_at=created_at)

    def _search_families(self, fill: Optional[PresetFill], parent: Optional[C.ResearchResult],
                         warnings: list[C.Warning_]) -> list[C.EvidenceFamily]:
        """FULL preset-search families that may apply: the applied / opened preset's and the parent's."""
        found: dict[str, C.EvidenceFamily] = {}
        if fill is not None and fill.family is not None:
            family = fill.family
            if family.hypotheses_truncated:
                family = self._load_family(family.external_ref or family.family_id, warnings)
            if family is not None:
                found[family.family_id] = family
        for embedded in (parent.evidence_families if parent is not None else []):
            if embedded.scope != "preset_search" or embedded.family_id in found:
                continue
            family = self._load_family(embedded.external_ref or embedded.family_id, warnings) \
                if (embedded.hypotheses_truncated or self.storage is not None) else embedded
            if family is not None:
                found[family.family_id] = family
        return list(found.values())

    def _load_family(self, ref: str, warnings: list[C.Warning_]) -> Optional[C.EvidenceFamily]:
        """Families are always loaded from the backend's own record, never trusted from a request."""
        if self.storage is None:
            return None
        try:
            return self.storage.load_family(ref)
        except AquaError as exc:
            warnings.append(C.Warning_(code="search_family_unavailable", subject="evidence",
                                       message=f"The preset-search family {ref} could not be loaded ({exc.message}); "
                                               "its correction is not attached."))
            return None

    def _embed(self, family: C.EvidenceFamily, keep_ids: set[str]) -> C.EvidenceFamily:
        if self.storage is None:
            return family
        return self.storage.embed_family(family, keep_ids)

    # ------------------------------------------------------------------ run

    def run(self, request: C.ResearchRequest, catalogue_snapshot: Optional[str] = None,
            policy_snapshot: Optional[str] = None, *, on_stage: Optional[StageCallback] = None,
            cancel: Any = None, research_id: Optional[str] = None, use_cache: bool = False) -> C.ResearchResult:
        """Run one research (spec §3 main flow, §10 stages).

        ``on_stage(stage, completed, total, detail)`` is called on every stage change and after
        every unit of analysis.  ``cancel`` is a callable returning True or an ``Event``; it is
        checked between units and raises ``AquaError("cancelled")`` — a cancelled run publishes
        no corrected label.  Request errors raise ``AquaError`` (``unknown_region``,
        ``invalid_period``, ``invalid_context``, selector errors); data insufficiency is a
        result with item statuses, not an error.
        """
        progress = _Progress(on_stage, cancel)
        created_at = _now()
        research_id = research_id or "rs_" + uuid.uuid4().hex
        warnings: list[C.Warning_] = []

        progress.enter("validating")
        self._check_snapshots(catalogue_snapshot, policy_snapshot)
        user = self._validate(request)

        progress.enter("selecting_variables")
        plan, opened, parent = self._select(request, user, warnings, progress)
        cache_key = self.cache_key(request, plan)
        if use_cache and self.storage is not None and not request.options.reselect:
            cached_id = self.storage.cache_get(cache_key)
            if cached_id is not None:
                cached = self.storage.load_result(cached_id)
                for stage in C.STAGES[2:]:
                    progress.enter(stage, 0, 0, "served from the result cache")
                identity = cached.identity.model_copy(update={"research_id": research_id, "cached_from": cached_id})
                return cached.model_copy(update={"identity": identity})
        self._selection_warnings(plan, warnings)
        identity = self._identity(research_id, created_at, plan, request, cache_key)

        if plan.status == "unsupported_phenomenon" or (not plan.variable_set and not plan.indicator_recipe_ids):
            for stage in C.STAGES[2:-1]:
                progress.enter(stage, 0, 0, "nothing to analyse: the phenomenon is not supported by the catalogue")
            warnings.append(C.Warning_(
                code="unsupported_phenomenon", subject="selection",
                message="No catalogue variable has a documented relation to this phenomenon, so nothing was "
                        "analysed. Unrelated variables are not added to produce an answer."))
            result = C.ResearchResult(
                identity=identity.model_copy(update={"status": "partial"}), user_constraints=user, selection=plan,
                resolved=C.ResolvedBlock(
                    region=self._resolved_region(user.region_id, "user"),
                    period=C.ResolvedPeriod(start=user.period.start, end=user.period.end, source="user")
                    if user.period else None),
                comparison=C.ComparisonBlock(status="not_available", note="no variable was selected"),
                warnings=warnings)
            return self._finish(result, progress)

        progress.enter("resolving_defaults")
        resolved, fill = self._resolve_defaults(request, user, plan, opened, progress)
        region_id = resolved.region.id if resolved.region else None
        period = C.Period(start=resolved.period.start, end=resolved.period.end) if resolved.period else None
        if resolved.preset_status == "no_matching_preset":
            warnings.append(C.Warning_(
                code="no_matching_preset", subject="resolved",
                message=f"No preset could fill {', '.join(resolved.preset_missing)}: {resolved.preset_reason}. "
                        "The conditions you selected are kept unchanged."))

        progress.enter("resolving_products")
        decisions = self.resolver.resolve_products(plan, region_id, period) if region_id else []
        comparison = self.resolver.comparison(decisions, region_id, period, user_period=user.period is not None) \
            if region_id else C.ComparisonBlock(status="not_available", note="no region was resolved")

        progress.enter("analyzing")
        analysis: Optional[CandidateAnalysis] = None
        if region_id and period:
            analysis = self._analyse(plan, region_id, period, decisions, light=False, progress=progress)
            variables = [self._variable_result(v, user, region_id, period, comparison) for v in analysis.variables]
            indicators = [self._indicator_result(i, user, region_id, period) for i in analysis.indicators]
            comparison.sample_support = {
                v.variable_id: self._support(v.metric.fit) for v in analysis.variables
                if v.metric is not None and v.metric.fit is not None}
        else:
            variables = self._unanalysed_variables(plan, decisions, user, region_id, comparison)
            indicators = []
            warnings.append(C.Warning_(
                code="not_analysed", subject="resolved",
                message="No trend was computed because " + ("no region" if not region_id else "no analysis period")
                        + " is available. " + ("The full history of each variable is shown without a fit."
                                               if region_id else "")))
        indicators += self._no_recipe_results(plan)
        baselines = self._baselines(analysis, variables, region_id, decisions)

        progress.enter("correcting")
        families: list[C.EvidenceFamily] = []
        if analysis is not None:
            query_family = self._query_family(plan, analysis, created_at)
            search = self._search_families(fill, parent, warnings)
            everything = [query_family, *search]
            progress.check()                                   # last exit before labels are attached
            for block in variables:
                if block.trend is not None:
                    block.trend = attach_families(block.trend, everything)
            for ind in indicators:
                for m in ind.metrics:
                    if m.trend is not None:
                        m.trend = attach_families(m.trend, everything)
            mine = {r.hypothesis_id for r in analysis.records()}
            families = [self._embed(query_family, mine)]
            families += [self._embed(f, mine) for f in search
                         if fill is not None and fill.family is not None and f.family_id == fill.family.family_id
                         or any(h.hypothesis_id in mine for h in f.hypotheses)]

        progress.enter("explaining")
        self._item_warnings(variables, indicators, comparison, warnings)
        status = "complete" if self._all_ok(plan, resolved, variables, indicators, comparison) else "partial"
        result = C.ResearchResult(
            identity=identity.model_copy(update={"status": status}), user_constraints=user, selection=plan,
            resolved=resolved, comparison=comparison, baselines=baselines, variables=variables,
            indicators=indicators, evidence_families=families, warnings=warnings, provisional=False)
        return self._finish(result, progress)

    # ------------------------------------------------------------------ run: pieces

    def _identity(self, research_id: str, created_at: str, plan: Optional[C.SelectionPlan],
                  request: C.ResearchRequest, cache_key: Optional[str], status: str = "running") -> C.Identity:
        v = self.store.versions
        return C.Identity(
            research_id=research_id, created_at=created_at, status=status,
            dataset_version=v["dataset_version"], catalogue_version=v["catalogue_version"],
            region_catalogue_version=v["region_catalogue_version"],
            indicator_registry_version=v["indicator_registry_version"],
            method_policy_version=v["method_policy_version"], preset_policy_version=v["preset_policy_version"],
            quality_policy_version=v["quality_policy_version"], engine_version=ENGINE_VERSION,
            selection_plan_id=plan.selection_plan_id if plan else None,
            parent_research_id=request.context.parent_research_id, preset_ref=request.context.preset_ref,
            cache_key=cache_key, stats_policy_version=STATS_POLICY_VERSION,
            selection_plan_content_hash=plan.content_hash if plan else None,
            snapshot_id=self.store.snapshot_id(), policy_snapshot_id=self.policy_snapshot(),
            versions=dict(v))

    @staticmethod
    def _selection_warnings(plan: C.SelectionPlan, warnings: list[C.Warning_]) -> None:
        if not plan.selector.is_language_model:
            warnings.append(C.Warning_(
                code="selector_not_language_model", subject="selection",
                message=f"The variable set was produced by the '{plan.selector.provider}' selector, a deterministic "
                        "catalogue matcher, not by a language model."))
        if plan.ignored_text_constraints:
            warnings.append(C.Warning_(
                code="text_constraints_ignored", subject="selection",
                message="Place or date words in the text (" + ", ".join(plan.ignored_text_constraints)
                        + ") were not used: the region and the period come only from the selectors."))
        if plan.status == "partial" or plan.unanswerable:
            warnings.append(C.Warning_(
                code="partial_selection", subject="selection",
                message="Parts of the question cannot be answered with the catalogue: "
                        + " ".join(plan.unanswerable or ["see the selection plan"])))

    def _unanalysed_variables(self, plan: C.SelectionPlan, decisions: Sequence[C.ProductDecision],
                              user: C.UserConstraints, region_id: Optional[str],
                              comparison: C.ComparisonBlock) -> list[C.VariableResult]:
        """Variables stay visible when a region or a period is missing: full history, no fit."""
        by_var = {d.variable_id: d for d in decisions}
        out: list[C.VariableResult] = []
        for selected in plan.variable_set:
            decision = by_var.get(selected.variable_id) or C.ProductDecision(
                variable_id=selected.variable_id, status="not_applicable",
                status_reason="not analysed: no region was selected and no preset filled it")
            prep = self.prepared(region_id, decision.selected_product_id) \
                if region_id and decision.selected_product_id else None
            why = decision.status_reason if decision.status != "ok" else \
                "no analysis period was selected and no preset filled it; the full history is shown without a fit"
            out.append(C.VariableResult(
                **self._variable_base(selected, decision, user), status=decision.status, status_reason=why,
                baseline_id=prep.baseline["baseline_id"] if prep else None, analysis_period=None,
                full_history=C.Period(start=prep.series.start, end=prep.series.end) if prep else None,
                in_comparison=False, comparison_exclusion_reason=comparison.note,
                series=self._series_block(prep, None, None) if prep else None, trend=None,
                limitations=_unique([x for x in (decision.caveat, why) if x])))
        return out

    def _baselines(self, analysis: Optional[CandidateAnalysis], variables: Sequence[C.VariableResult],
                   region_id: Optional[str], decisions: Sequence[C.ProductDecision]) -> list[C.BaselineInfo]:
        """Fixed references of every series and recipe of the result (data contract §5.2)."""
        out: list[C.BaselineInfo] = []
        for decision in decisions:
            prep = self.prepared(region_id, decision.selected_product_id) \
                if region_id and decision.selected_product_id else None
            if prep is not None:
                out.append(self._baseline_info(prep, decision.variable_id))
        for ind in (analysis.indicators if analysis else []):
            info = ind.computation.baseline_info()
            if info is not None:
                out.append(info.model_copy(update={
                    "product_id": ind.decision.selected_product_id if ind.decision else None}))
        return out

    @staticmethod
    def _item_warnings(variables: Sequence[C.VariableResult], indicators: Sequence[C.IndicatorResult],
                       comparison: C.ComparisonBlock, warnings: list[C.Warning_]) -> None:
        for v in variables:
            if v.status != "ok":
                warnings.append(C.Warning_(code=v.status, subject=v.variable_id,
                                           message=f"{v.label}: {v.status_reason or v.status}"))
            if v.product.fallback:
                warnings.append(C.Warning_(
                    code="fallback_product", subject=v.variable_id,
                    message=f"{v.label} uses {v.product.selected_product_id} (priority {v.product.priority_rank}) "
                            f"instead of the primary product: {v.product.fallback_reason}"))
            if FLAG_PARTIAL_PERIOD in v.product.quality_flags and v.status == "ok" and v.actual_support:
                warnings.append(C.Warning_(
                    code="period_not_fully_supported", subject=v.variable_id,
                    message=f"{v.label}: the requested period {v.analysis_period.start}..{v.analysis_period.end} "
                            f"is supported from {v.actual_support.start} to {v.actual_support.end} "
                            f"({v.actual_support.n_valid} of {v.actual_support.n_expected} months); it was not "
                            "shortened."))
        for ind in indicators:
            if ind.status != "ok":
                warnings.append(C.Warning_(code=ind.status, subject=ind.indicator_id,
                                           message=f"{ind.label}: {ind.status_reason or ind.status}"))
        if comparison.status == "no_common_period":
            warnings.append(C.Warning_(code="no_common_period", subject="comparison",
                                       message=comparison.note or "no common period"))
        warnings.append(C.Warning_(
            code="exploratory_scope", subject="evidence",
            message="Adjusted p-values control the false discovery rate within the listed family only. Confidence "
                    "intervals are pointwise and are not adjusted for multiple comparisons or selection. Repeatedly "
                    "changing the period across interactions is not covered by any correction; read results as "
                    "exploratory."))

    @staticmethod
    def _all_ok(plan: C.SelectionPlan, resolved: C.ResolvedBlock, variables: Sequence[C.VariableResult],
                indicators: Sequence[C.IndicatorResult], comparison: C.ComparisonBlock) -> bool:
        return (plan.status == "ok" and resolved.preset_status != "no_matching_preset"
                and all(v.status == "ok" and v.trend is not None for v in variables)
                and all(i.status == "ok" and all(m.status == "ok" for m in i.metrics) for i in indicators)
                and comparison.status in ("ok", "single_variable"))

    def _finish(self, result: C.ResearchResult, progress: _Progress) -> C.ResearchResult:
        """Summary (never allowed to hide numbers), JSON safety, persistence, final stage."""
        try:
            result.summary = self.presenter.summary(result)
        except Exception as exc:                              # contract §9.4: numbers stay, text is unavailable
            result.summary = C.SummaryBlock(status="unavailable", generator=self.presenter.generator(),
                                            unavailable_reason=f"the summary could not be generated: {exc}")
        result = C.ResearchResult.model_validate(C.json_safe(result.model_dump(mode="json")))
        progress.check()
        if self.storage is not None:
            self.storage.save_result(result)
            if result.identity.cache_key:
                self.storage.cache_put(result.identity.cache_key, result.identity.research_id)
        progress.enter("complete", 1, 1, result.identity.status)
        return result

    def failed_result(self, request: C.ResearchRequest, error: AquaError,
                      research_id: Optional[str] = None) -> C.ResearchResult:
        """Result snapshot of a run that ended with an error: the user's input is kept (contract §9.1, §9.4)."""
        identity = self._identity(research_id or "rs_" + uuid.uuid4().hex, _now(), None, request, None,
                                  status="cancelled" if error.code == "cancelled" else "failed")
        return C.ResearchResult(
            identity=identity,
            user_constraints=C.UserConstraints(phenomenon_query=request.phenomenon_query or "",
                                               region_id=request.region_id, period=request.period),
            warnings=[C.Warning_(code=error.code, message=error.message, subject=",".join(error.fields) or None)],
            summary=C.SummaryBlock(status="unavailable", generator=self.presenter.generator(),
                                   unavailable_reason=error.message))


def _unique(items: Sequence[str]) -> list[str]:
    seen: dict[str, None] = {}
    for item in items:
        if item and item not in seen:
            seen[item] = None
    return list(seen)


def _fit_window(metric: MetricOutcome) -> Optional[dict[str, str]]:
    """Window the metric's fit used, on its own axis (months, or whole calendar years)."""
    if metric.fit is None:
        return None
    if metric.cadence == "monthly":
        return {"start": index_to_ym(metric.fit.t_start), "end": index_to_ym(metric.fit.t_end)}
    return {"start": f"{metric.fit.t_start:04d}", "end": f"{metric.fit.t_end:04d}"}
