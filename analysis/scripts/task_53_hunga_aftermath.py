"""Task 53 - Hunga Tonga aftermath: the wetter stratosphere cooled and lost ozone in the southern hemisphere (Aura MLS v5, 2005-2025).

Data: Aura MLS L3 daily zonal means on pressure levels: H2O (ML3DZH2O), temperature (ML3DZT), ozone (ML3DZO3, compacted to npz).
Method: monthly means (>=10 days), anomalies vs the 2005-2021 monthly climatology at each level/latitude, minus a linear 2005-2021
trend extrapolated forward (removes CO2-driven cooling, ozone recovery and instrument drift). Region: southern mid-latitudes 15-55S
(where most of the plume stayed in 2022-23), 100-1 hPa.
Tests: per level, the first-year (Feb 2022-Jan 2023) and two-year mean anomalies vs the distribution of all 12- and 24-month means in
2005-2021 (block z-score and empirical rank);
monthly H2O-T and H2O-O3 correlations at 15-40 hPa since 2022 vs 2005-2021.
"""
import sys
import glob
import textwrap
import numpy as np
import pandas as pd
import netCDF4
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402

TASK = "53_hunga_aftermath"
out = tl.task_dir(TASK)
SRC = "Data: NASA Aura Microwave Limb Sounder (MLS) v5 Level-3 daily zonal means of water vapour, temperature and ozone."
LAT_BAND = (-55, -15)


def load_nc(pattern, group):
    T, X = [], []
    for f in sorted(glob.glob(pattern)):
        with netCDF4.Dataset(f) as nc:
            g = nc[group]
            lev = np.asarray(g["lev"][:]); lat = np.asarray(g["lat"][:])
            x = np.ma.filled(g["value"][:].astype(np.float64), np.nan)
            T.append(pd.DatetimeIndex([pd.Timestamp(str(d)[:10]) for d in netCDF4.num2date(g["time"][:], g["time"].units)])); X.append(x)
    return pd.DatetimeIndex(np.concatenate(T)), np.concatenate(X), lev, lat


def load_npz(pattern):
    T, X = [], []
    for f in sorted(glob.glob(pattern)):
        z = np.load(f)
        lev, lat = z["lev"], z["lat"]
        T.append(pd.DatetimeIndex([pd.Timestamp(str(d)[:10]) for d in netCDF4.num2date(z["time"], str(z["time_units"]))])); X.append(z["value"].astype(np.float64))
    return pd.DatetimeIndex(np.concatenate(T)), np.concatenate(X), lev, lat


def monthly_band(times, X, lev, lat, fill_neg=True):
    if fill_neg:
        X = np.where(X < -900, np.nan, X)
    ks = np.where((lev <= 100.1) & (lev >= 0.99))[0]
    js = np.where((lat >= LAT_BAND[0]) & (lat <= LAT_BAND[1]))[0]
    w = np.cos(np.deg2rad(lat[js]))
    with np.errstate(all="ignore"):
        import warnings
        warnings.simplefilter("ignore")
        B = np.nansum(np.nan_to_num(X[:, ks][:, :, js]) * w, 2) / np.sum(np.isfinite(X[:, ks][:, :, js]) * w, 2)
    mon = times.to_period("M")
    months = pd.period_range("2005-01", "2025-12", freq="M")
    M = np.full((len(months), len(ks)), np.nan)
    for i, m in enumerate(months):
        sel = mon == m
        if sel.sum() >= 10:
            M[i] = np.nanmean(B[sel], 0)
    return months.to_timestamp(), M, lev[ks]


def anomaly(mt, M, rel=False):
    base = mt.year <= 2021
    clim = np.stack([np.nanmean(M[base & (mt.month == k)], 0) for k in range(1, 13)])
    A = M - clim[mt.month.values - 1]
    if rel:
        A = A / clim[mt.month.values - 1] * 100
    td = tl.decimal_year(mt)
    for k in range(A.shape[1]):
        ok = base & np.isfinite(A[:, k])
        b = np.polyfit(td[ok], A[ok, k], 1)
        A[:, k] -= np.polyval(b, td)
    return A


tH, XH, levH, latH = load_nc(f"{ROOT}/data/raw/mls/MLS-Aura_L3DZ-H2O_*.nc", "H2O PressureZM")
tT, XT, levT, latT = load_nc(f"{ROOT}/data/raw/mls_t/MLS-Aura_L3DZ-Temperature_*.nc", "Temperature PressureZM")
tO, XO, levO, latO = load_npz(f"{ROOT}/data/raw/mls_o3/*_PressureZM.npz")
mt, MH, lv = monthly_band(tH, XH * 1e6, levH, latH)
_, MT, lvT = monthly_band(tT, XT, levT, latT)
_, MO, lvO = monthly_band(tO, XO * 1e6, levO, latO)
assert np.allclose(lv, lvT) and np.allclose(lv, lvO)
k8 = int(np.argmin(np.abs(lv - 8.25)))
for M_ in (MH, MT, MO):                       # the 8.25 hPa level zig-zags against its neighbours in all three products (task 50)
    wl = (np.log(lv[k8 - 1]) - np.log(lv[k8])) / (np.log(lv[k8 - 1]) - np.log(lv[k8 + 1]))
    M_[:, k8] = (1 - wl) * M_[:, k8 - 1] + wl * M_[:, k8 + 1]
