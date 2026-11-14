"""Task 52 - Asia's haze map redrawn: clearer skies over China, Korea, Japan and Taiwan, hazier India - ground sunphotometers vs satellites.

Data
  NASA AERONET v3 Level 2.0 daily AOD (sun photometers; 550 nm from AOD_500 and the 440-870 Angstrom exponent), ~45 Asian sites.
  MERRA-2 M2TMNXAER total AOD and sulfate AOD (reanalysis assimilating MODIS satellite AOD; it also assimilated AERONET until ~2014,
  so it is not fully independent of the ground network before then).
  NASA MSAQSO2L4 SO2 point-source emissions (task 49).
Method
  AERONET: monthly means (>=3 clear-sky days); anomalies vs each site's monthly climatology; annual mean anomaly needs >=6 months;
  trend = Theil-Sen + Hamed-Rao modified Mann-Kendall for sites with >=10 annual values spanning >=12 years within 2005-2025.
  MERRA-2 sampled in the same months at the site's grid cell for a like-for-like trend.
  Map: MERRA-2 total AOD trend 2005-2025 (AR(1)-OLS & MK, FDR q=0.10) with AERONET site trends overlaid.
  Taiwan: sulfate AOD over Taiwan vs China's and Taiwan's own SO2 emissions (annual, 2005-2025).
"""
import sys
import glob
import textwrap
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import TwoSlopeNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "52_asia_haze"
out = tl.task_dir(TASK)
SRC = "Data: NASA AERONET v3 Level 2.0 sun photometers; NASA MERRA-2 aerosol reanalysis (M2TMNXAER); NASA MEaSUREs SO₂ catalogue."
Y0, Y1 = 2005, 2025
latm = -90 + 0.5 * np.arange(361); lonm = -180 + 0.625 * np.arange(576)
t_m, TOT = hub._gd("m2aer", "TOTEXTTAU", "native")
_, SU = hub._gd("m2aer", "SUEXTTAU", "native")
loc = pd.read_csv(f"{ROOT}/data/raw/aeronet/aeronet_locations_v3.txt", skiprows=1).set_index("Site_Name")


def site_annual(daily):
    d = daily.dropna(subset=["AOD_550"]).copy()
    d["m"] = d.date.dt.to_period("M")
    g = d.groupby("m").AOD_550.agg(["mean", "size"])
    g = g[g["size"] >= 3]["mean"]
    g.index = g.index.to_timestamp()
    clim = g.groupby(g.index.month).mean()
    an = g - clim.reindex(g.index.month).values
    yr = an.groupby(an.index.year).agg(["mean", "size"])
    yr = yr[yr["size"] >= 6]["mean"]
    return g, yr + clim.mean(), clim.mean()


rows, store = [], {}
for f in sorted(glob.glob(f"{ROOT}/data/processed/aeronet/*.csv")):
    s = _os.path.basename(f)[:-4]
    d = pd.read_csv(f, parse_dates=["date"])
    if d.empty or s not in loc.index:
        continue
    mon, yr, mean = site_annual(d)
    yr = yr.loc[Y0:Y1]
    if len(yr) < 10 or yr.index.max() - yr.index.min() < 12:
        continue
    mk = tl._mk_hr(yr.values)
    lat, lon = loc.loc[s, "Latitude(decimal_degrees)"], loc.loc[s, "Longitude(decimal_degrees)"]
    i = int(np.argmin(np.abs(latm - lat))); j = int(np.argmin(np.abs(lonm - lon)))
    mser = pd.Series(TOT[:, i, j], t_m)
    mm = mser.reindex(mon.index).dropna()                     # same months as AERONET
    mclim = mser.groupby(mser.index.month).mean()
    man = (mm - mclim.reindex(mm.index.month).values)
    myr = man.groupby(man.index.year).agg(["mean", "size"]); myr = myr[myr["size"] >= 6]["mean"].reindex(yr.index).dropna() + mclim.mean()
    mmk = tl._mk_hr(myr.values) if len(myr) >= 10 else dict(sen=np.nan, p=np.nan)
    rows.append(dict(site=s, lat=lat, lon=lon, n_years=len(yr), first=int(yr.index.min()), last=int(yr.index.max()), mean_aod=float(mean),
                     pct_per_dec=float(mk["sen"] * 10 / mean * 100), p=float(mk["p"]),
                     merra_pct_per_dec=float(mmk["sen"] * 10 / mclim.mean() * 100), merra_p=float(mmk["p"])))
    store[s] = dict(yr=yr, myr=myr)
