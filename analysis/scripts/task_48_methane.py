"""Task 48 - The methane surge of 2020-22 and the slowdown since: did tropical wetland water drive it?

Data
  NOAA GML global marine-surface CH4: annual increase (ch4_gr_gl.txt, 1984-2025) and monthly de-seasonalised trend (to mid-2026).
  AIRS v7 L3 (Aqua, IR-only) CH4 mixing ratio at 400 hPa, 60S-60N area mean (satellite cross-check; Aqua orbit drift after 2022).
  GRACE/GRACE-FO JPL mascons: annual-mean terrestrial water storage (TWS) anomaly, 2003-2025 (wetland water proxy).
  GPCP v2.3 annual precipitation (1984-2025), Nino3.4 index.
Hypothesis tested: wetter tropical wetlands (more stored water -> more inundation -> more microbial CH4) explain year-to-year CH4 growth.
Tests
  Pearson r between annual CH4 growth and annual TWS per 0.5 deg tropical land cell and for named wetland regions;
  significance by phase-randomised surrogates (Ebisuzaki 1997, 2000 draws), which keep each series' autocorrelation and slow trends,
  plus the same after removing a linear trend from both series and with first differences. FDR (q=0.10) over cells.
"""
import sys
import json
import textwrap
import numpy as np
import pandas as pd
from scipy import stats
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "48_methane"
out = tl.task_dir(TASK)
SRC = "Data: NOAA GML global CH₄; AIRS v7 CH₄ (400 hPa); GRACE/GRACE-FO JPL mascons; GPCP v2.3; NOAA Niño3.4."
rng = np.random.default_rng(48)
NSIM = 2000

# ------------------------------------------------------------------ methane series
gr = pd.read_csv(f"{ROOT}/data/raw/noaa_gml/ch4_gr_gl.txt", comment="#", sep=r"\s+", header=None,
                 names=["year", "g", "u"]).set_index("year")
mm = pd.read_csv(f"{ROOT}/data/raw/noaa_gml/ch4_mm_gl.txt", comment="#", sep=r"\s+", header=None,
                 names=["y", "m", "dy", "avg", "avgu", "trend", "tu"])
mm.index = pd.to_datetime(dict(year=mm.y, month=mm.m, day=1))
last12 = float(mm.trend.iloc[-1] - mm.trend.iloc[-13])
res = dict(noaa_growth=gr.g.loc[2000:].round(2).to_dict(), latest_12mo_growth=last12, latest_month=str(mm.index[-1].date()),
           ch4_latest_ppb=float(mm.trend.iloc[-1]))
rank = gr.g.rank(ascending=False)
res["rank_2021"] = int(rank.loc[2021]); res["rank_2020"] = int(rank.loc[2020])
res["lowest_since"] = int(gr.index[(gr.g <= gr.g.loc[2025]) & (gr.index < 2025)].max())

# AIRS 400 hPa global (60S-60N) annual means -> growth
d = f"{ROOT}/data/processed/airs_omi/airs_ch4"
ta = pd.DatetimeIndex(json.load(open(f"{d}/times.json")))
A = (np.load(f"{d}/CH4_VMR_A.npy", mmap_mode="r")[:, 2] + np.load(f"{d}/CH4_VMR_D.npy", mmap_mode="r")[:, 2]) / 2 * 1e9
lat1 = -89.5 + np.arange(180); w1 = np.cos(np.deg2rad(lat1))[:, None] * (np.abs(lat1) <= 60)[:, None] * np.ones((1, 360))
airs = pd.Series([np.nansum(np.nan_to_num(a) * w1 * np.isfinite(a)) / np.sum(w1 * np.isfinite(a)) for a in A], ta)
airs_ann = airs.groupby(airs.index.year).mean()
airs_ann = airs_ann[airs.groupby(airs.index.year).size() == 12]
airs_gr = airs_ann.diff().dropna()
j = airs_gr.index.intersection(gr.index)
j22 = j[j <= 2022]
res["airs_vs_noaa_growth_r_2004_2022"] = float(np.corrcoef(airs_gr[j22], gr.g[j22])[0, 1])
res["airs_vs_noaa_growth_r_all"] = float(np.corrcoef(airs_gr[j], gr.g[j])[0, 1])
res["airs_growth"] = airs_gr.round(2).to_dict()
res["airs_record_year"] = int(airs_gr.idxmax())
print("AIRS growth", airs_gr.round(1).to_dict(), flush=True)


