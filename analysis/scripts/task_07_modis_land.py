"""Task 07 - Vegetation greenness (MODIS NDVI, MOD13C2) and land surface temperature (MOD11C3) trends 2000-2026.

usage: python -I task_07_modis_land.py [ndvi|lst_day|lst_night] [gpu]
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import json
import numpy as np
import pandas as pd
import xarray as xr

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hotspots as hs  # noqa: E402
from regions import REGIONS  # noqa: E402

var = sys.argv[1] if len(sys.argv) > 1 else "ndvi"
use_gpu = "gpu" in sys.argv
key = "ndvi" if var in ("ndvi", "evi") else "lst"
TASK = f"07_modis_{var}"
out = tl.task_dir(TASK)
P = f"{ROOT}/data/processed/modis/{key}"
times = pd.DatetimeIndex(json.load(open(f"{P}/times.json")))
done = json.load(open(f"{P}/done.json"))
print(var, len(times), "months;", len(done), "filled", flush=True)
glob_ = np.load(f"{P}/{var}_global_0p1.npy", mmap_mode="r")
ea = np.load(f"{P}/{var}_eastasia_0p05.npy", mmap_mode="r")
# drop partial first year (2000 starts in Feb) is fine; restrict to complete months loaded
lon = -179.95 + 0.1 * np.arange(3600); lat = -89.95 + 0.1 * np.arange(1800)
lon_ea = 100.025 + 0.05 * np.arange(900); lat_ea = 15.025 + 0.05 * np.arange(700)

if var in ("ndvi", "evi"):
    SRC = "Data: NASA MODIS/Terra MOD13C2 v6.1 monthly NDVI 0.05° (LP DAAC), aggregated to 0.1°. Analysis: OLS+AR(1) & MK, FDR q=0.10."
    units, scale_title, cmap, vmax, unit_lbl = "NDVI", 1.0, "green", 0.04, "NDVI change per decade"
else:
    SRC = f"Data: NASA MODIS/Terra MOD11C3 v6.1 monthly {'daytime' if var == 'lst_day' else 'night-time'} land surface temperature (LP DAAC). Analysis: OLS+AR(1) & MK, FDR."
    units, cmap, vmax, unit_lbl = "°C", "redblue", 1.0, "°C per decade"


def run(arr, la, lo, tag):
    g = tl.grid_trends(arr, times, use_gpu=use_gpu, annual_min=8, max_cells=600_000)
    tr = g["slope_dec"]
    if var in ("ndvi", "evi"):
        barren = ~(g["mean"] > 0.12)  # deserts, water, ice
        tr = np.where(barren, np.nan, tr)
    sig = g["sig_both"] & np.isfinite(tr)
    xr.Dataset({"trend_dec": (("lat", "lon"), tr.astype(np.float32)), "sig": (("lat", "lon"), sig.astype("i1")),
                "mean": (("lat", "lon"), g["mean"].astype(np.float32)), "p_ols": (("lat", "lon"), g["p_ols"].astype(np.float32))},
               coords={"lat": la, "lon": lo}).to_netcdf(f"{out}/trend_grid_{tag}.nc")
    return tr, sig, g


tr, sig, g = run(glob_, lat, lon, "global_0p1")
land_frac = np.nansum(sig) / np.sum(np.isfinite(tr))
pos = np.nansum(sig & (tr > 0)) / max(1, np.nansum(sig))
print(f"significant fraction {land_frac:.0%}; of which positive {pos:.0%}", flush=True)
if var in ("ndvi", "evi"):
    title = "The greening — and browning — of Earth's land, 2000–2026"
    sub = "MODIS vegetation index trend. Green = getting greener (farming intensification, tree planting); brown = losing vegetation."
else:
    title = f"Land surface {'daytime' if var == 'lst_day' else 'night-time'} temperature trends, 2000–2026"
    sub = "MODIS land surface (skin) temperature trend; red = warming."
viz.trend_map(lon, lat, tr, sig, f"{out}/map_global.png", title, sub, unit_lbl, vmax=vmax, cmap=cmap, source=SRC)
zooms = {"india": (66, 98, 6, 37), "china": (98, 125, 20, 45), "amazon": (-75, -40, -20, 5), "sahel_africa": (-20, 45, -5, 20),
         "europe": (-10, 40, 35, 62), "north_america": (-128, -65, 24, 55)}
for z, ext in zooms.items():
    viz.trend_map(lon, lat, tr, sig, f"{out}/map_zoom_{z}.png", f"{title.split(',')[0]}: {z.replace('_', ' ').title()}",
                  sub, unit_lbl, vmax=vmax, cmap=cmap, extent=ext, proj="plate", source=SRC)
hot = hs.find_hotspots(lon, lat, tr, sig, min_cells=40, top=25)
hot.to_csv(f"{out}/hotspots_global.csv", index=False)
print(hot[["sign", "countries", "area_km2", "mean_trend"]].head(14).to_string(), flush=True)

# East Asia / Taiwan at full 0.05 deg
tr_e, sig_e, g_e = run(ea, lat_ea, lon_ea, "eastasia_0p05")
viz.trend_map(lon_ea, lat_ea, tr_e, sig_e, f"{out}/map_eastasia_0p05.png", f"{title.split(',')[0]}: East Asia (0.05°)",
              sub, unit_lbl, vmax=vmax, cmap=cmap, extent=(100, 145, 15, 50), proj="plate", source=SRC)
viz.trend_map(lon_ea, lat_ea, tr_e, sig_e, f"{out}/map_taiwan_0p05.png", f"{title.split(',')[0]}: Taiwan (0.05°)",
              sub, unit_lbl, vmax=vmax, cmap=cmap, extent=(119.8, 122.2, 21.8, 25.4), proj="plate", source=SRC,
              figsize=(7.5, 9.5))

# regional series from the 0.1 deg global cube
regs = ["Indo-Gangetic Plain", "North China Plain", "Amazon deforestation arc", "Sahel", "Taiwan (island)",
        "Taipei", "Beijing", "Delhi", "Dhaka", "California Central Valley", "Tigris-Euphrates (Iraq-Iran-Syria)"]
extra = {"Loess Plateau (China)": (105.0, 112.0, 35.0, 39.0), "Inner Mongolia": (108.0, 120.0, 40.0, 45.0),
         "Rondonia (Brazil)": (-65.0, -60.0, -13.0, -8.0), "Mato Grosso": (-58.0, -52.0, -14.0, -10.0)}
boxes = {r: REGIONS[r] for r in regs}; boxes.update(extra)
cube = xr.DataArray(glob_, dims=("time", "lat", "lon"), coords={"time": times, "lat": lat, "lon": lon})
stats, series = {}, {}
for r, b in boxes.items():
    s = tl.area_mean(cube.sel(lon=slice(b[0], b[1]), lat=slice(b[2], b[3])).astype(np.float32)).to_series()
    series[r] = s
    st = tl.series_trend(s, r, units)
    stats[r] = st
    print(f"{r:32s} {st['slope_per_decade']:+.4f} {units}/dec ({st['pct_per_decade']:+.1f}%/dec) p={st['p_ols_ar1']:.2g} MK={st['mk_hr_p']:.2g} {st['verdict'][:22]}", flush=True)
    viz.ts_figure(s, f"{out}/ts_{r.split(' (')[0].replace(' ', '_')}.png", f"{r}: {var.upper().replace('_', ' ')}", units, st,
                  source=SRC, show_pct=(var in ("ndvi", "evi")))
tl.save_json(stats, f"{out}/regional_stats.json")
pd.DataFrame(series).to_csv(f"{out}/regional_series.csv")
tl.runlog(TASK, "done", f"{land_frac:.0%} of vegetated land significant ({pos:.0%} positive)")
tl.fix_perms()
print("done")
