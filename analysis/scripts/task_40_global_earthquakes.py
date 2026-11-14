"""Task 40 - Is the Earth shaking more? Global earthquake rates 1973-2025, separating real change from better detection.

Data: USGS ComCat (M>=4.5, 1973-2026) and Global CMT (independent moment magnitudes, 1976-2026).
Method:
  * Gardner-Knopoff declustering (aftershocks/foreshocks removed) -> independent mainshocks.
  * Annual counts per magnitude threshold; quasi-Poisson log-linear trend + Mann-Kendall (complete years 1973-2025).
  * Detection check: frequency-magnitude curves by decade (b-value, Aki-Utsu) and the ratio N(M>=4.5)/N(M>=6),
    which must stay constant if the catalogue were complete and b stable.
  * Map: change in declustered rate per 10-deg cell, 2001-25 vs 1976-2000, for M4.5-5.4 (detection-sensitive) and M>=6;
    exact Poisson rate-ratio test, FDR q=0.10.
  * Great-quake clustering (2004-2012 burst of M>=8.5): scan statistic over window lengths 3-15 yr, calibrated by
    Monte Carlo (uniform times given the count) so the look-elsewhere effect is included.
"""
import sys
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
import seismo as sz  # noqa: E402

TASK = "40_global_earthquakes"
out = tl.task_dir(TASK)
SRC = "Data: USGS ComCat (M≥4.5, 1973–2025) and Global CMT catalogue (Mw, 1976–2025). Aftershocks removed (Gardner–Knopoff)."
Y0, Y1 = 1973, 2025
YRS = np.arange(Y0, Y1 + 1)

U = sz.load("global_m45", 4.5)
U = U[U.time < "2026-01-01"].reset_index(drop=True)
U["main"] = sz.decluster_gk(U)
U["main_fs0"] = sz.decluster_gk(U, fs_time_prop=0.0)
G = sz.load("gcmt")
G = G[(G.time >= "1976-01-01") & (G.time < "2026-01-01") & (G.mag >= 5.0)].reset_index(drop=True)
G["main"] = sz.decluster_gk(G)
print(f"USGS {len(U)} events, {U.main.mean():.0%} mainshocks; GCMT {len(G)} Mw>=5, {G.main.mean():.0%} mainshocks", flush=True)
U["year"] = U.time.dt.year; G["year"] = G.time.dt.year


def counts(df, mmin, col=None, mmax=99, yrs=YRS):
    d = df[(df.mag >= mmin - 1e-9) & (df.mag < mmax)]
    if col:
        d = d[d[col]]
    return d.groupby("year").size().reindex(yrs, fill_value=0)


YMW = 1983   # first year in which >=79% (>=95% from 1984) of USGS M>=6 magnitudes are moment magnitudes (before: mb/Ms)
U["is_mw"] = U.magType.str.lower().str.startswith("mw")
mw_share = U[U.main & (U.mag >= 6)].groupby("year").is_mw.mean().reindex(YRS)
series = {
    "USGS M≥4.5, all events": (counts(U, 4.5), Y0),
    "USGS M≥4.5, mainshocks": (counts(U, 4.5, "main"), Y0),
    "USGS M≥6, mainshocks": (counts(U, 6.0, "main"), YMW),
    "USGS M≥7, mainshocks": (counts(U, 7.0, "main"), YMW),
    "GCMT Mw≥6, mainshocks": (counts(G, 6.0, "main", yrs=np.arange(1976, Y1 + 1)), YMW),
}
trends = {}
for k, (s, y0) in series.items():
    ss = s[s.index >= y0]
    trends[k] = sz.rate_trend(ss.index.values, ss.values)
    trends[k]["start_year"] = int(y0)
    print(f"{k:28s} {y0}-{Y1} mean {ss.mean():7.1f}/yr  {trends[k]['pct_per_decade']:+6.1f}%/dec [{trends[k]['ci_lo']:+.1f},{trends[k]['ci_hi']:+.1f}] "
          f"p={trends[k]['p']:.2g} mk={trends[k]['mk_p']:.2g} disp={trends[k]['dispersion']:.1f}", flush=True)
