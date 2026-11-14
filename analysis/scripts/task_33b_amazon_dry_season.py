"""Task 33b - The southern Amazon's dry season is getting drier and longer (three rain datasets + GRACE).

Box: southern Amazon / deforestation arc (70-50W, 15-5S), land only.
(1) Jul-Sep rain: GPCP 1979-2025, IMERG 2001-2025, MERRA-2 (gauge-corrected) 2001-2025.
(2) Dry-season length: months per year with rain < 100 mm (common Amazon definition), area-averaged.
(3) GRACE storage at the end of the dry season (Sep-Nov), 2002-2025.
Map: Jul-Sep rain trend over South America, GPCP 1979-2025 (OLS-AR1 & MK, FDR).
"""
import sys
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "33_seasonal_swing"
out = tl.task_dir(TASK)
BOX = (-70, -50, -15, -5)
lon, lat = hub.LON, hub.LAT
land = hub.land_mask()
lm = xr.DataArray(land, dims=("lat", "lon"), coords={"lat": lat, "lon": lon})
res = {}


def jas(da, y0):
    s = tl.area_mean(da.where(lm), BOX).to_series()
    s = s[s.index.month.isin([7, 8, 9])]
    g = s.groupby(s.index.year)
    a = g.mean()[g.count() == 3]
    return a[(a.index >= y0) & (a.index <= 2025)]


def dry_len(da, y0):
    sub = da.where(lm).sel(lon=slice(BOX[0], BOX[1]), lat=slice(BOX[2], BOX[3]))
    mm = sub * 30.4
    dry = (mm < 100).where(mm.notnull())
    wts = np.cos(np.deg2rad(sub.lat))
    frac = dry.weighted(wts).mean(("lat", "lon")).to_series()
    g = frac.groupby(frac.index.year)
    a = g.sum()[g.count() == 12]
    return a[(a.index >= y0) & (a.index <= 2025)]


def trend_of(a, name, units):
    st = tl.series_trend(pd.Series(a.values, index=pd.to_datetime([f"{y}-07-01" for y in a.index])), name, units, deseasonalize=False)
    return dict(slope_per_decade=st["slope_per_decade"], pct_per_decade=st["pct_per_decade"], p=st["p_ols_ar1"], mk_p=st["mk_annual_p"],
                ci=st["ci95_per_decade"])


DS = {"GPCP (1979–)": ("p_gpcp", 1979), "IMERG (2001–)": ("p_imerg", 2001), "MERRA-2 gauge-corrected (2001–)": ("p_m2land", 2001)}
series, dlen = {}, {}
for nm, (key, y0) in DS.items():
    da = hub.load(key)
    series[nm] = jas(da, y0)
    dlen[nm] = dry_len(da, y0)
    res[nm] = dict(jas=trend_of(series[nm], nm, "mm/day"), dry_months=trend_of(dlen[nm], nm, "months"),
                   dry_months_early=float(dlen[nm].loc[:2000].mean()) if y0 < 2000 else float(dlen[nm].loc[2001:2012].mean()),
                   dry_months_late=float(dlen[nm].loc[2014:].mean()))
    print(nm, {k: (round(v['pct_per_decade'], 1), round(v['slope_per_decade'], 2), round(v['p'], 4)) for k, v in res[nm].items() if isinstance(v, dict)},
          f"dry months early {res[nm]['dry_months_early']:.2f} late {res[nm]['dry_months_late']:.2f}", flush=True)
