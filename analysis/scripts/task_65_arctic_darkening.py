"""Task 65 - Arctic darkening: as summer sea ice disappears, the Arctic Ocean absorbs more sunlight (the ice-albedo feedback, measured).

Data: NSIDC Sea Ice Index v4 monthly concentration GeoTIFFs (25 km polar stereographic, Jun-Aug 2001-2025);
NASA CERES EBAF Ed4.2.1 TOA fluxes (absorbed solar = incoming - reflected; clear-sky and all-sky).
Method: per year, Jun-Aug (JJA) mean ice concentration per 25-km pixel -> averaged into CERES 1-deg cells north of 60N (ocean pixels only;
the satellite pole hole is set to 100% ice). For every cell, regression across years of JJA absorbed sunlight on JJA ice concentration
(clear-sky = surface effect; all-sky = what the planet actually gains, after clouds). Arctic-wide: JJA absorbed sunlight over cells with
any summer ice vs total JJA ice area. Trends 2001-2025 (Theil-Sen + Hamed-Rao MK).
"""
import sys
import glob
import textwrap
import numpy as np
import pandas as pd
import netCDF4
import tifffile
import pyproj
from scipy import stats
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.path as mpath
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402

TASK = "65_arctic_darkening"
out = tl.task_dir(TASK)
SRC = "Data: NSIDC Sea Ice Index v4 (25 km concentration); NASA CERES EBAF Ed4.2.1 top-of-atmosphere fluxes."
YRS = np.arange(2001, 2026)
# ---------------------------------------------------------------- ice concentration -> lat/lon
P = pyproj.CRS.from_proj4("+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +a=6378273 +b=6356889.449 +units=m +no_defs")
tr = pyproj.Transformer.from_crs(P, "EPSG:4326", always_xy=True)
jj, ii = np.meshgrid(np.arange(304), np.arange(448))
X = -3850000 + 12500 + 25000 * jj; Yp = 5850000 - 12500 - 25000 * ii
plon, plat = tr.transform(X, Yp)
ICE = np.full((len(YRS), 448, 304), np.nan, np.float32)
ocean = None
for k, y in enumerate(YRS):
    ms = []
    for m in ("06", "07", "08"):
        a = tifffile.imread(f"{ROOT}/data/raw/nsidc_tif/N_{y}{m}_concentration_v4.0.tif").astype(np.float32)
        c = np.where(a <= 1000, a / 10.0, np.nan)
        c = np.where(a == 2510, 100.0, c)            # pole hole -> 100% ice
        ms.append(c)
        if ocean is None:
            ocean = (a <= 1000) | (a == 2510)
    ICE[k] = np.nanmean(np.stack(ms), 0)
area_km2 = 625.0
ice_area = pd.Series([np.nansum(np.where(ocean, ICE[k], 0) / 100 * area_km2) / 1e6 for k in range(len(YRS))], YRS)   # million km2 (JJA mean)
# ---------------------------------------------------------------- CERES
Z = np.load(f"{ROOT}/data/processed/ceres/ebaf_sw.npz")
t = pd.DatetimeIndex([pd.Timestamp(str(d)[:10]) for d in netCDF4.num2date(Z["time"], str(Z["time_units"]))]).to_period("M").to_timestamp()
lat = Z["lat"]; lon = np.where(Z["lon"] > 180, Z["lon"] - 360, Z["lon"]); order = np.argsort(lon); lon = lon[order]
sol, swc, swa = (Z[k][:, :, order] for k in ("solar_mon", "toa_sw_clr_t_mon", "toa_sw_all_mon"))
asr_c = sol - swc; asr_a = sol - swa
jja = t.month.isin([6, 7, 8])
AC = np.stack([np.nanmean(asr_c[jja & (t.year == y)], 0) for y in YRS]); AA = np.stack([np.nanmean(asr_a[jja & (t.year == y)], 0) for y in YRS])
la = lat >= 60
# ice concentration averaged into CERES cells
ci = np.clip(((plat + 90)).astype(int), 0, 179); cj = np.clip(((plon + 180)).astype(int), 0, 359)
ICEc = np.full((len(YRS), 180, 360), np.nan, np.float32)
cnt = np.zeros((180, 360)); np.add.at(cnt, (ci[ocean], cj[ocean]), 1)
for k in range(len(YRS)):
    s = np.zeros((180, 360)); v = np.where(ocean, np.nan_to_num(ICE[k]), 0)
    np.add.at(s, (ci[ocean], cj[ocean]), v[ocean])
    with np.errstate(all="ignore"):
        ICEc[k] = np.where(cnt >= 3, s / np.maximum(cnt, 1), np.nan)
