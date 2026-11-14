"""trendlib - trend detection utilities for the Earth System Trend Detective analysis.

Conventions
-----------
* Time axis is always axis 0.  Grids are (time, lat, lon) or flattened (time, npix).
* Monthly data are deseasonalised by subtracting the per-calendar-month climatology.
* Trend significance:
    - OLS slope with AR(1)-adjusted effective sample size (Santer et al. 2008)
    - Mann-Kendall (Hamed-Rao modified for series; plain MK on annual means for grids)
    - Sen's slope
    - Pettitt change-point test (step change vs steady trend)
    - Field significance: Benjamini-Hochberg FDR (Wilks 2016, alpha_FDR = 0.10)
* Every vectorised routine takes ``xp`` (numpy or cupy) so heavy grids can run on GPU.
"""
from __future__ import annotations
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))

import json
import math
import os
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats

# ----------------------------------------------------------------------------
# backend helpers
# ----------------------------------------------------------------------------

def get_xp(use_gpu: bool = False):
    """Return cupy if requested and available, else numpy."""
    if use_gpu:
        try:
            import cupy as cp  # noqa: F401
            cp.get_default_memory_pool().set_limit(size=int(os.environ.get("TL_GPU_MEM_GB", "6")) * 1024 ** 3)
            cp.zeros(1)
            return cp
        except Exception as exc:  # pragma: no cover
            print(f"[trendlib] GPU unavailable ({exc}); falling back to numpy")
    return np


def to_np(a):
    try:
        import cupy as cp
        if isinstance(a, cp.ndarray):
            return cp.asnumpy(a)
    except Exception:
        pass
    return np.asarray(a)


def decimal_year(times) -> np.ndarray:
    t = pd.DatetimeIndex(times)
    start = pd.to_datetime(t.year.astype(str) + "-01-01")
    end = pd.to_datetime((t.year + 1).astype(str) + "-01-01")
    return (t.year + (t - start) / (end - start)).to_numpy(dtype=float)


# ----------------------------------------------------------------------------
# preprocessing
# ----------------------------------------------------------------------------

def deseason(y, months, base_mask=None, xp=np):
    """Subtract per-calendar-month mean. y: (nt, ...), months: (nt,) ints 1..12.
    Returns (anomalies, climatology[12, ...])."""
    y = xp.asarray(y, dtype=xp.float64)
    months = np.asarray(months)
    clim = xp.full((12,) + y.shape[1:], xp.nan)
    anom = xp.empty_like(y)
    for m in range(1, 13):
        sel = months == m
        if base_mask is not None:
            selb = sel & np.asarray(base_mask)
        else:
            selb = sel
        if selb.sum() == 0:
            continue
        c = xp.nanmean(y[np.where(selb)[0]], axis=0)
        clim[m - 1] = c
        anom[np.where(sel)[0]] = y[np.where(sel)[0]] - c
    return anom, clim


def annual_means(y, years, min_count=10, xp=np):
    """Calendar-year means along axis 0, NaN where fewer than min_count valid steps."""
    y = xp.asarray(y, dtype=xp.float64)
    years = np.asarray(years)
    uy = np.unique(years)
    out = xp.full((len(uy),) + y.shape[1:], xp.nan)
    for i, yr in enumerate(uy):
        idx = np.where(years == yr)[0]
        blk = y[idx]
        cnt = (~xp.isnan(blk)).sum(0)
        m = xp.nanmean(blk, axis=0) if len(idx) else xp.nan
        out[i] = xp.where(cnt >= min_count, m, xp.nan)
    return out, uy


# ----------------------------------------------------------------------------
# vectorised grid statistics (axis 0 = time)
# ----------------------------------------------------------------------------

