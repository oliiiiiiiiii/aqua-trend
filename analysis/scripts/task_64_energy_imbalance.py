"""Task 64 - Earth's energy imbalance is growing: CERES shows the planet absorbing more sunlight than ever (2000-2026).

Data: NASA CERES EBAF Ed4.2.1 monthly TOA fluxes (1 deg): net (incoming - reflected SW - outgoing LW), reflected SW all-sky and clear-sky,
incoming solar. Absorbed solar = solar - reflected SW; outgoing LW = absorbed solar - net.
Method: global area-weighted monthly means -> deseasonalised anomalies; trend 2001-2025 (OLS with AR(1)-corrected errors, Mann-Kendall
on annual means); acceleration test (quadratic term); first 5 years vs last 5 years. Decomposition of the net trend into absorbed SW and
outgoing LW, and of the SW part into clear-sky (surface: ice, snow, aerosol) and cloud contributions. Map of absorbed-SW trends (FDR).
"""
import sys
import textwrap
import numpy as np
import pandas as pd
import netCDF4
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

TASK = "64_energy_imbalance"
out = tl.task_dir(TASK)
SRC = "Data: NASA CERES EBAF Ed4.2.1 top-of-atmosphere radiative fluxes (Terra, Aqua, NOAA-20; 2000-2026)."
Z = np.load(f"{ROOT}/data/processed/ceres/ebaf_sw.npz")
t = pd.DatetimeIndex([pd.Timestamp(str(d)[:10]) for d in netCDF4.num2date(Z["time"], str(Z["time_units"]))]).to_period("M").to_timestamp()
lat = Z["lat"]; lon = np.where(Z["lon"] > 180, Z["lon"] - 360, Z["lon"]); order = np.argsort(lon); lon = lon[order]
net, sw, swc, sol = (Z[k][:, :, order] for k in ("toa_net_all_mon", "toa_sw_all_mon", "toa_sw_clr_t_mon", "solar_mon"))
asr = sol - sw; olr = asr - net; asr_clr = sol - swc
w = np.cos(np.deg2rad(lat))[:, None] * np.ones(len(lon))[None]


def gmean(a):
    return pd.Series(np.nansum(np.nan_to_num(a) * w, (1, 2)) / np.sum(w), t)


def anom(s):
    c = s["2001":"2025"].groupby(s["2001":"2025"].index.month).mean()
    return s - c.reindex(s.index.month).values


G = {k: gmean(v) for k, v in (("net", net), ("asr", asr), ("olr", olr), ("asr_clr", asr_clr))}
G["cloud_sw"] = G["asr"] - G["asr_clr"]       # cloud contribution to absorbed SW (= SW cloud radiative effect)
A = {k: anom(v) for k, v in G.items()}
td = tl.decimal_year(t)
sel = (t.year >= 2001) & (t.year <= 2025)
res = {}
for k, s_ in A.items():
    y = s_.values[sel]; x = td[sel]
    o = tl.ols_ar1(y[:, None], x)
    ann = s_.groupby(s_.index.year).mean().loc[2001:2025]
    mk = tl._mk_hr(ann.values)
    X = np.column_stack([np.ones_like(x), x - x.mean(), (x - x.mean()) ** 2])
    b, *_ = np.linalg.lstsq(X, y, rcond=None); r = y - X @ b
    r1 = np.clip(np.corrcoef(r[1:], r[:-1])[0, 1], 0, 0.95); neff = len(y) * (1 - r1) / (1 + r1)
    cov = (r @ r / (neff - 3)) * np.linalg.inv(X.T @ X)
    res[k] = dict(trend_per_decade=float(o["slope"][0] * 10), ci95=float(o["ci"][0] * 10), p=float(o["p"][0]), mk_p=float(mk["p"]),
                  accel_per_decade2=float(2 * b[2] * 100), accel_p=float(2 * stats.t.sf(abs(b[2] / np.sqrt(cov[2, 2])), neff - 3)))
