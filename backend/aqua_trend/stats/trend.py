"""TrendEngine: OLS slope with calendar-lag HAC uncertainty (spec §7.2).

Model (after the fixed-baseline seasonal step, or for an annual series)

    a_t = alpha + beta * tau_t + eps_t

* ``tau`` are TRUE time coordinates in years: (month index - first month) / 12,
  or (year - first year).  A missing month keeps its calendar position; the
  remaining samples are never treated as neighbours (acceptance T04).
* ``beta`` is estimated by OLS on the valid samples.
* Its variance is a Bartlett-kernel HAC estimate built from the slope score
  h_t = (tau_t - mean(tau)) * e_t / Sxx placed on the full calendar grid with
  h_t = 0 for missing months, so every lag is a calendar lag (the
  amplitude-modulated estimator of Datta & Du 2012).  The bandwidth rule is one
  fixed, versioned policy (``stats.policy``); the variance carries the
  n / (n - 2) small-sample factor and the reference distribution is Student t
  with the degrees of freedom given by the selected lag policy (``_reference_dof``).
* Inference is only reported when the applicability gate of the method policy
  holds.  Otherwise the descriptive slope is returned with CI / p = None and a
  readable reason (never NaN / Infinity, never a fake "not significant").

``fit_trend_batch`` holds the numerical core, vectorised over rows (regions);
``fit_trend`` is that core for one row plus the informational diagnostics.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Sequence

import numpy as np
from scipy import stats as _sps

from ..contracts import Diagnostic
from .policy import (
    COVARIANCE_KIND,
    GATE_DEFAULTS,
    LAG_RULE_CONSTANT,
    NW94_BARTLETT_CONSTANT,
    PREWHITEN_RHO_CAP,
    PREWHITEN_RHO_FLOOR,
    LagPolicy,
    diagnostic_thresholds,
    lag_policy_from,
)

_STEPS_PER_YEAR = {"monthly": 12, "annual": 1}
_STEP_NAME = {"monthly": "months", "annual": "years"}

#: applicability-gate codes in order of precedence (the first failing one is the primary reason)
GATE_CODES: tuple[str, ...] = (
    "non_finite_values",
    "too_few_samples_to_describe",
    "constant_series",
    "span_too_short",
    "too_few_valid_samples",
    "coverage_too_low",
    "gap_too_long",
    "gap_concentrated",
    "sparse_counts",
    "zero_residual_variance",
)
#: gate failures after which not even a descriptive slope is reported
_NO_SLOPE_CODES = ("too_few_samples_to_describe",)


# --------------------------------------------------------------------------- result types

@dataclass(frozen=True)
class TrendFit:
    """One fitted trend.  ``None`` means "not available"; no field is ever NaN/Infinity."""

    cadence: str
    slope_per_year: Optional[float]
    slope_per_decade: Optional[float]
    #: fitted value at the first time of the analysis window
    intercept: Optional[float]
    ci95_per_decade: Optional[tuple[float, float]]
    p_raw: Optional[float]
    inference_status: str                 # "ok" | "not_applicable"
    inference_reason: Optional[str]
    reason_code: Optional[str]
    lag: Optional[int]
    lag_policy: str
    covariance: Optional[str]             # None when descriptive only
    n_valid: int
    n_expected: int
    coverage: float
    #: longest run of missing steps between valid samples (leading / trailing missing steps
    #: are not a gap; see first_valid / last_valid and coverage)
    longest_gap: int
    diagnostics: list[Diagnostic] = field(default_factory=list)
    se_per_decade: Optional[float] = None
    ci_level: float = 0.95
    interval_scope: str = "pointwise"
    #: degrees of freedom of the t reference distribution
    dof: Optional[float] = None
    prewhiten_rho: Optional[float] = None
    resid_autocorr_lag1: Optional[float] = None
    #: analysis window on the native time axis (month index or year), inclusive
    t_start: int = 0
    t_end: int = 0
    first_valid: Optional[int] = None
    last_valid: Optional[int] = None

    def fitted(self, t) -> Optional[np.ndarray]:
        """Fitted line at native time coordinates ``t`` (None when no slope can be described)."""
        if self.slope_per_year is None or self.intercept is None:
            return None
        tau = (np.asarray(t, dtype=np.float64) - self.t_start) / _STEPS_PER_YEAR[self.cadence]
        return self.intercept + self.slope_per_year * tau


@dataclass(frozen=True)
class BatchTrendFit:
    """Row-wise results of ``fit_trend_batch``.  Float arrays use NaN for "not available"."""

    cadence: str
    t_start: int
    t_end: int
    n_expected: int
    lag_policy: str
    ci_level: float
    interval_scope: str
    slope_per_year: np.ndarray
    slope_per_decade: np.ndarray
    intercept: np.ndarray
    se_per_decade: np.ndarray
    ci_lo_per_decade: np.ndarray
    ci_hi_per_decade: np.ndarray
    p_raw: np.ndarray
    inference_ok: np.ndarray              # bool
    describable: np.ndarray               # bool: a descriptive slope exists
    lag: np.ndarray                       # int, -1 = none
    prewhiten_rho: np.ndarray
    dof: np.ndarray
    resid_autocorr_lag1: np.ndarray
    n_valid: np.ndarray
    coverage: np.ndarray
    longest_gap: np.ndarray               # longest run of missing steps BETWEEN valid samples
    n_missing: np.ndarray                 # missing steps in the analysis window (edges included)
    n_gap_missing: np.ndarray             # missing steps between the first and last valid sample
    first_valid: np.ndarray               # native time, -1 = none
    last_valid: np.ndarray
    n_nonzero: np.ndarray
    gate_fail: np.ndarray                 # bool [R, len(GATE_CODES)]
    gate_enforced: bool
    _limits: dict[str, Any] = field(default_factory=dict, repr=False)

    def __len__(self) -> int:
        return int(self.slope_per_year.shape[0])

    def gate_diagnostics(self, i: int) -> list[Diagnostic]:
        """Blocking diagnostics for every applicability check that row ``i`` fails."""
        return [
            Diagnostic(code=code, severity="blocking", message=self._gate_message(code, i))
            for k, code in enumerate(GATE_CODES) if self.gate_fail[i, k]
        ]

    def _gate_message(self, code: str, i: int) -> str:
        lim, unit = self._limits, _STEP_NAME[self.cadence]
        n, miss, gap = int(self.n_valid[i]), int(self.n_gap_missing[i]), int(self.longest_gap[i])
        if code == "non_finite_values":
            return "the series contains non-finite numbers (infinite values or an overflowing fit); no inference"
        if code == "too_few_samples_to_describe":
            return f"{n} valid {unit}; at least {lim['describe_min']} are needed to describe a slope"
        if code == "constant_series":
            return "the series is constant: the slope is 0 and there is no variability to test"
        if code == "span_too_short":
            span = (int(self.last_valid[i]) - int(self.first_valid[i]) + 1) / _STEPS_PER_YEAR[self.cadence]
            return f"valid data span {span:.1f} years; inference needs at least {lim['min_span_years']} years"
        if code == "too_few_valid_samples":
            return f"{n} valid {unit}; inference needs at least {lim['min_valid']}"
        if code == "coverage_too_low":
            return (f"coverage {float(self.coverage[i]):.0%} of the analysis period "
                    f"({n} of {self.n_expected} {unit}); inference needs at least {lim['min_coverage']:.0%}")
        if code == "gap_too_long":
            return f"longest gap is {gap} {unit}; inference allows at most {lim['max_gap']}"
        if code == "gap_concentrated":
            return (f"one gap of {gap} {unit} holds {gap / max(miss, 1):.0%} of the {miss} {unit} missing "
                    f"between the first and last valid sample (limit {lim['max_gap_share']:.0%}); "
                    "the gap-aware covariance was not validated for this pattern")
        if code == "sparse_counts":
            return (f"only {int(self.n_nonzero[i])} {unit} with a non-zero count; "
                    f"inference needs at least {lim['min_nonzero']}")
        if code == "zero_residual_variance":
            return "the residuals of the linear fit are zero: no variability to base an interval or p-value on"
        return code  # pragma: no cover

    def row(self, i: int) -> TrendFit:
        """Row ``i`` as a ``TrendFit`` (gate diagnostics only; see ``fit_trend`` for the full set)."""
        diags = self.gate_diagnostics(i)
        ok = bool(self.inference_ok[i])
        describable = bool(self.describable[i])
        reason = None if ok else ("; ".join(d.message for d in diags) or "inference not applicable")
        return TrendFit(
            cadence=self.cadence,
            slope_per_year=_opt(self.slope_per_year[i]) if describable else None,
            slope_per_decade=_opt(self.slope_per_decade[i]) if describable else None,
            intercept=_opt(self.intercept[i]) if describable else None,
            ci95_per_decade=(float(self.ci_lo_per_decade[i]), float(self.ci_hi_per_decade[i])) if ok else None,
            p_raw=float(self.p_raw[i]) if ok else None,
            inference_status="ok" if ok else "not_applicable",
            inference_reason=reason,
            reason_code=None if ok else (diags[0].code if diags else None),
            lag=int(self.lag[i]) if ok else None,
            lag_policy=self.lag_policy,
            covariance=COVARIANCE_KIND if ok else None,
            n_valid=int(self.n_valid[i]),
            n_expected=self.n_expected,
            coverage=float(self.coverage[i]),
            longest_gap=int(self.longest_gap[i]),
            diagnostics=diags,
            se_per_decade=_opt(self.se_per_decade[i]) if ok else None,
            ci_level=self.ci_level,
            interval_scope=self.interval_scope,
            dof=_opt(self.dof[i]) if ok else None,
            prewhiten_rho=_opt(self.prewhiten_rho[i]) if ok else None,
            resid_autocorr_lag1=_opt(self.resid_autocorr_lag1[i]) if describable else None,
            t_start=self.t_start,
            t_end=self.t_end,
            first_valid=int(self.first_valid[i]) if self.n_valid[i] > 0 else None,
            last_valid=int(self.last_valid[i]) if self.n_valid[i] > 0 else None,
        )


def _opt(x) -> Optional[float]:
    x = float(x)
    return x if np.isfinite(x) else None


# --------------------------------------------------------------------------- time grid

def _to_grid(t, Y, period: Optional[tuple[int, int]]) -> tuple[int, np.ndarray]:
    """Place the rows of ``Y`` on the complete calendar grid of the analysis window.

    Returns (first native time of the window, Y on the grid with NaN for absent steps).
    ``t`` may skip steps (rows dropped by the caller): calendar distance is kept.
    """
    t = np.asarray(t)
    if t.ndim != 1 or t.size != Y.shape[1]:
        raise ValueError("t must be 1-D and match the time dimension of the values")
    if t.size and not np.all(np.isfinite(t.astype(np.float64))):
        raise ValueError("time coordinates must be finite")
    ti = t.astype(np.int64)
    if t.size and not np.array_equal(ti, t):
        raise ValueError("time coordinates must be integer month indices (monthly) or years (annual)")
    if ti.size > 1 and not np.all(np.diff(ti) > 0):
        raise ValueError("time coordinates must be strictly increasing")
    if period is None:
        if ti.size == 0:
            raise ValueError("an empty series needs an explicit analysis period")
        start, end = int(ti[0]), int(ti[-1])
    else:
        start, end = int(period[0]), int(period[1])
        if end < start:
            raise ValueError("analysis period end precedes its start")
    inside = (ti >= start) & (ti <= end)
    grid = np.full((Y.shape[0], end - start + 1), np.nan)
    grid[:, ti[inside] - start] = Y[:, inside]
    return start, grid


def _longest_false_run(mask: np.ndarray) -> np.ndarray:
    """Length of the longest run of False per row (runs touching the edges included)."""
    idx = np.arange(mask.shape[1])
    last_true = np.maximum.accumulate(np.where(mask, idx, -1), axis=1)
    return (idx - last_true).max(axis=1) if mask.shape[1] else np.zeros(mask.shape[0], dtype=np.int64)


# --------------------------------------------------------------------------- HAC core

def _autocov_sums(u: np.ndarray, max_lag: int) -> np.ndarray:
    """c[:, j] = sum_t u_t u_{t+j} for j = 0..max_lag (calendar lags on the zero-filled grid)."""
    n_t = u.shape[1]
    c = np.zeros((u.shape[0], max_lag + 1))
    for j in range(min(max_lag, n_t - 1) + 1):
        c[:, j] = np.einsum("ij,ij->i", u[:, : n_t - j], u[:, j:])
    return c


def _rule_of_thumb_lag(span: np.ndarray) -> np.ndarray:
    """floor(c * (T/100)^(2/9)) with T the calendar span in steps."""
    return np.floor(LAG_RULE_CONSTANT * (np.maximum(span, 1) / 100.0) ** (2.0 / 9.0)).astype(np.int64)


def hac_slope_variance(h: np.ndarray, span: np.ndarray, lag_policy: LagPolicy,
                       fixed_lag: Optional[int] = None, valid: Optional[np.ndarray] = None,
                       ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Bartlett HAC long-run sum of the zero-filled slope scores ``h`` [R, T].

    Returns (variance of the slope without the small-sample factor, lag used, prewhitening rho).

    * Calendar lags: ``h`` sits on the full grid, 0 where the month is missing, so the
      product h_t h_{t+j} pairs samples that are exactly j steps apart.
    * Prewhitening: u_t = h_t - rho h_{t-1} with rho the lag-1 regression coefficient of
      the scores, estimated ONLY from pairs observed exactly one step apart (``valid``;
      a zero-filled pair would attenuate rho) and limited to
      PREWHITEN_RHO_FLOOR <= rho <= PREWHITEN_RHO_CAP.  The floor is 0: a negative
      estimate would divide the variance by (1 - rho)^2 > 1, i.e. narrow the interval on
      the strength of a noisy coefficient, so only non-negative persistence is prewhitened.
      The long-run sum of ``u`` is divided by (1 - rho)^2 (recolouring).
    * The filter runs over the WHOLE zero-padded series, t = 0..T (T + 1 values, with
      h_{-1} = h_T = 0), so no score is dropped - the first and last scores carry the
      largest leverage of a trend regression - and sum(u) = (1 - rho) sum(h) holds exactly;
      every autocovariance sum of ``u`` is then a function of those of ``h``:
      c_u(j) = (1 + rho^2) c_h(j) - rho (c_h(j-1) + c_h(j+1)).  Lags stay calendar lags.
    * ``fixed_lag`` overrides the bandwidth rule (used by reference tests).
    """
    n_rows, n_t = h.shape
    rho = np.zeros(n_rows)
    u = h
    if lag_policy.prewhiten and n_t > 1:
        prev = h[:, :-1]
        if valid is not None:
            prev = prev * valid[:, 1:]                       # only pairs observed exactly one step apart
        den = np.einsum("ij,ij->i", prev, prev)
        num = np.einsum("ij,ij->i", h[:, 1:], prev)
        with np.errstate(divide="ignore", invalid="ignore"):
            rho = np.where(den > 0, num / den, 0.0)
        rho = np.clip(rho, PREWHITEN_RHO_FLOOR, PREWHITEN_RHO_CAP)
        zero = np.zeros((n_rows, 1))
        padded = np.concatenate([zero, h, zero], axis=1)
        u = padded[:, 1:] - rho[:, None] * padded[:, :-1]     # T + 1 values: nothing is dropped

    max_allowed = np.maximum(span - 1, 0)
    n_w = np.minimum(_rule_of_thumb_lag(span), max_allowed)
    if fixed_lag is not None:
        lag = np.minimum(np.full(n_rows, int(fixed_lag), dtype=np.int64), max_allowed)
        c = _autocov_sums(u, int(lag.max(initial=0)))
    elif lag_policy.rule == "fixed":
        lag = n_w
        c = _autocov_sums(u, int(lag.max(initial=0)))
    elif lag_policy.rule == "nw94":
        c = _autocov_sums(u, int(n_w.max(initial=0)))
        j = np.arange(c.shape[1])
        use = (j[None, :] >= 1) & (j[None, :] <= n_w[:, None])
        s0 = c[:, 0] + 2.0 * np.sum(np.where(use, c, 0.0), axis=1)
        s1 = 2.0 * np.sum(np.where(use, c * j[None, :], 0.0), axis=1)
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = np.where(s0 != 0, s1 / s0, 0.0)
        gamma = NW94_BARTLETT_CONSTANT * (ratio ** 2) ** (1.0 / 3.0)
        lag = np.floor(gamma * np.maximum(span, 1) ** (1.0 / 3.0))
        lag = np.minimum(np.where(np.isfinite(lag), lag, 0).astype(np.int64), max_allowed)
        if int(lag.max(initial=0)) + 1 > c.shape[1]:
            c = _autocov_sums(u, int(lag.max()))
    else:  # pragma: no cover
        raise ValueError(f"unknown lag rule {lag_policy.rule!r}")

    j = np.arange(c.shape[1])
    w = np.clip(1.0 - j[None, :] / (lag[:, None] + 1.0), 0.0, None)
    w[:, 0] = 0.0
    long_run = c[:, 0] + 2.0 * np.sum(w * c, axis=1)
    return long_run / (1.0 - rho) ** 2, lag, rho


