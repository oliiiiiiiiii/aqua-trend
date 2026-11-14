"""Task 08b - Ocean chlorophyll-a trends 2002-2026 (MODIS-Aqua L3m monthly 9 km, OB.DAAC). Trends on log10(chl)."""
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

TASK = "08b_chlorophyll"
out = tl.task_dir(TASK)
SRC = "Data: NASA MODIS-Aqua L3 mapped monthly chlorophyll-a 9 km, R2022 (OB.DAAC). Trend fitted to log10(chl). Analysis: OLS+AR(1) & MK, FDR."
use_gpu = "gpu" in sys.argv
P = ROOT + "/data/processed/obdaac/chl"
times = pd.DatetimeIndex(json.load(open(f"{P}/times.json")))
cube = np.load(f"{P}/chlor_a_9km.npy", mmap_mode="r")
n, ny, nx = cube.shape
dl = 360.0 / nx
lon = -180 + dl / 2 + dl * np.arange(nx); lat = -90 + dl / 2 + dl * np.arange(ny)
print("chl", times[0].date(), times[-1].date(), cube.shape, flush=True)


class LogView:
    """lazy log10 view with the (nt, ny, nx) slicing interface grid_trends uses"""
    shape = cube.shape

    def __getitem__(self, idx):
        x = np.asarray(cube[idx], dtype=np.float32)
        with np.errstate(all="ignore"):
            return np.log10(np.where(x > 0, x, np.nan))


g = tl.grid_trends(LogView(), times, use_gpu=use_gpu, annual_min=8, max_cells=500_000)
pct = (10 ** g["slope_dec"] - 1) * 100  # % per decade
sig = g["sig_both"]
frac = np.nansum(sig) / np.sum(np.isfinite(pct))
print(f"significant ocean fraction {frac:.0%}; of which decreasing {np.nansum(sig & (pct < 0)) / max(1, np.nansum(sig)):.0%}", flush=True)
viz.trend_map(lon, lat, pct, sig, f"{out}/map_chl_trend_global.png",
              "Is the ocean getting greener or bluer? Chlorophyll trends 2002–2026",
              "Phytoplankton chlorophyll-a (base of the marine food web). Green = more, brown = less (% per decade).",
              "chlorophyll-a trend (% per decade)", vmax=30, cmap="green", source=SRC, central_lon=150)
viz.trend_map(lon, lat, pct, sig, f"{out}/map_chl_trend_eastasia.png", "Chlorophyll trends around Taiwan & East Asia",
              "% per decade, MODIS-Aqua 9 km", "% per decade", vmax=40, cmap="green", extent=(105, 145, 10, 42),
              proj="plate", source=SRC)
hot = hs.find_hotspots(lon, lat, pct, sig, min_cells=200, thr=10, top=20, label_countries=False)
hot.to_csv(f"{out}/hotspots.csv", index=False)
print(hot[["sign", "area_km2", "mean_trend", "centroid_lon", "centroid_lat"]].head(10).to_string(), flush=True)

regs = {"Taiwan Strait": (118.5, 120.3, 22.5, 25.5), "East China Sea shelf": (121.0, 126.0, 27.0, 32.0),
        "Kuroshio east of Taiwan": (121.5, 124.0, 21.0, 26.0), "North Pacific subtropical gyre": (-170.0, -140.0, 18.0, 30.0),
        "South Pacific gyre": (-130.0, -100.0, -30.0, -18.0), "Arabian Sea": (60.0, 70.0, 10.0, 20.0),
        "Gulf of Mexico": (-97.0, -82.0, 20.0, 30.0), "Baltic Sea": (17.0, 24.0, 55.0, 60.0)}
xa = xr.DataArray(cube, dims=("time", "lat", "lon"), coords={"time": times, "lat": lat, "lon": lon})
stats, series = {}, {}
for r, b in regs.items():
    sub = xa.sel(lon=slice(b[0], b[1]), lat=slice(b[2], b[3])).astype(np.float32)
    s = 10 ** tl.area_mean(np.log10(sub.where(sub > 0))).to_series()  # geometric mean
    series[r] = s
    st = tl.series_trend(np.log10(s), r, "log10 mg/m3")
    st["pct_per_decade_chl"] = float((10 ** st["slope_per_decade"] - 1) * 100)
    stats[r] = st
    print(f"{r:32s} {st['pct_per_decade_chl']:+.1f}%/dec p={st['p_ols_ar1']:.2g} MK={st['mk_hr_p']:.2g} {st['verdict'][:22]}", flush=True)
    viz.ts_figure(s, f"{out}/ts_{r.replace(' ', '_')}.png", f"{r}: chlorophyll-a (geometric mean)", "mg/m³", None,
                  source=SRC, subtitle=f"Trend {st['pct_per_decade_chl']:+.1f}% per decade; p(OLS-AR1)={st['p_ols_ar1']:.2g}, "
                                       f"p(MK-HR)={st['mk_hr_p']:.2g} → {st['verdict']}")
tl.save_json(stats, f"{out}/regional_stats.json")
pd.DataFrame(series).to_csv(f"{out}/regional_series_mg_m3.csv")
xr.Dataset({"pct_dec": (("lat", "lon"), pct.astype(np.float32)), "sig": (("lat", "lon"), sig.astype("i1"))},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/trend_grid.nc")
tl.runlog(TASK, "done", f"{frac:.0%} of ocean significant")
tl.fix_perms()
print("done")
