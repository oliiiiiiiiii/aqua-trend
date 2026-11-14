"""Recorded-event tests — acceptance E02, E04, E05, E06, E07, E10, E11, E12.

Event catalogues, events and coverage records come from
tests/fixtures/indicators/recorded_events_test.json: invented TEST data, not real events.
The shipped catalogue (backend/catalogue/events) has no delivered catalogue at all.
"""
from __future__ import annotations

import json
from pathlib import Path

import sys
from pathlib import Path as _Path

import numpy as np

sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)
import pytest

from aqua_trend import contracts as C
from aqua_trend.errors import AquaError
from aqua_trend.indicators import IndicatorRegistry
from aqua_trend.indicators import recorded as R

FIXTURES = Path(__file__).parent / "fixtures" / "indicators"
CATALOGUE = Path(__file__).resolve().parents[1] / "catalogue"
FREQ, DAYS, SEV = "event_starts_per_year", "event_days_per_year", "severity_per_year"


class FakeEventStore:
    """Minimal stand-in for PreparedDataStore's event interface, backed by the TEST fixture."""

    catalogue_dir = CATALOGUE

    def __init__(self) -> None:
        self.data = json.loads((FIXTURES / "recorded_events_test.json").read_text())
        self.calls: list[str] = []

    def event_catalogues(self) -> list[dict]:
        return self.data["catalogues"]

    def events(self, catalogue_id: str, region_id: str) -> list[dict] | None:
        self.calls.append(catalogue_id)
        records = self.data["events"].get(catalogue_id)
        return None if records is None else [r for r in records if region_id in r["region_ids"]]

    def event_coverage(self, catalogue_id: str, region_id: str) -> dict | None:
        found = [c for c in self.data["coverage"].get(catalogue_id, []) if c["region_id"] == region_id]
        return found[0] if found else None


@pytest.fixture()
def store() -> FakeEventStore:
    return FakeEventStore()


@pytest.fixture()
def registry(store) -> IndicatorRegistry:
    return IndicatorRegistry(store)


def by_year(metric) -> dict[int, float | None]:
    return {int(y): (None if np.isnan(v) else float(v)) for y, v in zip(metric.t, metric.values)}


def flood(registry, region="test-region-a", period=None):
    return registry.compute_recorded("flood", region_id=region, analysis_period=period)


# ----------------------------------------------------------------------------- E04

def test_E04_shipped_catalogue_has_only_pending_slots_and_no_event_files():
    index = json.loads((CATALOGUE / "events" / "index.json").read_text())
    assert index["catalogues"] and all(c["status"] == "pending" for c in index["catalogues"])
    assert all(c["version"] is None and c["source_ref"] is None and c["missing"] for c in index["catalogues"])
    shipped = sorted(p.name for p in (CATALOGUE / "events").iterdir())
    assert shipped == ["README.md", "index.json"]


@pytest.mark.parametrize("phenomenon", ["flood", "drought", "a phenomenon nobody registered"])
def test_E04_pending_catalogue_gives_data_required_without_zero_counts_or_timeline(phenomenon):
    registry = IndicatorRegistry(catalogue_dir=CATALOGUE)          # the shipped catalogue, no store
    comp = registry.compute_recorded(phenomenon, region_id="named-taiwan-main-island",
                                     analysis_period={"start": "2005-01", "end": "2024-12"})
    assert comp.status == "data_required" and comp.kind == "recorded_event"
    assert comp.events == [] and comp.event_catalogue_id is None and comp.event_coverage is None
    assert len(comp.metrics) == 3
    for metric in comp.metrics.values():
        assert metric.status == "data_required"
        assert metric.t.size == 0 and metric.values.size == 0       # no invented time axis, no zeros
    result = comp.to_contract()
    assert result.status == "data_required" and result.events == []
    assert all(m.series is None and m.trend is None for m in result.metrics)
    dumped = json.dumps(C.json_safe(result.model_dump()), allow_nan=False)
    assert '"raw"' not in dumped
    assert "not an empty catalogue" in comp.status_reason


def test_E04_pending_entry_in_a_store_is_data_required_and_names_what_is_missing(registry, store):
    comp = registry.compute_recorded("landslide", region_id="test-region-a")
    assert comp.status == "data_required"
    assert "test_cat_pending" in comp.status_reason and "events_file" in comp.status_reason
    assert store.calls == []                                        # nothing is read from a pending catalogue


