"""Task 05a - Precipitation trends 1979-2026 from GPCP v2.3 monthly (NOAA PSL), + links to GRACE hotspots."""
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

TASK = "05a_gpcp_precip"
out = tl.task_dir(TASK)
SRC = "Data: GPCP v2.3 monthly precipitation (NASA/NOAA, via NOAA PSL). Analysis: OLS+AR(1) & Mann-Kendall, FDR q=0.10."

ds = xr.open_dataset(ROOT + "/data/raw/gpcp/precip.mon.mean.nc", decode_times=False)
tt = pd.Timestamp("1800-01-01") + pd.to_timedelta(ds["time"].values.astype(float), unit="D")
da = ds["precip"].assign_coords(time=tt.to_period("M").to_timestamp())
da = tl.standardize_coords(da)  # mm/day
times = pd.DatetimeIndex(da.time.values)
print("GPCP", times[0].date(), "->", times[-1].date(), da.shape)
# keep complete years only for annual stats; monthly anomalies use everything
g = tl.grid_trends(da.values, times, annual_min=12)
lon, lat = da.lon.values, da.lat.values
polar = np.abs(lat)[:, None] > 60
pct = np.where(polar, np.nan, g["pct_dec"])  # GPCP unreliable poleward of 60 deg
sig = g["sig_both"] & ~polar
viz.trend_map(lon, lat, pct, sig, f"{out}/map_precip_trend_pct.png",
              f"Where rain is increasing and decreasing, {times[0].year}–{times[-1].year}",
              "GPCP satellite–gauge precipitation; trend as % of the local average per decade. Orange = drier, blue = wetter. Poles (>60°) masked.",
              "precipitation trend (% per decade)", vmax=10, cmap="water", source=SRC)
viz.trend_map(lon, lat, np.where(polar, np.nan, g["slope_dec"]), sig, f"{out}/map_precip_trend_abs.png",
              f"Precipitation trend {times[0].year}–{times[-1].year}",
              "GPCP; absolute change in mm/day per decade.", "mm/day per decade", cmap="water", source=SRC)
viz.trend_map(lon, lat, pct, sig, f"{out}/map_precip_trend_eastasia.png", "Rainfall trends around Taiwan & East Asia",
              f"GPCP {times[0].year}–{times[-1].year}, % per decade (2.5° grid — Taiwan is ~1 cell)", "% per decade",
              vmax=10, cmap="water", extent=(95, 150, 5, 50), proj="plate", source=SRC,
              boxes=[(*REGIONS["North China Plain"], "North China Plain"), (*REGIONS["Taiwan (island)"], "Taiwan")])
hot = hs.find_hotspots(lon, lat, pct, sig, min_cells=3, thr=2, top=20)
hot.to_csv(f"{out}/hotspots.csv", index=False)
print(hot[["sign", "countries", "area_km2", "mean_trend"]].head(12).to_string())

regs = ["Sahel", "East African lakes (Victoria)", "North China Plain", "NW India (Punjab-Haryana-Rajasthan)",
        "Tigris-Euphrates (Iraq-Iran-Syria)", "California Central Valley", "Caspian Sea", "Taiwan (island)",
        "Amazon deforestation arc", "Okavango-Zambezi", "US Northern Great Plains"]
stats, series = {}, {}
for r in regs:
    s = tl.area_mean(da, REGIONS[r]).to_series()
    series[r] = s
    st = tl.series_trend(s, r, "mm/day")
    st["since_2002"] = tl.series_trend(s, r, "mm/day", start="2002-04")
    stats[r] = st
    print(f"{r:38s} {st['pct_per_decade']:+5.1f}%/dec p={st['p_ols_ar1']:.2g} MK={st['mk_hr_p']:.2g} {st['verdict'][:20]}"
          f" | since2002 {st['since_2002']['pct_per_decade']:+5.1f}%/dec p={st['since_2002']['p_ols_ar1']:.2g}")
    viz.ts_figure(s, f"{out}/ts_{r.split(' (')[0].replace(' ', '_')}.png", f"{r}: precipitation", "mm/day", st,
                  source=SRC)
tl.save_json(stats, f"{out}/regional_stats.json")
pd.DataFrame(series).to_csv(f"{out}/regional_series_mm_day.csv")
xr.Dataset({"pct_dec": (("lat", "lon"), pct), "slope_dec": (("lat", "lon"), g["slope_dec"]),
            "sig": (("lat", "lon"), sig.astype("i1"))}, coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/trend_grid.nc")
tl.runlog(TASK, "done", f"{np.nanmean(sig):.0%} of globe significant; Sahel {stats['Sahel']['pct_per_decade']:+.1f}%/dec")
tl.fix_perms()
print("done")
