"""Task 34 - Rain replacing snow: is a growing share of precipitation falling as rain instead of snow?

MERRA-2 M2TMNXINT 1980-2025: snowfall PRECSN, convective rain PRECCU, large-scale rain PRECLS.
Per pixel, calendar-year totals -> snowfall fraction S/(S+CU+LS); trend (percentage points per decade, OLS-AR1 & MK, FDR q=0.10)
over land with mean snowfall fraction >= 5 %. Also snowfall amount (% per decade) and the convective share of rain (I31).
Cross-check: GLDAS-2.1 March SWE (snowpack) trend 2001-2025 vs MERRA-2 snow-fraction trend 2001-2025 (sign agreement).
"""
import sys
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "34_rain_replacing_snow"
out = tl.task_dir(TASK)
SRC = "Data: NASA MERRA-2 M2TMNXINT (PRECSN, PRECCU, PRECLS) 1980–2025; GLDAS-2.1 Noah SWE 2001–2025."
lon, lat = hub.LON, hub.LAT
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
land = hub.land_mask() & (lat[:, None] > -60) & ~(cg == inv.get("Greenland", -9))
w = np.cos(np.deg2rad(lat))[:, None] * np.ones(land.shape)
YRS = np.arange(1980, 2026)


def annual(var):
    t, a = hub._gd("m2int", var, "native")
    sel = (t.year >= 1980) & (t.year <= 2025)
    t, a = t[sel], a[sel]
    days = t.days_in_month.values.astype(np.float32)
    out_ = np.zeros((len(YRS), 361, 576), np.float32)
    for i, y in enumerate(YRS):
        m = t.year == y
        out_[i] = np.tensordot(days[m], a[m], axes=(0, 0)) * 86400.0  # mm per year
    return hub._merra_to_hub(out_)


S = annual("PRECSN"); CU = annual("PRECCU"); LS = annual("PRECLS")
TOT = S + CU + LS
with np.errstate(all="ignore"):
    frac = S / TOT * 100.0
    conv = CU / (CU + LS) * 100.0
mean_frac = frac.mean(0)
snowy = land & (mean_frac >= 5) & (TOT.mean(0) > 100)


def trend(Y, mask, rel=False):
    r = tl.ols_ar1(Y.reshape(len(Y), -1), YRS[:len(Y)].astype(float) if len(Y) == len(YRS) else np.arange(len(Y), dtype=float), min_frac=0.9)
    mk = tl.mk_grid(Y.reshape(len(Y), -1))
    p = np.where(mask.ravel(), np.fmax(r["p"], mk["p"]), np.nan)
    sig = tl.fdr_mask(p, q=0.10).reshape(mask.shape)
    sl = r["slope"].reshape(mask.shape) * 10
    if rel:
        sl = sl / Y.mean(0) * 100
    return np.where(mask, sl, np.nan), sig & mask


fr_tr, fr_sig = trend(frac, snowy)
sn_tr, sn_sig = trend(S, snowy, rel=True)
cv_tr, cv_sig = trend(conv, land & (TOT.mean(0) > 200))
f = lambda m: float(np.sum(w[m]) / np.sum(w[snowy]))
res = dict(snowy_land_mkm2=float(hs.cell_area_km2(lon, lat)[snowy].sum() / 1e6),
           frac_sig_less_snow_share=f(fr_sig & (fr_tr < 0)), frac_sig_more_snow_share=f(fr_sig & (fr_tr > 0)),
           frac_any_less=f(snowy & (fr_tr < 0)),
           snowfall_amount_sig_down=f(sn_sig & (sn_tr < 0)), snowfall_amount_sig_up=f(sn_sig & (sn_tr > 0)),
           mean_snow_frac_change_pp_per_decade=float(np.nansum(fr_tr[snowy] * w[snowy]) / np.sum(w[snowy])))
lm_ = land & (TOT.mean(0) > 200)
res["convective_share_sig_up"] = float(np.sum(w[cv_sig & (cv_tr > 0)]) / np.sum(w[lm_]))
res["convective_share_sig_down"] = float(np.sum(w[cv_sig & (cv_tr < 0)]) / np.sum(w[lm_]))
print({k: round(v, 3) for k, v in res.items()}, flush=True)
# global snowy-land series
ws = w[snowy]
ser = pd.Series([float(np.sum(frac[i][snowy] * ws) / ws.sum()) for i in range(len(YRS))], index=pd.to_datetime([f"{y}-07-01" for y in YRS]))
st = tl.series_trend(ser, "snow fraction", "%", deseasonalize=False)
res["snowy_land_mean_fraction"] = dict(first_decade=float(ser.iloc[:10].mean()), last_decade=float(ser.iloc[-10:].mean()),
                                       slope_pp_per_decade=st["slope_per_decade"], p=st["p_ols_ar1"], mk_p=st["mk_annual_p"])
