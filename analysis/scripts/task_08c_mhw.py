"""Task 08c - Marine heatwaves around Taiwan & East Asia (Hobday et al. 2016 definition), NOAA OISST daily 1982-2026.

MHW day: SST above the day-of-year 90th percentile (1983-2012 baseline, 11-day window) for >= 5 consecutive days.
(Gap-merging of <=2-day breaks is not applied - conservative.)
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import glob
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402

TASK = "08c_marine_heatwaves"
out = tl.task_dir(TASK)
SRC = "Data: NOAA OISST v2.1 daily 0.25° (via NOAA PSL OPeNDAP). MHW definition: Hobday et al. 2016, baseline 1983–2012."
D = ROOT + "/data/processed/oisst_daily_eastasia"
lat = np.load(f"{D}/lat.npy"); lon = np.load(f"{D}/lon.npy")
arrs, dates = [], []
for y in range(1982, 2027):
    f = f"{D}/sst_{y}.npy"
    try:
        a = np.load(f)
    except FileNotFoundError:
        print("missing year", y); continue
    arrs.append(a)
    dates.append(pd.date_range(f"{y}-01-01", periods=a.shape[0], freq="D"))
sst = np.concatenate(arrs).astype(np.float32)
dates = dates[0].append(dates[1:]) if len(dates) > 1 else dates[0]
T, ny, nx = sst.shape
print("daily", dates[0].date(), dates[-1].date(), sst.shape, flush=True)
doy = np.minimum(dates.dayofyear.values, 365)  # fold Dec 31 of leap years into 365
X = sst.reshape(T, -1)
ocean = np.isfinite(X).mean(0) > 0.9
# --- climatological 90th percentile threshold per doy (11-day window, 1983-2012) ---
base = (dates.year >= 1983) & (dates.year <= 2012)
thr = np.full((366, X.shape[1]), np.nan, np.float32)
idx_base = np.where(base)[0]
for d in range(1, 366):
    dd = (doy[idx_base] - d) % 365
    win = idx_base[(dd <= 5) | (dd >= 360)]
    sub = X[win][:, ocean]
    tmp = np.full(X.shape[1], np.nan, np.float32)
    tmp[ocean] = np.nanpercentile(sub, 90, axis=0)
    thr[d] = tmp
print("thresholds done", flush=True)
exc = X > thr[doy]
exc[:, ~ocean] = False
# run lengths: forward and backward consecutive counts
fw = np.zeros_like(exc, dtype=np.int16); bw = np.zeros_like(exc, dtype=np.int16)
c = np.zeros(X.shape[1], np.int16)
for t in range(T):
    c = np.where(exc[t], c + 1, 0).astype(np.int16); fw[t] = c
c = np.zeros(X.shape[1], np.int16)
for t in range(T - 1, -1, -1):
    c = np.where(exc[t], c + 1, 0).astype(np.int16); bw[t] = c
mhw = exc & ((fw + bw - 1) >= 5)
del fw, bw
years = dates.year.values
uy = np.unique(years)
full_years = [y for y in uy if (years == y).sum() >= 365]
days_per_year = np.stack([mhw[years == y].sum(0) for y in full_years]).astype(np.float32)  # (ny_years, npix)
days_per_year[:, ~ocean] = np.nan
yrs = np.array(full_years, float)
# per-pixel trend in MHW days per decade
ols = tl.ols_ar1(days_per_year, yrs, min_frac=0.9)
mk = tl.mk_grid(days_per_year)
sig = tl.fdr_mask(np.maximum(ols["p"], mk["p"]), 0.10)
tr = (ols["slope"] * 10).reshape(ny, nx)
sig = sig.reshape(ny, nx)
early = np.nanmean(days_per_year[(yrs >= 1982) & (yrs <= 1991)], 0).reshape(ny, nx)
late = np.nanmean(days_per_year[(yrs >= 2016) & (yrs <= 2025)], 0).reshape(ny, nx)
print(f"mean MHW days/yr 1982-91 {np.nanmean(early):.1f} -> 2016-25 {np.nanmean(late):.1f}", flush=True)

# --- maps ---
viz.trend_map(lon, lat, tr, sig, f"{out}/map_mhw_trend.png", "Marine heatwaves are becoming the norm around Taiwan",
              f"Trend in marine-heatwave days per year, {full_years[0]}–{full_years[-1]} (days per year, per decade)",
              "change in heatwave days per year, per decade", vmax=40, cmap="redblue", extent=(105, 150, 10, 45),
              proj="plate", source=SRC)
fig = plt.figure(figsize=(12, 5.6), dpi=180)
import cartopy.crs as ccrs, cartopy.feature as cfeature
from matplotlib.colors import LinearSegmentedColormap
seq = LinearSegmentedColormap.from_list("heat", ["#f0efec"] + viz.RED_ARM, N=256)
for i, (fld, ttl) in enumerate(((early, "1982–1991 average"), (late, "2016–2025 average"))):
    ax = fig.add_axes([0.03 + 0.48 * i, 0.15, 0.45, 0.70], projection=ccrs.PlateCarree())
    ax.set_extent((105, 150, 10, 45), crs=ccrs.PlateCarree())
    im = ax.imshow(fld, origin="lower", extent=[lon[0], lon[-1], lat[0], lat[-1]], transform=ccrs.PlateCarree(),
                   cmap=seq, vmin=0, vmax=150)
    ax.add_feature(cfeature.LAND.with_scale("50m"), facecolor="#d9d7cf", zorder=2)
    ax.add_feature(cfeature.COASTLINE.with_scale("50m"), linewidth=0.4, edgecolor=viz.INK2, zorder=3)
    ax.set_title(ttl, fontsize=12)
fig.text(0.03, 0.965, "Marine heatwave days per year: then and now", fontsize=15, fontweight="bold", va="top")
fig.text(0.03, 0.915, f"Average over the region: {np.nanmean(early):.0f} days/yr (1980s) → {np.nanmean(late):.0f} days/yr (last decade)",
         fontsize=10, color=viz.INK2, va="top")
cax = fig.add_axes([0.35, 0.08, 0.3, 0.025])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="max"); cb.outline.set_visible(False)
cb.set_label("marine heatwave days per year", fontsize=9, color=viz.INK2); cb.ax.tick_params(labelsize=8, length=0)
fig.text(0.03, 0.01, SRC, fontsize=7, color=viz.MUTED)
fig.savefig(f"{out}/before_after_mhw_days.png"); plt.close(fig)

# --- regional calendars & series ---
regs = {"Taiwan Strait": (118.5, 120.3, 22.5, 25.5), "Kuroshio east of Taiwan": (121.5, 124.0, 21.0, 26.0),
        "East China Sea": (122.0, 128.0, 26.0, 32.0), "Southern Taiwan / Kenting reefs": (120.3, 121.3, 21.5, 22.2),
        "South China Sea (north)": (110.0, 120.0, 15.0, 22.0)}
LON, LAT = np.meshgrid(lon, lat)
stats = {}
for r, b in regs.items():
    m = ((LON >= b[0]) & (LON <= b[1]) & (LAT >= b[2]) & (LAT <= b[3])).ravel() & ocean
    w = np.cos(np.deg2rad(LAT.ravel()[m]))
    frac = (mhw[:, m] * w).sum(1) / w.sum()  # fraction of region in MHW each day
    regional_mhw = frac >= 0.5  # majority of region in heatwave
    s = pd.Series(regional_mhw, index=dates)
    ann = s.groupby(s.index.year).sum().loc[full_years]
    st = tl.series_trend(pd.Series(ann.values.astype(float), index=pd.to_datetime([f"{y}-07-01" for y in ann.index])),
                         r, "days/yr", deseasonalize=False)
    st["days_1982_1991"] = float(ann.loc[1982:1991].mean()); st["days_2016_2025"] = float(ann.loc[2016:2025].mean())
    st["max_year"] = int(ann.idxmax()); st["max_days"] = int(ann.max())
    stats[r] = st
    print(f"{r:32s} {st['days_1982_1991']:.0f} -> {st['days_2016_2025']:.0f} days/yr; trend {st['slope_per_decade']:+.1f} d/yr/dec "
          f"p={st['p_ols_ar1']:.2g} MK={st['mk_hr_p']:.2g}; max {st['max_year']} ({st['max_days']} d)", flush=True)
    # calendar heatmap: year x day-of-year
    cal = np.full((len(full_years), 366), np.nan)
    for i, y in enumerate(full_years):
        v = s[s.index.year == y].values
        cal[i, :len(v)] = v
    cal = cal[:, :365]
    fig, ax = plt.subplots(figsize=(11, 6.2), dpi=180)
    fig.subplots_adjust(left=0.07, right=0.97, top=0.84, bottom=0.10)
    from matplotlib.colors import ListedColormap
    ax.imshow(cal, aspect="auto", cmap=ListedColormap(["#e1e0d9", "#d03b3b"]), vmin=0, vmax=1, interpolation="nearest",
              extent=[0.5, 365.5, full_years[-1] + 0.5, full_years[0] - 0.5])
    mstarts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
    ax.set_xticks(mstarts); ax.set_xticklabels(list("JFMAMJJASOND"))
    for sp in ax.spines.values():
        sp.set_visible(False)
    ax.tick_params(length=0)
    fig.text(0.07, 0.965, f"{r}: every marine-heatwave day since 1982", fontsize=14, fontweight="bold", va="top")
    fig.text(0.07, 0.915, f"Red = region in a marine heatwave. {st['days_1982_1991']:.0f} days/yr in 1982–91 → "
             f"{st['days_2016_2025']:.0f} days/yr in 2016–25 (trend {st['slope_per_decade']:+.0f} days/yr per decade, p={st['p_ols_ar1']:.1g}).",
             fontsize=9.5, color=viz.INK2, va="top")
    fig.text(0.97, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
    fig.savefig(f"{out}/calendar_{r.split(' /')[0].replace(' ', '_')}.png"); plt.close(fig)
tl.save_json(stats, f"{out}/stats.json")
np.save(f"{out}/mhw_days_per_year.npy", days_per_year.reshape(len(full_years), ny, nx))
tl.runlog(TASK, "done", f"MHW days/yr region mean {np.nanmean(early):.0f} -> {np.nanmean(late):.0f}; Taiwan Strait "
          f"{stats['Taiwan Strait']['days_1982_1991']:.0f} -> {stats['Taiwan Strait']['days_2016_2025']:.0f}")
tl.fix_perms()
print("done")