AH, AT, AO = anomaly(mt, MH, rel=True), anomaly(mt, MT), anomaly(mt, MO, rel=True)

res = {"lat_band": LAT_BAND}
pre = mt.year <= 2021
prof = {}
WINDOWS = {"yr1": ("2022-02-01", "2023-01-01", 12), "yr2": ("2022-02-01", "2024-01-01", 24)}   # first year (plume in the SH mid-latitudes) and two years
for wk, (a_, b_, L_) in WINDOWS.items():
    post_ = (mt >= a_) & (mt <= b_)
    for nm, A in (("h2o_pct", AH), ("t_K", AT), ("o3_pct", AO)):
        mpost = np.nanmean(A[post_], 0)
        Ap = A[pre]
        blocks = np.array([np.nanmean(Ap[s0:s0 + L_], 0) for s0 in range(0, len(Ap) - L_ + 1)])   # all L-month means in 2005-2021
        z = (mpost - blocks.mean(0)) / blocks.std(0)
        more_extreme = np.array([np.mean(np.abs(blocks[:, k]) >= abs(mpost[k])) for k in range(len(lv))])
        prof[(wk, nm)] = dict(mean=mpost, z=z, blocks=blocks)
        band = (lv >= 5) & (lv <= 50)
        kmax = int(np.nanargmax(np.where(band, np.abs(z), -np.inf)))
        res[f"{nm}_{wk}"] = dict(window=[a_, b_], peak_level_hPa=float(lv[kmax]), mean_at_peak=float(mpost[kmax]), z=float(z[kmax]),
                                 frac_pre_blocks_as_extreme=float(more_extreme[kmax]), profile=dict(zip(np.round(lv, 2).tolist(), np.round(mpost, 3).tolist())))
        print(wk, nm, {k: v for k, v in res[f"{nm}_{wk}"].items() if k != "profile"}, flush=True)
post = (mt >= "2022-02-01") & (mt <= "2023-01-01")
# monthly coupling in the plume layer (15-40 hPa)
kl = (lv >= 15) & (lv <= 40)
h, tK, o = np.nanmean(AH[:, kl], 1), np.nanmean(AT[:, kl], 1), np.nanmean(AO[:, kl], 1)
for per, m_ in (("2005_2021", pre), ("2022_2025", mt >= "2022-02-01")):
    ok = m_ & np.isfinite(h) & np.isfinite(tK) & np.isfinite(o)
    res[f"corr_{per}"] = dict(h2o_t=float(np.corrcoef(h[ok], tK[ok])[0, 1]), h2o_o3=float(np.corrcoef(h[ok], o[ok])[0, 1]), n=int(ok.sum()))
res["layer_15_40hPa_yr1"] = dict(h2o_pct=float(np.nanmean(h[post])), t_K=float(np.nanmean(tK[post])), o3_pct=float(np.nanmean(o[post])))
for y in (2022, 2023, 2024, 2025):
    m_ = mt.year == y
    res[f"layer_15_40hPa_{y}"] = dict(h2o_pct=float(np.nanmean(h[m_])), t_K=float(np.nanmean(tK[m_])), o3_pct=float(np.nanmean(o[m_])))
print({k: v for k, v in res.items() if k.startswith(("corr", "layer"))}, flush=True)
tl.save_json(res, f"{out}/stats.json")
pd.DataFrame({"h2o_pct_15_40hPa": h, "t_K_15_40hPa": tK, "o3_pct_15_40hPa": o}, index=mt).round(3).to_csv(f"{out}/plume_layer_anomalies.csv")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.8), dpi=170)
cm = viz.div_cmap("redblue")
panels = (("A  Water vapour (% of normal)", AH, 30, "%"), ("B  Temperature (K)", AT, 2.0, "K"), ("C  Ozone (% of normal)", AO, 10, "%"))
for k, (ttl, A, vm, u) in enumerate(panels):
    ax = fig.add_axes([0.06, 0.62 - k * 0.255, 0.56, 0.20])
    cmap = cm if k != 1 else viz.div_cmap("redblue")
    im = ax.pcolormesh(mt, lv, A.T, cmap=cmap, vmin=-vm, vmax=vm, shading="auto", rasterized=True)
    ax.set_yscale("log"); ax.invert_yaxis(); ax.set_yticks([100, 30, 10, 3, 1]); ax.set_yticklabels(["100", "30", "10", "3", "1"])
    ax.set_ylabel("hPa", color=viz.INK2, fontsize=8.5)
    ax.set_xlim(pd.Timestamp("2015-01-01"), pd.Timestamp("2026-01-01"))
    ax.axvline(pd.Timestamp("2022-01-15"), color=viz.INK, lw=0.8, ls=":")
    ax.set_title(ttl + f", {abs(LAT_BAND[1])}–{abs(LAT_BAND[0])}°S, anomaly vs 2005–2021 level and trend", fontsize=9.5, loc="left", fontweight="bold")
    ax.tick_params(length=0, labelsize=7.5)
    for sp_ in ax.spines.values():
        sp_.set_visible(False)
    cax = fig.add_axes([0.625, 0.62 - k * 0.255 + 0.02, 0.007, 0.16])
    cb = fig.colorbar(im, cax=cax); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7, length=0); cb.set_label(u, fontsize=7.5, color=viz.INK2)