def ols_ar1(y, t, alpha=0.05, min_frac=0.7, xp=np):
    """OLS trend per column with AR(1)-corrected effective sample size.

    Returns dict of numpy arrays shaped like y.shape[1:]:
      slope (units per unit t), se, p, ci (half width), r1, n, neff, valid
    """
    y = xp.asarray(y, dtype=xp.float64)
    nt = y.shape[0]
    shp = y.shape[1:]
    Y = y.reshape(nt, -1)
    T = xp.asarray(np.asarray(t, dtype=float))[:, None]
    w = ~xp.isnan(Y)
    n = w.sum(0)
    nn = xp.maximum(n, 1)
    tbar = xp.where(w, T, 0.0).sum(0) / nn
    ybar = xp.where(w, Y, 0.0).sum(0) / nn
    dt = xp.where(w, T - tbar, 0.0)
    dy = xp.where(w, Y - ybar, 0.0)
    Stt = (dt * dt).sum(0)
    Sty = (dt * dy).sum(0)
    with np.errstate(all="ignore"):
        slope = Sty / xp.where(Stt > 0, Stt, xp.nan)
        res = xp.where(w, dy - slope * dt, 0.0)
        pair = w[1:] & w[:-1]
        num = (res[1:] * res[:-1] * pair).sum(0)
        den = (res * res).sum(0)
        r1 = num / xp.where(den > 0, den, xp.nan)
        r1c = xp.clip(xp.nan_to_num(r1, nan=0.0), 0.0, 0.95)
        neff = n * (1 - r1c) / (1 + r1c)
        dof = neff - 2.0
        se = xp.sqrt(den / xp.where(dof > 0, dof, xp.nan)) / xp.sqrt(xp.where(Stt > 0, Stt, xp.nan))
        tstat = slope / se
    slope, se, tstat, dof, r1, n, neff = map(to_np, (slope, se, tstat, dof, r1, n, neff))
    with np.errstate(all="ignore"):
        p = 2 * stats.t.sf(np.abs(tstat), np.where(dof > 1, dof, np.nan))
        ci = stats.t.ppf(1 - alpha / 2, np.where(dof > 1, dof, np.nan)) * se
    valid = (n >= min_frac * nt) & (dof > 2) & np.isfinite(slope)
    out = dict(slope=slope, se=se, p=p, ci=ci, r1=r1, n=n, neff=neff, valid=valid)
    for k in out:
        out[k] = np.asarray(out[k]).reshape(shp)
    for k in ("slope", "se", "p", "ci"):
        out[k] = np.where(out["valid"], out[k], np.nan)
    return out


def mk_grid(y, xp=np, chunk=2_000_000):
    """Plain Mann-Kendall test per column (NaN-aware, normal approximation,
    continuity correction, no tie correction).  Returns dict(S, z, p, n)."""
    y = xp.asarray(y, dtype=xp.float32)
    nt = y.shape[0]
    shp = y.shape[1:]
    Y = y.reshape(nt, -1)
    npix = Y.shape[1]
    S_all = np.empty(npix, dtype=np.float64)
    n_all = np.empty(npix, dtype=np.float64)
    for a in range(0, npix, chunk):
        b = min(npix, a + chunk)
        Yc = Y[:, a:b]
        w = ~xp.isnan(Yc)
        S = xp.zeros(b - a, dtype=xp.float64)
        for k in range(1, nt):
            d = Yc[k:] - Yc[:-k]
            v = w[k:] & w[:-k]
            S += xp.where(v, xp.sign(d), 0).sum(0)
        S_all[a:b] = to_np(S)
        n_all[a:b] = to_np(w.sum(0))
    with np.errstate(all="ignore"):
        varS = n_all * (n_all - 1) * (2 * n_all + 5) / 18.0
        z = np.where(S_all > 0, (S_all - 1) / np.sqrt(varS), np.where(S_all < 0, (S_all + 1) / np.sqrt(varS), 0.0))
        p = 2 * stats.norm.sf(np.abs(z))
    p = np.where(n_all >= 8, p, np.nan)
    return dict(S=S_all.reshape(shp), z=z.reshape(shp), p=p.reshape(shp), n=n_all.reshape(shp))


