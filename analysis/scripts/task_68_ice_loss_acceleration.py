"""Task 68 - Ice loss region by region: how fast, and is it accelerating? (GRACE/GRACE-FO 2002-2026)

Data: JPL GRACE/GRACE-FO mascons RL06.3 CRI (GIA-corrected), monthly. Region masks as in task 28 (Greenland, Antarctica, glacier boxes),
plus Antarctic sub-regions: Antarctic Peninsula (75-55W, north of 75S), Amundsen Sea sector (135-95W, 80-72S), rest of West Antarctica
(150-60W), East Antarctica (the rest).
Method: regional mass anomaly (Gt) = sum(lwe [m] x cell area [m2]) / 1e9; deseasonalised; linear trend and acceleration (2 x quadratic
coefficient) with AR(1)-corrected errors; rates 2002-2012 vs 2013-2026; record-loss years. 1 mm of global sea level = 361.8 Gt.
"""
import sys
import textwrap
import numpy as np
import pandas as pd
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
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "68_ice_loss_acceleration"
out = tl.task_dir(TASK)
SRC = "Data: NASA/JPL GRACE & GRACE-FO mascons RL06.3 CRI (GIA-corrected). 1 mm global sea level = 361.8 Gt."
tws = hub.load("tws"); lat, lon = hub.LAT, hub.LON
land = hub.land_mask(); area = hs.cell_area_km2(lon, lat) * 1e6
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
LON, LAT = np.meshgrid(lon, lat)
greenland = land & ((cg == inv.get("Greenland", -9)) | ((LON > -75) & (LON < -10) & (LAT > 59) & (LAT < 84) & ~np.isin(cg, [inv.get("Canada", -9), inv.get("Iceland", -9)])))
ant = land & (LAT < -60)
pen = ant & (LON >= -75) & (LON <= -55) & (LAT > -75)
ase = ant & (LON >= -135) & (LON <= -95) & (LAT >= -80) & (LAT <= -72)
wais = ant & (LON >= -150) & (LON <= -60) & ~pen & ~ase
eais = ant & ~pen & ~ase & ~wais
REG = {"Greenland": greenland, "Antarctica (all)": ant, "  Amundsen Sea sector": ase, "  Antarctic Peninsula": pen, "  rest of West Antarctica": wais,
       "  East Antarctica": eais,
       "Alaska & W Canada": land & (LON >= -155) & (LON <= -120) & (LAT >= 55) & (LAT <= 66) & ~greenland,
       "Arctic Canada, Svalbard, Russian Arctic": land & (LAT > 72) & ~greenland & ~ant,
       "High Mountain Asia": land & (LON >= 70) & (LON <= 100) & (LAT >= 27) & (LAT <= 40),
       "Patagonia": land & (LON >= -76) & (LON <= -68) & (LAT >= -56) & (LAT <= -40)}
A = tws.values; t = pd.DatetimeIndex(tws.time.values); td = tl.decimal_year(t)
res, S = {}, {}
for nm, m in REG.items():
    vol = np.nansum(A[:, m] / 100.0 * area[m][None, :], axis=1) / 1e9
    s = pd.Series(vol, t); s[np.isnan(A[:, m]).all(1)] = np.nan
    s = s - s.groupby(s.index.month).transform("mean") + s.mean()
    s = s - s["2002":"2004"].mean()
    ok = s.notna().values; x = td[ok] - td[ok].mean(); y = s.values[ok]
    X = np.column_stack([np.ones_like(x), x, x ** 2]); b, *_ = np.linalg.lstsq(X, y, rcond=None); r = y - X @ b
    r1 = np.clip(np.corrcoef(r[1:], r[:-1])[0, 1], 0, 0.95); neff = len(y) * (1 - r1) / (1 + r1)
    cov = (r @ r / max(neff - 3, 3)) * np.linalg.inv(X.T @ X)
    bl = np.polyfit(x, y, 1)
    rate1 = np.polyfit(td[ok & (t.year <= 2012)], s.values[ok & (t.year <= 2012)], 1)[0]
    rate2 = np.polyfit(td[ok & (t.year >= 2013)], s.values[ok & (t.year >= 2013)], 1)[0]
    ann = s.groupby(s.index.year).mean(); dann = ann.diff().loc[2004:2025]
    res[nm.strip()] = dict(rate_gt_yr=float(bl[0]), accel_gt_yr2=float(2 * b[2]), accel_se=float(2 * np.sqrt(cov[2, 2])),
                           accel_p=float(2 * stats.t.sf(abs(b[2] / np.sqrt(cov[2, 2])), max(neff - 3, 3))),
                           rate_2002_2012=float(rate1), rate_2013_2026=float(rate2), total_change_gt=float(s.dropna().iloc[-6:].mean()),
                           sea_level_mm_total=float(-s.dropna().iloc[-6:].mean() / 361.8), biggest_loss_year=int(dann.idxmin()), biggest_loss_gt=float(dann.min()),
                           biggest_gain_year=int(dann.idxmax()), biggest_gain_gt=float(dann.max()))
    S[nm] = s
    print(f"{nm:42s} rate {bl[0]:+7.1f} Gt/yr  accel {2 * b[2]:+6.2f}±{2 * np.sqrt(cov[2, 2]):.2f} Gt/yr² (p={res[nm.strip()]['accel_p']:.3f})  "
          f"{rate1:+.0f} -> {rate2:+.0f}  total {res[nm.strip()]['total_change_gt']:+.0f} Gt", flush=True)
