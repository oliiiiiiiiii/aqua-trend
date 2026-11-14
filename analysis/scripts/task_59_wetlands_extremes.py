"""Task 59 - Wetlands at the extremes: the Pantanal dries out and burns, while the Sahel's great wetlands refill.

Data: GRACE/GRACE-FO JPL mascons (water storage, 2002-2026); GPCP v2.3 rain (1979-2025); NASA FIRMS MODIS Aqua active-fire detections
(vegetation fires, 2003-2025; Aqua only, to avoid mixing satellites); MODIS NDVI.
Regions (boxes): Pantanal (58.5-55W, 21-15.5S); Inner Niger Delta (6-3W, 13.5-16.5N); Lake Chad basin (13-16E, 11.5-14.5N).
Tests: Theil-Sen + Hamed-Rao MK on annual means; Pettitt change point on monthly anomalies; Pantanal fire counts 2019-2024 vs 2003-2018
(rate ratio, exact conditional binomial test with an overdispersion caveat, plus Mann-Whitney on annual counts); Spearman between annual
fires and the dry-season (Jul-Oct) water-storage anomaly and the preceding wet-season (Nov-Apr) rain.
"""
import sys
import glob
import textwrap
import numpy as np
import pandas as pd
from scipy import stats
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

TASK = "59_wetlands_extremes"
out = tl.task_dir(TASK)
SRC = "Data: GRACE/GRACE-FO JPL mascons; GPCP v2.3; NASA FIRMS MODIS (Aqua) active fires."
BOX = {"Pantanal": (-58.5, -55, -21, -15.5), "Inner Niger Delta": (-6, -3, 13.5, 16.5), "Lake Chad basin": (13, 16, 11.5, 14.5)}
tws, pg = hub.load("tws"), hub.load("p_gpcp")
LA, LO = np.meshgrid(hub.LAT, hub.LON, indexing="ij")


def bm(da, b):
    m = (LO >= b[0]) & (LO <= b[1]) & (LA >= b[2]) & (LA <= b[3]); w = np.cos(np.deg2rad(LA)) * m
    return pd.Series([np.nansum(np.nan_to_num(x) * w) / np.sum(w * np.isfinite(x)) if np.isfinite(x[m]).any() else np.nan for x in da.values],
                     pd.DatetimeIndex(da.time.values))


def fires(b):
    cnt = {}
    lat = -89.75 + 0.5 * np.arange(360); lon = -179.75 + 0.5 * np.arange(720)
    m = (lat[:, None] >= b[2]) & (lat[:, None] <= b[3]) & (lon[None] >= b[0]) & (lon[None] <= b[1])
    mon = {}
    for f in sorted(glob.glob(f"{ROOT}/data/processed/firms/modis_*_0p5_monthly.npz")):
        y = int(_os.path.basename(f).split("_")[1]); z = np.load(f)
        if y < 2003:
            continue
        a = z["count_A"]
        cnt[y] = float(a.sum(0)[m].sum())
        for k in range(12):
            mon[pd.Timestamp(year=y, month=k + 1, day=1)] = float(a[k][m].sum())
    return pd.Series(cnt), pd.Series(mon)


res, S = {}, {}
for nm, b in BOX.items():
    t = bm(tws, b).dropna(); r = bm(pg, b)
    an = t - t.groupby(t.index.month).transform("mean")
    k, K, pp = tl.pettitt(an.values)
    ann = t.groupby(t.index.year).agg(["mean", "count"]); ann = ann[ann["count"] >= 9]["mean"].loc[2003:2025]
    ra = r.groupby(r.index.year).mean().loc[1981:2025]
    mk_t, mk_r, mk_r2 = tl._mk_hr(ann.values), tl._mk_hr(ra.values), tl._mk_hr(ra.loc[2003:2025].values)
    res[nm] = dict(tws_trend_cm_per_dec=float(mk_t["sen"] * 10), tws_p=float(mk_t["p"]), pettitt_month=str(an.index[k].date()), pettitt_p=float(pp),
                   tws_mean_before=float(an[:an.index[k]].mean()), tws_mean_after=float(an[an.index[k]:].mean()),
                   rain_trend_pct_dec_1981_2025=float(mk_r["sen"] * 10 / ra.mean() * 100), rain_p_1981_2025=float(mk_r["p"]),
                   rain_trend_pct_dec_2003_2025=float(mk_r2["sen"] * 10 / ra.loc[2003:2025].mean() * 100), rain_p_2003_2025=float(mk_r2["p"]),
                   tws_annual=ann.round(2).to_dict())
    S[nm] = dict(t=t, an=an, r=r, ra=ra, ann=ann)
    print(nm, {k_: v for k_, v in res[nm].items() if k_ != "tws_annual"}, flush=True)
