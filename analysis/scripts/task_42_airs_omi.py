"""Task 42 - AIRS (Aqua, infrared sounder) x OMI (Aura, UV/visible spectrometer): how the two NASA A-Train sensors relate.

A. Same quantity, different physics: total ozone from AIRS (9.6 um IR) vs OMI (UV). Anomaly correlation map, trend maps,
   AIRS-OMI drift, Antarctic spring ozone from both.
B. Smoke: AIRS carbon monoxide (500 hPa) vs OMI UV aerosol index vs MODIS fire counts (FIRMS). Correlation maps of
   monthly anomalies and the 2023 Canadian fire season as a case study (record rank in the AIRS era).
C. Combustion fingerprint: OMI tropospheric NO2 trends (2005-2025, 0.5 deg) vs AIRS CO trends; regional series
   (East China, North India, Eastern US, Western Europe, Persian Gulf, Highveld, Japan/Korea, Taiwan); COVID-2020 dip.
D. Water link: AIRS total water vapour vs surface air temperature, % per K (Clausius-Clapeyron predicts ~7 %/K).
Stats: deseasonalised anomalies; Bretherton-n_eff correlation and AR(1)-OLS + Mann-Kendall trends with FDR q=0.10 (trendlib).
Caveats: AIRS v7 L3 is AIRS-only; Aqua and Aura orbits drift later in local time from ~2022 (sensitivity: 2005-2021).
"""
import sys
import json
import textwrap
import numpy as np
import pandas as pd
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

TASK = "42_airs_omi"
out = tl.task_dir(TASK)
SRC = "Data: NASA AIRS/Aqua L3 v7 monthly (AIRS3STM), OMI/Aura OMTO3d v4 & OMNO2d v4 (daily → monthly), MODIS active fires (FIRMS)."
P = f"{ROOT}/data/processed/airs_omi"
lat1 = np.arange(-89.5, 90, 1.0); lon1 = np.arange(-179.5, 180, 1.0)
lat05 = np.arange(-89.75, 90, 0.5); lon05 = np.arange(-179.75, 180, 0.5)


def cube(prod, var):
    a = np.load(f"{P}/{prod}/{var}.npy", mmap_mode="r")
    t = pd.DatetimeIndex(json.load(open(f"{P}/{prod}/times.json")))
    return a, t


def on(a, t, T):
    """reindex a cube (time first) onto times T (NaN where missing)."""
    idx = {x: i for i, x in enumerate(t)}
    o = np.full((len(T),) + a.shape[1:], np.nan, np.float32)
    for k, x in enumerate(T):
        if x in idx:
            o[k] = a[idx[x]]
    return o


