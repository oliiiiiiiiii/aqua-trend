"""PlanResolver: deterministic product, period and comparison resolution.

Spec §6 (steps 4–5, layered suitability), §6.1 (substitutability), §6.2 (common period and
user period); data contract §4.2 (product decision); acceptance D02–D08, D10.

Rules implemented
* A product is chosen from data facts only — does the region have its prepared series, does
  the record support the period, is the fixed seasonal baseline supported, can it carry the
  requirements that the selected indicator recipes declared beforehand.  No slope, p-value or
  index value is read here, and the decision is taken before any trend is computed (D03, D04).
* Candidates are exactly ``approved_product_ids`` of the concept, in that order.  A product of
  the same category that is registered but not approved, or that belongs to another concept,
  is never a fallback (D05).
* Layers (spec §6), each scanned in approved priority order:
    1. supports the variable trend, the whole period AND every selected recipe that consumes
       this variable;
    2. supports the variable trend and every such recipe;
    3. supports the variable trend and the whole period;
    4. supports the variable trend;
    5. only a description is possible (some data, but baseline or coverage is insufficient).
  "Supports the variable trend" = prepared series + supported fixed baseline + coverage of the
  period at or above ``quality_policy.product_applicable.min_coverage_in_period``.
* When nothing is usable the variable stays visible with a status and a reason; the region and
  the period are never changed (D02, D06).
* A user period is used verbatim.  Variables that cannot support it are listed with the
  requested period and their actual support; nothing is shortened silently (D08).
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Iterable, Optional, Sequence

import numpy as np

from . import contracts as C
from .errors import AquaError
from .timeaxis import index_to_ym, is_ym, ym_to_index

#: quality flags written into ProductDecision.quality_flags
FLAG_FALLBACK = "fallback_product"
FLAG_CAVEAT = "product_caveat"
FLAG_PARTIAL_PERIOD = "period_not_fully_supported"
FLAG_LOW_COVERAGE = "coverage_below_policy"
FLAG_GAPS = "missing_months_in_period"
FLAG_INDICATOR = "indicator_requirements_not_met"
FLAG_DESCRIPTIVE = "descriptive_only"

_FACT_CACHE = 512


@dataclass(frozen=True)
class ProductFacts:
    """Period-independent data facts of one product in one region (no values, no trends)."""

    product_id: str
    rank: int
    series_status: str                 # ItemStatus of store.series_status
    series_reason: Optional[str]
    valid_t: Optional[np.ndarray]      # month indices that hold a value
    record_start: Optional[int]        # first / last month of the prepared axis
    record_end: Optional[int]
    baseline_ok: bool
    baseline_reason: Optional[str]

    @property
    def has_data(self) -> bool:
        return self.valid_t is not None and self.valid_t.size > 0

    @property
    def first_valid(self) -> Optional[int]:
        return int(self.valid_t[0]) if self.has_data else None

    @property
    def last_valid(self) -> Optional[int]:
        return int(self.valid_t[-1]) if self.has_data else None

    def n_valid_in(self, start: int, end: int) -> int:
        if not self.has_data:
            return 0
        return int(np.searchsorted(self.valid_t, end, side="right") - np.searchsorted(self.valid_t, start, side="left"))


@dataclass(frozen=True)
class _Assessment:
    """One product judged against one (optional) period and the declared recipe requirements."""

    facts: ProductFacts
    coverage: Optional[float]
    spans: bool
    trend_ok: bool
    describable: bool
    indicators_ok: bool
    indicator_problems: tuple[str, ...]
    status: str
    reason: Optional[str]


def period_bounds(period: Any) -> Optional[tuple[int, int]]:
    """Inclusive month-index bounds of a period (``Period``, dict, tuple) or ``None``."""
    if period is None:
        return None
    if isinstance(period, dict):
        start, end = period.get("start"), period.get("end")
    elif isinstance(period, (tuple, list)):
        start, end = period
    else:
        start, end = getattr(period, "start", None), getattr(period, "end", None)
    if not (is_ym(start) and is_ym(end)) or ym_to_index(start) > ym_to_index(end):
        raise AquaError("invalid_period", "A period needs a start and an end month (YYYY-MM) with start <= end.",
                        fields=["period"])
    return ym_to_index(start), ym_to_index(end)


class PlanResolver:
    """Resolves one product per selected concept and the comparison period (spec §6)."""

    def __init__(self, store: Any, indicators: Any = None):
        self.store = store
        self.indicators = indicators
        self._facts: OrderedDict[tuple[str, str], ProductFacts] = OrderedDict()
        self._recipe_support: OrderedDict[tuple[str, str, str], tuple[str, Optional[str]]] = OrderedDict()
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ policy

    def _min_coverage(self) -> float:
        return float(self.store.policy("quality_policy")["product_applicable"]["min_coverage_in_period"])

    def _min_common_months(self) -> int:
        return int(self.store.policy("quality_policy")["comparison"]["min_common_years"]) * 12

    # ------------------------------------------------------------------ data facts

    def product_facts(self, region_id: str, product_id: str, rank: int = 0) -> ProductFacts:
        """Data facts of one product in one region; cached, never value-dependent."""
        key = (region_id, product_id)
        with self._lock:
            cached = self._facts.get(key)
            if cached is not None:
                self._facts.move_to_end(key)
        if cached is not None:
            return cached if cached.rank == rank else ProductFacts(**{**cached.__dict__, "rank": rank})
        status, reason = self.store.series_status(region_id, product_id)
        valid_t = start = end = None
        baseline_ok, baseline_reason = False, None
        if status == "ok":
            series = self.store.series(region_id, product_id)
            valid_t = series.t[np.isfinite(series.values)]
            start, end = int(series.t[0]), int(series.t[-1])
            support = self.store.baseline_support(region_id, product_id)
            if support is None:
                baseline_reason = f"no fixed seasonal baseline is registered for product {product_id}"
            elif not support["ok"]:
                base = self.store.baseline(support["baseline_id"])
                short = ", ".join(f"{m + 1:02d} (n={n})" for m, n in enumerate(support["samples_per_position"])
                                  if n < support["minimum_samples"])
                baseline_reason = (
                    f"the fixed reference period {base['start']}..{base['end']} of {support['baseline_id']} has fewer "
                    f"than {support['minimum_samples']} valid values for calendar month(s) {short}; the reference "
                    "period is not shortened or moved to the analysis period")
            else:
                baseline_ok = True
        facts = ProductFacts(product_id=product_id, rank=rank, series_status=status, series_reason=reason,
                             valid_t=valid_t, record_start=start, record_end=end,
                             baseline_ok=baseline_ok, baseline_reason=baseline_reason)
        with self._lock:
            self._facts[key] = facts
            while len(self._facts) > _FACT_CACHE:
                self._facts.popitem(last=False)
        return facts

    def recipe_support(self, region_id: str, product_id: str, indicator_id: str) -> tuple[str, Optional[str]]:
        """(status, reason): can this product carry the recipe's fixed calibration? Availability only."""
        key = (region_id, product_id, indicator_id)
        with self._lock:
            cached = self._recipe_support.get(key)
        if cached is not None:
            return cached
        series = self.store.series(region_id, product_id)
        info = self.indicators.calibration_support(indicator_id, series)
        out = (info.status, info.status_reason)
        with self._lock:
            self._recipe_support[key] = out
            while len(self._recipe_support) > _FACT_CACHE:
                self._recipe_support.popitem(last=False)
        return out

    # ------------------------------------------------------------------ recipes

    def recipes_consuming(self, variable_id: str, recipe_ids: Iterable[str]) -> list[str]:
        """Selected recipes whose declared input is this concept (data contract §4.2)."""
        if self.indicators is None:
            return []
        return [rid for rid in recipe_ids if self.indicators.requirements(rid)["variable_id"] == variable_id]

    def recipe_input_variables(self, recipe_ids: Iterable[str]) -> list[str]:
        """Concept ids the selected recipes need, in first-use order."""
        out: list[str] = []
        if self.indicators is None:
            return out
        for rid in recipe_ids:
            vid = self.indicators.requirements(rid)["variable_id"]
            if vid not in out:
                out.append(vid)
        return out

    # ------------------------------------------------------------------ assessment

    def _assess(self, facts: ProductFacts, region_id: str, bounds: Optional[tuple[int, int]],
                recipes: Sequence[str]) -> _Assessment:
        if facts.series_status != "ok":
            return _Assessment(facts, None, False, False, False, False, (), facts.series_status, facts.series_reason)
        if not facts.has_data:
            return _Assessment(facts, 0.0, False, False, False, False, (), "insufficient_data",
                               f"the prepared series of {facts.product_id} holds no valid month for this region")
        if bounds is None:
            n_axis = facts.record_end - facts.record_start + 1
            coverage, spans, overlap = facts.valid_t.size / n_axis, True, True
        else:
            n_in = facts.n_valid_in(*bounds)
            coverage = n_in / (bounds[1] - bounds[0] + 1)
            spans = facts.first_valid <= bounds[0] and facts.last_valid >= bounds[1]
            overlap = n_in > 0
        covered = overlap and coverage >= self._min_coverage()
        trend_ok = facts.baseline_ok and covered
        problems: list[str] = []
        for rid in recipes:
            status, reason = self.recipe_support(region_id, facts.product_id, rid)
            if status != "ok":
                problems.append(f"{rid}: {status}" + (f" — {reason}" if reason else ""))
        status, reason = "ok", None
        if not facts.baseline_ok:
            status, reason = "insufficient_baseline", facts.baseline_reason
        elif not overlap:
            status = "insufficient_data"
            reason = (f"{facts.product_id} has no valid month inside {self._label(bounds)}; its data for this region "
                      f"cover {index_to_ym(facts.first_valid)}..{index_to_ym(facts.last_valid)}")
        elif not covered:
            status = "insufficient_data"
            reason = (f"{facts.product_id} covers {coverage:.0%} of {self._label(bounds)} (valid data "
                      f"{index_to_ym(facts.first_valid)}..{index_to_ym(facts.last_valid)}); the quality policy needs "
                      f"{self._min_coverage():.0%}")
        return _Assessment(facts, coverage, spans, trend_ok, overlap, not problems, tuple(problems), status, reason)

    @staticmethod
    def _label(bounds: Optional[tuple[int, int]]) -> str:
        return "the record" if bounds is None else f"{index_to_ym(bounds[0])}..{index_to_ym(bounds[1])}"

    @staticmethod
    def _rejection(a: _Assessment, wanted_recipes: bool, wanted_span: bool, bounds: Optional[tuple[int, int]]) -> str:
        """Why a higher-priority product was passed over (data reasons only)."""
        if a.status != "ok":
            return a.reason or a.status
        if wanted_recipes and not a.indicators_ok:
            return ("cannot support the selected indicator recipe(s), which declared their requirements before the "
                    "product decision — " + "; ".join(a.indicator_problems))
        if wanted_span and not a.spans:
            return (f"valid data {index_to_ym(a.facts.first_valid)}..{index_to_ym(a.facts.last_valid)} do not span "
                    f"the whole period {PlanResolver._label(bounds)}")
        return "not applicable"

    # ------------------------------------------------------------------ decisions

    def resolve_variable(self, variable_id: str, region_id: str, period: Any = None,
                         recipe_ids: Iterable[str] = ()) -> C.ProductDecision:
        """One product decision for one concept (spec §6 step 4; data contract §4.2)."""
        self.store.region(region_id)                       # unknown ids are an error, missing data is a status
        concept = self.store.concept(variable_id)
        bounds = period_bounds(period)
        recipes = self.recipes_consuming(variable_id, recipe_ids)
        approved = list(concept.get("approved_product_ids") or [])
        assessed = [self._assess(self.product_facts(region_id, pid, rank), region_id, bounds, recipes)
                    for rank, pid in enumerate(approved, start=1)]
        layers = (
            lambda a: a.trend_ok and a.spans and a.indicators_ok,
            lambda a: a.trend_ok and a.indicators_ok,
            lambda a: a.trend_ok and a.spans,
            lambda a: a.trend_ok,
        )
        chosen, layer = None, None
        for number, test in enumerate(layers, start=1):
            chosen = next((a for a in assessed if test(a)), None)
            if chosen is not None:
                layer = number
                break
        if chosen is None:                                  # layer 5: description only
            chosen = next((a for a in assessed if a.facts.baseline_ok and a.describable), None) \
                or next((a for a in assessed if a.describable), None) \
                or next((a for a in assessed if a.facts.has_data), None)
            layer = 5 if chosen is not None else None
        return self._decision(variable_id, concept, assessed, chosen, layer, bounds, recipes)

    def _decision(self, variable_id: str, concept: dict, assessed: list[_Assessment],
                  chosen: Optional[_Assessment], layer: Optional[int], bounds: Optional[tuple[int, int]],
                  recipes: Sequence[str]) -> C.ProductDecision:
        not_approved = [
            {"product_id": pid, "reason": "registered under this concept but not an approved fallback: "
                                          f"definition class {p.get('definition_class')!r} is not the concept's "
                                          f"{(concept.get('quantity_definition') or {}).get('definition_class')!r}"}
            for pid, p in self.store.products().items()
            if p.get("variable_id") == variable_id and not p.get("approved")
        ]
        if chosen is None:
            rejected = [{"product_id": a.facts.product_id, "rank": a.facts.rank, "status": a.status,
                         "reason": a.reason or a.status} for a in assessed]
            statuses = [a.status for a in assessed]
            status = "no_series" if statuses and all(s == "no_series" for s in statuses) else \
                next((s for s in statuses if s != "no_series"), "no_series")
            reason = "; ".join(f"{r['product_id']}: {r['reason']}" for r in rejected) or \
                "the concept has no approved product"
            return C.ProductDecision(
                variable_id=variable_id, selected_product_id=None, rejected=rejected, status=status,
                status_reason=f"no approved product of {variable_id} is usable for this region — {reason}. "
                              "The region and the period are kept as selected; no other region or quantity is "
                              "substituted.",
                registered_not_approved=not_approved, recipe_ids_considered=list(recipes))

        want_recipes, want_span = layer in (1, 2), layer in (1, 3)
        higher = [a for a in assessed if a.facts.rank < chosen.facts.rank]
        rejected = [{"product_id": a.facts.product_id, "rank": a.facts.rank, "status": a.status,
                     "reason": self._rejection(a, want_recipes, want_span, bounds)} for a in higher]
        product = self.store.product(chosen.facts.product_id)
        flags: list[str] = []
        if higher:
            flags.append(FLAG_FALLBACK)
        if product.get("caveat"):
            flags.append(FLAG_CAVEAT)
        if bounds is not None and chosen.describable and not chosen.spans:
            flags.append(FLAG_PARTIAL_PERIOD)
        if chosen.coverage is not None and chosen.coverage < 1.0 and chosen.describable:
            flags.append(FLAG_GAPS)
        if chosen.status == "insufficient_data":
            flags.append(FLAG_LOW_COVERAGE)
        if layer == 5:
            flags.append(FLAG_DESCRIPTIVE)
        if recipes and not chosen.indicators_ok:
            flags.append(FLAG_INDICATOR)
        refs = self.store.refs()
        return C.ProductDecision(
            variable_id=variable_id,
            selected_product_id=chosen.facts.product_id,
            product_label=product.get("product_name"),
            agency=product.get("agency"),
            priority_rank=chosen.facts.rank,
            fallback=bool(higher),
            fallback_reason="; ".join(f"{r['product_id']} (priority {r['rank']}): {r['reason']}" for r in rejected)
            if higher else None,
            rejected=rejected,
            available_period=C.Period(start=index_to_ym(chosen.facts.first_valid),
                                      end=index_to_ym(chosen.facts.last_valid)),
            coverage=chosen.coverage,
            quality_flags=flags,
            status=chosen.status,
            status_reason=chosen.reason,
            source_refs=[to_ref(refs[r]) for r in product.get("source_refs") or [] if r in refs],
            caveat=product.get("caveat"),
            suitability_layer=layer,
            suitability=_LAYER_TEXT[layer],
            record_period=C.Period(start=index_to_ym(chosen.facts.record_start),
                                   end=index_to_ym(chosen.facts.record_end)),
            product_version=product.get("version"),
            quality_limits=list(product.get("quality_limits") or []),
            recipe_ids_considered=list(recipes),
            recipe_problems=list(chosen.indicator_problems),
            registered_not_approved=not_approved,
        )

    def resolve_products(self, plan: C.SelectionPlan, region_id: str,
                         period: Any = None) -> list[C.ProductDecision]:
        """One decision per selected variable, in plan order (spec §6 step 4)."""
        return [self.resolve_variable(v.variable_id, region_id, period, plan.indicator_recipe_ids)
                for v in plan.variable_set]

    def resolve_recipe_inputs(self, plan: C.SelectionPlan, region_id: str, period: Any,
                              decisions: Sequence[C.ProductDecision]) -> dict[str, C.ProductDecision]:
        """Decision per concept that a selected recipe consumes.

        A concept that is also a selected variable keeps that ONE decision (data contract §4.2:
        one product per concept in a research); a concept that only a recipe needs is resolved
        with the same rules.
        """
        by_var = {d.variable_id: d for d in decisions}
        out: dict[str, C.ProductDecision] = {}
        for vid in self.recipe_input_variables(plan.indicator_recipe_ids):
            out[vid] = by_var.get(vid) or self.resolve_variable(vid, region_id, period, plan.indicator_recipe_ids)
        return out

    # ------------------------------------------------------------------ periods

    def common_period(self, decisions: Sequence[C.ProductDecision], region_id: str) -> Optional[C.Period]:
        """Intersection of the valid data of every trend-capable selected product, or ``None``.

        ``None`` when no variable is usable or the intersection is shorter than
        ``quality_policy.comparison.min_common_years`` (spec §6.2).  The preset engine derives
        its candidate windows from this period; nothing here looks at a trend.
        """
        spans = [period_bounds(d.available_period) for d in decisions
                 if d.selected_product_id and d.status == "ok" and d.available_period]
        if not spans:
            return None
        start, end = max(s[0] for s in spans), min(s[1] for s in spans)
        if end - start + 1 < self._min_common_months():
            return None
        return C.Period(start=index_to_ym(start), end=index_to_ym(end))

    def comparison(self, decisions: Sequence[C.ProductDecision], region_id: str, period: Any,
                   *, user_period: bool) -> C.ComparisonBlock:
        """The main comparison over ONE period (spec §6.2; acceptance D07, D08).

        ``period`` is the resolved analysis period (the user's, verbatim, or the one a preset
        filled).  Eligible = a selected product that supports the variable trend over it.
        Excluded variables are listed with the requested period and their actual support.
        """
        if period is None:
            return C.ComparisonBlock(status="not_available",
                                     note="no analysis period was resolved, so there is no main comparison; each "
                                          "variable's full history is returned separately")
        bounds = period_bounds(period)
        label = self._label(bounds)
        eligible: list[str] = []
        excluded: list[dict[str, Any]] = []
        any_data = False
        for d in decisions:
            any_data = any_data or d.selected_product_id is not None
            if d.selected_product_id and d.status == "ok":
                eligible.append(d.variable_id)
                continue
            entry: dict[str, Any] = {"variable_id": d.variable_id, "status": d.status,
                                     "reason": d.status_reason or d.status,
                                     "requested_period": {"start": index_to_ym(bounds[0]), "end": index_to_ym(bounds[1])}}
            if d.selected_product_id:
                entry["product_id"] = d.selected_product_id
                entry["actual_support"] = d.available_period.model_dump() if d.available_period else None
                entry["coverage"] = d.coverage
            excluded.append(entry)
        partial = [d.variable_id for d in decisions
                   if d.variable_id in eligible and FLAG_PARTIAL_PERIOD in d.quality_flags]
        common = self.common_period(decisions, region_id)
        if not eligible:
            status = "no_common_period" if any_data else "not_available"
            note = (f"no selected variable supports the period {label}; the full history of each variable is "
                    "returned separately and is not a same-period comparison")
        elif len(eligible) == 1:
            status = "single_variable"
            note = f"only {eligible[0]} supports the period {label}; there is nothing to compare it with"
        else:
            status = "ok"
            note = (f"{len(eligible)} variable(s) are compared over the same period {label}"
                    + (" (the period the user selected, used verbatim)" if user_period else " (filled by a preset)"))
        if partial:
            note += (f". {', '.join(partial)} do(es) not span the whole period (missing months at an edge are "
                     "listed under sample_support); the period was not shortened")
        return C.ComparisonBlock(
            status=status, period=C.Period(start=index_to_ym(bounds[0]), end=index_to_ym(bounds[1])),
            eligible_variable_ids=eligible, excluded=excluded, note=note,
            period_source="user" if user_period else "preset",
            common_data_period=common.model_dump() if common else None,
            partially_supported_variable_ids=partial,
        )


_LAYER_TEXT = {
    1: "supports the variable trend over the whole period and every selected indicator recipe",
    2: "supports the variable trend and every selected indicator recipe",
    3: "supports the variable trend over the whole period",
    4: "supports the variable trend",
    5: "description only: the data do not support a trend with inference for this period or baseline",
}


def to_ref(record: dict[str, Any]) -> C.ScientificRef:
    """Catalogue reference record -> contracts.ScientificRef (only registered fields)."""
    return C.ScientificRef(ref_id=record["ref_id"], title=record.get("title") or record["ref_id"],
                           url=record.get("url"), doi=record.get("doi"), applies_to=record.get("applies_to"),
                           curated_version=record.get("curated_version"))

