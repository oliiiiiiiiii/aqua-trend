"""TrendFit -> contracts.TrendResult (data contract §9.2)."""
from __future__ import annotations

from typing import Any, Mapping, Optional

from ..contracts import Interval, TrendMethod, TrendResult
from .trend import TrendFit


def to_trend_result(fit: TrendFit, *, hypothesis_id: str, metric_id: str, unit: str,
                    seasonal_adjustment: str, policy: Mapping[str, Any],
                    relative_change_per_decade_pct: Optional[float] = None,
                    relative_change_basis: Optional[str] = None) -> TrendResult:
    """Package a fit as the API contract.

    * ``unit`` is the unit of the series; slopes are that unit per year / per decade.
    * The interval is the pointwise CI of the slope (``interval_scope``); it is NOT
      adjusted for multiple comparisons or selection (acceptance T12).
    * Significance is left "undetermined" here: it only exists relative to a
      correction family (``evidence.attach_families``).  When inference is not
      applicable CI / p stay None and the label stays "undetermined".
    * A relative change is only passed through when the caller got an approved
      denominator from the variable concept (spec §7.2); it is never derived here.
    """
    ok = fit.inference_status == "ok"
    return TrendResult(
        hypothesis_id=hypothesis_id,
        metric_id=metric_id,
        unit=unit,
        slope_per_year=fit.slope_per_year,
        slope_per_decade=fit.slope_per_decade,
        intercept=fit.intercept,
        ci95_per_decade=Interval(lo=fit.ci95_per_decade[0], hi=fit.ci95_per_decade[1])
        if ok and fit.ci95_per_decade is not None else None,
        ci_level=fit.ci_level,
        interval_scope="pointwise",
        p_raw=fit.p_raw if ok else None,
        p_adjusted={},
        primary_family_id=None,
        significant=None,
        significance_label="undetermined",
        inference_status="ok" if ok else "not_applicable",
        inference_reason=fit.inference_reason,
        method=TrendMethod(
            estimator="ols",
            covariance=fit.covariance if ok else None,
            lag=fit.lag if ok else None,
            lag_policy=fit.lag_policy,
            seasonal_adjustment=seasonal_adjustment,
            policy_version=str(policy["version"]),
        ),
        n_valid=fit.n_valid,
        n_expected=fit.n_expected,
        coverage=fit.coverage,
        diagnostics=list(fit.diagnostics),
        relative_change_per_decade_pct=relative_change_per_decade_pct,
        relative_change_basis=relative_change_basis,
    )