def _reference_dof(lp: LagPolicy, n: np.ndarray, d: np.ndarray, lag: np.ndarray, rho: np.ndarray) -> np.ndarray:
    """Degrees of freedom of the Student-t reference distribution (>= 1).

    ``n_minus_2``     classical n_valid - 2.
    ``neff``          n_eff - 2 with n_eff = n_valid (1 - rho) / (1 + rho) for rho > 0.
    ``satterthwaite`` moment-matching degrees of freedom of the HAC variance itself.  For
                      independent normal errors the lag-0 term sum_t d_t^2 e_t^2 behaves like a
                      scaled chi-square with (sum d^2)^2 / sum d^4 degrees of freedom (for a
                      linear time regressor about 5/9 of n, because the end points carry the
                      leverage); the Bartlett-weighted lag terms add variance in proportion to
                      sum_{|j|<=L} w_j^2; positive autocorrelation reduces the count by
                      (1 - rho) / (1 + rho).  An approximation, justified by the calibration only.
    """
    n = n.astype(np.float64)
    rho_pos = np.clip(rho, 0.0, None)
    shrink = (1.0 - rho_pos) / (1.0 + rho_pos)
    if lp.dof_rule == "n_minus_2":
        dof = n - 2.0
    elif lp.dof_rule == "neff":
        dof = n * shrink - 2.0
    elif lp.dof_rule == "satterthwaite":
        d2 = np.einsum("ij,ij->i", d, d)
        d4 = np.einsum("ij,ij->i", d * d, d * d)
        base = np.where(d4 > 0, d2 * d2 / np.where(d4 > 0, d4, 1.0), 1.0)
        j = np.arange(1, int(lag.max(initial=0)) + 1)
        w = np.clip(1.0 - j[None, :] / (lag[:, None] + 1.0), 0.0, None)
        dof = np.minimum(base / (1.0 + 2.0 * np.sum(w * w, axis=1)) * shrink, n - 2.0)
    else:  # pragma: no cover
        raise ValueError(f"unknown dof rule {lp.dof_rule!r}")
    return np.maximum(dof, 1.0)


