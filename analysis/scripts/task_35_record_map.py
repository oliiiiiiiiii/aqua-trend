"""Task 35 - Where is land water at a record low (or high) right now?  GRACE year-of-extreme map.

GRACE/GRACE-FO TWS, deseasonalised anomalies, 12-month running mean (>= 9 valid months). Per pixel:
  - year in which the running mean reached its lowest / highest value (2002-2026);
  - "at a record now": the minimum (maximum) falls in the last 36 months of the record.
Under a stationary series a 36-month window holds the extreme by chance ~ 36 / n_months of the time.
Ice sheets (Greenland, Antarctica) excluded.
"""
import sys
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap, BoundaryNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "35_record_map"
out = tl.task_dir(TASK)
lon, lat = hub.LON, hub.LAT
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
land = hub.land_mask() & (lat[:, None] > -60) & ~(cg == inv.get("Greenland", -9))
area = hs.cell_area_km2(lon, lat)
tws = hub.load("tws")
t = pd.DatetimeIndex(tws.time.values)
a = tws.values.astype(np.float64)
an, _ = tl.deseason(a.reshape(len(t), -1), t.month.values)
df = pd.DataFrame(an[:, land.ravel()], index=t)
rm = df.rolling(12, center=False, min_periods=9).mean()
valid_rows = rm.notna().mean(1) > 0.5
rm = rm[valid_rows]
tt = rm.index
last = tt[-1]
print("record:", tt[0].date(), "->", last.date(), len(tt), "windows", flush=True)
imin = np.nanargmin(rm.values, axis=0); imax = np.nanargmax(rm.values, axis=0)
ymin = np.full(land.shape, np.nan); ymax = np.full(land.shape, np.nan)
ymin[land] = tt[imin].year + (tt[imin].month - 0.5) / 12; ymax[land] = tt[imax].year + (tt[imax].month - 0.5) / 12
recent = tt >= (last - pd.DateOffset(months=35))
rec_low = np.zeros(land.shape, bool); rec_high = np.zeros(land.shape, bool)
rec_low[land] = recent[imin]; rec_high[land] = recent[imax]
chance = recent.sum() / len(tt)
A = area[land].sum()
res = dict(record_start=str(tt[0].date()), record_end=str(last.date()), window_months=int(recent.sum()), chance_frac=float(chance),
           frac_record_low_now=float(area[rec_low].sum() / A), frac_record_high_now=float(area[rec_high].sum() / A))
print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in res.items()}, flush=True)
# how much of land had its record low in each year (by year of minimum)
yrs = np.arange(tt[0].year, last.year + 1)
by_year_low = {int(y): float(area[land & (np.floor(ymin) == y)].sum() / A) for y in yrs}
by_year_high = {int(y): float(area[land & (np.floor(ymax) == y)].sum() / A) for y in yrs}
res["share_of_land_by_year_of_min"] = by_year_low; res["share_of_land_by_year_of_max"] = by_year_high
# countries at record low now
rows = []
for cid, nm in names.items():
    m = land & (cg == cid)
    if area[m].sum() < 1.5e5:
        continue
    rows.append(dict(country=nm, frac_record_low_now=float(area[m & rec_low].sum() / area[m].sum()),
                     frac_record_high_now=float(area[m & rec_high].sum() / area[m].sum()), area_mkm2=float(area[m].sum() / 1e6)))
ct = pd.DataFrame(rows)
ct.sort_values("frac_record_low_now", ascending=False).to_csv(f"{out}/countries_record_now.csv", index=False)
lows = ct.sort_values("frac_record_low_now", ascending=False).head(10)
highs = ct.sort_values("frac_record_high_now", ascending=False).head(8)
print("record LOW now:", lows[["country", "frac_record_low_now"]].round(2).to_string(index=False), flush=True)
print("record HIGH now:", highs[["country", "frac_record_high_now"]].round(2).to_string(index=False), flush=True)
res["countries_low"] = lows.to_dict("records"); res["countries_high"] = highs.to_dict("records")

