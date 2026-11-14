"""Task 67 - Is the Amazon losing resilience? An early-warning signal (rising autocorrelation) in 26 years of MODIS greenness.

Idea (critical slowing down): a system approaching a tipping point recovers more slowly from shocks, so its fluctuations become more
autocorrelated. Data: MODIS NDVI monthly (hub, 0.5 deg, 2000-2026); GPCP/IMERG rain.
Method per forest pixel (Amazon box 80-44W, 20S-8N, mean NDVI > 0.75): deseasonalise; remove slow changes with a centred 25-month running
mean; lag-1 autocorrelation (AR1) in 5-year (60-month) rolling windows; Kendall tau of AR1 vs time (tau > 0 = slowing recovery).
Significance for the forest-mean AR1 series: 1,000 phase-randomised surrogates of the residual series (same spectrum, no trend in memory).
Comparison: the per-pixel tau vs the dry-season (Jul-Oct) rain trend (task 33b/W15).
Caveats: NDVI saturates over dense canopy and is cloud-affected in the wet season; MODIS sensor changes; result is an indicator, not proof.
"""
import sys
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

TASK = "67_amazon_resilience"
out = tl.task_dir(TASK)
SRC = "Data: Terra MODIS NDVI (monthly, 0.5°); GPCP v2.3 rain. Method: rolling lag-1 autocorrelation (critical slowing down)."
rng = np.random.default_rng(67)
nd = hub.load("ndvi")
t = pd.DatetimeIndex(nd.time.values)
LAT, LON = hub.LAT, hub.LON
la = (LAT >= -20) & (LAT <= 8); lo = (LON >= -80) & (LON <= -44)
X = nd.values[:, la][:, :, lo].astype(np.float64)
lat_s, lon_s = LAT[la], LON[lo]
land = hub.land_mask()[la][:, lo]
mean_nd = np.nanmean(X, 0)
forest = land & (mean_nd > 0.75) & (np.isfinite(X).mean(0) > 0.85)
print("forest pixels", forest.sum(), "months", len(t), t[0].date(), t[-1].date(), flush=True)
anom, _ = tl.deseason(X, t.month.values)
W = 60


def residual(a):
    s = pd.DataFrame(a.reshape(len(t), -1))
    s = s.interpolate(limit=3, limit_direction="both")
    trend = s.rolling(25, center=True, min_periods=13).mean()
    return (s - trend).values.reshape(a.shape)


def rolling_ar1(r):
    """r: (nt, n) -> AR1 per window end (nt - W + 1, n)."""
    nt = r.shape[0]
    outa = np.full((nt - W + 1, r.shape[1]), np.nan)
    for k in range(nt - W + 1):
        seg = r[k:k + W]
        a = seg[1:]; b = seg[:-1]
        ok = np.isfinite(a) & np.isfinite(b)
        am = np.where(ok, a, np.nan); bm = np.where(ok, b, np.nan)
        with np.errstate(all="ignore"):
            am = am - np.nanmean(am, 0); bm = bm - np.nanmean(bm, 0)
            outa[k] = np.nansum(am * bm, 0) / np.sqrt(np.nansum(am ** 2, 0) * np.nansum(bm ** 2, 0))
    return outa


R = residual(anom)
idx = np.where(forest.ravel())[0]
Rf = R.reshape(len(t), -1)[:, idx]
AR = rolling_ar1(Rf)
tw = t[W - 1:]
tau = np.full(len(idx), np.nan)
xr = np.arange(AR.shape[0])
for j in range(len(idx)):
    y = AR[:, j]; ok = np.isfinite(y)
    if ok.sum() > 100:
        tau[j] = stats.kendalltau(xr[ok], y[ok])[0]
TAU = np.full(forest.size, np.nan); TAU[idx] = tau; TAU = TAU.reshape(forest.shape)
res = dict(n_pixels=int(len(idx)), frac_tau_pos=float(np.nanmean(tau > 0)), frac_tau_gt_0p3=float(np.nanmean(tau > 0.3)),
           frac_tau_lt_m0p3=float(np.nanmean(tau < -0.3)), median_tau=float(np.nanmedian(tau)))
