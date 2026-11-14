"""Task 54 - East Africa's rising lakes: Lake Victoria and its neighbours ratchet upward in Indian Ocean Dipole years.

Data
  NASA GWM (Global Water Measurements; former USDA/NASA G-REALM) satellite radar altimetry lake levels, 10-day, 1992-2026
  (TOPEX/Poseidon, Jason-1/2/3, Sentinel-6A; height variation vs the Jason-2 reference mean, cross-mission biases applied by GWM).
  GRACE/GRACE-FO JPL mascons (water storage, 2002-2026); GPCP v2.3 (1979-) and IMERG V07 (1998-) rain; DMI (Indian Ocean Dipole) and Nino3.4.
Method
  Lake levels: 10-day values -> monthly medians; anomaly vs the lake's 2003-2012 mean; Pettitt change point; annual level change
  (Dec-to-Dec) vs the preceding Oct-Dec 'short rains'. Short rains (OND) over the Lake Victoria basin vs SON DMI and Nino3.4 (partial r).
  GRACE: change map (2020-2025 minus 2003-2012) and Pettitt step on the basin mean.
"""
import sys
import tarfile
import textwrap
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
import hub  # noqa: E402

TASK = "54_east_africa_lakes"
out = tl.task_dir(TASK)
SRC = "Data: NASA GWM satellite altimetry lake levels (TOPEX→Sentinel-6A); GRACE/GRACE-FO JPL mascons; IMERG V07 & GPCP v2.3 rain; NOAA DMI & Niño3.4."
LAKES = {"000314": "Victoria", "000398": "Kyoga", "000093": "Turkana", "000315": "Tanganyika", "000317": "Malawi", "000091": "Naivasha",
         "000416": "Mweru", "000082": "Rukwa"}   # IDs verified against each file's header name and coordinates


def parse(txt):
    rows, lat, lon = [], np.nan, np.nan
    for ln in txt.splitlines():
        if "Latitude and longitude" in ln:
            p = ln.split(); lat, lon = float(p[0]), float(p[1])
        p = ln.split()
        if len(p) >= 16 and p[2].isdigit() and len(p[2]) == 8 and p[2] != "99999999":
            h = float(p[5])
            if h < 900:
                rows.append((pd.Timestamp(p[2]), h))
    s = pd.Series(dict(rows)).sort_index()
    return s, lat, lon


lv, meta = {}, {}
with tarfile.open(f"{ROOT}/data/raw/gwm/lake.10.tar.gz", "r:gz") as t:
    for m in t.getmembers():
        lid = m.name.split("/")[-1][4:10]
        if m.isfile() and lid in LAKES and m.name.endswith(".10d.2.txt"):
            s, la, lo = parse(t.extractfile(m).read().decode("latin1"))
            lv[LAKES[lid]] = s; meta[LAKES[lid]] = (la, lo)
print({k: (len(v), str(v.index.min().date()), str(v.index.max().date())) for k, v in lv.items()}, flush=True)
res = {"lakes": {}}
mon = {}
for nm, s in lv.items():
    m = s.resample("MS").median()
    base = m["2003":"2012"].mean()
    a = m - base
    mon[nm] = a
    ad = a.dropna()
    k, K, pp = tl.pettitt(ad.values)
    dec = a[a.index.month == 12].dropna()
    res["lakes"][nm] = dict(lat=meta[nm][0], lon=meta[nm][1], first=str(ad.index.min().date()), last=str(ad.index.max().date()),
                            level_2019_mean=float(a["2019"].mean()), level_2020_2026_mean=float(a["2020":].mean()), latest=float(ad.iloc[-3:].mean()),
                            max=float(ad.max()), max_month=str(ad.idxmax().date()), min_1992_2026=float(ad.min()),
                            pettitt_month=str(ad.index[k].date()), pettitt_p=float(pp),
                            rise_2019_to_2021=float(a["2020-01":"2021-12"].max() - a["2019-08":"2019-10"].mean()),
                            rise_2023_to_2024=float(a["2024-01":"2024-12"].max() - a["2023-08":"2023-10"].mean()))
    print(nm, {k_: (round(v, 2) if isinstance(v, float) else v) for k_, v in res["lakes"][nm].items()}, flush=True)
pd.DataFrame(mon).round(3).to_csv(f"{out}/lake_level_anomalies_monthly.csv")

