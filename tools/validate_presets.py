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
import math
import os
import sys

import numpy as np

# Preset events to validate. Keep in sync with web/lib/detective/presets.ts.
EVENTS = [
    {
        "id": "taiwan-2021-drought",
        "region": "b4-4040046370",
        "start": "2021-02", "end": "2021-05",
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
    valid = np.isfinite(x)
    x[~valid] = np.nan

    ex_lo = ym_to_idx(ev_start) - pad
    ex_hi = ym_to_idx(ev_end) + pad
    in_excl = (idx >= ex_lo) & (idx <= ex_hi)
    base = valid & ~in_excl

    cal_month = idx % 12
    year = idx // 12

    # A checks original coverage before event exclusion; absent months are missing.
    eligible_year = {int(y): int((valid & (year == y)).sum()) >= 9 for y in np.unique(year)}
    clim_mask = base & np.array([eligible_year[int(y)] for y in year])
    if base.sum() < 14 or any(not np.any(clim_mask & (cal_month == m)) for m in range(12)):
        raise ValueError("Insufficient baseline: need 14 observations and all 12 eligible calendar months.")

    # Joint OLS of time and month effects, using eligible baseline years only.
    month_t = np.array([t[clim_mask & (cal_month == m)].mean() for m in range(12)])
    month_x = np.array([x[clim_mask & (cal_month == m)].mean() for m in range(12)])
    centered_t = t[clim_mask] - month_t[cal_month[clim_mask]]
    denominator = np.dot(centered_t, centered_t)
    if denominator <= 0:
        raise ValueError("Insufficient baseline: seasonal trend is unidentified.")
    joint_slope = np.dot(centered_t, x[clim_mask] - month_x[cal_month[clim_mask]]) / denominator
    month_intercepts = month_x - joint_slope * month_t
    seasonal_m = month_intercepts - month_intercepts.mean()

    # Hold the seasonal cycle fixed while every observed baseline month informs OLS.
    base_t = t[base]
    base_x = x[base] - seasonal_m[cal_month[base]]
    centered_base_t = base_t - base_t.mean()
    slope = np.dot(centered_base_t, base_x - base_x.mean()) / np.dot(centered_base_t, centered_base_t)
    intercept = base_x.mean() - slope * base_t.mean()

    trend = intercept + slope * t
    seasonal = seasonal_m[cal_month]
    resid = x - trend - seasonal  # NaN where x is null
    sigma = float(np.std(resid[base], ddof=1))
    if sigma <= np.finfo(float).eps * np.max(np.abs(x[base])) * 32:
        sigma = 0.0
    z = resid / sigma if sigma > 0 else np.full(n, np.nan)

    ev = (idx >= ym_to_idx(ev_start)) & (idx <= ym_to_idx(ev_end))
    ev_valid = ev & valid
    out = {
        "n_baseline": int(base.sum()),
        "n_clim_years": int(sum(1 for y, ok in eligible_year.items() if ok)),
        "sigma": sigma,
        "slope_per_decade": float(slope * 120),
        "n_event": int(ev_valid.sum()),
        "n_event_total": ym_to_idx(ev_end) - ym_to_idx(ev_start) + 1,
        "mean_resid": math.fsum(resid[ev_valid] / ev_valid.sum()) if ev_valid.any() else None,
        "mean_z": math.fsum(z[ev & np.isfinite(z)] / np.isfinite(z[ev]).sum()) if np.isfinite(z[ev]).any() else None,
        "event_z": [None if np.isnan(v) else round(float(v), 2) for v in z[ev]],
    }

    # Rank among all same-length sliding windows (all months valid)
    L = out["n_event_total"]
    if int(ev_valid.sum()) == L and L > 0:
        summaries = []
        for s in range(0, n - L + 1):
            w = resid[s:s + L]
            if np.isfinite(w).all():
                summaries.append((math.fsum(w / L), float(np.abs(w / L).sum())))
        if out["mean_resid"] is not None and summaries:
            mr = out["mean_resid"]
            selected_magnitude = float(np.abs(resid[ev_valid] / L).sum())
            def beyond(candidate, magnitude):
                tolerance = 32 * np.finfo(float).eps * max(magnitude, selected_magnitude)
                return candidate < mr - tolerance if mr < 0 else candidate > mr + tolerance

            pos = 1 + sum(1 for candidate, magnitude in summaries if beyond(candidate, magnitude))
            if mr < 0:
                out["rank"] = (pos, len(summaries), "low")
            else:
                out["rank"] = (pos, len(summaries), "high")
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
            print("| 類別 | 資料層 | 預期 | n | 平均殘差 | 平均 z | 名次 | 通過 |")
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