mean_net = G["net"]
res["net_mean_2001_2005"] = float(mean_net["2001":"2005"].mean()); res["net_mean_2021_2025"] = float(mean_net["2021":"2025"].mean())
res["net_mean_all"] = float(mean_net["2001":"2025"].mean())
ann_net = mean_net.groupby(mean_net.index.year).mean()
res["net_annual"] = ann_net.loc[2001:2025].round(3).to_dict(); res["record_year"] = int(ann_net.loc[2001:2025].idxmax())
res["latest_12mo_net"] = float(mean_net.iloc[-12:].mean()); res["latest_month"] = str(t[-1].date())
print({k: v for k, v in res.items() if k != "net_annual"}, flush=True)
# map of absorbed SW trend
YRS = np.arange(2001, 2026)
ann_asr = np.stack([np.nanmean(asr[t.year == yy], 0) for yy in YRS])
o = tl.ols_ar1(ann_asr, YRS.astype(float), min_frac=0.8); mk = tl.mk_grid(ann_asr); sen = tl.sen_grid(ann_asr, YRS.astype(float))
p = np.maximum(np.nan_to_num(o["p"], nan=1.0), mk["p"]); sig = tl.fdr_mask(p, 0.10)
res["map_frac_sig_up"] = float(np.sum(w * (sig & (sen > 0))) / np.sum(w)); res["map_frac_sig_down"] = float(np.sum(w * (sig & (sen < 0))) / np.sum(w))
tl.save_json(res, f"{out}/stats.json")
pd.DataFrame({k: v for k, v in A.items()}).round(3).to_csv(f"{out}/global_toa_anomalies.csv")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.8), dpi=170)
ax = fig.add_axes([0.05, 0.52, 0.42, 0.30])
desea = A["net"] + res["net_mean_all"]          # deseasonalised (Earth-orbit cycle removed) + long-term mean
s12 = desea.rolling(12, center=True, min_periods=12).mean()
ax.plot(desea.index, desea.values, color=viz.MUTED, lw=0.6)
ax.plot(s12.index, s12.values, color=viz.RED_ARM[2], lw=2.4)
xx = t[sel]; bb = np.polyfit(td[sel], desea.values[sel], 1)
ax.plot(xx, np.polyval(bb, td[sel]), color=viz.INK, lw=1, ls="--")
ax.axhline(0, color=viz.AXIS, lw=0.8)
ax.set_ylabel("net energy into the planet (W m⁻²)", color=viz.INK2)
ax.set_ylim(-1.5, 4.2)
N = res["net"]
ax.set_title("A  Earth's energy imbalance (monthly, seasonal cycle removed; red: 12-month mean)", fontsize=10, loc="left", fontweight="bold")
ax.text(0.02, 0.96, f"{res['net_mean_2001_2005']:.2f} W m⁻² in 2001–05 → {res['net_mean_2021_2025']:.2f} in 2021–25\ntrend {N['trend_per_decade']:+.2f} ± {N['ci95']:.2f} W m⁻² per decade (p = {N['p']:.0e})",
        transform=ax.transAxes, fontsize=8.2, va="top", color=viz.INK2)
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
# B: decomposition bars
ax2 = fig.add_axes([0.56, 0.52, 0.40, 0.30])
items = [("net", "net energy in"), ("asr", "sunlight absorbed"), ("olr", "heat radiated out"), ("asr_clr", "  …absorbed, clear-sky part"), ("cloud_sw", "  …absorbed, cloud part")]
vals = [res[k]["trend_per_decade"] for k, _ in items]; cis = [res[k]["ci95"] for k, _ in items]
cols = [viz.RED_ARM[2], viz.ORANGE_ARM[2], viz.BLUE_ARM[2], viz.ORANGE_ARM[1], viz.ORANGE_ARM[1]]
yy_ = np.arange(len(items))[::-1]
ax2.barh(yy_, vals, xerr=cis, color=cols, height=0.6, error_kw=dict(lw=0.8, ecolor=viz.INK2))
ax2.set_yticks(yy_); ax2.set_yticklabels([lab for _, lab in items], fontsize=8.3)
ax2.axvline(0, color=viz.INK, lw=0.8)
for i, (v, (k, _)) in enumerate(zip(vals, items)):
    ax2.text(v + cis[i] + 0.03, yy_[i], f"{v:+.2f}", va="center", ha="left", fontsize=8, color=viz.INK)
