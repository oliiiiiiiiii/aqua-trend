"""Task 69 - Why the trend tool corrects for memory and multiple testing: how many 'significant' trends appear in data that has none?

For four variables we build 'twin' datasets with exactly the same memory (power spectrum of the detrended monthly anomalies) at each pixel
but random phases, so any trend in them is an accident. We then count how often each test calls a trend 'significant' (p < 0.05):
  naive OLS t-test (assumes independent months) | OLS with AR(1)-corrected effective sample size (the tool's default) |
  Mann-Kendall on annual means | AR(1)-OLS plus Benjamini-Hochberg FDR across pixels (q = 0.10).
and compare with the same tests on the real data. Data: GRACE/GRACE-FO TWS, GPCP v2.3 rain, OISST SST, MODIS NDVI (5,000 random pixels each).
"""
import sys
import textwrap
import numpy as np
import pandas as pd
from scipy import stats
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "69_false_trends"
out = tl.task_dir(TASK)
SRC = "Data: GRACE/GRACE-FO; GPCP v2.3; NOAA OISST v2.1; Terra MODIS NDVI. Surrogates: phase randomisation (same spectrum, random phases)."
rng = np.random.default_rng(69)
land = hub.land_mask()
VARS = [("tws", "Water storage (GRACE)", land), ("p_gpcp", "Rainfall (GPCP)", land), ("sst", "Sea temperature (OISST)", ~land), ("ndvi", "Greenness (MODIS NDVI)", land)]
N = 5000


def naive_p(Y, t):
    n = Y.shape[0]; tc = t - t.mean()
    b = (tc[:, None] * (Y - Y.mean(0))).sum(0) / (tc ** 2).sum()
    r = Y - Y.mean(0) - b[None] * tc[:, None]
    se = np.sqrt((r ** 2).sum(0) / (n - 2) / (tc ** 2).sum())
    return 2 * stats.t.sf(np.abs(b / se), n - 2)


def tests(Y, t, years):
    p_naive = naive_p(Y, t)
    p_ar1 = tl.ols_ar1(Y, t, min_frac=0.0)["p"]
    ann = np.stack([Y[years == y].mean(0) for y in np.unique(years)])
    p_mk = tl.mk_grid(ann)["p"]
    fdr = tl.fdr_mask(p_ar1, 0.10)
    return dict(naive=float(np.mean(p_naive < 0.05)), ar1=float(np.nanmean(p_ar1 < 0.05)), mk=float(np.mean(p_mk < 0.05)), ar1_fdr=float(np.mean(fdr)))


res, phi_med = {}, {}
for key, lab, mask in VARS:
    da = hub.load(key)
    if key == "p_gpcp":
        da = da.sel(time=slice("1979-01-01", "2025-12-31"))
    t_ = pd.DatetimeIndex(da.time.values)
    full = pd.date_range(t_[0], t_[-1], freq="MS")
    vals = da.values
    cand = np.where((mask & (np.isfinite(vals).mean(0) > 0.85)).ravel())[0]
    pick = rng.choice(cand, size=min(N, len(cand)), replace=False)
    Y = vals.reshape(len(t_), -1)[:, pick].astype(np.float64)
    Ys = pd.DataFrame(Y, index=t_).reindex(full).interpolate(limit_direction="both").values     # fill GRACE gaps for the FFT
    anom, _ = tl.deseason(Ys, full.month.values)
    anom = anom - anom.mean(0)
    td = tl.decimal_year(full); yrs = full.year.values
    keep_y = np.isin(yrs, [y for y in np.unique(yrs) if (yrs == y).sum() == 12])
    anom, td, yrs = anom[keep_y], td[keep_y], yrs[keep_y]
    real = tests(anom, td, yrs)
    tc = td - td.mean()
    bfit = (tc[:, None] * anom).sum(0) / (tc ** 2).sum()
    resid = anom - bfit[None] * tc[:, None]          # remove each pixel's linear trend: twins keep the memory, not the trend
    amp = np.abs(np.fft.rfft(resid, axis=0))
    sur = []
    for k in range(5):
        ph = rng.uniform(0, 2 * np.pi, amp.shape); ph[0] = 0
        if anom.shape[0] % 2 == 0:
            ph[-1] = 0
        S = np.fft.irfft(amp * np.exp(1j * ph), anom.shape[0], axis=0)
        sur.append(tests(S, td, yrs))
    surm = {k: float(np.mean([s_[k] for s_ in sur])) for k in sur[0]}
    r1 = np.array([np.corrcoef(anom[1:, j], anom[:-1, j])[0, 1] for j in range(anom.shape[1])])
    res[key] = dict(label=lab, n_pixels=int(anom.shape[1]), n_months=int(anom.shape[0]), median_lag1=float(np.nanmedian(r1)), real=real, surrogate=surm)
    print(key, res[key], flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.2), dpi=170)
