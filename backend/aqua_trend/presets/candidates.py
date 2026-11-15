"""Candidate regions and periods of a preset search, declared BEFORE anything is computed.

Spec §8.1 ("候選期間政策須於計算前版本化 … 完整候選清單、窗口規則、排除原因及實際檢定範圍須可重現"),
acceptance P01–P05, T10.

Everything here reads data AVAILABILITY only (which products have a prepared series, which
months hold a value, whether the fixed baseline is supported) through ``PlanResolver``.  No
slope, p-value or index value is read, so the candidate list cannot depend on a result.

* candidate regions — the user's region when one was selected (exactly that id, whatever its
  layer; never a parent or a neighbour); otherwise every catalogue region of the policy layers
  that has a prepared series for at least one selected variable.
* candidate periods — the user's period when one was selected (exactly those months);
  otherwise, per region, the full common period of the trend-capable selected variables plus
  the fixed calendar windows of the policy (10 / 20 / 30 years, stepped backwards from the
  last complete common year).
* a candidate is analysed only when at least ``min_variables_fraction`` of the selected
  variables has an approved product supporting a trend for exactly that region and period.
  Excluded candidates and regions stay in the record with their reason.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Sequence

from .. import contracts as C
from ..resolve import period_bounds
from ..timeaxis import index_to_ym
from .policy import PresetPolicy

KIND_FULL = "full_common_period"
KIND_USER = "user_period"
KIND_MANUAL = "manual"


def window_kind(length_years: int) -> str:
    return f"window_{length_years}y"


@dataclass(frozen=True)
class Window:
    start: int            # month index, inclusive
    end: int
    kind: str

    @property
    def period(self) -> C.Period:
        return C.Period(start=index_to_ym(self.start), end=index_to_ym(self.end))


@dataclass
class Candidate:
    """One (region, period) of the search with its product decisions (taken before any fit)."""

    region_id: str
    start: int
    end: int
    kind: str
    decisions: list[C.ProductDecision] = field(default_factory=list)
    status: str = "analysed"                 # "analysed" | "excluded"
    reason: Optional[str] = None
    manual_adjustment_ids: list[str] = field(default_factory=list)

    @property
    def key(self) -> tuple[str, int, int]:
        return self.region_id, self.start, self.end

    @property
    def period(self) -> C.Period:
        return C.Period(start=index_to_ym(self.start), end=index_to_ym(self.end))

    def label(self) -> str:
        return f"{self.region_id} {index_to_ym(self.start)}..{index_to_ym(self.end)}"


@dataclass
class CandidateSet:
    """The declared candidate list of one search (stored in full with the search record)."""

    regions_considered: list[str] = field(default_factory=list)
    excluded_regions: list[dict[str, Any]] = field(default_factory=list)   # [{region_id, reason}]
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def analysed(self) -> list[Candidate]:
        return [c for c in self.candidates if c.status == "analysed"]

    @property
    def excluded(self) -> list[Candidate]:
        return [c for c in self.candidates if c.status != "analysed"]


def fixed_windows(common: Optional[C.Period], policy: PresetPolicy) -> list[Window]:
    """Full common period + fixed calendar windows inside its complete calendar years (spec §8.1).

    Windows run from January of the start year to December of the end year; the newest window
    of each length ends in the last complete common year and the others are stepped backwards
    by ``window_step_years``.  The list depends on the common DATA period and the policy only.
    """
    if common is None:
        return []
    a, b = period_bounds(common)
    out: list[Window] = []
    if policy.full_common_period:
        out.append(Window(a, b, KIND_FULL))
    first_year = a // 12 if a % 12 == 0 else a // 12 + 1          # first complete calendar year
    last_year = b // 12 if b % 12 == 11 else b // 12 - 1          # last complete calendar year
    seen = {(w.start, w.end) for w in out}
    for length in policy.window_lengths_years:
        end_year = last_year
        while end_year - length + 1 >= first_year:
            start, end = (end_year - length + 1) * 12, end_year * 12 + 11
            if (start, end) not in seen:
                seen.add((start, end))
                out.append(Window(start, end, window_kind(length)))
            end_year -= policy.window_step_years
    return out


def candidate_regions(store: Any, resolver: Any, plan: C.SelectionPlan, policy: PresetPolicy,
                      user_region_id: Optional[str]) -> tuple[list[str], list[dict[str, Any]]]:
    """(candidate region ids, excluded regions with reasons) — series index only (spec §8.1).

    With a user region the list is exactly that id.  Otherwise: policy layers, sorted by id,
    keeping regions with a prepared series of an approved product of a selected variable.
    """
    approved: set[str] = set()
    for variable_id in _concept_ids(resolver, plan):
        approved.update(store.concept(variable_id).get("approved_product_ids") or [])
    if user_region_id is not None:
        pool = [user_region_id]
    else:
        pool = sorted(rid for rid, region in store.regions().items() if region.get("type") in policy.region_layers)
    kept: list[str] = []
    excluded: list[dict[str, Any]] = []
    for region_id in pool:
        if approved.intersection(store.available_products(region_id)):
            kept.append(region_id)
        else:
            excluded.append({"region_id": region_id,
                             "reason": "no prepared series of an approved product of any selected variable "
                                       "for exactly this region (no parent or neighbouring region is used)"})
    return kept, excluded


def _concept_ids(resolver: Any, plan: C.SelectionPlan) -> list[str]:
    """Selected variables, or — for a plan that holds recipes only — the recipes' input concepts."""
    ids = [v.variable_id for v in plan.variable_set]
    return ids or list(resolver.recipe_input_variables(plan.indicator_recipe_ids))


