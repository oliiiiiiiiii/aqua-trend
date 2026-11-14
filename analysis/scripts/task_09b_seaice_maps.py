"""Task 09b - Before/after sea-ice concentration maps + per-pixel ice-season trend (NSIDC G02135 GeoTIFFs)."""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import glob
import numpy as np
import pandas as pd
import tifffile
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from matplotlib.colors import LinearSegmentedColormap

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402

TASK = "09b_sea_ice_maps"
out = tl.task_dir(TASK)
SRC = "Data: NSIDC Sea Ice Index v4 (G02135) monthly concentration, 25 km. Analysis: per-pixel OLS+AR(1) & MK, FDR q=0.10."
R = ROOT + "/data/raw/nsidc_tif"
ICE = LinearSegmentedColormap.from_list("ice", ["#1c5cab", "#6da7ec", "#cde2fb", "#ffffff"], N=256)

GRIDS = {"N": dict(x0=-3850000, y0=5850000, proj=ccrs.Stereographic(central_latitude=90, central_longitude=-45, true_scale_latitude=70),
                   view=[-3.1e6, 3.1e6, -3.3e6, 3.3e6]),
         "S": dict(x0=-3950000, y0=4350000, proj=ccrs.Stereographic(central_latitude=-90, central_longitude=0, true_scale_latitude=-70),
                   view=[-3.95e6, 3.95e6, -3.95e6, 4.35e6])}


def load(H, mm):
    files = sorted(glob.glob(f"{R}/{H}_*{mm}_concentration_v4.0.tif"))
    yrs, arrs = [], []
    for f in files:
        y = int(f.split("_")[-3][:4])
        a = tifffile.imread(f).astype(np.float32)
        land = a >= 2530
        hole = a == 2510
        a[a > 1000] = np.nan
        a = a / 10.0  # percent
        if H == "N":
            a[hole] = 100.0  # pole hole is ice-covered
        yrs.append(y); arrs.append(a)
    return np.array(yrs), np.stack(arrs), land


def extent_xy(H, shape):
    g = GRIDS[H]
    ny, nx = shape
    return [g["x0"], g["x0"] + nx * 25000, g["y0"] - ny * 25000, g["y0"]]


def before_after(H, mm, label, early=(1979, 1988), late=(2017, 2026)):
    yrs, cube, land = load(H, mm)
    e = np.nanmean(cube[(yrs >= early[0]) & (yrs <= early[1])], axis=0)
    l_ = np.nanmean(cube[(yrs >= late[0]) & (yrs <= late[1])], axis=0)
    ext = extent_xy(H, e.shape)
    g = GRIDS[H]
    fig = plt.figure(figsize=(12, 6.6), dpi=180)
    for i, (fld, ttl) in enumerate(((e, f"{early[0]}–{early[1]} average"), (l_, f"{late[0]}–{late[1]} average"))):
        ax = fig.add_axes([0.02 + 0.49 * i, 0.10, 0.47, 0.74], projection=g["proj"])
        ax.set_facecolor("#0d366b")
        ax.imshow(np.where(land, np.nan, fld), extent=ext, transform=g["proj"], origin="upper", cmap=ICE, vmin=0, vmax=100)
        ax.contour(np.linspace(ext[0], ext[1], e.shape[1]), np.linspace(ext[3], ext[2], e.shape[0]),
                   np.where(land, np.nan, e), levels=[15], colors=["#eda100"], linewidths=1.4, transform=g["proj"])
        ax.add_feature(cfeature.LAND.with_scale("50m"), facecolor="#d9d7cf", zorder=2)
        ax.add_feature(cfeature.COASTLINE.with_scale("50m"), linewidth=0.4, edgecolor=viz.INK2, zorder=3)
        ax.set_extent(g["view"], crs=g["proj"])
        ax.set_title(ttl, fontsize=12, color=viz.INK)
    fig.text(0.02, 0.965, f"{label}: where the ice used to be", fontsize=15, fontweight="bold", va="top")
    fig.text(0.02, 0.915, "Sea-ice concentration (white = 100% ice, blue = open water). Yellow line = the 15% ice edge in "
             f"{early[0]}–{early[1]}, drawn on both maps.", fontsize=10, color=viz.INK2, va="top")
    fig.text(0.02, 0.02, SRC.split(" Analysis")[0], fontsize=8, color=viz.MUTED)
    fn = f"{out}/before_after_{H}_{mm}.png"
    fig.savefig(fn); plt.close(fig)
    # area lost (ice area within ocean pixels, km2)
    lost = (np.nansum(e) - np.nansum(l_)) / 100 * 625.0
    return fn, float(lost)