methods = [("naive", "naive t-test\n(months independent)"), ("mk", "Mann-Kendall\n(annual means)"), ("ar1", "AR(1)-corrected\nOLS (tool default)"), ("ar1_fdr", "AR(1) + FDR\nacross pixels")]
cols = [viz.RED_ARM[2], viz.ORANGE_ARM[2], viz.BLUE_ARM[2], viz.BLUE_ARM[0]]
for k, (key, lab, _) in enumerate(VARS):
    ax = fig.add_axes([0.05 + k * 0.24, 0.40, 0.20, 0.38])
    R_ = res[key]
    x = np.arange(len(methods))
    sv = [100 * R_["surrogate"][m] for m, _ in methods]; rv = [100 * R_["real"][m] for m, _ in methods]
    ax.bar(x - 0.2, sv, width=0.38, color=cols, alpha=0.95)
    ax.bar(x + 0.2, rv, width=0.38, color="none", edgecolor=cols, hatch="////", lw=1.2)
    ax.axhline(5, color=viz.INK, lw=0.8, ls=":")
    for i, v in enumerate(sv):
        ax.text(x[i] - 0.2, v + 1.2, f"{v:.0f}", ha="center", fontsize=7.5, color=viz.INK)
    ax.set_xticks(x); ax.set_xticklabels(["naive", "MK", "AR(1)", "AR(1)\n+FDR"], fontsize=7.8)
    ax.set_ylim(0, max(80, max(sv + rv) * 1.15))
    ax.set_title(f"{lab}\n(lag-1 memory {R_['median_lag1']:.2f}, {R_['n_months']} months)", fontsize=9.5, loc="left", fontweight="bold")
    for sp_ in ("top", "right", "left"):
        ax.spines[sp_].set_visible(False)
    ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=7.5)
    if k == 0:
        ax.set_ylabel("% of pixels called 'significant' (p < 0.05)", fontsize=8.5, color=viz.INK2)
fig.text(0.05, 0.31, "Solid bars: twin data with the same memory but no real trend (should be ≈5%, dotted line).  Hatched bars: the real data.", fontsize=9, color=viz.INK2)
axt = fig.add_axes([0.05, 0.04, 0.9, 0.24]); axt.axis("off")
G, P = res["tws"], res["p_gpcp"]
S_, N_ = res["sst"], res["ndvi"]
txt = (f"Reading this: water storage remembers the previous month strongly (lag-1 = {G['median_lag1']:.2f}), so a naive t-test calls "
       f"{100 * G['surrogate']['naive']:.0f}% of trend-free twins 'significant', {G['surrogate']['naive'] / 0.05:.0f} times the promised 5%. Correcting for memory (AR(1)) cuts that to "
       f"{100 * G['surrogate']['ar1']:.0f}%, still too many because real variability also has slow, decade-long swings that AR(1) misses; controlling the false-discovery rate across "
       f"the map brings it to {100 * G['surrogate']['ar1_fdr']:.0f}%. Even rainfall, with almost no month-to-month memory (lag-1 = {P['median_lag1']:.2f}), gives "
       f"{100 * P['surrogate']['naive']:.0f}% naive false alarms because of decadal swings, and {100 * P['surrogate']['ar1_fdr']:.0f}% after AR(1) + FDR. For sea temperature and greenness "
       f"the full procedure leaves {100 * S_['surrogate']['ar1_fdr']:.1f}% and {100 * N_['surrogate']['ar1_fdr']:.0f}%. On the real data far more pixels pass (hatched bars: "
       f"{100 * G['real']['ar1_fdr']:.0f}%, {100 * P['real']['ar1_fdr']:.0f}%, {100 * S_['real']['ar1_fdr']:.0f}%, {100 * N_['real']['ar1_fdr']:.0f}%), so most reported trends are not "
       f"artefacts of the test. This is why the tool uses AR(1)-corrected tests, Mann-Kendall as a cross-check and FDR for maps, and why a second dataset is still needed.")
axt.text(0, 1, "\n".join(textwrap.wrap(txt, 178)), fontsize=9.2, color=viz.INK, va="top")
fig.text(0.01, 0.975, f"How many 'significant' trends does a naive test find in data that has none? For water storage: {100 * res['tws']['surrogate']['naive']:.0f}%", fontsize=15, fontweight="bold", va="top")
fig.text(0.01, 0.93, "Phase-randomised twins keep each pixel's memory (the spectrum of its detrended anomalies) but scramble time, so any trend in them is chance. 5,000 random pixels per variable, 5 twins each.",
         fontsize=9.2, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/false_trends.png"); plt.close(fig)
tl.runlog(TASK, "done", "surrogate false-positive naive/AR1/FDR: " + ", ".join(f"{k} {100 * res[k]['surrogate']['naive']:.0f}/{100 * res[k]['surrogate']['ar1']:.0f}/{100 * res[k]['surrogate']['ar1_fdr']:.1f}%" for k, *_ in VARS))
tl.fix_perms(out)
print("done")