# forest-mean residual series and surrogate test
w = np.cos(np.deg2rad(lat_s))[:, None] * np.ones(len(lon_s))[None]
wf = (w * forest).ravel()[idx]
rmean = np.nansum(np.nan_to_num(Rf) * wf, 1) / np.sum(wf * np.isfinite(Rf), 1)
arm = rolling_ar1(rmean[:, None])[:, 0]
tau_mean = stats.kendalltau(np.arange(len(arm)), arm)[0]
# per-pixel AR1 averaged (more robust than AR1 of the mean)
arm_pix = np.nanmean(AR, 1)
tau_pix = stats.kendalltau(np.arange(len(arm_pix)), arm_pix)[0]
x0 = np.nan_to_num(rmean - np.nanmean(rmean)); amp = np.abs(np.fft.rfft(x0))
taus = []
for _ in range(1000):
    ph = rng.uniform(0, 2 * np.pi, len(amp)); ph[0] = 0
    if len(x0) % 2 == 0:
        ph[-1] = 0
    sr = np.fft.irfft(amp * np.exp(1j * ph), len(x0))
    a_ = rolling_ar1(sr[:, None])[:, 0]
    taus.append(stats.kendalltau(np.arange(len(a_)), a_)[0])
taus = np.array(taus)
res.update(tau_forest_mean_series=float(tau_mean), p_surrogate_forest_mean=float((np.sum(taus >= tau_mean) + 1) / (len(taus) + 1)),
           tau_mean_of_pixel_ar1=float(tau_pix), ar1_first_window=float(arm_pix[0]), ar1_last_window=float(arm_pix[-1]),
           first_window_end=str(tw[0].date()), last_window_end=str(tw[-1].date()))