# --------------------------------------------------------------------------- gate

def _limits(cadence: str, policy: Mapping[str, Any]) -> dict[str, Any]:
    """Thresholds of the applicability gate, read from the method policy."""
    desc = policy["descriptive_minimum"]
    if cadence == "monthly":
        inf = policy["monthly_inference"]
        return {
            "describe_min": int(desc["monthly_valid_months"]),
            "min_span_years": inf.get("min_span_years"),
            "min_valid": int(inf["min_valid_months"]),
            "min_coverage": float(inf["min_coverage"]),
            "max_gap": inf.get("max_gap_months"),
            "max_gap_share": inf.get("max_gap_share_in_one_block"),
            "gap_share_min_block": inf.get(
                "gap_concentration_min_block_months", GATE_DEFAULTS["gap_concentration_min_block_months"]),
            "min_nonzero": None,
        }
    inf = policy["annual_inference"]
    return {
        "describe_min": int(desc["annual_valid_years"]),
        "min_span_years": None,
        "min_valid": int(inf["min_valid_years"]),
        "min_coverage": float(inf["min_coverage"]),
        "max_gap": inf.get("max_gap_years"),
        "max_gap_share": None,
        "gap_share_min_block": None,
        "min_nonzero": inf.get("min_nonzero_years_for_counts"),
    }