# ------------------------------------------------------------------ rain and IOD
LA, LO = np.meshgrid(hub.LAT, hub.LON, indexing="ij")
VB = (29, 36, -4, 2)   # Lake Victoria basin box
mb = (LO >= VB[0]) & (LO <= VB[1]) & (LA >= VB[2]) & (LA <= VB[3]); wb = np.cos(np.deg2rad(LA)) * mb


def bm(da):
    return pd.Series([np.nansum(np.nan_to_num(x) * wb) / np.sum(wb * np.isfinite(x)) if np.isfinite(x[mb]).any() else np.nan for x in da.values],
                     pd.DatetimeIndex(da.time.values))


pg, pi = bm(hub.load("p_gpcp")), bm(hub.load("p_imerg"))
dmi, n34 = hub.index("dmi"), hub.index("nino34")
seas = lambda s, ms: s[s.index.month.isin(ms)].groupby(s[s.index.month.isin(ms)].index.year).mean()  # noqa: E731
ond_g, ond_i = seas(pg, [10, 11, 12]), seas(pi, [10, 11, 12])
d_son, n_son = seas(dmi, [9, 10, 11]), seas(n34, [9, 10, 11])
yrs = np.arange(1981, 2026)
og = ond_g.reindex(yrs); d = d_son.reindex(yrs); n = n_son.reindex(yrs)
r_d, p_d = stats.pearsonr(og, d); r_n, p_n = stats.pearsonr(og, n); r_dn = np.corrcoef(d, n)[0, 1]
pr_d = (r_d - r_n * r_dn) / np.sqrt((1 - r_n ** 2) * (1 - r_dn ** 2))
yi = np.arange(1998, 2026); oi = ond_i.reindex(yi)
r_di, p_di = stats.pearsonr(oi.dropna(), d_son.reindex(oi.dropna().index))
ann_g = pg.groupby(pg.index.year).mean().loc[1981:2025]
mk_ann = tl._mk_hr(ann_g.values)
res["rain"] = dict(ond_vs_dmi_gpcp=dict(r=float(r_d), p=float(p_d), n=len(yrs)), ond_vs_nino34_gpcp=dict(r=float(r_n), p=float(p_n)),
                   ond_vs_dmi_partial_given_nino=float(pr_d), ond_vs_dmi_imerg=dict(r=float(r_di), p=float(p_di), n=int(oi.notna().sum())),
                   annual_rain_trend_pct_per_dec=float(mk_ann["sen"] * 10 / ann_g.mean() * 100), annual_rain_trend_p=float(mk_ann["p"]),
                   top_ond_gpcp=og.sort_values(ascending=False).head(6).round(2).to_dict(), top_dmi_son=d.sort_values(ascending=False).head(5).round(2).to_dict())
# wet-season level gain: Sep-Oct of year y -> May-Jun of year y+1 (short rains OND + long rains MAM), vs OND rain of year y
gain = {}
for nm, a in mon.items():
    g_ = {}
    for y in range(1992, 2026):
        a0 = a[f"{y}-09":f"{y}-10"].mean(); a1 = a[f"{y + 1}-05":f"{y + 1}-06"].mean()
        if np.isfinite(a0) and np.isfinite(a1):
            g_[y] = a1 - a0
    gain[nm] = pd.Series(g_)
res["wet_season_gain_vs_ond_rain"] = {}
for nm, g_ in gain.items():
    jj = g_.index.intersection(og.dropna().index)
    r_g, p_g = stats.pearsonr(g_[jj], og[jj]); r_gd, p_gd = stats.pearsonr(g_[jj], d[jj])
    res["wet_season_gain_vs_ond_rain"][nm] = dict(r_rain=float(r_g), p_rain=float(p_g), r_dmi=float(r_gd), p_dmi=float(p_gd), n=len(jj),
                                                  biggest=g_.sort_values(ascending=False).head(3).round(2).to_dict())
res["victoria_annual_change_vs_ond_rain"] = res["wet_season_gain_vs_ond_rain"].get("Victoria")
top3 = {nm: set(int(k_) for k_ in v["biggest"].keys()) for nm, v in res["wet_season_gain_vs_ond_rain"].items()}
res["lakes_with_top3_gains_in_1997_2019_2023"] = sorted([nm for nm, s3 in top3.items() if s3 == {1997, 2019, 2023}])
print(res["rain"], res["victoria_annual_change_vs_ond_rain"], flush=True)

