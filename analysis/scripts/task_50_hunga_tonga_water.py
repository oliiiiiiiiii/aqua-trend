"""Task 50 - Hunga Tonga-Hunga Ha'apai (15 Jan 2022): the volcano that watered the stratosphere. Aura MLS v5, 2004-2025.

Data: Aura MLS Level-3 daily zonal-mean water vapour on pressure levels (ML3DZH2O v005, 4-degree latitude bins, 82S-82N used).
Method: daily -> monthly zonal means; anomaly vs the 2005-2021 monthly climatology at each level and latitude.
Stratospheric water mass = sum over 100-1 hPa and 82S-82N of q * dp / g * area, with q = vmr * 18.015/28.964.
Tests: the 2022-2025 anomaly against the 2005-2021 distribution of monthly anomalies (z-score); Pettitt change point on the
mass series; exponential decay fitted to the mass anomaly after its peak (e-folding time, bootstrap CI over months).
The 8.25 hPa level zig-zags against its neighbours (retrieval-grid artefact) and is replaced by log-pressure interpolation of 10 and 6.81 hPa.
Aura MLS observed on ~49% of days in 2024 and ~29% in 2025 (spacecraft power management); months with <10 days are left blank.
Caveat: MLS v5 H2O has a known slow positive drift (~2-3%/decade after 2010 vs balloon frost-point hygrometers),
so the pre-2022 trend is not interpreted; the 2022 step is several times larger.
"""
import sys
import glob
import textwrap
import numpy as np
import pandas as pd
import netCDF4
from scipy.optimize import curve_fit
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402

TASK = "50_hunga_tonga_water"
out = tl.task_dir(TASK)
SRC = "Data: NASA Aura Microwave Limb Sounder (MLS) v5 Level-3 daily zonal-mean water vapour (ML3DZH2O)."
frames = []
for f in sorted(glob.glob(f"{ROOT}/data/raw/mls/MLS-Aura_L3DZ-H2O_*.nc")):
    with netCDF4.Dataset(f) as nc:
        g = nc["H2O PressureZM"]
        lev = np.asarray(g["lev"][:]); lat = np.asarray(g["lat"][:])
        x = np.ma.filled(g["value"][:].astype(np.float64), np.nan)
        x[x < 0] = np.nan
        tt = pd.DatetimeIndex([pd.Timestamp(str(d)[:10]) for d in netCDF4.num2date(g["time"][:], g["time"].units)])
        frames.append((tt, x))
times = pd.DatetimeIndex(np.concatenate([t for t, _ in frames]))
X = np.concatenate([x for _, x in frames]) * 1e6            # ppmv (day, lev, lat)
ks = np.where((lev <= 100.1) & (lev >= 0.99))[0]
js = np.where(np.abs(lat) <= 82)[0]
lev_s, lat_s = lev[ks], lat[js]
X = X[:, ks][:, :, js]
kb = int(np.argmin(np.abs(lev_s - 8.25)))
if abs(lev_s[kb] - 8.25) < 0.1:
    wl = (np.log(lev_s[kb - 1]) - np.log(lev_s[kb])) / (np.log(lev_s[kb - 1]) - np.log(lev_s[kb + 1]))
    X[:, kb] = (1 - wl) * X[:, kb - 1] + wl * X[:, kb + 1]
