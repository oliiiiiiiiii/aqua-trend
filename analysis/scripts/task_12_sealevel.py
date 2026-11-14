"""Task 12 - Sea level rise 1993-2026 from NASA-SSH simple gridded altimetry (PO.DAAC), incl. acceleration."""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import glob
import numpy as np
import pandas as pd
import xarray as xr
import netCDF4

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "12_sea_level"
out = tl.task_dir(TASK)
SRC = "Data: NASA-SSH Simple Gridded SSH v1.1 (TOPEX→Jason→Sentinel-6 reference missions, PO.DAAC). Analysis: OLS+AR(1), Mann-Kendall, FDR."

files = sorted(glob.glob(ROOT + "/data/raw/nasassh/NASA-SSH_alt_ref_simple_grid_v1_1_*.nc"))
print("weekly files:", len(files), flush=True)
dates, stack = [], []
for f in files:
    with netCDF4.Dataset(f) as nc:
        nc.set_auto_mask(True)
        x = nc["ssha"][:].filled(np.nan).astype(np.float32)
        lat = nc["latitude"][:]; lon = nc["longitude"][:]
    d = pd.Timestamp(f.split("_")[-1][:8])
    dates.append(d); stack.append(x)
arr = np.stack(stack) * 1000.0  # mm
del stack
months = pd.DatetimeIndex(dates).to_period("M").to_timestamp()
um = months.unique()
mon = np.full((len(um),) + arr.shape[1:], np.nan, np.float32)
for i, m in enumerate(um):
    with np.errstate(all="ignore"):
        mon[i] = np.nanmean(arr[months == m], axis=0)
del arr
da = xr.DataArray(mon, dims=("time", "lat", "lon"), coords={"time": um, "lat": lat, "lon": lon})
da = tl.standardize_coords(da)
da = da.sel(time=slice("1993-01-01", None))
times = pd.DatetimeIndex(da.time.values)
print("monthly", times[0].date(), times[-1].date(), da.shape, flush=True)
g = tl.grid_trends(da.values, times, annual_min=10)
lon, lat = da.lon.values, da.lat.values
tr = g["slope_dec"] / 10.0  # mm/yr
sig = g["sig_both"]
viz.trend_map(lon, lat, tr, sig, f"{out}/map_sea_level_trend.png",
              f"Sea level is rising almost everywhere — but not evenly ({times[0].year}–{times[-1].year})",
              "Satellite altimetry; local rate of change. Fastest: Kuroshio Extension east of Japan, Gulf of Mexico, SW Pacific. Global mean ≈ +10 cm since 1993.",
              "sea level trend (mm per year)", vmax=8, cmap="redblue", source=SRC, central_lon=150)
viz.trend_map(lon, lat, tr, sig, f"{out}/map_sea_level_eastasia.png", "Sea level rise around Taiwan & East Asia",
              f"Altimetry {times[0].year}–{times[-1].year}, mm per year", "mm per year", vmax=8, cmap="redblue",
              extent=(105, 150, 5, 45), proj="plate", source=SRC,
              boxes=[(119.0, 123.0, 21.0, 26.0, "Taiwan seas")])

# global mean (66S-66N) & acceleration with HAC errors
gm = tl.area_mean(da, (-180, 180, -66, 66)).to_series()
an = gm - gm.groupby(gm.index.month).transform("mean")
t = tl.decimal_year(an.index); t0 = t - t.mean()
import statsmodels.api as sm
X = sm.add_constant(np.column_stack([t0, t0 ** 2]))
fit = sm.OLS(an.values, X, missing="drop").fit(cov_type="HAC", cov_kwds={"maxlags": 12})
b1, b2 = fit.params[1], fit.params[2]
se2 = fit.bse[2]
rate_start = b1 + 2 * b2 * (t[0] - t.mean()); rate_end = b1 + 2 * b2 * (t[-1] - t.mean())
acc = dict(mean_rate_mm_yr=float(b1), acceleration_mm_yr2=float(2 * b2), acceleration_ci95=float(2 * 1.96 * se2),
           p_acceleration=float(fit.pvalues[2]), rate_at_start=float(rate_start), rate_at_end=float(rate_end),
           total_rise_mm=float(an.rolling(12, center=True).mean().dropna().iloc[-1] - an.rolling(12, center=True).mean().dropna().iloc[0]))
print("GMSL:", acc)
stg = tl.series_trend(gm, "Global mean sea level (66S-66N)", "mm")
viz.ts_figure(an, f"{out}/ts_global_mean_sea_level.png", "Global mean sea level is rising — and speeding up", "mm",
              stg, source=SRC, show_pct=False,
              subtitle=f"Rate {acc['rate_at_start']:.1f} mm/yr in {times[0].year} → {acc['rate_at_end']:.1f} mm/yr in "
                       f"{times[-1].year}; acceleration {acc['acceleration_mm_yr2']:.3f} ± {acc['acceleration_ci95']:.3f} mm/yr² "
                       f"(p={acc['p_acceleration']:.1g})")
regs = {"Taiwan seas": (119.0, 123.0, 21.0, 26.0), "Taiwan Strait": (118.5, 120.3, 22.5, 25.5),
        "Philippine Sea": (125.0, 135.0, 10.0, 20.0), "East China Sea": (122.0, 128.0, 26.0, 32.0),
        "Gulf of Mexico": (-97.0, -82.0, 20.0, 30.0), "Bay of Bengal": (80.0, 95.0, 10.0, 22.0),
        "US East Coast shelf": (-76.0, -66.0, 35.0, 44.0)}
stats = {"global": dict(series=stg, acceleration=acc)}
series = {"Global mean": gm}
for r, b in regs.items():
    s = tl.area_mean(da, b).to_series()
    series[r] = s
    st = tl.series_trend(s, r, "mm")
    st["ratio_to_global"] = st["slope_per_decade"] / stg["slope_per_decade"]
    stats[r] = st
    print(f"{r:20s} {st['slope_per_decade']/10:+.2f} ± {st['ci95_per_decade']/10:.2f} mm/yr (x{st['ratio_to_global']:.2f} global) p={st['p_ols_ar1']:.2g}")
    a = s - s.groupby(s.index.month).transform("mean")
    viz.ts_figure(a, f"{out}/ts_{r.replace(' ', '_')}.png", f"{r}: sea level anomaly", "mm", st, source=SRC, show_pct=False,
                  subtitle=f"{st['ratio_to_global']:.1f}× the global-mean rate")
tl.save_json(stats, f"{out}/stats.json")
pd.DataFrame(series).to_csv(f"{out}/regional_series_mm.csv")
xr.Dataset({"trend_mm_yr": (("lat", "lon"), tr), "sig": (("lat", "lon"), sig.astype("i1"))},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/trend_grid.nc")
tl.runlog(TASK, "done", f"GMSL {acc['mean_rate_mm_yr']:.2f} mm/yr, accel {acc['acceleration_mm_yr2']:.3f} mm/yr2; "
          f"Taiwan seas {stats['Taiwan seas']['slope_per_decade']/10:.1f} mm/yr")
tl.fix_perms()
print("done")
