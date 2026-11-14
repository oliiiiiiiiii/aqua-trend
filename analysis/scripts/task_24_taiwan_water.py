"""Task 24 - Taiwan water deep-dive: is Taiwan getting drier? (IMERG 0.1 deg, GLDAS 0.25 deg, 1998/2000-2025)

- seasonal rain trend maps at 0.1 deg: winter NE monsoon (Nov-Apr), plum rain (May-Jun), typhoon season (Jul-Oct)
- island-mean seasonal series & trends; extreme-rain months per year; ENSO links
- 2021 drought: Jan-May 2021 rain as % of 2001-2020 normal (map)
- Taiwan water budget P - ET - R (GLDAS 0.25 deg)
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import json
import numpy as np
import pandas as pd
import xarray as xr
import regionmask
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "24_taiwan_water"
out = tl.task_dir(TASK)
SRC = "Data: NASA GPM IMERG V07 monthly 0.1° (1998–2025), GLDAS-2.1 Noah 0.25°. OLS+AR(1) & Mann-Kendall, FDR q=0.10."
D = ROOT + "/data/processed/gesdisc"
t_i = pd.DatetimeIndex(json.load(open(f"{D}/imerg/times.json")))
P = np.load(f"{D}/imerg/precipitation_ea0p1.npy").astype(np.float32)  # (nt, 350, 450) lat 15..50, lon 100..145
lat = 15.05 + 0.1 * np.arange(350); lon = 100.05 + 0.1 * np.arange(450)
ext = (119.2, 122.4, 21.7, 25.5)
j0, j1 = np.searchsorted(lat, ext[2]), np.searchsorted(lat, ext[3]); i0, i1 = np.searchsorted(lon, ext[0]), np.searchsorted(lon, ext[1])
P = P[:, j0:j1, i0:i1]; la = lat[j0:j1]; lo = lon[i0:i1]
tw = regionmask.defined_regions.natural_earth_v5_0_0.countries_50
mk = tw.mask(lo, la)
num = [k for k, v in zip(tw.numbers, tw.names) if v == "Taiwan"][0]
isl = (mk.values == num)
print("Taiwan pixels at 0.1 deg:", int(isl.sum()), flush=True)
Pda = xr.DataArray(P, dims=("time", "lat", "lon"), coords={"time": t_i, "lat": la, "lon": lo})
SEAS = {"winter NE monsoon (Nov–Apr)": [11, 12, 1, 2, 3, 4], "plum rain (May–Jun)": [5, 6], "typhoon season (Jul–Oct)": [7, 8, 9, 10]}
stats = {}
w = np.cos(np.deg2rad(la))[:, None] * isl


def season_totals(arr, times, months):
    """seasonal total (mm) per season-year; Nov-Dec assigned to following year."""
    tt = pd.DatetimeIndex(times)
    yr = tt.year + ((tt.month >= 11) & (11 in months)).astype(int)
    sel = np.isin(tt.month, months)
    days = tt.days_in_month.values
    tot = {}
    for y in np.unique(yr[sel]):
        m = sel & (yr == y)
        if m.sum() == len(months):
            tot[y] = (arr[m] * days[m][:, None, None]).sum(0) if arr.ndim == 3 else float((arr[m] * days[m]).sum())
    return tot


fig, axes = plt.subplots(1, 3, figsize=(14, 6.8), dpi=170)
fig.subplots_adjust(left=0.02, right=0.98, top=0.83, bottom=0.14, wspace=0.05)
cm = viz.div_cmap("water")
for ax, (sn, months) in zip(axes, SEAS.items()):
    tot = season_totals(P, t_i, months)
    yrs = np.array(sorted(tot)); yrs = yrs[(yrs >= 1999) & (yrs <= 2025)]
    cube = np.stack([tot[y] for y in yrs])
    ols = tl.ols_ar1(cube, yrs.astype(float), min_frac=0.9); mkg = tl.mk_grid(cube)
    pct = 100 * 10 * ols["slope"] / np.nanmean(cube, 0)
    sig = tl.fdr_mask(np.maximum(ols["p"], mkg["p"]), 0.10) & isl
    im = ax.imshow(np.where(isl, pct, np.nan), origin="lower", extent=[lo[0], lo[-1], la[0], la[-1]], cmap=cm, vmin=-30, vmax=30, alpha=0.35)
    ax.imshow(np.where(sig, pct, np.nan), origin="lower", extent=[lo[0], lo[-1], la[0], la[-1]], cmap=cm, vmin=-30, vmax=30)
    ax.set_xlim(119.9, 122.1); ax.set_ylim(21.8, 25.4); ax.set_xticks([]); ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_color(viz.AXIS)
    s_isl = pd.Series({y: float((tot[y] * w).sum() / w.sum()) for y in yrs})
    st = tl.series_trend(pd.Series(s_isl.values, index=pd.to_datetime([f"{y}-07-01" for y in yrs])), sn, "mm", deseasonalize=False)
    stats[sn] = dict(island_mean_mm=float(s_isl.mean()), pct_per_decade=100 * st["slope_per_decade"] / s_isl.mean(),
                     p=st["p_ols_ar1"], mk_p=st["mk_hr_p"], verdict=st["verdict"], frac_island_sig=float(sig.sum() / isl.sum()),
                     series=s_isl.round(1).to_dict())
    ax.set_title(f"{sn}\nisland mean {stats[sn]['pct_per_decade']:+.0f}%/decade (p={st['p_ols_ar1']:.2g})", fontsize=10.5)
    print(f"{sn}: {stats[sn]['pct_per_decade']:+.1f}%/dec p={st['p_ols_ar1']:.2g} MK={st['mk_hr_p']:.2g}; {stats[sn]['frac_island_sig']:.0%} of island significant", flush=True)
cax = fig.add_axes([0.35, 0.07, 0.3, 0.025])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both"); cb.outline.set_visible(False)
cb.set_label("seasonal rain trend (% per decade)", fontsize=9, color=viz.INK2); cb.ax.tick_params(labelsize=8, length=0)
fig.text(0.02, 0.965, "Is Taiwan getting drier? Rain trends by season, 1999–2025", fontsize=15, fontweight="bold", va="top")
fig.text(0.02, 0.915, "GPM IMERG satellite rainfall at 0.1° (≈10 km). Orange = less rain, blue = more; faded = not significant.",
         fontsize=10, color=viz.INK2, va="top")
fig.text(0.02, 0.012, SRC, fontsize=7.5, color=viz.MUTED)
fig.savefig(f"{out}/map_taiwan_seasonal_rain_trends.png"); plt.close(fig)

# island-mean monthly series, annual total, extreme months
s = pd.Series((P * w).sum((1, 2)) / w.sum(), index=t_i)
st_all = tl.series_trend(s, "Taiwan IMERG monthly", "mm/day")
ann = (s * s.index.days_in_month).groupby(s.index.year).sum()
ann = ann[(ann.index >= 1998) & (ann.index <= 2024)]
p95 = s["1998":"2012"].quantile(0.95)
ext_m = (s > p95).groupby(s.index.year).sum()
stats["annual"] = dict(trend=st_all, annual_total_mm=ann.round(0).to_dict(), extreme_month_threshold_mm_day=float(p95),
                       extreme_months_per_year_1998_2011=float(ext_m.loc[1998:2011].mean()),
                       extreme_months_per_year_2012_2025=float(ext_m.loc[2012:2025].mean()))
print(f"annual: {st_all['pct_per_decade']:+.1f}%/dec p={st_all['p_ols_ar1']:.2g}; extreme months/yr "
      f"{stats['annual']['extreme_months_per_year_1998_2011']:.2f} -> {stats['annual']['extreme_months_per_year_2012_2025']:.2f}", flush=True)
viz.ts_figure(s, f"{out}/ts_taiwan_rain_imerg.png", "Taiwan island-mean rainfall (IMERG)", "mm/day", st_all, source=SRC,
              events=[("2009-08-01", "Morakot"), ("2021-03-01", "2021 drought")])
# ENSO links by season
nino = hub.index("nino34")
for sn, months in SEAS.items():
    yrs = np.array(sorted(stats[sn]["series"]))
    nn = np.array([nino[(nino.index.year == (y if 11 not in months else y - 1)) & nino.index.month.isin([10, 11, 12])].mean()
                   if 11 in months else nino[(nino.index.year == y) & nino.index.month.isin(months)].mean() for y in yrs])
    vv = np.array([stats[sn]["series"][y] for y in yrs])
    ok = np.isfinite(nn)
    r = np.corrcoef(nn[ok], vv[ok])[0, 1]
    from scipy import stats as ss
    stats[sn]["r_with_nino34"] = float(r); stats[sn]["p_nino34"] = float(ss.pearsonr(nn[ok], vv[ok])[1])
    print(f"   {sn}: r(Nino3.4) = {r:+.2f} (p={stats[sn]['p_nino34']:.2g})", flush=True)
# 2021 drought map
clim = Pda.sel(time=Pda.time.dt.year.isin(range(2001, 2021)) & Pda.time.dt.month.isin([1, 2, 3, 4, 5])).groupby("time.month").mean().sum("month")
d21 = Pda.sel(time=slice("2021-01-01", "2021-05-31")).sum("time")
pct21 = 100 * d21 / clim
stats["drought_2021_JanMay_pct_of_normal_island"] = float(np.nansum(pct21.values * w) / w.sum())
viz.trend_map(lo, la, np.where(isl, pct21.values - 100, np.nan), isl, f"{out}/map_2021_drought.png",
              "Taiwan's 2021 drought from space", f"Jan–May 2021 rainfall vs the 2001–2020 average: island mean "
              f"{stats['drought_2021_JanMay_pct_of_normal_island']:.0f}% of normal", "rain anomaly (% of normal − 100)",
              vmax=80, cmap="water", extent=(119.8, 122.2, 21.8, 25.4), proj="plate", source=SRC, figsize=(7.5, 9.5))
# GLDAS budget (0.25 deg East Asia subset)
t_g = pd.DatetimeIndex(json.load(open(f"{D}/gldas/times.json")))
lat_g = 15.125 + 0.25 * np.arange(140); lon_g = 100.125 + 0.25 * np.arange(180)
mk_g = tw.mask(lon_g, lat_g).values == num
wg = np.cos(np.deg2rad(lat_g))[:, None] * mk_g
g = lambda v: pd.Series((np.nan_to_num(np.load(f"{D}/gldas/{v}_ea0p25.npy")) * wg).sum((1, 2)) / wg.sum(), index=t_g)
Pg = g("Rainf_f_tavg") * 86400; ETg = g("Evap_tavg") * 86400; Rg = (g("Qs_acc") + g("Qsb_acc")) * 8
bud = {}
for nm, ser in {"P (GLDAS forcing)": Pg, "ET": ETg, "runoff": Rg, "P-ET-R": Pg - ETg - Rg}.items():
    st = tl.series_trend(ser["2000":"2025"], nm, "mm/day")
    bud[nm] = dict(mean_mm_yr=float(ser.mean() * 365), pct_dec=st["pct_per_decade"], p=st["p_ols_ar1"], verdict=st["verdict"])
    print(f"Taiwan {nm:18s} {bud[nm]['mean_mm_yr']:7.0f} mm/yr trend {st['pct_per_decade']:+.1f}%/dec p={st['p_ols_ar1']:.2g}", flush=True)
stats["gldas_budget"] = bud
tl.save_json(stats, f"{out}/stats.json")
s.to_csv(f"{out}/taiwan_rain_imerg_monthly.csv")
tl.runlog(TASK, "done", f"annual {st_all['pct_per_decade']:+.1f}%/dec (p={st_all['p_ols_ar1']:.2g}); 2021 Jan-May "
          f"{stats['drought_2021_JanMay_pct_of_normal_island']:.0f}% of normal")
tl.fix_perms()
print("done")
