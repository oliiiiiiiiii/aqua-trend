"""Task 45 - Where is the world burning more, and where less? MODIS active fires 2003-2025 (FIRMS, vegetation fires).

Data: NASA FIRMS MODIS C6.1 archive (Terra ~10:30 and Aqua ~13:30 local overpass), type 0 (vegetation), confidence >= 30,
aggregated to 0.5 deg monthly counts (fetch_nonhydro.py). 2003 = first full year with both satellites.
Method: annual detections per cell; Sen slope + Mann-Kendall (FDR q=0.10) for Aqua and Terra separately.
'Robust' cell = significant in Aqua and same-sign trend in Terra (each satellite is an independent sampler).
Orbit drift caveat: Terra (since 2020) drifts to earlier, Aqua (since 2022) to later overpass times, which changes the
number of fires caught in the afternoon peak -> sensitivity 2003-2019 (both stable) and Terra/Aqua comparison.
"""
import sys
import textwrap
import numpy as np
import pandas as pd
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

TASK = "45_fire_trends"
out = tl.task_dir(TASK)
SRC = "Data: NASA FIRMS, MODIS Collection 6.1 active fires (Terra & Aqua), vegetation fires, 2003–2025."
YRS = np.arange(2003, 2026)
lat = np.arange(-89.75, 90, 0.5); lon = np.arange(-179.75, 180, 0.5)
w = np.cos(np.deg2rad(lat))[:, None] * np.ones((360, 720))
AT = np.zeros((len(YRS), 360, 720), np.float32); TT = np.zeros_like(AT); MON = np.zeros((len(YRS), 12, 360, 720), np.float32)
for k, y in enumerate(YRS):
    z = np.load(f"{ROOT}/data/processed/firms/modis_{y}_0p5_monthly.npz")
    AT[k] = z["count_A"].sum(0); TT[k] = z["count_T"].sum(0); MON[k] = z["count"]
mA = AT.mean(0)
burn = mA >= 20                                    # cells with >= 20 Aqua detections per year on average


def cell_trend(C, yrs=YRS):
    mk = tl.mk_grid(C.reshape(len(yrs), -1))
    sen = tl.sen_grid(C.reshape(len(yrs), -1), yrs.astype(float))
    slope = np.asarray(sen).reshape(C.shape[1:]) if not isinstance(sen, dict) else np.asarray(sen["slope"]).reshape(C.shape[1:])
    return slope, mk["p"].reshape(C.shape[1:])


sA, pA = cell_trend(AT); sT, pT = cell_trend(TT)
pA = np.where(burn, pA, np.nan)
sigA = tl.fdr_mask(pA, q=0.10)
with np.errstate(all="ignore"):
    pct = np.where(burn, sA / mA * 1000, np.nan)    # % per decade
robust = sigA & (np.sign(sA) == np.sign(sT))
fw = lambda m: float(np.sum(w[m]) / np.sum(w[burn]))
res = dict(burning_cells=int(burn.sum()), frac_robust_down=fw(robust & (sA < 0)), frac_robust_up=fw(robust & (sA > 0)),
           frac_sign_agree_terra_aqua=float(np.mean((np.sign(sA) == np.sign(sT))[burn])))
# sensitivity 2003-2019
k19 = YRS <= 2019
sA19, pA19 = cell_trend(AT[k19], YRS[k19])
res["sign_agree_full_vs_2003_2019"] = float(np.mean((np.sign(sA19) == np.sign(sA))[burn & sigA]))
print(res, flush=True)

REG = {"Boreal North America": (-170, -52, 50, 72), "Siberia & Russian Far East": (60, 180, 50, 75), "Western US": (-125, -103, 31, 49),
       "Northern African savanna": (-18, 45, 0, 16), "Southern African savanna": (10, 42, -20, 0), "Amazon & Cerrado": (-75, -40, -20, 0),
       "Australia": (112, 155, -40, -10), "Mainland SE Asia": (94, 110, 10, 25), "Indonesia & Malaysia": (95, 142, -10, 7),
       "Punjab & Haryana": (73.5, 77.5, 29, 32.5)}
