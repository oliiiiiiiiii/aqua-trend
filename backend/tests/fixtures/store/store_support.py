"""TEST DATA ONLY — builds a miniature data release for PreparedDataStore tests.

All ids start with ``t_`` / ``reg-`` / ``hex-`` and all values are arbitrary test
numbers. Nothing in this file is a scientific product or result.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[3]
GEO_LAYERS = ("basin3", "basin4", "named", "hex", "lme", "sea", "ice")

#: TEST series: null and zero are placed on purpose (2000-03 null, 2000-04 zero)
PRECIP_A = [1.5, 2.0, None, 0.0, 3.25, 0, None, 4.0] + [1.0] * 40      # 2000-01 .. 2003-12
PRECIP_B = [2.0] * 36                                                    # 2001-01 .. 2003-12
SOIL = [100.0, None, 120.5] + [110.0] * 45                              # 2000-01 .. 2003-12


def write(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False), "utf-8")


def read(path: Path) -> Any:
    return json.loads(path.read_text("utf-8"))


def _layer(unit: str, start: str, end: str) -> dict:
    return {"name": "TEST", "category": "test", "product": "TEST", "nasa": False, "family": "TEST", "unit": unit,
            "start": start, "end": end, "visual": "", "caveat": None}


def _product(pid: str, variable_id: str, unit: str, dclass: str, **over: Any) -> dict:
    out = {"product_id": pid, "variable_id": variable_id, "agency": "TEST", "product_name": f"TEST {pid}",
           "version": "test", "source_refs": ["t_ref"], "unit": unit, "physical_definition": "TEST definition",
           "definition_class": dclass, "native_resolution": "test", "prepared_resolution": "test",
           "temporal_support": "monthly_mean_rate", "cadence": "monthly", "calendar": "gregorian",
           "quality_limits": [], "caveat": None, "nasa": False, "family": "TEST", "start": "2000-01", "end": "2003-12"}
    out.update(over)
    return out


def _baseline(pid: str, variable_id: str) -> dict:
    return {"baseline_id": f"clim.{pid}", "version": "1", "kind": "seasonal_reference", "product_id": pid,
            "start": "2001-01", "end": "2003-12", "designation": "registered_reference_mean", "rule": "TEST rule",
            "minimum_samples": 3, "refs": ["t_ref"], "applies_to": [variable_id]}


def _concept(variable_id: str, unit: str, dclass: str, approved: list[str]) -> dict:
    return {"variable_id": variable_id, "label": f"TEST {variable_id}", "label_zh": "測試", "description": "TEST",
            "quantity_definition": {"quantity": "test", "nature": "flux", "depth_or_height": "surface",
                                    "observed_or_modelled": "test", "definition_class": dclass},
            "unit": unit, "temporal_support": "monthly_mean_rate", "data_kind": "continuous",
            "scientific_refs": ["t_ref"], "approved_product_ids": approved,
            "baseline_ref": {pid: f"clim.{pid}" for pid in approved}, "relative_change": None,
            "display_semantics": {"color": "#000000", "increase_reads": "more", "decimals": 2, "orb_channel": None}}


def build_release(root: Path) -> tuple[Path, Path, Path]:
    """Write the TEST release under ``root`` and return ``(catalogue_dir, data_dir, cache_dir)``."""
    cat, data, cache = root / "catalogue", root / "data", root / "cache"
    # ---- data (TEST values)
    write(data / "catalog" / "variables.json", {
        "version": "test-export", "generated": "2000-01-01",
        "layers": {"t_precip_a": _layer("mm/day", "2000-01", "2003-12"), "t_precip_b": _layer("mm/day", "2001-01", "2003-12"),
                   "t_soil": _layer("mm", "2000-01", "2003-12"), "t_daily": _layer("mm/day", "2000-01", "2003-12"),
                   "t_kelvin": _layer("K", "2000-01", "2003-12")}})
    write(data / "catalog" / "series_index.json", {
        "version": "series-2", "regions": {"reg-a": ["t_precip_a", "t_precip_b", "t_soil", "t_daily", "t_kelvin"],
                                           "reg-c": ["t_precip_b"]}})
    regions = [
        {"id": "reg-a", "type": "named", "name": "Test region A", "surface": "land", "area_km2": 10, "centroid": [1.0, 2.0],
         "bbox": [0, 1, 2, 3], "countries": [{"zh": "測試", "iso": "TWN"}]},
        {"id": "reg-b", "type": "basin4", "name": "測試 流域 99", "surface": "land", "area_km2": 5, "centroid": [1.0, 2.0],
         "bbox": [0, 1, 2, 3], "parent": "reg-a", "pfaf": 99},
        {"id": "reg-c", "type": "named", "name": "Test region C", "surface": "land", "area_km2": 7, "centroid": [5.0, 6.0]},
        {"id": "hex-t1", "type": "hex", "name": "Test Sea 六角格 t1", "surface": "ocean", "area_km2": 3, "centroid": [9.0, 9.0]},
    ]
    write(data / "catalog" / "regions.json", {"generated": "test", "regions": regions})
    write(data / "catalog" / "countries.json", {"TWN": {"zh": "測試", "regions": ["reg-a"]}})
    by_layer = {"named": ["reg-a", "reg-c"], "basin4": ["reg-b"], "hex": ["hex-t1"]}
    for layer in GEO_LAYERS:
        feats = [{"type": "Feature", "properties": {"id": rid, "name": rid},
                  "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]}}
                 for rid in by_layer.get(layer, [])]
        write(data / "geo" / f"{layer}.geojson", {"type": "FeatureCollection", "features": feats})
    write(data / "series" / "reg-a.json", {"id": "reg-a", "version": "series-2", "layers": {
        "t_precip_a": {"start": "2000-01", "values": PRECIP_A}, "t_precip_b": {"start": "2001-01", "values": PRECIP_B},
        "t_soil": {"start": "2000-01", "values": SOIL}, "t_daily": {"start": "2000-01", "values": [1.0] * 48},
        "t_kelvin": {"start": "2000-01", "values": [280.0] * 48}}})
    write(data / "series" / "reg-c.json", {"id": "reg-c", "version": "series-2", "layers": {
        "t_precip_b": {"start": "2001-03", "values": [0.5] * 30}}})
    # ---- catalogue (TEST entries)
    write(cat / "refs.json", {"version": "t-refs", "refs": [
        {"ref_id": "t_ref", "title": "TEST reference (not a real publication)", "url": "https://example.invalid/test",
         "verified": False}]})
    write(cat / "products.json", {"version": "t-products", "products": [
        _product("t_precip_a", "t_precip", "mm/day", "t_precip_class"),
        _product("t_precip_b", "t_precip", "mm/day", "t_precip_class", start="2001-01"),
        _product("t_soil", "t_soil", "mm", "t_soil_class"),
        _product("t_daily", "t_daily", "mm/day", "t_daily_class", cadence="daily"),
        _product("t_kelvin", "t_temp", "°C", "t_temp_class")]})
    write(cat / "baselines.json", {"version": "t-baselines", "baselines": [
        _baseline("t_precip_a", "t_precip"), _baseline("t_precip_b", "t_precip"), _baseline("t_soil", "t_soil"),
        _baseline("t_daily", "t_daily"), _baseline("t_kelvin", "t_temp")]})
    write(cat / "concepts.json", {"version": "t-concepts", "concepts": [
        _concept("t_precip", "mm/day", "t_precip_class", ["t_precip_a", "t_precip_b"]),
        _concept("t_soil", "mm", "t_soil_class", ["t_soil"]),
        _concept("t_daily", "mm/day", "t_daily_class", ["t_daily"]),
        _concept("t_temp", "°C", "t_temp_class", ["t_kelvin"])]})
    write(cat / "phenomena.json", {"version": "t-phenomena", "phenomena": [
        {"phenomenon_id": "t_phen", "label": "TEST phenomenon", "label_zh": "測試現象", "aliases": {"zh": ["測試"], "en": ["test"]},
         "description": "TEST", "variable_links": [{"variable_id": "t_precip", "role": "core_indicator", "statement": "TEST",
                                                     "limits": "TEST", "ref_ids": ["t_ref"]}],
         "indicator_ids": [], "unanswerable_notes": ["TEST"]}]})
    write(cat / "manual_presets.json", {"version": "t-manual", "adjustments": []})
    write(cat / "manifest.json", {"manifest_version": "t-manifest", "catalogue_version": "t-catalogue",
                                  "dataset": {"export_version": "test-export"}, "asset_status": {}})
    shutil.copytree(BACKEND / "catalogue" / "policies", cat / "policies")
    return cat, data, cache


def deliver_events(cat: Path, *, with_files: bool = True) -> None:
    """Register a TEST event catalogue as ready (optionally without its files)."""
    write(cat / "events" / "index.json", {"version": "t-events", "catalogues": [
        {"catalogue_id": "t_events", "phenomenon_id": "t_phen", "status": "ready", "priority": 1,
         "events_file": "t_events/events.json", "coverage_file": "t_events/coverage.json"},
        {"catalogue_id": "t_pending", "phenomenon_id": "t_phen", "status": "pending", "missing": ["events_file"],
         "reason": "TEST slot"}]})
    if not with_files:
        return
    write(cat / "events" / "t_events" / "events.json", {"catalogue_id": "t_events", "version": "1", "events": [
        {"event_id": "t-e1", "phenomenon_id": "t_phen", "region_ids": ["reg-a"], "start": "2001-05", "end": "2001-06"},
        {"event_id": "t-e2", "phenomenon_id": "t_phen", "region_ids": ["reg-a", "reg-c"], "start": "2002", "end": None}]})
    write(cat / "events" / "t_events" / "coverage.json", {"catalogue_id": "t_events", "version": "1", "coverage": [
        {"catalogue_id": "t_events", "region_id": "reg-a", "phenomenon_id": "t_phen", "start": "2000-01", "end": "2003-12",
         "completeness": "complete"},
        {"catalogue_id": "t_events", "region_id": "reg-c", "phenomenon_id": "t_phen", "start": "2000-01", "end": "2001-12",
         "completeness": "partial"},
        {"catalogue_id": "t_events", "region_id": "reg-c", "phenomenon_id": "t_phen", "start": "2002-01", "end": "2003-12",
         "completeness": "complete"}]})