def ebis(x, y, nsim=NSIM):
    """Two-sided p-value of corr(x, y) against phase-randomised surrogates of x (vectorised over columns of x)."""
    x = np.atleast_2d(np.asarray(x, float).T).T if np.ndim(x) == 1 else np.asarray(x, float)
    n = x.shape[0]
    y = (y - y.mean()) / y.std()
    xs = (x - x.mean(0)) / x.std(0)
    r0 = (xs * y[:, None]).mean(0)
    # A surrogate keeps |FFT| and randomises phases, so (Parseval) it has zero mean and the same variance as xs; its correlation
    # with y is therefore linear in (cos phi, sin phi) and the whole test reduces to one matrix product (no per-surrogate irfft).
    amp = np.abs(np.fft.rfft(xs, axis=0))                              # (K+1, cells)
    kk = np.arange(1, amp.shape[0])
    tt_ = np.arange(n)
    wk = np.where((n % 2 == 0) & (kk == n // 2), 1.0, 2.0) / n            # irfft weights (Nyquist once)
    Ak = (np.cos(2 * np.pi * kk[:, None] * tt_[None] / n) * y[None]).sum(1)
    Bk = (np.sin(2 * np.pi * kk[:, None] * tt_[None] / n) * y[None]).sum(1)
    ph = rng.uniform(0, 2 * np.pi, (nsim, len(kk)))
    if n % 2 == 0:
        ph[:, -1] = 0.0
    P = np.concatenate([np.cos(ph) * (wk * Ak)[None], -np.sin(ph) * (wk * Bk)[None]], axis=1)   # (nsim, 2K)
    Q = np.concatenate([amp[1:], amp[1:]], axis=0)                                            # (2K, cells)
    rs = (P @ Q) / n                                                    # corr of each surrogate with y
    cnt = (np.abs(rs) >= np.abs(r0)[None] - 1e-12).sum(0)
    return r0, (cnt + 1) / (nsim + 1)


def detrend(v, t):
    b = np.polyfit(t, v, 1)
    return v - np.polyval(b, t)


# ------------------------------------------------------------------ GRACE annual TWS
tws = hub.load("tws"); land = hub.land_mask()
LA, LO = np.meshgrid(hub.LAT, hub.LON, indexing="ij")
yy = pd.DatetimeIndex(tws.time.values).year
yrs = np.arange(2003, 2026)
with np.errstate(all="ignore"):
    import warnings
    warnings.simplefilter("ignore")
    TW = np.stack([np.nanmean(tws.values[yy == y], 0) for y in yrs])
g = gr.g.reindex(yrs).values
t = (yrs - yrs.mean()).astype(float)
trop = land & (np.abs(LA) <= 30) & np.isfinite(TW).all(0)
idx = np.where(trop.ravel())[0]
X = TW.reshape(len(yrs), -1)[:, idx].astype(float)
r_raw, p_raw = ebis(X, g)
Xd = X - (np.polyfit(t, X, 1)[0][None] * t[:, None] + np.polyfit(t, X, 1)[1][None])
r_det, p_det = ebis(Xd, detrend(g, t))
maps = {}
for k, (r, p) in {"raw": (r_raw, p_raw), "det": (r_det, p_det)}.items():
    R = np.full(LA.size, np.nan); P = np.full(LA.size, np.nan)
    R[idx] = r; P[idx] = p
    maps[k] = (R.reshape(LA.shape), P.reshape(LA.shape), tl.fdr_mask(P.reshape(LA.shape), 0.10))
w = np.cos(np.deg2rad(LA))
for k in maps:
    R, P, S = maps[k]
    res[f"map_{k}"] = dict(frac_r_gt_0p4=float(np.nansum((R > 0.4) * w * trop) / np.sum(w * trop)),
                           frac_r_lt_m0p4=float(np.nansum((R < -0.4) * w * trop) / np.sum(w * trop)),
                           frac_fdr_sig=float(np.nansum(np.nan_to_num(S) * w * trop) / np.sum(w * trop)),
                           frac_p05=float(np.nansum((P < 0.05) * w * trop) / np.sum(w * trop)))
print({k: res[f"map_{k}"] for k in maps}, flush=True)

BOX = {"Sudd": (29, 34, 5, 10), "East Africa (L. Victoria)": (29, 37, -4, 3), "Congo Cuvette": (15, 24, -4, 3),
       "Central Amazon": (-70, -55, -6, 0), "Niger inland delta": (-6, -2, 13, 17), "Tropical land 20°S–20°N": None}
reg = {}
for b, bb in BOX.items():
    m = land & ((np.abs(LA) <= 20) if bb is None else ((LO >= bb[0]) & (LO <= bb[1]) & (LA >= bb[2]) & (LA <= bb[3])))
    ww = w * m
    s = np.array([np.nansum(np.nan_to_num(a) * ww) / np.sum(ww * np.isfinite(a)) for a in TW])
    r0, p0 = ebis(s, g); rd, pd_ = ebis(detrend(s, t), detrend(g, t))
    r1, p1 = stats.pearsonr(np.diff(s), np.diff(g))
    reg[b] = dict(r=float(r0[0]), p_surrogate=float(p0[0]), p_naive=float(stats.pearsonr(s, g)[1]), r_detrended=float(rd[0]),
                  p_detrended=float(pd_[0]), r_first_diff=float(r1), p_first_diff=float(p1),
                  tws_2019_22=float(s[16:20].mean()), tws_2023_25=float(s[20:].mean()), series=dict(zip(yrs.tolist(), s.round(2).tolist())))
    print(b, {k: round(v, 3) for k, v in reg[b].items() if k != "series"}, flush=True)
res["regions"] = reg

# GPCP annual precipitation, tropical land, 1984-2025
p = hub.load("p_gpcp"); yp = pd.DatetimeIndex(p.time.values).year
yrs_p = np.arange(1984, 2026)
mtr = land & (np.abs(LA) <= 20); wp = w * mtr
ps = np.array([np.nansum(np.nan_to_num(np.nanmean(p.values[yp == y], 0)) * wp) / np.sum(wp) for y in yrs_p])
rp, pp = ebis(ps, gr.g.reindex(yrs_p).values)
res["gpcp_trop_land_vs_growth"] = dict(r=float(rp[0]), p_surrogate=float(pp[0]), n=len(yrs_p))
# Nino3.4 (Jul-Jun mean leading the calendar year) vs growth
n34 = hub.index("nino34")
n34y = pd.Series({y: n34[f"{y - 1}-07-01":f"{y}-06-01"].mean() for y in yrs_p})
rn, pn = ebis(n34y.values, gr.g.reindex(yrs_p).values)
n34c = pd.Series({y: n34[f"{y}-01-01":f"{y}-12-01"].mean() for y in yrs_p})
rn0, pn0 = ebis(n34c.values, gr.g.reindex(yrs_p).values)
res["nino34_vs_growth"] = dict(r_lead_jul_jun=float(rn[0]), p_lead=float(pn[0]), r_same_year=float(rn0[0]), p_same_year=float(pn0[0]))
print("GPCP", res["gpcp_trop_land_vs_growth"], "Nino", res["nino34_vs_growth"], flush=True)
tl.save_json(res, f"{out}/stats.json")
pd.DataFrame({"noaa_growth_ppb_yr": gr.g, "airs_400hPa_growth_ppb_yr": airs_gr}).to_csv(f"{out}/ch4_growth.csv")
pd.DataFrame({b: pd.Series(v["series"]) for b, v in reg.items()}).assign(noaa_growth=gr.g.reindex(yrs).values).to_csv(f"{out}/tws_regions_annual.csv")

# ------------------------------------------------------------------ figure
EA = reg["East Africa (L. Victoria)"]
fig = plt.figure(figsize=(14, 8.6), dpi=170)
# A: growth bars
ax = fig.add_axes([0.05, 0.53, 0.40, 0.29])
yrs_b = gr.index.values
cols = [viz.RED_ARM[2] if y in (2020, 2021, 2022) else (viz.BLUE_ARM[2] if y >= 2023 else "#b9b8b0") for y in yrs_b]
ax.bar(yrs_b, gr.g.values, color=cols, width=0.78)
ax.plot(airs_gr.index, airs_gr.values, "o", ms=4.2, mfc=viz.SURFACE, mec=viz.INK, mew=1.0, label="AIRS satellite, 400 hPa (Aqua orbit drifts after 2022)")
ax.axhline(0, color=viz.AXIS, lw=0.8)
ax.legend(frameon=False, fontsize=8, loc="upper left")
ax.set_ylabel("ppb per year", color=viz.INK2)
ax.set_title("A  Yearly rise of global methane (NOAA surface network)", fontsize=10, loc="left", fontweight="bold")
ax.text(2021, gr.g.loc[2021] + 0.7, f"2021: +{gr.g.loc[2021]:.1f}\nrecord", ha="center", fontsize=8, color=viz.INK)
ax.text(2025, -0.8, f"2025:\n+{gr.g.loc[2025]:.1f}", ha="center", va="top", fontsize=8, color=viz.INK)
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.set_axisbelow(True); ax.tick_params(length=0, labelsize=8)
ax.set_ylim(-9, 22)
# B: East Africa TWS (same x range as panel A, 2003+)
ax2 = fig.add_axes([0.05, 0.12, 0.40, 0.29])
s_ea = pd.Series(EA["series"]); s_tr = pd.Series(reg["Tropical land 20°S–20°N"]["series"])
s_ea.index = s_ea.index.astype(int); s_tr.index = s_tr.index.astype(int)
ax2.plot(s_ea.index, s_ea.values, color=viz.SERIES[0], lw=2.2, marker="o", ms=3.5)
ax2.plot(s_tr.index, s_tr.values, color=viz.SERIES[2], lw=2.0, marker="o", ms=3.5)
ax2.text(2012.5, 27, "East Africa (L. Victoria basin)", fontsize=8, color=viz.INK, ha="right")
ax2.text(2012.5, -9, "all tropical land 20°S–20°N", fontsize=8, color=viz.INK, ha="center", va="top")
ax2.axvspan(2019.5, 2022.5, color=viz.RED_ARM[0], alpha=0.5, lw=0); ax2.axvspan(2022.5, 2025.5, color=viz.BLUE_ARM[4], alpha=0.5, lw=0)
ax2.text(2021, -22, "surge", ha="center", fontsize=8, color=viz.INK2)
ax2.text(2024, -22, "slow-\ndown", ha="center", fontsize=8, color=viz.INK2)
ax2.axhline(0, color=viz.AXIS, lw=0.8)
ax2.set_xlim(1983, 2026); ax.set_xlim(1983, 2026)
ax2.set_ylabel("water storage anomaly (cm)", color=viz.INK2)
ax2.set_title("B  Wetland water (GRACE): the lake basin filled up and stayed full", fontsize=10, loc="left", fontweight="bold")
ax2.text(1984, 40, f"East Africa water vs methane rise, 2003–2025:\nraw r = {EA['r']:+.2f}  (naive p = {EA['p_naive']:.3f})\n"
         f"surrogate test p = {EA['p_surrogate']:.2f}\nafter removing trends r = {EA['r_detrended']:+.2f} (p = {EA['p_detrended']:.2f})",
         fontsize=8.2, color=viz.INK2, va="top")
for sp_ in ("top", "right", "left"):
    ax2.spines[sp_].set_visible(False)
ax2.grid(axis="y", color=viz.GRID, lw=0.5); ax2.set_axisbelow(True); ax2.tick_params(length=0, labelsize=8)
ax2.set_ylim(-25, 58)
# C/D: correlation maps raw vs detrended
cm = viz.div_cmap("redblue")
for k, (y0, ttl) in {"raw": (0.53, "C  Correlation, water storage vs methane rise (raw)"),
                     "det": (0.12, "D  Same, after removing each series' trend")}.items():
    axm = fig.add_axes([0.50, y0, 0.48, 0.29], projection=ccrs.PlateCarree())
    axm.set_extent([-95, 155, -32, 32], ccrs.PlateCarree())
    R, P, S = maps[k]
    im = axm.pcolormesh(hub.LON, hub.LAT, np.where(trop, R, np.nan), cmap=cm, vmin=-0.8, vmax=0.8, transform=ccrs.PlateCarree(), shading="auto",
                        rasterized=True)
    sig = np.where(trop & (P < 0.05), 1.0, np.nan)
    axm.contourf(hub.LON, hub.LAT, sig, levels=[0.5, 1.5], colors="none", hatches=["...."], transform=ccrs.PlateCarree())
    axm.add_feature(cfeature.COASTLINE.with_scale("110m"), lw=0.4, color=viz.INK2)
    rr = res[f"map_{k}"]
    axm.set_title(ttl, fontsize=10, loc="left", fontweight="bold")
    axm.text(0.01, 0.03, f"|r| > 0.4 on {100 * (rr['frac_r_gt_0p4'] + rr['frac_r_lt_m0p4']):.0f}% of tropical land; "
             f"surrogate p < 0.05 (dots) on {100 * rr['frac_p05']:.0f}%; FDR-significant {100 * rr['frac_fdr_sig']:.1f}%",
             transform=axm.transAxes, fontsize=7.8, color=viz.INK, bbox=dict(fc=viz.SURFACE, ec="none", alpha=0.85, pad=1.5))
cax = fig.add_axes([0.62, 0.065, 0.24, 0.014])
cb = fig.colorbar(im, cax=cax, orientation="horizontal"); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7.5, length=0)
cb.set_label("Pearson r (annual, 2003–2025)", fontsize=8, color=viz.INK2)
fig.text(0.02, 0.975, "Methane's record surge does not follow the tropics' water, once shared trends are removed", fontsize=15, fontweight="bold", va="top")
sub = (f"Global methane rose a record {gr.g.loc[2021]:.1f} ppb in 2021 ({gr.g.loc[2020]:.1f} in 2020, {gr.g.loc[2022]:.1f} in 2022), then slowed to "
       f"{gr.g.loc[2025]:.1f} ppb in 2025, the smallest rise since {res['lowest_since']}. A popular explanation is flooded tropical wetlands. "
       f"East Africa's stored water does correlate with the methane rise (r = {EA['r']:+.2f}), but both simply trend upward: tested against "
       f"surrogates with the same persistence, or after detrending, the link vanishes, and the basin stayed full ({EA['tws_2023_25']:+.0f} cm) "
       f"while methane slowed. Tropical rain (GPCP, r = {res['gpcp_trop_land_vs_growth']['r']:+.2f}) and El Niño (r = {res['nino34_vs_growth']['r_lead_jul_jun']:+.2f}) "
       f"show no link either. AIRS sees the same surge (its record year: {res['airs_record_year']}).")
fig.text(0.02, 0.928, "\n".join(textwrap.wrap(sub, 200)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.98, 0.008, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/methane_vs_wetland_water.png"); plt.close(fig)
tl.runlog(TASK, "done", f"CH4 growth 2021 {gr.g.loc[2021]:.1f} ppb record, 2025 {gr.g.loc[2025]:.1f}; E Africa TWS r={EA['r']:+.2f} (surrogate p={EA['p_surrogate']:.2f}, detrended r={EA['r_detrended']:+.2f})")
tl.fix_perms(out)
print("done")
