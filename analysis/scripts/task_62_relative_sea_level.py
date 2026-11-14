"""Task 62 - The sea level people actually feel: relative sea-level rise at each coast = ocean rise (altimetry) + land sinking.

Data: PSMSL RLR monthly tide gauges; NASA-SSH gridded altimetry (cached monthly cube from task 60); task 60 vertical land motion.
Method: for each gauge passing task 60's QC (and not in an earthquake step region), trends over 1993-2025 of (a) the tide gauge itself
(relative sea level, what the coast experiences) and (b) the matched altimetry cell (absolute sea level); land motion = (b) - (a).
OLS with AR(1)-corrected errors on deseasonalised monthly data. Ranks gauges by relative rise and splits each into ocean vs land parts.
"""
import sys
import zipfile
import textwrap
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import TwoSlopeNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402

TASK = "62_relative_sea_level"
out = tl.task_dir(TASK)
SRC = "Data: PSMSL tide gauges (RLR monthly); NASA-SSH gridded altimetry v1.1."
zc = np.load(f"{ROOT}/data/processed/nasassh_monthly_1993_2025.npz"); ALT, alat, alon = zc["alt"], zc["lat"], zc["lon"]
alon = np.where(alon > 180, alon - 360, alon)
months = pd.period_range("1993-01", "2025-12", freq="M"); mt = months.to_timestamp(); td = tl.decimal_year(mt)
V = pd.read_csv(f"{ROOT}/results/60_land_sinking/vertical_land_motion.csv")
V = V[V.quake.isna()]
z = zipfile.ZipFile(f"{ROOT}/data/raw/psmsl/rlr_monthly.zip")
LAg, LOg = np.meshgrid(alat, alon, indexing="ij")
valid_frac = np.isfinite(ALT).mean(0)


def trend(s):
    s = s - s.groupby(s.index.month).transform("mean")
    ok = s.notna().values
    o = tl.ols_ar1(s.values[ok][:, None], td[ok], min_frac=0.5)
    return float(o["slope"][0]), float(o["ci"][0])


rows = []
for _, st in V.iterrows():
    txt = z.read(f"rlr_monthly/data/{int(st.id)}.rlrdata").decode()
    a = np.array([[float(v) for v in ln.split(";")[:2]] for ln in txt.strip().splitlines() if ln.strip()])
    h = np.where(a[:, 1] <= -99999, np.nan, a[:, 1])
    per = pd.Series(h, index=pd.PeriodIndex([pd.Period(year=int(y), month=int(round((y - int(y)) * 12 + 0.5)), freq="M") for y in a[:, 0]]))
    per = per[~per.index.duplicated()]
    g = pd.Series(per.reindex(months).values, index=mt)
    dist = np.hypot(LAg - st.lat, (LOg - st.lon) * np.cos(np.deg2rad(st.lat)))
    cand = (dist <= 1.5) & (valid_frac >= 0.8)
    i, j = np.unravel_index(np.argmin(np.where(cand, dist, np.inf)), dist.shape)
    al = pd.Series(ALT[:, i, j], index=mt).where(g.notna())
    rs, rci = trend(g); as_, aci = trend(al)
    rows.append(dict(id=int(st.id), name=st["name"], lat=st.lat, lon=st.lon, relative_mm_yr=rs, relative_ci=rci, ocean_mm_yr=as_, ocean_ci=aci,
                     land_mm_yr=as_ - rs, vlm_task60=st.vlm_mm_yr, vlm_sig=bool(st.sig)))
R = pd.DataFrame(rows).sort_values("relative_mm_yr", ascending=False)
R.round(3).to_csv(f"{out}/relative_sea_level_by_gauge.csv", index=False)
res = dict(n=int(len(R)), median_relative=float(R.relative_mm_yr.median()), median_ocean=float(R.ocean_mm_yr.median()),
           frac_relative_faster_than_ocean=float((R.relative_mm_yr > R.ocean_mm_yr).mean()),
           frac_relative_over_2x_global=float((R.relative_mm_yr > 2 * 3.4).mean()),
           frac_land_sinking_bigger_than_ocean_rise=float(((R.ocean_mm_yr - R.relative_mm_yr) < -np.abs(R.ocean_mm_yr)).mean()),
           top20=R.head(20)[["name", "lat", "lon", "relative_mm_yr", "ocean_mm_yr", "land_mm_yr"]].round(2).to_dict("records"),
           falling_relative=int((R.relative_mm_yr < 0).sum()))
