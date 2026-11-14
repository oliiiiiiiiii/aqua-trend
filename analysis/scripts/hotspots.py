"""hotspots - find, measure and name connected regions of significant trend."""
from __future__ import annotations

import numpy as np
import pandas as pd

_COUNTRY_CACHE = {}


def country_grid(lon, lat):
    """Integer country index grid + names using regionmask Natural Earth 110m countries."""
    key = (len(lon), len(lat), float(lon[0]), float(lat[0]))
    if key in _COUNTRY_CACHE:
        return _COUNTRY_CACHE[key]
    import regionmask
    reg = regionmask.defined_regions.natural_earth_v5_0_0.countries_110
    m = reg.mask(np.asarray(lon), np.asarray(lat))
    names = dict(zip(reg.numbers, reg.names))
    _COUNTRY_CACHE[key] = (np.asarray(m.values), names)
    return _COUNTRY_CACHE[key]


def cell_area_km2(lon, lat):
    dlon = abs(float(np.median(np.diff(lon))))
    dlat = abs(float(np.median(np.diff(lat))))
    a = (111.195 ** 2) * dlon * dlat * np.cos(np.deg2rad(lat))
    return np.repeat(a[:, None], len(lon), axis=1)


def find_hotspots(lon, lat, trend, sig, min_cells=4, thr=None, top=15, extra=None, label_countries=True):
    """Connected clusters of significant pixels with same sign.

    trend, sig: (lat, lon).  thr: minimum |trend| to include (default: 25th pct of |sig trend|).
    extra: dict name -> (lat, lon) array of additional fields to average per hotspot.
    Returns DataFrame sorted by |integrated trend| (= mean trend x area).
    """
    from skimage.measure import label
    lon = np.asarray(lon); lat = np.asarray(lat)
    trend = np.asarray(trend, float)
    sig = np.asarray(sig, bool) & np.isfinite(trend)
    if thr is None:
        vals = np.abs(trend[sig])
        thr = np.percentile(vals, 25) if vals.size else 0
    area = cell_area_km2(lon, lat)
    cg, names = country_grid(lon, lat) if label_countries else (None, None)
    rows = []
    for sgn in (-1, 1):
        mask = sig & (sgn * trend > thr)
        lab = label(mask, connectivity=2)
        # wrap-around in longitude: merge labels touching both edges
        for a, b in zip(lab[:, 0], lab[:, -1]):
            if a and b and a != b:
                lab[lab == b] = a
        for k in np.unique(lab):
            if k == 0:
                continue
            sel = lab == k
            n = int(sel.sum())
            if n < min_cells:
                continue
            w = area[sel]
            mtr = float(np.sum(trend[sel] * w) / np.sum(w))
            iy, ix = np.where(sel)
            j = np.argmax(np.abs(trend[sel]))
            row = dict(sign="decrease" if sgn < 0 else "increase", n_cells=n, area_km2=float(w.sum()),
                       mean_trend=mtr, peak_trend=float(trend[sel][j]),
                       peak_lon=float(lon[ix[j]]), peak_lat=float(lat[iy[j]]),
                       centroid_lon=float(np.average(lon[ix], weights=w)),
                       centroid_lat=float(np.average(lat[iy], weights=w)),
                       lon_min=float(lon[ix].min()), lon_max=float(lon[ix].max()),
                       lat_min=float(lat[iy].min()), lat_max=float(lat[iy].max()),
                       integrated=float(mtr * w.sum()))
            if extra:
                for nm, f in extra.items():
                    f = np.asarray(f, float)
                    ok = sel & np.isfinite(f)
                    row[nm] = float(np.sum(f[ok] * area[ok]) / np.sum(area[ok])) if ok.any() else np.nan
            if cg is not None:
                cc = cg[sel]
                cc = cc[np.isfinite(cc)].astype(int)
                if cc.size:
                    u, c = np.unique(cc, return_counts=True)
                    order = np.argsort(-c)
                    row["countries"] = ", ".join(f"{names[u[i]]}" for i in order[:4])
                else:
                    row["countries"] = "ocean / none"
            rows.append(row)
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["abs_integrated"] = df["integrated"].abs()
    df = df.sort_values("abs_integrated", ascending=False).drop(columns="abs_integrated").reset_index(drop=True)
    return df.head(top) if top else df
