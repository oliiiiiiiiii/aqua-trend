#!/usr/bin/env python3
"""Validate the SPEC §5 preset events against series-2 data (workstream E).

Re-implements the decomposition rules of workstream A (docs/INTEGRATION.md):
  * baseline = full record minus [event.start - pad, event.end + pad]
  * linear trend (OLS) and 12-month climatology fitted on baseline months only
  * a calendar year with > 3 missing months does not enter the climatology
  * sigma = sample std (ddof=1) of baseline residuals
  * null stays null, never 0

Usage (from the repo root):
  python3 -I tools/validate_presets.py [--data web/public/data] [--pad 12] [--markdown]
  python3 -I tools/validate_presets.py --region b4-... --start 2021-02 --end 2021-05 --layers p_imerg,sm_root

Only reads JSON; needs numpy.
"""
import argparse
import json
import os
import sys

import numpy as np

# Preset events to validate. Keep in sync with web/lib/detective/presets.ts.
EVENTS = [
    {
        "id": "taiwan-2021-drought",
        "region": "b4-4040046370",
        "start": "2021-04", "end": "2021-05",
        "expected": {"precip": "low", "soil": "low", "tws": "low", "ndvi": "low"},
    },
    {
        "id": "pakistan-2022-flood",
        "region": "b4-4040879050",
        "start": "2022-07", "end": "2022-09",
        "expected": {"precip": "high", "runoff": "high", "soil": "high", "tws": "high"},
    },
    {
        "id": "australia-2019-fire",
        "region": "b4-5040070710",
        "start": "2019-09", "end": "2020-01",
        "expected": {"precip": "low", "soil": "low", "tair": "high", "ndvi": "low"},
    },
]

# Extra layers reported alongside the default layer of each category (same-category alternatives).
ALT_LAYERS = {
    "precip": ["p_gpcp", "p_m2"],
    "soil": ["sm_total", "g1_soil_top", "sm_m2"],
    "runoff": ["ro_m2"],
    "tair": ["tsurf_m2"],
}


def ym_to_idx(ym):
    y, m = ym.split("-")
    return int(y) * 12 + int(m) - 1


def idx_to_ym(i):
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def decompose(start, values, ev_start, ev_end, pad):
    """Return dict with residual, z, sigma, baseline info. values: list with None."""
    i0 = ym_to_idx(start)
    n = len(values)
    t = np.arange(n, dtype=float)
    idx = i0 + np.arange(n)
    x = np.array([np.nan if v is None else float(v) for v in values])
    valid = ~np.isnan(x)

    ex_lo = ym_to_idx(ev_start) - pad
    ex_hi = ym_to_idx(ev_end) + pad
    in_excl = (idx >= ex_lo) & (idx <= ex_hi)
    base = valid & ~in_excl

    cal_month = idx % 12
    year = idx // 12

    # Years eligible for climatology: <= 3 missing months among the year's non-excluded
    # months. Months of the calendar year outside the record also count as missing.
    eligible_year = {}
    for y in np.unique(year):
        months_in_record = (year == y)
        n_record = int(months_in_record.sum())
        n_out_of_record = 12 - n_record
        n_null = int((months_in_record & ~valid & ~in_excl).sum())
        eligible_year[int(y)] = (n_null + n_out_of_record) <= 3
    clim_mask = base & np.array([eligible_year[int(y)] for y in year])

    seasonal_m = np.zeros(12)
    slope = intercept = 0.0
    for _ in range(20):
        # OLS trend on deseasonalised baseline values
        xs = x[base] - seasonal_m[cal_month[base]]
        A = np.vstack([np.ones(base.sum()), t[base]]).T
        coef, *_ = np.linalg.lstsq(A, xs, rcond=None)
        intercept_new, slope_new = coef
        # Climatology on detrended baseline values of eligible years
        detr = x - (intercept_new + slope_new * t)
        new_seas = np.array([
            np.mean(detr[clim_mask & (cal_month == m)]) if np.any(clim_mask & (cal_month == m)) else 0.0
            for m in range(12)
        ])
        new_seas -= new_seas.mean()
        converged = abs(slope_new - slope) < 1e-12 and np.allclose(new_seas, seasonal_m, atol=1e-12)
        slope, intercept, seasonal_m = slope_new, intercept_new, new_seas
        if converged:
            break

    trend = intercept + slope * t
    seasonal = seasonal_m[cal_month]
    resid = x - trend - seasonal  # NaN where x is null
    sigma = float(np.std(resid[base], ddof=1))
    z = resid / sigma

    ev = (idx >= ym_to_idx(ev_start)) & (idx <= ym_to_idx(ev_end))
    ev_valid = ev & valid
    out = {
        "n_baseline": int(base.sum()),
        "n_clim_years": int(sum(1 for y, ok in eligible_year.items() if ok)),
        "sigma": sigma,
        "slope_per_decade": float(slope * 120),
        "n_event": int(ev_valid.sum()),
        "n_event_total": int(ev.sum()),
        "mean_resid": float(np.mean(resid[ev_valid])) if ev_valid.any() else None,
        "mean_z": float(np.mean(z[ev_valid])) if ev_valid.any() else None,
        "event_z": [None if np.isnan(v) else round(float(v), 2) for v in z[ev]],
    }

    # Rank among all same-length sliding windows (all months valid)
    L = int(ev.sum())
    if ev_valid.any() and L > 0:
        means = []
        for s in range(0, n - L + 1):
            w = resid[s:s + L]
            if not np.isnan(w).any():
                means.append(float(w.mean()))
        if out["mean_resid"] is not None and means:
            mr = out["mean_resid"]
            if mr < 0:
                pos = 1 + sum(1 for m in means if m < mr - 1e-12)
                out["rank"] = (pos, len(means), "low")
            else:
                pos = 1 + sum(1 for m in means if m > mr + 1e-12)
                out["rank"] = (pos, len(means), "high")
    return out


