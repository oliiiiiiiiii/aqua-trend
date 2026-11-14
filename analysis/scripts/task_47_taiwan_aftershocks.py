"""Task 47 - Taiwan's big earthquakes: how fast do aftershocks fade? Hualien 2024 (M7.4) vs Chi-Chi 1999 (M7.7).

Data: USGS ComCat, Taiwan region, M>=4 (regional completeness of the global network).
Method: aftershocks = events within the Gardner-Knopoff distance window of the mainshock, up to 2 years after (Hualien: to Oct 2026).
Modified Omori (Omori-Utsu) law n(t) = K/(t+c)^p fitted by maximum likelihood (Ogata 1983), excluding the first 0.1 day
(short-term incompleteness); bootstrap 95% CI for p. Background = pre-mainshock declustered M>=4 rate in the same circle
(1990 to mainshock); 'recovery time' = when the Omori rate falls to the background rate.
"""
import sys
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
import seismo as sz  # noqa: E402

TASK = "47_taiwan_aftershocks"
out = tl.task_dir(TASK)
SRC = "Data: USGS ComCat earthquakes M≥4 around Taiwan."
D = sz.load("taiwan_m3", 4.0)
D = D[D.time < "2026-11-01"].reset_index(drop=True)
EV = {"Chi-Chi 1999": None, "Hualien 2024": None}
for nm, (t0, t1) in {"Chi-Chi 1999": ("1999-09-20", "1999-09-22"), "Hualien 2024": ("2024-04-02", "2024-04-04")}.items():
    w = D[(D.time >= t0) & (D.time < t1)]
    EV[nm] = w.loc[w.mag.idxmax()]
    print(nm, EV[nm].time, EV[nm].mag, EV[nm].lat, EV[nm].lon, flush=True)
rng = np.random.default_rng(47)
res, store = {}, {}
for nm, ms in EV.items():
    L, _ = sz.gk_windows(np.array([ms.mag]))
    R = float(L[0])
    d = sz.haversine_km(ms.lat, ms.lon, D.lat.values, D.lon.values)
    near = D[d <= R].copy()
    tdays = (near.time - ms.time).dt.total_seconds() / 86400
    T_END = min(730.0, float((pd.Timestamp("2026-11-01") - ms.time).total_seconds() / 86400))
    aft = tdays[(tdays > 0.1) & (tdays <= T_END)].values
    fit = sz.omori_fit(aft, T_END)
    boots = []
    for _ in range(200):
        bs = rng.choice(aft, len(aft), replace=True)
        boots.append(sz.omori_fit(bs, T_END)["p"])
    lo, hi = np.percentile(boots, [2.5, 97.5])
    pre = near[(near.time >= "1990-01-01") & (near.time < ms.time)].reset_index(drop=True)
    pre_main = pre[sz.decluster_gk(pre)] if len(pre) > 5 else pre
    yrs_pre = (ms.time - pd.Timestamp("1990-01-01")).total_seconds() / 86400 / 365.25
    bg = len(pre_main) / yrs_pre / 365.25                          # events per day
    t_rec = (fit["K"] / bg) ** (1 / fit["p"]) - fit["c"] if bg > 0 else np.nan
    n1 = int(np.sum((tdays > 0) & (tdays <= 365)))
    inwin = (tdays > 0) & (tdays <= T_END)
    big = near[inwin & (near.mag >= 6)]
    n1_45 = int(np.sum((tdays > 0) & (tdays <= 365) & (near.mag >= 4.5)))
    res[nm] = dict(mag=float(ms.mag), time=str(ms.time), radius_km=R, n_aftershocks_M4_1yr=n1, n_used=int(len(aft)), window_days=T_END,
                   K=fit["K"], c=fit["c"], p=fit["p"], p_ci=[float(lo), float(hi)], background_per_yr=float(bg * 365.25),
                   recovery_years=float(t_rec / 365.25), n_M6_aftershocks=int(len(big)), largest_aftershock=float(near[inwin].mag.max()),
                   n_aftershocks_M45_1yr=n1_45)
    store[nm] = dict(t=tdays.values, near=near, ms=ms, fit=fit, bg=bg, T_END=T_END)
    print(nm, {k: (round(v, 3) if isinstance(v, float) else v) for k, v in res[nm].items()}, flush=True)
