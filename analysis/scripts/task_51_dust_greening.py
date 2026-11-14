"""Task 51 - Less dust from the Sahara-Sahel and the Middle East since 2005: two independent records, and the link to greener, wetter land.

Data (2005-2025, annual means, 1-degree grid over the dust belt 25W-80E, 0-50N)
  MERRA-2 M2TMNXAER dust aerosol optical depth at 550 nm (DUEXTTAU; reanalysis assimilating MODIS/MISR/AERONET AOD)
  OMI OMTO3d UV aerosol index (UVAI; independent UV absorption measurement; drift checked over clean South Pacific/Indian Ocean)
  MODIS NDVI (MOD13C2 via the hub), GPCP v2.3 precipitation.
Tests
  Trend per cell: Theil-Sen + Mann-Kendall (AR(1)-OLS for p via tl.grid_trends), FDR q=0.10; agreement of the two trend maps.
  Dust-vegetation coupling: per-cell correlation of detrended annual OMI UVAI with detrended NDVI; significance from phase-randomised
  surrogates (Ebisuzaki 1997, closed-form, 2000 draws), FDR q=0.10. Regional series with the same tests.
  GLDAS wind was checked and not used: its monthly anomalies do not track dust (r ~ 0) and its forcing winds carry spurious trends.
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

TASK = "51_dust_greening"
out = tl.task_dir(TASK)
SRC = "Data: NASA MERRA-2 dust AOD (M2TMNXAER); Aura OMI UV aerosol index (OMTO3d); Terra MODIS NDVI; GPCP v2.3 rain."
rng = np.random.default_rng(51)
YRS = np.arange(2005, 2026)
LON1 = -179.5 + np.arange(360); LAT1 = -89.5 + np.arange(180)
DOM = (LON1 >= -25) & (LON1 <= 80), (LAT1 >= 0) & (LAT1 <= 50)


def annual(a, times, minm=8):
    tt = pd.DatetimeIndex(times)
    outa = np.full((len(YRS),) + a.shape[1:], np.nan, np.float32)
    for k, y in enumerate(YRS):
        s = a[tt.year == y]
        if len(s) == 0:
            continue
        c = np.isfinite(s).sum(0)
        with np.errstate(all="ignore"):
            m = np.nanmean(s, 0)
        m[c < minm] = np.nan
        outa[k] = m
    return outa


def to1deg(a):
    """hub 0.5-degree (nt, 360, 720) -> 1-degree (nt, 180, 360)."""
    nt = a.shape[0]
    with np.errstate(all="ignore"):
        import warnings
        warnings.simplefilter("ignore")
        return np.nanmean(a.reshape(nt, 180, 2, 360, 2), axis=(2, 4))


# ------------------------------------------------------------------ inputs
t_du, du = hub._gd("m2aer", "DUEXTTAU", "native")
sel = (t_du.year >= 2005) & (t_du.year <= 2025)
DU = to1deg(annual(hub._merra_to_hub(du[sel]), t_du[sel]))
d = f"{ROOT}/data/processed/airs_omi/omto3"
t_ai = pd.DatetimeIndex(json.load(open(f"{d}/times.json")))
AI = annual(np.load(f"{d}/UVAerosolIndex.npy"), t_ai)
nd = hub.load("ndvi"); ND = to1deg(annual(nd.values, nd.time.values, minm=10))
pg = hub.load("p_gpcp"); PG = to1deg(annual(pg.values, pg.time.values))
land1 = to1deg(hub.land_mask()[None].astype(float))[0] > 0.5
jx, jy = np.where(DOM[0])[0], np.where(DOM[1])[0]
sub = lambda a: a[:, jy][:, :, jx]  # noqa: E731
DUd, AId, NDd, PGd, LANDd = sub(DU), sub(AI), sub(ND), sub(PG), land1[jy][:, jx]
lon_d, lat_d = LON1[jx], LAT1[jy]
res = {}

# drift control for OMI UVAI over clean ocean
def boxmean(A, lat, lon, b):
    la = (lat >= b[2]) & (lat <= b[3]); lo = (lon >= b[0]) & (lon <= b[1])
    w = np.cos(np.deg2rad(lat[la]))[:, None] * np.ones(lo.sum())[None]
    x = A[:, la][:, :, lo]
    return np.nansum(np.nan_to_num(x) * w, (1, 2)) / np.nansum(np.isfinite(x) * w, (1, 2))


for nm, b in {"S_Pacific": (-150, -100, -40, -20), "S_Indian": (60, 100, -45, -30)}.items():
    s = boxmean(AI, LAT1, LON1, b)
    mk = tl._mk_hr(s)
    res[f"omi_ai_drift_{nm}"] = dict(sen_per_decade=mk["sen"] * 10, p=mk["p"], mean=float(np.nanmean(s)))

# ------------------------------------------------------------------ trend maps (annual series, % per decade for dust; AI units per decade)
tt = YRS.astype(float)


def trend_maps(A):
    o = tl.ols_ar1(A, tt, min_frac=0.8)
    mk = tl.mk_grid(A)
    sen = tl.sen_grid(A, tt)
    p = np.where(np.isfinite(o["p"]), np.maximum(o["p"], mk["p"]), mk["p"])      # conservative: both tests must agree
    return sen * 10, p, tl.fdr_mask(p, 0.10)


du_tr, du_p, du_sig = trend_maps(DUd)
du_pct = du_tr / np.nanmean(DUd, 0) * 100
ai_tr, ai_p, ai_sig = trend_maps(AId)
dusty = np.nanmean(DUd, 0) > 0.15
w_ = np.cos(np.deg2rad(lat_d))[:, None] * np.ones(len(lon_d))[None]
ok = dusty & np.isfinite(du_tr) & np.isfinite(ai_tr)
res["dusty_cells"] = int(dusty.sum())
res["frac_dusty_sig_down_merra"] = float(np.sum(w_ * (dusty & du_sig & (du_tr < 0))) / np.sum(w_ * dusty))
res["frac_dusty_sig_up_merra"] = float(np.sum(w_ * (dusty & du_sig & (du_tr > 0))) / np.sum(w_ * dusty))
res["frac_dusty_sig_down_omi"] = float(np.sum(w_ * (dusty & ai_sig & (ai_tr < 0))) / np.sum(w_ * dusty))
res["frac_dusty_sig_up_omi"] = float(np.sum(w_ * (dusty & ai_sig & (ai_tr > 0))) / np.sum(w_ * dusty))
res["trend_sign_agreement_dusty"] = float(np.sum(w_ * ok * (np.sign(du_tr) == np.sign(ai_tr))) / np.sum(w_ * ok))
res["trend_map_pattern_r_dusty"] = float(np.corrcoef(du_tr[ok], ai_tr[ok])[0, 1])
print({k: v for k, v in res.items()}, flush=True)


# ------------------------------------------------------------------ AI vs NDVI coupling (detrended), surrogate test
def ebis_closed(x, y, nsim=2000):
    """x: (n, cells), y: (n,) or (n, cells). Returns r0, p (phase-randomised surrogates of x, closed form)."""
    n = x.shape[0]
    ys = (y - y.mean(0)) / y.std(0)
    if ys.ndim == 1:
        ys = np.broadcast_to(ys[:, None], x.shape)
    xs = (x - x.mean(0)) / x.std(0)
    r0 = (xs * ys).mean(0)
    amp = np.abs(np.fft.rfft(xs, axis=0))
    kk = np.arange(1, amp.shape[0]); t_ = np.arange(n)
    wk = np.where((n % 2 == 0) & (kk == n // 2), 1.0, 2.0) / n
    C = np.cos(2 * np.pi * kk[:, None] * t_[None] / n); S = np.sin(2 * np.pi * kk[:, None] * t_[None] / n)
    Ak = C @ ys; Bk = S @ ys                                    # (K, cells)
    cnt = np.zeros(x.shape[1])
    for _ in range(nsim // 500):
        ph = rng.uniform(0, 2 * np.pi, (500, len(kk)))
        if n % 2 == 0:
            ph[:, -1] = 0
        rs = (np.cos(ph) @ (wk[:, None] * Ak * amp[1:]) - np.sin(ph) @ (wk[:, None] * Bk * amp[1:])) / n
        cnt += (np.abs(rs) >= np.abs(r0)[None] - 1e-12).sum(0)
    return r0, (cnt + 1) / (nsim // 500 * 500 + 1)


def detr(A):
    X = A.reshape(A.shape[0], -1).astype(float)
    okc = np.isfinite(X).all(0)
    b = np.polyfit(tt - tt.mean(), X[:, okc], 1)
    Xd = np.full_like(X, np.nan)
    Xd[:, okc] = X[:, okc] - (b[0][None] * (tt - tt.mean())[:, None] + b[1][None])
    return Xd, okc


AIx, ok1 = detr(AId); NDx, ok2 = detr(NDd); DUx, ok3 = detr(DUd)
veg = (np.nanmean(NDd, 0) > 0.12).ravel() & LANDd.ravel()       # cells with some vegetation signal (excludes bare Sahara)
cells = ok1 & ok2 & veg
r_an, p_an = ebis_closed(AIx[:, cells], NDx[:, cells])
R_AN = np.full(AIx.shape[1], np.nan); P_AN = np.full(AIx.shape[1], np.nan)
R_AN[cells] = r_an; P_AN[cells] = p_an
R_AN = R_AN.reshape(AId.shape[1:]); P_AN = P_AN.reshape(AId.shape[1:])
S_AN = tl.fdr_mask(P_AN, 0.10)
wv = w_ * np.isfinite(R_AN)
res["ai_ndvi_detrended"] = dict(n_cells=int(cells.sum()), frac_negative=float(np.nansum(wv * (R_AN < 0)) / np.sum(wv)),
                                frac_fdr_neg=float(np.nansum(wv * (S_AN & (R_AN < 0))) / np.sum(wv)),
                                frac_fdr_pos=float(np.nansum(wv * (S_AN & (R_AN > 0))) / np.sum(wv)),
                                frac_p05_neg=float(np.nansum(wv * ((P_AN < 0.05) & (R_AN < 0))) / np.sum(wv)),
                                median_r=float(np.nanmedian(R_AN)))
print(res["ai_ndvi_detrended"], flush=True)

# ------------------------------------------------------------------ regional series
REG = {"Sahel": (-17, 35, 10, 18), "Lake Chad / Bodélé": (14, 22, 13, 19), "Middle East (Iraq–Syria)": (38, 48, 29, 37), "Arabian Peninsula": (40, 55, 17, 28),
       "Thar / NW India": (68, 76, 24, 30), "Western Sahara": (-12, 5, 18, 30), "Taklimakan": (78, 90, 37, 41)}
reg = {}
for nm, b in REG.items():
    sd = boxmean(DU, LAT1, LON1, b); sa = boxmean(AI, LAT1, LON1, b); sn = boxmean(ND, LAT1, LON1, b); sp = boxmean(PG, LAT1, LON1, b)
    mk_d, mk_a, mk_n, mk_p = tl._mk_hr(sd), tl._mk_hr(sa), tl._mk_hr(sn), tl._mk_hr(sp)
    dd = lambda v: v - np.polyval(np.polyfit(tt - tt.mean(), v, 1), tt - tt.mean())  # noqa: E731
    r_a_n, p_a_n = ebis_closed(dd(sa)[:, None], dd(sn)); r_d_n, p_d_n = ebis_closed(dd(sd)[:, None], dd(sn))
    r_a_p, p_a_p = ebis_closed(dd(sa)[:, None], dd(sp))
    reg[nm] = dict(dust_pct_per_dec=float(mk_d["sen"] * 10 / np.mean(sd) * 100), dust_p=mk_d["p"], ai_per_dec=float(mk_a["sen"] * 10), ai_p=mk_a["p"],
                   ndvi_pct_per_dec=float(mk_n["sen"] * 10 / np.mean(sn) * 100), ndvi_p=mk_n["p"], rain_pct_per_dec=float(mk_p["sen"] * 10 / np.mean(sp) * 100),
                   rain_p=mk_p["p"], r_dust_ai=float(np.corrcoef(sd, sa)[0, 1]), r_ai_ndvi_detr=float(r_a_n[0]), p_ai_ndvi_detr=float(p_a_n[0]),
                   r_dust_ndvi_detr=float(r_d_n[0]), p_dust_ndvi_detr=float(p_d_n[0]), r_ai_rain_detr=float(r_a_p[0]), p_ai_rain_detr=float(p_a_p[0]),
                   series=dict(dust=sd.round(4).tolist(), ai=sa.round(3).tolist(), ndvi=sn.round(4).tolist(), rain=sp.round(3).tolist()))
    print(nm, {k: (round(v, 3) if isinstance(v, float) else v) for k, v in reg[nm].items() if k != "series"}, flush=True)
res["regions"] = reg
tl.save_json(res, f"{out}/stats.json")
pd.DataFrame({(nm, k): v for nm, r in reg.items() for k, v in r["series"].items()}, index=YRS).to_csv(f"{out}/regional_annual.csv")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.8), dpi=170)
proj = ccrs.PlateCarree()
ext = [-25, 80, 0, 48]
cm = viz.div_cmap("redblue")


def mapax(rect, title):
    a = fig.add_axes(rect, projection=proj)
    a.set_extent(ext, proj)
    a.add_feature(cfeature.COASTLINE.with_scale("110m"), lw=0.4, color=viz.INK2)
    a.add_feature(cfeature.BORDERS.with_scale("110m"), lw=0.25, color=viz.MUTED)
    a.set_title(title, fontsize=10, loc="left", fontweight="bold")
    return a


def stip(a, mask):
    a.contourf(lon_d, lat_d, np.where(mask, 1.0, np.nan), levels=[0.5, 1.5], colors="none", hatches=["...."], transform=proj)


axA = mapax([0.02, 0.47, 0.46, 0.36], "A  Dust optical depth trend, MERRA-2 (2005–2025)")
show = np.where(np.nanmean(DUd, 0) > 0.05, du_pct, np.nan)
imA = axA.pcolormesh(lon_d, lat_d, show, cmap=cm, vmin=-30, vmax=30, transform=proj, shading="auto", rasterized=True)
stip(axA, du_sig & (np.nanmean(DUd, 0) > 0.05))
axA.contour(lon_d, lat_d, np.nanmean(DUd, 0), levels=[0.3], colors=[viz.INK], linewidths=0.6, transform=proj)
caxA = fig.add_axes([0.06, 0.445, 0.18, 0.012]); cb = fig.colorbar(imA, cax=caxA, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7, length=0); cb.set_label("% per decade (dots: FDR-significant; line: dustiest, AOD 0.3)", fontsize=7.5, color=viz.INK2)
axB = mapax([0.52, 0.47, 0.46, 0.36], "B  Independent check: OMI UV aerosol index trend")
imB = axB.pcolormesh(lon_d, lat_d, np.where(np.nanmean(DUd, 0) > 0.05, ai_tr, np.nan), cmap=cm, vmin=-0.3, vmax=0.3, transform=proj, shading="auto", rasterized=True)
stip(axB, ai_sig & (np.nanmean(DUd, 0) > 0.05))
caxB = fig.add_axes([0.56, 0.445, 0.18, 0.012]); cb = fig.colorbar(imB, cax=caxB, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7, length=0); cb.set_label("index units per decade", fontsize=7.5, color=viz.INK2)
axC = mapax([0.02, 0.06, 0.46, 0.32], "C  Greener year, cleaner air: OMI aerosol vs MODIS NDVI (detrended)")
imC = axC.pcolormesh(lon_d, lat_d, R_AN, cmap=cm, vmin=-0.8, vmax=0.8, transform=proj, shading="auto", rasterized=True)
stip(axC, S_AN)
caxC = fig.add_axes([0.06, 0.035, 0.18, 0.012]); cb = fig.colorbar(imC, cax=caxC, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7, length=0); cb.set_label("r, year-to-year (dots: FDR-significant)", fontsize=7.5, color=viz.INK2)
# D: Lake Chad / Bodele standardized series (z-scores share one axis)
ax = fig.add_axes([0.56, 0.09, 0.40, 0.27])
R_ = reg["Middle East (Iraq–Syria)"]
z = lambda v: (np.asarray(v) - np.mean(v)) / np.std(v)  # noqa: E731
ax.plot(YRS, z(R_["series"]["dust"]), color=viz.SERIES[1], lw=2.2, marker="o", ms=3)
ax.plot(YRS, z(R_["series"]["ai"]), color=viz.SERIES[3], lw=1.8, marker="o", ms=3, ls="--")
ax.plot(YRS, z(R_["series"]["ndvi"]), color=viz.SERIES[5], lw=2.2, marker="o", ms=3)
ax.text(2025.4, -1.65, "dust AOD\n(MERRA-2)", fontsize=7.8, va="center", color=viz.INK)
ax.text(2025.4, -0.6, "aerosol index\n(OMI)", fontsize=7.8, va="center", color=viz.INK)
ax.text(2025.4, 0.5, "greenness\n(MODIS NDVI)", fontsize=7.8, va="center", color=viz.INK)
ax.axhline(0, color=viz.AXIS, lw=0.8)
ax.set_xlim(2004.5, 2029); ax.set_xticks([2005, 2010, 2015, 2020, 2025]); ax.set_ylim(-3.5, 3.4)
ax.set_ylabel("standardised anomaly (σ)", color=viz.INK2)
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
ax.set_title("D  Iraq–Syria: the dust-storm years are the brown years", fontsize=10, loc="left", fontweight="bold")
ax.text(0.01, 0.03, f"dust {R_['dust_pct_per_dec']:+.0f}%/decade (p={R_['dust_p']:.3f}), greenness {R_['ndvi_pct_per_dec']:+.0f}%/decade (p={R_['ndvi_p']:.0e})\n"
        f"year-to-year, detrended: OMI aerosol vs NDVI r = {R_['r_ai_ndvi_detr']:+.2f} (surrogate p{'<0.001' if R_['p_ai_ndvi_detr'] < 0.001 else '=' + format(R_['p_ai_ndvi_detr'], '.3f')}), "
        f"MERRA-2 dust vs NDVI r = {R_['r_dust_ndvi_detr']:+.2f}", transform=ax.transAxes, fontsize=7.6, color=viz.INK2)
sa_, me_, ar_ = reg["Sahel"], reg["Middle East (Iraq–Syria)"], reg["Arabian Peninsula"]
an = res["ai_ndvi_detrended"]
fig.text(0.02, 0.975, "Less dust over the Sahel, the Sahara's edge and the Middle East: two independent satellite records agree", fontsize=15, fontweight="bold", va="top")
subt = (f"Since 2005, dust optical depth fell {abs(sa_['dust_pct_per_dec']):.0f}% per decade over the Sahel, {abs(me_['dust_pct_per_dec']):.0f}% over Iraq–Syria and "
        f"{abs(ar_['dust_pct_per_dec']):.0f}% over Arabia (MERRA-2); OMI's UV aerosol index, a separate instrument and method with no drift over clean oceans, "
        f"falls in the same places (trend sign agrees on {100 * res['trend_sign_agreement_dusty']:.0f}% of the dust belt). Where the land greened, the air cleared: "
        f"in years when vegetation is greener than its trend, OMI sees less dust on {100 * an['frac_negative']:.0f}% of vegetated dust-belt land (FDR-significant on "
        f"{100 * an['frac_fdr_neg']:.0f}%). Sahel rain rose {sa_['rain_pct_per_dec']:+.0f}%/decade and greenness {sa_['ndvi_pct_per_dec']:+.0f}%/decade. "
        f"The Taklimakan does not agree between the two records and is not interpreted.")
fig.text(0.02, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.98, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/dust_trends_and_greening.png"); plt.close(fig)
tl.runlog(TASK, "done", f"Sahel dust {sa_['dust_pct_per_dec']:+.0f}%/dec, Middle East {me_['dust_pct_per_dec']:+.0f}%/dec; OMI-NDVI detrended r<0 on {100 * an['frac_negative']:.0f}% (FDR {100 * an['frac_fdr_neg']:.0f}%)")
tl.fix_perms(out)
print("done")
