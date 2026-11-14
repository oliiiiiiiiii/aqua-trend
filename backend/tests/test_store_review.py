"""Independent review tests of PreparedDataStore (work package "store").

They cover gaps the first test set left open: version identity under same-size edits and
unbumped policy edits (contract & policy layer, T16), shared-matrix immutability, event
region mapping / completeness vocabulary (E05, E12 store part), baselines against the
*delivered* record (T07), and an independent re-read of real series files (D09).
Miniature-release inputs are TEST data from tests/fixtures/store.
"""
from __future__ import annotations

import json
import os
import random
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).parent / "fixtures" / "store"))
import store_support as fx  # noqa: E402

from aqua_trend.store import DEFAULT_DATA_DIR, PreparedDataStore  # noqa: E402
from aqua_trend.timeaxis import ym_to_index  # noqa: E402

HAS_REAL_DATA = (DEFAULT_DATA_DIR / "catalog" / "series_index.json").exists()
realdata = pytest.mark.skipif(not HAS_REAL_DATA, reason="prepared data not present")


@pytest.fixture()
def release(tmp_path):
    return fx.build_release(tmp_path)


def open_store(release, **kw) -> PreparedDataStore:
    return PreparedDataStore.open(*release, **kw)


def _rewrite_same_size(path: Path, old: str, new: str) -> None:
    """Replace ``old`` by an equally long ``new`` and push mtime forward (coarse clocks can repeat a tick)."""
    text = path.read_text("utf-8")
    assert len(old) == len(new) and text.count(old) >= 1
    size = path.stat().st_size
    path.write_text(text.replace(old, new, 1), "utf-8")
    assert path.stat().st_size == size
    stamp = path.stat().st_mtime_ns + 2_000_000_000
    os.utime(path, ns=(stamp, stamp))


# --------------------------------------------------------------------------- version identity

def test_same_size_value_change_is_a_new_dataset_version(release):
    """A re-export that changes digits but no file size must not be served from the old matrix cache."""
    _, data, cache = release
    before = open_store(release)
    assert before.product_matrix("t_precip_b")[2][1, 2] == 0.5
    _rewrite_same_size(data / "series" / "reg-c.json", "0.5", "0.7")
    after = open_store(release)
    assert after.versions["dataset_version"] != before.versions["dataset_version"]
    assert after.snapshot_id() != before.snapshot_id()
    assert after.series("reg-c", "t_precip_b").values[0] == 0.7
    assert after.product_matrix("t_precip_b")[2][1, 2] == 0.7        # matrix and series agree


def test_dataset_version_is_a_content_hash_independent_of_mtime_and_cache(release, tmp_path):
    cat, data, cache = release
    first = open_store(release).versions["dataset_version"]
    assert (cache / "series-digest.json").exists()
    for path in (data / "series").iterdir():
        os.utime(path, ns=(10**18, 10**18))                          # touched, content unchanged
    assert PreparedDataStore.open(cat, data, tmp_path / "other-cache").versions["dataset_version"] == first
    (cache / "series-digest.json").write_text("{broken", "utf-8")    # a corrupt memo is recomputed, not trusted
    assert open_store(release).versions["dataset_version"] == first


def test_policy_edit_without_version_bump_changes_the_snapshot(release):
    cat = release[0]
    before = open_store(release)
    path = cat / "policies" / "method_policy.json"
    policy = fx.read(path)
    policy["alpha"] = policy["alpha"] / 2                            # number edited, version string left alone
    fx.write(path, policy)
    after = open_store(release)
    assert after.versions["method_policy_version"] == before.versions["method_policy_version"]
    assert after.versions["catalogue_content_digest"] != before.versions["catalogue_content_digest"]
    assert after.snapshot_id() != before.snapshot_id()
    assert after.versions["dataset_version"] == before.versions["dataset_version"]


def test_delivering_events_changes_the_snapshot(release):
    before = open_store(release).snapshot_id()
    fx.deliver_events(release[0])
    assert open_store(release).snapshot_id() != before


# --------------------------------------------------------------------------- shared arrays

def test_product_matrix_is_read_only_built_and_cached(release):
    for store in (open_store(release), open_store(release)):         # first: built; second: read from the cache
        ids, t, values = store.product_matrix("t_precip_b")
        with pytest.raises(ValueError):
            values[0, 0] = -1.0
        with pytest.raises(ValueError):
            t[0] = 0
    series = store.series("reg-a", "t_precip_b")
    series.values[0] = -1.0                                          # a series is the caller's own copy
    assert store.product_matrix("t_precip_b")[2][0, 0] == 2.0


