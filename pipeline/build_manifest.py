#!/usr/bin/env python3
"""Write web/public/data/catalog/manifest.json (data release manifest, docs/earth-system-data-contracts.md §2).

  python3 -I pipeline/build_manifest.py <dataset_version>      e.g. data-2026-11-15
Validates every series file against the catalogue: layer known, start/values well formed, no NaN,
index consistent. Problems are listed per asset; a broken asset is `invalid`, not a crash.
"""
import datetime as dt, hashlib, json, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "web", "public", "data")
YM = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

# Assets that are known but not (yet) delivered in this release.
PENDING = [
    dict(asset="event_catalogues", status="pending",
         reason="尚無已核可的事件紀錄資料集（RecordedEvent）；查詢不得把缺資料當成零事件"),
    dict(asset="indicator_registry", status="pending", reason="尚無標準指標配方（SPI 等）"),
]
NOTES = [
    "ndvi：新管線重算（MOD13C2，2000-02 – 2026-10）與既有層 r 中位數 0.997；高緯度少數流域差異較大，"
    "推測舊管線另用了 pixel reliability（積雪／雲）篩選。既有層已到最新月份，維持舊值不替換。",
]
DROPPED = ["OMI OMTO3d（臭氧／UV 氣膠指數，2026-11-15 決定不做；臭氧改用 MERRA-2 TO3）"]


def sha(path, n=12):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:n]


def main(version):
    var = json.load(open(os.path.join(DATA, "catalog", "variables.json")))
    idx = json.load(open(os.path.join(DATA, "catalog", "series_index.json")))
    layers = var["layers"]
    problems = {}  # layer -> [msg]
    n_regions = {k: 0 for k in layers}
    sdir = os.path.join(DATA, "series"); files = sorted(os.listdir(sdir))
    for fn in files:
        rid = fn[:-5]; doc = json.load(open(os.path.join(sdir, fn)))
        if sorted(doc["layers"]) != idx["regions"].get(rid):
            problems.setdefault("series_index", []).append(f"{rid}: index differs from file")
        for k, v in doc["layers"].items():
            if k not in layers:
                problems.setdefault(k, []).append(f"{rid}: layer not in variables.json"); continue
            n_regions[k] += 1
            if not YM.match(v.get("start", "")) or not isinstance(v.get("values"), list) or not v["values"]:
                problems.setdefault(k, []).append(f"{rid}: bad start/values")
            elif any(x is not None and not isinstance(x, (int, float)) for x in v["values"]):
                problems.setdefault(k, []).append(f"{rid}: non-numeric value")
    status = []
    for k, m in sorted(layers.items()):
        p = problems.get(k, [])
        st = "invalid" if p else ("ready" if n_regions[k] else "invalid")
        status.append(dict(asset=f"layer:{k}", status=st, n_regions=n_regions[k], start=m.get("start"),
                           end=m.get("end"), source=m.get("source", "hub_export (2026-11-14)"),
                           processed=m.get("processed", "2026-11-14"), missing=p[:5] + (["…"] if len(p) > 5 else [])))
    if problems.get("series_index"):
        status.append(dict(asset="series_index", status="invalid", missing=problems["series_index"][:5]))
    mask = os.path.join(REPO, "data", "masks", "regions_0p5.npz")
    manifest = dict(
        dataset_version=version,
        generated=dt.date.today().isoformat(),
        catalogue_version=f"variables-{sha(os.path.join(DATA, 'catalog', 'variables.json'))}",
        region_catalogue_version=f"regions_0p5-{sha(mask)}",
        series_index="catalog/series_index.json",
        series_format="series-2（每層 start + values，月資料，缺值 null）",
        n_series_files=len(files),
        event_catalogues=dict(status="pending"),
        indicator_registry_version=None,
        baselines=dict(status="query_time",
                       rule="趨勢與季節循環只用基準期擬合；基準期 = 全期間扣除 [事件起 − pad, 事件迄 + pad]（SPEC §4 Step 2、INTEGRATION A）"),
        quality_policy_version="cover-0.30",
        quality_policy="0.5° 格網 cos(lat) 面積加權；區域內有效面積 < 30% 的月份為 null；null 不可當 0",
        asset_status=status + PENDING,
        notes=NOTES,
        dropped=DROPPED,
        reproduce="pipeline/README.md",
    )
    out = os.path.join(DATA, "catalog", "manifest.json")
    with open(out, "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    bad = [s for s in status if s["status"] != "ready"]
    print(f"{out}: {len(status)} assets, {len(bad)} not ready, {len(files)} series files")
    for s in bad:
        print("  ", s)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else f"data-{dt.date.today().isoformat()}"))
