"""Derived-event rule tests — acceptance E06 and E07 (docs/earth-system-acceptance.md).

The index values below are hand-written TEST values chosen to exercise the rule; they are not
SPI values of any real place.
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import sys
from pathlib import Path as _Path

import numpy as np

sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)
import pytest

from aqua_trend.indicators import IndicatorRegistry
from aqua_trend.indicators import events as E
from aqua_trend.timeaxis import index_to_ym, ym_to_index

FIXTURES = Path(__file__).parent / "fixtures" / "indicators"
CATALOGUE = Path(__file__).resolve().parents[1] / "catalogue"
RULE = dict(run_below=0.0, qualify_at_or_below=-1.0)
NAN = float("nan")


def axis(start: str, values) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(values, dtype=np.float64)
    return ym_to_index(start) + np.arange(values.size), values


def flat_index(start: str, end: str, value: float = 0.5) -> tuple[np.ndarray, np.ndarray]:
    n = ym_to_index(end) - ym_to_index(start) + 1
    return axis(start, np.full(n, value))


def put(t: np.ndarray, x: np.ndarray, start: str, values) -> None:
    i = ym_to_index(start) - int(t[0])
    x[i:i + len(values)] = values


# ----------------------------------------------------------------------------- rule itself

def test_E06_event_is_a_negative_run_that_reaches_minus_one():
    #            0     1     2     3     4    5     6     7    8     9    10    11
    t, x = axis("2001-01", [0.4, -0.3, -1.2, -0.6, 0.2, -0.5, -0.9, 0.3, -1.0, 0.0, -0.2, 0.7])
    found = E.detect_events(t, x, **RULE)
    assert [(index_to_ym(e.start), index_to_ym(e.end)) for e in found] == [("2001-02", "2001-04"), ("2001-09", "2001-09")]
    first = found[0]
    assert first.duration_months == 3                     # the month before -1.0 is reached belongs to the run
    assert first.severity == pytest.approx(0.3 + 1.2 + 0.6) and first.peak == -1.2
    assert first.start_censor is None and first.end_censor is None
    # a run that never reaches -1.0 is not an event; exactly -1.0 qualifies; exactly 0 closes a run
    assert found[1].duration_months == 1 and found[1].peak == -1.0


def test_E06_event_crossing_the_query_boundary_is_one_event_with_censoring():
    t, x = flat_index("1995-01", "2012-12")
    put(t, x, "2004-10", [-0.5, -1.4, -1.8, -1.1, -0.7, -0.2])        # 2004-10 .. 2005-03
    put(t, x, "2008-03", [-1.5, -0.4])
    found = E.detect_events(t, x, **RULE)
    assert len(found) == 2

    def related(start, end):
        return E.relate_to_period(found, ym_to_index(start), ym_to_index(end))

    before = related("1995-01", "2004-12")
    after = related("2005-01", "2012-12")
    assert len(before) == 1 and before[0].censoring == ("right",) and before[0].months_in_period == 3
    assert len(after) == 2 and after[0].censoring == ("left",) and after[0].months_in_period == 3
    # same event object with its FULL extent in both windows: not two shorter events
    assert before[0].event is after[0].event
    assert (index_to_ym(after[0].event.start), after[0].event.duration_months) == ("2004-10", 6)
    assert after[0].event.severity == pytest.approx(5.7)
    inside = related("2004-01", "2005-12")
    assert inside[0].censoring == () and inside[0].months_in_period == 6
    assert related("2006-01", "2007-12") == []


def test_E06_registry_reports_boundary_event_once_and_annual_series_do_not_depend_on_window():
    reference = json.loads((FIXTURES / "spi_reference_climate_indices.json").read_text())
    values = np.asarray(reference["rate_mm_per_day"])
    series = SimpleNamespace(t=ym_to_index(reference["start"]) + np.arange(values.size), values=values, unit="mm/day",
                             temporal_support="monthly_mean_rate", product_id="p_test", region_id="test-region")
    registry = IndicatorRegistry(catalogue_dir=CATALOGUE)
    whole = registry.compute("spi12", series=series, region_id="test-region")
    crossing = next(e for e in whole.events if e["start"] < "2001-01" <= e["end"])     # 1998-09 .. 2001-05 in the TEST series
    split = "2000-01"
    left = registry.compute("spi12", series=series, region_id="test-region",
                            analysis_period={"start": reference["start"], "end": "1999-12"})
    right = registry.compute("spi12", series=series, region_id="test-region",
                             analysis_period={"start": split, "end": "2024-12"})
    in_left = [e for e in left.events if e["event_id"] == crossing["event_id"]]
    in_right = [e for e in right.events if e["event_id"] == crossing["event_id"]]
    assert len(in_left) == len(in_right) == 1
    assert "right" in in_left[0]["censoring"] and "left" in in_right[0]["censoring"]
    for view in (in_left[0], in_right[0]):                        # full extent, same identity
        assert (view["start"], view["end"], view["duration_months"]) == (
            crossing["start"], crossing["end"], crossing["duration_months"])
    assert in_left[0]["months_in_analysis_period"] + in_right[0]["months_in_analysis_period"] == crossing["duration_months"]
    # distinct events over both windows == events of the full history (nothing split, nothing lost)
    ids = {e["event_id"] for e in left.events} | {e["event_id"] for e in right.events}
    assert ids == {e["event_id"] for e in whole.events_full_history}
    # the annual start count belongs to the start year and is identical whatever the window
    key = "spi12.drought_event_starts_per_year"
    np.testing.assert_array_equal(left.metrics[key].values, right.metrics[key].values)
    year = int(crossing["start"][:4]) - int(whole.metrics[key].t[0])
    assert whole.metrics[key].values[year] >= 1


def test_E06_data_gap_censors_the_event_and_does_not_join_or_close_it():
    t, x = flat_index("2000-01", "2003-12")
    put(t, x, "2001-03", [-1.3, -0.8, NAN, NAN, -0.9, -1.6, -0.4])     # gap in the middle of a dry spell
    found = E.detect_events(t, x, **RULE)
    assert [(index_to_ym(e.start), index_to_ym(e.end)) for e in found] == [("2001-03", "2001-04"), ("2001-07", "2001-09")]
    assert (found[0].start_censor, found[0].end_censor) == (None, "gap")
    assert (found[1].start_censor, found[1].end_censor) == ("gap", None)
    flags = [p.censoring for p in E.relate_to_period(found, None, None)]
    assert flags == [("gap",), ("gap",)]
    # the observed part next to a gap must qualify on its own: -0.9 alone is not an event
    t2, x2 = flat_index("2000-01", "2003-12")
    put(t2, x2, "2001-03", [-1.3, NAN, -0.9, 0.4])
    assert [index_to_ym(e.start) for e in E.detect_events(t2, x2, **RULE)] == ["2001-03"]


def test_E06_ongoing_and_record_start_are_flagged():
    t, x = axis("2010-01", [NAN, NAN, -1.2, -0.3, 0.5, 0.6, 0.2, 0.1, 0.3, -0.4, -1.1, -1.5])
    found = E.detect_events(t, x, **RULE)
    assert (found[0].start_censor, found[0].end_censor) == ("history_start", None)
    assert (found[1].start_censor, found[1].end_censor) == (None, "history_end")
    related = E.relate_to_period(found, ym_to_index("2010-01"), ym_to_index("2010-12"))
    assert related[0].censoring == ("left",) and related[1].censoring == ("ongoing",)
    with pytest.raises(ValueError):
        E.detect_events(np.array([10, 12, 13]), np.array([-1.0, -1.0, 0.0]), **RULE)   # needs the calendar axis


# ----------------------------------------------------------------------------- E07 annual aggregation

def test_E07_event_counts_once_in_its_start_year_months_and_severity_by_calendar_year():
    t, x = flat_index("2000-01", "2004-12")
    put(t, x, "2001-11", [-1.2, -1.6, -0.8, -0.4])                    # 2001-11 .. 2002-02
    put(t, x, "2003-06", [-1.0])
    found = E.detect_events(t, x, **RULE)
    annual = E.annual_metrics(t, x, found, min_valid_months_per_year=12)
    assert annual.years.tolist() == [2000, 2001, 2002, 2003, 2004]
    assert annual.event_starts.tolist() == [0, 1, 0, 1, 0]            # not counted again in 2002
    assert annual.event_months.tolist() == [0, 2, 2, 1, 0]
    np.testing.assert_allclose(annual.severity, [0, 2.8, 1.2, 1.0, 0])
    assert annual.event_months.sum() == sum(e.duration_months for e in found)
    assert annual.severity.sum() == pytest.approx(sum(e.severity for e in found))


def test_E07_incomplete_year_is_missing_and_complete_quiet_year_is_zero():
    t, x = flat_index("2000-03", "2004-10")                           # 2000 and 2004 are cut by the record
    put(t, x, "2002-05", [NAN])                                       # one missing month in 2002
    put(t, x, "2000-06", [-1.4])                                      # an event inside an incomplete year
    annual = E.annual_metrics(t, x, E.detect_events(t, x, **RULE), min_valid_months_per_year=12)
    assert annual.complete.tolist() == [False, True, False, True, False]
    for values in (annual.event_starts, annual.event_months, annual.severity):
        assert np.isnan(values[[0, 2, 4]]).all()                      # missing, not zero
        assert values[[1, 3]].tolist() == [0.0, 0.0]                  # true zeros


def test_E07_event_with_unknown_beginning_is_not_attributed_to_a_start_year():
    t, x = flat_index("2000-01", "2002-12")
    put(t, x, "2000-12", [NAN])
    put(t, x, "2001-01", [-1.3, -0.5])                                # begins right after a gap
    annual = E.annual_metrics(t, x, E.detect_events(t, x, **RULE), min_valid_months_per_year=12)
    assert np.isnan(annual.event_starts[1]) and annual.event_months[1] == 2
    assert annual.event_starts[2] == 0 and annual.notes and "2001" in annual.notes[0]


def test_E07_only_whole_calendar_years_enter_the_analysis_period():
    years = np.arange(2000, 2011)
    inside = E.years_inside(years, ym_to_index("2002-03"), ym_to_index("2008-11"))
    assert years[inside].tolist() == [2003, 2004, 2005, 2006, 2007]
    assert E.years_inside(years, None, None).all()
    assert years[E.years_inside(years, ym_to_index("2002-01"), ym_to_index("2008-12"))].tolist() == list(range(2002, 2009))


def test_E07_annual_metrics_are_not_seasonally_adjusted_and_follow_the_recipe():
    reference = json.loads((FIXTURES / "spi_reference_climate_indices.json").read_text())
    values = np.asarray(reference["rate_mm_per_day"])
    series = SimpleNamespace(t=ym_to_index(reference["start"]) + np.arange(values.size), values=values, unit="mm/day",
                             temporal_support="monthly_mean_rate", product_id="p_test", region_id="test-region")
    registry = IndicatorRegistry(catalogue_dir=CATALOGUE)
    comp = registry.compute("spi3", series=series, region_id="test-region",
                            analysis_period={"start": "1990-06", "end": "2020-12"})
    recipe = registry.recipe("spi3")
    assert recipe["aggregation"]["min_valid_months_per_year"] == 12
    annual = [m for m in comp.metrics.values() if m.cadence == "annual"]
    assert len(annual) == 3
    for metric in annual:
        assert metric.seasonal_adjustment == "none_annual" and metric.aggregation_rule
        assert metric.t[0] == 1979 and np.isnan(metric.values[0])     # 1979 lacks Jan/Feb SPI-3: missing
        assert np.isfinite(metric.values[1:]).all()
        assert metric.t[metric.in_analysis].tolist() == list(range(1991, 2021))   # 1990 is cut by the window
        contract = metric.to_contract()
        assert contract.cadence == "annual" and contract.series.times[0] == "1979" and contract.series.raw[0] is None
        assert contract.series.seasonal_cycle is None and contract.series.anomaly is None
    assert comp.metrics["spi3.index"].seasonal_adjustment == "none_standardised"
    kinds = {m.metric_id.split(".")[1]: m.data_kind for m in annual}
    assert kinds == {"drought_event_starts_per_year": "count", "drought_months_per_year": "count",
                     "drought_severity_per_year": "continuous"}
    # the annual series are the aggregation of the listed events
    months = comp.metrics["spi3.drought_months_per_year"].values
    total = sum(e["duration_months"] for e in comp.events_full_history)
    in_missing_year = sum(1 for e in comp.events_full_history for m in range(e["duration_months"])
                          if (ym_to_index(e["start"]) + m) // 12 == 1979)
    assert np.nansum(months) == total - in_missing_year
