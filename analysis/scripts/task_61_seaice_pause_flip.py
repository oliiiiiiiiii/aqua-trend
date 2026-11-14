"""Task 61 - Sea ice, two statistical lessons: the Arctic 'pause' is what noise looks like; the Antarctic flip came with a warmer Southern Ocean.

Data: NSIDC Sea Ice Index v4 monthly extent (1979-2026); NOAA OISST v2.1 monthly SST (1982-2026).
Arctic (September minimum, 1979-2025):
  - single line vs best two-segment (continuous hinge searched 2000-2016) F-test;
  - slope since 2012 with its 95% CI;
  - Monte Carlo (20,000 runs): the long-term linear trend + AR(1) noise with the observed residual sd and lag-1 autocorrelation;
    how often does a 'pause' at least as flat as the observed post-2012 slope appear (a) in the last 14 years and (b) anywhere in the record?
Antarctic:
  - Southern Ocean SST anomaly 50-60S (open water, avoids the sea-ice SST mask) vs Antarctic extent anomaly: lagged correlation,
    Pettitt change points of both, and the 2016-2025 vs 1982-2015 difference; SST change map around Antarctica.
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
import matplotlib.path as mpath
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "61_seaice_pause_flip"
out = tl.task_dir(TASK)
SRC = "Data: NSIDC Sea Ice Index v4 (passive microwave); NOAA OISST v2.1."
rng = np.random.default_rng(61)
frames = []
for f in sorted(glob.glob(f"{ROOT}/data/raw/nsidc/*_extent_v4.0.csv")):
    d = pd.read_csv(f, skipinitialspace=True); d.columns = [c.strip() for c in d.columns]; frames.append(d)
df = pd.concat(frames); df = df[(df.extent > 0) & (df.year >= 1979)]
df["date"] = pd.to_datetime(dict(year=df.year, month=df.mo, day=1))
ser = {}
for H in ("N", "S"):
    s = df[df.region.str.strip() == H].set_index("date").extent.sort_index(); s = s[~s.index.duplicated()]
    ser[H] = s.reindex(pd.date_range("1979-01-01", s.index.max(), freq="MS"))
res = {}
# ---------------------------------------------------------------- Arctic September
sep = ser["N"][ser["N"].index.month == 9]; sep.index = sep.index.year; sep = sep.loc[1979:2025].dropna()
x = sep.index.values.astype(float); y = sep.values
b1 = np.polyfit(x, y, 1); r1 = y - np.polyval(b1, x); rss1 = r1 @ r1
best = None
for h in range(2000, 2017):
    X = np.column_stack([np.ones_like(x), x - h, np.maximum(x - h, 0)])
    b, *_ = np.linalg.lstsq(X, y, rcond=None); rr = y - X @ b
    if best is None or rr @ rr < best[1]:
        best = (h, rr @ rr, b)
h, rss2, b2 = best
n = len(y); F = ((rss1 - rss2) / 1) / (rss2 / (n - 3)); pF = float(stats.f.sf(F, 1, n - 3))
post = sep.loc[2012:]
bp = stats.linregress(post.index.values.astype(float), post.values)
phi = float(np.corrcoef(r1[1:], r1[:-1])[0, 1]); sd = float(np.std(r1, ddof=2))
res["arctic_sept"] = dict(trend_per_decade=float(b1[0] * 10), resid_sd=sd, resid_phi=phi, hinge_year=int(h), hinge_slope_before=float(b2[1] * 10),
                         hinge_slope_after=float((b2[1] + b2[2]) * 10), F=float(F), p_hinge_vs_line=pF,
                         slope_since_2012_per_decade=float(bp.slope * 10), ci95_since_2012=[float((bp.slope - 1.96 * bp.stderr) * 10), float((bp.slope + 1.96 * bp.stderr) * 10)],
                         p_since_2012=float(bp.pvalue), n_since_2012=int(len(post)))
# Monte Carlo
NS = 20000; L = len(post)
innov_sd = sd * np.sqrt(max(1 - max(phi, 0) ** 2, 1e-6))
e = np.zeros((NS, n)); e[:, 0] = rng.normal(0, sd, NS)
w = rng.normal(0, innov_sd, (NS, n))
for t in range(1, n):
    e[:, t] = max(phi, 0) * e[:, t - 1] + w[:, t]
Ysim = np.polyval(b1, x)[None] + e
tt = np.arange(L) - (L - 1) / 2
slope_last = (Ysim[:, -L:] * tt).sum(1) / (tt ** 2).sum()
obs = bp.slope
res["arctic_sept"]["mc_prob_last_window_as_flat"] = float(np.mean(slope_last >= obs))
anyw = np.zeros(NS, bool)
for s0 in range(0, n - L + 1):
    sl = (Ysim[:, s0:s0 + L] * tt).sum(1) / (tt ** 2).sum()
    anyw |= sl >= obs
res["arctic_sept"]["mc_prob_any_window_as_flat"] = float(anyw.mean())
print(res["arctic_sept"], flush=True)
# ---------------------------------------------------------------- Antarctic + Southern Ocean SST
S = ser["S"]; clim = S["1981":"2010"].groupby(S["1981":"2010"].index.month).mean()
Sa = (S - clim.reindex(S.index.month).values).dropna()
sst = hub.load("sst")
LA, LO = np.meshgrid(hub.LAT, hub.LON, indexing="ij")
band = (LA >= -60) & (LA <= -50)
w_ = np.cos(np.deg2rad(LA)) * band
so = pd.Series([np.nansum(np.nan_to_num(v) * w_) / np.sum(w_ * np.isfinite(v)) for v in sst.values], pd.DatetimeIndex(sst.time.values))
soa = so - so["1982":"2010"].groupby(so["1982":"2010"].index.month).mean().reindex(so.index.month).values
j = Sa.index.intersection(soa.index)
lags = {}
for lag in range(0, 13, 3):
    a_ = soa.shift(lag).reindex(j); ok = a_.notna()
    lags[lag] = float(np.corrcoef(a_[ok], Sa[j][ok])[0, 1])
k1, _, p1 = tl.pettitt(Sa.values); k2, _, p2 = tl.pettitt(soa.dropna().values)
sm12 = lambda s_: s_.rolling(12, center=True, min_periods=9).mean()  # noqa: E731
ja = sm12(Sa).reindex(j); jb = sm12(soa).reindex(j); okk = ja.notna() & jb.notna()
res["antarctic"] = dict(ice_pettitt=str(Sa.index[k1].date()), ice_pettitt_p=float(p1), sst_pettitt=str(soa.dropna().index[k2].date()), sst_pettitt_p=float(p2),
                        ice_anom_1982_2015=float(Sa["1982":"2015"].mean()), ice_anom_2016_2025=float(Sa["2016":"2025"].mean()),
                        sst_anom_1982_2015=float(soa["1982":"2015"].mean()), sst_anom_2016_2025=float(soa["2016":"2025"].mean()),
                        corr_monthly_by_sst_lead_months=lags, corr_12mo_smoothed=float(np.corrcoef(ja[okk], jb[okk])[0, 1]),
                        record_low_month=str(Sa.idxmin().date()), record_low_anom=float(Sa.min()))
# effective-n significance for the smoothed correlation (Bretherton), phi from the smoothed series
pa = float(np.corrcoef(ja[okk].values[1:], ja[okk].values[:-1])[0, 1]); pb = float(np.corrcoef(jb[okk].values[1:], jb[okk].values[:-1])[0, 1])
neff = okk.sum() * (1 - pa * pb) / (1 + pa * pb)
rr_ = res["antarctic"]["corr_12mo_smoothed"]
res["antarctic"]["smoothed_corr_neff"] = float(neff)
res["antarctic"]["smoothed_corr_p"] = float(2 * stats.t.sf(abs(rr_) * np.sqrt((neff - 2) / (1 - rr_ ** 2)), max(neff - 2, 1)))
print(res["antarctic"], flush=True)
# annual means: raw, detrended, first differences, and a phase-randomised surrogate test (keeps each series' persistence)
Aann = Sa.groupby(Sa.index.year).mean().loc[1982:2025]; Bann = soa.groupby(soa.index.year).mean().loc[1982:2025]
ty = Aann.index.values - Aann.index.values.mean()
dtr = lambda v: v - np.polyval(np.polyfit(ty, v, 1), ty)  # noqa: E731


def surr_p(x_, y_, nsim=5000):
    x_ = (x_ - x_.mean()) / x_.std(); y_ = (y_ - y_.mean()) / y_.std(); n_ = len(x_)
    r0 = float(np.mean(x_ * y_)); amp = np.abs(np.fft.rfft(x_))
    ph = rng.uniform(0, 2 * np.pi, (nsim, len(amp))); ph[:, 0] = 0
    if n_ % 2 == 0:
        ph[:, -1] = 0
    sim = np.fft.irfft(amp[None] * np.exp(1j * ph), n_, axis=1)
    sim = (sim - sim.mean(1, keepdims=True)) / sim.std(1, keepdims=True)
    return r0, float((np.sum(np.abs((sim * y_[None]).mean(1)) >= abs(r0)) + 1) / (nsim + 1))


r_raw, p_raw_s = surr_p(Aann.values, Bann.values)
r_det, p_det_s = surr_p(dtr(Aann.values), dtr(Bann.values))
r_fd, p_fd = stats.pearsonr(np.diff(Aann.values), np.diff(Bann.values))
res["antarctic"]["annual"] = dict(r=r_raw, p_surrogate=p_raw_s, r_detrended=r_det, p_detrended_surrogate=p_det_s, r_first_diff=float(r_fd), p_first_diff=float(p_fd), n=int(len(Aann)))
print(res["antarctic"]["annual"], flush=True)
tl.save_json(res, f"{out}/stats.json")
tt_ = pd.DatetimeIndex(sst.time.values)
with np.errstate(all="ignore"):
    import warnings
    warnings.simplefilter("ignore")
    dsst = np.nanmean(sst.values[(tt_.year >= 2016) & (tt_.year <= 2025)], 0) - np.nanmean(sst.values[(tt_.year >= 1982) & (tt_.year <= 2015)], 0)
tl.save_json(res, f"{out}/stats.json")

# ---------------------------------------------------------------- figure
fig = plt.figure(figsize=(14, 8.6), dpi=170)
A = res["arctic_sept"]
ax = fig.add_axes([0.05, 0.50, 0.42, 0.28])
ax.plot(sep.index, sep.values, "o-", color=viz.SERIES[0], ms=3.5, lw=1.2)
ax.plot(x, np.polyval(b1, x), color=viz.INK, lw=1.2, label=f"one line: {A['trend_per_decade']:+.2f} M km²/decade")
xp = post.index.values.astype(float)
ax.plot(xp, bp.intercept + bp.slope * xp, color=viz.ORANGE_ARM[2], lw=2.2, label=f"since 2012: {A['slope_since_2012_per_decade']:+.2f} [{A['ci95_since_2012'][0]:+.2f}, {A['ci95_since_2012'][1]:+.2f}]")
ax.legend(frameon=False, fontsize=8, loc="lower left")
ax.set_ylabel("September extent (million km²)", color=viz.INK2)
ax.set_title("A  Arctic September sea ice: is there a 'pause' since 2012?", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
ax2 = fig.add_axes([0.56, 0.50, 0.40, 0.28])
ax2.hist(slope_last * 10, bins=60, color="#b9b8b0")
ax2.axvline(obs * 10, color=viz.ORANGE_ARM[2], lw=2)
ax2.axvline(b1[0] * 10, color=viz.INK, lw=1, ls="--")
ax2.text(obs * 10, ax2.get_ylim()[1] * 0.92, f"  observed since 2012", color=viz.INK, fontsize=8)
ax2.set_xlabel(f"{L}-year trend in simulated worlds with steady long-term loss + realistic noise (M km²/decade)", fontsize=8, color=viz.INK2)
ax2.set_title(f"B  How rare is a flat {L} years? {100 * A['mc_prob_last_window_as_flat']:.0f}% if fixed in advance, {100 * A['mc_prob_any_window_as_flat']:.0f}% if picked anywhere", fontsize=10, loc="left", fontweight="bold")
ax2.text(0.02, 0.95, f"in the last {L} years: {100 * A['mc_prob_last_window_as_flat']:.0f}% of 20,000 runs\nsomewhere in a 47-year record: {100 * A['mc_prob_any_window_as_flat']:.0f}%\n"
         f"two-segment fit vs one line: p = {A['p_hinge_vs_line']:.2f}", transform=ax2.transAxes, fontsize=8, va="top", color=viz.INK2)
for sp_ in ("top", "right", "left"):
    ax2.spines[sp_].set_visible(False)
ax2.tick_params(length=0, labelsize=8)
# C: Antarctic map
axm = fig.add_axes([0.02, 0.05, 0.30, 0.34], projection=ccrs.SouthPolarStereo())
axm.set_extent([-180, 180, -90, -45], ccrs.PlateCarree())
theta = np.linspace(0, 2 * np.pi, 100); verts = np.vstack([np.sin(theta), np.cos(theta)]).T * 0.5 + 0.5
axm.set_boundary(mpath.Path(verts), transform=axm.transAxes)
im = axm.pcolormesh(hub.LON, hub.LAT, dsst, cmap=viz.div_cmap("redblue"), vmin=-1, vmax=1, transform=ccrs.PlateCarree(), shading="auto", rasterized=True)
axm.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", zorder=2); axm.coastlines(lw=0.4, color=viz.INK2)
axm.set_title("C  Sea temperature 2016–25 minus 1982–2015", fontsize=10, loc="left", fontweight="bold")
cax = fig.add_axes([0.33, 0.10, 0.008, 0.25]); cb = fig.colorbar(im, cax=cax); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7, length=0); cb.set_label("°C", fontsize=7.5)
# D: Antarctic ice anomaly and SO SST anomaly (two stacked panels, shared time axis)
B = res["antarctic"]
d1 = fig.add_axes([0.44, 0.23, 0.52, 0.15])
d1.fill_between(Sa.index, 0, sm12(Sa).values, where=sm12(Sa).values >= 0, color=viz.BLUE_ARM[2], lw=0)
d1.fill_between(Sa.index, 0, sm12(Sa).values, where=sm12(Sa).values < 0, color=viz.ORANGE_ARM[2], lw=0)
d1.set_ylabel("ice extent\nanomaly (M km²)", fontsize=8, color=viz.INK2)
d1.set_title("D  Antarctic sea ice (12-month mean) and the Southern Ocean's temperature, 50–60°S", fontsize=10, loc="left", fontweight="bold")
d2 = fig.add_axes([0.44, 0.05, 0.52, 0.14], sharex=d1)
d2.fill_between(soa.index, 0, sm12(soa).values, where=sm12(soa).values >= 0, color=viz.RED_ARM[2], lw=0)
d2.fill_between(soa.index, 0, sm12(soa).values, where=sm12(soa).values < 0, color=viz.BLUE_ARM[3], lw=0)
d2.set_ylabel("SST anomaly\n(°C)", fontsize=8, color=viz.INK2)
for a_ in (d1, d2):
    a_.axvline(pd.Timestamp(B["ice_pettitt"]), color=viz.INK, lw=0.8, ls=":")
    a_.axhline(0, color=viz.AXIS, lw=0.8)
    for sp_ in ("top", "right", "left"):
        a_.spines[sp_].set_visible(False)
    a_.grid(axis="y", color=viz.GRID, lw=0.5); a_.tick_params(length=0, labelsize=7.5)
d1.set_xlim(pd.Timestamp("1982-01-01"), pd.Timestamp("2026-12-01"))
d1.text(pd.Timestamp(B["ice_pettitt"]), d1.get_ylim()[1] * 0.85, f"  ice change point {pd.Timestamp(B['ice_pettitt']):%b %Y}", fontsize=7.5, color=viz.INK)
AN = B["annual"]
d2.text(0.01, 0.97, f"annual means: r = {AN['r']:+.2f} (surrogate p = {AN['p_surrogate']:.2f}); detrended r = {AN['r_detrended']:+.2f} (p = {AN['p_detrended_surrogate']:.2f})\n"
        f"year-to-year changes r = {AN['r_first_diff']:+.2f} (p = {AN['p_first_diff']:.2f}); SST change point {pd.Timestamp(B['sst_pettitt']):%b %Y}",
        transform=d2.transAxes, fontsize=7.6, color=viz.INK2, va="top")
fig.text(0.01, 0.975, "Two sea-ice traps: a cherry-picked Arctic 'pause', and an Antarctic collapse that coincides with ocean warming", fontsize=14.5, fontweight="bold", va="top")
subt = (f"Arctic September ice has lost {abs(A['trend_per_decade']):.2f} million km² per decade since 1979. Since 2012, the record-low year, the slope is "
        f"{A['slope_since_2012_per_decade']:+.2f} (95% CI {A['ci95_since_2012'][0]:+.1f} to {A['ci95_since_2012'][1]:+.1f}). Had those {L} years been chosen in advance, steady loss "
        f"plus realistic noise would give a window this flat only {100 * A['mc_prob_last_window_as_flat']:.0f}% of the time, a hint of a real slowdown; but the start year was picked "
        f"after seeing the data, such a window appears somewhere in {100 * A['mc_prob_any_window_as_flat']:.0f}% of simulated records, and a breakpoint model does not beat one line "
        f"(p = {A['p_hinge_vs_line']:.2f}): possible, not proven. Antarctic ice collapsed in {pd.Timestamp(B['ice_pettitt']):%Y} ({B['ice_anom_1982_2015']:+.2f} → "
        f"{B['ice_anom_2016_2025']:+.2f} M km²) while the ocean at 50–60°S warmed {B['sst_anom_2016_2025'] - B['sst_anom_1982_2015']:+.2f} °C; they co-vary over years "
        f"(r = {B['annual']['r']:+.2f}), but with so few independent swings this is not significant once persistence is allowed for (surrogate p = "
        f"{B['annual']['p_surrogate']:.2f}) and year-to-year changes do not co-move: suggestive of a warming ocean setting the stage, not proof.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/seaice_pause_and_flip.png"); plt.close(fig)
tl.runlog(TASK, "done", f"Arctic pause chance {100 * A['mc_prob_last_window_as_flat']:.0f}%; Antarctic ice~SST r={B['corr_12mo_smoothed']:+.2f}")
tl.fix_perms(out)
print("done")
