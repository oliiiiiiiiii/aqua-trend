"""Vectorised analysis of many preset candidates with the numbers of ``ResearchEngine.analyse_candidate``.

Spec §8.1 ("候選搜尋可以遍歷多區域"), §7.3 (preset-search family), §4 ("查詢、preset 批次與匯出共同使用
同一引擎").

Why this module exists: a both-blank search analyses a few thousand (region, period) candidates
with ~10–25 hypotheses each.  Calling ``engine.analyse_candidate`` once per candidate fits every
series alone and costs about 40 ms per candidate; fitting all regions of one (product, period)
in ONE ``stats.fit_trend_batch`` call costs about 40 ms per *group*.

How the numbers stay the engine's numbers
* Everything that decides WHAT is fitted comes from the engine and the resolver: product
  decisions (``PlanResolver``), the fixed-baseline anomalies (``engine.prepared``), indicator
  series (``engine._computation``), hypothesis components (``engine._components``).
* Only the ordinary case is vectorised: a series with a supported baseline / calibration and at
  least one valid value in the window.  Every other case — no series, unsupported baseline,
  blocked recipe, recorded events, an index whose overlap lag cannot be reached — is handed to
  the engine's own per-unit method, so its statuses and reasons are never re-implemented here.
* The first row of every group is ALSO computed by the engine; the batch row must reproduce its
  hypothesis id, slope and raw p-value, otherwise the search stops with ``internal_error``
  (a continuous self-check; tests compare whole candidates against ``analyse_candidate``).
* ``fit_trend_batch`` is the function the engine itself calls for a single row; rows of a batch
  are computed independently, so a row equals the single-row call.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Sequence

import numpy as np

from .. import contracts as C
from ..engine import VARIABLE_METRIC_ID, MetricOutcome, ResearchEngine
from ..errors import AquaError
from ..indicators import events as ev_rules
from ..stats import fit_trend_batch, hypothesis_id
from .candidates import Candidate

#: smallest number of valid samples of a half window for a descriptive half slope
#: (the default of ``stats.half_slopes``, which the engine calls without overriding it)
HALF_MIN_VALID = 3
_REL_TOL = 1e-9
_ABS_TOL = 1e-12


@dataclass
class MetricFacts:
    """Trend-level facts of one hypothesis of one candidate (what scoring and reasons read)."""

    kind: str                                 # "variable" | "derived_indicator" | "recorded_event"
    item_id: str
    metric_id: str
    unit: str
    cadence: str
    product_id: Optional[str]
    status: str
    status_reason: Optional[str]
    hypothesis_id: str
    record: C.HypothesisRecord
    slope_per_decade: Optional[float] = None
    inference_ok: bool = False
    inference_reason: Optional[str] = None
    p_raw: Optional[float] = None
    coverage: Optional[float] = None
    n_valid: Optional[int] = None
    n_expected: Optional[int] = None
    half_slopes: tuple[Optional[float], Optional[float]] = (None, None)
    #: sd of the fixed-baseline anomalies inside the reference period (variables only)
    scale_sd: Optional[float] = None

    @classmethod
    def from_outcome(cls, m: MetricOutcome) -> "MetricFacts":
        """Facts of a hypothesis the engine computed itself (``_analyse_*``)."""
        fit = m.fit
        described = m.trend is not None and fit is not None and fit.slope_per_decade is not None
        ok = m.trend is not None and m.trend.inference_status == "ok"
        return cls(
            kind=m.kind, item_id=m.item_id, metric_id=m.metric_id, unit=m.unit, cadence=m.cadence,
            product_id=m.product_id, status=m.status, status_reason=m.status_reason,
            hypothesis_id=m.hypothesis_id, record=m.record,
            slope_per_decade=fit.slope_per_decade if described else None,
            inference_ok=ok, inference_reason=None if ok else (m.record.untested_reason or m.status_reason),
            p_raw=m.record.p_raw if m.record.tested else None,
            coverage=fit.coverage if fit is not None else None,
            n_valid=fit.n_valid if fit is not None else None,
            n_expected=fit.n_expected if fit is not None else None,
            half_slopes=tuple(m.half_slopes), scale_sd=m.scale_sd)


@dataclass
class CandidateResult:
    """Every hypothesis of one analysed candidate, in the order ``analyse_candidate`` lists them."""

    candidate: Candidate
    facts: list[MetricFacts] = field(default_factory=list)

    @property
    def variables(self) -> list[MetricFacts]:
        return [f for f in self.facts if f.kind == "variable"]

    @property
    def indicator_metrics(self) -> list[MetricFacts]:
        return [f for f in self.facts if f.kind != "variable"]

    def records(self) -> list[C.HypothesisRecord]:
        return [f.record for f in self.facts]


@dataclass
class _Row:
    """One series waiting for its group fit: where the result goes and what the engine needs."""

    cand: int                                  # index into the candidate list
    slot: int                                  # position in that candidate's fact list
    t: np.ndarray
    values: np.ndarray
    region_id: str
    delegate: Callable[[], MetricOutcome]      # the engine's own computation of this hypothesis
    base: dict[str, Any]                       # constant MetricFacts fields
    status: tuple[str, Optional[str]] = ("ok", None)


def grid_row(t: np.ndarray, values: np.ndarray, start: int, end: int) -> np.ndarray:
    """Values on the complete calendar grid ``start..end`` (NaN where absent) — as ``stats`` grids them."""
    row = np.full(end - start + 1, np.nan)
    inside = (t >= start) & (t <= end)
    row[t[inside] - start] = values[inside]
    return row


def half_slopes_batch(grid: np.ndarray, steps_per_year: int) -> tuple[np.ndarray, np.ndarray]:
    """Row-wise descriptive OLS slopes (per year) of the two calendar halves of ``grid`` [R, T].

    Same definition as ``stats.half_slopes`` (split at the calendar midpoint, at least
    ``HALF_MIN_VALID`` valid samples per half, NaN = not available); used for the stability
    component only.  Equality with ``stats.half_slopes`` is tested.
    """
    n = grid.shape[1]
    tau = np.arange(n, dtype=np.float64) / steps_per_year
    mid = n // 2
    out = []
    for sl in (slice(0, mid), slice(mid, n)):
        seg, x = grid[:, sl], tau[sl]
        ok = np.isfinite(seg)
        count = ok.sum(axis=1)
        with np.errstate(invalid="ignore", divide="ignore"):
            xbar = (ok * x).sum(axis=1) / count
            dx = np.where(ok, x[None, :] - xbar[:, None], 0.0)
            sxx = (dx * dx).sum(axis=1)
            slope = (dx * np.where(ok, seg, 0.0)).sum(axis=1) / sxx
        valid = (count >= max(HALF_MIN_VALID, 2)) & (sxx > 0) & np.isfinite(slope)
        out.append(np.where(valid, slope, np.nan))
    return out[0], out[1]


def _opt(x: Any) -> Optional[float]:
    x = float(x)
    return x if math.isfinite(x) else None


def _close(a: Optional[float], b: Optional[float]) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=_REL_TOL, abs_tol=_ABS_TOL)


class BatchAnalyser:
    """Analyses a list of candidates of ONE selection plan (see the module docstring)."""

    def __init__(self, engine: ResearchEngine, plan: C.SelectionPlan):
        self.engine = engine
        self.plan = plan
        self.policy = engine.method_policy
        self._regions = engine.store.regions()
        self._region_version = engine.store.versions["region_catalogue_version"]
        self._recipes = [(rid, engine.indicators.requirements(rid), engine.indicators.recipe(rid))
                         for rid in plan.indicator_recipe_ids]
        self._recorded = engine.recorded_phenomena(plan)
        self._concepts = {v.variable_id: engine.store.concept(v.variable_id) for v in plan.variable_set}
        self.groups_fitted = 0
        self.rows_fitted = 0
        self.rows_delegated = 0

    # ------------------------------------------------------------------ public

    def analyse(self, candidates: Sequence[Candidate], *, check: Optional[Callable[[], None]] = None,
                progress: Optional[Callable[[int, int], None]] = None) -> list[CandidateResult]:
        """Facts and hypothesis records of every candidate; ``check`` may raise to cancel."""
        results = [CandidateResult(candidate=c) for c in candidates]
        groups: dict[tuple, list[_Row]] = {}
        for i, cand in enumerate(candidates):
            if check is not None:
                check()
            self._collect(i, cand, results[i], groups)
            if progress is not None and (i % 50 == 0 or i + 1 == len(candidates)):
                progress(i + 1, len(candidates))
        for key in sorted(groups, key=repr):
            if check is not None:
                check()
            self._fit_group(key, groups[key], results)
        for res in results:
            if any(f is None for f in res.facts):
                raise AquaError("internal_error", "a preset candidate has an unfilled hypothesis slot")
        return results

    # ------------------------------------------------------------------ collection (per candidate)

    def _collect(self, index: int, cand: Candidate, res: CandidateResult, groups: dict[tuple, list[_Row]]) -> None:
        """Queue the ordinary series of one candidate; let the engine compute everything else now."""
        eng, period = self.engine, cand.period
        a, b = cand.start, cand.end
        by_var = {d.variable_id: d for d in cand.decisions}
        for selected in self.plan.variable_set:
            decision = by_var[selected.variable_id]
            product_id = decision.selected_product_id
            prep = eng.prepared(cand.region_id, product_id) if product_id else None

            def variable(selected=selected, decision=decision) -> MetricOutcome:
                return eng._analyse_variable(selected, decision, cand.region_id, period, True).metric

            if prep is None or not prep.clim.ok:
                self._now(res, variable())
                continue
            concept = self._concepts[selected.variable_id]
            kind = str(concept.get("data_kind") or "continuous")
            base = dict(kind="variable", item_id=selected.variable_id, metric_id=VARIABLE_METRIC_ID,
                        unit=prep.series.unit, cadence="monthly", product_id=product_id,
                        scale_sd=prep.anomaly_sd_baseline)
            self._queue(groups, ("variable", selected.variable_id, product_id, a, b, a, b, kind, 0),
                        _Row(index, self._slot(res), prep.series.t, prep.anomaly, cand.region_id, variable, base,
                             (decision.status, decision.status_reason)))
        if self._recipes:
            recipe_decisions = eng.resolver.resolve_recipe_inputs(self.plan, cand.region_id, period, cand.decisions)
        for rid, req, recipe in self._recipes:
            decision = recipe_decisions[req["variable_id"]]
            product_id = decision.selected_product_id
            comp = eng._computation(rid, cand.region_id, product_id)
            cache: dict[str, MetricOutcome] = {}

            def recipe_metric(metric_id: str, rid=rid, cache=cache, recipe_decisions=recipe_decisions) -> MetricOutcome:
                if not cache:
                    out = eng._analyse_recipe(rid, recipe_decisions, cand.region_id, period, True)
                    cache.update({m.metric_id: m for m in out.metrics})
                return cache[metric_id]

            scale = int(recipe["computation"]["parameters"].get("scale_months", 1))
            blocked = comp.status not in ("ok", "insufficient_data")
            for metric in comp.metrics.values():
                def delegate(metric_id=metric.metric_id, recipe_metric=recipe_metric) -> MetricOutcome:
                    return recipe_metric(metric_id)

                window = None
                if not blocked and metric.t.size and metric.status in ("ok", "insufficient_data"):
                    if metric.cadence == "monthly":
                        mask, window = (metric.t >= a) & (metric.t <= b), (a, b)
                    else:
                        mask = ev_rules.years_inside(metric.t, a, b)
                        years = metric.t[mask]
                        window = (int(years[0]), int(years[-1])) if years.size else None
                    if window is not None and not np.isfinite(metric.values[mask]).any():
                        window = None
                if window is None:
                    self._now(res, delegate())
                    continue
                index_scale = scale if metric.cadence == "monthly" and scale else 0
                kind = "index" if index_scale else metric.data_kind
                base = dict(kind="derived_indicator", item_id=rid, metric_id=metric.metric_id, unit=metric.unit,
                            cadence=metric.cadence, product_id=product_id)
                self._queue(groups, ("recipe", metric.metric_id, product_id, a, b, window[0], window[1], kind,
                                     index_scale),
                            _Row(index, self._slot(res), metric.t, metric.values, cand.region_id, delegate, base))
        for phenomenon_id in self._recorded:
            out = eng._analyse_recorded(phenomenon_id, cand.region_id, period, True)
            for metric in out.metrics:
                self._now(res, metric)

    @staticmethod
    def _slot(res: CandidateResult) -> int:
        res.facts.append(None)                  # type: ignore[arg-type]  # filled by the group fit
        return len(res.facts) - 1

    def _now(self, res: CandidateResult, outcome: MetricOutcome) -> None:
        self.rows_delegated += 1
        res.facts.append(MetricFacts.from_outcome(outcome))

    @staticmethod
    def _queue(groups: dict[tuple, list[_Row]], key: tuple, row: _Row) -> None:
        groups.setdefault(key, []).append(row)

    # ------------------------------------------------------------------ group fit

    def _geometry_version(self, region_id: str) -> str:
        return self._regions[region_id].get("geometry_version") or f"no-geometry@{self._region_version}"

    def _fit_group(self, key: tuple, rows: list[_Row], results: list[CandidateResult]) -> None:
        """One ``fit_trend_batch`` call for every region of one (unit, product, period, window)."""
        unit_kind, _, _, _, _, w0, w1, data_kind, index_scale = key
        cadence = rows[0].base["cadence"]
        grid = np.vstack([grid_row(r.t, r.values, w0, w1) for r in rows])
        tgrid = np.arange(w0, w1 + 1, dtype=np.int64)
        fit = fit_trend_batch(tgrid, grid, cadence=cadence, policy=self.policy, data_kind=data_kind,
                              period=(w0, w1))
        ok = np.array(fit.inference_ok, dtype=bool)
        p_raw = np.array(fit.p_raw, dtype=np.float64)
        engine_only = np.asarray(fit.n_valid) == 0            # the engine words this case itself
        need = max(int(index_scale) - 1, 0)
        if index_scale and need:
            # method_policy.monthly_index_metric: the HAC lag of a k-month index is at least k-1
            redo = np.flatnonzero(ok & (np.asarray(fit.lag) < need))
            if redo.size:
                refit = fit_trend_batch(tgrid, grid[redo], cadence=cadence, policy=self.policy,
                                        data_kind=data_kind, period=(w0, w1), fixed_lag=need)
                good = np.array(refit.inference_ok, dtype=bool) & (np.asarray(refit.lag) >= need)
                p_raw[redo[good]] = np.asarray(refit.p_raw)[good]
                engine_only[redo[~good]] = True               # lag cannot be reached: engine's wording
        if unit_kind == "variable":
            first, second = half_slopes_batch(grid, 12 if cadence == "monthly" else 1)
        self.groups_fitted += 1
        self.rows_fitted += len(rows)

        reference = rows[0].delegate()                        # the engine's own result of row 0
        template = dict(reference.components)
        for i, row in enumerate(rows):
            if i == 0 or engine_only[i]:
                outcome = reference if i == 0 else row.delegate()
                facts = MetricFacts.from_outcome(outcome)
                if i == 0 and not engine_only[0]:
                    self._verify(key, row, facts, fit, ok, p_raw, template)
                results[row.cand].facts[row.slot] = facts
                continue
            components = dict(template)
            components["region_id"] = row.region_id
            components["geometry_version"] = self._geometry_version(row.region_id)
            hyp_id = hypothesis_id(components)
            describable = bool(fit.describable[i])
            tested = bool(ok[i]) and math.isfinite(p_raw[i]) and 0.0 <= p_raw[i] <= 1.0
            reason = None
            if not tested:
                reason = fit.row(i).inference_reason or "inference not applicable"
            record = C.HypothesisRecord(hypothesis_id=hyp_id, components=components,
                                        p_raw=float(p_raw[i]) if tested else None, tested=tested,
                                        untested_reason=reason)
            status, status_reason = row.status
            if not describable:
                status, status_reason = "insufficient_data", reason
            results[row.cand].facts[row.slot] = MetricFacts(
                **row.base, status=status, status_reason=status_reason, hypothesis_id=hyp_id, record=record,
                slope_per_decade=_opt(fit.slope_per_decade[i]) if describable else None,
                inference_ok=tested, inference_reason=reason, p_raw=float(p_raw[i]) if tested else None,
                coverage=float(fit.coverage[i]), n_valid=int(fit.n_valid[i]), n_expected=int(fit.n_expected),
                half_slopes=(_opt(first[i]), _opt(second[i])) if unit_kind == "variable" else (None, None))

    def _verify(self, key: tuple, row: _Row, engine_facts: MetricFacts, fit: Any, ok: np.ndarray,
                p_raw: np.ndarray, template: dict[str, Any]) -> None:
        """Row 0 of the batch must be the engine's result (ids, slope, raw p, tested flag)."""
        components = dict(template)
        components["region_id"] = row.region_id
        components["geometry_version"] = self._geometry_version(row.region_id)
        tested = bool(ok[0]) and math.isfinite(p_raw[0])
        slope = _opt(fit.slope_per_decade[0]) if bool(fit.describable[0]) else None
        same = (hypothesis_id(components) == engine_facts.hypothesis_id
                and tested == engine_facts.record.tested
                and _close(float(p_raw[0]) if tested else None, engine_facts.record.p_raw)
                and _close(slope, engine_facts.slope_per_decade))
        if not same:
            raise AquaError("internal_error",
                            f"preset batch analysis disagrees with the research engine for {row.region_id} "
                            f"{key[:5]}; the search is not published")