# GRACE end-of-dry-season storage (Sep-Nov mean)
tws = hub.load("tws")
s = tl.area_mean(tws.where(lm), BOX).to_series()
son = s[s.index.month.isin([9, 10, 11])]
g = son.groupby(son.index.year)
grace = g.mean()[g.count() >= 2]
grace = grace[grace.index <= 2025]
res["GRACE_SON"] = trend_of(grace, "GRACE", "cm")
res["GRACE_SON"]["min_year"] = int(grace.idxmin()); res["GRACE_SON"]["min_cm"] = float(grace.min())
print("GRACE Sep-Nov storage:", {k: round(v, 3) if isinstance(v, float) else v for k, v in res["GRACE_SON"].items()}, flush=True)
# map of JAS trend over South America (GPCP 1979-2025)
gp = hub.load("p_gpcp")
(P,), t = hub.align(gp, start="1979-01-01", end="2025-12-31")
a = P.values
J = np.stack([a[(t.year == y) & t.month.isin([7, 8, 9])].mean(0) for y in range(1979, 2026)])
yrs = np.arange(1979, 2026).astype(float)
r = tl.ols_ar1(J.reshape(len(yrs), -1), yrs, min_frac=0.8)
mk = tl.mk_grid(J.reshape(len(yrs), -1))
LON, LAT = np.meshgrid(lon, lat)
sa = (LON > -85) & (LON < -30) & (LAT > -40) & (LAT < 15) & land
mean = J.mean(0)
pct = r["slope"].reshape(land.shape) * 10 / mean * 100
okm = sa & (mean * 30.4 * 3 > 30)
p = np.where(okm.ravel(), np.fmax(r["p"], mk["p"]), np.nan)
sig = tl.fdr_mask(p, q=0.10).reshape(land.shape)

fig = plt.figure(figsize=(14, 8.4), dpi=170)
axm = fig.add_axes([0.02, 0.10, 0.42, 0.74], projection=ccrs.PlateCarree())
axm.set_extent([-82, -33, -35, 13], ccrs.PlateCarree())
cm = viz.div_cmap("water")
field = np.where(okm, pct, np.nan)
vmax = 25
axm.add_feature(cfeature.LAND.with_scale("50m"), facecolor="#e1e0d9", zorder=0)
axm.imshow(np.where(~sig, field, np.nan), origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(), cmap=cm,
           vmin=-vmax, vmax=vmax, alpha=0.30, interpolation="nearest", zorder=1)
im = axm.imshow(np.where(sig, field, np.nan), origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(), cmap=cm,
                vmin=-vmax, vmax=vmax, interpolation="nearest", zorder=2)
axm.add_feature(cfeature.COASTLINE.with_scale("50m"), linewidth=0.6, edgecolor=viz.INK2, zorder=3)
axm.add_feature(cfeature.BORDERS.with_scale("50m"), linewidth=0.3, edgecolor=viz.MUTED, zorder=3)
axm.plot([BOX[0], BOX[1], BOX[1], BOX[0], BOX[0]], [BOX[2], BOX[2], BOX[3], BOX[3], BOX[2]], color=viz.INK, lw=1.4,
         transform=ccrs.PlateCarree(), zorder=4)
axm.text(BOX[0] + 0.5, BOX[3] - 1.0, "southern\nAmazon", fontsize=9, color=viz.INK, va="top", zorder=5)
cax = fig.add_axes([0.07, 0.07, 0.32, 0.018])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=8, length=0)
cb.set_label("Jul–Sep rain trend, % per decade (GPCP 1979–2025; faded = not significant)", fontsize=8.5, color=viz.INK2)
cols = [viz.SERIES[0], viz.SERIES[1], viz.SERIES[2]]


def panel(rect, data, ylabel, base_years=(2001, 2025), pct_mode=True, ann=None):
    ax = fig.add_axes(rect)
    for (nm, a_), c in zip(data.items(), cols):
        b = a_.loc[base_years[0]:base_years[1]].mean()
        v = (a_ / b * 100) if pct_mode else a_
        ax.plot(a_.index, v.values, color=c, lw=1.8, marker="o", ms=3, label=nm)
    for sp in ("top", "right", "left"):
        ax.spines[sp].set_visible(False)
    ax.grid(axis="y", color=viz.GRID, lw=0.6); ax.tick_params(length=0, labelsize=8.5)
    ax.set_ylabel(ylabel, fontsize=9, color=viz.INK2)
    if ann:
        ax.text(0.0, 1.02, ann, transform=ax.transAxes, fontsize=9, color=viz.INK, va="bottom")
    return ax