rows, ser = [], {}
for nm, (x0, x1, y0, y1) in REG.items():
    m = (lat[:, None] >= y0) & (lat[:, None] <= y1) & (lon[None] >= x0) & (lon[None] <= x1)
    a = pd.Series(AT[:, m].sum(1), index=YRS); t = pd.Series(TT[:, m].sum(1), index=YRS)
    ser[nm] = (a, t)
    r = dict(region=nm, aqua_mean=float(a.mean()), record_year=int((a + t).idxmax()))
    for lab, s_ in (("aqua", a), ("terra", t)):
        tau = stats.kendalltau(YRS, s_.values)
        sl = stats.theilslopes(s_.values, YRS)[0]
        r[f"{lab}_pct_per_decade"] = float(sl / s_.mean() * 1000); r[f"{lab}_mk_p"] = float(tau.pvalue)
        tau19 = stats.kendalltau(YRS[k19], s_.values[k19]); sl19 = stats.theilslopes(s_.values[k19], YRS[k19])[0]
        r[f"{lab}_pct_per_decade_2003_2019"] = float(sl19 / s_[k19].mean() * 1000); r[f"{lab}_mk_p_2003_2019"] = float(tau19.pvalue)
    rows.append(r)
reg = pd.DataFrame(rows); reg.to_csv(f"{out}/regions_fire_trends.csv", index=False)
print(reg.round(3).to_string(), flush=True)
res["regions"] = rows
ga = pd.Series(AT.sum((1, 2)), index=YRS); gt = pd.Series(TT.sum((1, 2)), index=YRS)
for lab, s_ in (("global_aqua", ga), ("global_terra", gt)):
    res[lab] = dict(pct_per_decade=float(stats.theilslopes(s_.values, YRS)[0] / s_.mean() * 1000), mk_p=float(stats.kendalltau(YRS, s_.values).pvalue),
                    pct_per_decade_2003_2019=float(stats.theilslopes(s_.values[k19], YRS[k19])[0] / s_[k19].mean() * 1000),
                    mk_p_2003_2019=float(stats.kendalltau(YRS[k19], s_.values[k19]).pvalue))
print("global:", res["global_aqua"], res["global_terra"], flush=True)
# fire season length: months with >= 10% of the cell's annual mean detections... keep simple: share of fires in the peak 3 months
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------- map
fig = plt.figure(figsize=(13, 7.0), dpi=180)
ax = fig.add_axes([0.01, 0.15, 0.98, 0.67], projection=ccrs.Robinson())
ax.set_global()
ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", zorder=0)
cm = viz.div_cmap("redblue")
ext = [-180, 180, -90, 90]
ax.imshow(np.where(robust, np.nan, pct), origin="lower", extent=ext, transform=ccrs.PlateCarree(), cmap=cm, vmin=-100, vmax=100, alpha=0.28,
          interpolation="nearest", zorder=1)
im = ax.imshow(np.where(robust, pct, np.nan), origin="lower", extent=ext, transform=ccrs.PlateCarree(), cmap=cm, vmin=-100, vmax=100,
               interpolation="nearest", zorder=2)
ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.4, edgecolor=viz.INK2, zorder=3)
ax.add_feature(cfeature.BORDERS.with_scale("110m"), linewidth=0.2, edgecolor=viz.MUTED, zorder=3)
ax.set_extent([-180, 180, -50, 75], ccrs.PlateCarree())
cax = fig.add_axes([0.3, 0.10, 0.4, 0.022])
cb = fig.colorbar(im, cax=cax, orientation="horizontal"); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=8, length=0)
cb.set_label("trend in fire detections 2003–2025 (% per decade; blue = fewer fires; faded = not robust)", fontsize=8.5, color=viz.INK2)
rg = {r["region"]: r for r in rows}
fig.text(0.01, 0.965, "The world is burning less: fewer fires in savannas, steppe farmland, eastern China and Indonesia", fontsize=15, fontweight="bold", va="top")
sub = (f"MODIS fire detections per 0.5° cell. Full colour = significant in Aqua (Mann–Kendall, FDR q=0.10) and the same direction in Terra. "
       f"Robust decline on {res['frac_robust_down']:.0%} of burning land, increase on {res['frac_robust_up']:.0%} (central India, NE China, the Andes–Amazon edge). "
       f"Globally {res['global_aqua']['pct_per_decade']:+.0f}%/decade in both satellites (p < 0.001, also before orbit drift began). Boreal North America is the exception: "
       f"{rg['Boreal North America']['aqua_pct_per_decade']:+.0f}%/decade with a record in {rg['Boreal North America']['record_year']}, but too variable to be significant (p = {rg['Boreal North America']['aqua_mk_p']:.2f}).")
