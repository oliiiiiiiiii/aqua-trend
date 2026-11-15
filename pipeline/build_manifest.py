#!/usr/bin/env python3
"""Validate prepared series and write catalog/manifest.json; never download or repair data.

  python3 -I pipeline/build_manifest.py <dataset_version>
Invalid assets are reported separately. A ready asset is structurally valid, not a claim that
its scientific values have been independently reproduced; annual assets remain ineligible for
monthly analysis.
"""
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "web", "public", "data")
YM = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
REGION_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$", re.I)
PENDING = [
    dict(asset="layer:ndvi (MODIS MOD13C2 re-build / extension)", status="pending",
         reason="重建／延長尚未隨此快照交付；既有 ndvi 層仍可用"),
    dict(asset="event_catalogues", status="pending",
         reason="尚無已核可的事件紀錄資料集（RecordedEvent）；查詢不得把缺資料當成零事件"),
    dict(asset="indicator_registry", status="pending", reason="尚無標準指標配方（SPI 等）"),
]
DROPPED = ["OMI OMTO3d（臭氧／UV 氣膠指數，2026-11-15 決定不做；臭氧改用 MERRA-2 TO3）"]


def sha(path, n=12):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:n]


def reject_constant(value):
    raise ValueError(f"nonfinite JSON number: {value}")


def finite_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("nonfinite JSON number")
    return number