# dry-season rain trend per pixel (GPCP, 2000-2025) for comparison
pg = hub.load("p_gpcp"); tp = pd.DatetimeIndex(pg.time.values)
P = pg.values[:, la][:, :, lo]
yrs = np.arange(2001, 2026)
dry = np.stack([np.nanmean(P[(tp.year == y) & tp.month.isin([7, 8, 9, 10])], 0) for y in yrs])
dry_tr = tl.sen_grid(dry, yrs.astype(float)) * 10 / np.nanmean(dry, 0) * 100
okc = forest & np.isfinite(TAU) & np.isfinite(dry_tr)
rs, ps = stats.spearmanr(TAU[okc], dry_tr[okc])
res["spearman_tau_vs_dry_season_rain_trend"] = dict(rho=float(rs), p_naive=float(ps), n=int(okc.sum()))
# south vs north
south = forest & (np.repeat(lat_s[:, None], len(lon_s), 1) < -5)
res["median_tau_south_of_5S"] = float(np.nanmedian(TAU[south])); res["median_tau_north_of_5S"] = float(np.nanmedian(TAU[forest & ~south]))
print(res, flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.6), dpi=170)
proj = ccrs.PlateCarree()
ax = fig.add_axes([0.01, 0.10, 0.42, 0.72], projection=proj)
ax.set_extent([-80, -44, -20, 8], proj)
im = ax.pcolormesh(lon_s, lat_s, TAU, cmap=viz.div_cmap("redblue"), vmin=-0.6, vmax=0.6, transform=proj, shading="auto", rasterized=True)
ax.add_feature(cfeature.COASTLINE.with_scale("50m"), lw=0.5, color=viz.INK2); ax.add_feature(cfeature.BORDERS.with_scale("50m"), lw=0.3, color=viz.MUTED)
ax.add_feature(cfeature.RIVERS.with_scale("50m"), lw=0.4, color=viz.BLUE_ARM[3])
ax.set_title("A  Trend in greenness 'memory' (Kendall τ of rolling AR1), forest pixels", fontsize=10, loc="left", fontweight="bold")
cax = fig.add_axes([0.05, 0.075, 0.34, 0.013]); cb = fig.colorbar(im, cax=cax, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7.5, length=0); cb.set_label("τ > 0 (red): recovering more slowly from shocks, an early-warning sign", fontsize=7.8, color=viz.INK2)
a2 = fig.add_axes([0.52, 0.52, 0.45, 0.30])
q25, q75 = np.nanpercentile(AR, 25, 1), np.nanpercentile(AR, 75, 1)
a2.fill_between(tw, q25, q75, color=viz.RED_ARM[0], lw=0, label="middle 50% of forest pixels")
a2.plot(tw, arm_pix, color=viz.RED_ARM[2], lw=2.2, label="forest average")
a2.legend(frameon=False, fontsize=8, loc="upper left")
a2.set_ylabel("lag-1 autocorrelation (5-year window)", fontsize=8.5, color=viz.INK2)
a2.set_title(f"B  Rolling AR1 of NDVI residuals (window end), τ = {res['tau_mean_of_pixel_ar1']:+.2f}", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    a2.spines[sp_].set_visible(False)
a2.grid(axis="y", color=viz.GRID, lw=0.5); a2.tick_params(length=0, labelsize=8)
a3 = fig.add_axes([0.52, 0.10, 0.20, 0.30])
a3.hist(taus, bins=40, color="#b9b8b0"); a3.axvline(tau_mean, color=viz.RED_ARM[2], lw=2)
a3.set_xlabel("τ in 1,000 surrogate forests (no change in memory)", fontsize=8, color=viz.INK2)
a3.set_title(f"C  Chance? p = {res['p_surrogate_forest_mean']:.3f}", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    a3.spines[sp_].set_visible(False)
a3.tick_params(length=0, labelsize=7.5)
a4 = fig.add_axes([0.78, 0.10, 0.19, 0.30])
a4.scatter(dry_tr[okc], TAU[okc], s=4, color=viz.SERIES[0], alpha=0.4)
a4.axhline(0, color=viz.AXIS, lw=0.8); a4.axvline(0, color=viz.AXIS, lw=0.8)
a4.set_xlabel("dry-season rain trend (%/decade)", fontsize=8, color=viz.INK2); a4.set_ylabel("τ", fontsize=8, color=viz.INK2)
a4.set_title(f"D  vs drying: ρ = {rs:+.2f}", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right"):
    a4.spines[sp_].set_visible(False)
a4.grid(color=viz.GRID, lw=0.5); a4.tick_params(length=0, labelsize=7.5)
sig_word = "significant" if res["p_surrogate_forest_mean"] < 0.05 else "not significant"
fig.text(0.01, 0.975, "Is the Amazon losing resilience? Greenness 'memory' edges up, but not yet beyond chance", fontsize=14.5, fontweight="bold", va="top")
subt = (f"Ecosystems nearing a tipping point recover from shocks (droughts, fires) more slowly, so year-to-year wiggles in greenness grow more correlated with the month before. "
        f"Across {res['n_pixels']} Amazon forest pixels, the lag-1 autocorrelation of MODIS NDVI rose on {100 * res['frac_tau_pos']:.0f}% of them (median τ = {res['median_tau']:+.2f}); "
        f"the forest-average rise (τ = {res['tau_forest_mean_series']:+.2f}) is {sig_word} against surrogates with the same spectrum (p = {res['p_surrogate_forest_mean']:.3f}). "
        f"Pixels with stronger dry-season drying show {'more' if rs > 0.1 else 'less' if rs < -0.1 else 'no more'} slowing than others (ρ = {rs:+.2f}). "
        f"NDVI saturates over dense canopy, so this is an indicator to watch, not proof of a tipping point.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/amazon_resilience.png"); plt.close(fig)
tl.runlog(TASK, "done", f"tau>0 on {100 * res['frac_tau_pos']:.0f}% of forest; forest-mean tau {res['tau_forest_mean_series']:+.2f} p={res['p_surrogate_forest_mean']:.3f}")
tl.fix_perms(out)
print("done")