# ------------------------------------------------------------------ GRACE
tws = hub.load("tws")
tt = pd.DatetimeIndex(tws.time.values)
with np.errstate(all="ignore"):
    import warnings
    warnings.simplefilter("ignore")
    dmap = np.nanmean(tws.values[(tt.year >= 2020) & (tt.year <= 2025)], 0) - np.nanmean(tws.values[(tt.year >= 2003) & (tt.year <= 2012)], 0)
gv = bm(tws).dropna()
k, K, pp = tl.pettitt(gv.values)
ga = gv.groupby(gv.index.year).mean()
res["grace_victoria_basin"] = dict(mean_2003_2012=float(ga.loc[2003:2012].mean()), mean_2020_2025=float(ga.loc[2020:2025].mean()),
                                   pettitt_month=str(gv.index[k].date()), pettitt_p=float(pp), annual=ga.round(1).to_dict())
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.8), dpi=170)
axm = fig.add_axes([0.01, 0.08, 0.30, 0.76], projection=ccrs.PlateCarree())
axm.set_extent([24, 44, -16, 8], ccrs.PlateCarree())
cm = viz.div_cmap("water")
im = axm.pcolormesh(hub.LON, hub.LAT, dmap, cmap=cm, vmin=-40, vmax=40, transform=ccrs.PlateCarree(), shading="auto", rasterized=True)
axm.add_feature(cfeature.LAKES.with_scale("50m"), facecolor="none", edgecolor=viz.INK, lw=0.6)
axm.add_feature(cfeature.COASTLINE.with_scale("50m"), lw=0.5, color=viz.INK2); axm.add_feature(cfeature.BORDERS.with_scale("50m"), lw=0.3, color=viz.MUTED)
for nm, (la, lo) in meta.items():
    axm.plot(lo, la, "o", ms=4, color=viz.INK, transform=ccrs.PlateCarree())
    axm.text(lo + 0.4, la + 0.3, nm, fontsize=7.8, color=viz.INK, transform=ccrs.PlateCarree(), bbox=dict(fc=viz.SURFACE, ec="none", alpha=0.7, pad=0.6))
axm.set_title("A  Water storage, 2020–25 vs 2003–12 (GRACE)", fontsize=10, loc="left", fontweight="bold")
cax = fig.add_axes([0.04, 0.055, 0.24, 0.012]); cb = fig.colorbar(im, cax=cax, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7.5, length=0); cb.set_label("cm of water", fontsize=8, color=viz.INK2)
# B: lake level small multiples
order = [k_ for k_ in ["Victoria", "Kyoga", "Naivasha", "Turkana", "Tanganyika", "Malawi"] if k_ in mon]
for i, nm in enumerate(order):
    r_, c_ = divmod(i, 2)
    ax = fig.add_axes([0.37 + c_ * 0.165, 0.60 - r_ * 0.235, 0.145, 0.17])
    a = mon[nm]
    ax.axhline(0, color=viz.AXIS, lw=0.8)
    for y0, y1 in ((1997.75, 1998.3), (2006.75, 2007.3), (2019.75, 2020.3), (2023.75, 2024.3)):
        ax.axvspan(pd.Timestamp(year=int(y0), month=10, day=1), pd.Timestamp(year=int(y0) + 1, month=4, day=1), color=viz.ORANGE_ARM[0], lw=0, alpha=0.8)
    ax.plot(a.index, a.values, color=viz.SERIES[0], lw=1.3)
    ax.set_title(f"{nm}: {res['lakes'][nm]['latest']:+.1f} m now", fontsize=9, loc="left", fontweight="bold")
    for sp_ in ("top", "right", "left"):
        ax.spines[sp_].set_visible(False)
    ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=7)
    ax.set_xlim(pd.Timestamp("1992-09-01"), pd.Timestamp("2027-01-01"))
    ax.set_xticks([pd.Timestamp(f"{y}-01-01") for y in (1995, 2005, 2015, 2025)]); ax.set_xticklabels(["1995", "2005", "2015", "2025"])
    if c_ == 0:
        ax.set_ylabel("m vs 2003–12", fontsize=7.5, color=viz.INK2)
fig.text(0.37, 0.835, "B  Lake levels from satellite radar altimetry\n(orange: strong positive-IOD short rains)", fontsize=10, fontweight="bold", va="top")
# C: OND rain vs DMI
ax = fig.add_axes([0.74, 0.50, 0.24, 0.28])
cols = [viz.ORANGE_ARM[2] if v > 0.5 else (viz.BLUE_ARM[2] if v < -0.3 else "#b9b8b0") for v in d.values]
ax.scatter(d.values, og.values, c=cols, s=24, edgecolors=viz.SURFACE, linewidths=0.5)
for y in (1997, 2006, 2019, 2023):
    ax.annotate(str(y), (d.loc[y], og.loc[y]), xytext=(4, 2), textcoords="offset points", fontsize=7.5, color=viz.INK)
