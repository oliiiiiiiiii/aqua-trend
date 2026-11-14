"""Task 37 - East Asia water extremes from space: how extreme were the 2022 Yangtze drought, 2021 North China floods and
Taiwan's 2021 drought, and is the Three Gorges filling visible?

GRACE TWS (deseasonalised, NOT detrended) and IMERG 0.1 deg rain anomalies; ranks among all months / seasons of 2002-2026.
Three Gorges: Pettitt change-point and step sizes in the reservoir-region storage vs upstream reference (impoundment stages
Jun 2003 -> 135 m, Oct 2006 -> 156 m, Nov 2008 -> 172 m, Oct 2010 -> 175 m; ~ +22 km3 flood-control storage).
"""
import sys
import json
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "37_eastasia_extremes"
out = tl.task_dir(TASK)
SRC = "Data: NASA/JPL GRACE & GRACE-FO mascons; GPM IMERG V07 (0.1°). Anomalies vs each calendar month's 2002–2025 mean."
lon, lat = hub.LON, hub.LAT
land = hub.land_mask()
lm = xr.DataArray(land, dims=("lat", "lon"), coords={"lat": lat, "lon": lon})
tws = hub.load("tws")
REG = {"Yangtze basin": (103, 122, 25, 33), "North China Plain": (113, 120, 34, 41), "Pearl River": (104, 116, 21.5, 26),
       "Three Gorges reservoir region": (106, 111.5, 29, 31.5), "Sichuan basin (upstream ref.)": (102, 106, 28, 32.5)}
EVENTS = {"Yangtze basin": ("2022-07", "2022-12", "low", "2022 heat-drought"), "North China Plain": ("2021-07", "2021-12", "high", "2021 Henan/Hebei floods"),
          "Pearl River": ("2021-01", "2021-06", "low", "2020–21 South China drought")}
series, res = {}, {"events": {}}
for nm, b in REG.items():
    s = tl.area_mean(tws.where(lm), b).to_series().dropna()
    a = s - s.groupby(s.index.month).transform("mean")
    series[nm] = a
# North China 2021: the flood shows as a jump (aquifer recovery), not an absolute record (long-term depletion kept)
a_n = series["North China Plain"].asfreq("MS")
jump = (a_n.shift(-3) - a_n).dropna()
w21 = jump["2021-05":"2021-09"]
res["ncp_2021_jump"] = dict(max_3month_gain_cm=float(w21.max()), start_month=str(w21.idxmax().date())[:7],
                            rank=int((jump > w21.max()).sum() + 1), n=len(jump))
print("NCP 2021 3-month storage jump:", res["ncp_2021_jump"], flush=True)
for nm, (a0, a1, kind, label) in EVENTS.items():
    a = series[nm]
    win = a[a0:a1]
    ext = win.min() if kind == "low" else win.max()
    when = win.idxmin() if kind == "low" else win.idxmax()
    rank = int((a < ext).sum() + 1) if kind == "low" else int((a > ext).sum() + 1)
    prev = a[:pd.Timestamp(a0) - pd.DateOffset(months=1)]
    res["events"][nm] = dict(label=label, extreme_cm=float(ext), month=str(when.date())[:7], rank=rank, n_months=len(a),
                             previous_record_cm=float(prev.min() if kind == "low" else prev.max()),
                             previous_record_month=str((prev.idxmin() if kind == "low" else prev.idxmax()).date())[:7])
    print(nm, res["events"][nm], flush=True)
# IMERG rain anomalies (0.1 deg East Asia) for the events
t_i = pd.DatetimeIndex(json.load(open(f"{ROOT}/data/processed/gesdisc/imerg/times.json")))
done = sorted(json.load(open(f"{ROOT}/data/processed/gesdisc/imerg/done.json")))
ea = np.load(f"{ROOT}/data/processed/gesdisc/imerg/precipitation_ea0p1.npy", mmap_mode="r")
print("IMERG EA cube", ea.shape, flush=True)
ny, nx = ea.shape[1:]
EA = (100.0, 145.0, 15.0, 50.0)  # lon0, lon1, lat0, lat1 of the 0.1 deg IMERG East-Asia cube (fetch_gesdisc.py)
print("EA box from fetcher:", EA, flush=True)
lo0, lo1, la0, la1 = EA
elon = lo0 + 0.05 + 0.1 * np.arange(nx); elat = la0 + 0.05 + 0.1 * np.arange(ny)
sel = np.zeros(len(t_i), bool); sel[done] = True
ti = t_i[sel]
R = np.asarray(ea[sel], np.float32)
clim = np.stack([np.nanmean(R[ti.month == m], 0) for m in range(1, 13)])
def rain_pct(a0, a1):
    m = (ti >= a0) & (ti <= a1)
    obs = np.nanmean(R[m], 0); exp = np.nanmean(clim[ti[m].month - 1], 0)
    return obs / exp * 100