ax2.set_xlabel("trend 2001–2025, W m⁻² per decade (bars: 95% CI)", fontsize=8.5, color=viz.INK2)
ax2.set_title("B  Why: Earth absorbs more sunlight (less cloud, ice and haze)", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax2.spines[sp_].set_visible(False)
ax2.grid(axis="x", color=viz.GRID, lw=0.5); ax2.tick_params(length=0, labelsize=8)
# C: map
axm = fig.add_axes([0.03, 0.06, 0.62, 0.38], projection=ccrs.Robinson(central_longitude=180))
axm.set_global()
im = axm.pcolormesh(lon, lat, sen * 10, cmap=viz.div_cmap("redblue"), vmin=-8, vmax=8, transform=ccrs.PlateCarree(), shading="auto", rasterized=True)
axm.contourf(lon, lat, np.where(sig, 1.0, np.nan), levels=[0.5, 1.5], colors="none", hatches=["...."], transform=ccrs.PlateCarree())
axm.add_feature(cfeature.COASTLINE.with_scale("110m"), lw=0.3, color=viz.INK2); axm.spines["geo"].set_visible(False)
axm.set_title("C  Where Earth got darker (absorbs more sunlight): trend 2001–2025", fontsize=10, loc="left", fontweight="bold")
cax = fig.add_axes([0.67, 0.12, 0.008, 0.26]); cb = fig.colorbar(im, cax=cax); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7, length=0)
cb.set_label("absorbed sunlight, W m⁻² per decade (dots: FDR)", fontsize=7.5, color=viz.INK2)
axt = fig.add_axes([0.72, 0.08, 0.27, 0.34]); axt.axis("off")
axt.text(0, 1, "Reading the map\n\n• Arctic Ocean: sea ice gone → dark water\n• NE Pacific off California, S. Ocean:\n   fewer bright low clouds\n• Eastern China: less reflective haze\n   (task 63)\n• Red central Pacific / blue Indonesia:\n   El Niño–La Niña cloud shifts (natural)\n• Blue India: more haze (task 58)",
         fontsize=8.6, va="top", color=viz.INK2, linespacing=1.4)
fig.text(0.01, 0.975, "Earth's energy imbalance has more than doubled: the planet now absorbs more sunlight than ever measured", fontsize=15, fontweight="bold", va="top")
subt = (f"CERES satellites measure every watt entering and leaving the planet. The excess heat trapped by Earth rose from {res['net_mean_2001_2005']:.2f} W m⁻² in 2001–05 to "
        f"{res['net_mean_2021_2025']:.2f} W m⁻² in 2021–25 ({N['trend_per_decade']:+.2f} W m⁻² per decade, p = {N['p']:.0e}); {res['record_year']} was the record year. "
        f"The cause is mostly more sunlight absorbed ({res['asr']['trend_per_decade']:+.2f} W m⁻² per decade): fewer bright clouds ({res['cloud_sw']['trend_per_decade']:+.2f}) and a darker "
        f"surface and cleaner air ({res['asr_clr']['trend_per_decade']:+.2f}); the extra heat radiated out by a warmer planet ({res['olr']['trend_per_decade']:+.2f}) offsets only part of it. "
        f"About 90% of this heat goes into the ocean, raising sea level through expansion (task 12).")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/energy_imbalance.png"); plt.close(fig)
tl.runlog(TASK, "done", f"EEI {res['net_mean_2001_2005']:.2f} -> {res['net_mean_2021_2025']:.2f} W/m2; trend {N['trend_per_decade']:+.2f}/dec p={N['p']:.0e}")
tl.fix_perms(out)
print("done")