print({k: v for k, v in res.items() if k != "top20"}, flush=True)
print(R.head(20)[["name", "relative_mm_yr", "ocean_mm_yr", "land_mm_yr"]].round(2).to_string(), flush=True)
tl.save_json(res, f"{out}/stats.json")

# ---------------------------------------------------------------- figure
fig = plt.figure(figsize=(14, 8.6), dpi=170)
proj = ccrs.Robinson(central_longitude=150)
axm = fig.add_axes([0.01, 0.22, 0.68, 0.60], projection=proj)
axm.set_global()
_y0 = proj.transform_point(150, -58, ccrs.PlateCarree())[1]; _y1 = proj.transform_point(150, 72, ccrs.PlateCarree())[1]
axm.set_ylim(_y0, _y1)
axm.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", lw=0); axm.add_feature(cfeature.COASTLINE.with_scale("110m"), lw=0.3, color=viz.MUTED)
axm.spines["geo"].set_visible(False)
cm = viz.div_cmap("redblue"); norm = TwoSlopeNorm(3.4, -6, 12)
Rs = R.reindex(R.relative_mm_yr.sort_values().index)
sc = axm.scatter(Rs.lon, Rs.lat, c=Rs.relative_mm_yr.clip(-6, 12), cmap=cm, norm=norm, s=18, edgecolors=viz.INK, linewidths=0.25, transform=ccrs.PlateCarree(), zorder=3)
axm.set_title("Relative sea-level trend at each tide gauge, 1993–2025 (what the coast feels)", fontsize=10.5, loc="left", fontweight="bold")
cax = fig.add_axes([0.08, 0.20, 0.30, 0.013]); cb = fig.colorbar(sc, cax=cax, orientation="horizontal", ticks=[-6, -3, 0, 3.4, 6, 9, 12]); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7.5, length=0); cb.set_label("mm per year (white ≈ global mean rise 3.4 mm/yr; blue: falling, land rising faster than the sea)", fontsize=7.8, color=viz.INK2)
# right: decomposition bars for the 16 fastest
ax = fig.add_axes([0.80, 0.17, 0.18, 0.65])
top = R.head(16).iloc[::-1]
yy = np.arange(len(top))
ax.barh(yy, top.ocean_mm_yr, color=viz.BLUE_ARM[2], height=0.65, label="ocean rising (altimetry)")
ax.barh(yy, -top.land_mm_yr.clip(upper=0), left=top.ocean_mm_yr, color=viz.ORANGE_ARM[2], height=0.65, label="land sinking")
ax.plot(top.relative_mm_yr, yy, "|", color=viz.INK, ms=10, mew=1.5, label="measured at the gauge")
ax.set_yticks(yy); ax.set_yticklabels([n_[:22].title() for n_ in top.name], fontsize=7.3)
ax.axvline(3.4, color=viz.MUTED, lw=0.8, ls=":")
ax.set_xlabel("relative sea-level rise (mm per year)", fontsize=8, color=viz.INK2)
ax.legend(frameon=False, fontsize=7.5, loc="upper center", bbox_to_anchor=(0.35, -0.07), ncol=1)
ax.set_title("Fastest relative rise", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.tick_params(length=0, labelsize=7.5); ax.grid(axis="x", color=viz.GRID, lw=0.5)
t0 = res["top20"][0]
fig.text(0.01, 0.975, "The sea level people feel: at the worst-hit coasts the land sinks faster than the ocean rises", fontsize=15, fontweight="bold", va="top")
subt = (f"At {res['n']} tide gauges the median relative sea-level rise since 1993 is {res['median_relative']:+.1f} mm per year (ocean alone {res['median_ocean']:+.1f}). "
        f"Where groundwater pumping, delta compaction or tectonics lower the land, residents face more than double the global rate: {100 * res['frac_relative_over_2x_global']:.0f}% "
        f"of gauges exceed 6.8 mm/yr, led by {t0['name'].title()} ({t0['relative_mm_yr']:+.1f} mm/yr). Where land rebounds after the ice age (Alaska, Scandinavia, Hudson Bay), "
        f"relative sea level is falling at {res['falling_relative']} gauges despite the rising ocean. Earthquake-affected gauges are excluded.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/relative_sea_level.png"); plt.close(fig)
tl.runlog(TASK, "done", f"{res['n']} gauges: median relative {res['median_relative']:+.1f} mm/yr; {100 * res['frac_relative_over_2x_global']:.0f}% > 2x global")
tl.fix_perms(out)
print("done")