def basis_decisions(resolver: Any, plan: C.SelectionPlan, region_id: str,
                    period: Optional[C.Period]) -> tuple[list[C.ProductDecision], list[C.ProductDecision]]:
    """(decisions of the selected variables, decisions the validity rule is judged on).

    The two lists are the same except for a plan that holds recipes only, where validity is
    judged on the products resolved for the recipes' input concepts.
    """
    decisions = resolver.resolve_products(plan, region_id, period)
    if decisions:
        return decisions, decisions
    return decisions, list(resolver.resolve_recipe_inputs(plan, region_id, period, decisions).values())


def supported_fraction(decisions: Sequence[C.ProductDecision]) -> float:
    """Share of the selected variables whose resolved product supports a trend (availability only)."""
    if not decisions:
        return 0.0
    return sum(1 for d in decisions if d.selected_product_id and d.status == "ok") / len(decisions)


def exclusion_reason(decisions: Sequence[C.ProductDecision], policy: PresetPolicy, label: str) -> str:
    ok = sum(1 for d in decisions if d.selected_product_id and d.status == "ok")
    problems = "; ".join(f"{d.variable_id}: {d.status}" for d in decisions
                         if not (d.selected_product_id and d.status == "ok"))
    return (f"{ok} of {len(decisions)} selected variable(s) support a trend for {label}; the preset policy needs "
            f"at least {policy.min_variables_fraction:.0%} ({problems})")


def declare_candidates(store: Any, resolver: Any, plan: C.SelectionPlan, policy: PresetPolicy,
                       user_region_id: Optional[str], user_period: Optional[C.Period],
                       manual_adds: Sequence[tuple[str, C.Period, str]] = ()) -> CandidateSet:
    """Declare every candidate of a search with its product decisions (spec §6 steps 3–5, §8.1).

    ``manual_adds`` are (region_id, period, adjustment_id) entries of the manual settings that
    already passed the user-constraint check; they go through the same validity rule.
    """
    regions, excluded_regions = candidate_regions(store, resolver, plan, policy, user_region_id)
    out = CandidateSet(regions_considered=list(regions), excluded_regions=excluded_regions)
    seen: dict[tuple[str, int, int], Candidate] = {}
    user_bounds = period_bounds(user_period)

    def add(region_id: str, window: Window, adjustment_id: Optional[str] = None) -> None:
        key = (region_id, window.start, window.end)
        if key in seen:
            if adjustment_id:
                seen[key].manual_adjustment_ids.append(adjustment_id)
            return
        decisions, basis = basis_decisions(resolver, plan, region_id, window.period)
        cand = Candidate(region_id, window.start, window.end, window.kind, decisions=decisions,
                         manual_adjustment_ids=[adjustment_id] if adjustment_id else [])
        if supported_fraction(basis) < policy.min_variables_fraction or not basis:
            cand.status = "excluded"
            cand.reason = exclusion_reason(basis, policy, cand.label()) if basis else \
                "the selection plan holds no variable and no indicator recipe to analyse"
        seen[key] = cand
        out.candidates.append(cand)

    for region_id in regions:
        if user_bounds is not None:
            add(region_id, Window(user_bounds[0], user_bounds[1], KIND_USER))
            continue
        _, on_record = basis_decisions(resolver, plan, region_id, None)
        common = resolver.common_period(on_record, region_id)
        windows = fixed_windows(common, policy)
        if not windows:
            usable = [d for d in on_record if d.selected_product_id and d.status == "ok"]
            why = ("no selected variable has a product that supports a trend on its record"
                   if not usable else
                   "the common period of the trend-capable variables is shorter than the minimum of the "
                   "quality policy, so no candidate period exists")
            out.excluded_regions.append({"region_id": region_id, "reason": why})
            continue
        for window in windows:
            add(region_id, window)
    for region_id, period, adjustment_id in manual_adds:
        a, b = period_bounds(period)
        if region_id in store.regions():
            add(region_id, Window(a, b, KIND_MANUAL), adjustment_id)
    return out