maps = {"2022 Yangtze (Jul–Aug)": rain_pct("2022-07-01", "2022-08-01"), "2021 North China (Jul)": rain_pct("2021-07-01", "2021-07-01"),
        "2021 Taiwan (Jan–May)": rain_pct("2021-01-01", "2021-05-01")}
# Taiwan rank of Jan-May rain among years (IMERG island)
LONe, LATe = np.meshgrid(elon, elat)
tw = (LONe > 120.0) & (LONe < 122.0) & (LATe > 21.9) & (LATe < 25.3)
jm = pd.Series([np.nanmean(R[(ti.year == y) & (ti.month <= 5)][:, tw]) if ((ti.year == y) & (ti.month <= 5)).sum() == 5 else np.nan
                for y in range(2001, 2027)], index=range(2001, 2027)).dropna()
res["taiwan_janmay_rain"] = dict(y2021_pct_of_mean=float(jm[2021] / jm.mean() * 100), rank_2021_driest=int(jm.rank()[2021]), n_years=len(jm))
yz = (LONe > 105) & (LONe < 122) & (LATe > 26) & (LATe < 32)
ja = pd.Series([np.nanmean(R[(ti.year == y) & ti.month.isin([7, 8])][:, yz]) for y in range(2001, 2026)], index=range(2001, 2026))
res["yangtze_julaug_rain"] = dict(y2022_pct_of_mean=float(ja[2022] / ja.mean() * 100), rank_2022_driest=int(ja.rank()[2022]), n_years=len(ja))
hn = (LONe > 112) & (LONe < 115) & (LATe > 33.5) & (LATe < 36.5)
jl = pd.Series([np.nanmean(R[(ti.year == y) & (ti.month == 7)][:, hn]) for y in range(2001, 2026)], index=range(2001, 2026))
res["henan_july_rain"] = dict(y2021_pct_of_mean=float(jl[2021] / jl.mean() * 100), rank_2021_wettest=int(jl.rank(ascending=False)[2021]), n_years=len(jl))
print({k: v for k, v in res.items() if k != "events"}, flush=True)
# Three Gorges: reservoir region minus upstream reference, Pettitt + step means
d = (series["Three Gorges reservoir region"] - series["Sichuan basin (upstream ref.)"]).dropna()
pt = tl.pettitt(d.values)
stages = {"before 2003-06": d[:"2003-05"].mean(), "2003-06..2006-09": d["2003-06":"2006-09"].mean(), "2006-10..2008-10": d["2006-10":"2008-10"].mean(),
          "2008-11..2010-09": d["2008-11":"2010-09"].mean(), "2010-10..2015": d["2010-10":"2015-12"].mean()}
res["three_gorges"] = dict(pettitt=pt if isinstance(pt, dict) else {"result": str(pt)}, stage_means_cm=stages, n_before_2003_06=int(d[:"2003-05"].size))
print("Three Gorges region minus Sichuan ref (cm):", {k: round(v, 2) for k, v in stages.items()}, "pettitt", pt, flush=True)

# --- figure: small multiples of storage anomalies + rain anomaly maps ---
fig = plt.figure(figsize=(14, 9.0), dpi=165)
gsx = [0.05, 0.37, 0.69]
for k, (nm, (a0, a1, kind, label)) in enumerate(EVENTS.items()):
    ax = fig.add_axes([gsx[k], 0.55, 0.28, 0.27])
    a = series[nm]
    full = a.reindex(pd.date_range(a.index.min(), a.index.max(), freq="MS"))
    ax.bar(full.index, full.values, width=25, color=np.where(full.values < 0, viz.ORANGE_ARM[2], viz.BLUE_ARM[2]), linewidth=0)
    e = res["events"][nm]
    if nm == "North China Plain":
        jj = res["ncp_2021_jump"]
        txt = f"2021 floods:\n+{jj['max_3month_gain_cm']:.1f} cm in 3 months\n(#{jj['rank']} of {jj['n']} 3-month gains)"
        xy = (pd.Timestamp(jj["start_month"]) + pd.DateOffset(months=2), -6); xyt = (pd.Timestamp("2003-01-01"), -12)
    elif nm == "Pearl River":
        txt = f"{label}\n{e['extreme_cm']:+.1f} cm (#{e['rank']} of {e['n_months']} months)"
        xy = (pd.Timestamp(e["month"]), e["extreme_cm"]); xyt = (pd.Timestamp("2012-09-01"), -12.5)
    else:
        txt = f"{label}\n{e['extreme_cm']:+.1f} cm — #{e['rank']} of {e['n_months']} months (record)"
        xy = (pd.Timestamp(e["month"]), e["extreme_cm"]); xyt = (pd.Timestamp("2003-01-01"), e["extreme_cm"] * 0.95)
    ax.annotate(txt, xy=xy, xytext=xyt, fontsize=8.3, color=viz.INK, arrowprops=dict(arrowstyle="-", color=viz.INK2, lw=0.7), va="center")
    ax.axhline(0, color=viz.AXIS, lw=0.8)
    for sp in ("top", "right", "left"):
        ax.spines[sp].set_visible(False)
    ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8); ax.set_axisbelow(True)
    ax.set_title(nm, fontsize=10.5, loc="left", color=viz.INK)
    if k == 0:
        ax.set_ylabel("water storage anomaly (cm)", fontsize=9, color=viz.INK2)
