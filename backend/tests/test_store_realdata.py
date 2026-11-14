"""Smoke tests of PreparedDataStore on the prepared export-2 / series-2 data in web/public/data.

Acceptance: D01, D02, D03, D09 on real prepared data. These tests compare the store with
the delivered files; they assert no scientific result.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aqua_trend.store import DEFAULT_DATA_DIR, PreparedDataStore  # noqa: E402
from aqua_trend.timeaxis import ym_to_index  # noqa: E402

pytestmark = [pytest.mark.realdata,
              pytest.mark.skipif(not (DEFAULT_DATA_DIR / "catalog" / "series_index.json").exists(),
                                 reason="prepared data not present")]
TAIWAN = "named-taiwan-main-island"


@pytest.fixture(scope="module")
def store():
    return PreparedDataStore.open()


def raw_layer(region_id: str, product_id: str) -> dict:
    doc = json.loads((DEFAULT_DATA_DIR / "series" / f"{region_id}.json").read_text("utf-8"))
    return doc["layers"][product_id]


def test_release_opens_with_events_pending(store):
    status = store.manifest["asset_status"]
    blocking = {a: s for a, s in status.items() if s["status"] == "invalid"}
    assert blocking == {}
    assert store.manifest["event_catalogue_status"] == "pending"
    for cid in [c["catalogue_id"] for c in store.event_catalogues()]:
        assert store.events(cid, TAIWAN) is None and store.event_coverage(cid, TAIWAN) is None
    assert store.versions["dataset_version"].startswith("export-2.")
    assert store.manifest["dataset"]["registered_against_dataset_version"] == store.versions["dataset_version"]
    assert store.snapshot_id() == PreparedDataStore.open().snapshot_id()
    assert store.manifest["series_index"]["regions_with_series"] == 1706
    assert all(p["status"] == "ok" for p in store.products().values())


def test_region_catalogue(store):
    regions = store.regions()
    assert len(regions) == 7641
    by_type: dict[str, int] = {}
    for r in regions.values():
        by_type[r["type"]] = by_type.get(r["type"], 0) + 1
        assert r["geometry_ref"] == f"geo/{r['layer']}.geojson#{r['id']}" and r["geometry_version"]
        assert r["name"] and r["name_zh"] and len(r["centroid"]) == 2
    assert by_type == {"basin3": 292, "basin4": 1342, "named": 42, "hex": 5882, "lme": 66, "sea": 15, "ice": 2}
    assert not any(r["series_available"] for r in regions.values() if r["type"] == "hex")
    assert sum(r["series_available"] for r in regions.values()) == 1706
    taiwan = store.region(TAIWAN)
    assert taiwan["name"] == "Taiwan main island (coastline)" and taiwan["name_zh"] == "台灣本島"
    assert taiwan["type"] == "named" and taiwan["surface"] == "land" and taiwan["area_km2"] == 35801
    assert store.region("sea-NAO")["name"] == "North Atlantic"
    assert store.region("b3-1030000010")["name"] == "Basin 111 (Sudan, Eritrea, Egypt)"


def test_taiwan_precipitation_series(store):
    """D03: the primary precipitation product, one source for the whole series."""
    assert store.concept("precip")["approved_product_ids"][0] == "p_imerg"
    s = store.series(TAIWAN, "p_imerg")
    raw = raw_layer(TAIWAN, "p_imerg")
    assert (s.variable_id, s.unit, s.cadence, s.calendar, s.temporal_support) == (
        "precip", "mm/day", "monthly", "gregorian", "monthly_mean_rate")
    assert s.start == raw["start"] == "1998-01" and len(s.values) == len(raw["values"]) == 333 and s.end == "2025-09"
    assert np.all(np.diff(s.t) == 1) and s.n_valid == 333
    np.testing.assert_array_equal(s.values, np.array(raw["values"], dtype=float))    # values untouched


def test_taiwan_grace_gap_keeps_calendar_positions(store):
    """D09: the GRACE / GRACE-FO gap is NaN at its own months; nothing is filled."""
    s = store.series(TAIWAN, "tws")
    raw = raw_layer(TAIWAN, "tws")["values"]
    assert s.start == "2002-04" and len(s.t) == len(raw)
    at = {m: float(s.values[ym_to_index(m) - int(s.t[0])]) for m in
          ("2017-06", "2017-07", "2017-12", "2018-05", "2018-06")}
    assert not np.isnan(at["2017-06"]) and not np.isnan(at["2018-06"])
    assert all(np.isnan(at[m]) for m in ("2017-07", "2017-12", "2018-05"))
    assert int(np.isnan(s.values).sum()) == raw.count(None) > 11
    assert s.to_contract()["values"][ym_to_index("2017-07") - int(s.t[0])] is None


def test_taiwan_zero_stays_zero(store):
    s = store.series(TAIWAN, "swe")                                  # no snow in the model for Taiwan: real zeros
    raw = raw_layer(TAIWAN, "swe")["values"]
    assert raw.count(0) + raw.count(0.0) > 0
    assert int((s.values == 0.0).sum()) == sum(1 for v in raw if v == 0) and s.n_valid == len(raw) - raw.count(None)


def test_taiwan_products_and_missing_ocean_product(store):
    available = store.available_products(TAIWAN)
    assert len(available) == 25 and "sst" not in available
    assert store.series(TAIWAN, "sst") is None
    assert store.series_status(TAIWAN, "sst")[0] == "no_series"
    assert store.series("sea-NAO", "sst").start == "1982-01"


def test_boundary_without_series_is_never_substituted(store):
    """D02 on real regions: hexagons and 53 basins have a boundary but no series."""
    regions = store.regions()
    no_series = [r for r in regions.values() if not r["series_available"] and r["type"] != "hex"]
    assert len(no_series) == 53
    with_parent = [r for r in no_series if r["parent"] and regions[r["parent"]]["series_available"]]
    assert with_parent, "expected a sub-basin without series whose parent has series"
    for r in with_parent[:5]:
        assert store.available_products(r["id"]) == []
        assert store.series(r["id"], "p_imerg") is None             # the parent's series is not borrowed
        assert store.series(r["parent"], "p_imerg") is not None
        assert store.series_status(r["id"], "p_imerg")[0] == "no_series"
    hexa = next(r for r in regions.values() if r["type"] == "hex")
    assert store.series(hexa["id"], "p_imerg") is None and "hexagon" in store.series_status(hexa["id"], "p_imerg")[1]


def test_registered_baselines_are_supported_by_the_data(store):
    tws = store.baseline_support(TAIWAN, "tws")
    assert tws["baseline_id"] == "clim.tws.2003-2022" and tws["ok"] and min(tws["samples_per_position"]) == 16
    gpcp = store.baseline_support(TAIWAN, "p_gpcp")
    assert gpcp["samples_per_position"] == [30] * 12 and gpcp["actual_support"] == {"start": "1991-01", "end": "2020-12"}
    imerg = store.baseline_support(TAIWAN, "p_imerg")
    assert imerg["samples_per_position"] == [20] * 12 and store.baseline("clim.p_imerg.2001-2020")["designation"] == \
        "registered_reference_mean"


def test_product_matrix_matches_series(store):
    ids, t, values = store.product_matrix("tws")
    assert len(ids) == store.manifest["series_index"]["regions_per_product"]["tws"] == 1664
    assert values.shape == (1664, 294) and values.dtype == np.float64 and t[0] == ym_to_index("2002-04")
    row = ids.index(TAIWAN)
    np.testing.assert_array_equal(values[row], store.series(TAIWAN, "tws").values)
    assert np.isnan(values[:, ym_to_index("2017-10") - int(t[0])]).all()        # mission gap for every region
    ids_n, t_n, values_n = store.product_matrix("ndvi")                         # regions start in different months
    assert t_n[0] == ym_to_index("2000-02") and values_n.shape[1] == 321
    assert (store.cache_dir / store.versions["dataset_version"] / "matrix" / "tws.npz").exists()