print("snowy-land mean snow fraction:", {k: round(v, 4) for k, v in res["snowy_land_mean_fraction"].items()}, flush=True)
# regions
regs = {"Alps": (5, 16, 44, 48.5), "Scandinavia": (5, 30, 58, 70), "Rockies": (-125, -104, 37, 55), "High Mountain Asia": (70, 100, 27, 40),
        "Andes (south)": (-75, -66, -50, -30), "Japan & Korea": (126, 146, 33, 45), "NE China & Mongolia": (110, 135, 40, 53),
        "Eastern Europe & W Russia": (25, 60, 48, 62), "Canadian Prairies & boreal": (-120, -85, 50, 62), "Siberia": (60, 140, 55, 70)}
LON, LAT = np.meshgrid(lon, lat)
rows = []
for nm, b in regs.items():
    m = snowy & (LON >= b[0]) & (LON <= b[1]) & (LAT >= b[2]) & (LAT <= b[3])
    if m.sum() < 3:
        continue
    wm = w[m]
    s_ = pd.Series([float(np.sum(frac[i][m] * wm) / wm.sum()) for i in range(len(YRS))], index=ser.index)
    st_ = tl.series_trend(s_, nm, "%", deseasonalize=False)
    sn_ = pd.Series([float(np.sum(S[i][m] * wm) / wm.sum()) for i in range(len(YRS))], index=ser.index)
    st2 = tl.series_trend(sn_, nm, "mm", deseasonalize=False)
    rows.append(dict(region=nm, snow_frac_1980s=float(s_.iloc[:10].mean()), snow_frac_2016_25=float(s_.iloc[-10:].mean()),
                     pp_per_decade=st_["slope_per_decade"], p=st_["p_ols_ar1"], mk_p=st_["mk_annual_p"],
                     snowfall_pct_per_decade=st2["pct_per_decade"], snowfall_p=st2["p_ols_ar1"]))
df = pd.DataFrame(rows).sort_values("pp_per_decade"); df.to_csv(f"{out}/regions.csv", index=False)
print(df.round(3).to_string(), flush=True)
res["regions"] = rows
# GLDAS March SWE cross-check (2001-2025)
swe = hub.load("swe")
(Sw,), ts = hub.align(swe, start="2001-01-01", end="2025-12-31")
mar = np.stack([Sw.values[(ts.year == y) & (ts.month == 3)][0] for y in range(2001, 2026)])
okx = snowy & (np.nanmean(mar, 0) > 10)
r_sw = tl.ols_ar1(mar.reshape(25, -1), np.arange(2001, 2026, dtype=float), min_frac=0.9)
sw_tr = r_sw["slope"].reshape(land.shape)
i0 = YRS.searchsorted(2001)
r_f2 = tl.ols_ar1(frac[i0:].reshape(len(YRS) - i0, -1), YRS[i0:].astype(float), min_frac=0.9)
f2 = r_f2["slope"].reshape(land.shape)
both_ok = okx & np.isfinite(sw_tr) & np.isfinite(f2)
res["gldas_swe_vs_merra_fraction_sign_agree_2001_2025"] = float(np.sum(w[both_ok & (np.sign(sw_tr) == np.sign(f2))]) / np.sum(w[both_ok]))
res["gldas_march_swe_trend_frac_down"] = float(np.sum(w[both_ok & (sw_tr < 0)]) / np.sum(w[both_ok]))
print("GLDAS March SWE vs MERRA-2 snow fraction (2001-25) sign agreement:", round(res["gldas_swe_vs_merra_fraction_sign_agree_2001_2025"], 3),
      "SWE down on", round(res["gldas_march_swe_trend_frac_down"], 3), flush=True)

viz.trend_map(lon, lat, fr_tr, fr_sig, f"{out}/map_snow_fraction_trend.png",
              "Rain replacing snow: change in the share of precipitation falling as snow, 1980–2025",
              f"Percentage points per decade (MERRA-2). Snowy land (≥5% snow) averaged {res['snowy_land_mean_fraction']['first_decade']:.1f}% snow in the 1980s → "
              f"{res['snowy_land_mean_fraction']['last_decade']:.1f}% in 2016–25. Significant loss of snow share on {res['frac_sig_less_snow_share']:.0%} of snowy land, "
              f"gain on {res['frac_sig_more_snow_share']:.0%}.", "snow share change (percentage points per decade)", vmax=3, cmap="water", source=SRC)
