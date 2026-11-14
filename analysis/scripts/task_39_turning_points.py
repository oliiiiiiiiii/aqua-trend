"""Task 39 - Turning points: where did land water-storage trends reverse between the GRACE (2002-2013) and later (2014-2026) eras?

Per pixel: deseasonalised GRACE TWS; OLS trends with AR(1)-adjusted SE in each era; change z = (bB - bA)/sqrt(seA^2 + seB^2), FDR q=0.10.
Classes (only where the change is significant):
  reversal to gain (A<0, B>0) | slowing loss (A<0, B<0, |B|<|A|) | accelerating loss (A<0, B<A) |
  reversal to loss (A>0, B<0) | gain slowing / gain accelerating (A>0 ...).
Ice sheets excluded. Basins/countries summarised.
"""
import sys
import numpy as np
import pandas as pd
import xarray as xr
from scipy import stats
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "39_turning_points"
out = tl.task_dir(TASK)
lon, lat = hub.LON, hub.LAT
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
land = hub.land_mask() & (lat[:, None] > -60) & ~(cg == inv.get("Greenland", -9))
area = hs.cell_area_km2(lon, lat)
tws = hub.load("tws")
t = pd.DatetimeIndex(tws.time.values)
a, _ = tl.deseason(tws.values.reshape(len(t), -1), t.month.values)
ty = tl.decimal_year(t)
A_ = t < "2014-01-01"; B_ = t >= "2014-01-01"
rA = tl.ols_ar1(a[A_], ty[A_], min_frac=0.8); rB = tl.ols_ar1(a[B_], ty[B_], min_frac=0.6)
bA, bB = rA["slope"].reshape(land.shape), rB["slope"].reshape(land.shape)
seA, seB = rA["se"].reshape(land.shape), rB["se"].reshape(land.shape)
z = (bB - bA) / np.sqrt(seA ** 2 + seB ** 2)
p = np.where(land, 2 * stats.norm.sf(np.abs(z)), np.nan)
sig = tl.fdr_mask(p, q=0.10) & land
cls = np.full(land.shape, np.nan)
labels = ["Reversal: loss → gain", "Loss slowing", "Loss accelerating", "Reversal: gain → loss", "Gain slowing", "Gain accelerating"]
cls[sig & (bA < 0) & (bB > 0)] = 0
cls[sig & (bA < 0) & (bB < 0) & (bB > bA)] = 1
cls[sig & (bA < 0) & (bB < bA)] = 2
cls[sig & (bA > 0) & (bB < 0)] = 3
cls[sig & (bA > 0) & (bB > 0) & (bB < bA)] = 4
cls[sig & (bA > 0) & (bB > bA)] = 5
A_tot = area[land].sum()
res = {"frac_sig_change": float(area[sig].sum() / A_tot)}
for k, lb in enumerate(labels):
    res[lb] = float(area[cls == k].sum() / A_tot)
print({k: round(v, 3) for k, v in res.items()}, flush=True)
# hotspots per class
rows = []
for cid, nm in names.items():
    m = land & (cg == cid)
    if area[m].sum() < 1e5:
        continue
    d = dict(country=nm, area_mkm2=float(area[m].sum() / 1e6), trend_2002_13_cm_yr=float(np.nansum(bA[m] * area[m]) / area[m].sum()),
             trend_2014_26_cm_yr=float(np.nansum(bB[m] * area[m]) / area[m].sum()))
    for k, lb in enumerate(labels):
        d[lb] = float(area[m & (cls == k)].sum() / area[m].sum())
    rows.append(d)
ct = pd.DataFrame(rows)
ct.to_csv(f"{out}/countries_turning_points.csv", index=False)
top = {lb: ct.sort_values(lb, ascending=False).head(6)[["country", lb]].values.tolist() for lb in labels[:4]}
for lb, v in top.items():
    print(lb, [(c, round(x, 2)) for c, x in v], flush=True)
res["top_countries"] = top
# named regions: before/after trends
regs = {"NW India": (70, 80, 25, 33), "North China Plain": (113, 120, 34, 41), "California Central Valley": (-122.5, -118.5, 34.5, 40.5),
        "Middle East (Tigris-Euphrates)": (38, 50, 30, 38), "Caspian region": (46, 56, 36, 47), "Sahel": (-15, 30, 10, 17),
        "East Africa lakes": (28, 38, -5, 3), "Southern Amazon": (-70, -50, -15, -5), "Central Europe": (5, 25, 46, 55), "Patagonia": (-75, -68, -52, -40)}