s6 = series["USGS M≥6, mainshocks"][0]
pk, pK, pp = tl.pettitt(s6.values.astype(float))
step = dict(pettitt_change_after_year=int(Y0 + pk), pettitt_p=float(pp), mean_before=float(s6[s6.index < YMW].mean()), mean_after=float(s6[s6.index >= YMW].mean()))
print("USGS M>=6 step:", step, flush=True)
# sensitivity: start year, foreshock window
sens = {}
for k, (mm, y0, col) in {"M≥6 main, 1973–2025 (mixed magnitude types)": (6.0, 1973, "main"), "M≥6 main, 1990–2025": (6.0, 1990, "main"),
                         "M≥6 main, 1983–2025, no foreshock window": (6.0, 1983, "main_fs0"), "M≥6 all events, 1983–2025": (6.0, 1983, None),
                         "M≥5.5 main, 1983–2025": (5.5, 1983, "main"), "M≥4.5 main, 1990–2025": (4.5, 1990, "main")}.items():
    s = counts(U, mm, col, yrs=np.arange(y0, Y1 + 1))
    sens[k] = sz.rate_trend(s.index.values, s.values)
    print(f"  sens {k:32s} {sens[k]['pct_per_decade']:+6.1f}%/dec p={sens[k]['p']:.2g}", flush=True)

for y0 in (1976, 1990):
    gs = series["GCMT Mw≥6, mainshocks"][0]; gs = gs[gs.index >= y0]
    sens[f"GCMT Mw≥6 main, {y0}–2025"] = sz.rate_trend(gs.index.values, gs.values)
    print(f"  sens GCMT from {y0}: {sens[f'GCMT Mw≥6 main, {y0}–2025']['pct_per_decade']:+.1f}%/dec p={sens[f'GCMT Mw≥6 main, {y0}–2025']['p']:.2g}", flush=True)

# --- detection: b-values and FMD per decade (mainshocks), ratio N>=4.5 / N>=6
dec = [(1973, 1984), (1985, 1994), (1995, 2004), (2005, 2014), (2015, 2025)]
fmd = {}
for a, b in dec:
    m = U[(U.year >= a) & (U.year <= b) & U.main].mag.values
    bv, bse, n = sz.bvalue(m, 5.5)  # b above 5.5 where all decades are complete
    mc = sz.mc_maxc(m)
    fmd[f"{a}–{b}"] = dict(b_above_5p5=bv, b_se=bse, n=n, mc_maxc=mc, years=b - a + 1, mags=m)
    print(f"  {a}-{b}: b(M>=5.5)={bv:.2f}±{bse:.2f} (n={n}), Mc(maxc)={mc:.1f}, N>=4.5/yr={np.sum(m >= 4.5) / (b - a + 1):.0f}, "
          f"N>=6/yr={np.sum(m >= 6) / (b - a + 1):.1f}", flush=True)
s45, s6_ = series["USGS M≥4.5, mainshocks"][0], series["USGS M≥6, mainshocks"][0]
mwy = YRS >= YMW
r456 = (s45.rolling(5, center=True, min_periods=3).sum() / s6_.rolling(5, center=True, min_periods=3).sum())[mwy]
ratio_tr = stats.kendalltau(YRS[mwy], (s45 / s6_.clip(lower=1)).values[mwy])

