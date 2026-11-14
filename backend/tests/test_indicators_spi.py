"""SPI recipe tests — acceptance E01, E03, E08, E09 and D10 (docs/earth-system-acceptance.md).

All series here are TEST data (synthetic, seeded); see tests/fixtures/indicators/README.md.
Numerical reference: the independent ``climate-indices`` package (values stored in the fixture)
and an independent scipy maximum-likelihood derivation written in this file.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from types import SimpleNamespace

import sys
from pathlib import Path as _Path

import numpy as np

sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)
import pytest
from scipy import stats

from aqua_trend import contracts as C
from aqua_trend.errors import AquaError
from aqua_trend.indicators import IndicatorRegistry
from aqua_trend.indicators import spi as S
from aqua_trend.timeaxis import ym_to_index

FIXTURES = Path(__file__).parent / "fixtures" / "indicators"
CATALOGUE = Path(__file__).resolve().parents[1] / "catalogue"
SCALES = (3, 6, 12)
CAL = (ym_to_index("1991-01"), ym_to_index("2020-12"))
SPI_ARGS = dict(conversion="rate_times_days_in_month", cal_start=CAL[0], cal_end=CAL[1],
                min_samples=30, min_positive=10, bounds=(-3.09, 3.09))


def series(start: str, values, *, unit="mm/day", support="monthly_mean_rate", product="test_product", region="test-region"):
    """Duck-typed PreparedSeries holding TEST values."""
    values = np.asarray(values, dtype=np.float64)
    return SimpleNamespace(t=ym_to_index(start) + np.arange(values.size), values=values, unit=unit,
                           temporal_support=support, product_id=product, region_id=region,
                           cadence="monthly", calendar="gregorian")


def synthetic_rates(start: str, end: str, seed: int = 7) -> np.ndarray:
    """TEST precipitation rates [mm/day]: strictly positive, seasonal, no trend."""
    n = ym_to_index(end) - ym_to_index(start) + 1
    rng = np.random.default_rng(seed)
    month = (ym_to_index(start) + np.arange(n)) % 12
    scale = np.array([1.0, 1.2, 1.5, 2.5, 3.5, 5.0, 6.0, 5.5, 4.0, 2.5, 1.5, 1.0])[month]
    return rng.gamma(2.0, scale / 2.0) + 0.01


@pytest.fixture(scope="module")
def reference() -> dict:
    return json.loads((FIXTURES / "spi_reference_climate_indices.json").read_text())


@pytest.fixture(scope="module")
def registry() -> IndicatorRegistry:
    return IndicatorRegistry(catalogue_dir=CATALOGUE)


# ----------------------------------------------------------------------------- E01

REQUIRED_RECIPE_FIELDS = ("indicator_id", "version", "phenomenon_applicability", "standard_refs", "required_variables",
                          "baseline_requirements", "computation", "event_rule", "aggregation", "interpretation")


@pytest.mark.parametrize("k", SCALES)
def test_E01_recipe_has_source_formula_version_threshold_and_applicability(registry, k):
    recipe = registry.recipe(f"spi{k}")
    for name in REQUIRED_RECIPE_FIELDS:
        assert recipe.get(name), f"spi{k} lacks {name}"
    assert recipe["computation"]["parameters"]["scale_months"] == k
    assert len(recipe["computation"]["steps"]) >= 5
    assert recipe["event_rule"]["parameters"] == {"run_below": 0.0, "qualify_at_or_below": -1.0}
    assert recipe["baseline_requirements"]["start"] == "1991-01"
    assert recipe["baseline_requirements"]["end"] == "2020-12"
    assert recipe["baseline_requirements"]["shorter_alternative"] is None
    ref_ids = {r["ref_id"] for r in recipe["standard_refs"]}
    assert {"mckee_1993", "wmo_1090_2012", "ncl_dim_spi_n"} <= ref_ids
    for ref in recipe["standard_refs"]:
        C.ScientificRef(**ref)                                # contract-shaped
        assert ref["title"] and ref["applies_to"]
    metric_ids = [m["metric_id"] for m in recipe["aggregation"]["metrics"]]
    assert metric_ids == [f"spi{k}.drought_event_starts_per_year", f"spi{k}.drought_months_per_year",
                          f"spi{k}.drought_severity_per_year"]


def test_E01_only_registered_recipes_can_be_selected(registry):
    assert sorted(registry.recipes()) == ["spi12", "spi3", "spi6"]
    for bad in ("spi1", "my_new_drought_formula", "flood_frequency_from_precip"):
        with pytest.raises(AquaError) as err:
            registry.compute(bad, series=None, region_id="test-region")
        assert err.value.code == "invalid_request"


def test_E01_thresholds_come_from_the_recipe_not_from_code(registry, reference):
    """Changing the registered threshold changes the events: no threshold is hard-coded."""
    s = series(reference["start"], reference["rate_mm_per_day"])
    base = registry.compute("spi3", series=s, region_id="test-region")
    recipes = copy.deepcopy(registry.recipes())
    recipes["spi3"]["event_rule"]["parameters"]["qualify_at_or_below"] = -2.0
    stricter = IndicatorRegistry(SimpleNamespace(indicator_recipes=lambda: recipes), catalogue_dir=CATALOGUE)
    fewer = stricter.compute("spi3", series=s, region_id="test-region")
    assert 0 < len(fewer.events) < len(base.events)
    assert all(e["peak"] <= -2.0 for e in fewer.events)
    assert all(e["peak"] <= -1.0 for e in base.events)


# ----------------------------------------------------------------------------- E03

def test_E03_derived_indicator_is_traceable_to_product_and_recipe(registry, reference):
    s = series(reference["start"], reference["rate_mm_per_day"], product="p_test")
    decision = C.ProductDecision(variable_id="precip", selected_product_id="p_test", priority_rank=2,
                                 fallback=True, fallback_reason="TEST: primary lacks calibration history")
    comp = registry.compute("spi6", series=s, region_id="test-region",
                            analysis_period={"start": "2000-01", "end": "2019-12"}, product_decision=decision)
    result = comp.to_contract()
    assert result.kind == "derived_indicator" and result.status == "ok"
    assert result.indicator_id == "spi6" and result.version == "1.0.0"
    assert result.input_product.selected_product_id == "p_test" and result.input_product.fallback
    assert result.event_catalogue_id is None
    assert result.calibration_baseline_id == "spi_calibration_1991_2020"
    assert result.standard_refs and "Phi^-1" in result.definition
    assert "not an observed record" in result.interpretation
    assert [m.metric_id for m in result.metrics] == [
        "spi6.index", "spi6.drought_event_starts_per_year", "spi6.drought_months_per_year",
        "spi6.drought_severity_per_year"]
    assert all(m.trend is None for m in result.metrics)        # trends are added by the engine
    baseline = comp.baseline_info()
    assert baseline.kind == "calibration_reference" and baseline.designation == "recipe_calibration"
    assert baseline.samples_per_position == [30] * 12 and baseline.minimum_samples == 30
    assert (baseline.start, baseline.end) == ("1991-01", "2020-12")
    # the API never carries NaN / Infinity: missing is null
    json.dumps(C.json_safe(result.model_dump()), allow_nan=False)
    json.dumps(C.json_safe(baseline.model_dump()), allow_nan=False)
    first = result.metrics[0].series
    assert first.raw[0] is None and first.times[0] == reference["start"]


# ----------------------------------------------------------------------------- E08

def test_E08_mm_per_day_to_monthly_total_uses_actual_days_and_leap_years():
    months = ["1900-02", "2000-02", "2001-02", "2004-02", "2001-01", "2001-04"]
    t = np.array([ym_to_index(m) for m in months])
    totals = S.monthly_totals(t, np.ones(t.size), "rate_times_days_in_month")
    assert totals.tolist() == [28.0, 29.0, 28.0, 29.0, 31.0, 30.0]
    assert S.monthly_totals(t, np.full(t.size, 2.5), "rate_times_days_in_month")[1] == pytest.approx(72.5)
    with pytest.raises(ValueError):
        S.monthly_totals(t, np.ones(t.size), "assume_30_day_months")


@pytest.mark.parametrize("k", SCALES)
def test_E08_missing_month_is_missing_not_zero_rain(k):
    rates = synthetic_rates("1985-01", "2024-12")
    t = ym_to_index("1985-01") + np.arange(rates.size)
    hole = ym_to_index("2022-07") - t[0]                       # outside the calibration period
    gappy = rates.copy()
    gappy[hole] = np.nan
    zero_filled = rates.copy()
    zero_filled[hole] = 0.0
    spi_gap = S.compute_spi(t, gappy, scale=k, **SPI_ARGS).spi
    spi_zero = S.compute_spi(t, zero_filled, scale=k, **SPI_ARGS).spi
    spi_full = S.compute_spi(t, rates, scale=k, **SPI_ARGS).spi
    # every accumulation that contains the missing month is missing — and only those
    assert np.isnan(spi_gap[hole:hole + k]).all()
    assert np.isfinite(spi_gap[hole + k]) and np.isfinite(spi_gap[hole - 1])
    untouched = np.ones(t.size, dtype=bool)
    untouched[hole:hole + k] = False
    np.testing.assert_array_equal(spi_gap[untouched], spi_full[untouched])
    # treating the gap as zero rain would have produced (drier) numbers instead
    assert np.isfinite(spi_zero[hole:hole + k]).all()
    assert (spi_zero[hole:hole + k] < spi_full[hole:hole + k]).all()


def test_E08_month_absent_from_the_axis_is_a_gap_at_its_calendar_position():
    rates = synthetic_rates("1985-01", "2024-12")
    t = ym_to_index("1985-01") + np.arange(rates.size)
    hole = ym_to_index("2022-07") - t[0]
    keep = np.arange(t.size) != hole
    dropped = S.compute_spi(t[keep], rates[keep], scale=3, **SPI_ARGS)
    assert dropped.t.size == t.size                             # calendar distance is not compressed
    assert np.isnan(dropped.spi[hole:hole + 3]).all() and np.isfinite(dropped.spi[hole + 3])


def test_E08_zero_precipitation_is_a_valid_value_with_mixed_distribution(reference):
    """A zero total gets H = q (share of zero totals in the calibration sample), not a gap."""
    rates = np.array(reference["rate_mm_per_day"])
    t = ym_to_index(reference["start"]) + np.arange(rates.size)
    out = S.compute_spi(t, rates, scale=3, **SPI_ARGS)
    zero_total = out.accumulated == 0
    assert zero_total.sum() > 20                                # the TEST series has dry seasons
    assert np.isfinite(out.spi[zero_total]).all()
    for i in np.flatnonzero(zero_total)[:25]:
        fit = out.calibration.fits[t[i] % 12]
        assert 0 < fit.prob_zero < 1
        assert out.spi[i] == pytest.approx(max(stats.norm.ppf(fit.prob_zero), -3.09))
    # a tiny positive total in the same calendar month ranks at or above the zero total
    i = int(np.flatnonzero(zero_total)[0])
    fit = out.calibration.fits[t[i] % 12]
    above = S.transform(t[i:i + 1], np.array([1e-9]), out.calibration, bounds=(-3.09, 3.09))[0]
    assert above >= out.spi[i] and fit.n_zero == round(fit.prob_zero * fit.n_valid)


def test_E08_unapproved_unit_or_time_support_is_refused(registry):
    rates = synthetic_rates("1985-01", "2024-12")
    for unit, support in (("mm/month", "monthly_mean_rate"), ("mm/day", "instantaneous"), ("kg m-2 s-1", "monthly_mean_rate")):
        comp = registry.compute("spi3", series=series("1985-01", rates, unit=unit, support=support), region_id="test-region")
        assert comp.status == "unsupported_resolution" and comp.monthly_values is None
        assert all(m.status == "unsupported_resolution" and m.values.size == 0 for m in comp.metrics.values())
    comp = registry.compute("spi3", series=None, region_id="test-region")
    assert comp.status == "no_series" and "substituted" in comp.status_reason


# ----------------------------------------------------------------------------- E09 (numerical)

@pytest.mark.parametrize("k", SCALES)
def test_E09_each_scale_matches_the_climate_indices_reference(registry, reference, k):
    s = series(reference["start"], reference["rate_mm_per_day"])
    comp = registry.compute(f"spi{k}", series=s, region_id="test-region")
    expected = np.array([np.nan if v is None else v for v in reference["expected"][f"spi{k}"]])
    assert comp.status == "ok"
    np.testing.assert_array_equal(np.isnan(comp.monthly_values), np.isnan(expected))
    assert np.isnan(comp.monthly_values[:k - 1]).all() and np.isfinite(comp.monthly_values[k - 1])
    np.testing.assert_allclose(comp.monthly_values, expected, atol=1e-6, rtol=0, equal_nan=True)


@pytest.mark.parametrize("k", SCALES)
def test_E09_each_scale_agrees_with_independent_scipy_maximum_likelihood(k):
    """Independent derivation: exact gamma MLE per calendar month with scipy (no shared code).

    Thom's estimator approximates the MLE, so agreement is close but not exact.
    """
    rates = synthetic_rates("1981-01", "2024-12", seed=11)
    t = ym_to_index("1981-01") + np.arange(rates.size)
    ours = S.compute_spi(t, rates, scale=k, **SPI_ARGS).spi
    days = np.array([[31, 29 if (y % 4 == 0 and (y % 100 or y % 400 == 0)) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]
                     for y, m in zip(t // 12, t % 12)])
    totals = rates * days
    acc = np.array([totals[i - k + 1:i + 1].sum() if i >= k - 1 else np.nan for i in range(t.size)])
    ref = np.full(t.size, np.nan)
    for m in range(12):
        cal = (t % 12 == m) & (t >= CAL[0]) & (t <= CAL[1]) & np.isfinite(acc)
        shape, _, scale = stats.gamma.fit(acc[cal], floc=0)
        sel = (t % 12 == m) & np.isfinite(acc)
        ref[sel] = stats.norm.ppf(stats.gamma.cdf(acc[sel], shape, scale=scale))
    ok = np.isfinite(ref) & (np.abs(ref) < 3.0)
    assert np.max(np.abs(ours[ok] - ref[ok])) < 0.03


@pytest.mark.parametrize("k", SCALES)
def test_E09_calibration_period_spi_is_standard_normal(k):
    rates = synthetic_rates("1981-01", "2024-12", seed=3)
    t = ym_to_index("1981-01") + np.arange(rates.size)
    spi = S.compute_spi(t, rates, scale=k, **SPI_ARGS).spi
    inside = spi[(t >= CAL[0]) & (t <= CAL[1])]
    assert inside.size == 360 and np.isfinite(inside).all()
    assert abs(inside.mean()) < 0.05
    assert 0.9 < inside.std() < 1.1


@pytest.mark.parametrize("k", SCALES)
def test_E09_fixed_calibration_is_not_refitted_on_the_query_window(registry, reference, k):
    s = series(reference["start"], reference["rate_mm_per_day"])
    windows = [None, {"start": "2005-01", "end": "2014-12"}, {"start": "1995-03", "end": "2024-12"},
               {"start": "2021-01", "end": "2024-12"}]
    runs = [registry.compute(f"spi{k}", series=s, region_id="test-region", analysis_period=w) for w in windows]
    first = runs[0]
    for run in runs[1:]:
        np.testing.assert_array_equal(run.monthly_values, first.monthly_values)
        assert run.calibration.parameters == first.calibration.parameters
        assert (run.calibration.start, run.calibration.end) == ("1991-01", "2020-12")
        for mid, metric in run.metrics.items():                 # full-history series do not move
            np.testing.assert_array_equal(metric.values, first.metrics[mid].values)
        assert run.events_full_history == first.events_full_history
    # the window only marks membership
    assert runs[1].metrics[f"spi{k}.index"].in_analysis.sum() == 120
    assert runs[1].metrics[f"spi{k}.drought_months_per_year"].t[runs[1].metrics[f"spi{k}.drought_months_per_year"].in_analysis].tolist() == list(range(2005, 2015))


def test_E09_data_outside_the_calibration_period_do_not_change_the_calibration(reference):
    rates = np.array(reference["rate_mm_per_day"])
    t = ym_to_index(reference["start"]) + np.arange(rates.size)
    changed = rates.copy()
    after = t > CAL[1]
    changed[after] = changed[after] * 3.0 + 1.0
    a = S.compute_spi(t, rates, scale=6, **SPI_ARGS)
    b = S.compute_spi(t, changed, scale=6, **SPI_ARGS)
    assert a.calibration.fits == b.calibration.fits
    np.testing.assert_array_equal(a.spi[~after], b.spi[~after])
    assert not np.array_equal(a.spi[after], b.spi[after])


def test_E09_scales_are_distinct_indicators(registry, reference):
    s = series(reference["start"], reference["rate_mm_per_day"])
    out = {k: registry.compute(f"spi{k}", series=s, region_id="test-region") for k in SCALES}
    assert not np.allclose(out[3].monthly_values[20:], out[6].monthly_values[20:])
    assert not np.allclose(out[6].monthly_values[20:], out[12].monthly_values[20:])
    ids = [m for k in SCALES for m in out[k].metrics]
    assert len(ids) == len(set(ids)) == 12                       # distinct metric ids -> distinct hypotheses (T15)
    assert [registry.requirements(f"spi{k}")["min_history_months"] for k in SCALES] == [362, 365, 371]


# ----------------------------------------------------------------------------- D10

def test_D10_history_requirement_is_declared_before_any_result(registry):
    req = registry.requirements("spi12")
    assert req["variable_id"] == "precip" and req["cadence"] == "monthly"
    assert req["calibration"] == {"start": "1991-01", "end": "2020-12"}
    assert req["required_period"] == {"start": "1990-02", "end": "2020-12"}
    assert req["min_samples_per_calendar_month"] == 30
    assert {"unit": "mm/day", "temporal_support": "monthly_mean_rate"} in req["unit_support"]
    assert registry.requirements("spi3")["required_period"]["start"] == "1990-11"


@pytest.mark.parametrize("k", SCALES)
def test_D10_product_starting_1998_gives_insufficient_baseline_for_the_indicator_only(registry, k):
    """An IMERG-like record (1998-) cannot support 1991-2020: the indicator says so, with no values.

    The precipitation series itself is untouched and remains available to the variable trend.
    """
    rates = synthetic_rates("1998-01", "2025-09")
    s = series("1998-01", rates, product="p_short_test")
    before = s.values.copy()
    comp = registry.compute(f"spi{k}", series=s, region_id="test-region",
                            analysis_period={"start": "2005-01", "end": "2024-12"})
    assert comp.status == "insufficient_baseline"
    assert "1998-01" in comp.status_reason and "1991-01..2020-12" in comp.status_reason
    assert "not shortened" in comp.status_reason
    assert comp.monthly_values is None and comp.events == []
    assert set(comp.metrics) == {f"spi{k}.index", f"spi{k}.drought_event_starts_per_year",
                                 f"spi{k}.drought_months_per_year", f"spi{k}.drought_severity_per_year"}
    for metric in comp.metrics.values():
        assert metric.status == "insufficient_baseline" and metric.values.size == 0
        assert metric.to_contract().series is None
    assert comp.calibration.status == "insufficient_baseline"
    assert max(comp.calibration.samples_per_position) == 23 < comp.calibration.minimum_samples
    np.testing.assert_array_equal(s.values, before)             # the variable's data are not altered
    result = comp.to_contract()
    assert result.status == "insufficient_baseline" and result.events == []
    json.dumps(C.json_safe(result.model_dump()), allow_nan=False)


def test_D10_calibration_support_decides_from_availability_only(registry):
    long = series("1979-01", synthetic_rates("1979-01", "2024-12"), product="p_long_test")
    short = series("1998-01", synthetic_rates("1998-01", "2025-09"), product="p_short_test")
    assert registry.calibration_support("spi12", long).status == "ok"
    info = registry.calibration_support("spi12", short)
    assert info.status == "insufficient_baseline" and info.actual_support == {"start": "1998-12", "end": "2020-12"}
    # same availability, different values -> same decision (it never looks at index values)
    other = series("1998-01", synthetic_rates("1998-01", "2025-09", seed=99) * 5, product="p_short_test")
    assert registry.calibration_support("spi12", other).samples_per_position == info.samples_per_position


def test_D10_standard_is_not_lowered_for_a_nearly_sufficient_record(registry):
    """A record starting exactly at 1991-01 lacks the months before the first accumulations."""
    comp = registry.compute("spi3", series=series("1991-01", synthetic_rates("1991-01", "2024-12")), region_id="test-region")
    assert comp.status == "insufficient_baseline"
    assert comp.calibration.samples_per_position[:3] == [29, 29, 30]
    rates = synthetic_rates("1985-01", "2024-12")
    rates[ym_to_index("2003-05") - ym_to_index("1985-01")] = np.nan     # one missing month inside the calibration
    comp = registry.compute("spi3", series=series("1985-01", rates), region_id="test-region")
    assert comp.status == "insufficient_baseline" and min(comp.calibration.samples_per_position) == 29


def test_D10_too_few_non_zero_totals_refuses_the_fit():
    t = ym_to_index("1985-01") + np.arange(480)
    rates = synthetic_rates("1985-01", "2024-12")
    rates[(t % 12 == 0)] = 0.0                                  # January totals are always zero (scale 1)
    out = S.compute_spi(t, rates, scale=1, **SPI_ARGS)
    assert not out.calibration.ok and out.calibration.failed_months == [1]
    assert "non-zero" in out.calibration.reason and np.isnan(out.spi).all()
