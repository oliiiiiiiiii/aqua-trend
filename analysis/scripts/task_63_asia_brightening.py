"""Task 63 - Clearing skies over East Asia: CERES sees less sunlight bounced back to space and more reaching the ground as haze fell.

Data: NASA CERES EBAF Ed4.2.1 monthly (2000-03..2026-07, 1 deg): TOA clear-sky reflected shortwave (toa_sw_clr_t; measured by the CERES
radiometers, clear-sky = cloud-free scenes of each region), surface clear-sky downward shortwave (sfc_sw_down_clr_t; radiative-transfer
computed with MODIS-constrained aerosols) and all-sky surface downward shortwave (sfc_sw_down_all; includes cloud changes).
MERRA-2 total AOD (M2TMNXAER).
Method: 2005-2025 trends per 1-deg cell (Theil-Sen on annual means; p = max(AR(1)-OLS, Mann-Kendall); FDR q=0.10) over 60-150E, 0-55N;
regional annual series for eastern China and the Indo-Gangetic plain; regression of CERES clear-sky TOA reflection on MERRA-2 AOD
(detrended and raw) to estimate the aerosol 'mirror' strength (W m-2 per unit AOD).
"""
import sys
import textwrap
import numpy as np
import pandas as pd
import netCDF4
from scipy import stats
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

TASK = "63_asia_brightening"
out = tl.task_dir(TASK)
SRC = "Data: NASA CERES EBAF Ed4.2.1 (TOA clear-sky reflected SW; computed surface SW); NASA MERRA-2 aerosol optical depth."
Z = np.load(f"{ROOT}/data/processed/ceres/ebaf_sw.npz")
t = pd.DatetimeIndex([pd.Timestamp(str(d)[:10]) for d in netCDF4.num2date(Z["time"], str(Z["time_units"]))]).to_period("M").to_timestamp()
lat = Z["lat"]; lon = np.where(Z["lon"] > 180, Z["lon"] - 360, Z["lon"])
order = np.argsort(lon); lon = lon[order]
V = {k: Z[k][:, :, order] for k in ("toa_sw_clr_t_mon", "sfc_sw_down_clr_t_mon", "sfc_sw_down_all_mon")}
YRS = np.arange(2005, 2026)


def annual(a):
    return np.stack([np.nanmean(a[t.year == y], 0) for y in YRS])


la = (lat >= 0) & (lat <= 55); lo = (lon >= 60) & (lon <= 150)
res, maps = {}, {}
for k, A in V.items():
    an = annual(A[:, la][:, :, lo])
    o = tl.ols_ar1(an, YRS.astype(float), min_frac=0.8); mk = tl.mk_grid(an); sen = tl.sen_grid(an, YRS.astype(float))
    p = np.maximum(np.nan_to_num(o["p"], nan=1.0), mk["p"])
    maps[k] = (sen * 10, tl.fdr_mask(p, 0.10))
# MERRA-2 AOD on CERES grid via hub regrid -> block to 1 deg
t_a, tot = hub._gd("m2aer", "TOTEXTTAU", "native")
tot1 = hub._merra_to_hub(tot)  # 0.5 deg hub grid
with np.errstate(all="ignore"):
    import warnings
    warnings.simplefilter("ignore")
    tot1 = np.nanmean(tot1.reshape(len(t_a), 180, 2, 360, 2), axis=(2, 4))      # 1 deg, lat -89.5..89.5, lon -179.5..179.5
REG = {"Eastern China": (110, 122, 28, 40), "Indo-Gangetic Plain": (75, 88, 22, 30), "Korea & Japan": (126, 141, 33, 38)}
LAc, LOc = np.meshgrid(lat, lon, indexing="ij")


def box(A, tt, b):
    m = (LOc >= b[0]) & (LOc <= b[1]) & (LAc >= b[2]) & (LAc <= b[3]); w = np.cos(np.deg2rad(LAc)) * m
    s = pd.Series([np.nansum(np.nan_to_num(x) * w) / np.sum(w * np.isfinite(x)) for x in A], tt)
    return s.groupby(s.index.year).mean().reindex(YRS)