viz.trend_map(lon, lat, sn_tr, sn_sig, f"{out}/map_snowfall_amount_trend.png", "Snowfall amount trend, 1980–2025 (MERRA-2)",
              "Annual snowfall, % per decade.", "% per decade", vmax=15, cmap="water", source=SRC)
viz.trend_map(lon, lat, cv_tr, cv_sig, f"{out}/map_convective_share_trend.png",
              "Is rain becoming more convective (showery, intense)? MERRA-2, 1980–2025",
              f"Trend in the convective share of rain (percentage points per decade). Model physics, not observation — treat as a hypothesis. "
              f"Significant increase on {res['convective_share_sig_up']:.0%} of land, decrease on {res['convective_share_sig_down']:.0%}.",
              "convective share change (pp per decade)", vmax=3, cmap="redblue", source=SRC)
# bar chart of regions
fig, ax = plt.subplots(figsize=(10.5, 5.6), dpi=170)
fig.subplots_adjust(left=0.27, right=0.96, top=0.80, bottom=0.12)
d2 = df.sort_values("pp_per_decade")
yy = np.arange(len(d2))
sigm = (d2.p < 0.05) & (d2.mk_p < 0.05)
ax.barh(yy, d2.pp_per_decade, color=[viz.ORANGE_ARM[2] if v < 0 else viz.BLUE_ARM[2] for v in d2.pp_per_decade], height=0.62,
        alpha=1.0)
for i, (v, s_, a0, a1) in enumerate(zip(d2.pp_per_decade, sigm, d2.snow_frac_1980s, d2.snow_frac_2016_25)):
    ax.text(v + (0.05 if v >= 0 else -0.05), i, f"{v:+.2f}{'' if s_ else ' (n.s.)'}   {a0:.0f}% → {a1:.0f}%", va="center",
            ha="left" if v >= 0 else "right", fontsize=8.5, color=viz.INK2)
ax.set_yticks(yy); ax.set_yticklabels(d2.region, fontsize=9.5, color=viz.INK2)
ax.axvline(0, color=viz.AXIS, lw=1)
for sp in ("top", "right", "left"):
    ax.spines[sp].set_visible(False)
ax.grid(axis="x", color=viz.GRID, lw=0.6); ax.tick_params(length=0)
lo_, hi_ = d2.pp_per_decade.min(), d2.pp_per_decade.max()
ax.set_xlim(min(lo_ * 1.75, -0.5), max(hi_ * 1.9, 1.3)); ax.set_axisbelow(True)
ax.set_xlabel("change in snow share of precipitation (percentage points per decade, 1980–2025)", color=viz.INK2)
fig.text(0.02, 0.965, "Mountain and northern water towers: less of the precipitation now falls as snow", fontsize=13.5, fontweight="bold", va="top")
fig.text(0.02, 0.915, "Snow share of annual precipitation per region (MERRA-2): trend and 1980s → 2016–25 averages. Snow stores winter water "
         "and releases it in spring; rain runs off at once.", fontsize=9, color=viz.INK2, va="top", wrap=True)
fig.text(0.96, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/bars_regions_snow_share.png"); plt.close(fig)
tl.save_json(res, f"{out}/stats.json")
ser.to_csv(f"{out}/snowy_land_snow_fraction_pct.csv")
xr.Dataset({"snow_frac_trend_pp_dec": (("lat", "lon"), fr_tr.astype(np.float32)), "snow_frac_sig": (("lat", "lon"), fr_sig.astype(np.float32)),
            "snowfall_trend_pct_dec": (("lat", "lon"), sn_tr.astype(np.float32)), "mean_snow_frac": (("lat", "lon"), mean_frac.astype(np.float32))},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/snow_share.nc")
tl.runlog(TASK, "done", f"snowy land snow share {res['snowy_land_mean_fraction']['first_decade']:.1f}->{res['snowy_land_mean_fraction']['last_decade']:.1f}%; "
          f"sig loss {res['frac_sig_less_snow_share']:.0%} / gain {res['frac_sig_more_snow_share']:.0%}")
tl.fix_perms(out)
print("done")