def load(data_dir, region):
    with open(os.path.join(data_dir, "series", f"{region}.json"), encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join("web", "public", "data"))
    ap.add_argument("--pad", type=int, default=12)
    ap.add_argument("--markdown", action="store_true")
    ap.add_argument("--json", help="also write per-layer results to this JSON file (for cross-checks)")
    ap.add_argument("--region")
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--layers")
    a = ap.parse_args()

    with open(os.path.join(a.data, "catalog", "variables.json"), encoding="utf-8") as f:
        catalog = json.load(f)
    default_layer = catalog["category_default_layer"]
    layers_meta = catalog["layers"]

    if a.region:
        events = [{"id": "adhoc", "region": a.region, "start": a.start, "end": a.end, "expected": {},
                   "layers": a.layers.split(",") if a.layers else None}]
    else:
        events = EVENTS

    all_ok = True
    json_rows = []
    for ev in events:
        doc = load(a.data, ev["region"])
        rows = []
        if ev.get("layers"):
            todo = [(layers_meta[l]["category"], l, False) for l in ev["layers"]]
        else:
            todo = []
            for cat in ev["expected"]:
                todo.append((cat, default_layer[cat], True))
                for alt in ALT_LAYERS.get(cat, []):
                    todo.append((cat, alt, False))
        passed = False
        for cat, layer, is_default in todo:
            if layer not in doc["layers"]:
                rows.append((cat, layer, is_default, None))
                continue
            s = doc["layers"][layer]
            r = decompose(s["start"], s["values"], ev["start"], ev["end"], a.pad)
            exp = ev["expected"].get(cat)
            ok = None
            if exp and r["mean_z"] is not None:
                ok = (r["mean_z"] <= -2) if exp == "low" else (r["mean_z"] >= 2)
                if ok and is_default:
                    passed = True
            r["expected"] = exp
            r["ok"] = ok
            rows.append((cat, layer, is_default, r))
            json_rows.append({"event": ev["id"], "layer": layer, "meanResidual": r["mean_resid"],
                              "meanZ": r["mean_z"], "rank": r.get("rank"), "n": r["n_event"]})
        if ev["expected"]:
            all_ok &= passed

        title = f"{ev['id']}  {ev['region']}  {ev['start']}..{ev['end']}  pad={a.pad}"
        if a.markdown:
            print(f"\n#### {title}\n")
            print("| 類別 | 資料層 | 預期 | n | 平均殘差 | 平均 z | 名次 | |z|≥2 且方向對 |")
            print("| --- | --- | --- | --- | --- | --- | --- | --- |")
        else:
            print(f"\n== {title}")
        for cat, layer, is_default, r in rows:
            name = layer + ("" if is_default else " (alt)")
            unit = layers_meta.get(layer, {}).get("unit", "")
            if r is None:
                line = (cat, name, "-", "-", "no data", "-", "-", "-")
            else:
                rk = r.get("rank")
                rk_s = f"{rk[0]}/{rk[1]} {'低' if rk[2] == 'low' else '高'}" if rk else "-"
                mr = "-" if r["mean_resid"] is None else f"{r['mean_resid']:+.3g} {unit}"
                mz = "-" if r["mean_z"] is None else f"{r['mean_z']:+.2f}"
                ok = {True: "是", False: "否", None: "-"}[r["ok"]]
                line = (cat, name, r["expected"] or "-", f"{r['n_event']}/{r['n_event_total']}", mr, mz, rk_s, ok)
            if a.markdown:
                print("| " + " | ".join(line) + " |")
            else:
                print("  " + "  ".join(f"{c:<14}" for c in line), "" if r is None else r["event_z"])
        if ev["expected"]:
            print(("" if a.markdown else "  ") + f"PASS (default layer): {'yes' if passed else 'NO'}")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(json_rows, f)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
