"""Task 20 - Evapotranspiration (ET) at the centre: what controls it, where, and is that changing?

Spatial correlation maps of deseasonalised + detrended monthly anomalies (AR(1)-adjusted significance, FDR q=0.10):
  ET vs precipitation, root-zone soil moisture, net radiation, air temperature, VPD, NDVI, daytime LST, GRACE TWS
Ecosystem Limitation Index (Denissen et al. 2020): ELI = r(ET, SM) - r(ET, Rn)  (>0 water-limited, <0 energy-limited)
ELI shift: 2003-2013 vs 2014-2025.  ET trends & ET components.
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import numpy as np
import pandas as pd
import xarray as xr

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402
from regions import REGIONS  # noqa: E402

TASK = "20_et_correlations"
out = tl.task_dir(TASK)
SRC = ("Data: NASA GLDAS-2.1 Noah (ET, soil moisture, radiation, air temperature/humidity), GPM IMERG / GPCP precipitation, "
       "MODIS NDVI & LST, GRACE/GRACE-FO. Anomalies deseasonalised & detrended; AR(1)-adjusted significance, FDR q=0.10.")
use_gpu = "gpu" in sys.argv
WATERCMAP_R = viz.div_cmap("water").reversed()

et = hub.load("et_gldas")
layers = {"P": hub.load("p_imerg") if "noimerg" not in sys.argv else hub.load("p_gpcp"),
          "SM": hub.load("sm_root"), "Rn": hub.load("rn"), "Tair": hub.load("tair"), "VPD": hub.load("vpd"),
          "NDVI": hub.load("ndvi"), "LST": hub.load("lst_day"), "TWS": hub.load("tws")}
lon, lat = hub.LON, hub.LAT
land = hub.land_mask() & (lat[:, None] > -58)
cg, names = hs.country_grid(lon, lat)
inv = {v: k for k, v in names.items()}
land &= ~(cg == inv.get("Greenland", -9))
LONG = {"P": "precipitation", "SM": "root-zone soil moisture", "Rn": "net radiation (energy)", "Tair": "air temperature",
        "VPD": "air dryness (VPD)", "NDVI": "vegetation greenness (NDVI)", "LST": "land surface temperature",
        "TWS": "total water storage (GRACE)"}


def corr_map(a, b, start="2003-01-01", end=None, lag=0):
    (A, B), t = hub.align(a, b, start=start, end=end)
    res = tl.grid_corr(A.values, B.values, t, lag=lag, use_gpu=use_gpu)
    res["r"] = np.where(land, res["r"], np.nan)
    res["sig"] = res["sig"] & land
    return res, t


summary = {}
R = {}
for k, lay in layers.items():
    # MODIS-Terra daytime LST is corrupted by orbit drift after 2019 (task 07b) -> stop there
    res, t = corr_map(et, lay, end="2019-12-31" if k == "LST" else None)
    R[k] = res
    v = res["r"][land & np.isfinite(res["r"])]
    summary[k] = dict(period=f"{t[0].date()}..{t[-1].date()}", n_months=len(t),
                      frac_sig_pos=float(np.mean((res["r"] > 0) & res["sig"]) / np.mean(land)),
                      frac_sig_neg=float(np.mean((res["r"] < 0) & res["sig"]) / np.mean(land)),
                      median_r=float(np.median(v)))
    print(f"ET vs {k:5s}: median r {summary[k]['median_r']:+.2f}; sig+ {summary[k]['frac_sig_pos']:.0%} sig- "
          f"{summary[k]['frac_sig_neg']:.0%} of land ({len(t)} months)", flush=True)
    viz.trend_map(lon, lat, res["r"], res["sig"], f"{out}/corr_ET_vs_{k}.png",
                  f"When {LONG[k]} rises, does evaporation rise too?",
                  f"Correlation of monthly ET anomalies with {LONG[k]} anomalies, {t[0].year}–{t[-1].year}. "
                  "Red = move together, blue = opposite.", "correlation r", vmax=0.8, cmap="redblue", source=SRC)

# ---- Ecosystem Limitation Index ----
eli = R["SM"]["r"] - R["Rn"]["r"]
eli_sig = (R["SM"]["sig"] | R["Rn"]["sig"]) & land
viz.trend_map(lon, lat, eli, eli_sig, f"{out}/map_ELI_water_vs_energy_limited.png",
              "What limits evaporation: water or energy?",
              "Ecosystem Limitation Index = corr(ET, soil moisture) − corr(ET, net radiation). Brown = water-limited "
              "(ET follows the rain), blue = energy-limited (ET follows sunshine).", "ELI (−1 energy-limited … +1 water-limited)",
              vmax=1.0, cmap=WATERCMAP_R, source=SRC)
for z, ext in {"east_asia": (95, 145, 15, 50), "south_asia": (60, 100, 5, 40), "africa": (-20, 55, -35, 25),
               "americas": (-125, -35, -40, 50), "europe": (-12, 45, 34, 66)}.items():
    viz.trend_map(lon, lat, eli, eli_sig, f"{out}/map_ELI_{z}.png", f"Water- vs energy-limited evaporation: {z.replace('_', ' ').title()}",
                  "ELI = corr(ET, SM) − corr(ET, Rn); brown = water-limited, blue = energy-limited", "ELI",
                  vmax=1.0, cmap=WATERCMAP_R, extent=ext, proj="plate", source=SRC)

# ---- ELI shift between two periods ----
eli_p = {}
for nm, (a, b) in {"early": ("2003-01-01", "2013-12-31"), "late": ("2014-01-01", None)}.items():
    rs, _ = corr_map(et, layers["SM"], a, b)
    rr, _ = corr_map(et, layers["Rn"], a, b)
    eli_p[nm] = rs["r"] - rr["r"]
d_eli = eli_p["late"] - eli_p["early"]
moved = land & np.isfinite(d_eli)
w = np.cos(np.deg2rad(lat))[:, None] * np.ones_like(d_eli)
frac_to_water = float(np.sum(w[moved & (d_eli > 0.2)]) / np.sum(w[moved]))
frac_to_energy = float(np.sum(w[moved & (d_eli < -0.2)]) / np.sum(w[moved]))
flip_to_water = land & (eli_p["early"] < 0) & (eli_p["late"] > 0)
frac_flip = float(np.sum(w[flip_to_water]) / np.sum(w[moved]))
print(f"ELI shift: {frac_to_water:.0%} of land moved >0.2 toward water limitation, {frac_to_energy:.0%} toward energy; "
      f"{frac_flip:.0%} flipped from energy- to water-limited", flush=True)
viz.trend_map(lon, lat, d_eli, moved & (np.abs(d_eli) > 0.2), f"{out}/map_ELI_shift_2003-13_vs_2014-25.png",
              "Is evaporation becoming more water-limited?",
              f"Change in ELI, 2014–2025 minus 2003–2013. Brown = shifting toward water limitation ({frac_to_water:.0%} of land), "
              f"blue = toward energy limitation ({frac_to_energy:.0%}). Full colour where |change| > 0.2.",
              "ΔELI", vmax=0.8, cmap=WATERCMAP_R, source=SRC)
summary["ELI_shift"] = dict(frac_to_water=frac_to_water, frac_to_energy=frac_to_energy, frac_flip_energy_to_water=frac_flip)

# ---- ET trends & partition ----
(ETa,), t_et = hub.align(et, start="2000-01-01")
g = tl.grid_trends(ETa.values, t_et, use_gpu=use_gpu, annual_min=10)
tr = np.where(land, g["slope_dec"], np.nan); sig = g["sig_both"] & land
viz.trend_map(lon, lat, tr * 365 / 10, sig, f"{out}/map_ET_trend.png", "Where is the land evaporating more water?",
              f"GLDAS evapotranspiration trend {t_et[0].year}–{t_et[-1].year} (mm per year, per decade). Blue = more evaporation.",
              "ET trend (mm/yr per decade)", vmax=60, cmap="water", source=SRC)
comp = {}
for c in ("tveg", "esoil", "ecanop"):
    (Ca,), tc = hub.align(hub.load(c), start="2000-01-01")
    gc = tl.grid_trends(Ca.values, tc, use_gpu=use_gpu, annual_min=10)
    comp[c] = np.where(land, gc["slope_dec"], np.nan)
summary["ET_trend"] = dict(frac_sig_increase=float(np.mean(sig & (tr > 0)) / np.mean(land)),
                           frac_sig_decrease=float(np.mean(sig & (tr < 0)) / np.mean(land)))
print(f"ET trend: sig increase {summary['ET_trend']['frac_sig_increase']:.0%}, sig decrease "
      f"{summary['ET_trend']['frac_sig_decrease']:.0%} of land", flush=True)

# ---- regional table ----
regs = ["Taiwan (island)", "North China Plain", "NW India (Punjab-Haryana-Rajasthan)", "Indo-Gangetic Plain",
        "Amazon deforestation arc", "Sahel", "California Central Valley", "Tigris-Euphrates (Iraq-Iran-Syria)",
        "East African lakes (Victoria)", "Benelux-Ruhr", "US Northern Great Plains", "Sichuan Basin"]
LONm, LATm = np.meshgrid(lon, lat)
rows = []
for r in regs:
    b = REGIONS[r]
    m = (LONm >= b[0]) & (LONm <= b[1]) & (LATm >= b[2]) & (LATm <= b[3]) & land
    if m.sum() == 0:
        continue
    ww = np.cos(np.deg2rad(LATm[m]))
    row = dict(region=r, ELI=float(np.nansum(eli[m] * ww) / np.sum(ww[np.isfinite(eli[m])])),
               ELI_early=float(np.nanmean(eli_p["early"][m])), ELI_late=float(np.nanmean(eli_p["late"][m])),
               ET_trend_mm_yr_dec=float(np.nanmean(tr[m]) * 365 / 10))
    for k in layers:
        row[f"r_ET_{k}"] = float(np.nanmean(R[k]["r"][m]))
    s = tl.area_mean(ETa, b).to_series()
    st = tl.series_trend(s, r, "mm/day")
    row.update(ET_mean_mm_day=st["mean"], ET_pct_dec=st["pct_per_decade"], ET_p=st["p_ols_ar1"], ET_verdict=st["verdict"])
    rows.append(row)
df = pd.DataFrame(rows)
df.to_csv(f"{out}/regional_table.csv", index=False)
print(df[["region", "ELI", "ELI_early", "ELI_late", "r_ET_P", "r_ET_SM", "r_ET_Rn", "r_ET_NDVI", "ET_pct_dec", "ET_p"]].round(2).to_string(), flush=True)
tl.save_json(summary, f"{out}/summary.json")
xr.Dataset({**{f"r_ET_{k}": (("lat", "lon"), R[k]["r"].astype(np.float32)) for k in R},
            **{f"sig_ET_{k}": (("lat", "lon"), R[k]["sig"].astype("i1")) for k in R},
            "ELI": (("lat", "lon"), eli.astype(np.float32)), "ELI_early": (("lat", "lon"), eli_p["early"].astype(np.float32)),
            "ELI_late": (("lat", "lon"), eli_p["late"].astype(np.float32)), "ET_trend_mm_day_dec": (("lat", "lon"), tr.astype(np.float32)),
            "ET_trend_sig": (("lat", "lon"), sig.astype("i1"))},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/correlation_fields.nc")
tl.runlog(TASK, "done", f"ELI: {frac_to_water:.0%} of land shifted toward water limitation vs {frac_to_energy:.0%} toward energy")
tl.fix_perms()
print("done")
