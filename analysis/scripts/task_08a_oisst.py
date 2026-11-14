"""Task 08a - Sea surface temperature trends 1982-2026 (NOAA OISST v2.1 monthly 0.25 deg), focus Taiwan/East Asia."""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import numpy as np
import pandas as pd
import xarray as xr

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hotspots as hs  # noqa: E402
from regions import REGIONS  # noqa: E402

TASK = "08a_sst_oisst"
out = tl.task_dir(TASK)
SRC = "Data: NOAA OISST v2.1 (AVHRR satellite + in situ), monthly 0.25°. Analysis: OLS+AR(1) & Mann-Kendall, FDR q=0.10."
use_gpu = len(sys.argv) > 1 and sys.argv[1] == "gpu"

ds = xr.open_dataset(ROOT + "/data/raw/oisst/sst.mon.mean.nc")
da = tl.standardize_coords(ds["sst"]).sel(time=slice("1982-01-01", None))
times = pd.DatetimeIndex(da.time.values)
print("OISST", times[0].date(), times[-1].date(), da.shape, flush=True)
arr = da.values.astype(np.float32)
# mask sea-ice affected cells (SST at freezing point most of the time)
icey = np.nanmean(arr < -1.0, axis=0) > 0.1
g = tl.grid_trends(arr, times, use_gpu=use_gpu, annual_min=12)
lon, lat = da.lon.values, da.lat.values
tr = np.where(icey, np.nan, g["slope_dec"])
sig = g["sig_both"] & ~icey
glob_frac = np.nansum(sig) / np.sum(np.isfinite(tr))
print(f"significant fraction of ocean: {glob_frac:.0%}")
viz.trend_map(lon, lat, tr, sig, f"{out}/map_sst_trend_global.png",
              f"How fast the ocean surface is warming, {times[0].year}–{times[-1].year}",
              "Sea surface temperature trend. Nearly every ocean warmed; hotspots: NW Pacific/Kuroshio, Gulf Stream, Arctic margins.",
              "°C per decade", vmax=0.6, cmap="redblue", source=SRC, central_lon=150)
viz.trend_map(lon, lat, tr, sig, f"{out}/map_sst_trend_eastasia.png",
              "Seas around Taiwan & East Asia are warming fast",
              f"Sea surface temperature trend {times[0].year}–{times[-1].year} (°C per decade)", "°C per decade",
              vmax=0.6, cmap="redblue", extent=(105, 150, 10, 45), proj="plate", source=SRC,
              boxes=[(*REGIONS[r], r) for r in ("Taiwan Strait", "East China Sea", "Kuroshio east of Taiwan")])
hot = hs.find_hotspots(lon, lat, tr, sig, min_cells=50, thr=0.3, top=15, label_countries=False)
hot.to_csv(f"{out}/hotspots.csv", index=False)
print(hot[["sign", "area_km2", "mean_trend", "centroid_lon", "centroid_lat"]].head(10).to_string())

regs = {"Taiwan Strait": REGIONS["Taiwan Strait"], "East China Sea": REGIONS["East China Sea"],
        "Kuroshio east of Taiwan": REGIONS["Kuroshio east of Taiwan"],
        "South China Sea (north)": (110.0, 120.0, 15.0, 22.0), "Sea of Japan": (130.0, 140.0, 35.0, 42.0),
        "Gulf of Maine / NW Atlantic": (-71.0, -60.0, 40.0, 45.0), "Mediterranean": (0.0, 35.0, 31.0, 44.0),
        "Global 60S-60N": (-180.0, 180.0, -60.0, 60.0)}
stats, series = {}, {}
for r, b in regs.items():
    s = tl.area_mean(da, b).to_series()
    series[r] = s
    st = tl.series_trend(s, r, "°C")
    # marine-heat proxy: months above the 1982-2011 90th percentile of anomalies
    an = s - s.groupby(s.index.month).transform("mean")
    thr = an["1982":"2011"].quantile(0.9)
    hot_m = (an > thr).groupby(an.index.year).sum()
    st["hot_months_per_year_1982_1991"] = float(hot_m.loc[1982:1991].mean())
    st["hot_months_per_year_2016_2025"] = float(hot_m.loc[2016:2025].mean())
    stats[r] = st
    print(f"{r:30s} {st['slope_per_decade']:+.3f} ± {st['ci95_per_decade']:.3f} °C/dec p={st['p_ols_ar1']:.2g} "
          f"MK={st['mk_hr_p']:.2g}  hot months/yr {st['hot_months_per_year_1982_1991']:.1f} -> {st['hot_months_per_year_2016_2025']:.1f}")
    viz.ts_figure(an, f"{out}/ts_{r.split(' (')[0].replace(' ', '_').replace('/', '-')}.png",
                  f"{r}: sea surface temperature anomaly", "°C", st, source=SRC, show_pct=False,
                  subtitle=f"Months in the top-10% warm range: {st['hot_months_per_year_1982_1991']:.1f}/yr (1982–91) → "
                           f"{st['hot_months_per_year_2016_2025']:.1f}/yr (2016–25)")
tl.save_json(stats, f"{out}/regional_stats.json")
pd.DataFrame(series).to_csv(f"{out}/regional_series_degC.csv")
xr.Dataset({"trend_degC_dec": (("lat", "lon"), tr), "sig": (("lat", "lon"), sig.astype("i1"))},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/trend_grid.nc")
tl.runlog(TASK, "done", f"{glob_frac:.0%} of ice-free ocean significant; Taiwan Strait "
          f"{stats['Taiwan Strait']['slope_per_decade']:+.2f} °C/dec")
tl.fix_perms()
print("done")