def test_E04_ready_catalogue_without_delivery_for_the_region_is_data_required(store):
    store.data["events"].pop("test_cat_b")
    store.data["events"].pop("test_cat_a")
    comp = IndicatorRegistry(store).compute_recorded("flood", region_id="test-region-a")
    assert comp.status == "data_required" and comp.events == []
    assert all(m.values.size == 0 for m in comp.metrics.values())


# ----------------------------------------------------------------------------- E02

def test_E02_frequency_and_severity_are_traceable_to_records_source_and_coverage_version(registry):
    comp = flood(registry)
    assert comp.status == "ok" and comp.kind == "recorded_event"
    assert (comp.event_catalogue_id, comp.event_catalogue_version) == ("test_cat_a", "test-a-1")
    assert comp.event_coverage["completeness"] == "complete"
    assert comp.event_coverage["coverage_version"] == "test-cov-1"
    assert comp.event_coverage["policy_version"] == "test-policy-1"
    assert {e["source_ref"] for e in comp.events} == {"test_source_a"}
    assert {e["source_version"] for e in comp.events} == {"test-a-1"}
    freq, sev = comp.metrics[f"recorded.flood.{FREQ}"], comp.metrics[f"recorded.flood.{SEV}"]
    # every counted event is a listed record
    assert np.nansum(freq.values) == len(comp.events) == 6
    assert sorted(e["event_id"] for e in comp.events) == ["A1", "A2", "A3", "A4", "A5", "A7"]
    assert sev.unit == "km2" and by_year(sev)[2001] == 100.0 and by_year(sev)[2008] == 20.0
    result = comp.to_contract()
    assert result.kind == "recorded_event" and result.input_product is None
    assert result.event_catalogue_id == "test_cat_a" and result.event_coverage["completeness"] == "complete"
    assert result.standard_refs[0].ref_id == "test_source_a"
    assert any("registration policy" in text for text in result.limitations)
    json.dumps(C.json_safe(result.model_dump()), allow_nan=False)


# ----------------------------------------------------------------------------- E05

def test_E05_zero_only_inside_declared_complete_coverage(registry):
    freq = by_year(flood(registry).metrics[f"recorded.flood.{FREQ}"])
    assert freq == {2000: 0.0, 2001: 1.0, 2002: 0.0, 2003: 1.0, 2004: None,     # 2004: known gap -> missing
                    2005: 1.0, 2006: 0.0, 2007: 1.0, 2008: 1.0, 2009: 1.0}


def test_E05_partial_coverage_never_yields_zero(registry):
    comp = flood(registry, region="test-region-b")
    freq = comp.metrics[f"recorded.flood.{FREQ}"]
    assert comp.status == "insufficient_data" and freq.status == "not_applicable"
    assert "not zero" in freq.status_reason
    assert np.isnan(freq.values).all() and freq.values.size == 10       # even the year with a record
    assert [e["event_id"] for e in comp.events] == ["A1"]                # the record itself stays visible
    assert comp.event_coverage["completeness"] == "partial"


def test_E05_unknown_coverage_never_yields_zero(registry):
    comp = flood(registry, region="test-region-c")                       # events delivered, no coverage record
    assert comp.status == "insufficient_data" and comp.event_coverage is None
    assert [e["event_id"] for e in comp.events] == ["A7"]
    for metric in comp.metrics.values():
        assert metric.status != "ok" and not np.isfinite(metric.values).any()
    assert any("unknown, not zero" in note for note in comp.limitations)


def test_E05_year_cut_by_the_coverage_boundary_is_missing():
    segments = [{"start": "2000-03", "end": "2003-12", "completeness": "complete", "known_gaps": []},
                {"start": "2004-01", "end": "2005-12", "completeness": "unknown"}]
    years, usable = R.usable_years(segments)
    assert years.tolist() == [2000, 2001, 2002, 2003, 2004, 2005]
    assert usable.tolist() == [False, True, True, True, False, False]


# ----------------------------------------------------------------------------- E06 / E07

def test_E06_event_crossing_a_boundary_is_counted_once_in_its_start_year(registry):
    """A3 runs 2005-12-28 .. 2006-01-05: one event, year 2005, whatever the analysis period."""
    key = f"recorded.flood.{FREQ}"
    whole = flood(registry)
    early = flood(registry, period={"start": "2000-01", "end": "2005-12"})
    late = flood(registry, period={"start": "2006-01", "end": "2009-12"})
    for comp in (whole, early, late):
        freq = by_year(comp.metrics[key])
        assert freq[2005] == 1.0 and freq[2006] == 0.0
    a3_early = next(e for e in early.events if e["event_id"] == "A3")
    a3_late = next(e for e in late.events if e["event_id"] == "A3")
    assert "right" in a3_early["censoring"] and "left" in a3_late["censoring"]
    assert a3_early["duration_days"] == a3_late["duration_days"] == 9      # full extent both times
    # years of the late window: the event is listed (left-censored) but adds no count there
    m = late.metrics[key]
    assert m.t[m.in_analysis].tolist() == [2006, 2007, 2008, 2009]
    assert np.nansum(m.values[m.in_analysis]) == 3.0                        # A4, A7, A5 — not A3


