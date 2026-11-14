"""series-2 adapter and miniature-release behaviour of PreparedDataStore.

Acceptance: D01 (one existing region id), D02 (boundary without series), D09 (gaps and
zeros), E04 store part (pending events are None, not zero), contract & policy layer.
All inputs are TEST data from tests/fixtures/store.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).parent / "fixtures" / "store"))
import store_support as fx  # noqa: E402

from aqua_trend.errors import AquaError  # noqa: E402
from aqua_trend.store import (  # noqa: E402
    PreparedDataStore, SeriesFormatError, expand_explicit, expand_start_values, parse_region_file,
)
from aqua_trend.store import store as store_module  # noqa: E402
from aqua_trend.timeaxis import ym_to_index  # noqa: E402


@pytest.fixture()
def release(tmp_path):
    return fx.build_release(tmp_path)


def open_store(release, **kw) -> PreparedDataStore:
    cat, data, cache = release
    return PreparedDataStore.open(cat, data, cache, **kw)


# --------------------------------------------------------------------------- pure adapter (D09)

def test_start_values_keeps_null_zero_and_calendar_axis():
    t, y = expand_start_values("1999-11", [1.5, None, 0.0, 0, 2])
    assert t.tolist() == [ym_to_index(m) for m in ("1999-11", "1999-12", "2000-01", "2000-02", "2000-03")]
    assert t.dtype == np.int64 and y.dtype == np.float64
    assert np.isnan(y[1]) and int(np.isnan(y).sum()) == 1          # null -> NaN, nothing else
    assert y[2] == 0.0 and y[3] == 0.0                             # zero is a value, not missing
    assert y[0] == 1.5 and y[4] == 2.0


def test_explicit_times_keep_gap_at_calendar_position():
    t, y, flags = expand_explicit(["2000-01", "2000-02", "2000-05"], [1.0, 0.0, 3.0], ["a", None, "c"])
    assert t.tolist() == list(range(ym_to_index("2000-01"), ym_to_index("2000-05") + 1))   # distance not compressed
    assert y[0] == 1.0 and y[1] == 0.0 and y[4] == 3.0
    assert np.isnan(y[2]) and np.isnan(y[3])                       # absent months are NaN, not 0, not interpolated
    assert flags == ["a", None, None, None, "c"]


@pytest.mark.parametrize("times, values, flags, text", [
    (["2000-01", "2000-01"], [1, 2], None, "duplicate"),
    (["2000-02", "2000-01"], [1, 2], None, "increasing"),
    (["2000-01", "2000-02"], [1], None, "entries"),
    (["2000-01", "2000-02"], [1, 2], ["x"], "quality_flags"),
    (["2000-1", "2000-02"], [1, 2], None, "YYYY-MM"),
    ([], [], None, "non-empty"),
])
def test_explicit_times_reject_contract_violations(times, values, flags, text):
    with pytest.raises(SeriesFormatError, match=text):
        expand_explicit(times, values, flags)


@pytest.mark.parametrize("start, values", [
    ("2000-13", [1.0]), ("2000", [1.0]), ("2000-01", []), ("2000-01", "1,2"), ("2000-01", [1.0, "2.0"]),
    ("2000-01", [True]), ("2000-01", [float("nan")]), ("2000-01", [float("inf")]),
])
def test_start_values_reject_bad_input(start, values):
    with pytest.raises(SeriesFormatError):
        expand_start_values(start, values)


def test_region_file_checks_id_and_format():
    doc = {"id": "reg-a", "version": "series-2", "layers": {"x": {"start": "2000-01", "values": [1]}}}
    assert set(parse_region_file(doc, "reg-a")) == {"x"}
    with pytest.raises(SeriesFormatError, match="not 'reg-b'"):
        parse_region_file(doc, "reg-b")
    with pytest.raises(SeriesFormatError, match="unsupported series format"):
        parse_region_file({**doc, "version": "series-1"}, "reg-a")
    with pytest.raises(SeriesFormatError, match="layer x"):
        parse_region_file({**doc, "layers": {"x": {"start": "bad", "values": [1]}}}, "reg-a")


# --------------------------------------------------------------------------- store on the TEST release

def test_series_comes_from_exact_region_with_product_metadata(release):
    store = open_store(release)
    s = store.series("reg-a", "t_precip_a")
    assert (s.region_id, s.product_id, s.variable_id) == ("reg-a", "t_precip_a", "t_precip")
    assert (s.cadence, s.calendar, s.unit, s.temporal_support) == ("monthly", "gregorian", "mm/day", "monthly_mean_rate")
    assert s.dataset_version == store.versions["dataset_version"]
    assert (s.start, s.end, len(s.t)) == ("2000-01", "2003-12", 48)
    assert np.all(np.diff(s.t) == 1)
    expected = np.array([np.nan if v is None else v for v in fx.PRECIP_A], dtype=float)
    np.testing.assert_array_equal(s.values, expected)              # NaN positions and every value identical
    assert s.values[3] == 0.0 and s.values[5] == 0.0 and np.isnan(s.values[2]) and np.isnan(s.values[6])
    assert s.n_valid == 46
    contract = s.to_contract()
    assert contract["times"][:3] == ["2000-01", "2000-02", "2000-03"]
    assert contract["values"][2] is None and contract["values"][3] == 0.0
    json.dumps(contract, allow_nan=False)                          # no NaN reaches the API


def test_series_is_a_copy(release):
    store = open_store(release)
    store.series("reg-a", "t_precip_a").values[:] = -1
    assert store.series("reg-a", "t_precip_a").values[0] == 1.5


def test_region_with_boundary_but_no_series_is_not_substituted(release):
    """D02: reg-b has a boundary and a parent with data; it still has no series."""
    store = open_store(release)
    region = store.region("reg-b")
    assert region["series_available"] is False and region["parent"] == "reg-a"
    assert region["geometry_ref"] == "geo/basin4.geojson#reg-b"
    assert store.available_products("reg-b") == []
    assert store.series("reg-b", "t_precip_a") is None
    status, reason = store.series_status("reg-b", "t_precip_a")
    assert status == "no_series" and "no other region is substituted" in reason
    # a product prepared for another region only is not borrowed either
    assert store.series("reg-c", "t_precip_a") is None
    assert store.series_status("reg-c", "t_precip_a")[0] == "no_series"
    assert store.series("reg-c", "t_precip_b").start == "2001-03"


def test_hex_cell_has_no_series_and_regions_expose_contract_fields(release):
    store = open_store(release)
    hexa = store.region("hex-t1")
    assert hexa["series_available"] is False and store.series("hex-t1", "t_precip_a") is None
    assert "hexagon" in store.series_status("hex-t1", "t_precip_a")[1]
    a = store.region("reg-a")
    for key in ("id", "name", "name_zh", "type", "geometry_ref", "geometry_version", "centroid", "bbox", "area_km2",
                "surface", "series_available"):
        assert key in a
    assert a["series_available"] is True and a["geometry_version"].startswith("geo-named-")
    assert store.region("reg-b")["name"] == "Basin 99" and store.region("reg-b")["name_zh"] == "測試 流域 99"
    assert set(store.regions()) == {"reg-a", "reg-b", "reg-c", "hex-t1"}


def test_unknown_region_is_an_input_error(release):
    store = open_store(release)
    for call in (lambda: store.region("reg-zzz"), lambda: store.series("reg-zzz", "t_precip_a"),
                 lambda: store.available_products("Taipei")):
        with pytest.raises(AquaError) as err:
            call()
        assert err.value.code == "unknown_region"
    with pytest.raises(AquaError) as err:
        store.series("reg-a", "no_such_product")
    assert err.value.code == "not_found"


def test_unsupported_cadence_and_unit_are_explicit_statuses(release):
    store = open_store(release)
    assert store.series("reg-a", "t_daily") is None
    status, reason = store.series_status("reg-a", "t_daily")
    assert status == "unsupported_resolution" and "daily" in reason
    assert store.series("reg-a", "t_kelvin") is None                # catalogue says °C, data says K: no silent conversion
    status, reason = store.series_status("reg-a", "t_kelvin")
    assert status == "unsupported_resolution" and "no unit conversion" in reason
    assert store.available_products("reg-a") == ["t_precip_a", "t_precip_b", "t_soil"]
    assert store.product("t_daily")["status"] == "unsupported_resolution"
    assert store.manifest["product_status"]["t_kelvin"]["status"] == "unsupported_resolution"
    assert store.product_matrix("t_daily")[0] == []


def test_unsupported_calendar_is_not_read_as_gregorian(release):
    cat = release[0]
    doc = fx.read(cat / "products.json")
    doc["products"][2]["calendar"] = "360_day"
    fx.write(cat / "products.json", doc)
    store = open_store(release)
    assert store.series("reg-a", "t_soil") is None
    assert store.series_status("reg-a", "t_soil") == (
        "unsupported_resolution", "product t_soil uses calendar '360_day'; only the Gregorian calendar is supported")
    assert store.series("reg-a", "t_precip_a") is not None


def test_malformed_series_file_is_reported_and_isolated(release):
    data = release[1]
    doc = fx.read(data / "series" / "reg-c.json")
    doc["layers"]["t_precip_b"]["values"][3] = "0.5"
    fx.write(data / "series" / "reg-c.json", doc)
    store = open_store(release)
    assert store.series("reg-c", "t_precip_b") is None
    status, reason = store.series_status("reg-c", "t_precip_b")
    assert status == "data_required" and "non-numeric" in reason
    assert store.series("reg-a", "t_precip_b") is not None
    ids, _, values = store.product_matrix("t_precip_b")
    assert ids == ["reg-a"] and values.shape == (1, 36)             # the broken region is left out, not filled
    assert "reg-c" in store.series_problems()


def test_missing_series_file_is_data_required(release):
    data = release[1]
    (data / "series" / "reg-c.json").unlink()
    store = open_store(release)
    assert store.manifest["asset_status"]["data.series"]["status"] == "invalid"
    assert store.series("reg-c", "t_precip_b") is None
    assert store.series_status("reg-c", "t_precip_b")[0] == "data_required"
    assert store.series("reg-a", "t_precip_a") is not None          # other series stay readable


def test_series_outside_product_record_is_rejected(release):
    data = release[1]
    doc = fx.read(data / "series" / "reg-c.json")
    doc["layers"]["t_precip_b"]["start"] = "1999-01"
    fx.write(data / "series" / "reg-c.json", doc)
    store = open_store(release)
    assert store.series("reg-c", "t_precip_b") is None
    assert "outside the product record" in store.series_status("reg-c", "t_precip_b")[1]


# --------------------------------------------------------------------------- matrix cache

def test_product_matrix_alignment_and_binary_cache(release, monkeypatch):
    cat, data, cache = release
    store = open_store(release)
    ids, t, values = store.product_matrix("t_precip_b")
    assert ids == ["reg-a", "reg-c"]
    assert t[0] == ym_to_index("2001-01") and t[-1] == ym_to_index("2003-12") and values.shape == (2, 36)
    assert np.isnan(values[1, :2]).all() and values[1, 2] == 0.5    # reg-c starts 2001-03: earlier months stay NaN
    assert np.isnan(values[1, 32:]).all()                           # ... and it ends 2003-08
    np.testing.assert_array_equal(values[0], store.series("reg-a", "t_precip_b").values)
    ids_a, _, values_a = store.product_matrix("t_precip_a")
    assert ids_a == ["reg-a"] and np.isnan(values_a[0, 2]) and values_a[0, 3] == 0.0
    path = cache / store.versions["dataset_version"] / "matrix" / "t_precip_b.npz"
    assert path.exists()

    def boom(*a, **k):
        raise AssertionError("series files must not be re-read when the binary cache is valid")
    monkeypatch.setattr(store_module, "build_matrices", boom)
    again = open_store(release)
    ids2, t2, values2 = again.product_matrix("t_precip_b")
    assert ids2 == ids and np.array_equal(t2, t) and np.array_equal(values2, values, equal_nan=True)


def test_data_update_yields_new_dataset_version_and_cache(release):
    cat, data, cache = release
    before = open_store(release)
    before.product_matrix("t_precip_b")
    doc = fx.read(data / "series" / "reg-c.json")
    doc["layers"]["t_precip_b"]["values"].append(9.75)             # one more month delivered
    fx.write(data / "series" / "reg-c.json", doc)
    variables = fx.read(data / "catalog" / "variables.json")
    variables["layers"]["t_precip_b"]["end"] = "2004-01"
    fx.write(data / "catalog" / "variables.json", variables)
    after = open_store(release)
    assert after.versions["dataset_version"] != before.versions["dataset_version"]
    assert after.snapshot_id() != before.snapshot_id()
    assert after.versions["catalogue_version"] == before.versions["catalogue_version"]
    ids, t, values = after.product_matrix("t_precip_b")
    assert values[1, 32] == 9.75                                    # not served from the old cache
    assert (cache / after.versions["dataset_version"] / "matrix" / "t_precip_b.npz").exists()


def test_versions_and_snapshot_are_stable_and_complete(release):
    a, b = open_store(release), open_store(release)
    for key in ("dataset_version", "catalogue_version", "region_catalogue_version", "indicator_registry_version",
                "quality_policy_version"):
        assert isinstance(a.versions[key], str) and a.versions[key]
        assert a.manifest[key] == a.versions[key]
    assert a.versions == b.versions and a.snapshot_id() == b.snapshot_id()
    assert a.versions["indicator_registry_version"] == "not_delivered"
    assert a.versions["quality_policy_version"] == a.policy("quality_policy")["version"]
    cat = release[0]
    doc = fx.read(cat / "concepts.json")
    doc["concepts"][0]["description"] = "TEST edited"
    fx.write(cat / "concepts.json", doc)                            # edit without bumping the declared version
    c = open_store(release)
    assert c.versions["catalogue_version"] != a.versions["catalogue_version"] and c.snapshot_id() != a.snapshot_id()
    geo = fx.read(release[1] / "geo" / "named.geojson")
    geo["features"][0]["geometry"]["coordinates"][0][1] = [0, 2]
    fx.write(release[1] / "geo" / "named.geojson", geo)             # a boundary change is a new region version
    d = open_store(release)
    assert d.versions["region_catalogue_version"] != c.versions["region_catalogue_version"]
    assert d.region("reg-a")["geometry_version"] != c.region("reg-a")["geometry_version"]


def test_policy_access(release):
    store = open_store(release)
    assert store.policy("method_policy")["alpha"] == json.loads(
        (fx.BACKEND / "catalogue" / "policies" / "method_policy.json").read_text())["alpha"]
    with pytest.raises(AquaError):
        store.policy("no_such_policy")


def test_baseline_support_counts_valid_months(release):
    store = open_store(release)
    support = store.baseline_support("reg-a", "t_soil")
    assert support["baseline_id"] == "clim.t_soil" and support["samples_per_position"] == [3] * 12 and support["ok"]
    assert support["actual_support"] == {"start": "2001-01", "end": "2003-12"}
    short = store.baseline_support("reg-c", "t_precip_b")           # starts 2001-03, ends 2003-08
    assert short["samples_per_position"] == [2, 2, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2] and short["ok"] is False
    assert store.baseline_support("reg-b", "t_soil") is None


# --------------------------------------------------------------------------- manifest / events

def test_pending_events_do_not_block_series_and_are_not_zero(release):
    """Data contract §6.2: an undelivered catalogue is None, never an empty list."""
    store = open_store(release)                                     # strict: pending assets must not raise
    status = store.manifest["asset_status"]
    assert status["events"]["status"] == "pending" and "data_required" in status["events"]["reason"]
    assert status["catalogue.indicators"]["status"] == "pending"
    assert store.event_catalogues() == [] and store.manifest["event_catalogue_status"] == "pending"
    assert store.events("anything", "reg-a") is None
    assert store.event_coverage("anything", "reg-a") is None
    assert store.indicator_recipes() == {}
    assert store.series("reg-a", "t_precip_a") is not None


def test_delivered_events_are_filtered_by_exact_region(release):
    fx.deliver_events(release[0])
    store = open_store(release)
    status = store.manifest["asset_status"]
    assert status["events"]["status"] == "ready" and status["events.t_events"]["status"] == "ready"
    assert status["events.t_pending"]["status"] == "pending" and status["events.t_pending"]["missing_fields"] == ["events_file"]
    assert [e["event_id"] for e in store.events("t_events", "reg-a")] == ["t-e1", "t-e2"]
    assert [e["event_id"] for e in store.events("t_events", "reg-c")] == ["t-e2"]
    assert store.events("t_events", "reg-c")[0]["start"] == "2002"   # source precision is not padded
    assert store.events("t_events", "reg-b") == []                   # delivered catalogue, no event mapped here
    assert store.event_coverage("t_events", "reg-b") is None         # ... but coverage unknown: not a zero count
    assert store.event_coverage("t_events", "reg-a")["completeness"] == "complete"
    assert [s["completeness"] for s in store.event_coverage("t_events", "reg-c")["segments"]] == ["partial", "complete"]
    assert store.events("t_pending", "reg-a") is None
    with pytest.raises(AquaError):
        store.events("t_events", "reg-zzz")


def test_ready_catalogue_without_files_is_invalid_not_empty(release):
    fx.deliver_events(release[0], with_files=False)
    store = open_store(release)                                     # still opens: events are not a required asset
    report = store.manifest["asset_status"]["events.t_events"]
    assert report["status"] == "invalid" and "t_events/events.json" in report["problems"][0]
    assert store.events("t_events", "reg-a") is None
    assert store.series("reg-a", "t_precip_a") is not None


def test_invalid_required_asset_is_located_precisely(release):
    cat = release[0]
    doc = fx.read(cat / "products.json")
    del doc["products"][0]["unit"]
    fx.write(cat / "products.json", doc)
    (cat / "baselines.json").write_text("{not json", "utf-8")
    with pytest.raises(AquaError) as err:
        open_store(release)
    assert err.value.code == "data_release_invalid"
    assert set(err.value.fields) >= {"catalogue.products", "catalogue.baselines"}
    assert "catalogue.products" in err.value.message and "products[t_precip_a].unit" in err.value.message
    store = open_store(release, strict=False)
    status = store.manifest["asset_status"]
    assert status["catalogue.products"]["missing_fields"] == ["products[t_precip_a].unit"]
    assert status["catalogue.baselines"]["status"] == "invalid" and "not valid JSON" in status["catalogue.baselines"]["reason"]
    assert status["catalogue.refs"]["status"] == "ready" and status["data.series_index"]["status"] == "ready"


def test_missing_data_assets_are_reported(release):
    data = release[1]
    (data / "catalog" / "series_index.json").unlink()
    with pytest.raises(AquaError) as err:
        open_store(release)
    assert "data.series_index" in err.value.fields and "series_index.json is missing" in err.value.message
