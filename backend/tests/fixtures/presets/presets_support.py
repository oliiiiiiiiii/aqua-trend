"""TEST DATA ONLY — a miniature release with long TEST series for the preset engine tests.

All ids start with ``t_`` / ``reg-`` / ``hex-``; all values are arbitrary deterministic test
numbers.  Nothing in this file is a scientific product or result.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np

BACKEND = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tests" / "fixtures" / "store"))
sys.path.insert(0, str(BACKEND / "tests" / "fixtures" / "engine"))

import engine_support as es  # noqa: E402,F401  (re-exported: FakeSelector, make_plan)
import store_support as fx  # noqa: E402

START, END, N_MONTHS = "1988-01", "2021-12", 34 * 12
BASE_START, BASE_END = "1991-01", "2020-12"
QUERY, QUERY_2 = "TEST phenomenon", "TEST other phenomenon"
PATTERN = [0.0, 0.4, 0.9, 1.0, 0.7, 0.2, -0.3, -0.8, -1.0, -0.7, -0.4, -0.1]


def test_series(n: int, base: float, step_per_month: float, season: float, noise: float, seed: int,
                first: int = 0) -> list[float]:
    """TEST numbers: line + fixed 12-month pattern + seeded noise (deterministic, arbitrary)."""
    rng = np.random.RandomState(seed)
    eps = rng.normal(0.0, noise, n) if noise else np.zeros(n)
    return [round(float(base + step_per_month * (first + i) + season * PATTERN[(first + i) % 12] + eps[i]), 6)
            for i in range(n)]


test_series.__test__ = False  # not a pytest test


def _layers() -> dict[str, dict]:
    return {"t_precip_a": fx._layer("mm/day", START, END), "t_precip_b": fx._layer("mm/day", START, END),
            "t_soil": fx._layer("mm", START, END)}


def _baseline(pid: str, variable_id: str) -> dict:
    return {**fx._baseline(pid, variable_id), "start": BASE_START, "end": BASE_END, "minimum_samples": 24}


REGIONS = [
    {"id": "reg-a", "type": "named", "name": "Test region A", "surface": "land", "area_km2": 10, "centroid": [1.0, 2.0]},
    {"id": "reg-b", "type": "basin4", "name": "Test basin4 B", "surface": "land", "area_km2": 5, "centroid": [1.0, 2.0],
     "parent": "reg-e"},
    {"id": "reg-c", "type": "named", "name": "Test region C", "surface": "land", "area_km2": 7, "centroid": [5.0, 6.0]},
    {"id": "reg-e", "type": "basin3", "name": "Test basin3 E", "surface": "land", "area_km2": 9, "centroid": [3.0, 3.0]},
    {"id": "reg-f", "type": "lme", "name": "Test LME F", "surface": "ocean", "area_km2": 8, "centroid": [4.0, 4.0]},
    {"id": "reg-g", "type": "sea", "name": "Test sea G", "surface": "ocean", "area_km2": 6, "centroid": [6.0, 6.0]},
    {"id": "reg-n", "type": "named", "name": "Test region N (no series)", "surface": "land", "area_km2": 2,
     "centroid": [7.0, 7.0]},
    {"id": "hex-t1", "type": "hex", "name": "Test hex t1", "surface": "ocean", "area_km2": 3, "centroid": [9.0, 9.0]},
]

SERIES = {
    "reg-a": {"t_precip_a": test_series(N_MONTHS, 3.0, 0.004, 1.0, 0.25, 11),
              "t_precip_b": test_series(N_MONTHS, 2.0, 0.001, 0.5, 0.25, 12),
              "t_soil": test_series(N_MONTHS, 110.0, -0.03, 5.0, 2.0, 13)},
    "reg-b": {"t_precip_a": test_series(N_MONTHS, 1.0, 0.002, 0.3, 0.2, 21),
              "t_soil": test_series(N_MONTHS, 90.0, 0.01, 4.0, 2.0, 22)},
    "reg-c": {"t_precip_b": test_series(N_MONTHS, 0.5, 0.0015, 0.2, 0.1, 31)},
    "reg-f": {"t_precip_a": test_series(N_MONTHS, 2.0, 0.0, 0.8, 0.3, 41),
              "t_soil": test_series(N_MONTHS, 100.0, 0.0, 3.0, 2.5, 42)},
    "reg-g": {"t_precip_a": test_series(N_MONTHS, 4.0, -0.002, 0.6, 0.3, 51),
              "t_soil": [50.0] * N_MONTHS},                                   # constant: zero baseline variance
}
#: reg-e: record starts 2005-01, so the fixed TEST baseline 1991..2020 is not supported
SERIES_LATE = {"reg-e": {"t_precip_a": test_series(17 * 12, 2.0, 0.003, 0.5, 0.2, 61, first=17 * 12),
                         "t_soil": test_series(17 * 12, 80.0, 0.02, 4.0, 2.0, 62, first=17 * 12)}}


def build_preset_release(root: Path, *, manual: Optional[list[dict]] = None, manual_version: str = "t-manual",
                         series_override: Optional[dict[str, dict[str, list]]] = None) -> tuple[Path, Path, Path]:
    """Write the TEST release under ``root`` and return ``(catalogue_dir, data_dir, cache_dir)``."""
    cat, data, cache = root / "catalogue", root / "data", root / "cache"
    series = {**{rid: dict(layers) for rid, layers in SERIES.items()}}
    for rid, layers in (series_override or {}).items():
        series[rid] = {**series.get(rid, {}), **layers}
    fx.write(data / "catalog" / "variables.json", {"version": "test-export", "generated": "2000-01-01",
                                                   "layers": _layers()})
    index = {rid: sorted(layers) for rid, layers in series.items()}
    index["reg-e"] = sorted(SERIES_LATE["reg-e"])
    fx.write(data / "catalog" / "series_index.json", {"version": "series-2", "regions": index})
    fx.write(data / "catalog" / "regions.json", {"generated": "test", "regions": REGIONS})
    fx.write(data / "catalog" / "countries.json", {})
    for layer in fx.GEO_LAYERS:
        feats = [{"type": "Feature", "properties": {"id": r["id"], "name": r["id"]},
                  "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]}}
                 for r in REGIONS if r["type"] == layer]
        fx.write(data / "geo" / f"{layer}.geojson", {"type": "FeatureCollection", "features": feats})
    for rid, layers in series.items():
        fx.write(data / "series" / f"{rid}.json", {"id": rid, "version": "series-2", "layers": {
            pid: {"start": START, "values": values} for pid, values in layers.items()}})
    fx.write(data / "series" / "reg-e.json", {"id": "reg-e", "version": "series-2", "layers": {
        pid: {"start": "2005-01", "values": values} for pid, values in SERIES_LATE["reg-e"].items()}})

    fx.write(cat / "refs.json", {"version": "t-refs", "refs": [
        {"ref_id": "t_ref", "title": "TEST reference (not a real publication)", "url": "https://example.invalid/test",
         "verified": False}]})
    products = [fx._product("t_precip_a", "t_precip", "mm/day", "t_precip_class", start=START, end=END),
                fx._product("t_precip_b", "t_precip", "mm/day", "t_precip_class", start=START, end=END),
                fx._product("t_soil", "t_soil", "mm", "t_soil_class", start=START, end=END)]
    fx.write(cat / "products.json", {"version": "t-products", "products": products})
    fx.write(cat / "baselines.json", {"version": "t-baselines", "baselines": [
        _baseline("t_precip_a", "t_precip"), _baseline("t_precip_b", "t_precip"), _baseline("t_soil", "t_soil")]})
    fx.write(cat / "concepts.json", {"version": "t-concepts", "concepts": [
        fx._concept("t_precip", "mm/day", "t_precip_class", ["t_precip_a", "t_precip_b"]),
        fx._concept("t_soil", "mm", "t_soil_class", ["t_soil"])]})
    fx.write(cat / "phenomena.json", {"version": "t-phenomena", "phenomena": [
        {"phenomenon_id": pid, "label": label, "label_zh": "測試現象", "aliases": {"zh": ["測試"], "en": ["test"]},
         "description": "TEST", "variable_links": [{"variable_id": "t_precip", "role": "core_indicator",
                                                     "statement": "TEST", "limits": "TEST", "ref_ids": ["t_ref"]}],
         "indicator_ids": [], "unanswerable_notes": ["TEST"]}
        for pid, label in (("t_phen", "TEST phenomenon"), ("t_phen2", "TEST other phenomenon"))]})
    fx.write(cat / "manual_presets.json", {"version": manual_version, "adjustments": manual or []})
    fx.write(cat / "manifest.json", {"manifest_version": "t-manifest", "catalogue_version": "t-catalogue",
                                     "dataset": {"export_version": "test-export"}, "asset_status": {}})
    shutil.copytree(BACKEND / "catalogue" / "policies", cat / "policies")
    return cat, data, cache


def set_policy(cat: Path, name: str, **changes: Any) -> None:
    """Edit a copied TEST policy file in place (used to prove that a policy change is a new version)."""
    path = cat / "policies" / f"{name}.json"
    doc = json.loads(path.read_text("utf-8"))
    doc.update(changes)
    path.write_text(json.dumps(doc), "utf-8")


def plans(store: Any) -> tuple[Any, Any]:
    """Two scripted TEST plans (different phenomenon texts) for the same TEST catalogue."""
    first = es.make_plan(store, QUERY, [("t_precip", "core_indicator"), ("t_soil", "related_condition")],
                         phenomenon_id="t_phen")
    second = es.make_plan(store, QUERY_2, [("t_soil", "core_indicator")], phenomenon_id="t_phen2")
    return first, second
