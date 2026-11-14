"""Task 26 - Is India's greening paid for with groundwater?

Dry-season (Rabi, Dec-Mar) NDVI is greened mainly by irrigation (rain is scarce then). Compare its per-pixel trend
(MODIS 0.1 deg -> 0.5 deg) with the GRACE-minus-GLDAS groundwater trend (task 21) across India/Pakistan/Bangladesh,
and compare annual Rabi NDVI with groundwater storage in NW India.
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import json
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from scipy import stats as ss

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "26_india_green_vs_groundwater"
out = tl.task_dir(TASK)
SRC = "Data: MODIS Terra MOD13C2 NDVI (LP DAAC); GRACE/GRACE-FO − GLDAS soil moisture & snow (groundwater). OLS+AR(1), MK, FDR."
EXT = (66.0, 98.0, 6.0, 37.0)
P = ROOT + "/data/processed/modis/ndvi"
t = pd.DatetimeIndex(json.load(open(f"{P}/times.json")))
nd = np.load(f"{P}/ndvi_global_0p1.npy", mmap_mode="r")
lon = -179.95 + 0.1 * np.arange(3600); lat = -89.95 + 0.1 * np.arange(1800)
i0, i1 = np.searchsorted(lon, EXT[0]), np.searchsorted(lon, EXT[1]); j0, j1 = np.searchsorted(lat, EXT[2]), np.searchsorted(lat, EXT[3])
sub = np.asarray(nd[:, j0:j1, i0:i1], np.float32); lo = lon[i0:i1]; la = lat[j0:j1]
# Rabi season mean (Dec of previous year .. Mar), season-year = Jan year
sy = t.year + (t.month == 12).astype(int)
rabi = np.isin(t.month, [12, 1, 2, 3])
yrs = [y for y in range(2001, 2027) if (rabi & (sy == y)).sum() >= 3]
R = np.stack([np.nanmean(sub[rabi & (sy == y)], 0) for y in yrs])
ols = tl.ols_ar1(R, np.array(yrs, float), min_frac=0.8); mk = tl.mk_grid(R)
tr = ols["slope"] * 10
sig = tl.fdr_mask(np.maximum(ols["p"], mk["p"]), 0.10)
veg = np.nanmean(R, 0) > 0.15
tr = np.where(veg, tr, np.nan); sig &= veg
print(f"Rabi NDVI: {np.nanmean(sig & (tr > 0)) / np.nanmean(veg):.0%} of vegetated pixels significantly greening", flush=True)
# aggregate to 0.5 deg and compare with groundwater trend
gw = xr.open_dataset(ROOT + "/results/21_water_budget/trend_grids.nc")
gwi = gw["gw_trend_cm_yr"].sel(lon=slice(EXT[0], EXT[1]), lat=slice(EXT[2], EXT[3]))
nb = 5
ny, nx = (tr.shape[0] // nb) * nb, (tr.shape[1] // nb) * nb
with np.errstate(all="ignore"):
    import warnings; warnings.simplefilter("ignore")
    tr05 = np.nanmean(tr[:ny, :nx].reshape(ny // nb, nb, nx // nb, nb), axis=(1, 3))
la05 = la[:ny].reshape(-1, nb).mean(1); lo05 = lo[:nx].reshape(-1, nb).mean(1)
gwv = gwi.interp(lat=la05, lon=lo05, method="nearest").values
cg, names = hs.country_grid(lo05, la05)
inv = {v: k for k, v in names.items()}
south_asia = np.isin(cg, [inv.get(c, -9) for c in ("India", "Pakistan", "Bangladesh", "Nepal")])
ok = np.isfinite(tr05) & np.isfinite(gwv) & south_asia
r, p = ss.spearmanr(tr05[ok], gwv[ok])
# spatial autocorrelation makes naive p too small: effective N ~ number of independent GRACE footprints (~3 deg)
n_eff = max(5, int(ok.sum() / 36))
z = np.arctanh(r) * np.sqrt(n_eff - 3); p_adj = 2 * ss.norm.sf(abs(z))
print(f"spatial Spearman r(Rabi NDVI trend, groundwater trend) = {r:+.2f} (naive p={p:.1e}; GRACE-footprint-adjusted p={p_adj:.2g}, n_eff≈{n_eff})", flush=True)

# --- figure: two maps + scatter ---
fig = plt.figure(figsize=(16, 6.6), dpi=160)
for k, (fld, sg, cm, vmax, ttl, lab, LO, LA) in enumerate([
        (tr, sig, viz.div_cmap("green"), 0.08, "Dry-season (Rabi) greening", "NDVI change per decade", lo, la),
        (gwi.values, None, viz.div_cmap("water"), 3.0, "Groundwater & surface-water trend", "cm of water per year", gwi.lon.values, gwi.lat.values)]):
    ax = fig.add_axes([0.01 + 0.33 * k, 0.12, 0.31, 0.72], projection=ccrs.PlateCarree())
    ax.set_extent(EXT, crs=ccrs.PlateCarree())
    dl = LO[1] - LO[0]
    e = [LO[0] - dl / 2, LO[-1] + dl / 2, LA[0] - dl / 2, LA[-1] + dl / 2]
    if sg is not None:
        ax.imshow(fld, origin="lower", extent=e, transform=ccrs.PlateCarree(), cmap=cm, vmin=-vmax, vmax=vmax, alpha=0.3)
        im = ax.imshow(np.where(sg, fld, np.nan), origin="lower", extent=e, transform=ccrs.PlateCarree(), cmap=cm, vmin=-vmax, vmax=vmax)
    else:
        lm = hub.land_mask()
        lmi = xr.DataArray(lm, dims=("lat", "lon"), coords={"lat": hub.LAT, "lon": hub.LON}).sel(lon=slice(EXT[0], EXT[1]), lat=slice(EXT[2], EXT[3])).values
        im = ax.imshow(np.where(lmi, fld, np.nan), origin="lower", extent=e, transform=ccrs.PlateCarree(), cmap=cm, vmin=-vmax, vmax=vmax)
    ax.add_feature(cfeature.COASTLINE.with_scale("50m"), linewidth=0.5, edgecolor=viz.INK2)
    ax.add_feature(cfeature.BORDERS.with_scale("50m"), linewidth=0.3, edgecolor=viz.MUTED)
    ax.set_title(ttl, fontsize=12)
    cax = fig.add_axes([0.04 + 0.33 * k, 0.07, 0.25, 0.02])
    cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both"); cb.outline.set_visible(False)
    cb.set_label(lab, fontsize=9, color=viz.INK2); cb.ax.tick_params(labelsize=8, length=0)
ax3 = fig.add_axes([0.70, 0.16, 0.28, 0.64])
ax3.scatter(tr05[ok], gwv[ok], s=9, color=viz.SERIES[0], alpha=0.55, edgecolor="none")
ax3.axhline(0, color=viz.AXIS, lw=0.8); ax3.axvline(0, color=viz.AXIS, lw=0.8)
for sp in ("top", "right"):
    ax3.spines[sp].set_visible(False)
ax3.grid(color=viz.GRID, lw=0.5); ax3.tick_params(length=0, labelsize=8)
ax3.set_xlabel("dry-season NDVI trend (per decade)", color=viz.INK2); ax3.set_ylabel("groundwater trend (cm/yr)", color=viz.INK2)
ax3.set_title(f"each dot = 0.5° cell in South Asia; Spearman r = {r:+.2f}", fontsize=10)
fig.text(0.01, 0.965, "Is India's greening paid for with groundwater?", fontsize=15, fontweight="bold", va="top")
fig.text(0.01, 0.915, "Winter-crop (Dec–Mar) greenness depends on irrigation, and most irrigation water is pumped from aquifers. "
         "Where fields greened most, aquifers emptied fastest.", fontsize=10, color=viz.INK2, va="top")
fig.text(0.01, 0.012, SRC, fontsize=7.5, color=viz.MUTED)
fig.savefig(f"{out}/india_green_vs_groundwater.png"); plt.close(fig)

# temporal: NW India Rabi NDVI vs groundwater (annual)
b = (72.0, 78.5, 26.0, 32.5)
m = (lo >= b[0]) & (lo <= b[1]); mm = (la >= b[2]) & (la <= b[3])
rabi_nw = pd.Series([np.nanmean(R[i][np.ix_(mm, m)]) for i in range(len(yrs))], index=yrs)
gws = pd.read_csv(ROOT + "/results/21_water_budget/groundwater_series_cm.csv", index_col=0, parse_dates=True)
g_nw = gws["NW India (Punjab-Haryana-Rajasthan)"]
g_ann = g_nw.groupby(g_nw.index.year).mean()
common = sorted(set(rabi_nw.index) & set(g_ann.index))
rt, pt = ss.pearsonr(rabi_nw.loc[common], g_ann.loc[common])
st_r = tl.series_trend(pd.Series(rabi_nw.values, index=pd.to_datetime([f"{y}-02-01" for y in yrs])), "NW India Rabi NDVI", "NDVI",
                       deseasonalize=False)
res = dict(spatial_spearman_r=float(r), spatial_p_naive=float(p), spatial_p_adjusted=float(p_adj), n_cells=int(ok.sum()),
           rabi_greening_frac=float(np.nanmean(sig & (tr > 0)) / np.nanmean(veg)),
           nw_india_rabi_ndvi_trend_per_decade=st_r["slope_per_decade"], nw_india_rabi_p=st_r["p_ols_ar1"],
           nw_india_temporal_r_rabi_vs_gw=float(rt), nw_india_temporal_p=float(pt))
print(res, flush=True)
tl.save_json(res, f"{out}/stats.json")
tl.runlog(TASK, "done", f"spatial r(NDVI rabi trend, GW trend) = {r:+.2f} (adj p={p_adj:.2g})")
tl.fix_perms()
print("done")
