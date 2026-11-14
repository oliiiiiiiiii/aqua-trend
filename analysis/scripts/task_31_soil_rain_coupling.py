"""Task 31 - Does wet soil make its own rain?  Land-atmosphere coupling hotspots.

Per pixel, monthly anomalies (deseasonalised, linearly detrended), 2001-2025:
  partial r( SM_t , P_{t+1} | P_t, P_{t-1}, Nino3.4_t )
i.e. does this month's soil moisture predict next month's rain beyond what this/last month's rain and ENSO already say.
Warm season only (NH: t = May-Aug; SH: t = Nov-Feb; tropics |lat|<10: all months), when evaporation can feed convection.
Cross-checks: A = MERRA-2 GWETTOP + IMERG, B = GLDAS SM 0-10 cm + IMERG, C = MERRA-2 GWETTOP + GPCP.
Robust hotspot = FDR-significant (q=0.10) and same sign in A and B.
Placebo: same statistic with rain in the same season one year later, P_{t+13} (the soil of one month cannot cause it).
"""
import sys
import numpy as np
import pandas as pd
import xarray as xr
from scipy import stats
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "31_soil_rain_coupling"
out = tl.task_dir(TASK)
SRC = "Data: MERRA-2 land (GWETTOP), GLDAS-2.1 Noah (SM 0–10 cm), GPM IMERG V07, GPCP v2.3, NOAA Niño3.4; 2001–2025."
lon, lat = hub.LON, hub.LAT
land = hub.land_mask() & (lat[:, None] > -58) & (lat[:, None] < 75)
LATg = np.broadcast_to(lat[:, None], land.shape)


def gldas_sm0():
    t, a = hub._gd("gldas", "SoilMoi0_10cm_inst")
    return hub._da(a, t, "sm0", "mm")


def gwettop():
    t, a = hub._gd("m2lnd", "GWETTOP", "native")
    return hub._da(hub._merra_to_hub(a), t, "gwettop", "fraction")


def anomalies(da, t):
    a = da.sel(time=t).values.astype(np.float64).reshape(len(t), -1)
    a, _ = tl.deseason(a, t.month.values)
    ty = tl.decimal_year(t); tc = ty - ty.mean()
    ok = np.isfinite(a).all(0)
    sl = np.zeros(a.shape[1])
    sl[ok] = (tc @ a[:, ok]) / (tc @ tc)
    return a - sl[None] * tc[:, None], ok


def resid(Y, Zs):
    """Residualise Y (n, p) on regressors Zs (list of (n, p) or (n,)) + intercept, per pixel."""
    n, p = Y.shape
    Z = np.stack([np.ones((n, p))] + [np.broadcast_to(z if z.ndim == 2 else z[:, None], (n, p)) for z in Zs], axis=1)  # n,k,p
    ZtZ = np.einsum("nkp,njp->pkj", Z, Z)
    ZtY = np.einsum("nkp,np->pk", Z, Y)
    beta = np.linalg.solve(ZtZ + 1e-9 * np.eye(Z.shape[1])[None], ZtY[..., None])[..., 0]
    return Y - np.einsum("nkp,pk->np", Z, beta)


def coupling(sm_da, p_da, label, lead=1):
    (S, P), t = hub.align(sm_da, p_da, start="2001-01-01", end="2025-12-31")
    sa, ok1 = anomalies(S, t); pa, ok2 = anomalies(P, t)
    ok = ok1 & ok2 & land.ravel()
    n34 = hub.index("nino34").reindex(t).values
    n34 = (n34 - np.nanmean(n34))
    m = t.month.values
    idx = np.arange(2, len(t) - 1)
    nh = np.isin(m[idx], [5, 6, 7, 8]); sh = np.isin(m[idx], [11, 12, 1, 2])
    rows = {"NH": idx[nh], "SH": idx[sh], "TR": idx}
    lat_cls = np.where(np.abs(LATg) < 10, "TR", np.where(LATg > 0, "NH", "SH")).ravel()
    r = np.full(sa.shape[1], np.nan); pval = np.full(sa.shape[1], np.nan); r_plac = np.full(sa.shape[1], np.nan)
    for cls, ii in rows.items():
        cols = np.where(ok & (lat_cls == cls))[0]
        if len(cols) == 0:
            continue
        for c0 in range(0, len(cols), 20000):
            cc = cols[c0:c0 + 20000]
            X = sa[ii][:, cc]; Pt = pa[ii][:, cc]; Pm1 = pa[ii - 1][:, cc]; N = n34[ii]
            Yf = pa[ii + lead][:, cc]
            Zs = [Pt, Pm1, N]
            rx = resid(X, Zs); ry = resid(Yf, Zs)
            rr = (rx * ry).sum(0) / np.sqrt((rx ** 2).sum(0) * (ry ** 2).sum(0))
            # Bretherton n_eff from lag-1 autocorrelation of the residuals (consecutive months only)
            cons = np.diff(ii) == 1
            r1 = lambda a: np.clip((a[1:][cons] * a[:-1][cons]).sum(0) / (a ** 2).sum(0), 0, 0.95)
            r1x, r1y = r1(rx), r1(ry)
            neff = len(ii) * (1 - r1x * r1y) / (1 + r1x * r1y)
            dof = np.clip(neff - 2 - len(Zs), 3, None)
            tt = rr * np.sqrt(dof / np.clip(1 - rr ** 2, 1e-9, None))
            # placebo: rain in the same season one year later (soil moisture of a month cannot cause it)
            iip = ii[ii + 13 < len(t)]
            Zp = [pa[iip][:, cc], pa[iip - 1][:, cc], n34[iip]]
            rxp = resid(sa[iip][:, cc], Zp); ryp = resid(pa[iip + 13][:, cc], Zp)
            r_plac[cc] = (rxp * ryp).sum(0) / np.sqrt((rxp ** 2).sum(0) * (ryp ** 2).sum(0))
            r[cc] = rr; pval[cc] = 2 * stats.t.sf(np.abs(tt), dof)
    sig = tl.fdr_mask(pval, q=0.10)
    shp = land.shape
    print(f"[{label}] land with significant coupling: + {np.mean(sig[ok] & (r[ok] > 0)):.1%}  − {np.mean(sig[ok] & (r[ok] < 0)):.1%}; "
          f"mean r {np.nanmean(r[ok]):+.3f}; placebo mean r {np.nanmean(r_plac[ok]):+.3f}, placebo |r|>0.2: {np.mean(np.abs(r_plac[ok]) > 0.2):.1%} "
          f"vs real {np.mean(np.abs(r[ok]) > 0.2):.1%}", flush=True)
    return dict(r=r.reshape(shp), p=pval.reshape(shp), sig=sig.reshape(shp), placebo=r_plac.reshape(shp), ok=ok.reshape(shp))