def test_E06_ongoing_event_has_no_end_and_no_duration(registry):
    comp = flood(registry)
    a5 = next(e for e in comp.events if e["event_id"] == "A5")
    assert a5["end"] is None and a5["duration_days"] is None and a5["duration_days_bounds"] is None
    assert "ongoing" in a5["censoring"]
    assert by_year(comp.metrics[f"recorded.flood.{DAYS}"])[2009] is None
    assert by_year(comp.metrics[f"recorded.flood.{FREQ}"])[2009] == 1.0


def test_E07_annual_attribution_incomplete_years_and_no_seasonal_adjustment(registry):
    comp = flood(registry, period={"start": "2001-06", "end": "2008-12"})
    days = comp.metrics[f"recorded.flood.{DAYS}"]
    assert by_year(days) == {2000: 0.0, 2001: 7.0, 2002: 0.0, 2003: None, 2004: None, 2005: 9.0,
                             2006: 0.0, 2007: None, 2008: 3.0, 2009: None}
    sev = by_year(comp.metrics[f"recorded.flood.{SEV}"])
    assert sev[2005] == 10.0 and sev[2006] == 0.0 and sev[2007] is None   # A4 has no severity value
    for metric in comp.metrics.values():
        assert metric.cadence == "annual" and metric.seasonal_adjustment == "none_annual"
        assert metric.t[metric.in_analysis].tolist() == list(range(2002, 2009))    # 2001 is cut by the window
        assert metric.aggregation_rule
    ids = set(comp.metrics)
    assert ids == {f"recorded.flood.{FREQ}", f"recorded.flood.{DAYS}", f"recorded.flood.{SEV}"}


def test_E07_catalogue_without_severity_metric_reports_not_applicable(registry):
    comp = registry.compute_recorded("storm", region_id="test-region-a")
    sev = comp.metrics[f"recorded.storm.{SEV}"]
    assert sev.status == "not_applicable" and sev.values.size == 0
    assert comp.metrics[f"recorded.storm.{FREQ}"].status == "ok"


# ----------------------------------------------------------------------------- E11

def test_E11_coarse_records_keep_their_precision_and_get_no_invented_date(registry):
    comp = flood(registry)
    a2 = next(e for e in comp.events if e["event_id"] == "A2")
    a4 = next(e for e in comp.events if e["event_id"] == "A4")
    assert (a2["start"], a2["end"]) == ("2003", "2003")                   # verbatim, no day or time added
    assert a2["time_precision"] == {"start": "year", "end": "year"}
    assert a2["duration_days"] is None and a2["duration_days_bounds"] == [1, 365]
    assert (a4["start"], a4["end"]) == ("2007-06", "2007-07")
    assert a4["duration_days"] is None and a4["duration_days_bounds"] == [2, 61]
    contract = comp.to_contract()
    starts = {e.event_id: e.start for e in contract.events}
    assert starts["A2"] == "2003" and starts["A4"] == "2007-06"
    assert starts["A7"] == "2008-05-01T06:00:00+08:00"
    # attribution by year still works; duration sums are missing rather than guessed
    assert by_year(comp.metrics[f"recorded.flood.{FREQ}"])[2003] == 1.0
    assert by_year(comp.metrics[f"recorded.flood.{DAYS}"])[2003] is None


def test_E11_time_parsing_rules():
    assert R.parse_time("2003", "year").exact_day is False
    assert (R.parse_time("2004-02", "month").latest.day, R.parse_time("2003-02", "month").latest.day) == (29, 28)
    assert R.parse_time("2008-05-01T06:00:00+08:00", "time").exact_day
    for text, precision in (("2003", "day"), ("2003-05-01", "year"), ("2008-05-01T06:00:00", "time"),
                            ("2003-13", "month"), ("2003", "decade")):
        with pytest.raises(AquaError) as err:                             # declared precision must match the value
            R.parse_time(text, precision)
        assert err.value.code == "data_release_invalid"
    start, end = R.parse_time("2001-03-04", "day"), R.parse_time("2001-03-10", "day")
    assert R.duration_days(start, end) == (7, (7, 7))
    assert R.duration_days(start, R.parse_time("2001-03", "month")) == (None, (1, 28))
    assert R.duration_days(start, None) == (None, None)