# --- map: 10-deg cells, rate ratio 2001-25 vs 1976-2000
def cell_change(df, mmin, mmax):
    d = df[df.main & (df.mag >= mmin) & (df.mag < mmax) & (df.year >= 1984)]
    i = np.clip(((d.lat + 90) // 10).astype(int), 0, 17); j = np.clip(((d.lon + 180) // 10).astype(int), 0, 35)
    late = (d.year >= 2005).values
    n1 = np.zeros((18, 36)); n2 = np.zeros((18, 36))
    np.add.at(n1, (i[~late], j[~late]), 1); np.add.at(n2, (i[late], j[late]), 1)
    lr = np.full((18, 36), np.nan); p = np.full((18, 36), np.nan)
    for a in range(18):
        for b in range(36):
            if n1[a, b] + n2[a, b] >= 10:
                rr = sz.rate_ratio(n1[a, b], 21, n2[a, b], 21)
                lr[a, b] = np.log2((n2[a, b] + 0.5) / (n1[a, b] + 0.5)); p[a, b] = rr["p"]
    sig = tl.fdr_mask(p, q=0.10)
    ok = np.isfinite(lr)
    return dict(lr=lr, sig=sig, n_cells=int(ok.sum()), frac_sig_up=float(np.mean(sig[ok] & (lr[ok] > 0))),
                frac_sig_down=float(np.mean(sig[ok] & (lr[ok] < 0))), total_ratio=float(n2.sum() / max(n1.sum(), 1)))


Csmall = cell_change(U, 4.5, 5.5); Cbig = cell_change(U, 6.0, 10)
print(f"cells M4.5-5.4: {Csmall['n_cells']} cells, sig up {Csmall['frac_sig_up']:.0%} down {Csmall['frac_sig_down']:.0%}, total x{Csmall['total_ratio']:.2f}; "
      f"M>=6: {Cbig['n_cells']} cells, sig up {Cbig['frac_sig_up']:.0%} down {Cbig['frac_sig_down']:.0%}, total x{Cbig['total_ratio']:.2f}", flush=True)

# --- great-quake clustering: scan statistic with look-elsewhere Monte Carlo
rng = np.random.default_rng(40)


def scan(times_yr, T0, T1, wins=range(3, 16), nsim=20000):
    t = np.sort(np.asarray(times_yr)); n = len(t)

    def best(tt):
        bp = 1.0; bw = None; bk = 0
        for w in wins:
            k = max(np.searchsorted(tt, tt + w, "right") - np.arange(len(tt))) if len(tt) else 0
            # analytic-free score: binomial tail of k in a window of length w (approximate, used only for ranking)
            pp = stats.binom.sf(k - 1, len(tt), w / (T1 - T0))
            if pp < bp:
                bp, bw, bk = pp, w, k
        return bp, bw, bk
    p_obs, w_obs, k_obs = best(t)
    sims = np.array([best(np.sort(rng.uniform(T0, T1, n)))[0] for _ in range(nsim)])
    return dict(n=n, best_window_yr=w_obs, max_in_window=int(k_obs), p_naive=float(p_obs), p_mc=float(np.mean(sims <= p_obs + 1e-15)))


ty = U.year + (U.time.dt.day_of_year - 1) / 365.25
great = {}
for thr in (8.0, 8.5):
    sel = U.main & (U.mag >= thr)
    great[f"M≥{thr}"] = scan(ty[sel].values, 1973, 2026, nsim=4000 if thr == 8.0 else 20000)
    great[f"M≥{thr}"]["events"] = U[sel][["time", "mag", "place"]].astype(str).values.tolist()
    print(f"great M>={thr}: n={great[f'M≥{thr}']['n']}, max {great[f'M≥{thr}']['max_in_window']} in {great[f'M≥{thr}']['best_window_yr']} yr, "
          f"naive p={great[f'M≥{thr}']['p_naive']:.3g}, Monte-Carlo p={great[f'M≥{thr}']['p_mc']:.3g}", flush=True)
sel = G.main & (G.mag >= 8.5)
gty = G.time.dt.year + (G.time.dt.day_of_year - 1) / 365.25
great["GCMT Mw≥8.5"] = scan(gty[sel].values, 1976, 2026)
print("GCMT Mw>=8.5:", {k: v for k, v in great["GCMT Mw≥8.5"].items()}, flush=True)
# moment release per year (GCMT, all events)
G["m0"] = 10 ** (1.5 * (G.mag + 10.7333))
m0y = G.groupby("year").m0.sum().reindex(np.arange(1976, Y1 + 1), fill_value=0)
top_share = float(m0y.sort_values(ascending=False).iloc[:3].sum() / m0y.sum())

res = dict(n_usgs=len(U), mainshock_frac=float(U.main.mean()), trends=trends, sensitivity=sens, magnitude_type_step=step,
           mw_share_by_year={int(k): float(v) for k, v in mw_share.items() if np.isfinite(v)},
           b_values={k: {kk: vv for kk, vv in v.items() if kk != "mags"} for k, v in fmd.items()},
           ratio_n45_n6_kendall=dict(tau=float(ratio_tr.statistic), p=float(ratio_tr.pvalue)),
           ratio_n45_n6_first_last=[float(r456.dropna().iloc[0]), float(r456.dropna().iloc[-1])],
           cells_small=dict((k, v) for k, v in Csmall.items() if k not in ("lr", "sig")),
           cells_big=dict((k, v) for k, v in Cbig.items() if k not in ("lr", "sig")), great_quakes=great,
           moment_top3_years_share=top_share, moment_top3_years=[int(x) for x in m0y.sort_values(ascending=False).index[:3]])

# ------------------------------------------------------------------ figures
# 1. small multiples of annual counts (+ the magnitude-type switch that fakes a trend)
import textwrap
fig, axs = plt.subplots(2, 3, figsize=(13, 7.6), dpi=170)
fig.subplots_adjust(left=0.06, right=0.98, top=0.80, bottom=0.08, hspace=0.45, wspace=0.18)
for ax, k in zip(axs.ravel()[:5], series):
    s, y0 = series[k]; tr = trends[k]
    col = viz.ORANGE_ARM[2] if k.endswith("all events") else (viz.BLUE_ARM[2] if "USGS" in k else viz.GREEN_ARM[2])
    inwin = s.index >= y0
    ax.bar(s.index[inwin], s.values[inwin], width=0.8, color=col, alpha=0.85, linewidth=0)
    ax.bar(s.index[~inwin], s.values[~inwin], width=0.8, color=viz.AXIS, alpha=0.9, linewidth=0)
    x = s.index.values[inwin].astype(float)
    fit = tr["mean"] * np.exp(np.log(1 + tr["pct_per_decade"] / 100) / 10 * (x - x.mean()))
    sig = tr["p"] < 0.05 and tr["mk_p"] < 0.05
    ax.plot(x, fit, color=viz.INK, lw=1.6, ls="-" if sig else "--")
    per = f"{y0}–{Y1}"
    lab = (f"{tr['pct_per_decade']:+.0f}% per decade, {per} (p={tr['p']:.1g})" if sig
           else f"no significant trend, {per}\n({tr['pct_per_decade']:+.0f}%/dec, p={tr['p']:.2f})")
    ax.set_title(k, fontsize=10.5, loc="left", color=viz.INK, fontweight="bold")
    ax.text(0.02, 0.97, lab, transform=ax.transAxes, fontsize=8.5, va="top", color=viz.INK2,
            bbox=dict(facecolor=viz.SURFACE, edgecolor="none", alpha=0.85, pad=1.5))
    ax.set_ylim(0, s.max() * 1.32)
for ax in axs.ravel():
    for sp in ("top", "right", "left"):
        ax.spines[sp].set_visible(False)
    ax.grid(axis="y", color=viz.GRID, lw=0.6); ax.set_axisbelow(True); ax.tick_params(length=0, labelsize=8.5)
    ax.set_xlim(1972, 2026)
ax = axs[1, 2]
ax.step(mw_share.index, mw_share.values * 100, where="mid", color=viz.INK2, lw=1.8)
ax.set_ylim(0, 110)
ax.set_title("The trap: USGS switched magnitude scale", fontsize=10.5, loc="left", color=viz.INK, fontweight="bold")
ax.text(0.22, 0.62, f"% of M≥6 quakes reported as\nmoment magnitude (Mw).\nM≥6 count jumps {step['mean_before']:.0f} → {step['mean_after']:.0f}/yr\n"
        f"at the switch (Pettitt change\npoint after {step['pettitt_change_after_year']}, p={step['pettitt_p']:.0e}).",
        transform=ax.transAxes, fontsize=8.3, va="top", color=viz.INK2)
axs[0, 0].set_ylabel("earthquakes per year", color=viz.INK2); axs[1, 0].set_ylabel("earthquakes per year", color=viz.INK2)
fig.text(0.06, 0.965, "Is the Earth shaking more? Only the small quakes ‘increase’, because we listen better", fontsize=15, fontweight="bold", va="top")
sub = (f"Counts of M≥4.5 rise {trends['USGS M≥4.5, all events']['pct_per_decade']:+.0f}% per decade as seismic networks grow. Large earthquakes, which every network records, "
       f"show no trend once aftershocks are removed and only consistently measured moment magnitudes are compared (since {YMW}). "
       f"Starting in 1973 instead would show a false +{sens['M≥6 main, 1973–2025 (mixed magnitude types)']['pct_per_decade']:.0f}%/decade, "
       f"created by the switch from mb/Ms to Mw magnitudes in 1982–83. Grey bars: years excluded from the trend.")
fig.text(0.06, 0.918, "\n".join(textwrap.wrap(sub, 175)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/global_quake_counts.png"); plt.close(fig)

# 2. frequency-magnitude by decade, relative to 1985-94 (fan-out at small M = detection)
fig, ax = plt.subplots(figsize=(9.6, 6), dpi=170)
fig.subplots_adjust(left=0.10, right=0.97, top=0.79, bottom=0.11)
mg = np.round(np.arange(4.5, 6.51, 0.1), 2)   # above M6.5 the decade samples are too small (<100 events)
ref = fmd["1985–1994"]; Nref = np.array([np.sum(ref["mags"] >= x - 1e-9) for x in mg]) / ref["years"]
cols = [viz.ORANGE_ARM[2], viz.MUTED, viz.BLUE_ARM[3], viz.BLUE_ARM[2], viz.BLUE_ARM[0]]
for c, (k, v) in zip(cols, fmd.items()):
    N = np.array([np.sum(v["mags"] >= x - 1e-9) for x in mg]) / v["years"]
    ax.plot(mg, N / Nref, color=c, lw=2.4 if k != "1985–1994" else 1.4, ls="-" if k != "1985–1994" else "--")
    ax.text(mg[0] - 0.04, (N / Nref)[0], k, ha="right", va="center", fontsize=8.5, color=viz.INK2)
ax.axhline(1, color=viz.AXIS, lw=0.8)
ax.set_xlim(4.0, 6.55); ax.set_ylim(0.6, 1.6)
ax.set_xlabel("magnitude M", color=viz.INK2); ax.set_ylabel("quakes per year ≥ M, relative to 1985–94", color=viz.INK2)
for sp in ("top", "right"):
    ax.spines[sp].set_visible(False)
ax.grid(color=viz.GRID, lw=0.6); ax.tick_params(length=0)
ax.text(5.45, 1.3, "Above M≈5.5 the decades agree:\nthe real rate of quakes is steady", fontsize=9, color=viz.INK2)
ax.text(5.55, 0.64, "1973–84 sits low at every size:\nmagnitudes were then mb/Ms, not Mw", fontsize=8.5, color=viz.ORANGE_ARM[3])
fig.text(0.10, 0.965, "Same Earth, better ears", fontsize=15, fontweight="bold", va="top")
fig.text(0.10, 0.905, textwrap.fill("Number of mainshocks per year at or above each magnitude, divided by the 1985–94 rate. Recent decades record up to "
         f"{(np.sum(fmd['2015–2025']['mags'] >= 4.5) / 11) / Nref[0]:.1f}× more M4.5 quakes, but the excess shrinks to nothing by M5.5: "
         "the growing global seismic network catches small quakes it used to miss.", 120), fontsize=9.3, color=viz.INK2, va="top")
fig.text(0.97, 0.01, "Data: USGS ComCat, mainshocks after Gardner–Knopoff declustering.", fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/detection_fmd_by_decade.png"); plt.close(fig)

# 3. maps of rate change (10-deg cells)
fig = plt.figure(figsize=(13, 5.6), dpi=170)
cm = viz.div_cmap("redblue")
for k, (C, ttl) in enumerate(((Csmall, "Small quakes, M4.5–5.4"), (Cbig, "Large quakes, M≥6"))):
    ax = fig.add_axes([0.01 + k * 0.495, 0.14, 0.48, 0.66], projection=ccrs.Robinson(central_longitude=150))
    ax.set_global()
    ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", zorder=0)
    lon_e = np.arange(-180, 181, 10); lat_e = np.arange(-90, 91, 10)
    show = np.where(C["sig"], C["lr"], np.nan); faint = np.where(~C["sig"], C["lr"], np.nan)
    ax.pcolormesh(lon_e, lat_e, faint, cmap=cm, vmin=-2, vmax=2, alpha=0.30, transform=ccrs.PlateCarree(), zorder=1)
    pm = ax.pcolormesh(lon_e, lat_e, show, cmap=cm, vmin=-2, vmax=2, transform=ccrs.PlateCarree(), zorder=2)
    ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.4, edgecolor=viz.INK2, zorder=3)
    ax.set_title(f"{ttl}: significant rise in {C['frac_sig_up']:.0%} of cells, fall in {C['frac_sig_down']:.0%} (all cells ×{C['total_ratio']:.2f})",
                 fontsize=9.5, color=viz.INK, loc="left")
cax = fig.add_axes([0.30, 0.10, 0.40, 0.025])
cb = fig.colorbar(pm, cax=cax, orientation="horizontal", ticks=[-2, -1, 0, 1, 2])
cb.ax.set_xticklabels(["÷4", "÷2", "same", "×2", "×4"]); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=8.5, length=0)
cb.set_label("mainshock rate 2005–25 vs 1984–2004 (faded = not significant, FDR q=0.10)", fontsize=8.5, color=viz.INK2)
fig.text(0.02, 0.965, "Where the ‘increase’ lives: detection, not tectonics", fontsize=15, fontweight="bold", va="top")
fig.text(0.02, 0.905, "Change in the number of independent earthquakes per 10° cell. Small events rose where seismic networks grew; "
         "the large events every network records show no coherent change.", fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/map_quake_rate_change.png"); plt.close(fig)

# 4. hero map: where the big ones happen + great-quake timeline
big = U[U.main & (U.mag >= 6.0) & (U.year >= YMW)]
fig = plt.figure(figsize=(13, 8.2), dpi=180)
ax = fig.add_axes([0.02, 0.33, 0.96, 0.55], projection=ccrs.Robinson(central_longitude=150)); ax.set_global()
ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", zorder=0)
ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.4, edgecolor=viz.MUTED, zorder=1)
dcm = matplotlib.colors.ListedColormap([viz.RED_ARM[2], viz.ORANGE_ARM[2], viz.SERIES[3], viz.GREEN_ARM[2], viz.BLUE_ARM[2], viz.BLUE_ARM[0]])
dn = matplotlib.colors.BoundaryNorm([0, 35, 70, 150, 300, 500, 800], dcm.N)
bb = big.sort_values("mag")
sc = ax.scatter(bb.lon, bb.lat, s=(bb.mag - 5.5) ** 2.6 * 6, c=bb.depth, cmap=dcm, norm=dn, alpha=0.75, linewidths=0.3, edgecolors="white",
                transform=ccrs.PlateCarree(), zorder=2)
cax = fig.add_axes([0.70, 0.355, 0.22, 0.018])
cb = fig.colorbar(sc, cax=cax, orientation="horizontal"); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7.5, length=0)
cb.set_label("depth (km)", fontsize=8, color=viz.INK2)
ax2 = fig.add_axes([0.07, 0.07, 0.88, 0.2])
b7 = U[U.main & (U.mag >= 7.0)]
ax2.scatter(b7.time, b7.mag, s=(b7.mag - 6.5) ** 2.5 * 20, color=viz.BLUE_ARM[2], alpha=0.6, linewidths=0)
g85 = U[U.main & (U.mag >= 8.5)]
for _, r in g85.iterrows():
    ax2.annotate(f"{r.time.year} M{r.mag:.1f}", (r.time, r.mag), xytext=(0, 7), textcoords="offset points", fontsize=7.5, ha="center", color=viz.INK2)
ax2.axhline(8.5, color=viz.MUTED, lw=0.6, ls=":")
for sp in ("top", "right", "left"):
    ax2.spines[sp].set_visible(False)
ax2.set_ylabel("magnitude", color=viz.INK2); ax2.tick_params(length=0, labelsize=8.5); ax2.grid(axis="y", color=viz.GRID, lw=0.5)
ax2.set_ylim(6.9, 9.6)
gq = great["M≥8.5"]
ax2.set_title(f"Every M≥7 mainshock since 1973. The 2004–2012 burst of M≥8.5 ({gq['max_in_window']} of {gq['n']} in {gq['best_window_yr']} years) "
              f"appears in only {gq['p_mc']:.0%} of random 53-year catalogues\n(window length scanned), which is borderline because the M8.5 threshold "
              f"was picked after the burst was noticed.", fontsize=9, loc="left", color=viz.INK2)
fig.text(0.02, 0.97, f"Four decades of large earthquakes: {len(big):,} independent M≥6 events, {YMW}–2025", fontsize=15, fontweight="bold", va="top")
fig.text(0.02, 0.925, "\n".join(textwrap.wrap(f"Circle size = magnitude, colour = depth. The rate of these large quakes has not changed "
         f"({trends['USGS M≥6, mainshocks']['pct_per_decade']:+.0f}% per decade, p={trends['USGS M≥6, mainshocks']['p']:.2f}). "
         f"Three years (" + ", ".join(str(y) for y in res["moment_top3_years"]) + f") hold {top_share:.0%} of all seismic energy released since 1976.", 165)),
         fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/map_big_quakes_timeline.png"); plt.close(fig)

pd.DataFrame({k: v[0] for k, v in series.items()}).assign(usgs_m6_mw_share=mw_share).to_csv(f"{out}/annual_counts.csv")
tl.save_json(res, f"{out}/stats.json")
tl.runlog(TASK, "done", f"M>=4.5 all {trends['USGS M≥4.5, all events']['pct_per_decade']:+.0f}%/dec (detection); M>=6 mainshocks "
          f"{trends['USGS M≥6, mainshocks']['pct_per_decade']:+.0f}%/dec p={trends['USGS M≥6, mainshocks']['p']:.2f}; great-quake burst p={great['M≥8.5']['p_mc']:.2f}")
tl.fix_perms(out)
print("done")