# --------------------------------------------------------------------------- batch fit

def fit_trend_batch(t, Y, *, cadence: str, policy: Mapping[str, Any], data_kind: str = "continuous",
                    period: Optional[tuple[int, int]] = None, lag_policy: Optional[str] = None,
                    fixed_lag: Optional[int] = None, enforce_gate: bool = True) -> BatchTrendFit:
    """Fit the linear trend of every row of ``Y`` [R, T] on the shared time axis ``t``.

    t         integer month indices (``cadence="monthly"``) or years (``"annual"``)
    Y         values, NaN = missing (never filled)
    period    inclusive analysis window on the native axis; default first..last of ``t``.
              Coverage and the intercept refer to this window.
    lag_policy / fixed_lag / enforce_gate
              for the calibration study and reference tests only; production callers
              leave them at their defaults (policy-selected lag rule, gate enforced).
    """
    if cadence not in _STEPS_PER_YEAR:
        raise ValueError(f"unsupported cadence {cadence!r}")
    Y = np.atleast_2d(np.asarray(Y, dtype=np.float64))
    lp = lag_policy_from(policy, lag_policy)
    lim = _limits(cadence, policy)
    tol = float(policy["constant_tolerance"])
    ci_level = float(policy.get("ci_level", 0.95))
    steps = _STEPS_PER_YEAR[cadence]

    start, G = _to_grid(t, Y, period)
    n_rows, n_t = G.shape
    has_inf = np.isinf(G).any(axis=1)
    M = np.isfinite(G)
    Y0 = np.where(M, G, 0.0)
    n = M.sum(axis=1)
    tau = np.arange(n_t, dtype=np.float64) / steps
    idx = np.arange(n_t)

    first = np.where(n > 0, np.argmax(M, axis=1), -1)
    last = np.where(n > 0, n_t - 1 - np.argmax(M[:, ::-1], axis=1), -1)
    span = np.where(n > 0, last - first + 1, 0)
    # A gap is a run of missing steps BETWEEN valid samples.  Missing steps before the first
    # or after the last valid sample shorten the supported span (they are reported through
    # first_valid / last_valid, coverage and the span / sample-count checks); they do not
    # separate observations, and the fit and its variance are identical to those of the
    # trimmed window, so they must not trip the gap checks.
    inside = (idx[None, :] >= first[:, None]) & (idx[None, :] <= last[:, None])
    longest_gap = _longest_false_run(M | ~inside)
    n_missing = n_t - n
    n_gap_missing = span - n
    coverage = n / n_t
    n_nonzero = (M & (G != 0)).sum(axis=1)

    with np.errstate(all="ignore"):
        n_safe = np.maximum(n, 1)
        tbar = (M * tau).sum(axis=1) / n_safe
        ybar = Y0.sum(axis=1) / n_safe
        d = (tau[None, :] - tbar[:, None]) * M
        sxx = np.einsum("ij,ij->i", d, d)
        slope = np.where(sxx > 0, np.einsum("ij,ij->i", d, Y0) / np.where(sxx > 0, sxx, 1.0), np.nan)
        intercept = ybar - slope * tbar                       # fitted value at tau = 0 (window start)
        e = (Y0 - ybar[:, None] - slope[:, None] * (tau[None, :] - tbar[:, None])) * M
        scale = np.maximum(1.0, np.abs(Y0).max(axis=1, initial=0.0))
        ymax = np.where(M, G, -np.inf).max(axis=1, initial=-np.inf)
        ymin = np.where(M, G, np.inf).min(axis=1, initial=np.inf)
        constant = (n > 0) & ((ymax - ymin) <= tol * scale)
        slope = np.where(constant, 0.0, slope)
        intercept = np.where(constant, ybar, intercept)
        e = np.where(constant[:, None], 0.0, e)
        overflow = ~np.isfinite(slope) | ~np.isfinite(intercept) | ~np.isfinite(e).all(axis=1)
        e = np.where(np.isfinite(e), e, 0.0)
        rss = np.einsum("ij,ij->i", e, e)
        zero_resid = np.abs(e).max(axis=1, initial=0.0) <= tol * scale

        # residual lag-1 autocorrelation from calendar-adjacent valid pairs
        pairs = (M[:, 1:] & M[:, :-1]).sum(axis=1)
        num = np.einsum("ij,ij->i", e[:, 1:], e[:, :-1])
        r1 = np.where((pairs > 0) & (rss > 0), (num / np.maximum(pairs, 1)) / (rss / n_safe), np.nan)
        r1 = np.clip(r1, -1.0, 1.0)

        h = d * e / np.where(sxx > 0, sxx, 1.0)[:, None]
        var, lag, rho = hac_slope_variance(h, span, lp, fixed_lag, M)
        dof = _reference_dof(lp, n, d, lag, rho)
        var = var * n / np.maximum(n - 2, 1)
        se = np.sqrt(np.maximum(var, 0.0))
        tcrit = _sps.t.ppf(0.5 + ci_level / 2.0, np.maximum(dof, 1))
        tstat = np.where(se > 0, slope / np.where(se > 0, se, 1.0), np.nan)
        p = 2.0 * _sps.t.sf(np.abs(tstat), np.maximum(dof, 1))

    fail = np.zeros((n_rows, len(GATE_CODES)), dtype=bool)
    col = {c: k for k, c in enumerate(GATE_CODES)}
    describe_min = max(lim["describe_min"], 2)
    fail[:, col["non_finite_values"]] = has_inf | (overflow & (n >= describe_min) & ~constant)
    fail[:, col["too_few_samples_to_describe"]] = (n < describe_min) | (sxx <= 0)
    fail[:, col["constant_series"]] = constant
    if lim["min_span_years"] is not None:
        fail[:, col["span_too_short"]] = span / steps < lim["min_span_years"]
    fail[:, col["too_few_valid_samples"]] = n < lim["min_valid"]
    fail[:, col["coverage_too_low"]] = coverage < lim["min_coverage"]
    if lim["max_gap"] is not None:
        fail[:, col["gap_too_long"]] = longest_gap > lim["max_gap"]
    if lim["max_gap_share"] is not None:
        fail[:, col["gap_concentrated"]] = (
            (longest_gap > lim["gap_share_min_block"])
            & (longest_gap > lim["max_gap_share"] * np.maximum(n_gap_missing, 1))
        )
    if data_kind == "count" and lim["min_nonzero"] is not None:
        fail[:, col["sparse_counts"]] = n_nonzero < lim["min_nonzero"]
    fail[:, col["zero_residual_variance"]] = zero_resid & ~constant

    describable = ~fail[:, col["too_few_samples_to_describe"]] & ~(overflow & ~constant)
    numerically_ok = (
        describable & ~constant & ~zero_resid & ~has_inf & (dof >= 1)
        & np.isfinite(se) & (se > 0) & np.isfinite(p)
    )
    if enforce_gate:
        inference_ok = numerically_ok & ~fail.any(axis=1)
    else:
        inference_ok = numerically_ok
    # a row that passes every named check but is numerically unusable must still carry a reason
    unexplained = ~inference_ok & ~fail.any(axis=1)
    fail[:, col["zero_residual_variance"]] |= unexplained

    nan = np.nan
    slope_dec = slope * 10.0
    se_dec = se * 10.0
    return BatchTrendFit(
        cadence=cadence, t_start=start, t_end=start + n_t - 1, n_expected=n_t,
        lag_policy=lp.id, ci_level=ci_level, interval_scope=str(policy.get("interval_scope", "pointwise")),
        slope_per_year=np.where(describable, slope, nan),
        slope_per_decade=np.where(describable, slope_dec, nan),
        intercept=np.where(describable, intercept, nan),
        se_per_decade=np.where(inference_ok, se_dec, nan),
        ci_lo_per_decade=np.where(inference_ok, slope_dec - tcrit * se_dec, nan),
        ci_hi_per_decade=np.where(inference_ok, slope_dec + tcrit * se_dec, nan),
        p_raw=np.where(inference_ok, p, nan),
        inference_ok=inference_ok, describable=describable,
        lag=np.where(inference_ok, lag, -1), prewhiten_rho=np.where(inference_ok, rho, nan),
        dof=np.where(inference_ok, dof, nan),
        resid_autocorr_lag1=np.where(describable, r1, nan),
        n_valid=n, coverage=coverage, longest_gap=longest_gap, n_missing=n_missing,
        n_gap_missing=n_gap_missing,
        first_valid=np.where(n > 0, first + start, -1), last_valid=np.where(n > 0, last + start, -1),
        n_nonzero=n_nonzero, gate_fail=fail, gate_enforced=enforce_gate, _limits=lim,
    )