ser = {}
for nm, b in REG.items():
    sw = box(V["toa_sw_clr_t_mon"], t, b); sf = box(V["sfc_sw_down_clr_t_mon"], t, b); sa = box(V["sfc_sw_down_all_mon"], t, b)
    ao = box(tot1, t_a, b)
    d = {}
    for lab, s_ in (("toa_clr", sw), ("sfc_clr", sf), ("sfc_all", sa), ("aod", ao)):
        mk = tl._mk_hr(s_.values)
        d[f"{lab}_trend_per_dec"] = float(mk["sen"] * 10); d[f"{lab}_p"] = float(mk["p"])
    sl, ic, r, pp, se = stats.linregress(ao.values, sw.values)
    dd = lambda v: v - np.polyval(np.polyfit(YRS - YRS.mean(), v, 1), YRS - YRS.mean())  # noqa: E731
    sld, _, rd, pd_, _ = stats.linregress(dd(ao.values), dd(sw.values))
    sl2, _, r2, p2, _ = stats.linregress(ao.values, sf.values)
    d.update(toa_vs_aod_slope=float(sl), toa_vs_aod_r=float(r), toa_vs_aod_p=float(pp), toa_vs_aod_slope_detrended=float(sld), toa_vs_aod_r_detrended=float(rd),
             toa_vs_aod_p_detrended=float(pd_), sfc_vs_aod_slope=float(sl2), sfc_vs_aod_r=float(r2),
             aod_2005_07=float(ao.loc[2005:2007].mean()), aod_2023_25=float(ao.loc[2023:2025].mean()))
    res[nm] = d; ser[nm] = dict(toa=sw, sfc=sf, all=sa, aod=ao)
    print(nm, {k: round(v, 3) for k, v in d.items()}, flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.8), dpi=170)
proj = ccrs.PlateCarree()
lat_s, lon_s = lat[la], lon[lo]
for k, (key, title, vm, cmname) in enumerate((("toa_sw_clr_t_mon", "A  Sunlight reflected by cloud-free skies (measured)", 6, "redblue"),
                                                ("sfc_sw_down_clr_t_mon", "B  Clear-sky sunlight at the ground (computed)", 12, "redblue"))):
    ax = fig.add_axes([0.01 + k * 0.33, 0.47, 0.31, 0.36], projection=proj)
    ax.set_extent([60, 150, 0, 55], proj)
    tr, sg = maps[key]
    cm = viz.div_cmap("redblue")
    im = ax.pcolormesh(lon_s, lat_s, tr, cmap=cm, vmin=-vm, vmax=vm, transform=proj, shading="auto", rasterized=True)
    ax.contourf(lon_s, lat_s, np.where(sg, 1.0, np.nan), levels=[0.5, 1.5], colors="none", hatches=["...."], transform=proj)
    ax.add_feature(cfeature.COASTLINE.with_scale("50m"), lw=0.4, color=viz.INK2); ax.add_feature(cfeature.BORDERS.with_scale("50m"), lw=0.25, color=viz.MUTED)
    for nm, b in REG.items():
        ax.plot([b[0], b[1], b[1], b[0], b[0]], [b[2], b[2], b[3], b[3], b[2]], color=viz.INK, lw=0.8, transform=proj)
    ax.set_title(title, fontsize=9.3, loc="left", fontweight="bold")
    cax = fig.add_axes([0.04 + k * 0.33, 0.445, 0.25, 0.012]); cb = fig.colorbar(im, cax=cax, orientation="horizontal"); cb.outline.set_visible(False)
    cb.ax.tick_params(labelsize=7, length=0); cb.set_label("trend 2005–2025, W m⁻² per decade (dots: FDR-significant)", fontsize=7.5, color=viz.INK2)
# C: scatter AOD vs TOA clear-sky SW, eastern China and IGP
ax = fig.add_axes([0.71, 0.50, 0.27, 0.32])
for nm, col in (("Eastern China", viz.SERIES[0]), ("Indo-Gangetic Plain", viz.SERIES[1])):
    s_ = ser[nm]
    ax.scatter(s_["aod"], s_["toa"], color=col, s=26, edgecolors=viz.SURFACE, label=f"{nm} (r = {res[nm]['toa_vs_aod_r']:+.2f})")
    for y in ((2005, 2013, 2025) if nm == "Eastern China" else ()):
        ax.annotate(str(y), (s_["aod"][y], s_["toa"][y]), xytext=(3, 3), textcoords="offset points", fontsize=7, color=viz.INK2)
    bb = np.polyfit(s_["aod"].values, s_["toa"].values, 1); xx = np.linspace(s_["aod"].min(), s_["aod"].max(), 5)
    ax.plot(xx, np.polyval(bb, xx), color=col, lw=1)