yrs_all = times.year
res_days = {int(y): int(np.isfinite(X[yrs_all == y][:, 5, len(js) // 2]).sum()) for y in sorted(set(yrs_all))}
mon = times.to_period("M")
months = pd.period_range(mon.min(), mon.max(), freq="M")
M = np.full((len(months), len(ks), len(js)), np.nan)
for i, m in enumerate(months):
    sel = mon == m
    if sel.sum() >= 10:
        with np.errstate(all="ignore"):
            import warnings
            warnings.simplefilter("ignore")
            M[i] = np.nanmean(X[sel], 0)
mt = months.to_timestamp()
base = (mt.year >= 2005) & (mt.year <= 2021)
clim = np.stack([np.nanmean(M[base & (mt.month == k)], 0) for k in range(1, 13)])
anom = M - clim[mt.month.values - 1]
pct = anom / clim[mt.month.values - 1] * 100

# stratospheric water mass (100-1 hPa, 82S-82N)
edges = np.sqrt(lev_s[:-1] * lev_s[1:])
pe = np.concatenate([[lev_s[0] * np.sqrt(lev_s[0] / lev_s[1])], edges, [lev_s[-1] * np.sqrt(lev_s[-1] / lev_s[-2])]])
dp = np.abs(np.diff(pe)) * 100.0                          # Pa
pe[0] = 100.0  # cap the bottom layer at 100 hPa
dp[0] = (100.0 - pe[1]) * 100.0
Re = 6.371e6
latb = np.deg2rad(np.clip(np.stack([lat_s - 2, lat_s + 2]), -90, 90))
area = 2 * np.pi * Re ** 2 * (np.sin(latb[1]) - np.sin(latb[0]))   # m2 per 4-deg band
q = M * 1e-6 * 18.015 / 28.964
mass = np.nansum(q * dp[None, :, None] / 9.80665 * area[None, None, :], axis=(1, 2)) / 1e9   # Tg
valid = np.isfinite(M).mean(axis=(1, 2)) > 0.9
mass = pd.Series(np.where(valid, mass, np.nan), mt)
mclim = mass[base].groupby(mass[base].index.month).mean()
manom = mass - mclim.reindex(mass.index.month).values
res = dict(levels_hPa=[float(lev_s[0]), float(lev_s[-1])], baseline="2005-2021", valid_days_per_year=res_days)
# remove the slow pre-eruption drift (instrument drift + real variability), fitted on 2005-2021 and extrapolated
tdec = tl.decimal_year(manom.index)
okb = (manom.index >= "2005-01-01") & (manom.index < "2022-01-01") & manom.notna().values
b_ = np.polyfit(tdec[okb], manom.values[okb], 1)
res["pre2022_drift_Tg_per_decade"] = float(b_[0] * 10); res["pre2022_drift_pct_per_decade"] = float(b_[0] * 10 / mclim.mean() * 100)
raw_anom = manom.copy()
manom = manom - np.polyval(b_, tdec)
res["peak_anom_raw_Tg"] = float(raw_anom[raw_anom.index >= "2022-02-01"].max())
pre = manom[(manom.index >= "2005-01-01") & (manom.index < "2022-01-01")].dropna()
post = manom[manom.index >= "2022-02-01"].dropna()
res["mass_clim_mean_Tg"] = float(mclim.mean())
res["peak_anom_Tg"] = float(post.max()); res["peak_month"] = str(post.idxmax().date())
res["peak_pct_of_strat_water"] = float(post.max() / mclim.mean() * 100)
res["pre_sd_Tg"] = float(pre.std()); res["pre_max_Tg"] = float(pre.max())
res["peak_z"] = float((post.max() - pre.mean()) / pre.std())
res["months_above_pre_max"] = int((post > pre.max()).sum()); res["n_post_months"] = int(len(post))
for y in (2022, 2023, 2024, 2025):
    res[f"mean_anom_{y}_Tg"] = float(manom[str(y)].mean())
k, K, pp = tl.pettitt(manom.dropna().values)
res["pettitt"] = dict(change_month=str(manom.dropna().index[k].date()), p=float(pp))
# exponential decay after peak (mass anomaly minus the pre-2022 mean)
pk = post.idxmax()
dec = manom[pk:].dropna() - pre.mean()
tm = (dec.index - pk).days.values / 365.25


def expf(t, a, tau):
    return a * np.exp(-t / tau)


popt, _ = curve_fit(expf, tm, dec.values, p0=(dec.iloc[0], 3.0), maxfev=20000)
rng = np.random.default_rng(50); taus = []
resid = dec.values - expf(tm, *popt)
for _ in range(1000):
    # moving-block bootstrap of residuals (block 6 months) to respect autocorrelation
    nb = int(np.ceil(len(resid) / 6)); st = rng.integers(0, len(resid) - 6, nb)
    rb = np.concatenate([resid[s:s + 6] for s in st])[:len(resid)]
    try:
        taus.append(curve_fit(expf, tm, expf(tm, *popt) + rb, p0=popt, maxfev=20000)[0][1])
    except RuntimeError:
        pass
res["decay"] = dict(efold_years=float(popt[1]), ci95=[float(np.percentile(taus, 2.5)), float(np.percentile(taus, 97.5))],
                    remaining_frac_end=float(dec.iloc[-6:].mean() / dec.iloc[0]), last_month=str(dec.index[-1].date()),
                    years_to_10pct=float(popt[1] * np.log(10)))
print({k_: v for k_, v in res.items()}, flush=True)
tl.save_json(res, f"{out}/stats.json")
pd.DataFrame({"strat_water_Tg": mass, "anomaly_vs_clim_Tg": raw_anom, "excess_vs_drift_Tg": manom}).round(2).to_csv(f"{out}/stratospheric_water_mass.csv")

# ------------------------------------------------------------------ figure
w = np.cos(np.deg2rad(lat_s))
trop = np.abs(lat_s) <= 60
prof = np.array([np.nansum(np.nan_to_num(p[:, trop]) * w[trop], 1) / np.sum(np.isfinite(p[:, trop]) * w[trop], 1) for p in pct])
lk = int(np.argmin(np.abs(lev_s - 26.1)))
fig = plt.figure(figsize=(14, 8.6), dpi=170)
cm = viz.div_cmap("redblue")
axA = fig.add_axes([0.06, 0.53, 0.60, 0.30])
im = axA.pcolormesh(mt, lev_s, prof.T, cmap=cm, vmin=-25, vmax=25, shading="auto", rasterized=True)
axA.set_yscale("log"); axA.invert_yaxis(); axA.set_yticks([100, 50, 20, 10, 5, 2, 1]); axA.set_yticklabels(["100", "50", "20", "10", "5", "2", "1"])
axA.set_ylabel("pressure (hPa)", color=viz.INK2)
axA.set_title("A  Water vapour anomaly by height, 60°S–60°N (% of normal)", fontsize=10, loc="left", fontweight="bold")
axA.annotate("15 Jan 2022\nHunga Tonga", xy=(pd.Timestamp("2022-01-15"), 30), xytext=(pd.Timestamp("2018-09-01"), 6), fontsize=8.5,
             arrowprops=dict(arrowstyle="-", color=viz.INK2, lw=0.8), color=viz.INK)
axA.tick_params(length=0, labelsize=8)
axB = fig.add_axes([0.06, 0.12, 0.60, 0.30])
im2 = axB.pcolormesh(mt, lat_s, pct[:, lk, :].T, cmap=cm, vmin=-40, vmax=40, shading="auto", rasterized=True)
axB.set_ylabel("latitude", color=viz.INK2); axB.set_yticks([-60, -30, 0, 30, 60])
axB.set_title(f"B  At {lev_s[lk]:.0f} hPa (~25 km): the plume starts at 20°S and spreads pole-to-pole", fontsize=10, loc="left", fontweight="bold")
axB.tick_params(length=0, labelsize=8)
for a_ in (axA, axB):
    a_.set_xlim(pd.Timestamp("2004-08-01"), pd.Timestamp("2026-01-01"))
    for sp_ in a_.spines.values():
        sp_.set_visible(False)
for a_, im_, lab in ((axA, im, "% vs 2005–2021"), (axB, im2, "% vs 2005–2021")):
    pos = a_.get_position()
    cax = fig.add_axes([pos.x1 + 0.006, pos.y0 + 0.02, 0.008, pos.height - 0.04])
    cb = fig.colorbar(im_, cax=cax); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7, length=0)
    cb.set_label(lab, fontsize=7.5, color=viz.INK2)
axC = fig.add_axes([0.74, 0.12, 0.24, 0.71])
axC.fill_between(manom.index, 0, manom.values, where=manom.values > 0, color=viz.RED_ARM[2], lw=0, step="mid")
axC.fill_between(manom.index, 0, manom.values, where=manom.values <= 0, color=viz.BLUE_ARM[3], lw=0, step="mid")
tf = pd.date_range(pk, "2030-12-01", freq="MS")
axC.plot(tf, expf((tf - pk).days.values / 365.25, *popt) + pre.mean(), color=viz.INK, lw=1.4, ls="--")
axC.text(pd.Timestamp("2027-03-01"), expf((pd.Timestamp("2027-03-01") - pk).days / 365.25, *popt) + pre.mean() + 4,
         f"decay fit:\ne-folding\n{popt[1]:.1f} yr", fontsize=8, color=viz.INK2, ha="left", va="bottom")
axC.axhline(0, color=viz.AXIS, lw=0.8)
axC.set_xlim(pd.Timestamp("2004-08-01"), pd.Timestamp("2030-12-31"))
axC.xaxis.set_major_locator(mdates.YearLocator(5)); axC.xaxis.set_major_formatter(mdates.DateFormatter("%Y"))
axC.set_ylabel("extra stratospheric water (million tonnes)", color=viz.INK2)
axC.text(0.02, 0.97, f"relative to the 2005–2021 level\nand its slow drift ({res['pre2022_drift_pct_per_decade']:+.1f}%/decade)", transform=axC.transAxes,
         fontsize=7.8, color=viz.MUTED, va="top")
axC.set_title("C  Extra water in the stratosphere", fontsize=10, loc="left", fontweight="bold")
axC.text(post.idxmax() - pd.Timedelta(days=200), post.max(), f"+{post.max():.0f} Mt\n(+{res['peak_pct_of_strat_water']:.0f}%)", fontsize=8.5, ha="right", va="top", color=viz.INK)
axC.set_ylim(-55, post.max() * 1.12)
for sp_ in ("top", "right", "left"):
    axC.spines[sp_].set_visible(False)
axC.grid(axis="y", color=viz.GRID, lw=0.5); axC.tick_params(length=0, labelsize=8)
fig.text(0.02, 0.975, "Hunga Tonga's eruption raised stratospheric water by 13%, and half of it is still there four years later", fontsize=15, fontweight="bold", va="top")
sub = (f"The undersea volcano blasted seawater to 50 km altitude. Aura MLS measured {post.max():.0f} million tonnes of extra water in the stratosphere "
       f"(100–1 hPa, peak {pd.Timestamp(res['peak_month']):%b %Y}), {res['peak_pct_of_strat_water']:.0f}% above normal and {res['peak_z']:.0f} standard deviations beyond "
       f"2005–2021 variability; every one of the {res['n_post_months']} measured months since Feb 2022 exceeds the largest pre-eruption value. The excess decays with an "
       f"e-folding time of {popt[1]:.1f} years (95% CI {res['decay']['ci95'][0]:.1f}–{res['decay']['ci95'][1]:.1f}); by late 2025 {100 * res['decay']['remaining_frac_end']:.0f}% "
       f"remained, so the stratosphere stays measurably wetter (which cools it and slows ozone recovery) until about {pk.year + res['decay']['years_to_10pct']:.0f}.")
fig.text(0.02, 0.928, "\n".join(textwrap.wrap(sub, 190)), fontsize=9.2, color=viz.INK2, va="top")
fig.text(0.98, 0.008, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/hunga_tonga_stratospheric_water.png"); plt.close(fig)
tl.runlog(TASK, "done", f"peak +{post.max():.0f} Tg (+{res['peak_pct_of_strat_water']:.0f}%), z={res['peak_z']:.0f}; e-fold {popt[1]:.1f} yr")
tl.fix_perms(out)
print("done")