def sen_grid(y, t, xp=np, chunk=300_000):
    """Theil-Sen slope per column (median of pairwise slopes), NaN-aware."""
    y = xp.asarray(y, dtype=xp.float32)
    t = np.asarray(t, dtype=float)
    nt = y.shape[0]
    shp = y.shape[1:]
    Y = y.reshape(nt, -1)
    npix = Y.shape[1]
    ii, jj = np.triu_indices(nt, k=1)
    dtt = xp.asarray((t[jj] - t[ii]).astype(np.float32))[:, None]
    out = np.empty(npix, dtype=np.float64)
    for a in range(0, npix, chunk):
        b = min(npix, a + chunk)
        Yc = Y[:, a:b]
        sl = (Yc[jj] - Yc[ii]) / dtt
        out[a:b] = to_np(xp.nanmedian(sl, axis=0))
    return out.reshape(shp)


def fdr_mask(p, q=0.10):
    """Benjamini-Hochberg: boolean mask of discoveries at FDR level q (NaN -> False).
    Wilks (2016) recommends q = 2*alpha_global for spatially correlated fields."""
    p = np.asarray(p, dtype=float)
    flat = p.ravel()
    ok = np.isfinite(flat)
    pv = flat[ok]
    m = pv.size
    mask = np.zeros_like(flat, dtype=bool)
    if m == 0:
        return mask.reshape(p.shape)
    order = np.argsort(pv)
    thresh = q * (np.arange(1, m + 1) / m)
    passed = pv[order] <= thresh
    if passed.any():
        kmax = np.max(np.where(passed)[0])
        pcrit = pv[order][kmax]
        sub = pv <= pcrit
        idx = np.where(ok)[0][sub]
        mask[idx] = True
    return mask.reshape(p.shape)


def _grid_block(y, times, t, xp, annual_min, per):
    anom, clim = deseason(y, times.month.values, xp=xp)
    ols = ols_ar1(anom, t, xp=xp)
    del anom
    ann, yrs = annual_means(y, times.year.values, min_count=annual_min, xp=xp)
    ann_np = to_np(ann)
    mk = mk_grid(ann, xp=xp)
    sen = sen_grid(ann, yrs.astype(float), xp=xp)
    mean = np.nanmean(to_np(clim), axis=0)
    tt = yrs.astype(float)
    with np.errstate(all="ignore"):
        resid = ann_np - (sen[None] * (tt - tt.mean())[:, None, None] + np.nanmean(ann_np, axis=0)[None])
        iav = np.nanstd(resid, axis=0, ddof=1)
        pct = 100.0 * per * ols["slope"] / np.where(np.abs(mean) > 0, np.abs(mean), np.nan)
    if xp is not np:
        try:
            xp.get_default_memory_pool().free_all_blocks()
        except Exception:
            pass
    return dict(slope_dec=ols["slope"] * per, ci_dec=ols["ci"] * per, p_ols=ols["p"], r1=ols["r1"],
                sen_dec=sen * per, p_mk=mk["p"], mean=mean, pct_dec=pct, iav=iav), yrs


