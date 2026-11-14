import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import numpy as np, xarray as xr, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs, cartopy.feature as cfeature
sys.path.insert(0, ROOT + "/scripts")
import viz, trendlib as tl
out = ROOT + "/results/29_water_memory"
ds = xr.open_dataset(f"{out}/water_memory.nc"); lagm = ds["lag"].values
fig = plt.figure(figsize=(12, 6.8), dpi=180)
ax = fig.add_axes([0.02, 0.15, 0.96, 0.70], projection=ccrs.Robinson()); ax.set_global()
cols = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#1c5cab", "#184f95", "#104281", "#0d366b", "#081f3f"]
cm = ListedColormap(cols); norm = BoundaryNorm(np.arange(-0.5, 10.5, 1), cm.N)
ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#e1e0d9", zorder=1)
im = ax.imshow(lagm, origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(), cmap=cm, norm=norm, interpolation="nearest", zorder=2)
ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.5, edgecolor=viz.INK2, zorder=3)
fig.text(0.03, 0.965, "Water memory: how long after it rains does the land's stored water peak?", fontsize=15, fontweight="bold", va="top")
fig.text(0.03, 0.915, "Lag (months) at which GRACE water storage correlates best with IMERG rain anomalies. Dark = slow response (snowpack, big\naquifers, lakes, floodplains such as the Okavango); light = fast response. Grey = no significant link.", fontsize=9.5, color=viz.INK2, va="top")
cax = fig.add_axes([0.30, 0.085, 0.40, 0.022])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", ticks=range(0, 10)); cb.outline.set_visible(False)
cb.set_label("months from rain to peak storage response", fontsize=9, color=viz.INK2); cb.ax.tick_params(labelsize=8, length=0)
fig.text(0.03, 0.012, "Data: GPM IMERG rain, GRACE/GRACE-FO water storage, 2002–2025. AR(1)-adjusted correlation, FDR q=0.10.", fontsize=7.5, color=viz.MUTED)
fig.savefig(f"{out}/map_water_memory_lag.png"); plt.close(fig); tl.fix_perms(out); print("ok")
