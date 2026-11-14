"""Task 29 - Water memory: how long after rain does stored water (GRACE) respond most?

Per pixel: correlation of deseasonalised, detrended IMERG rain anomalies with GRACE TWS anomalies at lags 0..9 months
(rain leading). Map of the lag of maximum correlation (where significant) and of the maximum r.
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
from regions import REGIONS  # noqa: E402

TASK = "29_water_memory"
out = tl.task_dir(TASK)
SRC = "Data: GPM IMERG rain, GRACE/GRACE-FO water storage, 2002–2025. AR(1)-adjusted correlation, FDR q=0.10."
lon, lat = hub.LON, hub.LAT
land = hub.land_mask() & (lat[:, None] > -58)
(T, P), t = hub.align(hub.load("tws"), hub.load("p_imerg"), start="2002-04-01")
print("months", len(t), flush=True)
lags = range(0, -10, -1)  # field first (TWS), series second (P); negative lag -> P leads TWS
bl = tl.best_lag(T.values, P.values, t, lags=lags)
lag = -bl["best_lag"]; r = bl["r"]; sig = bl["sig"] & land & (r > 0)
lagm = np.where(sig, lag, np.nan)
w = np.cos(np.deg2rad(lat))[:, None] * np.ones_like(r)
ok = np.isfinite(lagm)
hist = {int(L): float(np.sum(w[ok & (lagm == L)]) / np.sum(w[ok])) for L in range(0, 10)}
print("share of responsive land by lag (months):", {k: round(v, 3) for k, v in hist.items()}, flush=True)
fig = plt.figure(figsize=(12, 6.8), dpi=180)
ax = fig.add_axes([0.02, 0.15, 0.96, 0.70], projection=ccrs.Robinson()); ax.set_global()
cols = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#1c5cab", "#184f95", "#104281", "#0d366b", "#081f3f"]
cm = ListedColormap(cols); norm = BoundaryNorm(np.arange(-0.5, 10.5, 1), cm.N)
im = ax.imshow(np.where(land, lagm, np.nan), origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(),
               cmap=cm, norm=norm, interpolation="nearest", zorder=2)
ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#e1e0d9", zorder=1)
ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.5, edgecolor=viz.INK2, zorder=3)
fig.text(0.03, 0.965, "Water memory: how long after it rains does the land's stored water peak?", fontsize=15, fontweight="bold", va="top")
fig.text(0.03, 0.915, "Lag (months) at which GRACE water storage correlates best with IMERG rain anomalies. Dark = slow, deep storage "
         "(big aquifers, lakes, floodplains); light = fast response. Grey = no significant link.", fontsize=9.5, color=viz.INK2, va="top", wrap=True)
cax = fig.add_axes([0.30, 0.085, 0.40, 0.022])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", ticks=range(0, 10)); cb.outline.set_visible(False)
cb.set_label("months from rain to peak storage response", fontsize=9, color=viz.INK2); cb.ax.tick_params(labelsize=8, length=0)
fig.text(0.03, 0.012, SRC, fontsize=7.5, color=viz.MUTED)
fig.savefig(f"{out}/map_water_memory_lag.png"); plt.close(fig)
viz.trend_map(lon, lat, np.where(land, r, np.nan), sig, f"{out}/map_rain_storage_maxcorr.png",
              "How strongly does rain control stored water?",
              "Maximum correlation (lags 0–9 months) between rain and GRACE water storage anomalies. Low values: storage driven by "
              "snow/ice, groundwater pumping or inflow from elsewhere.", "max correlation r", vmax=0.8, cmap="redblue", source=SRC)
regs = ["NW India (Punjab-Haryana-Rajasthan)", "North China Plain", "Amazon deforestation arc", "Sahel", "East African lakes (Victoria)",
        "California Central Valley", "Indo-Gangetic Plain", "Okavango-Zambezi", "Tigris-Euphrates (Iraq-Iran-Syria)"]
LONm, LATm = np.meshgrid(lon, lat)
rows = []
for rg in regs:
    b = REGIONS[rg]
    m = (LONm >= b[0]) & (LONm <= b[1]) & (LATm >= b[2]) & (LATm <= b[3]) & land
    rows.append(dict(region=rg, median_lag=float(np.nanmedian(lagm[m])) if np.isfinite(lagm[m]).any() else None,
                     mean_r=float(np.nanmean(r[m])), frac_sig=float(sig[m].mean())))
df = pd.DataFrame(rows); df.to_csv(f"{out}/regional_lags.csv", index=False)
print(df.round(2).to_string(), flush=True)
tl.save_json(dict(lag_histogram=hist, regions=rows), f"{out}/stats.json")
xr.Dataset({"lag": (("lat", "lon"), lagm.astype(np.float32)), "r": (("lat", "lon"), r.astype(np.float32))},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/water_memory.nc")
tl.runlog(TASK, "done", "lag histogram " + ", ".join(f"{k}:{v:.0%}" for k, v in hist.items()))
tl.fix_perms(out)
print("done")