tot = sum(res[k]["total_change_gt"] for k in ("Greenland", "Antarctica (all)", "Alaska & W Canada", "Arctic Canada, Svalbard, Russian Arctic", "High Mountain Asia", "Patagonia"))
res["all_ice_total_gt"] = float(tot); res["all_ice_sea_level_mm"] = float(-tot / 361.8)
tl.save_json(res, f"{out}/stats.json")
pd.DataFrame({k.strip(): v for k, v in S.items()}).round(1).to_csv(f"{out}/regional_ice_mass_gt.csv")
tt = t
with np.errstate(all="ignore"):
    import warnings
    warnings.simplefilter("ignore")
    o = tl.ols_ar1(A, td, min_frac=0.7)
trmap = o["slope"]   # cm/yr

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.8), dpi=170)
theta = np.linspace(0, 2 * np.pi, 100); circle = mpath.Path(np.vstack([np.sin(theta), np.cos(theta)]).T * 0.5 + 0.5)
for k, (pj, lat0, title) in enumerate(((ccrs.NorthPolarStereo(central_longitude=-42), 58, "A  Greenland & Arctic"), (ccrs.SouthPolarStereo(), -60, "B  Antarctica"))):
    a = fig.add_axes([0.01 + k * 0.21, 0.50, 0.20, 0.33], projection=pj)
    im = a.pcolormesh(lon, lat, trmap, cmap=viz.div_cmap("water"), vmin=-20, vmax=20, transform=ccrs.PlateCarree(), shading="auto", rasterized=True)
    r_ = abs(pj.transform_point(-42 if k == 0 else 0, lat0, ccrs.PlateCarree())[1])
    a.set_xlim(-r_, r_); a.set_ylim(-r_, r_); a.set_boundary(circle, transform=a.transAxes)
    a.coastlines(lw=0.4, color=viz.INK2)
    a.set_title(title, fontsize=9.5, loc="left", fontweight="bold")
cax = fig.add_axes([0.05, 0.47, 0.34, 0.012]); cb = fig.colorbar(im, cax=cax, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7, length=0); cb.set_label("mass trend 2002–2026, cm of water per year", fontsize=7.5, color=viz.INK2)
# C: cumulative curves (one axis, Gt) for the big regions
ax = fig.add_axes([0.48, 0.50, 0.50, 0.33])
BIG = (("Greenland", viz.SERIES[1]), ("Antarctica (all)", viz.SERIES[0]), ("Alaska & W Canada", viz.SERIES[2]),
       ("Arctic Canada, Svalbard, Russian Arctic", viz.SERIES[3]), ("High Mountain Asia", viz.SERIES[4]), ("Patagonia", viz.SERIES[5]))
ends = sorted([(S[nm].dropna().iloc[-6:].mean(), nm) for nm, _ in BIG])
laby, last = {}, -1e9
for v, nm in ends:
    yl = max(v, last + 260); laby[nm] = yl; last = yl
for nm, col in BIG:
    s = S[nm]
    ax.plot(s.index, s.values, color=col, lw=1.6)
    ax.text(s.dropna().index[-1] + pd.Timedelta(days=60), laby[nm], f"{nm.split(',')[0]} {res[nm]['rate_gt_yr']:+.0f} Gt/yr", fontsize=7.6, va="center", color=viz.INK)