imerg = hub.load("p_imerg")
A = coupling(gwettop(), imerg, "A MERRA-2 SM + IMERG")
B = coupling(gldas_sm0(), imerg, "B GLDAS SM + IMERG")
C = coupling(gwettop(), hub.load("p_gpcp"), "C MERRA-2 SM + GPCP")
okAB = A["ok"] & B["ok"]
robust = okAB & A["sig"] & B["sig"] & (np.sign(A["r"]) == np.sign(B["r"]))
w = np.cos(np.deg2rad(lat))[:, None] * np.ones(land.shape)
pat = {k: float(np.corrcoef(X["r"][okAB & np.isfinite(X["r"]) & np.isfinite(Y["r"])], Y["r"][okAB & np.isfinite(X["r"]) & np.isfinite(Y["r"])])[0, 1]) for k, (X, Y) in
       {"A_vs_B": (A, B), "A_vs_C": (A, C)}.items()}
res = dict(pattern_r=pat,
           robust_pos_frac=float(np.sum(w[robust & (A["r"] > 0)]) / np.sum(w[okAB])),
           robust_neg_frac=float(np.sum(w[robust & (A["r"] < 0)]) / np.sum(w[okAB])),
           placebo_absr_gt_0p2={k: float(np.mean(np.abs(X["placebo"][X["ok"]]) > 0.2)) for k, X in (("A", A), ("B", B), ("C", C))},
           real_absr_gt_0p2={k: float(np.mean(np.abs(X["r"][X["ok"]]) > 0.2)) for k, X in (("A", A), ("B", B), ("C", C))},
           sig_pos_frac={k: float(np.mean(X["sig"][X["ok"]] & (X["r"][X["ok"]] > 0))) for k, X in (("A", A), ("B", B), ("C", C))},
           sig_neg_frac={k: float(np.mean(X["sig"][X["ok"]] & (X["r"][X["ok"]] < 0))) for k, X in (("A", A), ("B", B), ("C", C))})
print("pattern agreement:", {k: round(v, 2) for k, v in pat.items()}, "robust +", f"{res['robust_pos_frac']:.1%}", "robust −", f"{res['robust_neg_frac']:.1%}", flush=True)
mean_r = np.where(okAB, (A["r"] + B["r"]) / 2, np.nan)
hot = pd.DataFrame() if not robust.any() else hs.find_hotspots(lon, lat, np.where(robust, mean_r, np.nan), robust, min_cells=6, top=12)
print(hot.round(3).to_string() if hasattr(hot, "round") else hot, flush=True)
viz.trend_map(lon, lat, mean_r, robust, f"{out}/map_soil_makes_rain.png",
              "Does wet soil make its own rain?",
              "Partial correlation of this month's soil moisture with next month's rain, after removing this month's and last month's rain "
              "and ENSO (warm season). Full colour = significant in two independent soil-moisture models. Green = wet soil → more rain later.",
              "partial r (soil moisture → next month's rain)", vmax=0.35, cmap="green", source=SRC)
viz.trend_map(lon, lat, np.where(A["ok"], A["placebo"], np.nan), np.zeros(land.shape, bool), f"{out}/map_placebo.png",
              "Placebo: soil moisture vs rain a year later",
              f"Same statistic with rain in the same season one year later (one month's soil cannot cause it). |r| > 0.2 on "
              f"{res['placebo_absr_gt_0p2']['A']:.0%} of land vs {res['real_absr_gt_0p2']['A']:.0%} for the real test.",
              "partial r", vmax=0.35, cmap="green", source=SRC)
tl.save_json(dict(res, hotspots=hot.to_dict("records") if hasattr(hot, "to_dict") else None), f"{out}/stats.json")
xr.Dataset({k: (("lat", "lon"), v.astype(np.float32)) for k, v in
            {"r_A": A["r"], "r_B": B["r"], "r_C": C["r"], "robust": robust.astype(float), "placebo_A": A["placebo"]}.items()},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/coupling.nc")
tl.runlog(TASK, "done", f"robust + {res['robust_pos_frac']:.1%} / − {res['robust_neg_frac']:.1%} of land; pattern r A-B {pat['A_vs_B']:+.2f}")
tl.fix_perms(out)
print("done")