def test_E11_start_year_left_open_by_the_source_makes_those_years_missing():
    record = {"event_id": "X1", "phenomenon_id": "flood", "region_ids": ["r"], "start": "2001", "end": "2002",
              "time_precision": {"start": "year", "end": "year"},
              "time_bounds": {"start": {"earliest": "2001-11-01", "latest": "2002-02-28"}}}
    coverage = {"region_id": "r", "phenomenon_id": "flood", "start": "2000", "end": "2003", "completeness": "complete"}
    agg = R.aggregate_recorded([record], coverage, region_id="r", phenomenon_id="flood", analysis_start=None,
                               analysis_end=None, canonical_ids=False, severity_metric=None)
    assert agg.years.tolist() == [2000, 2001, 2002, 2003]
    assert np.isnan(agg.event_starts[[1, 2]]).all() and agg.event_starts[[0, 3]].tolist() == [0.0, 0.0]
    assert agg.events[0]["start"] == "2001" and any("not determined" in n for n in agg.notes)


# ----------------------------------------------------------------------------- E12

def test_E12_single_approved_catalogue_is_used_and_other_reports_are_not_added(registry, store):
    comp = flood(registry)
    assert comp.event_catalogue_id == "test_cat_a"
    assert store.calls == ["test_cat_a"]                                  # catalogue B is never read
    assert not any(e["event_id"].startswith("B-") for e in comp.events)
    freq = by_year(comp.metrics[f"recorded.flood.{FREQ}"])
    assert freq[2001] == 1.0 and freq[2005] == 1.0                        # B reports the same floods: not 2


def test_E12_repeated_record_inside_the_catalogue_counts_once(registry):
    comp = flood(registry)
    assert [e["event_id"] for e in comp.events].count("A1") == 1
    assert by_year(comp.metrics[f"recorded.flood.{DAYS}"])[2001] == 7.0   # not 14
    assert any("not counted again" in note for note in comp.limitations)


def test_E12_event_counts_once_per_region_and_other_regions_are_excluded(registry):
    comp = flood(registry)
    assert "A6" not in [e["event_id"] for e in comp.events]               # belongs to another region
    assert by_year(comp.metrics[f"recorded.flood.{FREQ}"])[2002] == 0.0


def test_E12_canonical_ids_deduplicate_only_when_prepared_upstream(registry, store):
    comp = registry.compute_recorded("storm", region_id="test-region-a")
    assert by_year(comp.metrics[f"recorded.storm.{FREQ}"]) == {2010: 1.0, 2011: 1.0, 2012: 0.0}
    assert sorted(e["event_id"] for e in comp.events) == ["CANON-1", "CANON-2"]
    # the same records in a catalogue that does not declare an upstream integration are kept apart by event_id
    records = store.data["events"]["test_cat_integrated"]
    plain, removed = R.normalise_events(records, region_id="test-region-a", phenomenon_id="storm", canonical_ids=False)
    assert len(plain) == 3 and removed == 0
    with pytest.raises(AquaError):                                        # integration declared but ids not delivered
        R.normalise_events([{k: v for k, v in records[0].items() if k != "canonical_event_id"}],
                           region_id="test-region-a", phenomenon_id="storm", canonical_ids=True)


# ----------------------------------------------------------------------------- E10

def test_E10_flood_has_no_derived_recipe_and_precipitation_is_not_flood_frequency():
    registry = IndicatorRegistry(catalogue_dir=CATALOGUE)
    assert registry.recipes_for("flood") == []
    for recipe in registry.recipes().values():
        assert "flood" not in recipe["phenomenon_applicability"]["phenomenon_ids"]
        assert any("not a flood indicator" in limit for limit in recipe["phenomenon_applicability"]["limits"])
    for name in ("flood", "淹水"):
        comp = registry.derived_availability(name)
        assert comp.status == "definition_required" and comp.kind == "derived_indicator"
        assert "must not be labelled flood frequency" in comp.status_reason
        assert comp.metrics == {} and comp.events == [] and comp.monthly_values is None
        result = comp.to_contract()
        assert result.status == "definition_required" and result.metrics == []
    assert registry.derived_availability("drought") is None                # drought has recipes
    assert sorted(registry.recipes_for("drought")) == ["spi12", "spi3", "spi6"]


def test_E10_unregistered_phenomenon_gets_a_readable_definition_required():
    comp = IndicatorRegistry(catalogue_dir=CATALOGUE).derived_availability("volcanic ash fall")
    assert comp.status == "definition_required" and "never made up" in comp.status_reason