def grid_trends(y, times, use_gpu=False, annual_min=10, q=0.10, per=10.0, max_cells=150_000):
    """Full grid pipeline. y: (nt, ny, nx) monthly values (numpy or memmap).  Processed in latitude
    bands of <= max_cells pixels to bound memory; FDR applied once over the whole field.
    Returns dict with slope_dec (OLS on monthly anomalies, units/decade), ci_dec, p_ols, sig_ols_fdr,
    sen_dec (Sen on annual means), p_mk (MK on annual means), sig_mk_fdr, sig_both, mean, pct_dec, iav."""
    xp = get_xp(use_gpu)
    times = pd.DatetimeIndex(times)
    t = decimal_year(times)
    nt, ny, nx = y.shape
    if xp is not np:  # keep GPU working set (~12 float64 (nt, cells) arrays) under the pool limit
        budget = int(os.environ.get("TL_GPU_MEM_GB", "6")) * 1024 ** 3
        max_cells = min(max_cells, max(nx, budget // (nt * 8 * 12)))
    rows = max(1, max_cells // nx)
    parts = []
    yrs = None
    for r0 in range(0, ny, rows):
        blk = np.asarray(y[:, r0:r0 + rows, :], dtype=np.float32)
        res, yrs = _grid_block(blk, times, t, xp, annual_min, per)
        parts.append(res)
    out = {k: np.concatenate([p[k] for p in parts], axis=0) for k in parts[0]}
    out["sig_ols_fdr"] = fdr_mask(out["p_ols"], q=q)
    out["sig_mk_fdr"] = fdr_mask(out["p_mk"], q=q)
    out["sig_both"] = out["sig_ols_fdr"] & out["sig_mk_fdr"] & (np.sign(out["slope_dec"]) == np.sign(out["sen_dec"]))
    out["years"] = yrs
    return out


# ----------------------------------------------------------------------------
# correlation between fields (water vs everything else)
# ----------------------------------------------------------------------------

def _prep_anom(a, months, detrend, t, xp):
    a = xp.asarray(a, dtype=xp.float64)
    if a.ndim == 1:
        a = a[:, None]
    a = a.reshape(a.shape[0], -1)
    if months is not None:
        a, _ = deseason(a, months, xp=xp)
    if detrend:
        r = ols_ar1(a, t, min_frac=0.0, xp=xp)
        sl = xp.asarray(np.nan_to_num(r["slope"]))
        tc = xp.asarray(t - t.mean())[:, None]
        a = a - sl[None, :] * tc
    return a


def _lag1(a, xp):
    w = ~xp.isnan(a)
    m = xp.where(w, a, 0).sum(0) / xp.maximum(w.sum(0), 1)
    d = xp.where(w, a - m, 0.0)
    num = (d[1:] * d[:-1]).sum(0)
    den = (d * d).sum(0)
    return num / xp.where(den > 0, den, xp.nan)


def grid_corr(x, y, times, lag=0, deseasonalize=True, detrend=True, method="pearson", use_gpu=False, q=0.10,
              min_n=24):
    """Correlation per pixel between x (nt, ...) and y (nt, ...) or a series y (nt,).
    lag > 0: x leads y by `lag` steps (corr(x_t, y_{t+lag})).
    Significance uses the Bretherton et al. (1999) effective sample size
    n_eff = n (1 - r1x r1y) / (1 + r1x r1y); FDR (BH, q) over all pixels.
    Returns dict(r, p, n, neff, sig) shaped like x.shape[1:]."""
    xp = get_xp(use_gpu)
    times = pd.DatetimeIndex(times)
    t = decimal_year(times)
    months = times.month.values if deseasonalize else None
    shp = np.shape(x)[1:]
    X = _prep_anom(x, months, detrend, t, xp)
    Y = _prep_anom(y, months, detrend, t, xp)
    if lag > 0:
        X, Y = X[:-lag], Y[lag:]
    elif lag < 0:
        X, Y = X[-lag:], Y[:lag]
    if Y.shape[1] == 1 and X.shape[1] > 1:
        Y = xp.broadcast_to(Y, X.shape)
    if method == "spearman":
        def rank(a):
            nanm = xp.isnan(a)
            r = xp.argsort(xp.argsort(xp.where(nanm, xp.inf, a), axis=0), axis=0).astype(xp.float64)
            return xp.where(nanm, xp.nan, r)
        X, Y = rank(xp.where(xp.isnan(Y), xp.nan, X)), rank(xp.where(xp.isnan(X), xp.nan, Y))
    w = ~(xp.isnan(X) | xp.isnan(Y))
    n = w.sum(0)
    nn = xp.maximum(n, 1)
    mx = xp.where(w, X, 0).sum(0) / nn
    my = xp.where(w, Y, 0).sum(0) / nn
    dx = xp.where(w, X - mx, 0.0)
    dy = xp.where(w, Y - my, 0.0)
    with np.errstate(all="ignore"):
        r = (dx * dy).sum(0) / xp.sqrt((dx * dx).sum(0) * (dy * dy).sum(0))
        r1x = xp.clip(xp.nan_to_num(_lag1(xp.where(w, X, xp.nan), xp)), 0, 0.95)
        r1y = xp.clip(xp.nan_to_num(_lag1(xp.where(w, Y, xp.nan), xp)), 0, 0.95)
        neff = n * (1 - r1x * r1y) / (1 + r1x * r1y)
    r, n, neff = to_np(r), to_np(n), to_np(neff)
    neff = np.clip(neff, 3, None)
    with np.errstate(all="ignore"):
        tt = r * np.sqrt((neff - 2) / np.clip(1 - r ** 2, 1e-12, None))
        p = 2 * stats.t.sf(np.abs(tt), neff - 2)
    bad = (n < min_n) | ~np.isfinite(r)
    r = np.where(bad, np.nan, r); p = np.where(bad, np.nan, p)
    sig = fdr_mask(p, q=q)
    return dict(r=r.reshape(shp), p=p.reshape(shp), n=n.reshape(shp), neff=neff.reshape(shp), sig=sig.reshape(shp))


def partial_corr(rxy, rxz, ryz):
    """First-order partial correlation r_xy.z from three correlation fields."""
    with np.errstate(all="ignore"):
        return (rxy - rxz * ryz) / np.sqrt((1 - rxz ** 2) * (1 - ryz ** 2))


def best_lag(x, y, times, lags=range(0, 7), **kw):
    """Scan lags; return dict(best_lag, r_at_best, p_at_best, sig) per pixel (max |r|)."""
    res = [grid_corr(x, y, times, lag=L, **kw) for L in lags]
    R = np.stack([np.nan_to_num(a["r"], nan=0.0) for a in res])
    k = np.argmax(np.abs(R), axis=0)
    take = lambda key: np.take_along_axis(np.stack([a[key] for a in res]), k[None], 0)[0]
    lags = np.asarray(list(lags))
    return dict(best_lag=lags[k].astype(float), r=take("r"), p=take("p"), sig=take("sig").astype(bool))


# ----------------------------------------------------------------------------
# single-series analysis
# ----------------------------------------------------------------------------

def pettitt(x):
    """Pettitt (1979) change-point test. Returns (index_of_change, K, p)."""
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    n = len(x)
    if n < 6:
        return None, np.nan, np.nan
    sgn = np.sign(x[:, None] - x[None, :])
    U = np.cumsum(sgn.sum(1))[:-1]
    k = int(np.argmax(np.abs(U)))
    K = float(np.abs(U[k]))
    p = min(1.0, 2 * math.exp(-6 * K ** 2 / (n ** 3 + n ** 2)))
    return k, K, p


def years_to_detect(slope_per_yr, noise_sd, phi):
    """Weatherhead et al. (1998): years of monthly data needed to detect a linear trend
    (5% significance, 90% probability) given monthly noise sd and lag-1 autocorrelation."""
    if not np.isfinite(slope_per_yr) or slope_per_yr == 0 or not np.isfinite(noise_sd):
        return np.nan
    phi = float(np.clip(phi if np.isfinite(phi) else 0.0, 0.0, 0.95))
    return float((3.3 * noise_sd / abs(slope_per_yr) * np.sqrt((1 + phi) / (1 - phi))) ** (2.0 / 3.0))


def _mk_hr(x):
    import pymannkendall as mk
    try:
        r = mk.hamed_rao_modification_test(x)
        return dict(trend=r.trend, p=float(r.p), z=float(r.z), sen=float(r.slope))
    except Exception as exc:
        return dict(trend="error", p=np.nan, z=np.nan, sen=np.nan, err=str(exc))


def _mk_plain(x):
    import pymannkendall as mk
    r = mk.original_test(x)
    return dict(trend=r.trend, p=float(r.p), z=float(r.z), sen=float(r.slope))


def _mk_yuewang(x):
    import pymannkendall as mk
    try:
        r = mk.yue_wang_modification_test(x)
        return dict(trend=r.trend, p=float(r.p), z=float(r.z), sen=float(r.slope))
    except Exception as exc:
        return dict(trend="error", p=np.nan, z=np.nan, sen=np.nan, err=str(exc))


def series_trend(s: pd.Series, name: str = "", units: str = "", per: float = 10.0,
                 annual_min: int = 10, deseasonalize: bool = True, start=None, end=None) -> dict:
    """Full trend summary of a monthly (or annual) pd.Series with a DatetimeIndex."""
    s = s.copy()
    s.index = pd.DatetimeIndex(s.index)
    if start is not None:
        s = s[s.index >= pd.Timestamp(start)]
    if end is not None:
        s = s[s.index <= pd.Timestamp(end)]
    s = s.dropna()
    if len(s) < 8:
        return dict(name=name, error="too few points", n=len(s))
    monthly = (pd.Series(s.index).diff().dt.days.median() or 365) < 40
    t = decimal_year(s.index)
    if monthly and deseasonalize:
        anom, _ = deseason(s.values, s.index.month.values)
        anom = np.asarray(anom)
    else:
        anom = s.values - np.nanmean(s.values)
    ols = ols_ar1(anom[:, None], t, min_frac=0.0)
    slope = float(ols["slope"][0]); ci = float(ols["ci"][0]); p_ols = float(ols["p"][0])
    if monthly:
        ann = s.groupby(s.index.year).agg(["mean", "count"])
        ann = ann[ann["count"] >= annual_min]["mean"]
    else:
        ann = s.groupby(s.index.year).mean()
    mk_ann = _mk_plain(ann.values) if len(ann) >= 4 else dict(p=np.nan, sen=np.nan, trend="n/a")
    mk_hr = _mk_hr(anom)
    mk_yw = _mk_yuewang(anom)
    yrs = ann.index.values.astype(float)
    sen_ann = mk_ann["sen"]  # per year (annual steps)
    k, K, p_pet = pettitt(ann.values) if len(ann) >= 6 else (None, np.nan, np.nan)
    change_year = int(ann.index[k + 1]) if k is not None and k + 1 < len(ann) else None
    mean_level = float(np.nanmean(s.values))
    with np.errstate(all="ignore"):
        resid = ann.values - (sen_ann * (yrs - yrs.mean()) + ann.values.mean())
        iav = float(np.nanstd(resid, ddof=1)) if len(ann) > 2 else np.nan
        span = float(t[-1] - t[0])
        total_change = slope * span
        snr = abs(total_change) / iav if iav and iav > 0 else np.nan
        pct_dec = 100 * per * slope / abs(mean_level) if mean_level != 0 else np.nan
    with np.errstate(all="ignore"):
        noise = anom - (slope * (t - t.mean()) + np.nanmean(anom))
        noise_sd = float(np.nanstd(noise, ddof=2))
    ytd = years_to_detect(slope, noise_sd, float(ols["r1"][0])) if monthly else np.nan
    sig_ols = p_ols < 0.05
    sig_mk = (mk_hr.get("p", 1) < 0.05)
    agree = np.sign(slope) == np.sign(mk_hr.get("z", 0) or 0)
    if sig_ols and sig_mk and agree:
        verdict = "significant (OLS-AR1 & MK-HR agree)"
    elif sig_ols or sig_mk:
        verdict = "significant in one test"
    elif min(p_ols, mk_hr.get("p", 1)) < 0.20:
        verdict = "suggestive (p<0.20)"
    else:
        verdict = "no significant trend"
    return dict(
        name=name, units=units, start=str(s.index[0].date()), end=str(s.index[-1].date()),
        n=int(len(s)), monthly=bool(monthly), mean=mean_level,
        slope_per_decade=slope * per, ci95_per_decade=ci * per, p_ols_ar1=p_ols, r1=float(ols["r1"][0]),
        neff=float(ols["neff"][0]), mk_hr_p=mk_hr.get("p"), mk_hr_sen_per_decade=(mk_hr.get("sen") or np.nan) * (12 if monthly else 1) * per,
        mk_yw_p=mk_yw.get("p"), mk_annual_p=mk_ann["p"], sen_annual_per_decade=sen_ann * per,
        pct_per_decade=pct_dec, total_change=total_change, iav_sd=iav, snr=snr,
        pettitt_change_year=change_year, pettitt_p=p_pet, verdict=verdict,
        noise_sd=noise_sd, years_to_detect=ytd,
        years_more_needed=(max(0.0, ytd - span) if np.isfinite(ytd) else np.nan),
    )


# ----------------------------------------------------------------------------
# spatial helpers (xarray)
# ----------------------------------------------------------------------------

def standardize_coords(da):
    """Rename lat/lon variants, convert lon to -180..180, sort ascending."""
    import xarray as xr  # noqa: F401
    ren = {}
    for c in da.coords:
        lc = c.lower()
        if lc in ("latitude", "lat", "y") and c != "lat":
            ren[c] = "lat"
        if lc in ("longitude", "lon", "x") and c != "lon":
            ren[c] = "lon"
    if ren:
        da = da.rename(ren)
    if "lon" in da.coords and float(da.lon.max()) > 180:
        da = da.assign_coords(lon=(((da.lon + 180) % 360) - 180))
    if "lon" in da.dims:
        da = da.sortby("lon")
    if "lat" in da.dims:
        da = da.sortby("lat")
    return da


def area_mean(da, bbox=None, mask=None):
    """cos(lat)-weighted mean over lat/lon. bbox=(lon0, lon1, lat0, lat1)."""
    da = standardize_coords(da)
    if bbox is not None:
        lon0, lon1, lat0, lat1 = bbox
        da = da.sel(lon=slice(lon0, lon1), lat=slice(lat0, lat1))
    if mask is not None:
        da = da.where(mask)
    w = np.cos(np.deg2rad(da.lat))
    return da.weighted(w.fillna(0)).mean(("lat", "lon"), skipna=True)


# ----------------------------------------------------------------------------
# bookkeeping
# ----------------------------------------------------------------------------



def task_dir(task: str) -> str:
    d = os.path.join(ROOT, "results", task)
    os.makedirs(d, exist_ok=True)
    return d


class _Enc(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return None if not np.isfinite(o) else float(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, (np.bool_,)):
            return bool(o)
        return str(o)


def _clean(o):
    if isinstance(o, float) and not math.isfinite(o):
        return None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    return o


def save_json(obj, path):
    with open(path, "w") as f:
        json.dump(_clean(obj), f, indent=2, cls=_Enc)


def runlog(task: str, status: str, headline: str):
    line = f"| {time.strftime('%Y-%m-%d %H:%M')} | {task} | {status} | {headline} |\n"
    p = os.path.join(ROOT, "RUNLOG.md")
    new = not os.path.exists(p)
    with open(p, "a") as f:
        if new:
            f.write("# Run log\n\n| time | task | status | headline |\n|---|---|---|---|\n")
        f.write(line)


def fix_perms(path=ROOT):
    """chmod 777 everything we created under path (user requirement)."""
    for dp, dns, fns in os.walk(path):
        for n in dns + fns:
            p = os.path.join(dp, n)
            try:
                if not os.path.islink(p):
                    os.chmod(p, 0o777)
            except PermissionError:
                pass
    try:
        os.chmod(path, 0o777)
    except PermissionError:
        pass
