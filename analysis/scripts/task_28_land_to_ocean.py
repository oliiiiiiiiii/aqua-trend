"""Task 28 - Planet-scale source -> destination: where does the water in sea-level rise come from? (GRACE/GRACE-FO mass budget)

Sources (land mass change, Gt/yr): Greenland, Antarctica, glaciers & ice caps (Alaska, Arctic Canada, HMA, Patagonia, Svalbard/Russian Arctic,
Iceland), and all other land (terrestrial water: aquifers, lakes, soil, snow).
Destination: ocean mass change (GRACE ocean mascons, GAD added back? -> we use lwe_thickness as provided, GIA-corrected by JPL).
1 mm of global mean sea level = 361.8 Gt.  Compared with altimetry GMSL (task 12): GMSL - ocean mass = steric (thermal expansion).
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import glob
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "28_land_to_ocean"
out = tl.task_dir(TASK)
SRC = "Data: NASA/JPL GRACE & GRACE-FO mascons RL06.3 CRI (GIA-corrected), NASA-SSH altimetry. 1 mm sea level = 361.8 Gt."
f = glob.glob(ROOT + "/data/raw/grace/GRCTellus*.nc")[0]
ds = xr.open_dataset(f)
tws = hub.load("tws")  # cm, monthly, hub grid (same 0.5 deg grid as GRACE)
lat, lon = hub.LAT, hub.LON
land = hub.land_mask()
area = hs.cell_area_km2(lon, lat) * 1e6  # m2
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
LON, LAT = np.meshgrid(lon, lat)
greenland = land & ((cg == inv.get("Greenland", -9)) | ((LON > -75) & (LON < -10) & (LAT > 59) & (LAT < 84) & ~np.isin(cg, [inv.get("Canada", -9), inv.get("Iceland", -9)])))
antarctica = land & (LAT < -60)
glacier_boxes = {"Alaska & W Canada glaciers": (-155, -120, 55, 66), "Arctic Canada & Svalbard & Russian Arctic": None,
                 "High Mountain Asia": (70, 100, 27, 40), "Patagonia & Andes": (-76, -68, -56, -40), "Iceland": (-25, -13, 63, 67)}
glac = {}
for k, b in glacier_boxes.items():
    if b is None:
        m = land & (LAT > 72) & ~greenland & ~antarctica
    else:
        m = land & (LON >= b[0]) & (LON <= b[1]) & (LAT >= b[2]) & (LAT <= b[3]) & ~greenland
    glac[k] = m
glacier_any = np.zeros_like(land)
for m in glac.values():
    glacier_any |= m
other_land = land & ~greenland & ~antarctica & ~glacier_any
ocean = ~land
A = tws.values  # cm
cm_to_gt = lambda m: (A[:, m] / 100.0 * area[m][None, :]).sum(1) / 1e12 * 1000 / 1000  # m * m2 = m3 water = 1e-9 Gt? -> fix below


def mass_gt(m):
    # cm -> m (/100); m * m2 = m3; 1 m3 water = 1000 kg = 1e-9 Gt... careful: 1 Gt = 1e12 kg = 1e9 m3
    vol_m3 = np.nansum(A[:, m] / 100.0 * area[m][None, :], axis=1)
    s = pd.Series(vol_m3 / 1e9, index=tws.time.values)
    s[np.isnan(A[:, m]).all(1)] = np.nan
    return s


parts = {"Greenland": mass_gt(greenland), "Antarctica": mass_gt(antarctica)}
for k, m in glac.items():
    parts[k] = mass_gt(m)
parts["Other land (aquifers, lakes, soil, snow)"] = mass_gt(other_land)
parts["Ocean (destination)"] = mass_gt(ocean)
rows = {}
for k, s in parts.items():
    st = tl.series_trend(s, k, "Gt")
    rows[k] = dict(trend_gt_yr=st["slope_per_decade"] / 10, ci_gt_yr=st["ci95_per_decade"] / 10, p=st["p_ols_ar1"],
                   sea_level_mm_yr=-st["slope_per_decade"] / 10 / 361.8 if k != "Ocean (destination)" else st["slope_per_decade"] / 10 / 361.8)
    print(f"{k:45s} {rows[k]['trend_gt_yr']:+8.1f} ± {rows[k]['ci_gt_yr']:.1f} Gt/yr  (sea level {rows[k]['sea_level_mm_yr']:+.2f} mm/yr) p={st['p_ols_ar1']:.2g}", flush=True)
src_total = sum(v["trend_gt_yr"] for k, v in rows.items() if k != "Ocean (destination)")
ocean_gain = rows["Ocean (destination)"]["trend_gt_yr"]
print(f"total land loss {src_total:+.1f} Gt/yr vs ocean gain {ocean_gain:+.1f} Gt/yr (mass conservation check: sum {src_total + ocean_gain:+.1f})", flush=True)
gm = pd.read_csv(ROOT + "/results/12_sea_level/regional_series_mm.csv", index_col=0, parse_dates=True)["Global mean"]
st_g = tl.series_trend(gm["2002-04":"2026-09"], "GMSL", "mm")
steric = st_g["slope_per_decade"] / 10 - rows["Ocean (destination)"]["sea_level_mm_yr"]
summary = dict(parts=rows, land_total_gt_yr=src_total, ocean_gain_gt_yr=ocean_gain, closure_gt_yr=src_total + ocean_gain,
               gmsl_altimetry_mm_yr_2002_2026=st_g["slope_per_decade"] / 10, ocean_mass_mm_yr=rows["Ocean (destination)"]["sea_level_mm_yr"],
               implied_steric_mm_yr=steric)
print(f"GMSL (altimetry 2002-2026) {st_g['slope_per_decade']/10:.2f} mm/yr = ocean mass {rows['Ocean (destination)']['sea_level_mm_yr']:.2f} + implied thermal expansion {steric:.2f} mm/yr", flush=True)
tl.save_json(summary, f"{out}/stats.json")
pd.DataFrame(parts).to_csv(f"{out}/mass_series_gt.csv")

# --- figure 1: source -> destination bars (sea-level equivalent) ---
order = [k for k in rows if k != "Ocean (destination)"]
vals = [rows[k]["sea_level_mm_yr"] for k in order]
fig, ax = plt.subplots(figsize=(11, 5.8), dpi=170)
fig.subplots_adjust(left=0.36, right=0.96, top=0.82, bottom=0.12)
y = np.arange(len(order) + 2)[::-1]
cols = [viz.SERIES[1] if v > 0 else viz.SERIES[0] for v in vals]
ax.barh(y[:len(order)], vals, color=cols, height=0.6)
ax.barh(y[len(order)], sum(vals), color=viz.INK2, height=0.6)
ax.barh(y[len(order) + 1], rows["Ocean (destination)"]["sea_level_mm_yr"], color="#1c5cab", height=0.6)
ax.set_yticks(y); ax.set_yticklabels(order + ["SUM of land sources", "Ocean mass gain (destination)"], fontsize=9.5, color=viz.INK2)
for yi, v in zip(y, vals + [sum(vals), rows["Ocean (destination)"]["sea_level_mm_yr"]]):
    ax.text(v + (0.02 if v >= 0 else -0.02), yi, f"{v:+.2f}", va="center", ha="left" if v >= 0 else "right", fontsize=9, color=viz.INK)
ax.axvline(0, color=viz.AXIS, lw=1)
for sp in ("top", "right", "left"):
    ax.spines[sp].set_visible(False)
ax.grid(axis="x", color=viz.GRID, lw=0.6); ax.tick_params(length=0)
ax.set_xlabel("contribution to global sea level (mm per year), 2002–2026", color=viz.INK2)
fig.text(0.02, 0.965, "Where the water in sea-level rise comes from", fontsize=15, fontweight="bold", va="top")
fig.text(0.02, 0.915, f"GRACE weighs every region monthly: land loses {-src_total:.0f} Gt of water per year, the ocean gains {ocean_gain:.0f} Gt "
         f"(mass conserved within {abs(src_total + ocean_gain):.0f} Gt/yr). Altimetry sea level {st_g['slope_per_decade']/10:.1f} mm/yr − ocean mass "
         f"{rows['Ocean (destination)']['sea_level_mm_yr']:.1f} = thermal expansion ≈ {steric:.1f} mm/yr.", fontsize=9, color=viz.INK2, va="top", wrap=True)
fig.text(0.96, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/sources_to_ocean_bars.png"); plt.close(fig)

# --- figure 2: cumulative mass time series ---
fig, ax = plt.subplots(figsize=(11, 5.2), dpi=170)
fig.subplots_adjust(left=0.08, right=0.80, top=0.84, bottom=0.10)
plot = {"Greenland": viz.SERIES[1], "Antarctica": viz.SERIES[6], "Other land (aquifers, lakes, soil, snow)": viz.SERIES[3],
        "Ocean (destination)": viz.SERIES[0]}
glac_sum = sum(parts[k] for k in glac)
series_plot = {"Greenland": parts["Greenland"], "Antarctica": parts["Antarctica"], "Glaciers & ice caps": glac_sum,
               "Other land (aquifers, lakes, soil, snow)": parts["Other land (aquifers, lakes, soil, snow)"], "Ocean (destination)": parts["Ocean (destination)"]}
colors = [viz.SERIES[1], viz.SERIES[6], viz.SERIES[2], viz.SERIES[3], viz.SERIES[0]]
for (k, s), c in zip(series_plot.items(), colors):
    s = s.asfreq("MS") if hasattr(s, "asfreq") else s
    s0 = s - s["2002-04":"2003-03"].mean()
    r = s0.rolling(12, center=True, min_periods=8).mean()
    ax.plot(r.index, r.values, color=c, lw=2.2, label=k)
    last = r.dropna()
    ax.text(last.index[-1], last.values[-1], "  " + k.split(" (")[0], fontsize=8.5, color=viz.INK2, va="center")
ax.axhline(0, color=viz.AXIS, lw=0.8)
for sp in ("top", "right", "left"):
    ax.spines[sp].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.6); ax.tick_params(length=0)
ax.set_ylabel("mass change since 2002 (Gt)", color=viz.INK2)
ax.legend(frameon=False, fontsize=8.5, loc="lower left")
fig.text(0.08, 0.965, "Water leaving the land, arriving in the ocean (GRACE, 2002–2026)", fontsize=14, fontweight="bold", va="top")
fig.text(0.08, 0.915, "12-month running mean of mass change relative to 2002–03. Land sources fall, the ocean rises by the same amount.",
         fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/cumulative_mass.png"); plt.close(fig)
tl.runlog(TASK, "done", f"land {src_total:+.0f} Gt/yr vs ocean {ocean_gain:+.0f} Gt/yr; steric {steric:.2f} mm/yr")
tl.fix_perms(out)
print("done")
