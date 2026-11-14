"""Task 21 - Land water budget: what the climate supplies vs what the land actually keeps (GRACE), and the human gap.

1) Groundwater(+surface water) = GRACE TWS - GLDAS (soil moisture 0-200 cm + snow)  [Rodell et al. 2009 approach]
   GLDAS Noah has no irrigation / pumping / reservoirs, so the trend of this residual maps human-driven storage change
   (and lakes/glaciers, which are flagged).
2) Budget per region: P (IMERG) - ET (GLDAS) - R (GLDAS) vs observed dS/dt (GRACE), annual means 2003-2024.
   The gap ("missing water") = human withdrawals / transfers / model error.
3) Phase budgets for the China South-to-North diversion destination (Hai basin) and NW India.
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
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
from regions import REGIONS  # noqa: E402

TASK = "21_water_budget"
out = tl.task_dir(TASK)
SRC = ("Data: GRACE/GRACE-FO mascons (storage), GLDAS-2.1 Noah (soil moisture, snow, ET, runoff), GPM IMERG (rain). "
       "Groundwater = GRACE − GLDAS soil+snow (Rodell et al. 2009). OLS+AR(1) & MK, FDR q=0.10.")
use_gpu = "gpu" in sys.argv
lon, lat = hub.LON, hub.LAT
land = hub.land_mask() & (lat[:, None] > -58)
cg, names = hs.country_grid(lon, lat)
inv = {v: k for k, v in names.items()}
land &= ~(cg == inv.get("Greenland", -9))

tws = hub.load("tws")                 # cm
sm = hub.load("sm_total") / 10.0      # mm -> cm
swe = hub.load("swe") / 10.0
(T, S, W), t = hub.align(tws, sm, swe)
# anomalies relative to the GRACE baseline period 2004-2009
base = (t >= "2004-01-01") & (t <= "2009-12-31")
S_an = S - S.sel(time=t[base]).mean("time"); W_an = W - W.sel(time=t[base]).mean("time")
gws = T - S_an - W_an  # cm, groundwater + surface water + glaciers
gws.name = "gws"
g = tl.grid_trends(gws.values, t, use_gpu=use_gpu, annual_min=6)
gtr = np.where(land, g["slope_dec"] / 10, np.nan); gsig = g["sig_both"] & land
gl = tl.grid_trends(S_an.values, t, use_gpu=use_gpu, annual_min=6)
smtr = np.where(land, gl["slope_dec"] / 10, np.nan)
viz.trend_map(lon, lat, gtr, gsig, f"{out}/map_groundwater_trend.png",
              "Hidden water loss: groundwater & surface-water trend 2002–2026",
              "GRACE total water minus modelled soil moisture & snow (GLDAS has no pumping), so this isolates aquifers, lakes "
              "& glaciers. Orange = losing.", "cm of water per year", vmax=2.5, cmap="water", source=SRC)
for z, ext in {"south_asia": (60, 100, 5, 40), "east_asia": (95, 145, 15, 50), "middle_east": (25, 65, 15, 45),
               "north_america": (-130, -65, 22, 55)}.items():
    viz.trend_map(lon, lat, gtr, gsig, f"{out}/map_groundwater_{z}.png", f"Groundwater & surface-water trend: {z.replace('_', ' ').title()}",
                  "GRACE − GLDAS soil moisture & snow (cm/yr). Orange = losing.", "cm/yr", vmax=3, cmap="water",
                  extent=ext, proj="plate", source=SRC)
viz.trend_map(lon, lat, smtr, gl["sig_both"] & land, f"{out}/map_soilmoisture_trend.png",
              "Soil moisture trend 2002–2026 (top 2 m, GLDAS)", "Orange = drying soils, blue = wetter soils (cm water/yr)",
              "cm of water per year", vmax=1.0, cmap="water", source=SRC)
hot = hs.find_hotspots(lon, lat, gtr, gsig, min_cells=6, thr=0.5, top=20)
if not hot.empty:
    hot["volume_km3_per_yr"] = hot["mean_trend"] * hot["area_km2"] * 1e-5
hot.to_csv(f"{out}/groundwater_hotspots.csv", index=False)
print(hot[["sign", "countries", "area_km2", "mean_trend", "volume_km3_per_yr"]].head(12).to_string(), flush=True)

# ---- regional budgets ----
P = hub.load("p_imerg"); ET = hub.load("et_gldas"); RO = hub.load("runoff")
regs = ["NW India (Punjab-Haryana-Rajasthan)", "North China Plain", "Tigris-Euphrates (Iraq-Iran-Syria)",
        "California Central Valley", "Arabian aquifers (Saudi)", "Caspian Sea", "East African lakes (Victoria)",
        "Indo-Gangetic Plain", "Amazon deforestation arc", "Sahel", "Taiwan (island)"]
rows, series_out = [], {}
for r in regs:
    b = REGIONS[r]
    s_g = tl.area_mean(gws, b).to_series(); s_t = tl.area_mean(T, b).to_series(); s_s = tl.area_mean(S_an, b).to_series()
    p = tl.area_mean(P, b).to_series(); e = tl.area_mean(ET, b).to_series(); ro = tl.area_mean(RO, b).to_series()
    st_g = tl.series_trend(s_g, r, "cm"); st_t = tl.series_trend(s_t, r, "cm"); st_s = tl.series_trend(s_s, r, "cm")
    df = pd.DataFrame({"P": p, "ET": e, "R": ro}).dropna()
    df = df[(df.index >= "2003-01-01") & (df.index <= "2024-12-31")]
    ann = df.groupby(df.index.year).mean() * 365  # mm/yr
    supply = (ann["P"] - ann["ET"] - ann["R"])
    dS_obs = st_t["slope_per_decade"] / 10 * 10  # cm/yr -> mm/yr
    row = dict(region=r, P_mm_yr=float(ann["P"].mean()), ET_mm_yr=float(ann["ET"].mean()), R_mm_yr=float(ann["R"].mean()),
               P_minus_ET_minus_R=float(supply.mean()), dS_obs_mm_yr=dS_obs,
               gap_mm_yr=dS_obs - float(supply.mean()),
               tws_trend_cm_yr=st_t["slope_per_decade"] / 10, tws_p=st_t["p_ols_ar1"],
               soil_trend_cm_yr=st_s["slope_per_decade"] / 10, soil_p=st_s["p_ols_ar1"],
               gw_trend_cm_yr=st_g["slope_per_decade"] / 10, gw_p=st_g["p_ols_ar1"], gw_verdict=st_g["verdict"],
               P_trend_pct_dec=tl.series_trend(p, r, "mm/day")["pct_per_decade"],
               ET_trend_pct_dec=tl.series_trend(e, r, "mm/day")["pct_per_decade"])
    rows.append(row)
    series_out[r] = s_g
    print(f"{r[:34]:34s} TWS {row['tws_trend_cm_yr']:+.2f} = soil {row['soil_trend_cm_yr']:+.2f} + GW {row['gw_trend_cm_yr']:+.2f} cm/yr "
          f"(GW p={row['gw_p']:.2g}); P {row['P_mm_yr']:.0f} ET {row['ET_mm_yr']:.0f} R {row['R_mm_yr']:.0f} mm/yr; "
          f"P-ET-R {row['P_minus_ET_minus_R']:+.0f} vs dS {dS_obs:+.0f} mm/yr", flush=True)
bud = pd.DataFrame(rows)
bud.to_csv(f"{out}/regional_budget.csv", index=False)
pd.DataFrame(series_out).to_csv(f"{out}/groundwater_series_cm.csv")

# ---- figure: storage split (soil vs groundwater) per region, one axis ----
sel = bud.set_index("region").loc[regs]
fig, ax = plt.subplots(figsize=(11, 5.6), dpi=170)
fig.subplots_adjust(left=0.30, right=0.97, top=0.83, bottom=0.12)
y = np.arange(len(sel))[::-1]
h = 0.36
ax.barh(y + h / 2, sel["soil_trend_cm_yr"], height=h, color=viz.SERIES[2], label="soil moisture (GLDAS)")
ax.barh(y - h / 2, sel["gw_trend_cm_yr"], height=h, color=viz.SERIES[1], label="groundwater + lakes (GRACE − GLDAS)")
ax.set_yticks(y); ax.set_yticklabels([s.split(" (")[0] for s in sel.index], fontsize=9.5, color=viz.INK2)
ax.axvline(0, color=viz.AXIS, lw=1)
for sp in ("top", "right", "left"):
    ax.spines[sp].set_visible(False)
ax.grid(axis="x", color=viz.GRID, lw=0.6); ax.tick_params(length=0)
ax.set_xlabel("storage trend 2002–2026 (cm of water per year)", color=viz.INK2)
ax.legend(frameon=False, loc="lower left", fontsize=9)
fig.text(0.02, 0.965, "Is it the soil or the aquifer? Splitting GRACE's water loss", fontsize=14, fontweight="bold", va="top")
fig.text(0.02, 0.915, "Where the orange bar dominates, the loss is deep groundwater (pumping) rather than drier soils.",
         fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.97, 0.01, SRC, fontsize=6.5, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/bars_soil_vs_groundwater.png"); plt.close(fig)

# ---- phase budget: Hai basin (SNWD destination) & NW India ----
import geopandas as gpd, regionmask
from shapely.geometry import Point
hb = gpd.read_file(ROOT + "/data/raw/hydrobasins/unz/hybas_as_lev04_v1c.shp")
phase_rows = []
for nm, poly_pt, phases in (("Hai basin (SNWD destination)", (116.0, 39.0), [("2003", "2014"), ("2015", "2020"), ("2021", "2024")]),
                            ("NW India", None, [("2003", "2010"), ("2011", "2016"), ("2017", "2024")])):
    if poly_pt:
        m = regionmask.from_geopandas(hb[hb.contains(Point(*poly_pt))], names="HYBAS_ID").mask(lon, lat).notnull().values
    else:
        b = REGIONS["NW India (Punjab-Haryana-Rajasthan)"]
        LONm, LATm = np.meshgrid(lon, lat); m = (LONm >= b[0]) & (LONm <= b[1]) & (LATm >= b[2]) & (LATm <= b[3])
    w = xr.DataArray(np.cos(np.deg2rad(lat))[:, None] * m, dims=("lat", "lon"), coords={"lat": lat, "lon": lon})
    mean = lambda da: ((da * w).sum(("lat", "lon"), min_count=1) / (w * da.notnull()).sum(("lat", "lon"))).to_series()
    sT, sS, sG = mean(T), mean(S_an), mean(gws)
    sp_, se_, sr_ = mean(P), mean(ET), mean(RO)
    for a, b2 in phases:
        stT = tl.series_trend(sT, nm, "cm", start=f"{a}-01-01", end=f"{b2}-12-31")
        stG = tl.series_trend(sG, nm, "cm", start=f"{a}-01-01", end=f"{b2}-12-31")
        stS = tl.series_trend(sS, nm, "cm", start=f"{a}-01-01", end=f"{b2}-12-31")
        sl = slice(f"{a}-01-01", f"{b2}-12-31")
        sup = float((sp_[sl] - se_[sl] - sr_[sl]).mean() * 365)
        phase_rows.append(dict(region=nm, phase=f"{a}–{b2}", tws_cm_yr=stT["slope_per_decade"] / 10, tws_p=stT["p_ols_ar1"],
                               soil_cm_yr=stS["slope_per_decade"] / 10, gw_cm_yr=stG["slope_per_decade"] / 10, gw_p=stG["p_ols_ar1"],
                               P_mm_yr=float(sp_[sl].mean() * 365), ET_mm_yr=float(se_[sl].mean() * 365),
                               R_mm_yr=float(sr_[sl].mean() * 365), P_minus_ET_minus_R=sup,
                               gap_mm_yr=stT["slope_per_decade"] - sup))
ph = pd.DataFrame(phase_rows)
ph.to_csv(f"{out}/phase_budgets.csv", index=False)
print(ph.round(2).to_string(), flush=True)
tl.save_json(dict(hotspots=hot.head(10).to_dict("records"), budget=bud.to_dict("records"), phases=ph.to_dict("records")),
             f"{out}/stats.json")
xr.Dataset({"gw_trend_cm_yr": (("lat", "lon"), gtr.astype(np.float32)), "gw_sig": (("lat", "lon"), gsig.astype("i1")),
            "soil_trend_cm_yr": (("lat", "lon"), smtr.astype(np.float32))}, coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/trend_grids.nc")
tl.runlog(TASK, "done", f"top groundwater-loss hotspot: {hot.iloc[0]['countries'] if not hot.empty else 'n/a'}")
tl.fix_perms()
print("done")