# --------------------------------------------------------------------------- single fit + diagnostics

def _ols_line(tau: np.ndarray, y: np.ndarray) -> Optional[tuple[float, float]]:
    """(slope, intercept) of y on tau for finite pairs; None when not identifiable."""
    ok = np.isfinite(y)
    if ok.sum() < 2:
        return None
    x, v = tau[ok], y[ok]
    dx = x - x.mean()
    sxx = float(dx @ dx)
    if sxx <= 0:
        return None
    b = float(dx @ v) / sxx
    return b, float(v.mean() - b * x.mean())


def half_slopes(t, y, *, cadence: str = "monthly", period: Optional[tuple[int, int]] = None,
                min_valid: int = 3) -> tuple[Optional[float], Optional[float]]:
    """Descriptive OLS slopes (per year) of the first and second half of the analysis window.

    The window is split at its calendar midpoint (not at the median sample), so a gap
    does not move the split.  A half with fewer than ``min_valid`` valid samples (3 is
    the smallest sample for which a line is not an exact interpolation) gives None.
    Used by the stability check of the method policy; purely descriptive, no inference.
    """
    y2 = np.atleast_2d(np.asarray(y, dtype=np.float64))
    _, grid = _to_grid(t, y2, period)
    g = np.where(np.isfinite(grid[0]), grid[0], np.nan)
    tau = np.arange(g.size, dtype=np.float64) / _STEPS_PER_YEAR[cadence]
    mid = g.size // 2
    out: list[Optional[float]] = []
    for sl in (slice(0, mid), slice(mid, g.size)):
        seg = g[sl]
        line = _ols_line(tau[sl], seg) if np.isfinite(seg).sum() >= max(min_valid, 2) else None
        out.append(None if line is None or not np.isfinite(line[0]) else line[0])
    return out[0], out[1]


