"""Task 66 - When the sea warms, the clouds thin: a global map of the low-cloud feedback, and the 'Blob' marine heatwave.

Data: NASA CERES EBAF Ed4.2.1 (cloud effect on absorbed sunlight = all-sky minus clear-sky absorbed SW; positive anomaly = clouds reflecting
less) and NOAA OISST v2.1 SST (block-averaged to 1 deg), monthly 2001-2025.
Method: per 1-deg ocean cell, deseasonalised and linearly detrended monthly anomalies; Pearson r between SST and the cloud SW effect with
the Bretherton effective sample size (trendlib.grid_corr), FDR q=0.10; regression slope (W m-2 per K). NE Pacific 'Blob' box (35-50N,
155-130W): monthly series and the 2014-15 / 2019-20 heatwaves.
"""
import sys
import textwrap
import numpy as np
import pandas as pd
import netCDF4
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

TASK = "66_cloud_sst_feedback"
out = tl.task_dir(TASK)
SRC = "Data: NASA CERES EBAF Ed4.2.1 (cloud shortwave effect); NOAA OISST v2.1 sea-surface temperature."
Z = np.load(f"{ROOT}/data/processed/ceres/ebaf_sw.npz")
t = pd.DatetimeIndex([pd.Timestamp(str(d)[:10]) for d in netCDF4.num2date(Z["time"], str(Z["time_units"]))]).to_period("M").to_timestamp()
lat = Z["lat"]; lon = np.where(Z["lon"] > 180, Z["lon"] - 360, Z["lon"]); order = np.argsort(lon); lon = lon[order]
cre = (Z["toa_sw_clr_t_mon"] - Z["toa_sw_all_mon"])[:, :, order]          # = ASR_all - ASR_clr (cloud SW effect, negative = cooling)
sst = hub.load("sst")
ts = pd.DatetimeIndex(sst.time.values)
with np.errstate(all="ignore"):
    import warnings
    warnings.simplefilter("ignore")
    s1 = np.nanmean(sst.values.reshape(len(ts), 180, 2, 360, 2), axis=(2, 4))
common = pd.DatetimeIndex(sorted(set(t) & set(ts)))
common = common[(common >= "2001-01-01") & (common <= "2025-12-31")]
C = cre[t.get_indexer(common)]; S = s1[ts.get_indexer(common)]
ocean = np.isfinite(S).mean(0) > 0.9
C = np.where(ocean[None], C, np.nan); S = np.where(ocean[None], S, np.nan)
gc = tl.grid_corr(S, C, common, deseasonalize=True, detrend=True)
R, Pv, SIG = gc["r"], gc["p"], gc["sig"]
# regression slope W m-2 per K on anomalies
ca, _ = tl.deseason(C.astype(np.float64), common.month.values); sa, _ = tl.deseason(S.astype(np.float64), common.month.values)
with np.errstate(all="ignore"):
    sa_ = sa - np.nanmean(sa, 0); ca_ = ca - np.nanmean(ca, 0)
    slope = np.nansum(sa_ * ca_, 0) / np.nansum(sa_ ** 2, 0)
w = np.cos(np.deg2rad(lat))[:, None] * np.ones(360)[None]
wo = w * ocean
res = dict(frac_ocean_sig_pos=float(np.nansum(wo * (SIG & (R > 0))) / np.sum(wo)), frac_ocean_sig_neg=float(np.nansum(wo * (SIG & (R < 0))) / np.sum(wo)))
LA, LO = np.meshgrid(lat, lon, indexing="ij")
REG = {"NE Pacific (Blob)": (-155, -130, 35, 50), "California stratocumulus": (-135, -115, 20, 35), "Peru stratocumulus": (-95, -75, -25, -5),
       "Namibia stratocumulus": (-10, 12, -25, -5), "Central equatorial Pacific": (155, 180, -5, 5)}
ser = {}
for nm, b in REG.items():
    m = ocean & (LO >= b[0]) & (LO <= b[1]) & (LA >= b[2]) & (LA <= b[3]); ww = w * m
    res[nm] = dict(median_r=float(np.nanmedian(np.where(m, R, np.nan))), median_slope_W_per_K=float(np.nanmedian(np.where(m, slope, np.nan))),
                   frac_sig=float(np.nansum(ww * SIG) / np.sum(ww)))
    cs = pd.Series(np.nansum(np.nan_to_num(ca) * ww, (1, 2)) / np.sum(ww), common); ss = pd.Series(np.nansum(np.nan_to_num(sa) * ww, (1, 2)) / np.sum(ww), common)
    ser[nm] = (ss, cs)
    res[nm]["box_r"] = float(np.corrcoef(ss, cs)[0, 1])
    tt_ = tl.decimal_year(common); dtr = lambda v: v - np.polyval(np.polyfit(tt_, v, 1), tt_)  # noqa: E731
    res[nm]["box_r_detrended"] = float(np.corrcoef(dtr(ss.values), dtr(cs.values))[0, 1])