# per-cell regression across years (cells that had >=15% JJA ice in some year and change by >=10 points)
res = {}
rng_ice = np.nanmax(ICEc, 0) - np.nanmin(ICEc, 0)
cells = la[:, None] & (np.nanmax(ICEc, 0) >= 15) & (rng_ice >= 10)
sens_c = np.full((180, 360), np.nan); sens_a = np.full((180, 360), np.nan); rc = np.full((180, 360), np.nan)
for i_, j_ in zip(*np.where(cells)):
    x = ICEc[:, i_, j_]; yc = AC[:, i_, j_]; ya = AA[:, i_, j_]
    ok = np.isfinite(x) & np.isfinite(yc) & np.isfinite(ya)
    if ok.sum() < 15:
        continue
    sc = np.polyfit(x[ok], yc[ok], 1)[0]; sa = np.polyfit(x[ok], ya[ok], 1)[0]
    sens_c[i_, j_] = -sc * 10; sens_a[i_, j_] = -sa * 10                  # W m-2 gained per 10 points of ice lost
    rc[i_, j_] = np.corrcoef(x[ok], yc[ok])[0, 1]
w = np.cos(np.deg2rad(lat))[:, None] * np.ones(360)[None]
okc = np.isfinite(sens_c)
res["cells"] = int(okc.sum())
res["median_sens_clear_W_per_10pct"] = float(np.nanmedian(sens_c)); res["median_sens_allsky_W_per_10pct"] = float(np.nanmedian(sens_a))
res["frac_cells_negative_r"] = float(np.mean(rc[okc] < 0)); res["median_r_clear"] = float(np.nanmedian(rc))
res["cloud_masking_fraction"] = float(1 - np.nanmedian(sens_a) / np.nanmedian(sens_c))
# Arctic-wide series over cells with summer ice
ever = la[:, None] & (np.nanmax(ICEc, 0) >= 15)
wa = w * ever
asr_c_ser = pd.Series([np.nansum(np.nan_to_num(AC[k]) * wa) / np.sum(wa * np.isfinite(AC[k])) for k in range(len(YRS))], YRS)
asr_a_ser = pd.Series([np.nansum(np.nan_to_num(AA[k]) * wa) / np.sum(wa * np.isfinite(AA[k])) for k in range(len(YRS))], YRS)
for nm, s_ in (("ice_area_Mkm2", ice_area), ("asr_clear", asr_c_ser), ("asr_allsky", asr_a_ser)):
    mk = tl._mk_hr(s_.values)
    res[f"{nm}_trend_per_decade"] = float(mk["sen"] * 10); res[f"{nm}_p"] = float(mk["p"])
    res[f"{nm}_2001_05"] = float(s_.loc[2001:2005].mean()); res[f"{nm}_2021_25"] = float(s_.loc[2021:2025].mean())
for nm, s_ in (("clear", asr_c_ser), ("allsky", asr_a_ser)):
    sl, ic, r, pp, se = stats.linregress(ice_area.values, s_.values)
    dd = lambda v: v - np.polyval(np.polyfit(YRS - YRS.mean(), v, 1), YRS - YRS.mean())  # noqa: E731
    sld, _, rd, pd_, _ = stats.linregress(dd(ice_area.values), dd(s_.values))
    res[f"arctic_{nm}_W_per_Mkm2"] = float(-sl); res[f"arctic_{nm}_r"] = float(r); res[f"arctic_{nm}_p"] = float(pp)
    res[f"arctic_{nm}_W_per_Mkm2_detrended"] = float(-sld); res[f"arctic_{nm}_r_detrended"] = float(rd); res[f"arctic_{nm}_p_detrended"] = float(pd_)