def _informational_diagnostics(fit: TrendFit, tau: np.ndarray, g: np.ndarray, thr: Mapping[str, float],
                               halves: tuple[Optional[float], Optional[float]]) -> list[Diagnostic]:
    """Diagnostics that inform the reader and never change the estimate (spec §7.2)."""
    out: list[Diagnostic] = []
    unit = _STEP_NAME[fit.cadence]
    n_missing = fit.n_expected - fit.n_valid
    if n_missing > 0:
        out.append(Diagnostic(code="gaps_present", severity="info", message=(
            f"{n_missing} of {fit.n_expected} {unit} are missing (longest gap between valid samples "
            f"{fit.longest_gap}); "
            "missing steps keep their calendar position and are not filled")))
    if fit.slope_per_year is None:
        return out

    r1 = fit.resid_autocorr_lag1
    if r1 is not None:
        strong = r1 >= thr["persistence_warn_r1"]
        out.append(Diagnostic(
            code="strong_persistence" if strong else "residual_autocorrelation",
            severity="warning" if strong else "info",
            message=(f"residual lag-1 autocorrelation {r1:.2f}" + (
                f" is at or above {thr['persistence_warn_r1']:.2f}: a strongly persistent series. In the "
                "calibration study (AR(1) up to 0.98, mean residual autocorrelation up to 0.96) such series "
                "are tested conservatively with very few degrees of freedom, so the interval is wide and a "
                "real trend is hard to detect; long memory or a non-stationary drift was not calibrated and "
                "cannot be told apart from a trend by this test" if strong else ""))))

    if fit.inference_status == "ok" and fit.n_valid < thr["small_sample_warn_n"]:
        out.append(Diagnostic(code="small_sample_inference", severity="warning", message=(
            f"{fit.n_valid} valid {unit}: with fewer than {thr['small_sample_warn_n']:g} samples the "
            "calibration study met its tolerance only for values that are independent from one step to the "
            "next; when consecutive values are correlated it found about 1.5 to 2 times the nominal "
            "false-positive rate and intervals that are too narrow (docs/method-calibration.md §6); the "
            "p-value and interval may be optimistic")))

    ok = np.isfinite(g)
    x, v = tau[ok], g[ok]
    resid = v - (fit.intercept + fit.slope_per_year * x)
    rss = float(resid @ resid)
    if rss > 0 and x.size >= 4:
        xc = x - x.mean()
        q = xc ** 2 - np.mean(xc ** 2)
        q = q - xc * float(q @ xc) / float(xc @ xc)            # orthogonal to constant and linear terms
        qq = float(q @ q)
        if qq > 0:
            gain = (float(q @ resid) ** 2 / qq) / rss
            if gain >= thr["quadratic_rss_gain_warn"]:
                out.append(Diagnostic(code="nonlinear_curvature", severity="warning", message=(
                    f"a quadratic term removes {gain:.0%} of the residual variance of the straight line; "
                    "the linear slope is only the average direction over the analysis period")))
    a, b = halves
    if a is not None and b is not None and a * b < 0:
        out.append(Diagnostic(code="half_slope_sign_change", severity="warning", message=(
            f"the slope changes sign between the first half ({a:.3g} per year) and the second half "
            f"({b:.3g} per year) of the analysis period")))

    if rss > 0 and x.size >= 4:
        med = float(np.median(resid))
        mad = 1.4826 * float(np.median(np.abs(resid - med)))
        if mad > 0:
            far = np.abs(resid - med) / mad > thr["outlier_robust_z"]
            if far.any() and (~far).sum() >= 4:
                xk, vk = x[~far], v[~far]
                line = _ols_line(xk, vk)
                if line is not None:
                    rk = vk - (line[1] + line[0] * xk)
                    se_clean = math.sqrt(float(rk @ rk) / (xk.size - 2) / float(((xk - xk.mean()) ** 2).sum()))
                    change = abs(line[0] - fit.slope_per_year) / se_clean if se_clean > 0 else math.inf
                    influential = change >= thr["outlier_slope_change_se"]
                    out.append(Diagnostic(
                        code="outlier_influence" if influential else "outliers_present",
                        severity="warning" if influential else "info",
                        message=(f"{int(far.sum())} value(s) lie more than {thr['outlier_robust_z']:g} robust "
                                 "standard deviations from the fitted line" + (
                                     "; leaving them out would move the slope by more than "
                                     f"{thr['outlier_slope_change_se']:g} ordinary standard error(s) of the "
                                     "outlier-free fit" if influential else "")
                                 + " (the reported slope keeps them)")))
    return out