res = {}
for H, mm, label in (("N", "09", "Arctic in September"), ("S", "02", "Antarctic in February"), ("S", "09", "Antarctic in September")):
    fn, lost = before_after(H, mm, label)
    res[f"{H}_{mm}"] = dict(figure=fn, ice_area_lost_km2=lost)
    print(label, f"ice area lost ≈ {lost/1e6:.2f} million km²")

# per-pixel trend of September Arctic concentration
yrs, cube, land = load("N", "09")
times = pd.to_datetime([f"{y}-09-01" for y in yrs])
x = cube.reshape(len(yrs), -1)
ols = tl.ols_ar1(x - np.nanmean(x, 0), yrs.astype(float), min_frac=0.7)
mk = tl.mk_grid(x)
p = np.where(np.isfinite(ols["p"]) & np.isfinite(mk["p"]), np.maximum(ols["p"], mk["p"]), np.nan)
sig = tl.fdr_mask(p, 0.10).reshape(cube.shape[1:])
tr = (ols["slope"] * 10).reshape(cube.shape[1:])
active = np.nanmax(cube, axis=0) > 15
tr = np.where(active & ~land, tr, np.nan)
g = GRIDS["N"]; ext = extent_xy("N", tr.shape)
fig = plt.figure(figsize=(8, 8.4), dpi=180)
ax = fig.add_axes([0.03, 0.12, 0.94, 0.74], projection=g["proj"])
cm = viz.div_cmap("redblue").reversed()
ax.imshow(tr, extent=ext, transform=g["proj"], origin="upper", cmap=cm, vmin=-25, vmax=25, alpha=0.3)
im = ax.imshow(np.where(sig, tr, np.nan), extent=ext, transform=g["proj"], origin="upper", cmap=cm, vmin=-25, vmax=25)
ax.add_feature(cfeature.LAND.with_scale("50m"), facecolor="#e9e8e3", zorder=2)
ax.add_feature(cfeature.COASTLINE.with_scale("50m"), linewidth=0.4, edgecolor=viz.INK2, zorder=3)
ax.set_extent(g["view"], crs=g["proj"])
fig.text(0.03, 0.965, "September Arctic sea-ice concentration trend", fontsize=14, fontweight="bold", va="top")
fig.text(0.03, 0.925, f"{yrs[0]}–{yrs[-1]}, percentage points of ice cover per decade (red = losing ice). Faded = not significant.",
         fontsize=9, color=viz.INK2, va="top")
cax = fig.add_axes([0.25, 0.07, 0.5, 0.02])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both"); cb.outline.set_visible(False)
cb.set_label("ice concentration change (%-points per decade)", fontsize=9, color=viz.INK2); cb.ax.tick_params(labelsize=8, length=0)
fig.text(0.03, 0.012, SRC, fontsize=7, color=viz.MUTED)
fig.savefig(f"{out}/trend_map_arctic_september.png"); plt.close(fig)
res["arctic_sept_sig_fraction_of_active"] = float(np.nansum(sig & np.isfinite(tr)) / np.sum(np.isfinite(tr)))
tl.save_json(res, f"{out}/stats.json")
tl.runlog(TASK, "done", f"Arctic Sept ice area lost {res['N_09']['ice_area_lost_km2']/1e6:.2f} Mkm2 (1979-88 vs 2017-26)")
tl.fix_perms()
print("done", res)
