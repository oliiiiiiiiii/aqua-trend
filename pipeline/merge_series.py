#!/usr/bin/env python3
"""Merge data/interim/layers/<layer>.npz into the series-2 files the frontend reads.

Only the named layers are touched; every other layer in series/*.json stays byte-for-byte the same
value-wise (files are re-serialised compactly). Also updates catalog/series_index.json and the
layer's entry in catalog/variables.json (adds category_default_layer only for a brand-new category).

  python3 -I pipeline/merge_series.py aod ozone        # specific layers
  python3 -I pipeline/merge_series.py --all            # every npz in data/interim/layers
"""
import argparse, datetime as dt, glob, json, math, os, sys
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "web", "public", "data")
LAYER_DIR = os.path.join(REPO, "data", "interim", "layers")
META_KEYS = ("name", "category", "product", "nasa", "family", "unit", "start", "end", "visual", "caveat")
PROVENANCE_KEYS = ("source", "processed", "source_files", "method", "variable", "temporal_resolution",
                   "temporal", "missing_policy", "coverage_policy", "satellites", "period_note", "dedupe", "stats")


def sig(x, n=4):
    if not math.isfinite(x):
        return None
    if x == 0:
        return 0.0
    return round(x, max(0, n - 1 - int(math.floor(math.log10(abs(x))))))


def add_months(start, k):
    y, m = map(int, start.split("-")); t = y * 12 + m - 1 + k
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def load_layer(name):
    with np.load(os.path.join(LAYER_DIR, f"{name}.npz")) as z:
        return [str(x) for x in z["ids"]], str(z["start"]), z["series"], json.loads(str(z["meta"]))


def main(names, only_existing=False):
    vpath = os.path.join(DATA, "catalog", "variables.json"); ipath = os.path.join(DATA, "catalog", "series_index.json")
    with open(vpath) as f:
        var = json.load(f)
    with open(ipath) as f:
        idx = json.load(f)
    per_region = {}  # rid -> {layer: {start, values} or None}
    for name in names:
        ids, start, S, meta = load_layer(name)
        finite = np.isfinite(S)
        cols = np.where(finite.any(0))[0]
        g_start = add_months(start, int(cols[0])) if cols.size else start
        g_end = add_months(start, int(cols[-1])) if cols.size else start
        n_reg = 0
        for r, rid in enumerate(ids):
            if rid.startswith("hex-"):
                continue
            if only_existing and name not in idx["regions"].get(rid, []):
                continue  # extending an existing layer: keep its original region set / QC
            row = np.where(finite[r])[0]
            if row.size == 0:
                per_region.setdefault(rid, {})[name] = None
                continue
            a, b = row[0], row[-1]
            per_region.setdefault(rid, {})[name] = {"start": add_months(start, int(a)),
                                                    "values": [sig(float(v)) for v in S[r, a:b + 1]]}
            n_reg += 1
        entry = {k: meta.get(k) for k in META_KEYS if k in meta}
        entry.update(start=g_start, end=g_end)
        for k in PROVENANCE_KEYS:
            if k in meta:
                entry[k] = meta[k]
        var["layers"][name] = entry
        cat = meta.get("category")
        if cat and cat not in var["category_default_layer"]:
            var["category_default_layer"][cat] = name
        print(f"{name}: {n_reg} regions with data, {g_start}..{g_end}, unit={meta.get('unit')}")

    changed = created = 0
    for rid, layers in per_region.items():
        path = os.path.join(DATA, "series", f"{rid}.json")
        if os.path.exists(path):
            with open(path) as f:
                doc = json.load(f)
        elif any(v is not None for v in layers.values()):
            doc = {"id": rid, "version": "series-2", "layers": {}}; created += 1
        else:
            continue
        for name, v in layers.items():
            if v is None:
                doc["layers"].pop(name, None)
            else:
                doc["layers"][name] = v
        with open(path, "w") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        idx["regions"][rid] = sorted(doc["layers"].keys()); changed += 1
    with open(ipath, "w") as f:
        json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
    var["generated"] = dt.date.today().isoformat()
    with open(vpath, "w") as f:
        json.dump(var, f, ensure_ascii=False, indent=1)
    print(f"series files written: {changed} (new: {created})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("layers", nargs="*"); ap.add_argument("--all", action="store_true")
    ap.add_argument("--only-existing", action="store_true",
                    help="update only regions that already have the layer (re-builds / extensions)")
    a = ap.parse_args()
    names = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(LAYER_DIR, "*.npz"))) if a.all else a.layers
    if not names:
        sys.exit("no layers given")
    main(names, a.only_existing)