# long-term Taiwan rate (declustered M>=4) - is the island getting more active?
A = D[D.time >= "1990-01-01"].reset_index(drop=True)
A["main"] = sz.decluster_gk(A); A["year"] = A.time.dt.year
s = A[A.main].groupby("year").size().reindex(range(1990, 2026), fill_value=0)
res["taiwan_mainshock_trend_1990_2025"] = sz.rate_trend(s.index.values, s.values)
s45 = A[A.main & (A.mag >= 4.5)].groupby("year").size().reindex(range(1990, 2026), fill_value=0)
res["taiwan_mainshock_trend_M45_1990_2025"] = sz.rate_trend(s45.index.values, s45.values)
s5 = A[A.main & (A.mag >= 5.0)].groupby("year").size().reindex(range(1990, 2026), fill_value=0)
res["taiwan_mainshock_trend_M5_1990_2025"] = sz.rate_trend(s5.index.values, s5.values)
print("M>=4.5:", res["taiwan_mainshock_trend_M45_1990_2025"], "\nM>=5:", res["taiwan_mainshock_trend_M5_1990_2025"], flush=True)
print("Taiwan declustered M>=4 trend:", res["taiwan_mainshock_trend_1990_2025"], flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(13, 6.8), dpi=170)
cols = {"Chi-Chi 1999": viz.SERIES[1], "Hualien 2024": viz.SERIES[0]}
axm = fig.add_axes([0.0, 0.08, 0.33, 0.74], projection=ccrs.PlateCarree())
axm.set_extent([119.3, 123.0, 21.6, 25.6], ccrs.PlateCarree())
axm.add_feature(cfeature.LAND.with_scale("10m"), facecolor="#ecebe6"); axm.add_feature(cfeature.COASTLINE.with_scale("10m"), lw=0.6)
for nm, st in store.items():
    a = st["near"][(st["t"] > 0) & (st["t"] <= st["T_END"])]
    axm.scatter(a.lon, a.lat, s=(a.mag - 3.5) ** 2.2 * 6, color=cols[nm], alpha=0.45, linewidths=0, transform=ccrs.PlateCarree())
    axm.plot(st["ms"].lon, st["ms"].lat, marker="*", ms=16, color=cols[nm], mec=viz.INK, mew=0.8, transform=ccrs.PlateCarree())
    axm.text(st["ms"].lon + 0.12, st["ms"].lat + (0.12 if "Hualien" in nm else -0.25), f"{nm}\nM{st['ms'].mag:.1f}", fontsize=8.5, color=viz.INK,
             transform=ccrs.PlateCarree())
axm.set_title("Aftershocks M≥4 in the first 2 years", fontsize=10, loc="left")
ax = fig.add_axes([0.40, 0.12, 0.27, 0.66])
bins = np.logspace(-1, np.log10(730), 25)
for nm, st in store.items():
    tt = st["t"][(st["t"] > 0.1) & (st["t"] <= st["T_END"])]
    h, e = np.histogram(tt, bins=bins)
    mid = np.sqrt(e[1:] * e[:-1]); wdt = np.diff(e)
    ok = h > 0
    ax.loglog(mid[ok], h[ok] / wdt[ok], "o", color=cols[nm], ms=5)
    f_ = st["fit"]; tm = np.logspace(-1, np.log10(st["T_END"]), 100)
    ax.loglog(tm, f_["K"] / (tm + f_["c"]) ** f_["p"], color=cols[nm], lw=1.8, label=f"{nm}: p = {f_['p']:.2f}")
    ax.axhline(st["bg"], color=cols[nm], lw=0.8, ls=":")