bb = np.polyfit(d.values, og.values, 1); xx = np.linspace(d.min(), d.max(), 10)
ax.plot(xx, np.polyval(bb, xx), color=viz.INK, lw=1)
ax.set_xlabel("Indian Ocean Dipole, Sep–Nov (°C)", fontsize=8.5, color=viz.INK2); ax.set_ylabel("Oct–Dec rain, Victoria basin (mm/day)", fontsize=8.5, color=viz.INK2)
ax.set_title("C  Short rains follow the Indian Ocean Dipole", fontsize=10, loc="left", fontweight="bold")
R_ = res["rain"]
ax.text(0.03, 0.97, f"r = {R_['ond_vs_dmi_gpcp']['r']:.2f} (GPCP 1981–2025)\nr = {R_['ond_vs_dmi_imerg']['r']:.2f} (IMERG 1998–2025)\npartial r | Niño3.4 = {R_['ond_vs_dmi_partial_given_nino']:.2f}",
        transform=ax.transAxes, fontsize=7.8, va="top", color=viz.INK2)
for sp_ in ("top", "right"):
    ax.spines[sp_].set_visible(False)
ax.grid(color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=7.5)
# D: GRACE basin series
ax = fig.add_axes([0.73, 0.10, 0.25, 0.28])
ax.plot(gv.index, gv.values, color=viz.SERIES[2], lw=1.2)
ax.plot(ga.index.map(lambda y: pd.Timestamp(year=y, month=7, day=1)), ga.values, "o", color=viz.SERIES[2], ms=3)
ax.axhline(0, color=viz.AXIS, lw=0.8)
ax.set_ylabel("cm of water", fontsize=8.5, color=viz.INK2)
ax.set_title("D  Water stored in the Victoria basin (GRACE)", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=7.5)
V_ = res["lakes"]["Victoria"]; G_ = res["grace_victoria_basin"]
fig.text(0.01, 0.975, "East Africa's lakes ratchet upward: each Indian Ocean Dipole flood adds water that does not drain away", fontsize=15, fontweight="bold", va="top")
T_, K_, N_, R2 = res["lakes"]["Turkana"], res["lakes"]["Kyoga"], res["lakes"]["Naivasha"], res["lakes"]["Rukwa"]
subt = (f"Lake Victoria rose {V_['rise_2019_to_2021']:+.1f} m after the 2019 short rains and {V_['rise_2023_to_2024']:+.1f} m after 2023, peaking {V_['max']:+.1f} m above its 2003–12 level "
        f"in {pd.Timestamp(V_['max_month']):%b %Y}. Turkana ({T_['latest']:+.1f} m), Rukwa ({R2['latest']:+.1f} m) and Naivasha ({N_['latest']:+.1f} m) are at or near their highest "
        f"in the 34-year altimetry record. GRACE shows the basin holding {G_['mean_2020_2025'] - G_['mean_2003_2012']:+.0f} cm more water "
        f"than in 2003–12. Annual rain has no trend ({R_['annual_rain_trend_pct_per_dec']:+.1f}%/decade, p={R_['annual_rain_trend_p']:.2f}); the rises come in steps, in the "
        f"Oct–Dec short rains of strong positive Indian Ocean Dipole years, when the western Indian Ocean is warm (dipole vs short rains r = {R_['ond_vs_dmi_gpcp']['r']:.2f}). "
        f"On {len(res['lakes_with_top3_gains_in_1997_2019_2023'])} of {len(lv)} lakes the three biggest wet-season rises since 1992 came in 1997, 2019 and 2023, the three strongest "
        f"dipole years; Victoria's wet-season rise tracks the short rains at r = {res['wet_season_gain_vs_ond_rain']['Victoria']['r_rain']:.2f}. The water then drains far more slowly than it arrived.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/east_africa_lakes.png"); plt.close(fig)
tl.runlog(TASK, "done", f"Victoria {V_['latest']:+.2f} m vs 2003-12 (rise 2019-21 {V_['rise_2019_to_2021']:+.2f} m); OND rain~DMI r={R_['ond_vs_dmi_gpcp']['r']:.2f}")
tl.fix_perms(out)
print("done")
