"""Task 38 - Hydroclimate whiplash: are rapid swings between very dry and very wet spells becoming more common?

Per pixel, 3-month rain totals S3(t) (window ending month t), converted to percentiles within each calendar end-month
(empirical ranks, 1980-2025 base). Whiplash event at t: S3(t) <= 10th pct and S3(t+3) >= 90th pct (dry->wet) or the reverse
(wet->dry); consecutive months of the same type merged into one event. Rates in 1980-2002 vs 2003-2025 (equal 23-yr halves).
Datasets: GPCP v2.3 (2.5 deg, gauge+satellite) and MERRA-2 PRECTOTCORR (gauge-corrected reanalysis) as cross-check.
Land only (P > 200 mm/yr), 60S-75N. Aggregate: land-area-weighted events per year -> trend; per pixel: Poisson rate-ratio test, FDR.
"""
import sys
import numpy as np
import pandas as pd
import xarray as xr
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
import hotspots as hs  # noqa: E402

TASK = "38_whiplash"
out = tl.task_dir(TASK)
SRC = "Data: GPCP v2.3 monthly (1980–2025) and MERRA-2 PRECTOTCORR (gauge-corrected). Percentiles per calendar month."
lon, lat = hub.LON, hub.LAT
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
land0 = hub.land_mask() & (lat[:, None] > -60) & (lat[:, None] < 75) & ~(cg == inv.get("Greenland", -9))
w = np.cos(np.deg2rad(lat))[:, None] * np.ones(land0.shape)
Y0, Y1 = 1980, 2025


def events(da, label, stride=1):
    (P,), t = hub.align(da, start=f"{Y0}-01-01", end=f"{Y1}-12-31")
    full = pd.date_range(f"{Y0}-01-01", f"{Y1}-12-01", freq="MS")
    a = P.reindex(time=full).values[:, ::stride, ::stride].astype(np.float32)
    ok = land0[::stride, ::stride] & (np.nanmean(a, 0) * 365 > 200) & np.isfinite(a).all(0)
    S3 = np.full_like(a, np.nan)
    S3[2:] = a[:-2] + a[1:-1] + a[2:]
    m = full.month.values
    pct = np.full_like(S3, np.nan)
    for mm in range(1, 13):
        sel = np.where((m == mm) & np.isfinite(S3).all(axis=(1, 2)))[0]
        x = S3[sel]
        pct[sel] = (stats.rankdata(x, axis=0) - 0.5) / len(sel)
    dry = pct <= 0.10; wet = pct >= 0.90
    d2w = np.zeros_like(dry); w2d = np.zeros_like(dry)
    d2w[:-3] = dry[:-3] & wet[3:]; w2d[:-3] = wet[:-3] & dry[3:]
    # merge consecutive months of the same event type -> count onsets only
    def onsets(b):
        o = b.copy(); o[1:] &= ~b[:-1]
        return o
    d2w, w2d = onsets(d2w), onsets(w2d)
    ev = (d2w | w2d)
    ev[:, ~ok] = False
    yrs = full.year.values
    cnt = np.stack([ev[yrs == y].sum(0) for y in range(Y0, Y1 + 1)]).astype(np.float32)
    early = (np.arange(Y0, Y1 + 1) <= 2002); late = ~early
    n_e, n_l = cnt[early].sum(0), cnt[late].sum(0)
    # conditional binomial test for equal Poisson rates (equal exposure)
    tot = n_e + n_l
    p = np.where(tot > 0, 2 * np.minimum(stats.binom.cdf(np.minimum(n_e, n_l), tot.astype(int), 0.5), 0.5), np.nan)
    p = np.where(ok, np.clip(p, 0, 1), np.nan)
    sig = tl.fdr_mask(p, q=0.10)
    ww = w[::stride, ::stride]
    ann = pd.Series((cnt[:, ok] * ww[ok]).sum(1) / ww[ok].sum(), index=pd.to_datetime([f"{y}-07-01" for y in range(Y0, Y1 + 1)]))
    st = tl.series_trend(ann, label, "events/yr", deseasonalize=False)
    rate_e = float(ann[early].mean()); rate_l = float(ann[late].mean())
    d2w_l = (d2w[:, ok] * ww[ok]).sum(1) / ww[ok].sum(); w2d_l = (w2d[:, ok] * ww[ok]).sum(1) / ww[ok].sum()
    yy = full.year.values
    r = dict(rate_early=rate_e, rate_late=rate_l, ratio=rate_l / rate_e, trend_per_decade=st["slope_per_decade"], p=st["p_ols_ar1"], mk_p=st["mk_annual_p"],
             d2w_early=float(d2w_l[yy <= 2002].sum() / 23), d2w_late=float(d2w_l[yy > 2002].sum() / 23),
             w2d_early=float(w2d_l[yy <= 2002].sum() / 23), w2d_late=float(w2d_l[yy > 2002].sum() / 23),
             frac_sig_up=float(ww[sig & (n_l > n_e)].sum() / ww[ok].sum()), frac_sig_down=float(ww[sig & (n_l < n_e)].sum() / ww[ok].sum()),
             frac_any_up=float(ww[ok & (n_l > n_e)].sum() / ww[ok].sum()), frac_any_down=float(ww[ok & (n_l < n_e)].sum() / ww[ok].sum()))
    print(f"[{label}] land-mean whiplash events/yr {rate_e:.3f} -> {rate_l:.3f} (x{r['ratio']:.2f}); trend {st['slope_per_decade']:+.4f}/dec p={st['p_ols_ar1']:.3g} "
          f"mk={st['mk_annual_p']:.3g}; dry->wet {r['d2w_early']:.3f}->{r['d2w_late']:.3f}, wet->dry {r['w2d_early']:.3f}->{r['w2d_late']:.3f}; "
          f"pixels more {r['frac_any_up']:.0%} / fewer {r['frac_any_down']:.0%}; sig {r['frac_sig_up']:.1%}/{r['frac_sig_down']:.1%}", flush=True)
    ratio_map = np.where(ok, (n_l + 0.5) / (n_e + 0.5), np.nan)
    return dict(res=r, ann=ann, ratio=ratio_map, sig=sig, ok=ok, n_e=n_e, n_l=n_l)