ax.legend(frameon=False, fontsize=7.6, loc="lower right")
ax.set_xlabel("aerosol optical depth (MERRA-2, annual)", fontsize=8.5, color=viz.INK2); ax.set_ylabel("clear-sky reflected sunlight (W m⁻²)", fontsize=8.5, color=viz.INK2)
ax.set_title("C  Hazier year, brighter Earth from space", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right"):
    ax.spines[sp_].set_visible(False)
ax.grid(color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=7.5)
# D: eastern China series (small multiples sharing x)
names = [("aod", "aerosol optical depth (MERRA-2)", viz.INK2), ("toa", "clear-sky reflected to space (W m⁻²)", viz.SERIES[0]),
         ("sfc", "clear-sky sunlight at the ground (W m⁻²)", viz.SERIES[3]), ("all", "all-sky sunlight at the ground (W m⁻²)", viz.SERIES[2])]
EC = ser["Eastern China"]
for k, (key, lab, col) in enumerate(names):
    a = fig.add_axes([0.06 + k * 0.235, 0.07, 0.20, 0.20])
    s_ = EC[key]
    a.plot(s_.index, s_.values, "o-", color=col, ms=3, lw=1.6)
    r_ = res["Eastern China"]; tk = {"aod": "aod", "toa": "toa_clr", "sfc": "sfc_clr", "all": "sfc_all"}[key]
    pv = r_[tk + '_p']
    a.set_title(f"{lab}\n{r_[tk + '_trend_per_dec']:+.2f} per decade (p {'< 0.001' if pv < 0.001 else '= ' + format(pv, '.3f')})", fontsize=8.2, loc="left", fontweight="bold")
    for sp_ in ("top", "right", "left"):
        a.spines[sp_].set_visible(False)
    a.grid(axis="y", color=viz.GRID, lw=0.5); a.tick_params(length=0, labelsize=7)
    a.set_xticks([2005, 2010, 2015, 2020, 2025])
fig.text(0.06, 0.355, "D  Eastern China (110–122°E, 28–40°N), annual means  (map A also shows snow-cover changes over Siberia and Tibet, which alter surface brightness)", fontsize=10, fontweight="bold")
E = res["Eastern China"]; I = res["Indo-Gangetic Plain"]
fig.text(0.01, 0.975, "Clearing skies over East Asia: space sees less sunlight bounced back, the ground gets more, as haze falls", fontsize=15, fontweight="bold", va="top")
subt = (f"Aerosol particles act as a mirror. Over eastern China, haze (aerosol optical depth) fell from {E['aod_2005_07']:.2f} to {E['aod_2023_25']:.2f} and the CERES radiometers "
        f"measured cloud-free skies reflecting {abs(E['toa_clr_trend_per_dec']):.1f} W m⁻² less sunlight per decade (p = {E['toa_clr_p']:.0e}); year to year the reflection tracks the haze "
        f"(r = {E['toa_vs_aod_r']:+.2f}, still {E['toa_vs_aod_r_detrended']:+.2f} after detrending), about {E['toa_vs_aod_slope']:.0f} W m⁻² per unit of optical depth. Clear-sky sunlight "
        f"at the ground rose {E['sfc_clr_trend_per_dec']:+.1f} W m⁻² per decade. Over the Indo-Gangetic plain, where haze grew, the ground dimmed ({I['sfc_all_trend_per_dec']:+.1f} W m⁻² "
        f"per decade, all-sky) yet space barely sees it (r = {I['toa_vs_aod_r']:+.2f}), consistent with soot-rich haze that absorbs sunlight rather than reflecting it. "
        f"Removing the aerosol 'sunscreen' cleans the air but adds to warming.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/asia_brightening.png"); plt.close(fig)
tl.runlog(TASK, "done", f"E China TOA clear-sky SW {E['toa_clr_trend_per_dec']:+.2f} W/m2/dec (r with AOD {E['toa_vs_aod_r']:+.2f}); IGP {I['toa_clr_trend_per_dec']:+.2f}")
tl.fix_perms(out)
print("done")