LON, LAT = np.meshgrid(lon, lat)
rr = []
for nm, b in regs.items():
    m = land & (LON >= b[0]) & (LON <= b[1]) & (LAT >= b[2]) & (LAT <= b[3])
    s = pd.Series(np.nansum(a[:, m.ravel()] * area[m][None], 1) / area[m].sum(), index=t)
    s[np.isnan(a[:, m.ravel()]).all(1)] = np.nan
    ok = s.notna()
    sa = tl.ols_ar1(s[A_ & ok.values].values[:, None], ty[A_ & ok.values]); sb = tl.ols_ar1(s[B_ & ok.values].values[:, None], ty[B_ & ok.values])
    zz = float((sb["slope"][0] - sa["slope"][0]) / np.sqrt(sa["se"][0] ** 2 + sb["se"][0] ** 2))
    rr.append(dict(region=nm, trend_2002_13=float(sa["slope"][0]), se_A=float(sa["se"][0]), trend_2014_26=float(sb["slope"][0]), se_B=float(sb["se"][0]),
                   z=zz, p=float(2 * stats.norm.sf(abs(zz)))))
rdf = pd.DataFrame(rr); rdf.to_csv(f"{out}/regions_turning_points.csv", index=False)
print(rdf.round(2).to_string(), flush=True)
res["regions"] = rr

cols = ["#1c5cab", "#9ec5f4", viz.RED_ARM[3], viz.ORANGE_ARM[2], "#f2d3a8", "#2e9e2e"]
fig = plt.figure(figsize=(12, 7.3), dpi=180)
ax = fig.add_axes([0.02, 0.19, 0.96, 0.65], projection=ccrs.Robinson()); ax.set_global()
ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", zorder=1)
ax.imshow(cls, origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(), cmap=ListedColormap(cols), vmin=-0.5, vmax=5.5,
          interpolation="nearest", zorder=2)
ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.5, edgecolor=viz.INK2, zorder=3)
ax.add_feature(cfeature.BORDERS.with_scale("110m"), linewidth=0.25, edgecolor=viz.MUTED, zorder=3)
for k, (c, lb) in enumerate(zip(cols, labels)):
    x0 = 0.04 + (k % 3) * 0.32; y0 = 0.115 - (k // 3) * 0.04
    fig.patches.append(matplotlib.patches.Rectangle((x0, y0), 0.016, 0.022, transform=fig.transFigure, color=c))
    fig.text(x0 + 0.022, y0 + 0.011, f"{lb} — {res[lb]:.0%} of land", fontsize=9, color=viz.INK2, va="center")
rd = {r["region"]: r for r in rr}
fig.text(0.03, 0.965, "Turning points: where land water trends changed course after 2014", fontsize=15, fontweight="bold", va="top")
import textwrap
sub = (f"GRACE storage trend 2014–26 vs 2002–13, shown only where the change is significant (AR(1)-adjusted, FDR q=0.10; {res['frac_sig_change']:.0%} of land). "
       f"North China Plain {rd['North China Plain']['trend_2002_13']:+.1f} → {rd['North China Plain']['trend_2014_26']:+.1f} cm/yr; Central Europe "
       f"{rd['Central Europe']['trend_2002_13']:+.1f} → {rd['Central Europe']['trend_2014_26']:+.1f}; Caspian {rd['Caspian region']['trend_2002_13']:+.1f} → "
       f"{rd['Caspian region']['trend_2014_26']:+.1f}; Sahel {rd['Sahel']['trend_2002_13']:+.1f} → {rd['Sahel']['trend_2014_26']:+.1f}.")
fig.text(0.03, 0.915, "\n".join(textwrap.wrap(sub, 140)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.03, 0.012, "Data: NASA/JPL GRACE & GRACE-FO mascons RL06.3 (gap Jul 2017 – May 2018). Ice sheets excluded.", fontsize=7.5, color=viz.MUTED)
fig.savefig(f"{out}/map_turning_points.png"); plt.close(fig)
tl.save_json(res, f"{out}/stats.json")
xr.Dataset({"trend_A": (("lat", "lon"), bA.astype(np.float32)), "trend_B": (("lat", "lon"), bB.astype(np.float32)),
            "z": (("lat", "lon"), z.astype(np.float32)), "class": (("lat", "lon"), cls.astype(np.float32))},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/turning_points.nc")
tl.runlog(TASK, "done", f"sig change {res['frac_sig_change']:.0%} of land; loss->gain {res[labels[0]]:.0%}, gain->loss {res[labels[3]]:.0%}")
tl.fix_perms(out)
print("done")