fig.text(0.01, 0.915, "\n".join(textwrap.wrap(sub, 175)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.99, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/map_fire_trend.png"); plt.close(fig)

# ------------------------------------------------------------- regional series (Aqua and Terra)
fig, axs = plt.subplots(2, 5, figsize=(14.5, 6.6), dpi=170)
fig.subplots_adjust(left=0.05, right=0.99, top=0.79, bottom=0.08, hspace=0.5, wspace=0.28)
for ax, nm in zip(axs.ravel(), REG):
    a, t = ser[nm]; r = rg[nm]
    ax.plot(YRS, a / 1e3, color=viz.SERIES[1], lw=2.0)
    ax.plot(YRS, t / 1e3, color=viz.SERIES[0], lw=1.4, alpha=0.8)
    ax.set_title(nm, fontsize=9.3, loc="left", fontweight="bold", color=viz.INK)
    ok = r["aqua_mk_p"] < 0.05 and np.sign(r["aqua_pct_per_decade"]) == np.sign(r["terra_pct_per_decade"])
    ax.text(0.02, 0.97, f"Aqua {r['aqua_pct_per_decade']:+.0f}%/dec (p={r['aqua_mk_p']:.2g})\nTerra {r['terra_pct_per_decade']:+.0f}%/dec"
            + ("" if ok else "\n(not robust)"), transform=ax.transAxes, fontsize=7.6, va="top", color=viz.INK2)
    ax.set_ylim(0, max(a.max(), t.max()) / 1e3 * 1.45)
    for sp_ in ("top", "right", "left"):
        ax.spines[sp_].set_visible(False)
    ax.grid(axis="y", color=viz.GRID, lw=0.6); ax.tick_params(length=0, labelsize=7.5)
axs[0, 0].set_ylabel("thousand detections / yr", color=viz.INK2, fontsize=8.5); axs[1, 0].set_ylabel("thousand detections / yr", color=viz.INK2, fontsize=8.5)
axs[0, 0].text(2004, axs[0, 0].get_ylim()[1] * 0.62, "Aqua (13:30)", color=viz.SERIES[1], fontsize=8, fontweight="bold")
axs[0, 0].text(2004, axs[0, 0].get_ylim()[1] * 0.52, "Terra (10:30)", color=viz.SERIES[0], fontsize=8, fontweight="bold")
fig.text(0.05, 0.965, "Fire regions, year by year, seen by two satellites", fontsize=15, fontweight="bold", va="top")
sub = (f"Annual vegetation-fire detections. A trend counts as robust only if Aqua is significant and Terra agrees in direction. Global: Aqua "
       f"{res['global_aqua']['pct_per_decade']:+.0f}%/decade (p={res['global_aqua']['mk_p']:.0e}), Terra {res['global_terra']['pct_per_decade']:+.0f}%/decade "
       f"(p={res['global_terra']['mk_p']:.0e}); the same in 2003–2019, before either orbit drifted. Punjab's crop-stubble fires: the satellites disagree on the "
       f"long-term trend, but both show the collapse after 2021.")
fig.text(0.05, 0.915, "\n".join(textwrap.wrap(sub, 190)), fontsize=9.3, color=viz.INK2, va="top")
fig.text(0.99, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/regional_fire_series.png"); plt.close(fig)
tl.runlog(TASK, "done", f"robust down {res['frac_robust_down']:.0%} / up {res['frac_robust_up']:.0%} of burning land; global Aqua {res['global_aqua']['pct_per_decade']:+.0f}%/dec")
tl.fix_perms(out)
print("done")