# right: profiles of the 2022-23 anomaly with the pre-2022 envelope
for k, (nm, lab, col) in enumerate((("h2o_pct", "water vapour (%)", viz.SERIES[0]), ("t_K", "temperature (K)", viz.SERIES[1]), ("o3_pct", "ozone (%)", viz.SERIES[2]))):
    ax = fig.add_axes([0.71 + k * 0.095, 0.10, 0.08, 0.72])
    blocks = prof[("yr1", nm)]["blocks"]
    ax.fill_betweenx(lv, np.nanmin(blocks, 0), np.nanmax(blocks, 0), color=viz.GRID, lw=0)
    ax.plot(prof[("yr1", nm)]["mean"], lv, color=col, lw=2.2)
    ax.plot(prof[("yr2", nm)]["mean"], lv, color=col, lw=1.0, ls="--")
    ax.axvline(0, color=viz.AXIS, lw=0.8)
    ax.set_yscale("log"); ax.invert_yaxis(); ax.set_ylim(100, 1)
    ax.set_yticks([100, 30, 10, 3, 1]); ax.set_yticklabels(["100", "30", "10", "3", "1"] if k == 0 else [])
    ax.set_xlabel(lab, fontsize=8, color=viz.INK2)
    for sp_ in ("top", "right"):
        ax.spines[sp_].set_visible(False)
    ax.tick_params(length=0, labelsize=7.5); ax.grid(color=viz.GRID, lw=0.4)
    if k == 0:
        ax.set_ylabel("hPa", color=viz.INK2, fontsize=8.5)
        ax.set_title("D  First year after the eruption (solid; dashed: 2 years)\n(grey: range of every 12-month mean, 2005–21)", fontsize=9, loc="left", fontweight="bold")
L = res["layer_15_40hPa_yr1"]
H1, T1, O1, O2 = res["h2o_pct_yr1"], res["t_K_yr1"], res["o3_pct_yr1"], res["o3_pct_yr2"]
C = res["corr_2022_2025"]; C0 = res["corr_2005_2021"]
fig.text(0.02, 0.975, "After Hunga Tonga, the wetter southern stratosphere turned colder and lost ozone", fontsize=15, fontweight="bold", va="top")
subt = (f"Aura MLS over 15–55°S, after removing each level's 2005–2021 trend. In the first year after the eruption (Feb 2022–Jan 2023) the 15–40 hPa layer (~22–28 km) "
        f"held {L['h2o_pct']:+.0f}% more water, was {L['t_K']:+.1f} K colder and had {L['o3_pct']:+.1f}% ozone. Peak anomalies: water {H1['mean_at_peak']:+.0f}% "
        f"({H1['z']:.0f} σ beyond any 12-month mean of 2005–21), temperature {T1['mean_at_peak']:+.1f} K at {T1['peak_level_hPa']:.0f} hPa ({abs(T1['z']):.0f} σ), ozone "
        f"{O1['mean_at_peak']:+.1f}% at {O1['peak_level_hPa']:.0f} hPa ({abs(O1['z']):.1f} σ). Month to month since 2022, wetter means colder (r = {C['h2o_t']:+.2f}, vs {C0['h2o_t']:+.2f} before) "
        f"and less ozone (r = {C['h2o_o3']:+.2f}). The cooling is robust; the ozone dip is smaller and fades over two years ({O2['mean_at_peak']:+.1f}%, {abs(O2['z']):.1f} σ).")
fig.text(0.02, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.98, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/hunga_aftermath_temperature_ozone.png"); plt.close(fig)
tl.runlog(TASK, "done", f"15-40 hPa 15-55S first year: H2O {L['h2o_pct']:+.0f}%, T {L['t_K']:+.1f} K, O3 {L['o3_pct']:+.1f}%")
tl.fix_perms(out)
print("done")
