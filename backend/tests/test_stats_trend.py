"""TrendEngine acceptance tests (T01–T07, T12, D09).

All series in this file are SYNTHETIC TEST DATA generated in the test itself; none of
the numbers is a measurement and none is shipped.  statsmodels is used only here, as
the reference implementation.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)

import statsmodels.api as sm  # noqa: E402

from aqua_trend.contracts import json_safe  # noqa: E402
from aqua_trend.stats import (  # noqa: E402
    anomalies, climatology, fit_trend, fit_trend_batch, half_slopes, to_trend_result,
)
from aqua_trend.stats.policy import (  # noqa: E402
    DEFAULT_LAG_POLICY_ID, LAG_POLICIES, PREWHITEN_RHO_CAP, PREWHITEN_RHO_FLOOR,
)
from aqua_trend.stats.trend import hac_slope_variance  # noqa: E402
from aqua_trend.timeaxis import ym_to_index  # noqa: E402

POLICY = json.loads((Path(__file__).resolve().parents[1] / "catalogue" / "policies" / "method_policy.json").read_text())
T0 = ym_to_index("1995-01")


def _ar1(rng, n, phi, sd=1.0):
    e = rng.normal(0, sd, n)
    x = np.empty(n)
    x[0] = e[0] / math.sqrt(1 - phi * phi)
    for i in range(1, n):
        x[i] = phi * x[i - 1] + e[i]
    return x


def _seasonal_series(n=360, slope_per_year=0.24, noise=0.3, seed=1):
    """TEST DATA: known linear slope + fixed seasonal term + white noise."""
    rng = np.random.default_rng(seed)
    t = T0 + np.arange(n)
    season = 5.0 * np.sin(2 * np.pi * (t % 12) / 12) + 2.0 * np.cos(4 * np.pi * (t % 12) / 12)
    y = 10.0 + slope_per_year * np.arange(n) / 12 + season + rng.normal(0, noise, n)
    return t, y, season


def _reference_hac(tau, y, lag, *, prewhiten=False, dof_rule="n_minus_2"):
    """Independent, loop-based reference: OLS on valid samples with true time coordinates,
    Bartlett HAC of the zero-filled slope scores with calendar lags, n/(n-2) factor."""
    ok = np.isfinite(y)
    n = int(ok.sum())
    x, v = tau[ok], y[ok]
    xm = x.mean()
    sxx = float(((x - xm) ** 2).sum())
    slope = float(((x - xm) * v).sum() / sxx)
    icpt = float(v.mean() - slope * xm)
    h = [((tau[i] - xm) * (y[i] - icpt - slope * tau[i]) / sxx) if ok[i] else 0.0 for i in range(len(y))]
    rho = 0.0
    if prewhiten:
        num = sum(h[i] * h[i - 1] for i in range(1, len(h)) if ok[i] and ok[i - 1])
        den = sum(h[i - 1] ** 2 for i in range(1, len(h)) if ok[i] and ok[i - 1])
        rho = max(PREWHITEN_RHO_FLOOR, min(PREWHITEN_RHO_CAP, num / den))
        hp = [0.0] + h + [0.0]                              # h_{-1} = h_T = 0: every score is filtered
        h = [hp[i] - rho * hp[i - 1] for i in range(1, len(hp))]
    total = sum(a * a for a in h)
    for j in range(1, lag + 1):
        total += 2 * (1 - j / (lag + 1)) * sum(h[i] * h[i + j] for i in range(len(h) - j))
    var = total / (1 - rho) ** 2 * n / (n - 2)
    r = max(rho, 0.0)
    dof = n - 2
    if dof_rule == "neff":
        dof = n * (1 - r) / (1 + r) - 2
    elif dof_rule == "satterthwaite":
        d2 = sum((x_ - xm) ** 2 for x_ in x)
        d4 = sum((x_ - xm) ** 4 for x_ in x)
        kernel = 1 + 2 * sum((1 - j / (lag + 1)) ** 2 for j in range(1, lag + 1))
        dof = min(d2 * d2 / d4 / kernel * (1 - r) / (1 + r), n - 2)
    dof = max(dof, 1.0)
    return slope, icpt, math.sqrt(var), rho, dof


# ----------------------------------------------------------------------------- T01

def test_T01_known_slope_with_fixed_seasonal_term():
    t, y, _ = _seasonal_series()
    clim = climatology(t, y, "1995-01", "2014-12", min_samples=16)
    assert clim.ok and clim.status == "ok"
    a = anomalies(t, y, clim.cycle)
    fit = fit_trend(t, a, cadence="monthly", policy=POLICY)
    assert fit.inference_status == "ok"
    assert fit.slope_per_year == pytest.approx(0.24, abs=0.01)                 # original unit per year
    assert fit.slope_per_decade == pytest.approx(10 * fit.slope_per_year, rel=1e-12)
    lo, hi = fit.ci95_per_decade
    assert lo < 2.4 < hi
    assert fit.p_raw < 1e-6
    # intercept is the fitted value at the first analysis month
    assert fit.fitted([t[0]])[0] == pytest.approx(fit.intercept)
    assert fit.fitted([t[0] + 120])[0] == pytest.approx(fit.intercept + fit.slope_per_decade)
    res = to_trend_result(fit, hypothesis_id="hyp-test", metric_id="anomaly_linear_trend", unit="mm/day",
                          seasonal_adjustment="fixed_baseline_monthly_anomaly", policy=POLICY)
    assert res.unit == "mm/day" and res.method.estimator == "ols"
    assert res.method.covariance == "hac_bartlett_calendar_lag"
    assert res.method.lag_policy == DEFAULT_LAG_POLICY_ID and res.method.policy_version == POLICY["version"]


def test_T01_annual_series_uses_years_as_time_unit():
    rng = np.random.default_rng(3)
    years = np.arange(1990, 2025)
    y = 3.0 + 0.5 * (years - 1990) + rng.normal(0, 1.0, years.size)           # TEST DATA
    fit = fit_trend(years, y, cadence="annual", policy=POLICY)
    assert fit.inference_status == "ok"
    assert fit.slope_per_year == pytest.approx(0.5, abs=0.05)
    assert fit.slope_per_decade == pytest.approx(5.0, abs=0.5)
    assert fit.n_expected == 35


# ----------------------------------------------------------------------------- T02

def test_T02_reference_values_do_not_depend_on_the_analysis_period():
    t, y, _ = _seasonal_series()
    clim = climatology(t, y, "1995-01", "2014-12", min_samples=16)
    a = anomalies(t, y, clim.cycle)
    full = fit_trend(t, a, cadence="monthly", policy=POLICY)
    window = (ym_to_index("2005-01"), ym_to_index("2019-12"))
    part = fit_trend(t, a, cadence="monthly", policy=POLICY, period=window)
    # the fit changes ...
    assert part.n_expected == 180 and full.n_expected == 360
    assert part.slope_per_decade != full.slope_per_decade
    assert part.t_start == window[0] and part.t_end == window[1]
    # ... the monthly reference values and the anomalies do not: the baseline is a function of
    # (series, registered reference period) only and has no analysis-period argument
    clim2 = climatology(t, y, "1995-01", "2014-12", min_samples=16)
    np.testing.assert_array_equal(clim.cycle, clim2.cycle)
    sel = (t >= window[0]) & (t <= window[1])
    np.testing.assert_array_equal(anomalies(t[sel], y[sel], clim.cycle), a[sel])
    # passing only the window's rows gives the same fit as passing the window explicitly
    again = fit_trend(t[sel], a[sel], cadence="monthly", policy=POLICY)
    assert again.slope_per_decade == pytest.approx(part.slope_per_decade, rel=1e-12)
    assert again.ci95_per_decade == pytest.approx(part.ci95_per_decade, rel=1e-10)


# ----------------------------------------------------------------------------- T03

def test_T03_anomaly_plus_cycle_reproduces_raw_and_keeps_the_trend():
    t, y, season = _seasonal_series(noise=0.0)
    y[[17, 18, 200]] = np.nan
    clim = climatology(t, y, "1995-01", "2014-12", min_samples=16)
    a = anomalies(t, y, clim.cycle)
    np.testing.assert_allclose(a + clim.cycle[t % 12], y, rtol=0, atol=1e-12)   # NaN stays NaN
    assert np.isnan(a[17]) and np.isnan(a[200])
    # the fixed pattern removes the seasonal term but not the trend
    assert fit_trend(t, a, cadence="monthly", policy=POLICY).slope_per_year == pytest.approx(0.24, abs=1e-3)
    raw_slope = fit_trend(t, y - season, cadence="monthly", policy=POLICY).slope_per_year
    assert raw_slope == pytest.approx(0.24, abs=1e-9)
    # zero is a value, not a gap
    z = np.zeros(4)
    np.testing.assert_array_equal(anomalies(np.arange(4), z, np.zeros(12)), z)


# ----------------------------------------------------------------------------- T04 / D09

def _gappy_series(seed=7):
    """TEST DATA: persistent noise + curvature, with irregular gaps (first quarter thinned)."""
    rng = np.random.default_rng(seed)
    n = 300
    t = T0 + np.arange(n)
    y = 0.4 * np.arange(n) / 12 + 0.002 * (np.arange(n) / 12) ** 3 + _ar1(rng, n, 0.5)
    miss = np.zeros(n, dtype=bool)
    miss[rng.choice(np.arange(5, 80), 35, replace=False)] = True
    miss[150:158] = True
    y[miss] = np.nan
    return t, y


def test_T04_irregular_gaps_keep_calendar_time():
    t, y = _gappy_series()
    tau = (t - t[0]) / 12.0
    ok = np.isfinite(y)
    fit = fit_trend(t, y, cadence="monthly", policy=POLICY)
    assert fit.inference_status == "ok"

    # reference slope: OLS on the valid samples at their TRUE time coordinates
    ref = sm.OLS(y[ok], sm.add_constant(tau[ok])).fit()
    assert fit.slope_per_year == pytest.approx(ref.params[1], rel=1e-10)
    assert fit.intercept == pytest.approx(ref.params[0], rel=1e-10, abs=1e-10)

    # reference uncertainty: loop implementation with calendar lags on the zero-filled scores
    lp = LAG_POLICIES[DEFAULT_LAG_POLICY_ID]
    slope, _, se, rho, dof = _reference_hac(tau, y, fit.lag, prewhiten=lp.prewhiten, dof_rule=lp.dof_rule)
    assert fit.se_per_decade == pytest.approx(10 * se, rel=1e-9)
    assert fit.prewhiten_rho == pytest.approx(rho, rel=1e-9)
    assert fit.dof == pytest.approx(dof, rel=1e-9)

    # dropping the missing rows but keeping true time gives exactly the same answer
    dropped = fit_trend(t[ok], y[ok], cadence="monthly", policy=POLICY)
    assert dropped.slope_per_decade == pytest.approx(fit.slope_per_decade, rel=1e-12)
    assert dropped.se_per_decade == pytest.approx(fit.se_per_decade, rel=1e-12)
    assert dropped.n_valid == fit.n_valid and dropped.n_expected == fit.n_expected == 300

    # the WRONG answer: valid samples treated as consecutive months
    compressed_tau = np.arange(ok.sum()) / 12.0
    wrong = sm.OLS(y[ok], sm.add_constant(compressed_tau)).fit(
        cov_type="HAC", cov_kwds={"maxlags": fit.lag, "use_correction": True}, use_t=True)
    assert abs(wrong.params[1] - fit.slope_per_year) > 0.02 * abs(fit.slope_per_year)
    # same true-time regression, but HAC lags counted over the compressed row order
    wrong_lags = sm.OLS(y[ok], sm.add_constant(tau[ok])).fit(
        cov_type="HAC", cov_kwds={"maxlags": fit.lag, "use_correction": True}, use_t=True)
    plain = fit_trend(t, y, cadence="monthly", policy=POLICY, lag_policy="fixed", fixed_lag=fit.lag)
    assert plain.slope_per_year == pytest.approx(wrong_lags.params[1], rel=1e-10)
    assert abs(plain.se_per_decade - 10 * wrong_lags.bse[1]) > 1e-3 * plain.se_per_decade


def test_D09_missing_stays_missing_and_zero_is_a_value():
    t = T0 + np.arange(240)
    rng = np.random.default_rng(11)
    y = rng.normal(0, 1, 240)                                                  # TEST DATA
    y[40:43] = np.nan
    y[100] = 0.0
    fit = fit_trend(t, y, cadence="monthly", policy=POLICY)
    assert fit.n_valid == 237 and fit.n_expected == 240 and fit.longest_gap == 3
    assert fit.coverage == pytest.approx(237 / 240)
    assert any(d.code == "gaps_present" for d in fit.diagnostics)
    # replacing the gap by zeros is a different (wrong) data set
    filled = np.where(np.isnan(y), 0.0, y)
    assert fit_trend(t, filled, cadence="monthly", policy=POLICY).n_valid == 240
    # a zero-valued sample counts as valid
    y2 = y.copy()
    y2[100] = np.nan
    assert fit_trend(t, y2, cadence="monthly", policy=POLICY).n_valid == 236


# ----------------------------------------------------------------------------- T05

@pytest.mark.parametrize("phi,lag", [(0.0, 4), (0.5, 4), (0.8, 9)])
def test_T05_hac_matches_statsmodels_on_complete_autocorrelated_series(phi, lag):
    rng = np.random.default_rng(int(phi * 10) + 5)
    n = 264
    t = T0 + np.arange(n)
    y = 0.1 * np.arange(n) / 12 + _ar1(rng, n, phi) if phi else 0.1 * np.arange(n) / 12 + rng.normal(0, 1, n)
    fit = fit_trend(t, y, cadence="monthly", policy=POLICY, lag_policy="fixed", fixed_lag=lag)
    ref = sm.OLS(y, sm.add_constant(np.arange(n) / 12.0)).fit(
        cov_type="HAC", cov_kwds={"maxlags": lag, "use_correction": True}, use_t=True)
    assert fit.lag == lag
    assert fit.slope_per_decade == pytest.approx(10 * ref.params[1], rel=1e-10)
    assert fit.se_per_decade == pytest.approx(10 * ref.bse[1], rel=1e-9)
    assert fit.p_raw == pytest.approx(ref.pvalues[1], rel=1e-7, abs=1e-300)
    assert fit.ci95_per_decade == pytest.approx(tuple(10 * ref.conf_int()[1]), rel=1e-8)


def test_T05_default_policy_widens_uncertainty_for_persistent_series():
    rng = np.random.default_rng(21)
    n = 300
    t = T0 + np.arange(n)
    y = _ar1(rng, n, 0.7)                                                      # TEST DATA, no trend
    fit = fit_trend(t, y, cadence="monthly", policy=POLICY)
    naive = sm.OLS(y, sm.add_constant(np.arange(n) / 12.0)).fit()
    assert fit.se_per_decade > 1.5 * 10 * naive.bse[1]                         # iid errors would be far too narrow
    lp = LAG_POLICIES[DEFAULT_LAG_POLICY_ID]
    _, _, se, _, dof = _reference_hac(np.arange(n) / 12.0, y, fit.lag, prewhiten=lp.prewhiten,
                                      dof_rule=lp.dof_rule)
    assert fit.se_per_decade == pytest.approx(10 * se, rel=1e-9)
    assert fit.dof == pytest.approx(dof)
    assert fit.resid_autocorr_lag1 == pytest.approx(0.7, abs=0.1)


def test_T05_inference_refused_but_description_kept_when_not_applicable():
    rng = np.random.default_rng(22)
    t = T0 + np.arange(96)                                                     # 8 years < 10-year gate
    y = 0.3 * np.arange(96) / 12 + _ar1(rng, 96, 0.6)
    fit = fit_trend(t, y, cadence="monthly", policy=POLICY)
    assert fit.inference_status == "not_applicable"
    assert fit.slope_per_decade is not None and math.isfinite(fit.slope_per_decade)
    assert fit.ci95_per_decade is None and fit.p_raw is None and fit.covariance is None and fit.lag is None
    assert fit.reason_code == "span_too_short" and "10" in fit.inference_reason
    res = to_trend_result(fit, hypothesis_id="h", metric_id="m", unit="u",
                          seasonal_adjustment="fixed_baseline_monthly_anomaly", policy=POLICY)
    assert res.inference_status == "not_applicable" and res.ci95_per_decade is None and res.p_raw is None
    assert res.significant is None and res.significance_label == "undetermined"
    assert res.method.covariance is None and res.slope_per_decade == fit.slope_per_decade


# ----------------------------------------------------------------------------- T06

def _monthly(n, seed=0):
    return T0 + np.arange(n), np.random.default_rng(seed).normal(0, 1, n)


def _case_constant():
    t, _ = _monthly(240)
    return t, np.full(240, 3.5), "monthly", "continuous", "constant_series"


def _case_too_short_to_describe():
    t, y = _monthly(12)
    return t, y, "monthly", "continuous", "too_few_samples_to_describe"


def _case_short():
    t, y = _monthly(60)
    return t, y, "monthly", "continuous", "span_too_short"


def _case_sparse():
    t, y = _monthly(240)
    y[::2] = np.nan
    return t, y, "monthly", "continuous", "coverage_too_low"


def _case_long_gap():
    t, y = _monthly(300)
    y[100:125] = np.nan
    return t, y, "monthly", "continuous", "gap_too_long"


def _case_clustered_gap():
    t, y = _monthly(300)
    y[100:115] = np.nan                                                        # one 15-month block holds all gaps
    return t, y, "monthly", "continuous", "gap_concentrated"


def _case_all_missing():
    t, _ = _monthly(240)
    return t, np.full(240, np.nan), "monthly", "continuous", "too_few_samples_to_describe"


def _case_infinite():
    t, y = _monthly(240)
    y[10] = np.inf
    return t, y, "monthly", "continuous", "non_finite_values"


def _case_perfect_line():
    t, _ = _monthly(240)
    return t, 1.0 + 0.5 * np.arange(240), "monthly", "continuous", "zero_residual_variance"


def _case_sparse_counts():
    years = np.arange(1995, 2025)
    y = np.zeros(30)
    y[[3, 20, 28]] = [1, 2, 1]
    return years, y, "annual", "count", "sparse_counts"


def _case_few_years():
    years = np.arange(2010, 2025)
    return years, np.random.default_rng(1).normal(0, 1, 15), "annual", "continuous", "too_few_valid_samples"


CASES = [_case_constant, _case_too_short_to_describe, _case_short, _case_sparse, _case_long_gap,
         _case_clustered_gap, _case_all_missing, _case_infinite, _case_perfect_line, _case_sparse_counts,
         _case_few_years]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.__name__[6:])
def test_T06_degenerate_series_never_give_nan_or_fake_significance(case):
    t, y, cadence, kind, code = case()
    fit = fit_trend(t, y, cadence=cadence, policy=POLICY, data_kind=kind)
    assert fit.inference_status == "not_applicable"
    assert fit.ci95_per_decade is None and fit.p_raw is None and fit.se_per_decade is None
    assert fit.inference_reason
    blocking = [d.code for d in fit.diagnostics if d.severity == "blocking"]
    assert code in blocking, blocking
    res = to_trend_result(fit, hypothesis_id="h", metric_id="m", unit="u",
                          seasonal_adjustment="none_annual" if cadence == "annual" else "fixed_baseline_monthly_anomaly",
                          policy=POLICY)
    dumped = res.model_dump()
    json.dumps(dumped, allow_nan=False)                                        # no NaN / Infinity anywhere
    assert json_safe(dumped) == dumped
    assert res.significant is None and res.significance_label == "undetermined"
    for v in (fit.slope_per_year, fit.slope_per_decade, fit.intercept, fit.coverage):
        assert v is None or math.isfinite(v)


def test_T06_constant_series_has_zero_slope_and_short_series_no_slope():
    t, y, *_ = _case_constant()
    fit = fit_trend(t, y, cadence="monthly", policy=POLICY)
    assert fit.slope_per_year == 0.0 and fit.slope_per_decade == 0.0 and fit.intercept == 3.5
    t, y, *_ = _case_too_short_to_describe()
    fit = fit_trend(t, y, cadence="monthly", policy=POLICY)
    assert fit.slope_per_year is None and fit.fitted(t) is None
    assert half_slopes(t[:2], y[:2]) == (None, None)


def test_T06_one_isolated_missing_month_does_not_block_inference():
    t, y = _monthly(240)
    y[77] = np.nan
    assert fit_trend(t, y, cadence="monthly", policy=POLICY).inference_status == "ok"


def test_small_annual_samples_carry_a_calibration_warning():
    years = np.arange(1990, 2025)
    y = np.random.default_rng(8).normal(0, 1, years.size)                      # TEST DATA
    fit = fit_trend(years, y, cadence="annual", policy=POLICY)
    assert fit.inference_status == "ok"
    assert "small_sample_inference" in [d.code for d in fit.diagnostics if d.severity == "warning"]


def test_count_gate_only_applies_to_count_data():
    years, y, *_ = _case_sparse_counts()
    as_continuous = fit_trend(years, y, cadence="annual", policy=POLICY, data_kind="continuous")
    assert "sparse_counts" not in [d.code for d in as_continuous.diagnostics]


def test_invalid_time_axis_is_rejected():
    with pytest.raises(ValueError):
        fit_trend(np.array([3, 2, 1]), np.zeros(3), cadence="monthly", policy=POLICY)
    with pytest.raises(ValueError):
        fit_trend(np.array([1, 1, 2]), np.zeros(3), cadence="monthly", policy=POLICY)
    with pytest.raises(ValueError):
        fit_trend(np.arange(3), np.zeros(3), cadence="daily", policy=POLICY)


# ----------------------------------------------------------------------------- T07

def test_T07_insufficient_baseline_is_reported_not_repaired():
    t = ym_to_index("2002-04") + np.arange(260)                                # starts after the reference start
    y = np.random.default_rng(5).normal(0, 1, 260)                             # TEST DATA
    clim = climatology(t, y, "1991-01", "2020-12", min_samples=24)
    assert not clim.ok and clim.status == "insufficient_baseline"
    assert clim.base_start == ym_to_index("1991-01") and clim.base_end == ym_to_index("2020-12")   # not moved
    assert clim.counts.sum() == np.sum(t <= ym_to_index("2020-12")) and clim.counts.max() < 24
    assert np.isnan(clim.cycle).all()                                          # no shorter mean is passed off
    assert "1991-01..2020-12" in clim.reason and "not shortened" in clim.reason
    assert clim.actual_start == t[0]
    # the same data with a registered reference the record supports
    ok = climatology(t, y, "2003-01", "2020-12", min_samples=14)
    assert ok.ok and ok.samples_per_position == [18] * 12


def test_T07_one_thin_calendar_month_fails_the_whole_baseline():
    t = T0 + np.arange(240)
    y = np.random.default_rng(6).normal(0, 1, 240)
    y[(t % 12 == 6) & (np.arange(240) >= 60)] = np.nan                         # July mostly missing
    clim = climatology(t, y, T0, T0 + 239, min_samples=16)
    assert not clim.ok and clim.counts[6] == 5 and np.isnan(clim.cycle[6])
    assert np.isfinite(np.delete(clim.cycle, 6)).all()
    assert np.isnan(anomalies(t, y, clim.cycle)[t % 12 == 6]).all()


# ----------------------------------------------------------------------------- T12

def test_T12_interval_scope_is_pointwise():
    t, y, _ = _seasonal_series()
    fit = fit_trend(t, y - y.mean(), cadence="monthly", policy=POLICY)
    assert fit.interval_scope == "pointwise" and fit.ci_level == POLICY["ci_level"]
    res = to_trend_result(fit, hypothesis_id="h", metric_id="m", unit="u",
                          seasonal_adjustment="fixed_baseline_monthly_anomaly", policy=POLICY)
    assert res.interval_scope == "pointwise" and res.ci_level == 0.95
    assert res.p_adjusted == {} and res.primary_family_id is None             # correction is a separate statement


# ----------------------------------------------------------------------------- batch == single

def test_batch_gives_the_same_numbers_as_row_by_row():
    rng = np.random.default_rng(31)
    n = 280
    t = T0 + np.arange(n)
    rows = []
    for k in range(12):
        y = 0.05 * k * np.arange(n) / 12 + _ar1(rng, n, 0.1 * (k % 9))
        y[rng.random(n) < 0.03 * (k % 4)] = np.nan
        rows.append(y)
    rows.append(np.full(n, 2.0))                                               # constant
    rows.append(np.full(n, np.nan))                                            # empty
    short = rng.normal(0, 1, n)
    short[60:] = np.nan
    rows.append(short)                                                         # short support
    Y = np.vstack(rows)
    batch = fit_trend_batch(t, Y, cadence="monthly", policy=POLICY)
    assert len(batch) == len(rows)
    for i, y in enumerate(rows):
        one, row = fit_trend(t, y, cadence="monthly", policy=POLICY), batch.row(i)
        for name in ("slope_per_year", "slope_per_decade", "intercept", "p_raw", "se_per_decade", "lag",
                     "inference_status", "reason_code", "n_valid", "n_expected", "coverage", "longest_gap",
                     "ci95_per_decade", "dof", "prewhiten_rho", "first_valid", "last_valid"):
            a, b = getattr(one, name), getattr(row, name)
            if isinstance(a, (float, tuple)):                                  # identical up to summation order
                assert a == pytest.approx(b, rel=1e-11, abs=1e-300), (i, name)
            else:
                assert a == b, (i, name)
        if one.inference_status == "ok":
            assert batch.p_raw[i] == pytest.approx(one.p_raw, rel=1e-11, abs=1e-300)
            assert batch.ci_lo_per_decade[i] == pytest.approx(one.ci95_per_decade[0], rel=1e-11)
        else:
            assert np.isnan(batch.p_raw[i]) and not batch.inference_ok[i]
    assert batch.inference_ok.sum() >= 8


def test_batch_matches_single_for_every_candidate_policy():
    t, y = _gappy_series(seed=9)
    for pid in LAG_POLICIES:
        one = fit_trend(t, y, cadence="monthly", policy=POLICY, lag_policy=pid)
        row = fit_trend_batch(t, np.vstack([y, y[::-1]]), cadence="monthly", policy=POLICY, lag_policy=pid).row(0)
        assert one.lag == row.lag
        assert (one.se_per_decade, one.p_raw) == pytest.approx((row.se_per_decade, row.p_raw), rel=1e-11)
        lp = LAG_POLICIES[pid]
        _, _, se, _, dof = _reference_hac((t - t[0]) / 12.0, y, one.lag, prewhiten=lp.prewhiten,
                                          dof_rule=lp.dof_rule)
        assert one.se_per_decade == pytest.approx(10 * se, rel=1e-9) and one.dof == pytest.approx(dof)


# ----------------------------------------------------------------------------- diagnostics / half slopes

def test_half_slopes_split_at_the_calendar_midpoint():
    t = T0 + np.arange(240)
    y = np.where(np.arange(240) < 120, 1.0 * np.arange(240) / 12, 10.0 - 2.0 * (np.arange(240) - 120) / 12)
    a, b = half_slopes(t, y)
    assert a == pytest.approx(1.0) and b == pytest.approx(-2.0)
    y2 = y.copy()
    y2[5:60] = np.nan                                                          # gaps do not move the split
    a2, b2 = half_slopes(t, y2)
    assert a2 == pytest.approx(1.0) and b2 == pytest.approx(-2.0)
    years = np.arange(2000, 2020)
    assert half_slopes(years, 3.0 * (years - 2000), cadence="annual") == (pytest.approx(3.0), pytest.approx(3.0))


def test_diagnostics_inform_without_changing_the_estimate():
    rng = np.random.default_rng(41)
    n = 300
    t = T0 + np.arange(n)
    x = np.arange(n) / 12
    tent = np.where(x < 12.5, x, 25 - x) + rng.normal(0, 0.3, n)               # TEST DATA: rise then fall
    codes = {d.code: d for d in fit_trend(t, tent, cadence="monthly", policy=POLICY).diagnostics}
    assert "half_slope_sign_change" in codes and "nonlinear_curvature" in codes
    assert codes["nonlinear_curvature"].severity == "warning"

    persistent = _ar1(rng, n, 0.985)
    fit = fit_trend(t, persistent, cadence="monthly", policy=POLICY)
    assert "strong_persistence" in [d.code for d in fit.diagnostics]
    assert fit.inference_status == "ok"                                        # flagged, not silently altered

    clean = 0.2 * x + rng.normal(0, 0.5, n)
    base = fit_trend(t, clean, cadence="monthly", policy=POLICY)
    assert {d.code for d in base.diagnostics} <= {"residual_autocorrelation"}
    spiked = clean.copy()
    spiked[-3:] += 60.0
    out = fit_trend(t, spiked, cadence="monthly", policy=POLICY)
    assert "outlier_influence" in [d.code for d in out.diagnostics]
    ok = np.isfinite(spiked)
    ref = sm.OLS(spiked[ok], sm.add_constant(x[ok])).fit()
    assert out.slope_per_year == pytest.approx(ref.params[1], rel=1e-10)       # the outliers stay in the estimate


# ----------------------------------------------------------------------------- review additions

def _autocov(x, j):
    return float(np.dot(x[: len(x) - j], x[j:])) if j < len(x) else 0.0


def test_prewhitening_filters_every_score_and_recolours_exactly():
    """Independent check of the prewhitened long-run sum from the autocovariances of the scores.

    With the filter over the whole zero-padded series, c_u(j) = (1 + r^2) c_h(j) - r (c_h(j-1) + c_h(j+1)),
    so the result can be computed without ever forming u.  Dropping the first (highest-leverage)
    score, as stats-1.0.0 did, breaks this identity.
    """
    rng = np.random.default_rng(77)
    n, lag = 60, 3
    h = _ar1(rng, n, 0.6) * np.linspace(-1, 1, n)                              # TEST DATA: leverage at both ends
    lp = LAG_POLICIES["fixed_pw"]
    var, used, rho = hac_slope_variance(h[None, :], np.array([n]), lp, fixed_lag=lag, valid=np.ones((1, n), bool))
    r = float(np.dot(h[1:], h[:-1]) / np.dot(h[:-1], h[:-1]))
    assert rho[0] == pytest.approx(r, rel=1e-12) and used[0] == lag and 0.2 < r < 0.9
    c = [_autocov(h, j) for j in range(lag + 2)]
    cu = [(1 + r * r) * c[j] - r * (c[abs(j - 1)] + c[j + 1]) for j in range(lag + 1)]
    expected = (cu[0] + 2 * sum((1 - j / (lag + 1)) * cu[j] for j in range(1, lag + 1))) / (1 - r) ** 2
    assert var[0] == pytest.approx(expected, rel=1e-10)
    # with a bandwidth that keeps every lag at (almost) full weight the long-run sum of u is
    # (sum u)^2 = (1 - r)^2 (sum h)^2: recolouring returns (sum h)^2 only if no score is dropped
    big = 10 ** 7
    var_all, _, _ = hac_slope_variance(h[None, :], np.array([100 * big]), lp, fixed_lag=big,
                                       valid=np.ones((1, n), bool))
    assert var_all[0] == pytest.approx(h.sum() ** 2, rel=1e-4)


def test_time_reversal_changes_the_slope_sign_but_not_the_unprewhitened_uncertainty():
    t, y = _gappy_series(seed=13)
    fwd = fit_trend(t, y, cadence="monthly", policy=POLICY, lag_policy="fixed")
    rev = fit_trend(t, y[::-1], cadence="monthly", policy=POLICY, lag_policy="fixed")
    assert rev.slope_per_decade == pytest.approx(-fwd.slope_per_decade, rel=1e-10)
    assert rev.se_per_decade == pytest.approx(fwd.se_per_decade, rel=1e-10)


def test_negative_persistence_is_not_prewhitened():
    rng = np.random.default_rng(55)
    n = 240
    t = T0 + np.arange(n)
    e = rng.normal(0, 1, n + 1)
    y = e[1:] - 0.8 * e[:-1]                                                   # TEST DATA: MA(1), lag-1 corr -0.49
    pw = fit_trend(t, y, cadence="monthly", policy=POLICY, lag_policy="fixed_pw")
    plain = fit_trend(t, y, cadence="monthly", policy=POLICY, lag_policy="fixed")
    assert pw.resid_autocorr_lag1 < -0.3
    assert pw.prewhiten_rho == 0.0                                             # floored, not negative
    # rho = 0: u is h with one trailing zero, so the estimate equals the one without prewhitening
    assert pw.se_per_decade == pytest.approx(plain.se_per_decade, rel=1e-12)
    shipped = fit_trend(t, y, cadence="monthly", policy=POLICY)
    assert shipped.prewhiten_rho == 0.0 and shipped.se_per_decade == pytest.approx(plain.se_per_decade, rel=1e-12)


def test_missing_edges_of_the_analysis_period_are_not_a_gap():
    """A period that starts before / ends after the record: support is shorter, nothing is 'between' samples."""
    rng = np.random.default_rng(66)
    n = 300
    t = T0 + np.arange(n)
    y = 0.2 * np.arange(n) / 12 + _ar1(rng, n, 0.4)                            # TEST DATA
    period = (int(t[0]) - 30, int(t[-1]) + 25)                                 # 30 + 25 months without data
    wide = fit_trend(t, y, cadence="monthly", policy=POLICY, period=period)
    own = fit_trend(t, y, cadence="monthly", policy=POLICY)
    assert wide.n_expected == 355 and wide.n_valid == 300 and wide.coverage == pytest.approx(300 / 355)
    assert wide.first_valid == t[0] and wide.last_valid == t[-1] and wide.longest_gap == 0
    assert wide.inference_status == "ok", wide.inference_reason                # 85 % coverage, no interior gap
    # same samples, same true time: slope, uncertainty and p-value are those of the supported span
    assert wide.slope_per_decade == pytest.approx(own.slope_per_decade, rel=1e-10)
    assert wide.se_per_decade == pytest.approx(own.se_per_decade, rel=1e-10)
    assert wide.p_raw == pytest.approx(own.p_raw, rel=1e-8)
    assert wide.lag == own.lag
    # the intercept refers to the start of the requested window, 30 months before the first sample
    assert wide.intercept == pytest.approx(own.intercept - own.slope_per_year * 30 / 12, rel=1e-9)
    assert "gaps_present" in [d.code for d in wide.diagnostics]                # the missing months stay visible
    # too little support is still refused - by the coverage rule, with the right reason
    far = fit_trend(t, y, cadence="monthly", policy=POLICY, period=(int(t[0]) - 100, int(t[-1])))
    assert far.inference_status == "not_applicable" and far.reason_code == "coverage_too_low"
    # an interior block of the same length IS a gap
    y2 = y.copy()
    y2[100:130] = np.nan
    inner = fit_trend(t, y2, cadence="monthly", policy=POLICY)
    assert inner.longest_gap == 30 and inner.reason_code == "gap_too_long"
    # gap concentration counts interior missing months only
    y3 = y.copy()
    y3[100:115] = np.nan
    conc = fit_trend(t, y3, cadence="monthly", policy=POLICY, period=period)
    assert conc.reason_code == "gap_concentrated" and "15" in conc.inference_reason


def test_policy_thresholds_are_read_from_the_policy_not_hard_coded():
    t, y = _monthly(96, seed=4)
    assert fit_trend(t, y, cadence="monthly", policy=POLICY).reason_code == "span_too_short"
    relaxed = json.loads(json.dumps(POLICY))
    relaxed["monthly_inference"].update(min_span_years=5, min_valid_months=60)
    assert fit_trend(t, y, cadence="monthly", policy=relaxed).inference_status == "ok"
    strict = json.loads(json.dumps(POLICY))
    strict["annual_inference"]["min_valid_years"] = 40
    years = np.arange(1990, 2025)
    ya = np.random.default_rng(8).normal(0, 1, years.size)
    assert fit_trend(years, ya, cadence="annual", policy=strict).reason_code == "too_few_valid_samples"
    level = json.loads(json.dumps(POLICY))
    level["ci_level"] = 0.90
    t2, y2 = _monthly(240, seed=5)
    a, b = fit_trend(t2, y2, cadence="monthly", policy=POLICY), fit_trend(t2, y2, cadence="monthly", policy=level)
    assert b.ci_level == 0.90 and (b.ci95_per_decade[1] - b.ci95_per_decade[0]) < (a.ci95_per_decade[1] - a.ci95_per_decade[0])
    with pytest.raises(ValueError):
        fit_trend(t2, y2, cadence="monthly", policy={**POLICY, "covariance": {"lag_policy_id": "no_such_rule"}})


def test_p_value_and_interval_agree_with_the_t_reference():
    from scipy import stats as sps
    t, y = _gappy_series(seed=3)
    fit = fit_trend(t, y - 0.4 * (t - t[0]) / 12, cadence="monthly", policy=POLICY)
    assert fit.inference_status == "ok" and 1.0 <= fit.dof <= fit.n_valid - 2
    tstat = fit.slope_per_decade / fit.se_per_decade
    assert fit.p_raw == pytest.approx(2 * sps.t.sf(abs(tstat), fit.dof), rel=1e-10)
    half = sps.t.ppf(0.975, fit.dof) * fit.se_per_decade
    assert fit.ci95_per_decade == pytest.approx((fit.slope_per_decade - half, fit.slope_per_decade + half), rel=1e-10)
    # the interval excludes zero exactly when the raw p is below 1 - ci_level
    lo, hi = fit.ci95_per_decade
    assert (lo > 0 or hi < 0) == (fit.p_raw < 0.05)


# ----------------------------------------------------------------------------- real prepared data

DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "series"
BASELINES = Path(__file__).resolve().parents[1] / "catalogue" / "baselines.json"


def _real_layer(region_file: Path, layer: str):
    doc = json.loads(region_file.read_text())
    lay = doc["layers"].get(layer)
    if lay is None:
        return None
    y = np.array([np.nan if v is None else v for v in lay["values"]], dtype=np.float64)
    return ym_to_index(lay["start"]) + np.arange(y.size), y


@pytest.mark.realdata
@pytest.mark.parametrize("layer", ["tws", "p_imerg", "sm_root", "tair", "swe"])
def test_real_series_give_finite_consistent_results(layer):
    """Prepared NASA series (not test data): contract-level checks only, no expected science values."""
    if not DATA.is_dir():
        pytest.skip("prepared data not present")
    files = sorted(DATA.glob("*.json"))[::60]
    n_fit = n_ok = 0
    for f in files:
        got = _real_layer(f, layer)
        if got is None:
            continue
        t, y = got
        n_missing = int(np.isnan(y).sum())
        # fixed reference: the first 20 complete calendar years of the record, for this test only
        b0 = (int(t[0]) + 11) // 12 * 12
        clim = climatology(t, y, b0, b0 + 239, min_samples=16)
        if not clim.ok:
            assert clim.status == "insufficient_baseline" and clim.reason
            continue
        a = anomalies(t, y, clim.cycle)
        assert int(np.isnan(a).sum()) == n_missing                              # missing stays missing
        fit = fit_trend(t, a, cadence="monthly", policy=POLICY)
        n_fit += 1
        assert fit.n_valid == y.size - n_missing and fit.n_expected == y.size
        res = to_trend_result(fit, hypothesis_id="h", metric_id="anomaly_linear_trend", unit="u",
                              seasonal_adjustment="fixed_baseline_monthly_anomaly", policy=POLICY)
        json.dumps(res.model_dump(), allow_nan=False)
        ok = np.isfinite(a)
        if fit.reason_code == "constant_series":
            assert fit.slope_per_year == 0.0 and fit.p_raw is None
            continue
        ref = sm.OLS(a[ok], sm.add_constant((t[ok] - t[0]) / 12.0)).fit()
        assert fit.slope_per_year == pytest.approx(ref.params[1], rel=1e-8, abs=1e-12)
        if fit.inference_status == "ok":
            n_ok += 1
            lo, hi = fit.ci95_per_decade
            assert lo < fit.slope_per_decade < hi and 0.0 <= fit.p_raw <= 1.0
            assert 0.0 <= fit.prewhiten_rho <= PREWHITEN_RHO_CAP and fit.dof >= 1.0
            # never narrower than half the iid interval: the autocorrelation handling may only widen
            # materially, a much narrower interval would mean lost scores
            assert fit.se_per_decade > 0.5 * 10 * ref.bse[1]
        else:
            assert fit.ci95_per_decade is None and fit.p_raw is None and fit.inference_reason
    assert n_fit >= 5
    if layer == "tws":
        assert n_ok >= 1                                                       # the 11-month GRACE gap does not block