def block(a, f):
    s = a.shape
    with np.errstate(all="ignore"):
        return np.nanmean(a.reshape(s[:-2] + (s[-2] // f, f, s[-1] // f, f)), axis=(-3, -1))


T = pd.date_range("2004-10-01", "2026-09-01", freq="MS")   # common AIRS/OMI period (OMI starts Oct 2004)
TY = T.year.values
land1 = block(hub.land_mask().astype(np.float32), 2) > 0.5
w1 = np.cos(np.deg2rad(lat1))[:, None] * np.ones((180, 360))
w05 = np.cos(np.deg2rad(lat05))[:, None] * np.ones((360, 720))


def wmean(a, m, w=w1):
    """area-weighted mean over mask m for every time step of a (t, y, x)."""
    aa = a[:, m]; ww = w[m][None] * np.isfinite(aa)
    with np.errstate(all="ignore"):
        return np.nansum(np.nan_to_num(aa) * ww, 1) / ww.sum(1)


def anomalies(a, t):
    x, _ = tl.deseason(a.reshape(len(t), -1), t.month.values)
    return x.reshape(a.shape)


res = {}
# ======================================================================= A. ozone
ao, ta = cube("airs", "TotO3_A"); oo, to = cube("omto3", "ColumnAmountO3")
A3 = on(ao, ta, T); O3 = on(oo, to, T)
A3[(A3 < 80) | (A3 > 700)] = np.nan
cA = tl.grid_corr(A3, O3, T, detrend=True)
trA = tl.grid_trends(A3[T >= "2005-01-01"], T[T >= "2005-01-01"])
trO = tl.grid_trends(O3[T >= "2005-01-01"], T[T >= "2005-01-01"])
ok = np.isfinite(cA["r"])
mid = (np.abs(lat1) <= 60)[:, None] & np.ones((180, 360), bool)
dser = pd.Series(wmean(A3 - O3, mid), index=T)
dst = tl.series_trend(dser.dropna(), "AIRS-OMI ozone", "DU")
both_ok = np.isfinite(trA["slope_dec"]) & np.isfinite(trO["slope_dec"])
sp = np.sign(trA["slope_dec"]) == np.sign(trO["slope_dec"])
ant = (lat1 <= -60)[:, None] & np.ones((180, 360), bool)
so = (T.month >= 9) & (T.month <= 10)
ant_a = pd.Series(wmean(A3, ant), index=T)[so].groupby(TY[so]).mean()
ant_o = pd.Series(wmean(O3, ant), index=T)[so].groupby(TY[so]).mean()
ant_a, ant_o = ant_a.loc[2005:2025], ant_o.loc[2005:2025]
res["ozone"] = dict(
    median_r=float(np.nanmedian(cA["r"])), frac_sig=float(np.sum(w1[cA["sig"]]) / np.sum(w1[ok])),
    median_r_tropics=float(np.nanmedian(cA["r"][np.abs(lat1) < 20])), median_r_extratropics=float(np.nanmedian(cA["r"][np.abs(lat1) >= 30])),
    mean_bias_airs_minus_omi_60S60N=float(dser.mean()), drift_DU_per_decade=dst["slope_per_decade"], drift_p=dst["p_ols_ar1"],
    trend_sign_agree=float(np.sum(w1[both_ok & sp]) / np.sum(w1[both_ok])),
    pattern_r_trends=float(np.corrcoef(trA["slope_dec"][both_ok], trO["slope_dec"][both_ok])[0, 1]),
    antarctic_SO_r=float(np.corrcoef(ant_a, ant_o)[0, 1]),
    antarctic_SO_trend_airs=tl.series_trend(pd.Series(ant_a.values, index=pd.to_datetime([f"{y}-10-01" for y in ant_a.index])), "", "", deseasonalize=False)["slope_per_decade"],
    antarctic_SO_trend_omi=tl.series_trend(pd.Series(ant_o.values, index=pd.to_datetime([f"{y}-10-01" for y in ant_o.index])), "", "", deseasonalize=False)["slope_per_decade"])
print("A ozone:", {k: round(v, 3) for k, v in res["ozone"].items()}, flush=True)

# ======================================================================= B. smoke: CO vs aerosol index vs fires
ac, tc = cube("airs", "CO_VMR_A")
CO = on(ac[:, 1], tc, T) * 1e9            # ppbv at 500 hPa
CO[(CO < 20) | (CO > 600)] = np.nan
ai, tai = cube("omto3", "UVAerosolIndex"); AI = on(ai, tai, T)
FR = np.full((len(T), 180, 360), np.nan, np.float32)
for y in range(2003, 2026):
    z = np.load(f"{ROOT}/data/processed/firms/modis_{y}_0p5_monthly.npz")["count"]
    c1 = z.reshape(12, 180, 2, 360, 2).sum((2, 4))
    for m in range(12):
        k = np.where((T.year == y) & (T.month == m + 1))[0]
        if len(k):
            FR[k[0]] = c1[m]
fire_mean = np.nanmean(FR, 0)
fiery = fire_mean >= 5                       # >= 5 detections per month per 1-deg cell on average
LF = np.log1p(FR)
Tf = T < "2026-01-01"
c_fc = tl.grid_corr(LF[Tf], CO[Tf], T[Tf]); c_fa = tl.grid_corr(LF[Tf], AI[Tf], T[Tf]); c_ca = tl.grid_corr(CO, AI, T)
res["smoke"] = dict(
    fiery_cells=int(fiery.sum()),
    median_r_fire_CO_fiery=float(np.nanmedian(c_fc["r"][fiery])), median_r_fire_AI_fiery=float(np.nanmedian(c_fa["r"][fiery])),
    median_r_CO_AI_fiery=float(np.nanmedian(c_ca["r"][fiery])), median_r_CO_AI_elsewhere=float(np.nanmedian(c_ca["r"][~fiery & land1])),
    frac_fiery_sig_fire_CO=float(np.mean(c_fc["sig"][fiery] & (c_fc["r"][fiery] > 0))),
    frac_fiery_sig_fire_AI=float(np.mean(c_fa["sig"][fiery] & (c_fa["r"][fiery] > 0))))
print("B smoke:", res["smoke"], flush=True)
# Canada 2023 case: JJA anomalies vs 2005-2022 JJA mean
jja = np.isin(T.month, [6, 7, 8])
def season_anom(a, year):
    base = np.nanmean(a[jja & (TY >= 2005) & (TY <= 2022)], 0)
    return np.nanmean(a[jja & (TY == year)], 0) - base
co23, ai23 = season_anom(CO, 2023), season_anom(AI, 2023)
fr23 = np.nansum(FR[jja & (TY == 2023)], 0)
CAN = (lat1[:, None] >= 50) & (lat1[:, None] <= 70) & (lon1[None] >= -130) & (lon1[None] <= -60)
co_can = pd.Series(wmean(CO, CAN), index=T)[jja].groupby(TY[jja]).mean().loc[2005:2026]
ai_can = pd.Series(wmean(AI, CAN), index=T)[jja].groupby(TY[jja]).mean().loc[2005:2026]
fr_can = pd.Series(np.nansum(np.where(CAN, np.nan_to_num(FR), 0), axis=(1, 2)), index=T)[jja].groupby(TY[jja]).sum().loc[2005:2025]
res["canada_2023"] = dict(co_JJA_rank=int(co_can.rank(ascending=False)[2023]), co_JJA_2023=float(co_can[2023]), co_JJA_clim=float(co_can.drop(2023).mean()),
                          ai_JJA_rank=int(ai_can.rank(ascending=False)[2023]), fires_JJA_2023=float(fr_can[2023]),
                          fires_JJA_ratio_vs_mean=float(fr_can[2023] / fr_can.drop(2023).mean()), n_years=int(len(co_can)),
                          r_fire_co_interannual=float(np.corrcoef(fr_can.loc[2005:2025], co_can.loc[2005:2025])[0, 1]),
                          r_fire_ai_interannual=float(np.corrcoef(fr_can.loc[2005:2025], ai_can.loc[2005:2025])[0, 1]))
print("B Canada 2023:", res["canada_2023"], flush=True)

# ======================================================================= C. NO2 vs CO trends
an, tn = cube("omno2", "NO2Trop")
NO2h = np.full((len(T), 360, 720), np.nan, np.float32)
idx = {x: i for i, x in enumerate(tn)}
for k, x in enumerate(T):
    if x in idx:
        NO2h[k] = block(np.asarray(an[idx[x]], np.float32), 2)
T5 = T >= "2005-01-01"
trN = tl.grid_trends(NO2h[T5], T[T5])
mN = np.nanmean(NO2h[T5], 0)
poll = mN >= 1.0                              # >= 1e15 molecules/cm2 mean tropospheric NO2
with np.errstate(all="ignore"):
    pctN = np.where(poll, trN["slope_dec"] / mN * 100, np.nan)
trC = tl.grid_trends(CO[T5], T[T5])
mC = np.nanmean(CO[T5], 0)
with np.errstate(all="ignore"):
    pctC = trC["slope_dec"] / mC * 100
gl = np.isfinite(pctC)
res["no2"] = dict(polluted_cells=int(poll.sum()),
                  frac_polluted_sig_down=float(np.sum(w05[poll & trN["sig_both"] & (pctN < 0)]) / np.sum(w05[poll])),
                  frac_polluted_sig_up=float(np.sum(w05[poll & trN["sig_both"] & (pctN > 0)]) / np.sum(w05[poll])))
res["co"] = dict(global_mean_pct_per_decade=float(np.nansum(pctC[gl] * w1[gl]) / np.sum(w1[gl])),
                 frac_sig_down=float(np.sum(w1[trC["sig_both"] & (pctC < 0)]) / np.sum(w1[gl])),
                 frac_sig_up=float(np.sum(w1[trC["sig_both"] & (pctC > 0)]) / np.sum(w1[gl])))
gco = pd.Series(wmean(CO, np.ones((180, 360), bool)), index=T)
res["co"]["global_series_trend"] = tl.series_trend(gco[T5].dropna(), "global CO500", "ppb")
print("C NO2:", res["no2"], " CO:", {k: v for k, v in res["co"].items() if k != "global_series_trend"},
      "global CO500 series", round(res["co"]["global_series_trend"]["slope_per_decade"], 2), "ppb/dec p=", res["co"]["global_series_trend"]["p_ols_ar1"], flush=True)
REG = {"East China": (110, 122, 28, 40), "North India": (75, 88, 23, 31), "Eastern US": (-90, -70, 35, 45), "Western Europe": (-2, 15, 45, 55),
       "Persian Gulf": (44, 58, 22, 32), "Highveld (S. Africa)": (27, 31, -27.5, -24.5), "Japan & Korea": (126, 141, 33, 38), "Taiwan": (119.5, 122.5, 21.8, 25.5)}
rows, regser = [], {}
for nm, (x0, x1, y0, y1) in REG.items():
    m05 = (lat05[:, None] >= y0) & (lat05[:, None] <= y1) & (lon05[None] >= x0) & (lon05[None] <= x1)
    m1 = (lat1[:, None] >= y0) & (lat1[:, None] <= y1) & (lon1[None] >= x0) & (lon1[None] <= x1)
    sN = pd.Series(wmean(NO2h, m05, w05), index=T); sC = pd.Series(wmean(CO, m1), index=T)
    stN = tl.series_trend(sN[T5].dropna(), nm, "1e15"); stC = tl.series_trend(sC[T5].dropna(), nm, "ppb")
    stN21 = tl.series_trend(sN[T5 & (T < "2022-01-01")].dropna(), nm, "1e15")
    aN = sN[T5].groupby(TY[T5]).mean(); aC = sC[T5].groupby(TY[T5]).mean()
    peak = int(aN.loc[2005:2025].idxmax())
    a_dev = anomalies(sN.values[:, None, None], T)[:, 0, 0]
    covid = float(np.nanmean(a_dev[(T >= "2020-02-01") & (T <= "2020-04-01")]) / np.nanmean(sN[T5]) * 100)
    regser[nm] = (aN, aC)
    rows.append(dict(region=nm, no2_mean=float(sN[T5].mean()), no2_pct_dec=float(stN["slope_per_decade"] / sN[T5].mean() * 100), no2_p=stN["p_ols_ar1"],
                     no2_mk_p=stN["mk_hr_p"] if "mk_hr_p" in stN else stN.get("mk_p"),
                     no2_pct_dec_2005_2021=float(stN21["slope_per_decade"] / sN[T5].mean() * 100), no2_peak_year=peak,
                     no2_2025_vs_peak_pct=float((aN.loc[2025] / aN.loc[peak] - 1) * 100),
                     co_pct_dec=float(stC["slope_per_decade"] / sC[T5].mean() * 100), co_p=stC["p_ols_ar1"], covid_FebApr2020_pct=covid))
reg = pd.DataFrame(rows); reg.to_csv(f"{out}/regions_no2_co.csv", index=False)
print(reg.round(3).to_string(), flush=True)
res["regions"] = rows

# ======================================================================= D. water vapour per K (AIRS)
aw, tw = cube("airs", "TotH2OVap_A"); at, tt = cube("airs", "SurfAirTemp_A")
TA = pd.DatetimeIndex(tw)
W = np.asarray(aw, np.float32).copy(); Ts = np.asarray(at, np.float32).copy()
W[(W <= 0) | (W > 100)] = np.nan; Ts[(Ts < 180) | (Ts > 340)] = np.nan
lW = anomalies(np.log(W), TA); dT = anomalies(Ts, TA)
with np.errstate(all="ignore"):
    good = np.isfinite(lW) & np.isfinite(dT)
    n = good.sum(0)
    mx = np.where(good, dT, 0).sum(0) / np.maximum(n, 1); my = np.where(good, lW, 0).sum(0) / np.maximum(n, 1)
    cov = np.where(good, (dT - mx) * (lW - my), 0).sum(0); var = np.where(good, (dT - mx) ** 2, 0).sum(0)
    cc = cov / var * 100                      # % per K
    rr = cov / np.sqrt(var * np.where(good, (lW - my) ** 2, 0).sum(0))
cc[n < 120] = np.nan
ocean = ~land1 & (np.abs(lat1) <= 60)[:, None]
ocean_mean = float(np.nansum(cc[ocean] * w1[ocean]) / np.sum(w1[ocean & np.isfinite(cc)]))
# global ocean 60S-60N annual: lnW vs T
gW = pd.Series(wmean(W, ocean), index=TA); gT = pd.Series(wmean(Ts, ocean), index=TA)
full = (TA >= "2003-01-01") & (TA < "2026-01-01")
yW = gW[full].groupby(TA.year[full]).mean(); yT = gT[full].groupby(TA.year[full]).mean()
b = np.polyfit(yT.values, np.log(yW.values), 1)[0] * 100
stW = tl.series_trend(gW[full], "ocean TPW", "mm"); stT = tl.series_trend(gT[full], "ocean T", "K")
res["water_vapour"] = dict(ocean_pixel_mean_pct_per_K=ocean_mean, land_pixel_median_pct_per_K=float(np.nanmedian(cc[land1 & (np.abs(lat1) <= 60)[:, None]])),
                           ocean_annual_global_pct_per_K=float(b), ocean_TPW_trend_pct_per_decade=float(stW["slope_per_decade"] / gW[full].mean() * 100),
                           ocean_TPW_trend_p=stW["p_ols_ar1"], ocean_T_trend_K_per_decade=stT["slope_per_decade"], ocean_T_trend_p=stT["p_ols_ar1"])
print("D water vapour:", res["water_vapour"], flush=True)
tl.save_json(res, f"{out}/stats.json")

# ======================================================================= figures
import matplotlib.colors as mcolors


def gmap(ax, field, cmap, vmin, vmax, sig=None, extent=None, lon=lon1, lat=lat1):
    if extent:
        ax.set_extent(extent, ccrs.PlateCarree())
    else:
        ax.set_global()
    ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", zorder=0)
    dl = (lon[1] - lon[0]) / 2
    ext = [lon[0] - dl, lon[-1] + dl, lat[0] - dl, lat[-1] + dl]
    if sig is not None:
        ax.imshow(np.where(sig, np.nan, field), origin="lower", extent=ext, transform=ccrs.PlateCarree(), cmap=cmap, vmin=vmin, vmax=vmax,
                  alpha=0.3, interpolation="nearest", zorder=1)
        field = np.where(sig, field, np.nan)
    im = ax.imshow(field, origin="lower", extent=ext, transform=ccrs.PlateCarree(), cmap=cmap, vmin=vmin, vmax=vmax, interpolation="nearest", zorder=2)
    ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.4, edgecolor=viz.INK2, zorder=3)
    return im


def cbar(fig, im, rect, label, ticks=None):
    cax = fig.add_axes(rect)
    cb = fig.colorbar(im, cax=cax, orientation="horizontal", ticks=ticks)
    cb.outline.set_visible(False); cb.ax.tick_params(labelsize=8, length=0); cb.set_label(label, fontsize=8.5, color=viz.INK2)
    return cb


seq = mcolors.LinearSegmentedColormap.from_list("seq", ["#f4f3ee"] + viz.BLUE_ARM[::-1][1:])
div = viz.div_cmap("redblue")

# A. ozone agreement
fig = plt.figure(figsize=(13, 6.4), dpi=170)
ax = fig.add_axes([0.01, 0.15, 0.56, 0.66], projection=ccrs.Robinson())
im = gmap(ax, cA["r"], seq, 0, 1)
cbar(fig, im, [0.12, 0.10, 0.34, 0.022], "correlation of monthly anomalies, AIRS vs OMI total ozone")
ax2 = fig.add_axes([0.64, 0.17, 0.33, 0.6])
ax2.plot(ant_a.index, ant_a.values, color=viz.SERIES[0], lw=2.2, marker="o", ms=4, label="AIRS (infrared)")
ax2.plot(ant_o.index, ant_o.values, color=viz.SERIES[1], lw=2.2, marker="o", ms=4, label="OMI (ultraviolet)")
for sp_ in ("top", "right"):
    ax2.spines[sp_].set_visible(False)
ax2.grid(color=viz.GRID, lw=0.6); ax2.tick_params(length=0, labelsize=8.5)
ax2.set_ylabel("Sep–Oct mean total ozone south of 60°S (DU)", color=viz.INK2, fontsize=9)
ax2.legend(frameon=False, fontsize=8.5, loc="upper left")
ax2.set_title(f"The ozone hole seen by both: r = {res['ozone']['antarctic_SO_r']:.2f}", fontsize=10, loc="left", color=viz.INK)
o_ = res["ozone"]
fig.text(0.01, 0.965, "Two sensors, two kinds of light, one ozone layer", fontsize=15, fontweight="bold", va="top")
sub = (f"AIRS measures ozone from infrared heat emission, OMI from ultraviolet sunlight. Their month-to-month anomalies agree (median r = {o_['median_r']:.2f}; "
       f"{o_['median_r_extratropics']:.2f} outside the tropics, {o_['median_r_tropics']:.2f} in the tropics where variability is small). AIRS reads "
       f"{o_['mean_bias_airs_minus_omi_60S60N']:+.0f} DU higher, and the gap drifts {o_['drift_DU_per_decade']:+.1f} DU/decade, a reminder to check a second sensor.")
fig.text(0.01, 0.915, "\n".join(textwrap.wrap(sub, 175)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.99, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/ozone_airs_vs_omi.png"); plt.close(fig)

# B1. smoke correlation maps
fig = plt.figure(figsize=(13, 6.0), dpi=170)
for k, (C, ttl) in enumerate(((c_fc, "Fires → carbon monoxide (AIRS)"), (c_fa, "Fires → smoke aerosol index (OMI)"))):
    ax = fig.add_axes([0.01 + k * 0.495, 0.15, 0.48, 0.64], projection=ccrs.Robinson())
    im = gmap(ax, np.where(fiery, C["r"], np.nan), div, -0.8, 0.8, sig=C["sig"])
    ax.set_title(ttl, fontsize=10.5, loc="left", color=viz.INK)
cbar(fig, im, [0.32, 0.10, 0.36, 0.022], "correlation of monthly anomalies with MODIS fire counts (faded = not significant)")
s_ = res["smoke"]
fig.text(0.01, 0.965, "Where fires burn, both sensors see the smoke", fontsize=15, fontweight="bold", va="top")
sub = (f"Month-to-month fire activity (MODIS, 2004–2025) against AIRS carbon monoxide at 500 hPa and the OMI UV aerosol index, over the "
       f"{s_['fiery_cells']:,} one-degree cells that burn regularly. Median r = {s_['median_r_fire_CO_fiery']:.2f} for CO and {s_['median_r_fire_AI_fiery']:.2f} for aerosol; "
       f"significant and positive in {s_['frac_fiery_sig_fire_CO']:.0%} / {s_['frac_fiery_sig_fire_AI']:.0%} of these cells (FDR q=0.10, autocorrelation-adjusted).")
fig.text(0.01, 0.915, "\n".join(textwrap.wrap(sub, 175)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.99, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/map_fire_smoke_correlation.png"); plt.close(fig)

# B2. Canada 2023
EXT = [-170, 40, 25, 80]
fig = plt.figure(figsize=(13, 7.4), dpi=170)
pr = ccrs.LambertConformal(central_longitude=-60, central_latitude=55, standard_parallels=(40, 65))
c23 = res["canada_2023"]
for k, (fld, vmax, ttl, lab) in enumerate(((co23, 40, f"Carbon monoxide at 500 hPa (AIRS): JJA 2023, rank {c23['co_JJA_rank']} of {c23['n_years']} over Canada", "ppbv vs 2005–22 summer mean"),
                                         (ai23, 1.2, f"UV aerosol index (OMI): JJA 2023, rank {c23['ai_JJA_rank']} of {c23['n_years']} over Canada", "index vs 2005–22 summer mean"))):
    ax = fig.add_axes([0.01 + k * 0.495, 0.16, 0.48, 0.62], projection=pr)
    ax.set_extent(EXT, ccrs.PlateCarree())
    ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", zorder=0)
    im = ax.pcolormesh(lon1, lat1, fld, cmap=div, vmin=-vmax, vmax=vmax, transform=ccrs.PlateCarree(), shading="nearest", zorder=1)
    ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.4, edgecolor=viz.INK2, zorder=3)
    ax.add_feature(cfeature.BORDERS.with_scale("110m"), linewidth=0.3, edgecolor=viz.MUTED, zorder=3)
    yy, xx = np.where(fr23 >= 300)
    ax.scatter(lon1[xx], lat1[yy], s=np.clip(fr23[yy, xx] / 300, 1, 30), facecolors="none", edgecolors=viz.INK, linewidths=0.5,
               transform=ccrs.PlateCarree(), zorder=4)
    ax.set_title(ttl, fontsize=9.5, loc="left", color=viz.INK)
    cbar(fig, im, [0.07 + k * 0.495, 0.10, 0.36, 0.02], lab)
fig.text(0.01, 0.965, "Canada's 2023 fire season, seen from two satellites at once", fontsize=15, fontweight="bold", va="top")
sub = (f"Summer (Jun–Aug) 2023 anomalies. Circles: one-degree cells with ≥300 MODIS fire detections; Canadian detections were "
       f"×{c23['fires_JJA_ratio_vs_mean']:.1f} the 2005–25 average. The CO and smoke plumes stretch downwind over the Atlantic toward Europe. Year to year, "
       f"Canadian summer fire counts track AIRS CO (r = {c23['r_fire_co_interannual']:.2f}) and OMI aerosol (r = {c23['r_fire_ai_interannual']:.2f}).")
fig.text(0.01, 0.915, "\n".join(textwrap.wrap(sub, 175)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.99, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/map_canada_2023_smoke.png"); plt.close(fig)

# C1. NO2 trend map
fig = plt.figure(figsize=(13, 6.9), dpi=180)
ax = fig.add_axes([0.01, 0.15, 0.98, 0.66], projection=ccrs.Robinson(central_longitude=40))
im = gmap(ax, pctN, div, -60, 60, sig=trN["sig_both"] & poll, lon=lon05, lat=lat05)
ax.set_extent([-130, 150, -40, 62], ccrs.PlateCarree())
for nm, (x0, x1, y0, y1) in REG.items():
    ax.plot([x0, x1, x1, x0, x0], [y0, y0, y1, y1, y0], color=viz.INK, lw=0.7, transform=ccrs.PlateCarree(), zorder=4)
cbar(fig, im, [0.3, 0.10, 0.4, 0.022], "tropospheric NO₂ trend 2005–2025 (% per decade; faded = not significant; only where NO₂ ≥ 1×10¹⁵ molec/cm²)")
rg = {r["region"]: r for r in rows}
fig.text(0.01, 0.965, "The world's air pollution map is being redrawn (OMI nitrogen dioxide, 2005–2025)", fontsize=15, fontweight="bold", va="top")
sub = (f"NO₂ comes from burning fuel (traffic, power plants, industry). Significant decline on {res['no2']['frac_polluted_sig_down']:.0%} of polluted cells, rise on "
       f"{res['no2']['frac_polluted_sig_up']:.0%}. Eastern US {rg['Eastern US']['no2_pct_dec']:+.0f}%/decade, Western Europe {rg['Western Europe']['no2_pct_dec']:+.0f}%, "
       f"East China {rg['East China']['no2_pct_dec']:+.0f}% (peak {rg['East China']['no2_peak_year']}), Taiwan {rg['Taiwan']['no2_pct_dec']:+.0f}%; North India "
       f"{rg['North India']['no2_pct_dec']:+.0f}%, Persian Gulf {rg['Persian Gulf']['no2_pct_dec']:+.0f}%.")
fig.text(0.01, 0.915, "\n".join(textwrap.wrap(sub, 175)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.99, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/map_no2_trend.png"); plt.close(fig)

# C2. regional NO2 vs CO fingerprints (indexed to 2005 = 100)
fig, axs = plt.subplots(2, 4, figsize=(13.5, 6.8), dpi=170, sharey=True)
fig.subplots_adjust(left=0.06, right=0.98, top=0.79, bottom=0.08, hspace=0.42, wspace=0.12)
for ax, nm in zip(axs.ravel(), REG):
    aN, aC = regser[nm]
    aN = aN.loc[2005:2025]; aC = aC.loc[2005:2025]
    ax.plot(aN.index, aN / aN.iloc[0] * 100, color=viz.SERIES[1], lw=2.2)
    ax.plot(aC.index, aC / aC.iloc[0] * 100, color=viz.SERIES[0], lw=2.2)
    ax.axhline(100, color=viz.AXIS, lw=0.7)
    r = rg[nm]
    ax.set_title(nm, fontsize=10.5, loc="left", fontweight="bold", color=viz.INK)
    ax.text(0.03, 0.05, f"NO₂ {r['no2_pct_dec']:+.0f}%/dec (p={r['no2_p']:.0e})\nCO {r['co_pct_dec']:+.0f}%/dec (p={r['co_p']:.0e})", transform=ax.transAxes,
            fontsize=8, color=viz.INK2)
    for sp_ in ("top", "right", "left"):
        ax.spines[sp_].set_visible(False)
    ax.grid(axis="y", color=viz.GRID, lw=0.6); ax.tick_params(length=0, labelsize=8)
axs[0, 0].set_ylabel("index, 2005 = 100", color=viz.INK2); axs[1, 0].set_ylabel("index, 2005 = 100", color=viz.INK2)
axs[0, 0].text(2006, 152, "NO₂ (OMI)", color=viz.SERIES[1], fontsize=9, fontweight="bold")
axs[0, 0].text(2006, 138, "CO (AIRS)", color=viz.SERIES[0], fontsize=9, fontweight="bold")
axs[0, 0].set_ylim(30, 165)
fig.text(0.06, 0.965, "Combustion fingerprints: nitrogen dioxide (OMI) vs carbon monoxide (AIRS)", fontsize=15, fontweight="bold", va="top")
sub = ("Annual means, indexed to 2005. NO₂ is short-lived and local, so it tracks each region's own fuel burning; CO lives ~2 months and mixes "
       f"hemispherically, so it falls almost everywhere (global {res['co']['global_mean_pct_per_decade']:+.1f}%/decade) as combustion gets cleaner. "
       "China's NO₂ peaked around 2011–12 then fell; India's kept rising.")
fig.text(0.06, 0.915, "\n".join(textwrap.wrap(sub, 175)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/regional_no2_vs_co.png"); plt.close(fig)

# D. water vapour per K
wv = res["water_vapour"]
cmap_w = mcolors.LinearSegmentedColormap.from_list("w", ["#f4f3ee", viz.BLUE_ARM[3], viz.BLUE_ARM[1], viz.BLUE_ARM[0]])
fig = plt.figure(figsize=(12, 6.6), dpi=180)
ax = fig.add_axes([0.02, 0.15, 0.96, 0.67], projection=ccrs.Robinson())
im = gmap(ax, np.where(rr > 0.2, cc, np.nan), cmap_w, 0, 14)
cbar(fig, im, [0.3, 0.10, 0.4, 0.022], "% more water vapour per 1 K warmer (monthly anomalies; shown where r > 0.2)", ticks=[0, 2, 4, 6, 7, 8, 10, 12, 14])
fig.text(0.02, 0.965, "Warmer air, wetter air: how much water vapour each degree adds (AIRS)", fontsize=15, fontweight="bold", va="top")
sub = (f"Physics (Clausius–Clapeyron) says saturated air holds ~7% more water per °C. Over the oceans AIRS finds {wv['ocean_pixel_mean_pct_per_K']:.1f}%/K month to month "
       f"({wv['ocean_annual_global_pct_per_K']:.1f}%/K for the ocean-mean year-to-year); dry continents add less because there is less water to evaporate. "
       f"Ocean water vapour {wv['ocean_TPW_trend_pct_per_decade']:+.1f}%/decade since 2003 (p={wv['ocean_TPW_trend_p']:.1g}).")
fig.text(0.02, 0.915, "\n".join(textwrap.wrap(sub, 160)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, "Data: NASA AIRS/Aqua L3 v7 monthly (AIRS3STM, daytime node), 2002–2026.", fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/map_water_vapour_per_K.png"); plt.close(fig)

tl.runlog(TASK, "done", f"ozone AIRS~OMI r={o_['median_r']:.2f}; fire->CO r={s_['median_r_fire_CO_fiery']:.2f}; NO2 polluted sig down {res['no2']['frac_polluted_sig_down']:.0%}/up "
          f"{res['no2']['frac_polluted_sig_up']:.0%}; WV {wv['ocean_pixel_mean_pct_per_K']:.1f}%/K")
tl.fix_perms(out)
print("done")