S = pd.DataFrame(rows).set_index("site")
S.round(4).to_csv(f"{out}/aeronet_site_trends.csv")
print(S.round(2).to_string(), flush=True)
res = dict(n_sites=int(len(S)), n_sig_down=int(((S.p < 0.05) & (S.pct_per_dec < 0)).sum()), n_sig_up=int(((S.p < 0.05) & (S.pct_per_dec > 0)).sum()),
           sign_agree_with_merra=float((np.sign(S.pct_per_dec) == np.sign(S.merra_pct_per_dec)).mean()),
           r_site_trends_aeronet_vs_merra=float(np.corrcoef(S.pct_per_dec, S.merra_pct_per_dec)[0, 1]),
           sites=S.round(3).to_dict("index"))

# ------------------------------------------------------------------ MERRA-2 trend map 2005-2025
sel = (t_m.year >= Y0) & (t_m.year <= Y1)
la = (latm >= -5) & (latm <= 50); lo = (lonm >= 60) & (lonm <= 150)
sub = TOT[sel][:, la][:, :, lo]
tt = t_m[sel]
ann = np.stack([np.nanmean(sub[tt.year == y], 0) for y in range(Y0, Y1 + 1)])
yrs = np.arange(Y0, Y1 + 1).astype(float)
o = tl.ols_ar1(ann, yrs, min_frac=0.8); mk = tl.mk_grid(ann); sen = tl.sen_grid(ann, yrs)
pm = np.maximum(np.nan_to_num(o["p"], nan=1.0), mk["p"])
sig = tl.fdr_mask(pm, 0.10)
pct = sen * 10 / np.nanmean(ann, 0) * 100
lat_s, lon_s = latm[la], lonm[lo]

# ------------------------------------------------------------------ Taiwan sulfate vs SO2 emissions
so2 = pd.read_csv(f"{ROOT}/results/49_so2_sources/so2_by_region_kt.csv", index_col=0)
src = pd.read_csv(f"{ROOT}/results/49_so2_sources/sources_trends.csv")
ti = (latm >= 21.8) & (latm <= 25.4); tj = (lonm >= 119.8) & (lonm <= 122.2)
w = np.cos(np.deg2rad(latm[ti]))[:, None] * np.ones(tj.sum())[None]
su_tw = pd.Series(np.nansum(SU[:, ti][:, :, tj] * w, (1, 2)) / np.sum(w), t_m)
tot_tw = pd.Series(np.nansum(TOT[:, ti][:, :, tj] * w, (1, 2)) / np.sum(w), t_m)
su_a = su_tw.groupby(su_tw.index.year).mean().loc[Y0:Y1]; tot_a = tot_tw.groupby(tot_tw.index.year).mean().loc[Y0:Y1]
mk_su = tl._mk_hr(su_a.values); mk_tot = tl._mk_hr(tot_a.values)
res["taiwan"] = dict(sulfate_aod_2005_07=float(su_a.loc[2005:2007].mean()), sulfate_aod_2023_25=float(su_a.loc[2023:2025].mean()),
                     sulfate_pct_per_dec=float(mk_su["sen"] * 10 / su_a.mean() * 100), sulfate_p=mk_su["p"],
                     total_aod_2005_07=float(tot_a.loc[2005:2007].mean()), total_aod_2023_25=float(tot_a.loc[2023:2025].mean()),
                     total_pct_per_dec=float(mk_tot["sen"] * 10 / tot_a.mean() * 100), total_p=mk_tot["p"],
                     r_sulfate_vs_china_so2=float(np.corrcoef(su_a, so2.China.loc[Y0:Y1])[0, 1]),
                     r_sulfate_vs_china_so2_detrended=float(np.corrcoef(*(v - np.polyval(np.polyfit(yrs, v, 1), yrs) for v in (su_a.values, so2.China.loc[Y0:Y1].values)))[0, 1]))