g0 = res["GPCP (1979–)"]; i0 = res["IMERG (2001–)"]; m0 = res["MERRA-2 gauge-corrected (2001–)"]
ax1 = panel([0.52, 0.62, 0.45, 0.22], series, "% of 2001–25 mean",
            ann=f"Jul–Sep rain: GPCP {g0['jas']['pct_per_decade']:+.0f}%/dec (p={g0['jas']['p']:.0e}), IMERG {i0['jas']['pct_per_decade']:+.0f}% "
                f"(p={i0['jas']['p']:.2f}), MERRA-2 {m0['jas']['pct_per_decade']:+.0f}% (p={m0['jas']['p']:.0e})")
ax1.set_ylim(bottom=15); ax1.legend(frameon=False, fontsize=8, loc="lower left", ncol=3)
ax2 = panel([0.52, 0.34, 0.45, 0.20], dlen, "months < 100 mm", pct_mode=False,
            ann=f"Dry-season length (days/decade): GPCP {g0['dry_months']['slope_per_decade']*30.4:+.0f} (p={g0['dry_months']['p']:.0e}), "
                f"IMERG {i0['dry_months']['slope_per_decade']*30.4:+.0f} (p={i0['dry_months']['p']:.0e}), MERRA-2 {m0['dry_months']['slope_per_decade']*30.4:+.0f} (p={m0['dry_months']['p']:.0e})")
ax3 = fig.add_axes([0.52, 0.08, 0.45, 0.18])
ga = grace - grace.mean()
ax3.bar(ga.index, ga.values, color=np.where(ga.values < 0, viz.ORANGE_ARM[2], viz.BLUE_ARM[2]), width=0.75)
for sp in ("top", "right", "left"):
    ax3.spines[sp].set_visible(False)
ax3.grid(axis="y", color=viz.GRID, lw=0.6); ax3.tick_params(length=0, labelsize=8.5); ax3.set_xlim(ax1.get_xlim())
ax3.set_ylabel("vs Sep–Nov mean (cm)", fontsize=9, color=viz.INK2)
ax3.text(0.0, 1.02, f"End-of-dry-season storage (GRACE, Sep–Nov): {res['GRACE_SON']['slope_per_decade']:+.1f} cm/decade "
         f"(p={res['GRACE_SON']['p']:.2f}, n.s.); {res['GRACE_SON']['min_year']} lowest", transform=ax3.transAxes, fontsize=9, color=viz.INK, va="bottom")
fig.text(0.02, 0.975, "The southern Amazon's dry season is getting drier and longer", fontsize=16, fontweight="bold", va="top")
fig.text(0.02, 0.93, "Three rain datasets (different satellite/model blends) agree on the trend in the forest's most vulnerable months, along the "
         "deforestation arc.\nLonger, drier dry seasons push the forest toward fire and tipping-point risk.", fontsize=10, color=viz.INK2, va="top")
fig.text(0.98, 0.008, "Data: GPCP v2.3, GPM IMERG V07, MERRA-2 PRECTOTLAND (gauge-corrected), GRACE/GRACE-FO JPL mascons. OLS with AR(1)-adjusted n.",
         fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/amazon_dry_season.png"); plt.close(fig)
pd.DataFrame(series).to_csv(f"{out}/amazon_jas_rain_mm_day.csv")
pd.DataFrame(dlen).to_csv(f"{out}/amazon_dry_months.csv")
grace.to_csv(f"{out}/amazon_grace_son_cm.csv")
res["map_frac_sa_sig_drying"] = float(np.mean(sig[okm] & (pct[okm] < 0)))
tl.save_json(res, f"{out}/amazon_stats.json")
tl.runlog("33b_amazon_dry_season", "done", f"JAS rain GPCP {g0['jas']['pct_per_decade']:+.1f}%/dec, IMERG {i0['jas']['pct_per_decade']:+.1f}, "
          f"MERRA-2 {m0['jas']['pct_per_decade']:+.1f}; GRACE SON {res['GRACE_SON']['slope_per_decade']:+.1f} cm/dec")
tl.fix_perms(out)
print("done")