def fit_trend(t, y, *, cadence: str, policy: Mapping[str, Any], data_kind: str = "continuous",
              period: Optional[tuple[int, int]] = None, lag_policy: Optional[str] = None,
              fixed_lag: Optional[int] = None, enforce_gate: bool = True) -> TrendFit:
    """Linear trend of one (de-seasonalised or annual) series with HAC inference when applicable.

    See the module docstring for the estimator and ``fit_trend_batch`` for the parameters.
    The returned diagnostics list the applicability failures (severity "blocking") and
    the informational checks: gaps, residual persistence, curvature / half-slope sign
    change, outlier influence.
    """
    y = np.asarray(y, dtype=np.float64)
    if y.ndim != 1:
        raise ValueError("y must be one-dimensional; use fit_trend_batch for several rows")
    batch = fit_trend_batch(t, y[None, :], cadence=cadence, policy=policy, data_kind=data_kind,
                            period=period, lag_policy=lag_policy, fixed_lag=fixed_lag,
                            enforce_gate=enforce_gate)
    fit = batch.row(0)
    _, grid = _to_grid(t, y[None, :], period)
    g = np.where(np.isfinite(grid[0]), grid[0], np.nan)
    tau = np.arange(g.size, dtype=np.float64) / _STEPS_PER_YEAR[cadence]
    halves = half_slopes(t, y, cadence=cadence, period=period)
    info = _informational_diagnostics(fit, tau, g, diagnostic_thresholds(policy), halves)
    fit.diagnostics.extend(info)
    return fit


def fit_rows(t, Y, **kwargs) -> Sequence[TrendFit]:
    """Convenience: ``fit_trend_batch`` unpacked into one ``TrendFit`` per row (gate diagnostics only)."""
    batch = fit_trend_batch(t, Y, **kwargs)
    return [batch.row(i) for i in range(len(batch))]