def test_prepared_series_is_compared_by_identity(release):
    store = open_store(release)
    a, b = store.series("reg-a", "t_precip_a"), store.series("reg-a", "t_precip_a")
    assert a != b and a == a and len({a, b}) == 2                    # no ambiguous array comparison is raised


# --------------------------------------------------------------------------- series edge cases

def test_nan_literal_in_a_series_file_is_a_contract_violation(release):
    data = release[1]
    path = data / "series" / "reg-c.json"
    path.write_text(path.read_text("utf-8").replace("0.5", "NaN", 1), "utf-8")
    store = open_store(release)
    assert store.series("reg-c", "t_precip_b") is None
    status, reason = store.series_status("reg-c", "t_precip_b")
    assert status == "data_required" and "missing must be null" in reason


def test_layer_in_file_but_not_in_index_is_not_served(release):
    """Availability comes from the series index (data contract §3), not from what happens to be in a file."""
    data = release[1]
    doc = fx.read(data / "series" / "reg-c.json")
    doc["layers"]["t_soil"] = {"start": "2000-01", "values": [1.0] * 48}
    fx.write(data / "series" / "reg-c.json", doc)
    store = open_store(release)
    assert store.available_products("reg-c") == ["t_precip_b"]
    assert store.series("reg-c", "t_soil") is None and store.series_status("reg-c", "t_soil")[0] == "no_series"


# --------------------------------------------------------------------------- baselines vs delivered record (T07)

def test_baseline_must_lie_inside_the_delivered_record(release):
    """A re-delivery with a shorter record invalidates the baseline even if products.json still says otherwise."""
    cat, data, _ = release
    variables = fx.read(data / "catalog" / "variables.json")
    variables["layers"]["t_soil"]["start"] = "2002-01"                # the baseline needs 2001-01..2003-12
    fx.write(data / "catalog" / "variables.json", variables)
    doc = fx.read(data / "series" / "reg-a.json")
    doc["layers"]["t_soil"] = {"start": "2002-01", "values": fx.SOIL[24:]}
    fx.write(data / "series" / "reg-a.json", doc)
    store = open_store(release, strict=False)
    status = store.manifest["asset_status"]["catalogue.baselines"]
    assert status["status"] == "invalid"
    assert "clim.t_soil" in status["problems"][0] and "2002-01..2003-12" in status["problems"][0]
    assert any("differs from the delivered" in n for n in store.manifest["asset_status"]["catalogue.products"]["notes"])
    assert store.product("t_soil")["start"] == "2002-01"             # the delivered bound is what is served


def test_longer_delivered_record_is_a_note_not_an_error(release):
    data = release[1]
    variables = fx.read(data / "catalog" / "variables.json")
    variables["layers"]["t_precip_b"]["end"] = "2004-06"
    fx.write(data / "catalog" / "variables.json", variables)
    store = open_store(release)                                      # strict open still succeeds
    notes = store.manifest["asset_status"]["catalogue.products"]["notes"]
    assert any("t_precip_b" in n and "2004-06" in n for n in notes)
    assert store.product("t_precip_b")["end"] == "2004-06"


# --------------------------------------------------------------------------- events (E05 / E12 store part)

def _events_path(cat: Path, kind: str) -> Path:
    return cat / "events" / "t_events" / f"{kind}.json"


def test_event_mapped_to_an_unknown_region_invalidates_the_catalogue(release):
    """A mistyped region id would drop events silently and turn a 'complete' year into a false zero."""
    cat = release[0]
    fx.deliver_events(cat)
    doc = fx.read(_events_path(cat, "events"))
    doc["events"][0]["region_ids"] = ["reg-A"]
    fx.write(_events_path(cat, "events"), doc)
    store = open_store(release)
    report = store.manifest["asset_status"]["events.t_events"]
    assert report["status"] == "invalid" and "reg-A" in report["problems"][0]
    assert store.events("t_events", "reg-a") is None and store.event_coverage("t_events", "reg-a") is None
    assert store.series("reg-a", "t_precip_a") is not None


def test_event_region_ids_must_be_a_list(release):
    cat = release[0]
    fx.deliver_events(cat)
    doc = fx.read(_events_path(cat, "events"))
    doc["events"][0]["region_ids"] = "reg-a,reg-c"                   # a string would substring-match region ids
    fx.write(_events_path(cat, "events"), doc)
    store = open_store(release)
    assert store.manifest["asset_status"]["events.t_events"]["status"] == "invalid"
    assert store.events("t_events", "reg-a") is None


