"""Task 33 - Is the water cycle's seasonal swing growing?  "Wet seasons wetter, dry seasons drier" in time.

Rain (GPCP 1979-2025; IMERG 2001-2025 check): per pixel the climatologically wettest and driest 3-month windows; yearly totals
of each; trends (OLS-AR1 + Mann-Kendall, FDR q=0.10). Four-way class:
  amplifying (wet up, dry down) | wetter all year (both up) | drier all year (both down) | damping (wet down, dry up).
Stored water (GRACE 2003-2025): amplitude of the annual cycle fitted year by year; trend of the amplitude.
"""
import sys
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "33_seasonal_swing"
out = tl.task_dir(TASK)
lon, lat = hub.LON, hub.LAT
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
land = hub.land_mask() & (lat[:, None] > -58) & (lat[:, None] < 75) & ~(cg == inv.get("Greenland", -9))
w = np.cos(np.deg2rad(lat))[:, None] * np.ones(land.shape)


def season_series(da, y0, y1):
    (P,), t = hub.align(da, start=f"{y0}-01-01", end=f"{y1}-12-31")
    full = pd.date_range(f"{y0}-01-01", f"{y1}-12-01", freq="MS")
    if len(t) < len(full):
        print(f"  {len(full) - len(t)} missing months -> NaN", flush=True)
    a = P.reindex(time=full).values.astype(np.float64)
    nt = len(full)
    R3 = np.full_like(a, np.nan)
    R3[:-2] = (a[:-2] + a[1:-1] + a[2:]) * 30.4  # mm per 3 months
    clim = np.stack([np.nanmean(R3[m::12], 0) for m in range(12)])  # by start month
    clim_f = np.nan_to_num(clim, nan=-1)
    ws = np.argmax(clim_f, 0); ds = np.argmin(np.where(clim_f < 0, np.inf, clim_f), 0)
    ny = y1 - y0 + 1
    R3y = R3.reshape(ny, 12, *a.shape[1:])
    wet = np.take_along_axis(R3y, ws[None, None], 1)[:, 0]
    dry = np.take_along_axis(R3y, ds[None, None], 1)[:, 0]
    return wet, dry, ws, ds, np.arange(y0, y1 + 1), np.nanmean(a, 0) * 365


def trend(yrs, Y, mask):
    t = yrs.astype(float)
    r = tl.ols_ar1(Y.reshape(len(yrs), -1), t, min_frac=0.8)
    mk = tl.mk_grid(Y.reshape(len(yrs), -1))
    p = np.fmax(r["p"], mk["p"])  # both tests must agree
    p = np.where(mask.ravel(), p, np.nan)
    sig = tl.fdr_mask(p, q=0.10).reshape(mask.shape)
    mean = np.nanmean(Y, 0)
    with np.errstate(all="ignore"):
        pct = r["slope"].reshape(mask.shape) * 10 / mean * 100
    return pct, sig


def classify(name, da, y0, y1):
    wet, dry, ws, ds, yrs, ann = season_series(da, y0, y1)
    dry_clim = np.nanmean(dry, 0)
    okw = land & np.isfinite(np.nanmean(wet, 0)) & (ann > 100)
    okd = okw & (dry_clim > 15)  # dry season with < 15 mm per 3 months is "always dry": % change meaningless
    wp, wsig = trend(yrs, wet, okw)
    dp, dsig = trend(yrs, dry, okd)
    cls = np.full(land.shape, np.nan)
    both = okd
    cls[both & (wp > 0) & (dp < 0)] = 0  # amplifying
    cls[both & (wp > 0) & (dp > 0)] = 1  # wetter all year
    cls[both & (wp < 0) & (dp < 0)] = 2  # drier all year
    cls[both & (wp < 0) & (dp > 0)] = 3  # damping
    sig = both & (wsig | dsig)
    fr = {}
    labels = ["amplifying", "wetter_all_year", "drier_all_year", "damping"]
    for k, lb in enumerate(labels):
        fr[lb] = dict(all=float(np.sum(w[cls == k]) / np.sum(w[both])), sig=float(np.sum(w[(cls == k) & sig]) / np.sum(w[both])))
    print(f"[{name} {y0}-{y1}] class shares (all / significant):", {k: (round(v['all'], 3), round(v['sig'], 3)) for k, v in fr.items()},
          f"| wet-season sig up {np.sum(w[okw & wsig & (wp > 0)]) / np.sum(w[okw]):.1%} down {np.sum(w[okw & wsig & (wp < 0)]) / np.sum(w[okw]):.1%}"
          f" | dry-season sig up {np.sum(w[okd & dsig & (dp > 0)]) / np.sum(w[okd]):.1%} down {np.sum(w[okd & dsig & (dp < 0)]) / np.sum(w[okd]):.1%}",
          flush=True)
    return dict(cls=cls, sig=sig, wp=wp, dp=dp, wsig=wsig, dsig=dsig, okw=okw, okd=okd, frac=fr, ws=ws, ds=ds)