bss, bcs = ser["NE Pacific (Blob)"]
res["blob_2014_2015"] = dict(sst_anom=float(bss["2014-01":"2015-12"].mean()), cloud_anom=float(bcs["2014-01":"2015-12"].mean()))
res["blob_2019_2020"] = dict(sst_anom=float(bss["2019-06":"2020-06"].mean()), cloud_anom=float(bcs["2019-06":"2020-06"].mean()))
print(res, flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.6), dpi=170)
axm = fig.add_axes([0.01, 0.37, 0.66, 0.47], projection=ccrs.Robinson(central_longitude=-150))
axm.set_global()
im = axm.pcolormesh(lon, lat, np.where(ocean, R, np.nan), cmap=viz.div_cmap("redblue"), vmin=-0.7, vmax=0.7, transform=ccrs.PlateCarree(), shading="auto", rasterized=True)
axm.contourf(lon, lat, np.where(ocean & SIG, 1.0, np.nan), levels=[0.5, 1.5], colors="none", hatches=["...."], transform=ccrs.PlateCarree())
axm.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", zorder=2); axm.add_feature(cfeature.COASTLINE.with_scale("110m"), lw=0.3, color=viz.INK2, zorder=3)
axm.spines["geo"].set_visible(False)
for nm, b in REG.items():
    axm.plot([b[0], b[1], b[1], b[0], b[0]], [b[2], b[2], b[3], b[3], b[2]], color=viz.INK, lw=0.8, transform=ccrs.PlateCarree(), zorder=4)
axm.set_title("Month-to-month link between sea temperature and how much sunlight clouds let in (2001–2025, detrended)", fontsize=10, loc="left", fontweight="bold")
cax = fig.add_axes([0.10, 0.355, 0.30, 0.013]); cb = fig.colorbar(im, cax=cax, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7.5, length=0)
cb.set_label("correlation r (red: warmer sea → thinner clouds → more sunlight absorbed; dots: FDR-significant)", fontsize=7.8, color=viz.INK2)
ax = fig.add_axes([0.73, 0.40, 0.25, 0.42])
names = list(REG.keys())
vals = [res[n]["median_slope_W_per_K"] for n in names]
ax.barh(range(len(names))[::-1], vals, color=[viz.RED_ARM[2] if v > 0 else viz.BLUE_ARM[2] for v in vals], height=0.6)
ax.set_yticks(range(len(names))[::-1]); ax.set_yticklabels([n.replace(" ", "\n", 1) for n in names], fontsize=8)
for i, v in enumerate(vals):
    if v >= 0:
        ax.text(v + 0.3, len(names) - 1 - i, f"{v:+.1f}", va="center", ha="left", fontsize=8)
    else:
        ax.text(v / 2, len(names) - 1 - i, f"{v:+.1f}", va="center", ha="center", fontsize=8, color=viz.SURFACE, fontweight="bold")
ax.axvline(0, color=viz.INK, lw=0.8)
ax.set_xlabel("extra sunlight let in by clouds per +1 K of sea warming (W m⁻²)", fontsize=8, color=viz.INK2)
ax.set_title("Cloud feedback by region (median slope)", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="x", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
# Blob series (two stacked panels, same x)
a1 = fig.add_axes([0.06, 0.155, 0.88, 0.10]); a2 = fig.add_axes([0.06, 0.04, 0.88, 0.10], sharex=a1)
for a_, s_, lab, cpos, cneg in ((a1, bss, "SST anomaly (K)", viz.RED_ARM[2], viz.BLUE_ARM[2]), (a2, bcs, "cloud SW effect\nanomaly (W m⁻²)", viz.RED_ARM[2], viz.BLUE_ARM[2])):
    sm = s_.rolling(3, center=True, min_periods=2).mean()
    a_.fill_between(sm.index, 0, sm.values, where=sm.values >= 0, color=cpos, lw=0); a_.fill_between(sm.index, 0, sm.values, where=sm.values < 0, color=cneg, lw=0)
    a_.axhline(0, color=viz.AXIS, lw=0.8); a_.set_ylabel(lab, fontsize=7.5, color=viz.INK2)
    for sp_ in ("top", "right", "left"):
        a_.spines[sp_].set_visible(False)
    a_.tick_params(length=0, labelsize=7)
a1.tick_params(labelbottom=False)
a1.set_title(f"NE Pacific 'Blob' box (35–50°N, 155–130°W): sea warmth and cloud thinning rise together (monthly r = {res['NE Pacific (Blob)']['box_r']:+.2f}, detrended {res['NE Pacific (Blob)']['box_r_detrended']:+.2f})", fontsize=9.5, loc="left", fontweight="bold")
fig.text(0.01, 0.975, "When the sea warms, the clouds thin: satellites map the low-cloud feedback that amplifies ocean heatwaves", fontsize=15, fontweight="bold", va="top")
B = res["NE Pacific (Blob)"]; Cs = res["California stratocumulus"]; Ps = res["Peru stratocumulus"]
subt = (f"Over the cool subtropical oceans where low stratocumulus decks blanket the sea, a warmer month brings thinner, fewer clouds and more sunlight reaching the ocean: "
        f"about {Cs['median_slope_W_per_K']:+.0f} W m⁻² per kelvin off California and {Ps['median_slope_W_per_K']:+.0f} off Peru. The link is significant (FDR) over "
        f"{100 * res['frac_ocean_sig_pos']:.0f}% of the ocean. It is a positive feedback: in the NE Pacific 'Blob' heatwave of 2014–15 the sea ran {res['blob_2014_2015']['sst_anom']:+.1f} K "
        f"warm while clouds let in {res['blob_2014_2015']['cloud_anom']:+.1f} W m⁻² extra. In the central equatorial Pacific the sign flips "
        f"(median slope {res['Central equatorial Pacific']['median_slope_W_per_K']:+.0f} W m⁻² per K): there, warmer water triggers deep, bright storm clouds.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/cloud_sst_feedback.png"); plt.close(fig)
tl.runlog(TASK, "done", f"sig positive on {100 * res['frac_ocean_sig_pos']:.0f}% of ocean; California {Cs['median_slope_W_per_K']:+.1f} W/m2/K; Blob r={B['box_r']:+.2f}")
tl.fix_perms(out)
print("done")