fa, fm = fires(BOX["Pantanal"])
S["Pantanal"]["fires"] = fa
pre, post = fa.loc[2003:2018], fa.loc[2019:2024]
n1, n2, T1, T2 = post.sum(), pre.sum(), len(post), len(pre)
rr = (n1 / T1) / (n2 / T2)
p_bin = stats.binomtest(int(n1), int(n1 + n2), T1 / (T1 + T2), alternative="greater").pvalue
p_mw = stats.mannwhitneyu(post, pre, alternative="greater").pvalue
an_p = S["Pantanal"]["an"]
dry = an_p[an_p.index.month.isin([7, 8, 9, 10])].groupby(an_p[an_p.index.month.isin([7, 8, 9, 10])].index.year).mean()
rp = S["Pantanal"]["r"]
wet = {y: rp[f"{y - 1}-11-01":f"{y}-04-01"].mean() for y in range(2003, 2026)}
wet = pd.Series(wet)
jj = fa.index.intersection(dry.index)
rho_dry, p_dry = stats.spearmanr(fa[jj], dry[jj])
rho_wet, p_wet = stats.spearmanr(fa.loc[2003:2025], wet.loc[2003:2025])
res["pantanal_fires"] = dict(annual=fa.astype(int).to_dict(), mean_2003_2018=float(pre.mean()), mean_2019_2024=float(post.mean()), rate_ratio=float(rr),
                             p_binomial_overdispersed_caveat=float(p_bin), p_mannwhitney=float(p_mw), record_years=fa.sort_values(ascending=False).head(3).astype(int).to_dict(),
                             spearman_vs_dry_season_tws=dict(rho=float(rho_dry), p=float(p_dry), n=len(jj)),
                             spearman_vs_wet_season_rain=dict(rho=float(rho_wet), p=float(p_wet)))
print(res["pantanal_fires"], flush=True)
tt = pd.DatetimeIndex(tws.time.values)
with np.errstate(all="ignore"):
    import warnings
    warnings.simplefilter("ignore")
    dmap = np.nanmean(tws.values[(tt.year >= 2019) & (tt.year <= 2025)], 0) - np.nanmean(tws.values[(tt.year >= 2003) & (tt.year <= 2018)], 0)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.8), dpi=170)
cm = viz.div_cmap("water")
for k, (ext, title, names) in enumerate((([-66, -48, -26, -10], "A  Water storage, 2019–25 minus 2003–18", ["Pantanal"]),
                                         ([-12, 22, 5, 22], "B  West Africa: water storage, 2019–25 minus 2003–18", ["Inner Niger Delta", "Lake Chad basin"]))):
    axm = fig.add_axes([0.01, 0.53, 0.20, 0.30] if k == 0 else [0.50, 0.53, 0.46, 0.30], projection=ccrs.PlateCarree())
    axm.set_extent(ext, ccrs.PlateCarree())
    im = axm.pcolormesh(hub.LON, hub.LAT, dmap, cmap=cm, vmin=-15, vmax=15, transform=ccrs.PlateCarree(), shading="auto", rasterized=True)
    axm.add_feature(cfeature.COASTLINE.with_scale("50m"), lw=0.5, color=viz.INK2); axm.add_feature(cfeature.BORDERS.with_scale("50m"), lw=0.3, color=viz.MUTED)
    axm.add_feature(cfeature.RIVERS.with_scale("50m"), lw=0.4, color=viz.BLUE_ARM[2])
    for nm in names:
        b = BOX[nm]
        axm.plot([b[0], b[1], b[1], b[0], b[0]], [b[2], b[2], b[3], b[3], b[2]], color=viz.INK, lw=1.2, transform=ccrs.PlateCarree())
        axm.text(b[0], b[3] + 0.4, nm, fontsize=8, color=viz.INK, transform=ccrs.PlateCarree(), bbox=dict(fc=viz.SURFACE, ec="none", alpha=0.8, pad=0.6))
    axm.set_title(title, fontsize=9.5, loc="left", fontweight="bold")
cax = fig.add_axes([0.415, 0.56, 0.008, 0.24]); cb = fig.colorbar(im, cax=cax); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7, length=0)
cb.set_label("cm of water", fontsize=7.5, color=viz.INK2)
# Pantanal stack: water, rain, fire
P = S["Pantanal"]
a1 = fig.add_axes([0.24, 0.68, 0.14, 0.15])
a1.plot(P["an"].index, P["an"].rolling(3, center=True, min_periods=2).mean(), color=viz.SERIES[0], lw=1.4); a1.axhline(0, color=viz.AXIS, lw=0.8)
a1.set_title("Pantanal water (GRACE, cm)", fontsize=8.5, loc="left", fontweight="bold")
a2 = fig.add_axes([0.24, 0.53, 0.14, 0.10])
ra = P["ra"].loc[2003:2025]
a2.bar(ra.index, ra - P["ra"].loc[1981:2010].mean(), color=[viz.BLUE_ARM[2] if v >= 0 else viz.ORANGE_ARM[2] for v in (ra - P["ra"].loc[1981:2010].mean())], width=0.8)
a2.set_title("rain vs 1981–2010 (mm/day)", fontsize=8.5, loc="left", fontweight="bold")
for a_ in (a1, a2):
    for sp_ in ("top", "right", "left"):
        a_.spines[sp_].set_visible(False)
    a_.tick_params(length=0, labelsize=7); a_.grid(axis="y", color=viz.GRID, lw=0.5)
    a_.set_xlim(pd.Timestamp("2002-06-01") if a_ is a1 else 2002.5, pd.Timestamp("2026-06-01") if a_ is a1 else 2025.5)
