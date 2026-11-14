"""Task 01 - Terrestrial water storage / groundwater depletion from GRACE & GRACE-FO (JPL mascon RL06.3 CRI)."""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import glob
import numpy as np
import pandas as pd
import xarray as xr

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hotspots as hs  # noqa: E402
from regions import REGIONS  # noqa: E402

TASK = "01_grace_water_storage"
out = tl.task_dir(TASK)
SRC = "Data: NASA/JPL GRACE & GRACE-FO mascon RL06.3 CRI (PO.DAAC). Analysis: OLS+AR(1) & Mann-Kendall."

f = glob.glob(ROOT + "/data/raw/grace/GRCTellus*.nc")[0]
ds = xr.open_dataset(f)
da = tl.standardize_coords(ds["lwe_thickness"])  # cm, (time, lat, lon)
land = tl.standardize_coords(ds["land_mask"]).values > 0.5

# --- monthly index (average duplicates, reindex to full calendar so gaps are NaN) ---
mon = pd.DatetimeIndex(da.time.values).to_period("M").to_timestamp()
da = da.assign_coords(time=mon).groupby("time").mean()
full = pd.date_range(mon.min(), mon.max(), freq="MS")
da = da.reindex(time=full)
print("months:", len(full), "missing:", int(np.isnan(da.isel(lat=180, lon=360)).sum()))
lon, lat = da.lon.values, da.lat.values

g = tl.grid_trends(da.values, full, use_gpu=False, annual_min=6)
trend_yr = g["slope_dec"] / 10.0  # cm/yr
sig = g["sig_both"]

# --- masks: land, and land excluding ice sheets ---
cg, names = hs.country_grid(lon, lat)
inv = {v: k for k, v in names.items()}
greenland = cg == inv.get("Greenland", -999)
antarctica = (lat[:, None] < -60) | (cg == inv.get("Antarctica", -999))
land_noice = land & ~greenland & ~antarctica

# --- maps ---
viz.trend_map(lon, lat, np.where(land, trend_yr, np.nan), sig, f"{out}/map_global_land_ice.png",
              "Where Earth's land is losing (and gaining) water, 2002–2026",
              "GRACE/GRACE-FO total water storage trend (groundwater + soil + snow + ice + lakes). Ice sheets saturate the scale.",
              "water storage trend (cm of water per year)", vmax=4, cmap="water", source=SRC)
viz.trend_map(lon, lat, np.where(land_noice, trend_yr, np.nan), sig, f"{out}/map_land_water_security.png",
              "Disappearing water: land water storage trends 2002–2026",
              "Orange = losing water (groundwater pumping, drought, glacier melt); blue = gaining. Greenland & Antarctica excluded.",
              "water storage trend (cm of water per year)", vmax=2.5, cmap="water", source=SRC)
zooms = {
    "south_asia": ((60, 100, 5, 40), ["NW India (Punjab-Haryana-Rajasthan)", "Indo-Gangetic Plain"]),
    "middle_east": ((25, 65, 15, 45), ["Tigris-Euphrates (Iraq-Iran-Syria)", "Caspian Sea", "Arabian aquifers (Saudi)"]),
    "east_asia": ((95, 145, 15, 50), ["North China Plain", "Taiwan (island)"]),
    "north_america": ((-130, -65, 22, 55), ["California Central Valley", "US Northern Great Plains"]),
    "africa": ((-20, 55, -35, 25), ["East African lakes (Victoria)", "Okavango-Zambezi"]),
}
for nm, (ext, regs) in zooms.items():
    viz.trend_map(lon, lat, np.where(land_noice, trend_yr, np.nan), sig, f"{out}/map_zoom_{nm}.png",
                  f"Water storage trend 2002–2026: {nm.replace('_', ' ').title()}",
                  "GRACE/GRACE-FO; orange = losing water, blue = gaining", "cm of water per year",
                  vmax=3, cmap="water", extent=ext, proj="plate", source=SRC,
                  boxes=[(*REGIONS[r], r) for r in regs])