for s_ in ("Taipei_CWB", "EPA-NCU", "NCU_Taiwan", "Kaohsiung", "Chiayi"):
    if s_ in S.index:
        res["taiwan"][f"aeronet_{s_}"] = S.loc[s_].round(3).to_dict()
print(res["taiwan"], {k: v for k, v in res.items() if k not in ("sites", "taiwan")}, flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.6), dpi=170)
proj = ccrs.PlateCarree()
axm = fig.add_axes([0.01, 0.19, 0.60, 0.64], projection=proj)
axm.set_extent([62, 148, -3, 48], proj)
cm = viz.div_cmap("redblue")
im = axm.pcolormesh(lon_s, lat_s, pct, cmap=cm, vmin=-30, vmax=30, transform=proj, shading="auto", rasterized=True)
axm.contourf(lon_s, lat_s, np.where(sig, 1.0, np.nan), levels=[0.5, 1.5], colors="none", hatches=["...."], transform=proj)
axm.add_feature(cfeature.COASTLINE.with_scale("50m"), lw=0.5, color=viz.INK2); axm.add_feature(cfeature.BORDERS.with_scale("50m"), lw=0.3, color=viz.MUTED)
norm = TwoSlopeNorm(0, -30, 30)
axm.scatter(S.lon, S.lat, c=S.pct_per_dec.clip(-30, 30), cmap=cm, norm=norm, s=np.where(S.p < 0.05, 90, 45), edgecolors=viz.INK,
            linewidths=np.where(S.p < 0.05, 1.4, 0.6), transform=proj, zorder=5)
axm.set_title("Aerosol optical depth trend 2005–2025: MERRA-2 (shading) and AERONET ground stations (circles)", fontsize=10, loc="left", fontweight="bold")
cax = fig.add_axes([0.05, 0.155, 0.22, 0.013]); cb = fig.colorbar(im, cax=cax, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7.5, length=0); cb.set_label("% per decade (dots: FDR-significant; bold circle: station p < 0.05)", fontsize=7.8, color=viz.INK2)
for s_, dx, dy in (("Kanpur", -2, -2.6), ("Beijing", 1, 1.2), ("Taipei_CWB", 1.4, 0.3), ("Seoul_SNU", 1.2, 0.8), ("Hong_Kong_PolyU", -9.5, -1.6), ("Lahore", -1, 1.4),
                   ("Dhaka_University", 0.8, -1.6), ("Osaka", 1, -1.4), ("Singapore", 1, 1), ("Chiang_Mai_Met_Sta", -4, -1.8), ("Solar_Village", 0, 0)):
    if s_ in S.index:
        nm_ = {"Hong_Kong_PolyU": "Hong Kong", "Chiang_Mai_Met_Sta": "Chiang Mai", "Dhaka_University": "Dhaka", "Solar_Village": "Solar Village"}.get(s_, s_.split("_")[0])
        axm.text(S.loc[s_, "lon"] + dx, S.loc[s_, "lat"] + dy, f"{nm_} {S.loc[s_, 'pct_per_dec']:+.0f}%", fontsize=7.5, color=viz.INK,
                 transform=proj, bbox=dict(fc=viz.SURFACE, ec="none", alpha=0.75, pad=0.8))
# right: AERONET vs MERRA-2 site trends
ax = fig.add_axes([0.68, 0.53, 0.29, 0.29])
ax.axhline(0, color=viz.AXIS, lw=0.8); ax.axvline(0, color=viz.AXIS, lw=0.8)
lim = 40
ax.plot([-lim, lim], [-lim, lim], color=viz.MUTED, lw=0.8, ls=":")
ax.scatter(S.pct_per_dec, S.merra_pct_per_dec, s=30, color=viz.SERIES[0], edgecolors=viz.SURFACE, linewidths=0.6, zorder=3)
ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim)
ax.set_xlabel("AERONET station trend (%/decade)", color=viz.INK2, fontsize=8.5); ax.set_ylabel("MERRA-2, same months (%/decade)", color=viz.INK2, fontsize=8.5)
ax.set_title(f"Ground vs reanalysis, {res['n_sites']} stations", fontsize=10, loc="left", fontweight="bold")
ax.text(0.03, 0.97, f"r = {res['r_site_trends_aeronet_vs_merra']:.2f}\nsame sign at {100 * res['sign_agree_with_merra']:.0f}%", transform=ax.transAxes, fontsize=8, va="top", color=viz.INK2)
for sp_ in ("top", "right"):
    ax.spines[sp_].set_visible(False)