@pytest.mark.parametrize("change, text", [
    ({"completeness": "full"}, "completeness"),
    ({"completeness": None}, None),
    ({"region_id": "reg-nowhere"}, "reg-nowhere"),
])
def test_coverage_records_use_the_fixed_vocabulary_and_existing_regions(release, change, text):
    cat = release[0]
    fx.deliver_events(cat)
    doc = fx.read(_events_path(cat, "coverage"))
    doc["coverage"][0].update(change)
    fx.write(_events_path(cat, "coverage"), doc)
    store = open_store(release)
    report = store.manifest["asset_status"]["events.t_events"]
    assert report["status"] == "invalid"
    if text:
        assert text in " ".join(report["problems"])
    else:
        assert report["missing_fields"] == ["coverage[0].completeness"]
    assert store.event_coverage("t_events", "reg-a") is None         # never read as complete


# --------------------------------------------------------------------------- real data

@realdata
def test_real_series_and_matrices_match_an_independent_read_of_the_files():
    """D09 on a random sample: every value, null position and calendar offset equals the delivered JSON."""
    store = PreparedDataStore.open()
    index = json.loads((DEFAULT_DATA_DIR / "catalog" / "series_index.json").read_text("utf-8"))["regions"]
    rng = random.Random(20261115)
    checked = 0
    for region_id in rng.sample(sorted(index), 12):
        doc = json.loads((DEFAULT_DATA_DIR / "series" / f"{region_id}.json").read_text("utf-8"))
        assert set(doc["layers"]) == set(index[region_id]) == set(store.available_products(region_id))
        for product_id in rng.sample(sorted(doc["layers"]), min(4, len(doc["layers"]))):
            layer = doc["layers"][product_id]
            year, month = (int(x) for x in layer["start"].split("-"))
            expected = np.array([np.nan if v is None else v for v in layer["values"]], dtype=float)
            series = store.series(region_id, product_id)
            assert int(series.t[0]) == year * 12 + month - 1 and np.all(np.diff(series.t) == 1)
            np.testing.assert_array_equal(series.values, expected)
            assert series.n_valid == sum(v is not None for v in layer["values"])
            ids, t, values = store.product_matrix(product_id)
            row, off = values[ids.index(region_id)], int(series.t[0] - t[0])
            np.testing.assert_array_equal(row[off:off + expected.size], expected)
            assert np.isnan(row[:off]).all() and np.isnan(row[off + expected.size:]).all()
            checked += 1
    assert checked >= 36


@realdata
def test_real_baselines_are_reported_insufficient_where_the_data_is_missing():
    """T07: a region whose record cannot support the registered reference is flagged, not silently shortened."""
    store = PreparedDataStore.open()
    counts = {}
    for product_id in ("ndvi", "sst", "tws", "p_gpcp"):
        base = store.baseline_for(store.product(product_id)["variable_id"], product_id)
        ids, t, values = store.product_matrix(product_id)
        inside = (t >= ym_to_index(base["start"])) & (t <= ym_to_index(base["end"]))
        per_month = np.stack([np.isfinite(values[:, inside & (t % 12 == m)]).sum(axis=1) for m in range(12)], axis=1)
        short = per_month.min(axis=1) < base["minimum_samples"]
        counts[product_id] = int(short.sum())
        for row in ([int(np.argmax(short))] if short.any() else []) + [int(np.argmin(short))]:
            support = store.baseline_support(ids[row], product_id)
            assert support["samples_per_position"] == per_month[row].tolist()
            assert support["ok"] is (not bool(short[row]))
            assert (support["baseline_id"], support["minimum_samples"]) == (base["baseline_id"], base["minimum_samples"])
    assert counts["tws"] == 0 and counts["p_gpcp"] == 0              # the registered periods fit these records
    assert counts["ndvi"] > 0 and counts["sst"] > 0                  # polar night / sea ice: insufficient_baseline


@realdata
def test_real_release_declares_every_version_and_no_stale_registration():
    store = PreparedDataStore.open()
    assert set(store.versions) >= {"dataset_version", "catalogue_version", "region_catalogue_version",
                                   "indicator_registry_version", "quality_policy_version", "method_policy_version",
                                   "preset_policy_version", "catalogue_content_digest"}
    assert all(isinstance(v, str) and v for v in store.versions.values())
    assert not any("registered against" in n for n in store.manifest["asset_status"]["data.series_index"]["notes"])
    assert store.manifest["asset_status"]["catalogue.products"]["notes"] == []
    json.dumps(store.manifest, allow_nan=False)                       # the manifest itself is API-safe