print(res, flush=True)
tl.save_json(res, f"{out}/stats.json")
pd.DataFrame({"jja_ice_area_Mkm2": ice_area, "jja_asr_clear": asr_c_ser, "jja_asr_allsky": asr_a_ser}).round(3).to_csv(f"{out}/arctic_jja_series.csv")
# trends maps
o = tl.ols_ar1(ICEc, YRS.astype(float), min_frac=0.8); ice_tr = o["slope"] * 10
sen_asr = tl.sen_grid(AC, YRS.astype(float)) * 10

# ---------------------------------------------------------------- figure
fig = plt.figure(figsize=(14, 8.8), dpi=170)
proj = ccrs.NorthPolarStereo(central_longitude=-45)
theta = np.linspace(0, 2 * np.pi, 100); circle = mpath.Path(np.vstack([np.sin(theta), np.cos(theta)]).T * 0.5 + 0.5)


def _set_polar(a):
    r_ = abs(proj.transform_point(-45, 62, ccrs.PlateCarree())[1])
    a.set_xlim(-r_, r_); a.set_ylim(-r_, r_)
    a.set_boundary(circle, transform=a.transAxes)


def polar(rect, title):
    a = fig.add_axes(rect, projection=proj)
    _set_polar(a)
    a.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", zorder=2); a.coastlines(lw=0.3, color=viz.INK2, zorder=3)
    a.set_title(title, fontsize=9.5, loc="left", fontweight="bold")
    return a


m1 = polar([0.01, 0.46, 0.25, 0.37], "A  Summer sea ice, trend 2001–25")
lon_e = np.append(lon - 0.5, 180.0); lat_e = np.append(lat - 0.5, 90.0)
im1 = m1.pcolormesh(lon_e, lat_e, np.where(la[:, None], ice_tr, np.nan), cmap=viz.div_cmap("redblue").reversed(), vmin=-20, vmax=20, transform=ccrs.PlateCarree(), shading="flat", rasterized=True)
_set_polar(m1)
c1 = fig.add_axes([0.04, 0.44, 0.19, 0.011]); cb = fig.colorbar(im1, cax=c1, orientation="horizontal"); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7, length=0)
cb.set_label("ice concentration, points per decade", fontsize=7.5, color=viz.INK2)
m2 = polar([0.27, 0.46, 0.25, 0.37], "B  Summer sunlight absorbed (clear-sky)")
im2 = m2.pcolormesh(lon_e, lat_e, np.where(la[:, None], sen_asr, np.nan), cmap=viz.div_cmap("redblue"), vmin=-20, vmax=20, transform=ccrs.PlateCarree(), shading="flat", rasterized=True)
_set_polar(m2)
c2 = fig.add_axes([0.30, 0.44, 0.19, 0.011]); cb = fig.colorbar(im2, cax=c2, orientation="horizontal"); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7, length=0)
cb.set_label("W m⁻² per decade", fontsize=7.5, color=viz.INK2)
# C: scatter
ax = fig.add_axes([0.58, 0.50, 0.40, 0.32])
ax.scatter(ice_area, asr_c_ser, c=YRS, cmap="Blues", s=40, edgecolors=viz.INK, linewidths=0.4, label="clear-sky (surface effect)", zorder=3)
ax.scatter(ice_area, asr_a_ser, c=YRS, cmap="Oranges", s=40, marker="s", edgecolors=viz.INK, linewidths=0.4, label="all-sky (after clouds)", zorder=3)
for y in (2001, 2012, 2020, 2025):
    ax.annotate(str(y), (ice_area[y], asr_c_ser[y]), xytext=(4, 3), textcoords="offset points", fontsize=7.5, color=viz.INK)