G = events(hub.load("p_gpcp"), "GPCP", stride=5)  # GPCP is 2.5 deg repeated -> use native resolution
M = events(hub.load("p_m2"), "MERRA-2")
# robustness to the threshold choice is implicit in the binomial test; also correlate the two annual series
r_ann = float(np.corrcoef(G["ann"], M["ann"])[0, 1])
# compare maps at 2.5 deg
Mr = M["ratio"].reshape(72, 5, 144, 5)
with np.errstate(all="ignore"):
    Mc = np.exp(np.nanmean(np.log(Mr), axis=(1, 3)))
both = np.isfinite(Mc) & np.isfinite(G["ratio"])
agree = float(np.mean(np.sign(np.log(Mc[both])) == np.sign(np.log(G["ratio"][both]))))
res = dict(gpcp=G["res"], merra2=M["res"], r_annual_series=r_ann, sign_agree_2p5deg=agree)
print("GPCP vs MERRA-2 annual land-mean series r =", round(r_ann, 2), "; map sign agreement", round(agree, 2), flush=True)
# figure: annual land-mean whiplash rate, both datasets + map of rate ratio (MERRA-2 0.5 deg, faded where not sig)
viz.trend_map(lon, lat, np.log2(M["ratio"]), M["sig"], f"{out}/map_whiplash_change_merra2.png",
              "Hydroclimate whiplash: where do dry↔wet swings happen more often?",
              f"Ratio of whiplash events (3-month rain below its 10th percentile followed within 3 months by above its 90th, or the reverse), "
              f"2003–25 vs 1980–2002, MERRA-2 (log2 scale: +1 = doubled). Land mean: {M['res']['rate_early']:.2f} → {M['res']['rate_late']:.2f} events per year "
              f"(GPCP {G['res']['rate_early']:.2f} → {G['res']['rate_late']:.2f}).", "log2(rate ratio)", vmax=1.5, cmap="redblue", source=SRC)
fig, ax = plt.subplots(figsize=(11, 4.8), dpi=170)
fig.subplots_adjust(left=0.08, right=0.83, top=0.80, bottom=0.12)
for nm, X, c in (("GPCP", G, viz.SERIES[0]), ("MERRA-2", M, viz.SERIES[1])):
    a_ = X["ann"]
    ax.plot(a_.index.year, a_.values, color=c, lw=1.0, alpha=0.5)
    sm_ = a_.rolling(5, center=True, min_periods=3).mean()
    ax.plot(a_.index.year, sm_.values, color=c, lw=2.4, label=f"{nm} (5-yr mean)")
    ax.text(a_.index.year[-1] + 0.5, sm_.dropna().values[-1], f" {nm}: ×{X['res']['ratio']:.2f}, p={X['res']['p']:.2g}", fontsize=8.5, color=viz.INK2, va="center")
for sp in ("top", "right", "left"):
    ax.spines[sp].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.6); ax.tick_params(length=0)
ax.set_ylabel("whiplash events per year\n(land-area mean per location)", color=viz.INK2)
ax.legend(frameon=False, fontsize=8.5, loc="upper left")
fig.text(0.08, 0.965, "Are dry-to-wet (and wet-to-dry) swings becoming more frequent?", fontsize=14, fontweight="bold", va="top")
fig.text(0.08, 0.905, f"Average number of whiplash events per location per year over land. GPCP and MERRA-2 year-to-year r = {r_ann:.2f}.",
         fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/whiplash_rate_series.png"); plt.close(fig)
tl.save_json(res, f"{out}/stats.json")
pd.DataFrame({"gpcp": G["ann"], "merra2": M["ann"]}).to_csv(f"{out}/land_whiplash_rate.csv")
tl.runlog(TASK, "done", f"GPCP x{G['res']['ratio']:.2f} (p={G['res']['p']:.2g}), MERRA-2 x{M['res']['ratio']:.2f} (p={M['res']['p']:.2g}); map agree {agree:.0%}")
tl.fix_perms(out)
print("done")