# --- hotspots (land, no ice sheets) with volume in km3/yr (1 cm over 1 km2 = 1e-5 km3) ---
hot = hs.find_hotspots(lon, lat, np.where(land_noice, trend_yr, np.nan), sig & land_noice, min_cells=6,
                       thr=0.5, top=25)
if not hot.empty:
    hot["volume_km3_per_yr"] = hot["mean_trend"] * hot["area_km2"] * 1e-5
hot.to_csv(f"{out}/hotspots_land.csv", index=False)
print(hot[["sign", "countries", "area_km2", "mean_trend", "peak_trend", "volume_km3_per_yr"]].head(20).to_string())

# --- regional series ---
regions = ["NW India (Punjab-Haryana-Rajasthan)", "North China Plain", "Tigris-Euphrates (Iraq-Iran-Syria)",
           "California Central Valley", "Caspian Sea", "Arabian aquifers (Saudi)", "East African lakes (Victoria)",
           "US Northern Great Plains", "Okavango-Zambezi", "Taiwan (island)", "Greenland", "Alaska coastal glaciers",
           "Patagonia icefields", "High Mountain Asia", "Amazon deforestation arc"]
stats = {}
series = {}
for r in regions:
    s = tl.area_mean(da, REGIONS[r]).to_series()
    series[r] = s
    st = tl.series_trend(s, r, "cm")
    b = REGIONS[r]
    a_km2 = hs.cell_area_km2(np.arange(b[0], b[1], 0.5), np.arange(b[2], b[3], 0.5)).sum()
    st["approx_area_km2"] = float(a_km2)
    st["volume_km3_per_yr"] = st["slope_per_decade"] / 10 * a_km2 * 1e-5
    stats[r] = st
    viz.ts_figure(s, f"{out}/ts_{r.split(' (')[0].replace(' ', '_').replace('/', '-')}.png",
                  f"{r}: water storage anomaly", "cm", st,
                  subtitle=f"≈ {st['volume_km3_per_yr']:+.1f} km³ of water per year over the box",
                  source=SRC, events=[("2017-07-01", "GRACE→GRACE-FO gap")], show_pct=False)
    print(f"{r:40s} {st['slope_per_decade']/10:+.2f} cm/yr  p={st['p_ols_ar1']:.2g}  MK={st['mk_hr_p']:.2g}  "
          f"vol={st['volume_km3_per_yr']:+.1f} km3/yr  pettitt={st['pettitt_change_year']} ({st['pettitt_p']:.2g})  {st['verdict']}")
tl.save_json(stats, f"{out}/regional_stats.json")
pd.DataFrame(series).to_csv(f"{out}/regional_series_cm.csv")
viz.multi_ts({k: series[k] for k in ["NW India (Punjab-Haryana-Rajasthan)", "North China Plain",
                                      "Tigris-Euphrates (Iraq-Iran-Syria)", "California Central Valley",
                                      "East African lakes (Victoria)"]},
             f"{out}/multi_hotspots.png", "Water storage is draining from the world's breadbaskets",
             "cm", subtitle="GRACE/GRACE-FO water storage anomaly, 12-month mean (cm of water relative to 2004–2009)",
             source=SRC)

# --- save gridded result ---
xr.Dataset({"trend_cm_per_yr": (("lat", "lon"), trend_yr), "sig": (("lat", "lon"), sig.astype("i1")),
            "p_ols": (("lat", "lon"), g["p_ols"]), "p_mk": (("lat", "lon"), g["p_mk"])},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/trend_grid.nc")

frac = np.nansum(sig & land_noice) / np.nansum(land_noice)
tl.runlog(TASK, "done", f"{frac:.0%} of ice-free land significant; top loss hotspot: "
          f"{hot.iloc[0]['countries'] if not hot.empty else 'n/a'}")
tl.fix_perms()
print("done", out)