# --- figure 1: record low / record high right now ---
cat = np.full(land.shape, np.nan)
cat[land] = 1
cat[rec_low] = 0; cat[rec_high] = 2
fig = plt.figure(figsize=(12, 6.9), dpi=180)
ax = fig.add_axes([0.02, 0.14, 0.96, 0.70], projection=ccrs.Robinson()); ax.set_global()
cm = ListedColormap([viz.RED_ARM[2], "#e7e5df", viz.BLUE_ARM[1]])
ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#f2f1ec", zorder=1)
ax.imshow(cat, origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(), cmap=cm, vmin=-0.5, vmax=2.5,
          interpolation="nearest", zorder=2)
ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.5, edgecolor=viz.INK2, zorder=3)
ax.add_feature(cfeature.BORDERS.with_scale("110m"), linewidth=0.25, edgecolor=viz.MUTED, zorder=3)
w0 = (last - pd.DateOffset(months=35)).strftime("%b %Y"); w1 = last.strftime("%b %Y")
for k, (c, lb) in enumerate([(viz.RED_ARM[2], f"Record LOW in the last 3 years — {res['frac_record_low_now']:.0%} of land"),
                             (viz.BLUE_ARM[1], f"Record HIGH in the last 3 years — {res['frac_record_high_now']:.0%} of land"),
                             ("#e7e5df", f"Neither (by chance alone ≈ {chance:.0%} each)")]):
    x0 = 0.05 + k * 0.31
    fig.patches.append(matplotlib.patches.Rectangle((x0, 0.085), 0.016, 0.024, transform=fig.transFigure, color=c))
    fig.text(x0 + 0.022, 0.097, lb, fontsize=9, color=viz.INK2, va="center")
fig.text(0.03, 0.965, "Where is the land's water at a record low — or high — right now?", fontsize=15, fontweight="bold", va="top")
fig.text(0.03, 0.915, f"12-month mean water storage (GRACE, seasons removed): pixels whose lowest or highest value of {tt[0].year}–{last.year} occurred "
         f"in the latest three years ({w0} – {w1}). Most at record low: " + ", ".join(f"{r.country} {r.frac_record_low_now:.0%}" for r in lows.head(5).itertuples())
         + ".", fontsize=9.5, color=viz.INK2, va="top", wrap=True)
fig.text(0.03, 0.012, "Data: NASA/JPL GRACE & GRACE-FO mascons RL06.3. Ice sheets excluded. Country % = share of its area at a record.",
         fontsize=7.5, color=viz.MUTED)
fig.savefig(f"{out}/map_record_low_high_now.png"); plt.close(fig)

# --- figure 2: year of the lowest storage ---
fig = plt.figure(figsize=(12, 6.9), dpi=180)
ax = fig.add_axes([0.02, 0.15, 0.96, 0.70], projection=ccrs.Robinson()); ax.set_global()
bounds = [2002, 2006, 2010, 2014, 2018, 2022, 2027]
cols = ["#efdcc0", "#d2aa78", "#f2a27e", "#eb6834", "#b8302f", "#7f1d1d"]
cmb = ListedColormap(cols); norm = BoundaryNorm(bounds, cmb.N)
ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#f2f1ec", zorder=1)
im = ax.imshow(np.where(land, ymin, np.nan), origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(), cmap=cmb, norm=norm,
               interpolation="nearest", zorder=2)
ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.5, edgecolor=viz.INK2, zorder=3)
cax = fig.add_axes([0.25, 0.085, 0.50, 0.022])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", ticks=bounds); cb.outline.set_visible(False)
cb.ax.set_xticklabels(["2002", "2006", "2010", "2014", "2018", "2022", str(last.year)])
cb.ax.tick_params(labelsize=8.5, length=0); cb.set_label("year of the lowest 12-month water storage", fontsize=9, color=viz.INK2)
lowrec = sum(v for y, v in by_year_low.items() if y >= 2022)
fig.text(0.03, 0.965, "When did each place hit its driest point of the satellite era?", fontsize=15, fontweight="bold", va="top")
fig.text(0.03, 0.915, f"Year in which 12-month mean water storage (GRACE, seasons removed) was lowest. Dark red = the low point is recent "
         f"({lowrec:.0%} of land since 2022); pale = it bottomed out early and has since recovered.", fontsize=9.5, color=viz.INK2, va="top", wrap=True)
fig.text(0.03, 0.012, "Data: NASA/JPL GRACE & GRACE-FO mascons RL06.3 (gap Jul 2017 – May 2018). Ice sheets excluded.", fontsize=7.5, color=viz.MUTED)
fig.savefig(f"{out}/map_year_of_lowest_storage.png"); plt.close(fig)
tl.save_json(res, f"{out}/stats.json")
xr.Dataset({"year_min": (("lat", "lon"), ymin.astype(np.float32)), "year_max": (("lat", "lon"), ymax.astype(np.float32)),
            "record_low_now": (("lat", "lon"), rec_low.astype(np.float32)), "record_high_now": (("lat", "lon"), rec_high.astype(np.float32))},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/records.nc")
tl.runlog(TASK, "done", f"record low now {res['frac_record_low_now']:.0%} of land, high {res['frac_record_high_now']:.0%} (chance {chance:.0%})")
tl.fix_perms(out)
print("done")