ax.set_xlabel("days after the mainshock", color=viz.INK2); ax.set_ylabel("aftershocks M≥4 per day", color=viz.INK2)
ax.legend(frameon=False, fontsize=8.5, loc="upper right")
ax.text(0.98, 0.03, "dotted: pre-quake background", transform=ax.transAxes, ha="right", fontsize=7.5, color=viz.MUTED)
for sp_ in ("top", "right"):
    ax.spines[sp_].set_visible(False)
ax.grid(color=viz.GRID, lw=0.5, which="both"); ax.tick_params(length=0, labelsize=8)
ax.set_title("Omori's law: the rate fades as 1/t^p", fontsize=10, loc="left")
ax2 = fig.add_axes([0.74, 0.12, 0.24, 0.66])
for nm, st in store.items():
    tt = np.sort(st["t"][(st["t"] > 0) & (st["t"] <= st["T_END"])])
    ax2.plot(tt, np.arange(1, len(tt) + 1), color=cols[nm], lw=2.2, label=nm)
    ax2.text(tt[-1], len(tt) + 12, nm, color=cols[nm], fontsize=8.5, ha="right", va="bottom", fontweight="bold")
ax2.set_xlabel("days after the mainshock", color=viz.INK2); ax2.set_ylabel("cumulative aftershocks M≥4", color=viz.INK2)
for sp_ in ("top", "right"):
    ax2.spines[sp_].set_visible(False)
ax2.grid(color=viz.GRID, lw=0.5); ax2.tick_params(length=0, labelsize=8)
ax2.set_title("Productivity", fontsize=10, loc="left")
h_, c_ = res["Hualien 2024"], res["Chi-Chi 1999"]
fig.text(0.01, 0.965, "Taiwan's two great earthquakes: aftershocks fade at the same Omori rate, p ≈ 0.95", fontsize=15, fontweight="bold", va="top")
sub = (f"Chi-Chi (M{c_['mag']:.1f}, 1999): {c_['n_aftershocks_M4_1yr']} aftershocks M≥4 in the first year, decay p = {c_['p']:.2f} "
       f"[{c_['p_ci'][0]:.2f}–{c_['p_ci'][1]:.2f}]. Hualien (M{h_['mag']:.1f}, 2024): {h_['n_aftershocks_M4_1yr']} in the first year, p = {h_['p']:.2f} "
       f"[{h_['p_ci'][0]:.2f}–{h_['p_ci'][1]:.2f}]; extrapolating the fit, its aftershock rate returns to the pre-quake background after ≈{h_['recovery_years']:.0f} years "
       f"(Chi-Chi ≈{c_['recovery_years']:.0f}). "
       f"Island-wide, independent M≥4 quakes rise {res['taiwan_mainshock_trend_1990_2025']['pct_per_decade']:+.0f}%/decade (p = {res['taiwan_mainshock_trend_1990_2025']['p']:.3f}) "
       f"but M≥5 do not ({res['taiwan_mainshock_trend_M5_1990_2025']['pct_per_decade']:+.0f}%/decade, p = {res['taiwan_mainshock_trend_M5_1990_2025']['p']:.2f}): better detection, "
       f"which also inflates Hualien's count relative to Chi-Chi.")
fig.text(0.01, 0.915, "\n".join(textwrap.wrap(sub, 180)), fontsize=9.3, color=viz.INK2, va="top")
fig.text(0.99, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/taiwan_aftershocks.png"); plt.close(fig)
tl.runlog(TASK, "done", f"Chi-Chi p={c_['p']:.2f}, Hualien p={h_['p']:.2f} (recovery {h_['recovery_years']:.1f} yr); Taiwan mainshock trend p={res['taiwan_mainshock_trend_1990_2025']['p']:.2f}")
tl.fix_perms(out)
print("done")