cm = viz.div_cmap("water")
for k, (nm, fld) in enumerate(maps.items()):
    ax = fig.add_axes([gsx[k] - 0.01, 0.08, 0.30, 0.38], projection=ccrs.PlateCarree())
    ext = {0: [100, 125, 20, 36], 1: [108, 124, 30, 43], 2: [118.5, 123, 21, 26]}[k]
    ax.set_extent(ext, ccrs.PlateCarree())
    im = ax.pcolormesh(elon, elat, fld - 100, transform=ccrs.PlateCarree(), cmap=cm, vmin=-100, vmax=100, shading="auto")
    ax.add_feature(cfeature.COASTLINE.with_scale("50m"), linewidth=0.6, edgecolor=viz.INK2)
    ax.add_feature(cfeature.BORDERS.with_scale("50m"), linewidth=0.3, edgecolor=viz.MUTED)
    extra = {0: f"rain {res['yangtze_julaug_rain']['y2022_pct_of_mean']:.0f}% of normal (driest of {res['yangtze_julaug_rain']['n_years']} yrs)" if res['yangtze_julaug_rain']['rank_2022_driest'] == 1 else f"rain {res['yangtze_julaug_rain']['y2022_pct_of_mean']:.0f}% of normal (rank {res['yangtze_julaug_rain']['rank_2022_driest']})",
             1: f"Henan rain {res['henan_july_rain']['y2021_pct_of_mean']:.0f}% of normal (rank {res['henan_july_rain']['rank_2021_wettest']} wettest)",
             2: f"{res['taiwan_janmay_rain']['y2021_pct_of_mean']:.0f}% of normal (#{res['taiwan_janmay_rain']['rank_2021_driest']} driest)"}[k]
    ax.set_title(f"{nm}: {extra}", fontsize=8.8, loc="left", color=viz.INK)
cax = fig.add_axes([0.35, 0.035, 0.30, 0.016])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both"); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=8, length=0)
cb.set_label("rain anomaly (% vs 2001–2025 normal, IMERG 0.1°)", fontsize=8.5, color=viz.INK2)
fig.text(0.03, 0.975, "East Asia's water extremes from space: how far outside the normal were they?", fontsize=15, fontweight="bold", va="top")
fig.text(0.03, 0.935, "Top: GRACE water storage anomalies (seasons removed, trend kept) for three basins, with the event's rank among all months "
         "since 2002. Bottom: IMERG rainfall during each event.", fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.03, 0.905, SRC, fontsize=7.5, color=viz.MUTED, ha="left")
fig.savefig(f"{out}/eastasia_extremes.png"); plt.close(fig)
# Three Gorges figure
fig, ax = plt.subplots(figsize=(11, 4.6), dpi=170)
fig.subplots_adjust(left=0.08, right=0.97, top=0.78, bottom=0.12)
dd = d.reindex(pd.date_range(d.index.min(), d.index.max(), freq="MS"))
ax.plot(dd.index, dd.values, color=viz.MUTED, lw=0.8)
ax.plot(dd.index, dd.rolling(12, center=True, min_periods=8).mean(), color=viz.SERIES[0], lw=2.2)
for dt_, lb in (("2003-06-01", "135 m"), ("2006-10-01", "156 m"), ("2008-11-01", "172 m"), ("2010-10-01", "175 m")):
    ax.axvline(pd.Timestamp(dt_), color=viz.INK2, lw=0.8, ls="--"); ax.text(pd.Timestamp(dt_), ax.get_ylim()[1], " " + lb, fontsize=8, color=viz.INK2, va="top")
for sp in ("top", "right", "left"):
    ax.spines[sp].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8.5)
ax.set_ylabel("storage difference (cm)", color=viz.INK2)
fig.text(0.08, 0.965, "Can GRACE see the Three Gorges reservoir fill?", fontsize=14, fontweight="bold", va="top")
fig.text(0.08, 0.90, "Reservoir region (106–111.5°E, 29–31.5°N) minus upstream Sichuan basin, deseasonalised GRACE storage; dashed lines = "
         "impoundment stages. GRACE began in Apr 2002, so the first stage has only ~14 months of 'before'.", fontsize=9, color=viz.INK2, va="top", wrap=True)
fig.text(0.97, 0.01, "Data: NASA/JPL GRACE & GRACE-FO mascons.", fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/three_gorges.png"); plt.close(fig)
pd.DataFrame(series).to_csv(f"{out}/storage_anomalies_cm.csv")
tl.save_json(res, f"{out}/stats.json")
tl.runlog(TASK, "done", "; ".join(f"{k}: {v['extreme_cm']:+.1f} cm rank {v['rank']}" for k, v in res["events"].items()))
tl.fix_perms(out)
print("done")
