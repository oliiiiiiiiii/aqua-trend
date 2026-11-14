"""IndicatorRegistry: versioned standard indicators and recorded-event statistics.

Spec §7.4, data contract §6–§7, architecture §4.  The registry only executes recipes that are
registered in backend/catalogue/indicators.json; it never invents a formula, a threshold or an
event.  It returns series — trend fitting, inference and multiple-comparison correction are
done by the shared engine, so an indicator cannot bypass them (spec §4).

Outcomes are statuses, never synthetic values:
- derived indicator: ok | no_series | unsupported_resolution | insufficient_baseline
  | insufficient_data (calibrated, but nothing usable inside the analysis period)
- recorded events:   ok | data_required | insufficient_data
- phenomenon without an approved recipe: definition_required / not_applicable
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from .. import contracts as C
from ..errors import AquaError
from ..timeaxis import index_to_ym, is_ym, ym_to_index
from . import events as ev_rules
from . import recorded as rec_rules
from . import spi as spi_rules

DEFAULT_CATALOGUE_DIR = Path(__file__).resolve().parents[2] / "catalogue"


# --------------------------------------------------------------------------- result types

@dataclass
class MetricSeries:
    """One metric of an indicator on its own explicit time axis (NaN = missing)."""

    metric_id: str
    label: str
    unit: str
    cadence: str                      # "monthly" | "annual"
    data_kind: str                    # "index" | "count" | "continuous"
    status: str
    status_reason: str | None = None
    #: month index (monthly) or calendar year (annual); full history
    t: np.ndarray = field(default_factory=lambda: np.array([], dtype=np.int64))
    values: np.ndarray = field(default_factory=lambda: np.array([], dtype=np.float64))
    #: positions that belong to the analysis period (whole years for annual metrics)
    in_analysis: np.ndarray = field(default_factory=lambda: np.array([], dtype=bool))
    aggregation_rule: str | None = None
    seasonal_adjustment: str = "none_annual"
    limitations: list[str] = field(default_factory=list)

    @property
    def times(self) -> list[str]:
        if self.cadence == "monthly":
            return [index_to_ym(int(i)) for i in self.t]
        return [f"{int(y):04d}" for y in self.t]

    def to_contract(self) -> C.IndicatorMetric:
        """contracts.IndicatorMetric without a trend (the engine adds it)."""
        block = None
        if self.t.size:
            raw = [float(v) if np.isfinite(v) else None for v in self.values]
            block = C.SeriesBlock(cadence=self.cadence, times=self.times, raw=raw)
        return C.IndicatorMetric(
            metric_id=self.metric_id, label=self.label, unit=self.unit, cadence=self.cadence,
            status=self.status, status_reason=self.status_reason, series=block,
            aggregation_rule=self.aggregation_rule, limitations=list(self.limitations),
            data_kind=self.data_kind, seasonal_adjustment=self.seasonal_adjustment,
            in_analysis=[bool(b) for b in self.in_analysis],
        )


@dataclass
class CalibrationInfo:
    """Fixed calibration reference of a recipe and how the selected product supports it."""

    baseline_id: str
    version: str
    start: str
    end: str
    rule: str
    minimum_samples: int
    samples_per_position: list[int]
    actual_support: dict[str, str] | None
    status: str
    status_reason: str | None
    refs: list[dict[str, Any]] = field(default_factory=list)
    applies_to: list[str] = field(default_factory=list)
    #: fitted parameters per calendar month (alpha, beta, prob_zero, n_valid, n_zero); audit trail
    parameters: list[dict[str, Any]] = field(default_factory=list)
    #: mean / standard deviation of the index inside the calibration period (ideal: 0 / 1); audit trail
    fit_check: dict[str, Any] | None = None

    def to_contract(self) -> C.BaselineInfo:
        return C.BaselineInfo(
            baseline_id=self.baseline_id, version=self.version, kind="calibration_reference",
            start=self.start, end=self.end, rule=self.rule, designation="recipe_calibration",
            minimum_samples=self.minimum_samples, samples_per_position=list(self.samples_per_position),
            actual_support=C.Period(**self.actual_support) if self.actual_support else None,
            status=self.status, status_reason=self.status_reason,
            refs=[C.ScientificRef(**r) for r in self.refs], applies_to=list(self.applies_to),
            parameters=C.json_safe(self.parameters), fit_check=C.json_safe(self.fit_check),
        )


@dataclass
class IndicatorComputation:
    """Everything the registry knows about one indicator for one region (no trends)."""

    indicator_id: str
    kind: str                                   # "derived_indicator" | "recorded_event"
    label: str
    status: str
    status_reason: str | None = None
    version: str | None = None
    region_id: str | None = None
    product_id: str | None = None
    analysis_period: dict[str, str] | None = None
    full_history: dict[str, str] | None = None
    #: monthly index series on the full history (derived indicators)
    monthly_t: np.ndarray | None = None
    monthly_values: np.ndarray | None = None
    #: events related to the analysis period, contract-shaped dicts (full extent + censoring)
    events: list[dict[str, Any]] = field(default_factory=list)
    #: every event of the full history (derived indicators)
    events_full_history: list[dict[str, Any]] = field(default_factory=list)
    metrics: dict[str, MetricSeries] = field(default_factory=dict)
    calibration: CalibrationInfo | None = None
    limitations: list[str] = field(default_factory=list)
    recipe: dict[str, Any] | None = None
    product_decision: Any = None
    event_catalogue_id: str | None = None
    event_catalogue_version: str | None = None
    event_coverage: dict[str, Any] | None = None

    @property
    def monthly_times(self) -> list[str]:
        return [] if self.monthly_t is None else [index_to_ym(int(i)) for i in self.monthly_t]

    def to_contract(self, product_decision: Any = None) -> C.IndicatorResult:
        """contracts.IndicatorResult without trends (the engine attaches them per metric)."""
        recipe = self.recipe or {}
        decision = product_decision if product_decision is not None else self.product_decision
        if decision is not None and not isinstance(decision, C.ProductDecision):
            decision = C.ProductDecision(**dict(decision))
        applicability = recipe.get("phenomenon_applicability") or {}
        interpretation = recipe.get("interpretation") or {}
        return C.IndicatorResult(
            indicator_id=self.indicator_id, version=self.version, label=self.label, kind=self.kind,
            status=self.status, status_reason=self.status_reason,
            phenomenon_applicability=applicability.get("statement"),
            standard_refs=[C.ScientificRef(**r) for r in recipe.get("standard_refs", [])],
            definition=_definition_text(recipe) if recipe else None,
            interpretation=_interpretation_text(interpretation) if interpretation else None,
            input_product=decision if self.kind == "derived_indicator" else None,
            calibration_baseline_id=self.calibration.baseline_id if self.calibration else None,
            event_catalogue_id=self.event_catalogue_id,
            event_catalogue_version=self.event_catalogue_version,
            event_coverage=self.event_coverage,
            analysis_period=C.Period(**self.analysis_period) if self.analysis_period else None,
            full_history=C.Period(**self.full_history) if self.full_history else None,
            metrics=[m.to_contract() for m in self.metrics.values()],
            events=[C.DerivedEvent(**C.json_safe(e)) for e in self.events],
            limitations=list(self.limitations),
        )

    def baseline_info(self) -> C.BaselineInfo | None:
        return self.calibration.to_contract() if self.calibration else None


def _definition_text(recipe: dict[str, Any]) -> str:
    parts = list((recipe.get("computation") or {}).get("steps", []))
    rule = (recipe.get("event_rule") or {}).get("definition")
    if rule:
        parts.append("Event rule: " + rule)
    return " ".join(parts)


def _interpretation_text(interp: dict[str, Any]) -> str:
    parts = [interp.get("represents", "")]
    parts += list(interp.get("does_not_represent", []))
    if interp.get("versus_recorded_events"):
        parts.append(interp["versus_recorded_events"])
    return " ".join(p for p in parts if p)


def _period(period: Any) -> tuple[int | None, int | None, dict[str, str] | None]:
    """Normalise an inclusive analysis period (dict, contracts.Period, (start, end) or None)."""
    if period is None:
        return None, None, None
    if isinstance(period, dict):
        start, end = period.get("start"), period.get("end")
    elif isinstance(period, (tuple, list)):
        start, end = period
    else:
        start, end = getattr(period, "start", None), getattr(period, "end", None)
    if not (is_ym(start) and is_ym(end)) or ym_to_index(start) > ym_to_index(end):
        raise AquaError("invalid_period", "analysis_period needs start <= end as YYYY-MM", fields=["period"])
    return ym_to_index(start), ym_to_index(end), {"start": start, "end": end}


def _load_json(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------- registry

class IndicatorRegistry:
    """Executes the registered indicator recipes and recorded-event aggregation.

    ``store`` is a PreparedDataStore (duck-typed: ``indicator_recipes``, ``event_catalogues``,
    ``events``, ``event_coverage``).  Without a store the registry reads the recipe files of
    ``catalogue_dir`` and treats every event catalogue as not delivered.
    """

    def __init__(self, store: Any = None, *, catalogue_dir: str | Path | None = None):
        self.store = store
        self.catalogue_dir = Path(
            catalogue_dir or getattr(store, "catalogue_dir", None) or DEFAULT_CATALOGUE_DIR
        )
        self._file: dict[str, Any] | None = None
        self._events_index: dict[str, Any] | None = None

    # ---- catalogue access --------------------------------------------------

    def _indicator_file(self) -> dict[str, Any]:
        if self._file is None:
            self._file = _load_json(self.catalogue_dir / "indicators.json")
        return self._file

    def _event_index(self) -> dict[str, Any]:
        if self._events_index is None:
            self._events_index = _load_json(self.catalogue_dir / "events" / "index.json")
        return self._events_index

    @property
    def version(self) -> str:
        return str(self._indicator_file().get("version"))

    def recipes(self) -> dict[str, dict[str, Any]]:
        """Registered recipes by indicator_id (from the store when it provides them)."""
        getter = getattr(self.store, "indicator_recipes", None)
        if callable(getter):
            got = getter()
            if isinstance(got, dict):
                return got
            return {r["indicator_id"]: r for r in got}
        return {r["indicator_id"]: r for r in self._indicator_file().get("recipes", [])}

    def recipe(self, indicator_id: str) -> dict[str, Any]:
        """The registered recipe; unknown ids are rejected (the model can only pick approved ones)."""
        found = self.recipes().get(indicator_id)
        if found is None:
            raise AquaError("invalid_request", f"indicator {indicator_id!r} is not a registered recipe",
                            fields=["indicator_id"])
        return found

    def recipes_for(self, phenomenon_id: str) -> list[str]:
        """Indicator ids whose recipe declares the phenomenon in its applicability."""
        return [i for i, r in self.recipes().items()
                if phenomenon_id in (r.get("phenomenon_applicability") or {}).get("phenomenon_ids", [])]

    def requirements(self, indicator_id: str) -> dict[str, Any]:
        """What the input product must provide — known BEFORE any result is computed (§4.2)."""
        recipe = self.recipe(indicator_id)
        var = recipe["required_variables"][0]
        base = recipe["baseline_requirements"]
        return {
            "indicator_id": indicator_id,
            "variable_id": var["variable_id"],
            "cadence": var["cadence"],
            "calendar": var.get("calendar", "gregorian"),
            "unit_support": [{"unit": a["unit"], "temporal_support": a["temporal_support"]}
                             for a in var["accepted_inputs"]],
            "min_history_months": var["min_history_months"],
            "required_period": dict(var["required_period"]),
            "calibration": {"start": base["start"], "end": base["end"]},
            "baseline_id": base["baseline_id"],
            "baseline_version": base["version"],
            "min_samples_per_calendar_month": base["min_samples_per_calendar_month"],
            "min_positive_samples_per_calendar_month": base["min_positive_samples_per_calendar_month"],
            "unsupported_status": base.get("unsupported_status", "insufficient_baseline"),
        }

    # ---- derived indicators ------------------------------------------------

    def _input_problem(self, recipe: dict[str, Any], series: Any, region_id: str | None) -> tuple[str, str] | None:
        """Status and reason when the series cannot be used as the recipe's input at all."""
        var = recipe["required_variables"][0]
        if series is None:
            return "no_series", (f"no prepared {var['variable_id']} series for this region and product; "
                                 "no parent or neighbouring region is substituted")
        if region_id is not None and getattr(series, "region_id", region_id) != region_id:
            raise AquaError("invalid_request", "series belongs to another region", fields=["region_id"])
        cadence = getattr(series, "cadence", var["cadence"])
        calendar = getattr(series, "calendar", var.get("calendar", "gregorian"))
        if cadence != var["cadence"] or calendar != var.get("calendar", "gregorian"):
            return "unsupported_resolution", (
                f"recipe needs a {var['cadence']} {var.get('calendar', 'gregorian')} series, "
                f"got {cadence} / {calendar}")
        if self._conversion(recipe, series) is None:
            accepted = ", ".join(f"{a['unit']} ({a['temporal_support']})" for a in var["accepted_inputs"])
            return "unsupported_resolution", (
                f"no approved unit conversion for {getattr(series, 'unit', None)!r} "
                f"({getattr(series, 'temporal_support', None)!r}); accepted: {accepted}")
        return None

    @staticmethod
    def _conversion(recipe: dict[str, Any], series: Any) -> str | None:
        for a in recipe["required_variables"][0]["accepted_inputs"]:
            if a["unit"] == getattr(series, "unit", None) and \
                    a["temporal_support"] == getattr(series, "temporal_support", None):
                return a["conversion"]
        return None

    def _spi(self, recipe: dict[str, Any], series: Any) -> spi_rules.SpiSeries:
        base, params = recipe["baseline_requirements"], recipe["computation"]["parameters"]
        lo, hi = params["value_bounds"]
        return spi_rules.compute_spi(
            np.asarray(series.t), np.asarray(series.values, dtype=np.float64),
            scale=int(params["scale_months"]), conversion=self._conversion(recipe, series),
            cal_start=ym_to_index(base["start"]), cal_end=ym_to_index(base["end"]),
            min_samples=int(base["min_samples_per_calendar_month"]),
            min_positive=int(base["min_positive_samples_per_calendar_month"]),
            bounds=(float(lo), float(hi)),
        )

    def _calibration_info(self, recipe: dict[str, Any], result: spi_rules.SpiSeries | None,
                          status: str, reason: str | None) -> CalibrationInfo:
        base = recipe["baseline_requirements"]
        counts, support, params, check = [0] * 12, None, [], None
        if result is not None:
            cal = result.calibration
            counts = list(cal.samples_per_month)
            inside = (result.t >= cal.start) & (result.t <= cal.end) & np.isfinite(result.accumulated)
            if inside.any():
                valid_t = result.t[inside]
                support = {"start": index_to_ym(int(valid_t[0])), "end": index_to_ym(int(valid_t[-1]))}
            params = [{"calendar_month": m + 1, "alpha": f.alpha, "beta": f.beta, "prob_zero": f.prob_zero,
                       "n_valid": f.n_valid, "n_zero": f.n_zero, "ok": f.ok, "reason": f.reason}
                      for m, f in enumerate(cal.fits)]
            inside_spi = result.spi[(result.t >= cal.start) & (result.t <= cal.end)]
            inside_spi = inside_spi[np.isfinite(inside_spi)]
            if inside_spi.size:
                check = {"n": int(inside_spi.size), "mean": float(inside_spi.mean()), "sd": float(inside_spi.std()),
                         "note": "index values inside the calibration period; a well-fitting distribution gives "
                                 "mean near 0 and standard deviation near 1"}
        ref_ids = base.get("ref_ids") or []
        return CalibrationInfo(
            baseline_id=base["baseline_id"], version=base["version"], start=base["start"], end=base["end"],
            rule=base["rule"], minimum_samples=int(base["min_samples_per_calendar_month"]),
            samples_per_position=counts, actual_support=support, status=status, status_reason=reason,
            refs=[r for r in recipe.get("standard_refs", []) if r["ref_id"] in ref_ids],
            applies_to=[recipe["indicator_id"]], parameters=params, fit_check=check,
        )

    def calibration_support(self, indicator_id: str, series: Any) -> CalibrationInfo:
        """Can this product's series support the recipe's fixed calibration?

        Uses data availability only (which totals exist), never index values or trends, so the
        resolver can decide the product before any result is seen (spec §6, acceptance D10).
        """
        recipe = self.recipe(indicator_id)
        problem = self._input_problem(recipe, series, None)
        if problem:
            return self._calibration_info(recipe, None, *problem)
        result = self._spi(recipe, series)
        if result.calibration.ok:
            return self._calibration_info(recipe, result, "ok", None)
        return self._calibration_info(recipe, result, "insufficient_baseline",
                                      self._baseline_reason(recipe, series, result))

    @staticmethod
    def _baseline_reason(recipe: dict[str, Any], series: Any, result: spi_rules.SpiSeries) -> str:
        base, need = recipe["baseline_requirements"], recipe["required_variables"][0]["required_period"]
        valid = np.isfinite(result.totals)
        have = "no valid month"
        if valid.any():
            have = f"{index_to_ym(int(result.t[valid][0]))}..{index_to_ym(int(result.t[valid][-1]))}"
        product = getattr(series, "product_id", None) or "the selected product"
        return (
            f"{product} provides {have}; the fixed calibration {base['start']}..{base['end']} needs "
            f"{base['min_samples_per_calendar_month']} valid totals per calendar month "
            f"(data from {need['start']}). {result.calibration.reason}. "
            "The calibration period is not shortened and is not re-fitted on the analysis period."
        )

    @staticmethod
    def _data_limitations(recipe: dict[str, Any], result: spi_rules.SpiSeries) -> list[str]:
        """Limitations that follow from THIS series under the fixed recipe (no new thresholds).

        - Zero totals: with H(0) = q the index cannot fall below Phi^-1(q) in a calendar month
          whose calibration sample contains zero totals.  Compared with the recipe's own event
          parameters this tells where a rainless period cannot qualify as, or even count
          towards, a drought event.
        - Value bounds: a value at the recipe's bound means "at least this extreme".  Counts
          are reported inside and outside the calibration period, because bounded months
          outside it show that the product's precipitation there lies outside the calibrated
          distribution.
        """
        params, rule = recipe["computation"]["parameters"], recipe["event_rule"]["parameters"]
        lo, hi = (float(b) for b in params["value_bounds"])
        cal = result.calibration
        notes: list[str] = []
        floors = {m + 1: spi_rules.zero_total_index(f, (lo, hi)) for m, f in enumerate(cal.fits)}
        floors = {m: v for m, v in floors.items() if v is not None}
        if floors:
            shares = [cal.fits[m - 1].prob_zero for m in floors]
            text = (
                f"Zero {params['scale_months']}-month totals occur in the calibration sample of calendar month(s) "
                f"{sorted(floors)} ({min(shares):.0%} to {max(shares):.0%} of the totals). A zero total maps to "
                f"SPI = Phi^-1(q), so the index cannot fall below {min(floors.values()):.2f} to "
                f"{max(floors.values()):.2f} in those months, however dry they are.")
            no_qualify = sorted(m for m, v in floors.items() if v > float(rule["qualify_at_or_below"]))
            no_run = sorted(m for m, v in floors.items() if v >= float(rule["run_below"]))
            if no_qualify:
                text += (f" In month(s) {no_qualify} this floor is above the event threshold "
                         f"{float(rule['qualify_at_or_below'])}: a drought event cannot qualify from those months alone.")
            if no_run:
                text += (f" In month(s) {no_run} it is not below {float(rule['run_below'])}: a rainless total there "
                         "is not negative and closes a drought run. Drought metrics under-represent dry-season "
                         "drought in this region.")
            notes.append(text)
        finite = np.isfinite(result.spi)
        at_lo, at_hi = finite & (result.spi <= lo), finite & (result.spi >= hi)
        n_bound = int(at_lo.sum() + at_hi.sum())
        if n_bound:
            outside = (result.t < cal.start) | (result.t > cal.end)
            n_out = int(((at_lo | at_hi) & outside).sum())
            text = (
                f"{n_bound} of {int(finite.sum())} index months are at the recipe's value bound "
                f"({int(at_lo.sum())} at {lo}, {int(at_hi.sum())} at {hi}; {n_out} of them outside the calibration "
                f"period {index_to_ym(cal.start)}..{index_to_ym(cal.end)}). A bounded value means 'at least this "
                "extreme' under the fixed calibration, and severity sums that include it are truncated.")
            if n_out:
                text += (" Bounded months outside the calibration period show precipitation outside the calibrated "
                         "distribution, which can reflect a change in climate or a change in the product; the "
                         "index cannot tell which.")
            notes.append(text)
        return notes

    @staticmethod
    def _blocked(status: str, reason: str, common: dict[str, Any]) -> IndicatorComputation:
        """Computation without values: every metric carries the same status and reason."""
        agg = common["recipe"]["aggregation"]
        specs = [agg["monthly_metric"], *agg["metrics"]]
        metrics = {
            s["metric_id"]: MetricSeries(
                metric_id=s["metric_id"], label=s["label"], unit=s["unit"],
                cadence="monthly" if s is agg["monthly_metric"] else "annual",
                data_kind=s["data_kind"], status=status, status_reason=reason, aggregation_rule=s.get("rule"),
                seasonal_adjustment=s.get("seasonal_adjustment", "none_annual"))
            for s in specs
        }
        return IndicatorComputation(status=status, status_reason=reason, metrics=metrics, **common)

    def compute(self, indicator_id: str, *, series: Any, region_id: str, analysis_period: Any = None,
                product_decision: Any = None) -> IndicatorComputation:
        """Run a derived-indicator recipe on one prepared series.

        The index and its events are computed on the full history with the recipe's fixed
        calibration; ``analysis_period`` only marks which months / whole years belong to the
        analysis and adds censoring flags to events (E06, E09).  A product that cannot support
        the calibration yields ``insufficient_baseline`` for the indicator only (D10).
        """
        recipe = self.recipe(indicator_id)
        if recipe.get("family") != "spi":
            raise AquaError("internal_error", f"recipe family {recipe.get('family')!r} has no implementation")
        a_start, a_end, period = _period(analysis_period)
        common: dict[str, Any] = dict(
            indicator_id=indicator_id, kind="derived_indicator", label=recipe["label"],
            version=recipe["version"], region_id=region_id, analysis_period=period, recipe=recipe,
            product_id=getattr(series, "product_id", None) or getattr(product_decision, "selected_product_id", None),
            product_decision=product_decision,
            limitations=list(recipe["phenomenon_applicability"].get("limits", [])),
        )
        problem = self._input_problem(recipe, series, region_id)
        if problem:
            comp = self._blocked(*problem, common)
            comp.calibration = self._calibration_info(recipe, None, *problem)
            return comp

        result = self._spi(recipe, series)
        t = result.t
        common["full_history"] = {"start": index_to_ym(int(t[0])), "end": index_to_ym(int(t[-1]))} if t.size else None
        n_negative = int(np.sum(np.asarray(series.values, dtype=np.float64) < 0))
        if n_negative:
            common["limitations"].append(
                f"{n_negative} negative precipitation value(s) are physically invalid and were treated as missing")
        if not result.calibration.ok:
            reason = self._baseline_reason(recipe, series, result)
            comp = self._blocked("insufficient_baseline", reason, common)
            comp.calibration = self._calibration_info(recipe, result, "insufficient_baseline", reason)
            return comp

        common["limitations"].extend(self._data_limitations(recipe, result))
        rule, agg = recipe["event_rule"]["parameters"], recipe["aggregation"]
        found = ev_rules.detect_events(t, result.spi, run_below=float(rule["run_below"]),
                                       qualify_at_or_below=float(rule["qualify_at_or_below"]))
        annual = ev_rules.annual_metrics(t, result.spi, found,
                                         min_valid_months_per_year=int(agg["min_valid_months_per_year"]))
        prefix = f"{indicator_id}:{region_id}:{common['product_id']}"
        related = ev_rules.relate_to_period(found, a_start, a_end)
        everything = ev_rules.relate_to_period(found, None, None)

        month_mask = np.ones(t.shape, dtype=bool)
        if a_start is not None:
            month_mask = (t >= a_start) & (t <= a_end)
        year_mask = ev_rules.years_inside(annual.years, a_start, a_end)
        metrics: dict[str, MetricSeries] = {}
        mm = agg["monthly_metric"]
        scale = int(recipe["computation"]["parameters"]["scale_months"])
        overlap = [] if scale < 2 else [
            f"Consecutive monthly values share {scale - 1} of their {scale} months of precipitation, so the index "
            "is serially dependent by construction; trend inference has to account for this dependence."]
        metrics[mm["metric_id"]] = self._metric(mm, "monthly", t, result.spi, month_mask, overlap)
        values = {"frequency": annual.event_starts, "duration": annual.event_months, "severity": annual.severity}
        for spec in agg["metrics"]:
            notes = annual.notes if spec["quantity"] == "frequency" else []
            metrics[spec["metric_id"]] = self._metric(spec, "annual", annual.years, values[spec["quantity"]],
                                                      year_mask, notes)
        usable = any(m.status == "ok" for m in metrics.values())
        return IndicatorComputation(
            status="ok" if usable else "insufficient_data",
            status_reason=None if usable else (
                "the index is calibrated, but it has no valid month and no complete calendar year inside the "
                "analysis period; the full history is still returned"),
            monthly_t=t, monthly_values=result.spi,
            events=[_derived_event(prefix, p) for p in related],
            events_full_history=[_derived_event(prefix, p) for p in everything],
            metrics=metrics, calibration=self._calibration_info(recipe, result, "ok", None), **common,
        )

    @staticmethod
    def _metric(spec: dict[str, Any], cadence: str, t: np.ndarray, values: np.ndarray,
                mask: np.ndarray, notes: list[str]) -> MetricSeries:
        usable = int(np.isfinite(values[mask]).sum())
        status, reason = "ok", None
        if usable == 0:
            unit = "month" if cadence == "monthly" else "complete calendar year"
            status, reason = "insufficient_data", f"no valid {unit} of this metric inside the analysis period"
        return MetricSeries(
            metric_id=spec["metric_id"], label=spec["label"], unit=spec["unit"], cadence=cadence,
            data_kind=spec["data_kind"], status=status, status_reason=reason,
            t=np.asarray(t, dtype=np.int64), values=np.asarray(values, dtype=np.float64), in_analysis=mask,
            aggregation_rule=spec.get("rule"), limitations=list(notes),
            seasonal_adjustment=spec.get("seasonal_adjustment", "none_annual"),
        )

    def derived_availability(self, phenomenon_id: str) -> IndicatorComputation | None:
        """Statement for a phenomenon WITHOUT an approved derived recipe (E10).

        Returns None when recipes exist (use ``recipes_for``).  Otherwise a value-free
        computation with ``definition_required`` / ``not_applicable`` and a readable reason:
        e.g. monthly precipitation is never relabelled as flood frequency.
        """
        if self.recipes_for(phenomenon_id):
            return None
        doc = self._indicator_file()
        entry = next((e for e in doc.get("no_derived_recipe", [])
                      if phenomenon_id == e["phenomenon_id"] or phenomenon_id in e.get("aliases", [])), None)
        entry = entry or doc["default_no_recipe"]
        limits = [entry["what_is_needed"]] if entry.get("what_is_needed") else []
        return IndicatorComputation(
            indicator_id=f"derived.{phenomenon_id}", kind="derived_indicator",
            label=f"Standard derived indicator for {phenomenon_id}",
            status=entry["status"], status_reason=entry["reason"], limitations=limits,
        )

    # ---- recorded events ----------------------------------------------------

    def _catalogues(self, phenomenon_id: str) -> list[dict[str, Any]]:
        getter = getattr(self.store, "event_catalogues", None)
        entries = getter() if callable(getter) else self._event_index().get("catalogues", [])
        mine = [c for c in entries if c.get("phenomenon_id") == phenomenon_id]
        return sorted(mine, key=lambda c: (c.get("priority", 1 << 30), str(c.get("catalogue_id"))))

    def _select_catalogue(self, phenomenon_id: str, region_id: str) -> tuple[dict | None, list | None, str]:
        """The single catalogue used for this phenomenon and region, its events, or the reason for none."""
        entries = self._catalogues(phenomenon_id)
        if not entries:
            return None, None, f"no event catalogue is registered for phenomenon {phenomenon_id!r}"
        ready = [c for c in entries if c.get("status") == "ready"]
        if not ready:
            waiting = "; ".join(f"{c['catalogue_id']}: {c.get('status', 'pending')}"
                                + (f" (missing {', '.join(c['missing'])})" if c.get("missing") else "")
                                for c in entries)
            return None, None, f"event catalogue not delivered — {waiting}"
        fetch = getattr(self.store, "events", None)
        for cat in ready:
            records = fetch(cat["catalogue_id"], region_id) if callable(fetch) else None
            if records is not None:
                return cat, records, ""
        ids = ", ".join(c["catalogue_id"] for c in ready)
        return None, None, f"no delivered event records for region {region_id} in catalogue(s) {ids}"

    def compute_recorded(self, phenomenon_id: str, *, region_id: str, analysis_period: Any = None) -> IndicatorComputation:
        """Annual statistics of recorded events from ONE approved catalogue.

        ``data_required`` while no catalogue is delivered: no zero counts, no events, no time
        axis (E04).  With a delivery, see ``recorded.aggregate_recorded`` for the counting rules.
        """
        a_start, a_end, period = _period(analysis_period)
        index = self._event_index()
        rule, specs = index["aggregation_rule"], index["metrics"]
        indicator_id = f"recorded.{phenomenon_id}"
        common: dict[str, Any] = dict(indicator_id=indicator_id, kind="recorded_event",
                                      label=f"Recorded {phenomenon_id} events", region_id=region_id,
                                      analysis_period=period, version=rule["version"])

        def metric(spec: dict[str, Any], status: str, reason: str | None, unit: str | None = None,
                   **series: Any) -> MetricSeries:
            return MetricSeries(
                metric_id=f"{indicator_id}.{spec['suffix']}", label=spec["label"],
                unit=unit or spec["unit"] or "catalogue-defined", cadence="annual", data_kind=spec["data_kind"],
                status=status, status_reason=reason, aggregation_rule=spec["rule"],
                seasonal_adjustment=rule["seasonal_adjustment"], **series)

        cat, records, why = self._select_catalogue(phenomenon_id, region_id)
        if cat is None:
            reason = (f"{why}. Recorded {phenomenon_id} frequency, duration and severity cannot be computed; "
                      "an undelivered catalogue is not an empty catalogue, so no zero counts are reported.")
            metrics = {m.metric_id: m for m in (metric(s, "data_required", reason) for s in specs)}
            return IndicatorComputation(status="data_required", status_reason=reason, metrics=metrics, **common)

        cover_fn = getattr(self.store, "event_coverage", None)
        coverage = cover_fn(cat["catalogue_id"], region_id) if callable(cover_fn) else None
        sev_spec, sev_refused = cat.get("severity_metric"), None
        if sev_spec and sev_spec.get("annual_aggregation") not in rule["severity_annual_aggregations"]:
            sev_refused = (f"the catalogue registers annual aggregation {sev_spec.get('annual_aggregation')!r} for "
                           f"{sev_spec.get('name')!r}; only {rule['severity_annual_aggregations']} is implemented, "
                           "so no annual severity is computed")
            sev_spec = None
        agg = rec_rules.aggregate_recorded(
            records, coverage, region_id=region_id, phenomenon_id=phenomenon_id,
            analysis_start=a_start, analysis_end=a_end,
            canonical_ids=bool(cat.get("canonical_ids")), severity_metric=sev_spec)
        mask = ev_rules.years_inside(agg.years, a_start, a_end)
        no_zero = ("event coverage is not declared complete for any whole calendar year of the analysis "
                   "period: years without events are unknown, not zero, so an annual series is not applicable")
        series_by_quantity = {"frequency": agg.event_starts, "duration": agg.event_days, "severity": agg.severity}
        metrics = {}
        for spec in specs:
            values = series_by_quantity[spec["quantity"]]
            if values is None:
                m = metric(spec, "not_applicable", sev_refused or "the catalogue registers no severity metric")
            else:
                unit = sev_spec.get("unit") if spec["quantity"] == "severity" else None
                usable = bool(agg.usable[mask].any())
                valid = bool(np.isfinite(values[mask]).any())
                status, reason = ("ok", None) if valid else (
                    ("not_applicable", no_zero) if not usable else
                    ("insufficient_data", "no calendar year of the analysis period has a determinable value"))
                m = metric(spec, status, reason, unit, t=agg.years, values=values, in_analysis=mask)
            metrics[m.metric_id] = m
        ok = any(m.status == "ok" for m in metrics.values())
        limitations = list(agg.notes) + [
            "Recorded events reflect the catalogue's detection and registration policy; an increase in records "
            "is not by itself an increase in natural events (spec §7.4)."]
        return IndicatorComputation(
            status="ok" if ok else "insufficient_data",
            status_reason=None if ok else no_zero,
            events=agg.events, metrics=metrics, limitations=limitations,
            event_catalogue_id=cat["catalogue_id"], event_catalogue_version=cat.get("version"),
            event_coverage=agg.coverage_summary,
            recipe={"standard_refs": [cat["source_ref"]] if _is_ref(cat.get("source_ref")) else [],
                    "event_rule": {"definition": f"Catalogue definition: {cat.get('definition_ref')}. "
                                                 f"{rule['year_attribution']} {rule['zero_rule']}"}},
            **common,
        )


def _is_ref(value: Any) -> bool:
    return isinstance(value, dict) and bool(value.get("ref_id")) and bool(value.get("title"))


def _derived_event(prefix: str, related: ev_rules.PeriodEvent) -> dict[str, Any]:
    """Contract-shaped dict of one derived event (full extent, never clipped)."""
    e = related.event
    return {
        "event_id": f"{prefix}:{index_to_ym(e.start)}",
        "start": index_to_ym(e.start),
        #: last observed month of the run; None while the event is still running
        "end": None if e.end_censor == "history_end" else index_to_ym(e.end),
        "last_observed": index_to_ym(e.end),
        "duration_months": e.duration_months,
        "severity": e.severity,
        "peak": e.peak,
        "censoring": list(related.censoring),
        "months_in_analysis_period": related.months_in_period,
        "start_censor": e.start_censor,
        "end_censor": e.end_censor,
    }
