"""Independent review tests for the IndicatorRegistry (acceptance E01, E04, E06–E09, D10).

Written by the reviewer with oracles that share no code with the implementation: an exact
gamma maximum-likelihood root, a state-machine event detector and a per-year loop.  All
synthetic series are seeded TEST data; the ``realdata`` tests read the prepared NASA/NOAA
series through the real PreparedDataStore and assert structural facts only, never a value.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from scipy import optimize, special, stats

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.indicators import IndicatorRegistry  # noqa: E402
from aqua_trend.indicators import events as E  # noqa: E402
from aqua_trend.indicators import recorded as R  # noqa: E402
from aqua_trend.indicators import spi as S  # noqa: E402
from aqua_trend.timeaxis import index_to_ym, ym_to_index  # noqa: E402

CATALOGUE = Path(__file__).resolve().parents[1] / "catalogue"
DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
FIXTURES = Path(__file__).parent / "fixtures" / "indicators"
CAL = (ym_to_index("1991-01"), ym_to_index("2020-12"))
SPI_ARGS = dict(conversion="rate_times_days_in_month", cal_start=CAL[0], cal_end=CAL[1],
                min_samples=30, min_positive=10, bounds=(-3.09, 3.09))


def series(start: str, values, **over):
    """Duck-typed PreparedSeries holding TEST values."""
    values = np.asarray(values, dtype=np.float64)
    fields = dict(t=ym_to_index(start) + np.arange(values.size), values=values, unit="mm/day",
                  temporal_support="monthly_mean_rate", product_id="test_product", region_id="test-region",
                  cadence="monthly", calendar="gregorian")
    fields.update(over)
    return SimpleNamespace(**fields)


def seasonal_rates(start: str, end: str, seed: int, dry_months: tuple[int, ...] = (), dry_share: float = 0.0):
    """TEST rates [mm/day]; in ``dry_months`` (0 = January) a share of the months is exactly zero."""
    n = ym_to_index(end) - ym_to_index(start) + 1
    rng = np.random.default_rng(seed)
    month = (ym_to_index(start) + np.arange(n)) % 12
    rates = rng.gamma(2.0, 1.5, n) + 0.01
    dry = np.isin(month, dry_months) & (rng.random(n) < dry_share)
    rates[dry] = 0.0
    return rates


@pytest.fixture(scope="module")
def registry() -> IndicatorRegistry:
    return IndicatorRegistry(catalogue_dir=CATALOGUE)


# ----------------------------------------------------------------------------- catalogue consistency (E01)

@pytest.mark.parametrize("k", (3, 6, 12))
def test_E01_declared_history_requirement_follows_from_scale_and_calibration(registry, k):
    """required_period / min_history_months are hand-written in the recipe: they must be arithmetic facts."""
    recipe = registry.recipe(f"spi{k}")
    base, var = recipe["baseline_requirements"], recipe["required_variables"][0]
    assert recipe["computation"]["parameters"]["scale_months"] == k
    need_start = ym_to_index(base["start"]) - (k - 1)
    assert var["required_period"] == {"start": index_to_ym(need_start), "end": base["end"]}
    assert var["min_history_months"] == ym_to_index(base["end"]) - need_start + 1
    years = (ym_to_index(base["end"]) - ym_to_index(base["start"]) + 1) // 12
    assert base["min_samples_per_calendar_month"] == years == 30
    assert base["min_positive_samples_per_calendar_month"] <= base["min_samples_per_calendar_month"]
    lo, hi = recipe["computation"]["parameters"]["value_bounds"]
    assert lo == -hi < recipe["event_rule"]["parameters"]["qualify_at_or_below"] < 0
    # baseline references resolve inside the recipe (no reference id hidden in code)
    known = {r["ref_id"] for r in recipe["standard_refs"]}
    assert base["ref_ids"] and set(base["ref_ids"]) <= known
    # a reference carries a locator only where one was verified; DOIs look like DOIs
    for ref in recipe["standard_refs"]:
        assert ref["doi"] is None or ref["doi"].startswith("10.")
        assert ref["url"] is None or ref["url"].startswith("https://")


def test_E01_three_scales_differ_only_where_the_scale_matters(registry):
    """Guards against a copy-paste slip between the three hand-maintained recipes."""
    def strip(recipe, k):
        text = json.dumps(recipe, sort_keys=True, ensure_ascii=False)
        for token in (f"spi{k}", f"SPI-{k}", f"{k}-month", f"{k} months", f"{k} 個月", f"{k} consecutive", f"{k - 1} month(s)",
                      f"{k - 1} preceding"):
            text = text.replace(token, "#")
        return json.loads(text)

    a, b, c = (strip(registry.recipe(f"spi{k}"), k) for k in (3, 6, 12))
    for other in (b, c):
        for key in ("standard_refs", "event_rule", "interpretation", "phenomenon_applicability"):
            assert a[key] == other[key], key
        assert a["baseline_requirements"] == other["baseline_requirements"]


# ----------------------------------------------------------------------------- E09 estimator, independent math

@pytest.mark.parametrize("shape", (0.6, 1.0, 2.5, 8.0, 40.0))
def test_E09_thom_estimator_is_close_to_the_exact_likelihood_root(shape):
    """The gamma MLE shape solves ln(a) - digamma(a) = A.  Thom (1958) approximates that root.

    The exact root is found here with Brent's method — no code shared with the implementation.
    The approximation error is largest for small shapes (about 3 % near 0.6), so the tolerance
    is 4 % below shape 1 and 1 % above; a wrong formula would be off by far more.
    """
    sample = np.random.default_rng(int(shape * 10)).gamma(shape, 30.0, 4000)        # TEST sample
    fit = S.fit_gamma(sample, min_samples=30, min_positive=10)
    a_stat = np.log(sample.mean()) - np.log(sample).mean()
    exact = optimize.brentq(lambda a: np.log(a) - special.digamma(a) - a_stat, 1e-3, 1e4)
    assert fit.ok and fit.alpha == pytest.approx(exact, rel=0.04 if shape < 1 else 0.01)
    assert fit.alpha * fit.beta == pytest.approx(sample.mean())                       # mean is preserved exactly
    assert fit.prob_zero == 0.0 and fit.n_zero == 0


def test_E09_probability_of_zero_uses_the_calibration_sample_only():
    """q is the zero share of the 30 calibration totals of that calendar month, not of the record."""
    t = ym_to_index("1985-01") + np.arange(480)
    rates = seasonal_rates("1985-01", "2024-12", seed=5)
    january = np.flatnonzero(t % 12 == 0)
    inside = [i for i in january if CAL[0] <= t[i] <= CAL[1]]
    outside = [i for i in january if not CAL[0] <= t[i] <= CAL[1]]
    rates[inside[:6]] = 0.0                                    # 6 of 30 calibration Januaries are rainless
    rates[outside] = 0.0                                       # every January outside the calibration too
    out = S.compute_spi(t, rates, scale=1, **SPI_ARGS)
    fit = out.calibration.fits[0]
    assert (fit.n_valid, fit.n_zero, fit.n_positive) == (30, 6, 24) and fit.prob_zero == pytest.approx(0.2)
    floor = stats.norm.ppf(0.2)
    assert S.zero_total_index(fit, (-3.09, 3.09)) == pytest.approx(floor)
    np.testing.assert_allclose(out.spi[inside[:6] + outside], floor)
    assert np.nanmin(out.spi[january]) == pytest.approx(floor)             # nothing in January can be drier


# ----------------------------------------------------------------------------- E08 invalid input

def test_E08_negative_and_non_finite_rates_are_missing_never_zero_or_infinite(registry):
    rates = seasonal_rates("1985-01", "2024-12", seed=2)
    start = ym_to_index("1985-01")
    bad = {ym_to_index("2022-03") - start: -0.5, ym_to_index("2023-03") - start: np.inf}
    for i, value in bad.items():
        rates[i] = value
    comp = registry.compute("spi3", series=series("1985-01", rates), region_id="test-region")
    assert comp.status == "ok"
    for i in bad:
        assert np.isnan(comp.monthly_values[i:i + 3]).all() and np.isfinite(comp.monthly_values[i + 3])
    assert np.isfinite(comp.monthly_values[np.isfinite(comp.monthly_values)]).all()
    assert np.abs(comp.monthly_values[np.isfinite(comp.monthly_values)]).max() <= 3.09
    assert any("negative precipitation" in text for text in comp.limitations)
    # 2022 and 2023 lack SPI months: their annual values are missing, not zero
    months = comp.metrics["spi3.drought_months_per_year"]
    assert np.isnan(months.values[np.isin(months.t, (2022, 2023))]).all()
    json.dumps(C.json_safe(comp.to_contract().model_dump()), allow_nan=False)


# ----------------------------------------------------------------------------- honesty of the result

def test_zero_inflated_calibration_is_reported_with_the_floor_it_implies(registry):
    """Dry-season zeros: the index cannot go below Phi^-1(q); the result must say so (spec §7.4)."""
    rates = seasonal_rates("1985-01", "2024-12", seed=4, dry_months=(0, 1, 11), dry_share=0.7)
    comp = registry.compute("spi3", series=series("1985-01", rates), region_id="test-region")
    assert comp.status == "ok"
    note = next(text for text in comp.limitations if text.startswith("Zero 3-month totals"))
    shares = {p["calendar_month"]: p["prob_zero"] for p in comp.calibration.parameters}
    affected = sorted(m for m, q in shares.items() if q > 0)
    assert affected and str(affected) in note
    blocked = sorted(m for m, q in shares.items() if q > 0 and stats.norm.ppf(q) > -1.0)
    assert blocked and f"In month(s) {blocked} this floor is above the event threshold -1.0" in note
    # the statement is true of the data: no month of a blocked calendar month is ever <= -1
    values, t = comp.monthly_values, comp.monthly_t
    for m in blocked:
        assert np.nanmin(values[t % 12 == m - 1]) > -1.0
    # a series without zero totals carries no such note
    wet = registry.compute("spi3", series=series("1985-01", seasonal_rates("1985-01", "2024-12", seed=4)),
                           region_id="test-region")
    assert not any(text.startswith("Zero 3-month totals") for text in wet.limitations)


def test_values_at_the_bound_are_counted_and_attributed_to_the_calibration_period(registry):
    rates = seasonal_rates("1981-01", "2024-12", seed=6)
    t = ym_to_index("1981-01") + np.arange(rates.size)
    rates[t < ym_to_index("1986-01")] *= 0.02                  # TEST: a 'product change' before the calibration
    comp = registry.compute("spi12", series=series("1981-01", rates), region_id="test-region")
    at_bound = int(np.sum(np.abs(comp.monthly_values[np.isfinite(comp.monthly_values)]) >= 3.09))
    outside = int(np.sum((np.abs(comp.monthly_values) >= 3.09) & ((t < CAL[0]) | (t > CAL[1]))))
    assert at_bound >= 40 and outside >= 40
    note = next(text for text in comp.limitations if "value bound" in text)
    assert note.startswith(f"{at_bound} of ") and f"{outside} of them outside the calibration period" in note
    assert "change in the product" in note
    # the fixed calibration itself is unaffected and audited
    check = comp.calibration.fit_check
    assert check["n"] == 360 and abs(check["mean"]) < 0.05 and 0.9 < check["sd"] < 1.1
    assert comp.baseline_info().fit_check["n"] == 360
    json.dumps(C.json_safe(comp.baseline_info().model_dump()), allow_nan=False)


def test_monthly_index_declares_its_built_in_serial_dependence(registry):
    rates = seasonal_rates("1985-01", "2024-12", seed=8)
    for k in (3, 6, 12):
        comp = registry.compute(f"spi{k}", series=series("1985-01", rates), region_id="test-region")
        notes = comp.metrics[f"spi{k}.index"].limitations
        assert len(notes) == 1 and f"share {k - 1} of their {k} months" in notes[0]
        assert comp.metrics[f"spi{k}.drought_months_per_year"].limitations == []


def test_analysis_period_outside_the_record_is_insufficient_data_not_ok(registry):
    rates = seasonal_rates("1985-01", "2024-12", seed=9)
    comp = registry.compute("spi6", series=series("1985-01", rates), region_id="test-region",
                            analysis_period={"start": "1950-01", "end": "1960-12"})
    assert comp.status == "insufficient_data" and "analysis period" in comp.status_reason
    assert all(m.status == "insufficient_data" and not m.in_analysis.any() for m in comp.metrics.values())
    assert comp.events == [] and comp.events_full_history                 # nothing invented, history kept
    partial = registry.compute("spi6", series=series("1985-01", rates), region_id="test-region",
                               analysis_period={"start": "2024-03", "end": "2024-11"})
    assert partial.status == "ok"                                          # monthly index is usable ...
    assert partial.metrics["spi6.index"].status == "ok"
    for name in ("drought_event_starts_per_year", "drought_months_per_year", "drought_severity_per_year"):
        assert partial.metrics[f"spi6.{name}"].status == "insufficient_data"   # ... no whole calendar year is


# ----------------------------------------------------------------------------- E06 / E07 against independent oracles

def oracle_events(t, x, run_below=0.0, qualify=-1.0):
    """State machine over the months; independent of events.detect_events."""
    found, current = [], None
    for i, value in enumerate(x):
        if value == value and value < run_below:
            if current is None:
                before = x[i - 1] if i else float("nan")
                censor = None if before == before else ("gap" if any(v == v for v in x[:i]) else "history_start")
                current = {"start": int(t[i]), "values": [], "start_censor": censor}
            current["values"].append(float(value))
            current["end"] = int(t[i])
            continue
        if current is not None:
            current["end_censor"] = None if value == value else ("gap" if any(v == v for v in x[i:]) else "history_end")
            found.append(current)
            current = None
    if current is not None:
        current["end_censor"] = "history_end"
        found.append(current)
    return [e for e in found if min(e["values"]) <= qualify]


def oracle_annual(t, x, found, year):
    months = [i for i in range(len(t)) if t[i] // 12 == year]
    if sum(1 for i in months if x[i] == x[i]) < 12:
        return None, None, None
    starting = [e for e in found if e["start"] // 12 == year]
    starts = None if any(e["start_censor"] for e in starting) else len(starting)
    inside = [i for i in months if any(e["start"] <= t[i] <= e["end"] for e in found)]
    return starts, len(inside), -sum(float(x[i]) for i in inside)


def random_index(rng) -> tuple[np.ndarray, np.ndarray]:
    """TEST index: an AR(1)-like walk with a few gaps, some exact zeros and exact -1.0 values."""
    n = int(rng.integers(40, 150))
    x = np.zeros(n)
    for i in range(1, n):
        x[i] = 0.7 * x[i - 1] + rng.normal(0, 0.8)
    x = np.round(x, 1)                                                     # produces exact 0.0 and -1.0
    x[rng.random(n) < 0.04] = np.nan
    return ym_to_index("1990-01") + int(rng.integers(0, 12)) + np.arange(n), x


def test_E06_E07_detection_and_annual_aggregation_match_independent_oracles():
    rng = np.random.default_rng(20261115)
    seen_gap = seen_ongoing = 0
    for _ in range(300):
        t, x = random_index(rng)
        found = E.detect_events(t, x, run_below=0.0, qualify_at_or_below=-1.0)
        expected = oracle_events(t, x)
        assert [(e.start, e.end, e.start_censor, e.end_censor) for e in found] == \
               [(e["start"], e["end"], e["start_censor"], e["end_censor"]) for e in expected]
        for got, want in zip(found, expected):
            assert got.duration_months == len(want["values"])
            assert got.severity == pytest.approx(-sum(want["values"])) and got.peak == min(want["values"])
        seen_gap += sum(1 for e in found if "gap" in (e.start_censor, e.end_censor))
        seen_ongoing += sum(1 for e in found if e.end_censor == "history_end")
        annual = E.annual_metrics(t, x, found, min_valid_months_per_year=12)
        for pos, year in enumerate(annual.years):
            starts, months, severity = oracle_annual(t, x, expected, int(year))
            for got, want in ((annual.event_starts[pos], starts), (annual.event_months[pos], months),
                              (annual.severity[pos], severity)):
                assert (want is None and np.isnan(got)) or (want is not None and got == pytest.approx(want))
    assert seen_gap > 20 and seen_ongoing > 5                             # the hard branches were exercised


def test_E06_no_query_window_ever_splits_or_duplicates_an_event():
    """Any split point: the two windows together list every event once or (if crossing) once each, same extent."""
    rng = np.random.default_rng(7)
    for _ in range(60):
        t, x = random_index(rng)
        found = E.detect_events(t, x, run_below=0.0, qualify_at_or_below=-1.0)
        for cut in rng.integers(int(t[1]), int(t[-1]), size=6):
            left = E.relate_to_period(found, int(t[0]), int(cut) - 1)
            right = E.relate_to_period(found, int(cut), int(t[-1]))
            crossing = [e for e in found if e.start < cut <= e.end]
            assert len(left) + len(right) == len(found) + len(crossing)
            for p in left + right:
                assert p.event in found                                    # full extent, never a clipped copy
            for e in crossing:
                a = next(p for p in left if p.event is e)
                b = next(p for p in right if p.event is e)
                assert "right" in a.censoring and "left" in b.censoring
                assert a.months_in_period + b.months_in_period == e.duration_months


# ----------------------------------------------------------------------------- recorded events

COVER = {"region_id": "r", "phenomenon_id": "flood", "start": "2000", "end": "2004", "completeness": "complete",
         "coverage_version": "test-cov"}


def record(event_id: str, start: str, end: str | None = None, **extra):
    """TEST event record (invented)."""
    rec = {"event_id": event_id, "phenomenon_id": "flood", "region_ids": ["r"], "start": start, "end": end,
           "time_precision": {"start": "day", "end": "day" if end else None}}
    rec.update(extra)
    return rec


def aggregate(records, coverage=COVER, **over):
    args = dict(region_id="r", phenomenon_id="flood", analysis_start=None, analysis_end=None,
                canonical_ids=False, severity_metric=None)
    args.update(over)
    return R.aggregate_recorded(records, coverage, **args)


def test_E05_events_outside_complete_coverage_are_listed_but_never_counted_and_this_is_said():
    segments = {"segments": [COVER, {**COVER, "start": "2005", "end": "2006", "completeness": "partial"}]}
    agg = aggregate([record("in", "2001-05-01", "2001-05-02"), record("partial-year", "2005-07-01", "2005-07-03"),
                     record("before-coverage", "1998-02-01", "1998-02-02")], segments)
    assert dict(zip(agg.years.tolist(), agg.event_starts.tolist()))[2001] == 1.0
    assert np.isnan(agg.event_starts[agg.years >= 2005]).all()            # the 2005 record does not make a count
    assert agg.event_starts[np.isin(agg.years, (2000, 2002, 2003, 2004))].tolist() == [0.0] * 4
    assert sorted(e["event_id"] for e in agg.events) == ["before-coverage", "in", "partial-year"]
    assert any("start outside the years of the coverage record" in note for note in agg.notes)
    assert any("without declared complete coverage" in note for note in agg.notes)
    assert agg.coverage_summary["completeness"] == "partial"             # mixed segments are not 'complete'


def test_E05_empty_delivery_is_zero_only_with_complete_coverage():
    assert aggregate([]).event_starts.tolist() == [0.0] * 5
    for coverage in (None, {**COVER, "completeness": "unknown"}, {**COVER, "completeness": "partial"}):
        agg = aggregate([], coverage)
        assert not np.isfinite(agg.event_starts).any() and agg.events == []


def test_E07_severity_is_summed_only_when_the_catalogue_registers_a_sum(tmp_path):
    """A catalogue declaring another annual aggregation must not be summed silently."""
    fixture = json.loads((FIXTURES / "recorded_events_test.json").read_text())
    for entry in fixture["catalogues"]:
        if entry["catalogue_id"] == "test_cat_a":
            entry["severity_metric"]["annual_aggregation"] = "max"

    store = SimpleNamespace(
        catalogue_dir=CATALOGUE,
        event_catalogues=lambda: fixture["catalogues"],
        events=lambda cid, rid: [r for r in fixture["events"][cid] if rid in r["region_ids"]],
        event_coverage=lambda cid, rid: next((c for c in fixture["coverage"].get(cid, []) if c["region_id"] == rid), None))
    comp = IndicatorRegistry(store).compute_recorded("flood", region_id="test-region-a")
    severity = comp.metrics["recorded.flood.severity_per_year"]
    assert severity.status == "not_applicable" and "'max'" in severity.status_reason and severity.values.size == 0
    assert comp.metrics["recorded.flood.event_starts_per_year"].status == "ok"
    index = json.loads((CATALOGUE / "events" / "index.json").read_text())
    assert index["aggregation_rule"]["severity_annual_aggregations"] == ["sum"]


def test_E11_end_before_start_and_malformed_records_are_rejected_not_repaired():
    from aqua_trend.errors import AquaError
    for bad in (record("x", "2001-05-10", "2001-05-01"), record("x", "2001-02-30", "2001-03-01"),
                {**record("x", "2001-05-10"), "time_precision": {}},
                {**record("", "2001-05-10")}):
        with pytest.raises(AquaError) as err:
            aggregate([bad])
        assert err.value.code == "data_release_invalid"


# ----------------------------------------------------------------------------- real prepared data, real store

@pytest.fixture(scope="module")
def real():
    if not (DATA / "catalog" / "series_index.json").exists():
        pytest.skip("prepared data not present")
    from aqua_trend.store import PreparedDataStore
    store = PreparedDataStore.open()
    return store, IndicatorRegistry(store)


@pytest.mark.realdata
def test_realdata_registry_runs_through_the_real_store_and_versions_agree(real):
    store, registry = real
    assert registry.version == store.versions["indicator_registry_version"]
    assert sorted(registry.recipes()) == ["spi12", "spi3", "spi6"]
    for phenomenon in store.phenomena():                                   # the selector can only offer registered ids
        for indicator_id in phenomenon.get("indicator_ids") or []:
            assert indicator_id in registry.recipes_for(phenomenon["phenomenon_id"])
    flood = next((p for p in store.phenomena() if p["phenomenon_id"] == "flood"), None)
    assert flood is None or not flood.get("indicator_ids")                 # E10: no derived flood indicator


@pytest.mark.realdata
def test_realdata_D10_product_order_for_taiwan_through_the_store(real):
    """The adapter's unit / time support are accepted as they are; IMERG fails the calibration only."""
    store, registry = real
    region = "named-taiwan-main-island"
    order = store.concept("precip")["approved_product_ids"]
    period = {"start": "2005-01", "end": "2024-12"}
    status = {}
    for product_id in order:
        prepared = store.series(region, product_id)
        assert (prepared.unit, prepared.temporal_support) == ("mm/day", "monthly_mean_rate")
        support = registry.calibration_support("spi3", prepared)
        comp = registry.compute("spi3", series=prepared, region_id=region, analysis_period=period)
        assert support.status == comp.status                               # the resolver's pre-check is the truth
        status[product_id] = comp.status
        assert np.isfinite(prepared.values).sum() > 240                    # the variable itself stays analysable
        json.dumps(C.json_safe(comp.to_contract().model_dump()), allow_nan=False)
    assert status["p_imerg"] == "insufficient_baseline"
    first_ok = next(p for p in order if status[p] == "ok")
    assert first_ok == "p_gpcp"                                            # first approved product that supports it


