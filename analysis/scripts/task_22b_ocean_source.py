"""Task 22b - Which ocean feeds each region's rain? (memory-lean split of task 22 part 5)

For each destination region: correlation of its monthly rain anomalies (IMERG, regional mean) with ocean evaporation
anomalies everywhere (MERRA-2 EVAP), evaporation leading by 0 or 1 month; AR(1)-adjusted, FDR. Overlaid on the
mean vertically integrated vapour flux so that 'upwind' is visible.
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
import cartopy.crs as ccrs
import cartopy.feature as cfeature

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "22_moisture_transport"
out = tl.task_dir(TASK)
SRC = "Data: NASA MERRA-2 (evaporation, vapour flux), GPM IMERG (rain). AR(1)-adjusted correlation, FDR q=0.10."
LATm = -90 + 0.5 * np.arange(361); LONm = -180 + 0.625 * np.arange(576)
t_e, E = hub._gd("m2flx", "EVAP", "native")
keep = t_e >= pd.Timestamp("2001-01-01")
t_e = t_e[keep]; E = E[keep] * 86400.0
t_u, U = hub._gd("m2int", "UFLXQV", "native"); _, V = hub._gd("m2int", "VFLXQV", "native")
ku = t_u >= pd.Timestamp("2001-01-01")
Um, Vm = U[ku].mean(0), V[ku].mean(0)
del U, V
Pimerg = hub.load("p_imerg")
LONg, LATg = np.meshgrid(LONm, LATm)
# ocean mask on the MERRA-2 grid from the hub land mask (nearest)
lm = hub.land_mask()
li = np.clip(np.round((LATm + 89.75) / 0.5).astype(int), 0, 359); lo = np.clip(np.round((LONm + 179.75) / 0.5).astype(int), 0, 719)
land_m = lm[np.ix_(li, lo)]
dest = {"Taiwan": (120.0, 122.0, 22.0, 25.3), "South China": (108.0, 118.0, 21.0, 26.0), "NW India": (72.0, 78.5, 26.0, 32.5),
        "Sahel": (-17.0, 35.0, 11.0, 18.0), "East Africa (Victoria)": (30.0, 36.0, -3.5, 1.5), "North China Plain": (113.0, 119.5, 34.0, 40.5),
        "Amazon": (-70.0, -50.0, -10.0, 2.0)}
res = {}
for nm, b in dest.items():
    s = tl.area_mean(Pimerg, b).to_series()
    tt = pd.DatetimeIndex(sorted(set(s.index) & set(t_e)))
    s = s.reindex(tt)
    Ei = E[np.isin(t_e, tt)]
    best = None
    for lag in (0, 1):
        rr = tl.grid_corr(Ei, s.values, tt, lag=lag)
        rr["r"] = np.where(~land_m, rr["r"], np.nan); rr["sig"] = rr["sig"] & ~land_m
        score = np.nansum(np.clip(rr["r"], 0, None) * rr["sig"])
        if best is None or score > best[0]:
            best = (score, lag, rr)
    _, lag, rr = best
    ext = (b[0] - 55, b[1] + 55, max(-55, b[2] - 35), min(65, b[3] + 30))
    # strongest positively correlated ocean area (top 2% of significant cells)
    sel = rr["sig"] & (rr["r"] > 0)
    top = sel & (rr["r"] >= np.nanpercentile(np.where(sel, rr["r"], np.nan), 90)) if sel.any() else sel
    res[nm] = dict(lag=lag, n_sig_pos_cells=int(sel.sum()), max_r=float(np.nanmax(rr["r"])) if np.isfinite(rr["r"]).any() else None,
                   top_source_centroid=(float(LONg[top].mean()), float(LATg[top].mean())) if top.any() else None)
    fig = plt.figure(figsize=(11, 7.4), dpi=170)
    ax = fig.add_axes([0.03, 0.13, 0.94, 0.72], projection=ccrs.PlateCarree())
    ax.set_extent(ext, crs=ccrs.PlateCarree())
    cm = viz.div_cmap("redblue")
    ax.pcolormesh(LONm, LATm, rr["r"], transform=ccrs.PlateCarree(), cmap=cm, vmin=-0.5, vmax=0.5, alpha=0.3, shading="auto")
    im = ax.pcolormesh(LONm, LATm, np.where(rr["sig"], rr["r"], np.nan), transform=ccrs.PlateCarree(), cmap=cm, vmin=-0.5, vmax=0.5, shading="auto")
    st = 5
    ax.quiver(LONg[::st, ::st], LATg[::st, ::st], Um[::st, ::st], Vm[::st, ::st], transform=ccrs.PlateCarree(), color=viz.INK,
              alpha=0.55, scale=4500, width=0.0018)
    ax.add_feature(cfeature.LAND.with_scale("50m"), facecolor="#e9e8e3", zorder=0)
    ax.add_feature(cfeature.COASTLINE.with_scale("50m"), linewidth=0.5, edgecolor=viz.INK2)
    ax.plot([b[0], b[1], b[1], b[0], b[0]], [b[2], b[2], b[3], b[3], b[2]], color=viz.INK, lw=1.6, transform=ccrs.PlateCarree())
    fig.text(0.03, 0.965, f"Which ocean feeds {nm}'s rain?", fontsize=15, fontweight="bold", va="top")
    fig.text(0.03, 0.915, f"Red: months with more ocean evaporation there are followed {lag} month(s) later by more rain in {nm} (box). "
             "Arrows: mean moisture transport — red patches upwind = likely moisture source.", fontsize=9.5, color=viz.INK2, va="top", wrap=True)
    cax = fig.add_axes([0.32, 0.075, 0.36, 0.022])
    cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both"); cb.outline.set_visible(False)
    cb.set_label("correlation r (faded = not significant)", fontsize=9, color=viz.INK2); cb.ax.tick_params(labelsize=8, length=0)
    fig.text(0.03, 0.012, SRC, fontsize=7.5, color=viz.MUTED)
    fig.savefig(f"{out}/ocean_source_{nm.split(' (')[0].replace(' ', '_')}.png"); plt.close(fig)
    print(f"ocean source for {nm}: lag {lag}, {res[nm]['n_sig_pos_cells']} sig+ ocean cells, max r {res[nm]['max_r']}, "
          f"top-source centroid {res[nm]['top_source_centroid']}", flush=True)
tl.save_json(res, f"{out}/ocean_sources.json")
tl.runlog("22b_ocean_source", "done", "; ".join(f"{k}: {v['n_sig_pos_cells']} cells" for k, v in res.items()))
tl.fix_perms(out)
print("done")
