"""Task 23b - Independent check of the GERD storage gain: does a new lake appear in MODIS NDVI where GRACE sees the gain?"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys, json
import numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs, cartopy.feature as cfeature
sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl, viz
out = tl.task_dir("23_water_transfers")
P = ROOT + "/data/processed/modis/ndvi"
t = pd.DatetimeIndex(json.load(open(f"{P}/times.json")))
nd = np.load(f"{P}/ndvi_global_0p1.npy", mmap_mode="r")
lon = -179.95 + 0.1 * np.arange(3600); lat = -89.95 + 0.1 * np.arange(1800)
EXT = (34.3, 36.2, 9.8, 11.9)
i0, i1 = np.searchsorted(lon, EXT[0]), np.searchsorted(lon, EXT[1]); j0, j1 = np.searchsorted(lat, EXT[2]), np.searchsorted(lat, EXT[3])
sub = np.asarray(nd[:, j0:j1, i0:i1], np.float32); lo = lon[i0:i1]; la = lat[j0:j1]
dry = np.isin(t.month, [1, 2, 3, 4])
before = np.nanmean(sub[dry & (t.year >= 2016) & (t.year <= 2019)], 0)
after = np.nanmean(sub[dry & (t.year >= 2024)], 0)
diff = after - before
cell = (11.12 ** 2) * np.cos(np.deg2rad(la))[:, None] * np.ones((1, len(lo)))
area_drop = float(cell[diff < -0.08].sum())
LOm, LAm = np.meshgrid(lo, la)
res_cells = (diff < -0.08) & (LOm > 34.9) & (LOm < 35.7) & (LAm > 10.4) & (LAm < 11.3)
ctrl = (np.abs(diff) < 0.05) & ~res_cells & (LOm > 34.6) & (LOm < 35.9) & (LAm > 10.2) & (LAm < 11.5)
yrs, wat, ctl = [], [], []
for y in range(2001, 2027):
    m = dry & (t.year == y)
    if m.sum() < 2:
        continue
    a = np.nanmean(sub[m], 0)
    yrs.append(y); wat.append(float(np.nanmean(a[res_cells]))); ctl.append(float(np.nanmean(a[ctrl])))
fig = plt.figure(figsize=(14, 5.8), dpi=170)
for k, (fld, ttl, cm, vmin, vmax) in enumerate([(before, "Dry-season NDVI 2016–2019 (before filling)", "YlGn", 0, 0.6),
                                               (after, "Dry-season NDVI 2024–2026 (after filling)", "YlGn", 0, 0.6),
                                               (diff, "Change (after − before)", viz.div_cmap("green"), -0.3, 0.3)]):
    ax = fig.add_axes([0.01 + 0.25 * k, 0.12, 0.24, 0.70], projection=ccrs.PlateCarree())
    ax.set_extent(EXT, crs=ccrs.PlateCarree())
    im = ax.imshow(fld, origin="lower", extent=[lo[0] - 0.05, lo[-1] + 0.05, la[0] - 0.05, la[-1] + 0.05], transform=ccrs.PlateCarree(),
                   cmap=cm, vmin=vmin, vmax=vmax, interpolation="nearest")
    ax.add_feature(cfeature.BORDERS.with_scale("10m"), linewidth=0.6, edgecolor=viz.INK2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"), linewidth=0.6, edgecolor="#2a78d6")
    ax.plot(35.09, 11.21, marker="^", color=viz.INK, ms=7, transform=ccrs.PlateCarree())
    ax.set_title(ttl, fontsize=10)
    cb = fig.colorbar(im, ax=ax, orientation="horizontal", fraction=0.05, pad=0.04); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7, length=0)
ax4 = fig.add_axes([0.79, 0.18, 0.19, 0.60])
ax4.plot(yrs, ctl, color=viz.MUTED, lw=1.8, marker="o", ms=3, label="surrounding land")
ax4.plot(yrs, wat, color=viz.SERIES[0], lw=2.2, marker="o", ms=3, label="cells that became the reservoir")
ax4.axvline(2020.5, color=viz.AXIS, ls=":", lw=1); ax4.text(2020.6, max(ctl) * 1.02, "filling\nstarts", fontsize=7.5, color=viz.INK2)
ax4.legend(frameon=False, fontsize=7.5, loc="lower left")
for sp in ("top", "right"):
    ax4.spines[sp].set_visible(False)
ax4.tick_params(length=0, labelsize=8); ax4.grid(axis="y", color=viz.GRID, lw=0.5)
ax4.set_title("dry-season NDVI, year by year", fontsize=9)
fig.text(0.01, 0.965, "A new lake where GRACE sees the water: Ethiopia's GERD reservoir in MODIS", fontsize=14.5, fontweight="bold", va="top")
fig.text(0.01, 0.915, f"Triangle = dam. Brown in the change map = vegetation replaced by open water (≈ {area_drop:.0f} km² at 0.1° — an underestimate of the "
         "narrow, branching reservoir). Independent of GRACE's +7 km³/yr storage gain after 2020.", fontsize=9, color=viz.INK2, va="top")
fig.text(0.01, 0.012, "Data: NASA MODIS/Terra MOD13C2 NDVI (dry season Jan–Apr), 0.1°.", fontsize=7.5, color=viz.MUTED)
fig.savefig(f"{out}/gerd_ndvi_before_after.png"); plt.close(fig)
tl.save_json(dict(area_ndvi_drop_km2=area_drop, reservoir_cells=int(res_cells.sum()), ndvi_reservoir_cells=dict(zip(yrs, wat)),
                  ndvi_control=dict(zip(yrs, ctl))), f"{out}/gerd_ndvi.json")
tl.fix_perms(out); print("cells", int(res_cells.sum()), {y: (round(a, 3), round(b, 3)) for y, a, b in zip(yrs, wat, ctl)})