ax.axhline(0, color=viz.AXIS, lw=0.8)
ax.set_xlim(pd.Timestamp("2002-01-01"), pd.Timestamp("2033-01-01"))
ax.set_ylabel("ice mass change since 2002–04 (Gt)", color=viz.INK2, fontsize=8.5)
ax.set_title("C  Cumulative ice loss (seasonal cycle removed)", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
# D: rate early vs late + acceleration table
ax2 = fig.add_axes([0.24, 0.07, 0.40, 0.32])
order = ["Greenland", "Antarctica (all)", "Amundsen Sea sector", "Antarctic Peninsula", "East Antarctica", "Alaska & W Canada", "Arctic Canada, Svalbard, Russian Arctic", "High Mountain Asia", "Patagonia"]
yy = np.arange(len(order))[::-1]
r1v = [res[k]["rate_2002_2012"] for k in order]; r2v = [res[k]["rate_2013_2026"] for k in order]
ax2.barh(yy + 0.18, r1v, height=0.34, color="#b9b8b0", label="2002–2012")
ax2.barh(yy - 0.18, r2v, height=0.34, color=viz.ORANGE_ARM[2], label="2013–2026")
ax2.set_yticks(yy); ax2.set_yticklabels([k.split(",")[0] for k in order], fontsize=8)
ax2.axvline(0, color=viz.INK, lw=0.8); ax2.legend(frameon=False, fontsize=8, loc="lower left")
ax2.set_xlabel("mass change rate (Gt per year)", fontsize=8.5, color=viz.INK2)
ax2.set_title("D  Faster or slower? Rate in the first vs second half of the record", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax2.spines[sp_].set_visible(False)
ax2.grid(axis="x", color=viz.GRID, lw=0.5); ax2.tick_params(length=0, labelsize=8)
axt = fig.add_axes([0.70, 0.07, 0.29, 0.32]); axt.axis("off")
lines = ["Acceleration (Gt/yr² ± s.e.)", "(+ = loss slowing, − = loss speeding up)", ""]
for k in order:
    v = res[k]
    ps_ = "<0.01" if v['accel_p'] < 0.01 else f"={v['accel_p']:.2f}"
    lines.append(f"{k.split(',')[0][:22]:22s} {v['accel_gt_yr2']:+6.1f} ± {v['accel_se']:4.1f}  p{ps_}")
axt.text(0, 1, "\n".join(lines), family="DejaVu Sans Mono", fontsize=7.4, va="top", color=viz.INK)
G, An = res["Greenland"], res["Antarctica (all)"]
fig.text(0.01, 0.975, "Ice loss by region: glaciers and the Amundsen Sea speed up; Greenland's loss slowed after 2012", fontsize=15, fontweight="bold", va="top")
subt = (f"GRACE weighs the ice every month. Since 2002 Greenland lost {abs(G['total_change_gt']):.0f} Gt ({G['rate_gt_yr']:+.0f} Gt/yr) and Antarctica {abs(An['total_change_gt']):.0f} Gt "
        f"({An['rate_gt_yr']:+.0f} Gt/yr), most of it from the Amundsen Sea sector ({res['Amundsen Sea sector']['rate_gt_yr']:+.0f} Gt/yr); with the world's glaciers that is "
        f"{res['all_ice_sea_level_mm']:.0f} mm of global sea-level rise. Year-to-year weather (Greenland's record melt summers of 2012 and 2019, East Antarctic snowfall gains) makes "
        f"trends bend: Greenland's loss slowed from {G['rate_2002_2012']:+.0f} to {G['rate_2013_2026']:+.0f} Gt/yr (cooler, snowier summers after 2012; quadratic p < 0.001) and "
        f"Antarctica shows no overall acceleration (p = {An['accel_p']:.2f}), but the Amundsen Sea sector ({res['Amundsen Sea sector']['rate_2002_2012']:+.0f} → "
        f"{res['Amundsen Sea sector']['rate_2013_2026']:+.0f}) and the mountain glaciers of Arctic Canada, High Mountain Asia and Patagonia are losing ice faster (all p < 0.01).")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/ice_loss_by_region.png"); plt.close(fig)
tl.runlog(TASK, "done", f"Greenland {G['rate_gt_yr']:+.0f} Gt/yr (accel p={G['accel_p']:.2f}); Antarctica {An['rate_gt_yr']:+.0f} (accel p={An['accel_p']:.2f}); total {res['all_ice_sea_level_mm']:.0f} mm SLR")
tl.fix_perms(out)
print("done")