@pytest.mark.realdata
@pytest.mark.parametrize("region_id", ["b3-1030040280", "b3-1030034170", "b4-4040015010"])
def test_realdata_hard_regions_give_a_status_or_a_stated_limitation_never_a_silent_number(real, region_id):
    """Arid basins (many zero totals) and a basin with an inhomogeneous early record."""
    store, registry = real
    if region_id not in store.regions() or "p_m2" not in store.available_products(region_id):
        pytest.skip("region not prepared")
    for k in (3, 12):
        comp = registry.compute(f"spi{k}", series=store.series(region_id, "p_m2"), region_id=region_id)
        result = comp.to_contract()
        json.dumps(C.json_safe(result.model_dump()), allow_nan=False)
        if comp.status != "ok":
            assert comp.status == "insufficient_baseline" and "non-zero totals" in comp.status_reason
            assert comp.monthly_values is None and all(m.values.size == 0 for m in comp.metrics.values())
            continue
        values = comp.monthly_values[np.isfinite(comp.monthly_values)]
        zero_share = max(p["prob_zero"] for p in comp.calibration.parameters)
        bounded = int(np.sum(np.abs(values) >= 3.09))
        assert (zero_share > 0) == any(t.startswith(f"Zero {k}-month totals") for t in comp.limitations)
        assert (bounded > 0) == any("value bound" in t for t in comp.limitations)
        assert zero_share > 0 or bounded > 0                               # these regions are hard for a reason


@pytest.mark.realdata
def test_realdata_E04_recorded_events_are_data_required_through_the_real_store(real):
    store, registry = real
    for phenomenon in ("flood", "drought"):
        comp = registry.compute_recorded(phenomenon, region_id="named-taiwan-main-island",
                                         analysis_period={"start": "2005-01", "end": "2024-12"})
        assert comp.status == "data_required" and comp.events == []
        assert all(m.values.size == 0 for m in comp.metrics.values())
        assert "not delivered" in comp.status_reason
