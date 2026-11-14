"""Versioned, policy-facing constants of the statistics package.

Numeric *thresholds* of the method policy live in
``backend/catalogue/policies/method_policy.json`` and are passed into the pure
functions as a dict.  This module holds what that file delegates to
``aqua_trend.stats`` (``covariance.lag_policy``): the HAC lag rule that was
selected by the calibration study (docs/method-calibration.md) and the
engineering defaults of the run-time diagnostics.  Every default below can be
overridden from the policy file (``policy["diagnostics"]``,
``policy["covariance"]["lag_policy_id"]``) without touching code.

None of these values is a physical constant or an agency rule; they are
project engineering policy (spec §7.2).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

#: bump when the selected lag rule, the candidate definitions or the diagnostics defaults change
STATS_POLICY_VERSION = "stats-1.1.0"

COVARIANCE_KIND = "hac_bartlett_calendar_lag"


@dataclass(frozen=True)
class LagPolicy:
    """One candidate recipe for the Bartlett-kernel HAC variance of the slope.

    rule
        ``"fixed"``  – L = floor(c * (T/100)^(2/9)), the usual rule-of-thumb
        truncation lag (c = 4).
        ``"nw94"``   – Newey & West (1994) data-dependent bandwidth for the
        Bartlett kernel, L = floor(1.1447 * ((s1/s0)^2)^(1/3) * T^(1/3)),
        with s0, s1 from the first n = floor(c * (T/100)^(2/9)) autocovariances.
    prewhiten
        AR(1) prewhitening of the score series followed by recolouring
        (Andrews & Monahan 1992).  The AR(1) coefficient is estimated from
        pairs of scores observed exactly one calendar step apart, limited to
        [PREWHITEN_RHO_FLOOR, PREWHITEN_RHO_CAP]; the filter covers the whole
        zero-padded series so that no score is dropped.
    dof_rule
        Degrees of freedom of the Student-t reference distribution:
        ``"n_minus_2"``; ``"neff"`` (n_eff - 2 with the effective sample size
        n (1 - rho) / (1 + rho) that is common for trend tests on autocorrelated
        climate series, e.g. Santer et al. 2000); ``"satterthwaite"``
        (moment-matching degrees of freedom of the HAC variance estimate, see
        ``trend._reference_dof``).  Pairing these with a HAC variance is a
        project engineering choice that is justified only by the calibration.
    """

    id: str
    rule: str
    prewhiten: bool
    dof_rule: str = "n_minus_2"


#: candidates evaluated by the calibration study, in order of increasing complexity
#: (ties in the selection rule go to the earlier one). T is the calendar span in time steps.
LAG_POLICIES: dict[str, LagPolicy] = {
    p.id: p
    for p in (
        LagPolicy("fixed", "fixed", False),
        LagPolicy("nw94", "nw94", False),
        LagPolicy("fixed_pw", "fixed", True),
        LagPolicy("nw94_pw", "nw94", True),
        LagPolicy("fixed_pw_neff", "fixed", True, "neff"),
        LagPolicy("nw94_pw_neff", "nw94", True, "neff"),
        LagPolicy("fixed_pw_sdof", "fixed", True, "satterthwaite"),
        LagPolicy("nw94_pw_sdof", "nw94", True, "satterthwaite"),
    )
}

#: rule-of-thumb constant c in floor(c * (T/100)^(2/9)); also the number of
#: autocovariances the NW94 plug-in uses for the Bartlett kernel.
LAG_RULE_CONSTANT = 4.0
#: Bartlett-kernel constant of the Newey–West (1994) plug-in bandwidth.
NW94_BARTLETT_CONSTANT = 1.1447
#: upper bound on the prewhitening AR(1) coefficient. Andrews & Monahan (1992) keep the fitted
#: root away from one; 0.97 is the value commonly attributed to them, but it could not be checked
#: against the primary text during the review - treat it as a project engineering constant.
PREWHITEN_RHO_CAP = 0.97
#: lower bound on the prewhitening coefficient: only non-negative persistence is prewhitened.
#: A negative estimate would shrink the variance by 1 / (1 - rho)^2 on the strength of a noisy
#: coefficient (review of stats-1.0.0: at 20 annual values this alone moved the white-noise
#: false-positive rate from about 0.08 to 0.06). Ignoring true anti-persistence is conservative.
PREWHITEN_RHO_FLOOR = 0.0

#: THE lag policy used in production. Selected by the pre-declared rule in
#: docs/method-calibration.md §3; do not change without re-running the calibration.
DEFAULT_LAG_POLICY_ID = "fixed_pw_sdof"

#: Engineering defaults of the run-time diagnostics (they inform; they never change the estimate).
DIAGNOSTIC_DEFAULTS: dict[str, float] = {
    # residual lag-1 autocorrelation at/above which a series counts as strongly persistent.
    # The stress scenarios AR(1) phi = 0.9 / 0.95 / 0.98 have mean residual r1 0.83-0.96
    # (docs/method-calibration.md §5): there the test is conservative with very few degrees of
    # freedom (wide intervals, low power); anything more persistent, long memory and
    # non-stationary drift are not calibrated at all.
    "persistence_warn_r1": 0.9,
    # number of valid samples below which the inference is flagged: annual series (20-40 values)
    # are inside the tolerance band only when the years are independent; with year-to-year
    # persistence the false-positive rate was 0.07-0.11 (docs/method-calibration.md §6).
    # Monthly inference always has at least monthly_inference.min_valid_months samples.
    "small_sample_warn_n": 100,
    # share of the linear-fit residual sum of squares removed by adding a quadratic term
    "quadratic_rss_gain_warn": 0.10,
    # robust z-score (|e - median| / (1.4826 * MAD)) above which a point counts as an outlier
    "outlier_robust_z": 5.0,
    # slope change when the outliers are left out, in ordinary (iid) standard errors of the
    # outlier-free fit, that turns the note into a warning
    "outlier_slope_change_se": 1.0,
}

#: Guards of the applicability gate that method_policy.json does not (yet) carry.
GATE_DEFAULTS: dict[str, float] = {
    # "gaps concentrated" is only evaluated when the longest gap is longer than this many
    # months: one isolated missing month trivially holds 100 % of the missing months.
    "gap_concentration_min_block_months": 12,
}


def lag_policy_from(policy: Mapping[str, Any] | None, override: str | None = None) -> LagPolicy:
    """Resolve the lag policy: explicit override > policy file id > shipped default."""
    pid = override
    if pid is None and policy is not None:
        pid = (policy.get("covariance") or {}).get("lag_policy_id")
    pid = pid or DEFAULT_LAG_POLICY_ID
    if pid not in LAG_POLICIES:
        raise ValueError(f"unknown lag policy {pid!r}; known: {sorted(LAG_POLICIES)}")
    return LAG_POLICIES[pid]


def diagnostic_thresholds(policy: Mapping[str, Any] | None) -> dict[str, float]:
    """Diagnostics thresholds: shipped defaults overridden by ``policy["diagnostics"]``."""
    out = dict(DIAGNOSTIC_DEFAULTS)
    if policy is not None:
        out.update({k: v for k, v in (policy.get("diagnostics") or {}).items() if v is not None})
    return out