# big fire panel
ax = fig.add_axes([0.06, 0.09, 0.40, 0.33])
fcol = [viz.ORANGE_ARM[3] if y in (2020, 2024) else (viz.ORANGE_ARM[2] if y >= 2019 else "#b9b8b0") for y in fa.index]
ax.bar(fa.index, fa.values / 1000, color=fcol, width=0.8)
F = res["pantanal_fires"]
ax.set_ylabel("fire detections per year (thousands, MODIS Aqua)", color=viz.INK2, fontsize=8.5)
ax.set_title("C  Pantanal fires: the dry years burn", fontsize=10, loc="left", fontweight="bold")
ax.text(0.02, 0.96, f"2019–24 mean {F['mean_2019_2024'] / 1000:.1f}k vs {F['mean_2003_2018'] / 1000:.1f}k in 2003–18 (×{F['rate_ratio']:.1f}, Mann-Whitney p = {F['p_mannwhitney']:.2f})\n"
        f"fires vs dry-season water storage: Spearman ρ = {F['spearman_vs_dry_season_tws']['rho']:+.2f} (p = {F['spearman_vs_dry_season_tws']['p']:.3f})\n"
        f"fires vs preceding wet-season rain: ρ = {F['spearman_vs_wet_season_rain']['rho']:+.2f} (p = {F['spearman_vs_wet_season_rain']['p']:.3f})",
        transform=ax.transAxes, fontsize=8, va="top", color=viz.INK2)
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
ax.set_ylim(0, fa.max() / 1000 * 1.45)
# Sahel wetlands series
ax2 = fig.add_axes([0.56, 0.09, 0.40, 0.33])
for nm, col in (("Inner Niger Delta", viz.SERIES[0]), ("Lake Chad basin", viz.SERIES[2])):
    an_ = S[nm]["an"]
    ax2.plot(an_.index, an_.rolling(12, center=True, min_periods=8).mean(), color=col, lw=2.2)
    ax2.plot(an_.index, an_.values, color=col, lw=0.6, alpha=0.4)
    R_ = res[nm]
    ax2.text(an_.index[-1] + pd.Timedelta(days=60), an_.rolling(12, center=True, min_periods=6).mean().dropna().iloc[-1],
             f"{nm}\n{R_['tws_trend_cm_per_dec']:+.0f} cm/decade", fontsize=8, color=viz.INK, va="center")
ax2.axhline(0, color=viz.AXIS, lw=0.8)
ax2.set_xlim(pd.Timestamp("2002-06-01"), pd.Timestamp("2030-06-01"))
ax2.set_ylabel("water storage anomaly (cm; line: 12-month mean)", color=viz.INK2, fontsize=8.5)
ax2.set_title("D  The Sahel's wetlands refill as its rains recover", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax2.spines[sp_].set_visible(False)
ax2.grid(axis="y", color=viz.GRID, lw=0.5); ax2.tick_params(length=0, labelsize=8)
Pn, Ni, Ch = res["Pantanal"], res["Inner Niger Delta"], res["Lake Chad basin"]
fig.text(0.01, 0.975, "Wetlands at the extremes: the Pantanal dries out and burns, while the Sahel's great wetlands refill", fontsize=15, fontweight="bold", va="top")
subt = (f"The Pantanal, the world's largest tropical wetland, lost water after {pd.Timestamp(Pn['pettitt_month']):%Y} (Pettitt p = {Pn['pettitt_p']:.0e}; mean anomaly "
        f"{Pn['tws_mean_before']:+.0f} → {Pn['tws_mean_after']:+.0f} cm) as six dry years followed; 2024 was the lowest in the GRACE record. Fire detections in 2019–24 averaged "
        f"×{F['rate_ratio']:.1f} the 2003–18 rate, with records in 2020 and 2024; each year's fires follow the preceding wet season's rain (ρ = {F['spearman_vs_wet_season_rain']['rho']:+.2f}, "
        f"p = {F['spearman_vs_wet_season_rain']['p']:.2f}). "
        f"Across the Atlantic the opposite: the Inner Niger Delta ({Ni['tws_trend_cm_per_dec']:+.0f} cm/decade) and Lake Chad basin ({Ch['tws_trend_cm_per_dec']:+.0f} cm/decade) "
        f"are refilling as Sahel rain recovers ({Ni['rain_trend_pct_dec_1981_2025']:+.0f}%/decade since 1981).")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/wetlands_extremes.png"); plt.close(fig)
tl.runlog(TASK, "done", f"Pantanal TWS step {Pn['pettitt_month']} (p={Pn['pettitt_p']:.0e}), fires x{F['rate_ratio']:.1f}; Niger delta {Ni['tws_trend_cm_per_dec']:+.0f} cm/dec")
tl.fix_perms(out)
print("done")