for s_, col in ((asr_c_ser, viz.BLUE_ARM[2]), (asr_a_ser, viz.ORANGE_ARM[2])):
    bb = np.polyfit(ice_area, s_, 1); xx = np.linspace(ice_area.min(), ice_area.max(), 5); ax.plot(xx, np.polyval(bb, xx), color=col, lw=1.2)
ax.legend(frameon=False, fontsize=8, loc="upper right")
ax.set_xlabel("June–August sea-ice area (million km²)", fontsize=8.5, color=viz.INK2); ax.set_ylabel("June–August sunlight absorbed (W m⁻²)", fontsize=8.5, color=viz.INK2)
ax.set_title("C  Less ice, more sunlight absorbed (Arctic cells with summer ice)", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right"):
    ax.spines[sp_].set_visible(False)
ax.grid(color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
# D: per-cell sensitivity histogram + series
ax2 = fig.add_axes([0.06, 0.08, 0.38, 0.26])
ax2.hist(sens_c[okc], bins=40, range=(-10, 30), color=viz.BLUE_ARM[3], alpha=0.9, label="clear-sky")
ax2.hist(sens_a[okc], bins=40, range=(-10, 30), color=viz.ORANGE_ARM[2], alpha=0.6, label="all-sky")
ax2.axvline(0, color=viz.INK, lw=0.8)
ax2.set_xlabel("extra sunlight absorbed per 10 points of summer ice lost (W m⁻²), each 1° cell", fontsize=8.3, color=viz.INK2)
ax2.legend(frameon=False, fontsize=8)
ax2.set_title(f"D  Ice-albedo feedback strength in {res['cells']} cells", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax2.spines[sp_].set_visible(False)
ax2.tick_params(length=0, labelsize=8)
ax3 = fig.add_axes([0.56, 0.08, 0.40, 0.26])
ax3.plot(YRS, ice_area, "o-", color=viz.BLUE_ARM[1], ms=3, lw=1.6)
ax3.set_ylabel("JJA ice area (M km²)", fontsize=8.3, color=viz.INK2)
ax3.set_title("E  Summer sea-ice area (the cause)", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax3.spines[sp_].set_visible(False)
ax3.grid(axis="y", color=viz.GRID, lw=0.5); ax3.tick_params(length=0, labelsize=8)
fig.text(0.01, 0.975, "Arctic darkening: as summer sea ice vanishes, the ocean beneath soaks up more sunlight", fontsize=15, fontweight="bold", va="top")
subt = (f"Summer (June–August) Arctic sea-ice area fell {abs(res['ice_area_Mkm2_trend_per_decade']):.2f} million km² per decade (p = {res['ice_area_Mkm2_p']:.0e}). "
        f"Across years, every million km² of ice lost lets the ice-covered Arctic absorb {res['arctic_clear_W_per_Mkm2']:.1f} W m⁻² more sunlight under clear skies "
        f"(r = {res['arctic_clear_r']:+.2f}; {res['arctic_clear_W_per_Mkm2_detrended']:.1f} W m⁻² after removing trends) and {res['arctic_allsky_W_per_Mkm2']:.1f} W m⁻² after clouds. "
        f"Cell by cell, losing 10 points of ice concentration adds a median {res['median_sens_clear_W_per_10pct']:.1f} W m⁻² of absorbed sunlight (clear-sky); clouds hide about "
        f"{100 * res['cloud_masking_fraction']:.0f}% of it. This is the ice-albedo feedback, measured from space: dark water absorbs, warms and melts more ice.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/arctic_darkening.png"); plt.close(fig)
tl.runlog(TASK, "done", f"{res['arctic_clear_W_per_Mkm2']:.1f} W/m2 per Mkm2 (clear), {res['arctic_allsky_W_per_Mkm2']:.1f} (all-sky); cloud masking {100 * res['cloud_masking_fraction']:.0f}%")
tl.fix_perms(out)
print("done")