def main(version):
    problems = {}

    def problem(asset, message):
        problems.setdefault(asset, []).append(message)

    def read_json(path, asset):
        try:
            with open(path) as f:
                return json.load(f, parse_constant=reject_constant, parse_float=finite_float)
        except (OSError, ValueError) as exc:
            problem(asset, f"cannot read valid JSON: {exc}")
            return None

    def digest(path, asset):
        try:
            return sha(path)
        except OSError as exc:
            problem(asset, f"cannot hash asset: {exc}")
            return None

    vpath = os.path.join(DATA, "catalog", "variables.json")
    var = read_json(vpath, "variables")
    layers = var.get("layers") if isinstance(var, dict) else None
    if not isinstance(layers, dict) or not layers:
        problem("variables", "layers must be a nonempty object")
        layers = {}
    idx = read_json(os.path.join(DATA, "catalog", "series_index.json"), "series_index")
    indexed = idx.get("regions") if isinstance(idx, dict) else None
    if not isinstance(indexed, dict) or not indexed:
        problem("series_index", "regions must be a nonempty object")
        indexed = {}
    expected = {}
    for rid, entries in indexed.items():
        if not REGION_ID.fullmatch(rid) or not isinstance(entries, list) or not entries or \
                any(not isinstance(k, str) for k in entries) or len(set(entries)) != len(entries):
            problem("series_index", f"{rid}: invalid region/layer list")
            continue
        expected[rid] = entries
        for key in entries:
            if key not in layers:
                problem(f"layer:{key}", f"{rid}: indexed layer not in variables.json")

    sdir = os.path.join(DATA, "series")
    try:
        files = sorted(fn for fn in os.listdir(sdir) if fn.endswith(".json"))
    except OSError as exc:
        problem("series_index", f"cannot list series directory: {exc}")
        files = []
    n_regions = {k: 0 for k in layers}

    def invalid_region(rid, message):
        problem(f"series:{rid}", message)
        for key in expected.get(rid, []):
            problem(f"layer:{key}", f"{rid}: {message}")

    for rid in sorted(set(expected) - {fn[:-5] for fn in files}):
        invalid_region(rid, "referenced series file is missing")
    for fn in files:
        rid = fn[:-5]
        doc = read_json(os.path.join(sdir, fn), f"series:{rid}")
        if not isinstance(doc, dict) or not isinstance(doc.get("layers"), dict):
            invalid_region(rid, "series must contain a layers object")
            continue
        if doc.get("id") != rid or doc.get("version") != "series-2":
            invalid_region(rid, "id/version does not match a series-2 regional file")
        actual = doc["layers"]
        if rid not in expected or set(actual) != set(expected[rid]):
            problem("series_index", f"{rid}: index differs from file")
            for key in set(expected.get(rid, [])) - set(actual):
                problem(f"layer:{key}", f"{rid}: indexed layer missing from file")
        for key, series in actual.items():
            asset = f"layer:{key}"
            if key not in layers:
                problem(asset, f"{rid}: layer not in variables.json")
                continue
            n_regions[key] += 1
            start = series.get("start") if isinstance(series, dict) else None
            values = series.get("values") if isinstance(series, dict) else None
            if not isinstance(start, str) or not YM.fullmatch(start) or \
                    not isinstance(values, list) or not values:
                problem(asset, f"{rid}: bad start/values")
            elif any(x is not None and type(x) not in (int, float) for x in values):
                problem(asset, f"{rid}: values must be finite numbers or null; booleans are invalid")

    catalogue_hash = digest(vpath, "variables")
    mask_hash = digest(os.path.join(REPO, "data", "masks", "regions_0p5.npz"), "region_mask")
    status = []
    for key, raw_meta in sorted(layers.items()):
        asset = f"layer:{key}"
        meta = raw_meta if isinstance(raw_meta, dict) else {}
        if not isinstance(raw_meta, dict):
            problem(asset, "layer metadata must be an object")
        temporal = "annual" if key == "so2_emis" else meta.get("temporal_resolution", "monthly")
        if temporal not in ("monthly", "annual"):
            problem(asset, "unsupported temporal_resolution")
        if not n_regions[key]:
            problem(asset, "no regional series delivered")
        errors = problems.get(asset, [])
        valid = not errors
        point_product = key in ("fire_count", "so2_emis")
        status.append(dict(
            asset=asset, status="ready" if valid else "invalid", n_regions=n_regions[key],
            start=meta.get("start"), end=meta.get("end"), temporal_resolution=temporal,
            caveat=meta.get("caveat"), source=meta.get("source", "hub_export (2026-11-14)"),
            processed=meta.get("processed", "2026-11-14"), source_files=meta.get("source_files"),
            analysis_eligibility=dict(monthly=valid and temporal == "monthly",
                                      reason="invalid asset" if not valid else
                                      ("annual estimates; monthly positions are for display only" if temporal == "annual" else None)),
            quality_policy=dict(kind="point_product" if point_product else "gridded_area_mean",
                                method=meta.get("method"), missing_policy=meta.get("missing_policy"),
                                coverage_policy=meta.get("coverage_policy")),
            missing=errors[:5] + (["…"] if len(errors) > 5 else [])))
    known_assets = {item["asset"] for item in status}
    status += [dict(asset=asset, status="invalid", missing=errors[:5])
               for asset, errors in sorted(problems.items()) if asset not in known_assets]
    manifest = dict(
        dataset_version=version, generated=dt.date.today().isoformat(),
        catalogue_version=f"variables-{catalogue_hash}" if catalogue_hash else None,
        region_catalogue_version=f"regions_0p5-{mask_hash}" if mask_hash else None,
        series_index="catalog/series_index.json",
        series_format="series-2（每層 start + values 為月位置；實際時間解析度見 temporal_resolution，缺值 null）",
        n_series_files=len(files), event_catalogues=dict(status="pending"), indicator_registry_version=None,
        baselines=dict(status="query_time", scope="current MVP",
                       rule="趨勢與季節循環只用基準期擬合；基準期 = 全期間扣除 [事件起 − pad, 事件迄 + pad]（SPEC §4 Step 2、INTEGRATION A）"),
        quality_policy_version="layer-specific-1",
        quality_policy=dict(
            gridded_area_means="0.5° 格網 cos(lat) 面積加權；有效面積 < 30% 的月份為 null",
            point_products="火點計數與 SO₂ 點源排放不適用面積平均覆蓋門檻；限制見各層 caveat 與 quality_policy",
            missing="null 為未知，不可當 0；FIRMS 的 0 是記錄中無偵測，不證明無火災或完整觀測"),
        validation_scope="File/schema/index validation only; scientific values are not independently reproduced",
        asset_status=status + PENDING, dropped=DROPPED, reproduce="pipeline/README.md")
    out = os.path.join(DATA, "catalog", "manifest.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1, allow_nan=False)
    bad = [item for item in status if item["status"] == "invalid"]
    print(f"{out}: {len(status)} assets, {len(bad)} invalid, {len(files)} series files")
    for item in bad:
        print("  ", item)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else f"data-{dt.date.today().isoformat()}"))