G = classify("GPCP", hub.load("p_gpcp"), 1979, 2025)
I = classify("IMERG", hub.load("p_imerg"), 2001, 2025)
G2 = classify("GPCP", hub.load("p_gpcp"), 2001, 2025)
okc = np.isfinite(G["cls"]) & np.isfinite(I["cls"])
agree_I_G2 = float(np.sum(w[okc & (I["cls"] == G2["cls"])]) / np.sum(w[okc]))
print(f"IMERG vs GPCP (2001-2025) class agreement: {agree_I_G2:.0%} of land (25% by chance)", flush=True)
res = {"gpcp_1979_2025": G["frac"], "imerg_2001_2025": I["frac"], "gpcp_2001_2025": G2["frac"], "class_agreement_imerg_gpcp_2001_2025": agree_I_G2}

# --- 4-class map (GPCP 1979-2025) ---
cols = ["#6250d6", "#2a78d6", "#eb6834", "#1baf7a"]
labels = ["Amplifying: wet season wetter, dry season drier", "Wetter all year", "Drier all year", "Damping: wet season drier, dry season wetter"]
fig = plt.figure(figsize=(12, 7.0), dpi=180)
ax = fig.add_axes([0.02, 0.17, 0.96, 0.66], projection=ccrs.Robinson()); ax.set_global()
ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#e1e0d9", zorder=1)
def alpha_mix(hexc, a):
    c = np.array(matplotlib.colors.to_rgb(hexc)); s = np.array(matplotlib.colors.to_rgb(viz.SURFACE))
    return tuple(s + a * (c - s))
cm_full = ListedColormap(cols); cm_fade = ListedColormap([alpha_mix(c, 0.28) for c in cols])
C = G["cls"]
ax.imshow(np.where(~G["sig"], C, np.nan), origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(), cmap=cm_fade,
          vmin=-0.5, vmax=3.5, interpolation="nearest", zorder=2)