ax.grid(color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=7.5)
# Taiwan series
ax2 = fig.add_axes([0.68, 0.10, 0.29, 0.30])
for k_, (s_, col) in enumerate((("Taipei_CWB", viz.SERIES[0]), ("EPA-NCU", viz.SERIES[2]))):
    if s_ in store:
        yv = store[s_]["yr"]
        ax2.plot(yv.index, yv.values, color=col, lw=2, marker="o", ms=3, label=f"{s_.replace('_CWB', '')} (AERONET, {S.loc[s_, 'pct_per_dec']:+.0f}%/dec)")
ax2.plot(tot_a.index, tot_a.values, color=viz.INK, lw=1.4, ls="--", label=f"MERRA-2 over Taiwan ({res['taiwan']['total_pct_per_dec']:+.0f}%/dec)")
ax2.legend(frameon=False, fontsize=7.4, loc="upper right")
ax2.set_xlim(2004.5, 2026); ax2.set_xticks([2005, 2010, 2015, 2020, 2025]); ax2.set_ylim(0.16, 0.62)
ax2.set_ylabel("aerosol optical depth (550 nm)", color=viz.INK2, fontsize=8.5)
for sp_ in ("top", "right", "left"):
    ax2.spines[sp_].set_visible(False)
ax2.grid(axis="y", color=viz.GRID, lw=0.5); ax2.tick_params(length=0, labelsize=7.5)
tw = res["taiwan"]
ax2.set_title("Taiwan's skies cleared with China's SO₂ cuts", fontsize=10, loc="left", fontweight="bold")
ax2.text(0.02, 0.03, f"sulfate AOD over Taiwan {tw['sulfate_pct_per_dec']:+.0f}%/decade; vs China SO₂ emissions r = {tw['r_sulfate_vs_china_so2']:.2f}",
         transform=ax2.transAxes, fontsize=7.4, color=viz.INK2)
tp = S.loc["Taipei_CWB"] if "Taipei_CWB" in S.index else None
kp = S.loc["Kanpur"] if "Kanpur" in S.index else None
bj = S.loc["Beijing"] if "Beijing" in S.index else None
fig.text(0.01, 0.975, "Asia's haze map redrawn: clearer skies over China, Korea, Japan and Taiwan, hazier India", fontsize=15, fontweight="bold", va="top")
subt = (f"{res['n_sites']} NASA AERONET stations with ≥10 years of data: {res['n_sig_down']} show a significant decline in haze (aerosol optical depth), {res['n_sig_up']} a rise. "
        + (f"Beijing {bj['pct_per_dec']:+.0f}%/decade, Taipei {tp['pct_per_dec']:+.0f}%, Kanpur (India) {kp['pct_per_dec']:+.0f}%. " if (tp is not None and kp is not None and bj is not None) else "")
        + f"The MERRA-2 reanalysis, built mainly on MODIS satellite retrievals, gives the same picture (station trends r = {res['r_site_trends_aeronet_vs_merra']:.2f}). "
        f"Over Taiwan, sulfate haze fell {abs(tw['sulfate_pct_per_dec']):.0f}% per decade and tracks China's SO₂ emissions (r = {tw['r_sulfate_vs_china_so2']:.2f}; task 49), "
        f"as winter monsoon winds carry mainland pollution to the island.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/asia_haze_trends.png"); plt.close(fig)
tl.runlog(TASK, "done", f"{res['n_sites']} AERONET sites: {res['n_sig_down']} down, {res['n_sig_up']} up; Taiwan sulfate {tw['sulfate_pct_per_dec']:+.0f}%/dec, r(China SO2)={tw['r_sulfate_vs_china_so2']:.2f}")
tl.fix_perms(out)
print("done")