ax.imshow(np.where(G["sig"], C, np.nan), origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(), cmap=cm_full,
          vmin=-0.5, vmax=3.5, interpolation="nearest", zorder=2)
ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.5, edgecolor=viz.INK2, zorder=3)
fr = G["frac"]
for k, (c, lb) in enumerate(zip(cols, labels)):
    key = ["amplifying", "wetter_all_year", "drier_all_year", "damping"][k]
    x0 = 0.04 + (k % 2) * 0.47; y0 = 0.10 - (k // 2) * 0.04
    fig.patches.append(matplotlib.patches.Rectangle((x0, y0), 0.018, 0.022, transform=fig.transFigure, color=c))
    fig.text(x0 + 0.025, y0 + 0.011, f"{lb} — {fr[key]['all']:.0%} of land ({fr[key]['sig']:.0%} significant)", fontsize=9, color=viz.INK2, va="center")
fig.text(0.03, 0.965, "Is the seasonal swing of rain growing? Wettest vs driest season, 1979–2025", fontsize=15, fontweight="bold", va="top")
fig.text(0.03, 0.915, "Each pixel's climatologically wettest and driest 3-month seasons; colour = direction of the two trends. Full colour = at least one "
         "of the two trends significant (OLS-AR1 and Mann-Kendall, FDR q=0.10). Grey = dry season essentially rainless.",
         fontsize=9.5, color=viz.INK2, va="top", wrap=True)
fig.text(0.03, 0.012, "Data: GPCP v2.3 monthly precipitation 1979–2025 (IMERG 2001–2025 cross-check).", fontsize=7.5, color=viz.MUTED)
fig.savefig(f"{out}/map_seasonal_swing_classes.png"); plt.close(fig)
viz.trend_map(lon, lat, np.where(G["okw"], G["wp"], np.nan), G["wsig"], f"{out}/map_wet_season_trend.png",
              "Wettest-season rain trend (GPCP 1979–2025)", "Trend of rain in each pixel's climatologically wettest 3 months.",
              "% per decade", vmax=12, cmap="water", source="Data: GPCP v2.3.")
viz.trend_map(lon, lat, np.where(G["okd"], G["dp"], np.nan), G["dsig"], f"{out}/map_dry_season_trend.png",
              "Driest-season rain trend (GPCP 1979–2025)", "Trend of rain in each pixel's climatologically driest 3 months (grey: essentially rainless).",
              "% per decade", vmax=20, cmap="water", source="Data: GPCP v2.3.")

# --- GRACE: amplitude of the annual cycle, year by year ---
tws = hub.load("tws")
(T,), tt = hub.align(tws, start="2003-01-01", end="2025-12-31")
a = T.values.astype(np.float64)
yrs = np.arange(2003, 2026)
amp = np.full((len(yrs),) + land.shape, np.nan)
for i, y in enumerate(yrs):
    sel = tt.year == y
    mm = tt.month.values[sel]; v = a[sel]
    good = ~np.isnan(v).all(axis=(1, 2))
    if good.sum() < 10:
        continue
    ph = 2 * np.pi * (mm[good] - 0.5) / 12
    X = np.column_stack([np.ones(good.sum()), np.cos(ph), np.sin(ph), mm[good] - 6.5])
    V = v[good].reshape(good.sum(), -1)
    okc_ = np.isfinite(V).all(0)
    beta = np.full((4, V.shape[1]), np.nan)
    beta[:, okc_] = np.linalg.lstsq(X, V[:, okc_], rcond=None)[0]
    amp[i] = np.hypot(beta[1], beta[2]).reshape(land.shape)
valid_y = ~np.isnan(amp).all(axis=(1, 2))
print("GRACE years with amplitude:", yrs[valid_y].tolist(), flush=True)
r = tl.ols_ar1(amp[valid_y].reshape(valid_y.sum(), -1), yrs[valid_y].astype(float), min_frac=0.8)
mk = tl.mk_grid(amp[valid_y].reshape(valid_y.sum(), -1))
p = np.where(land.ravel(), np.fmax(r["p"], mk["p"]), np.nan)
gsig = tl.fdr_mask(p, q=0.10).reshape(land.shape)
amp_mean = np.nanmean(amp[valid_y], 0)
gpct = r["slope"].reshape(land.shape) * 10 / amp_mean * 100
okg = land & (amp_mean > 2)
res["grace_amplitude"] = dict(years=yrs[valid_y].tolist(), sig_up=float(np.sum(w[okg & gsig & (gpct > 0)]) / np.sum(w[okg])),
                              sig_down=float(np.sum(w[okg & gsig & (gpct < 0)]) / np.sum(w[okg])))
# relation: does the storage swing grow where the rain swing grows? (GPCP 2001-2025 swing = wet% - dry%)
swing = G2["wp"] - G2["dp"]
okr = okg & np.isfinite(swing) & np.isfinite(gpct)
res["grace_amp_vs_rain_swing_spatial_r"] = float(np.corrcoef(gpct[okr], swing[okr])[0, 1])
print("GRACE amplitude:", res["grace_amplitude"], "spatial r with rain swing:", round(res["grace_amp_vs_rain_swing_spatial_r"], 2), flush=True)
regs = {"Amazon": (-75, -50, -15, 0), "Congo": (12, 30, -8, 5), "Ganges-Brahmaputra": (78, 95, 22, 30), "Mekong": (98, 108, 10, 22),
        "Sahel": (-15, 30, 10, 17), "Yangtze": (100, 122, 25, 33), "Taiwan": (119.9, 122.1, 21.8, 25.4), "Southern Africa": (20, 35, -22, -10),
        "Australia north": (125, 145, -20, -11), "Mississippi": (-97, -85, 30, 45)}
LON, LAT = np.meshgrid(lon, lat)
rows = []
for nm, b in regs.items():
    m = (LON >= b[0]) & (LON <= b[1]) & (LAT >= b[2]) & (LAT <= b[3]) & land
    ww = w[m]
    f = lambda X: float(np.nansum(X[m] * ww) / np.sum(ww[np.isfinite(X[m])])) if np.isfinite(X[m]).any() else None
    rows.append(dict(region=nm, wet_pct_dec_1979=f(G["wp"]), dry_pct_dec_1979=f(np.where(G["okd"], G["dp"], np.nan)),
                     wet_pct_dec_imerg=f(I["wp"]), dry_pct_dec_imerg=f(np.where(I["okd"], I["dp"], np.nan)),
                     grace_amp_pct_dec=f(np.where(okg, gpct, np.nan)), grace_amp_cm=f(amp_mean)))
df = pd.DataFrame(rows); df.to_csv(f"{out}/regions.csv", index=False)
print(df.round(1).to_string(), flush=True)
res["regions"] = rows
viz.trend_map(lon, lat, np.where(okg, gpct, np.nan), gsig & okg, f"{out}/map_grace_annual_amplitude_trend.png",
              "Is the yearly swing of stored water growing? (GRACE 2003–2025)",
              f"Trend in the amplitude of each year's fitted annual cycle of water storage. Significant growth on "
              f"{res['grace_amplitude']['sig_up']:.0%} of land, shrinking on {res['grace_amplitude']['sig_down']:.0%}.",
              "% per decade", vmax=25, cmap="water", source="Data: GRACE/GRACE-FO JPL mascons; years with ≥10 months.")
tl.save_json(res, f"{out}/stats.json")
xr.Dataset({"class_gpcp": (("lat", "lon"), G["cls"].astype(np.float32)), "sig_gpcp": (("lat", "lon"), G["sig"].astype(np.float32)),
            "wet_pct_dec": (("lat", "lon"), G["wp"].astype(np.float32)), "dry_pct_dec": (("lat", "lon"), G["dp"].astype(np.float32)),
            "grace_amp_pct_dec": (("lat", "lon"), gpct.astype(np.float32))}, coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/seasonal_swing.nc")
tl.runlog(TASK, "done", "GPCP classes " + ", ".join(f"{k} {v['all']:.0%}/{v['sig']:.0%}" for k, v in G["frac"].items()))
tl.fix_perms(out)
print("done")
