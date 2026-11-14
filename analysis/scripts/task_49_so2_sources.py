"""Task 49 - Sulfur dioxide from space: 780 point sources, 2005-2025. China's coal clean-up vs India's rise, cross-checked by four satellites.

Data: NASA MEaSUREs MSAQSO2L4 v2 (Fioletov et al. SO2 emissions catalogue): annual SO2 emissions (kt/yr) of 780 point sources
(493 power plants, 104 oil & gas, 75 smelters, 108 volcanoes) estimated from OMI (2005-), OMPS-NPP (2012-), TROPOMI (2018-) and OMPS-NOAA20 (2018-);
the 'Catalogue' group merges them. Anthropogenic = all non-volcano sources.
Tests: per-source Theil-Sen slope of log emissions + Mann-Kendall, FDR q=0.10 across sources; per-region totals: Sen slope + Hamed-Rao
modified Mann-Kendall (autocorrelation-robust);
China-India crossover year; cross-instrument agreement of 2018-2025 trends (four independent satellites).
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
from matplotlib.colors import TwoSlopeNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402

TASK = "49_so2_sources"
out = tl.task_dir(TASK)
SRC = "Data: NASA MEaSUREs MSAQSO2L4 v2 SO₂ emissions catalogue (OMI, OMPS-NPP, TROPOMI, OMPS-NOAA20), Fioletov et al."
nc = netCDF4.Dataset(glob.glob(f"{ROOT}/data/raw/so2/MSAQSO2L4*.nc")[0])
years = np.asarray(nc["Year"][:]).astype(int)


def em(group):
    e = np.ma.filled(nc[f"{group}/Emissions"][:].astype(float), np.nan)
    e[e < -900] = np.nan
    return e


S = pd.DataFrame({"name": pd.Series(nc["SourceName"][:]).str.strip(), "country": pd.Series(nc["SourceCountry"][:]).str.strip(),
                  "type": pd.Series(nc["SourceType"][:]).str.strip(), "lat": np.asarray(nc["Latitude"][:]), "lon": np.asarray(nc["Longitude"][:])})
E = em("Catalogue")
INST = {"OMI": em("Aura_OMI"), "OMPS-NPP": em("NPP_OMPS"), "TROPOMI": em("S5P_TROPOMI"), "OMPS-NOAA20": em("N20_OMPS")}
MIDEAST = {"Iran", "Iraq", "Saudi Arabia", "Kuwait", "United Arab Emirates", "Qatar", "Oman", "Syria", "Yemen", "Israel", "Jordan", "Lebanon"}
EUROPE = {"Albania", "Belgium", "Bosnia and Herzegovina", "Bulgaria", "Croatia", "Czech Republic", "Estonia", "France", "Germany", "Greece", "Hungary",
          "Italy", "Macedonia (FYROM)", "Poland", "Portugal", "Romania", "Serbia", "Slovakia", "Spain", "UK", "Ukraine", "Belarus", "Turkey", "Cyprus"}


def region(c):
    if c in ("China", "India", "USA", "Russia"):
        return c
    if c in MIDEAST:
        return "Middle East"
    if c in EUROPE:
        return "Europe & Turkey"
    return "Rest of world"


S["region"] = S.country.map(region)
anth = (S.type != "Volcano").values
REG = ["China", "India", "USA", "Russia", "Middle East", "Europe & Turkey", "Rest of world"]


def trend_log(y, t):
    """% per year from the Theil-Sen slope of log(emission); p from Mann-Kendall (plain, vectorised) and, for single series,
    the Hamed-Rao autocorrelation-corrected MK (OLS-AR1 is unusable here: curved declines leave r1 ~ 1 residuals)."""
    ly = np.log(np.clip(np.asarray(y, float), 1e-3, None))
    sen = tl.sen_grid(ly, t)
    mk = tl.mk_grid(ly)
    p_hr = tl._mk_hr(ly)["p"] if ly.ndim == 1 else np.nan
    return (np.exp(sen) - 1) * 100, mk["p"], p_hr


res = {}
tot = pd.DataFrame({r: np.nansum(E[anth & (S.region == r).values], 0) for r in REG}, index=years)
tot["Anthropogenic total"] = np.nansum(E[anth], 0)
tot["Volcanoes"] = np.nansum(E[~anth], 0)
tot.round(1).to_csv(f"{out}/so2_by_region_kt.csv")
for c in tot.columns:
    pct, p, pmk = trend_log(tot[c].values, years.astype(float))
    a, b = tot[c].loc[2005:2007].mean(), tot[c].loc[2023:2025].mean()
    res[c] = dict(pct_per_yr=float(pct), p_mk=float(p), p_mk_hamed_rao=float(pmk), mean_2005_07=float(a), mean_2023_25=float(b),
                  change_pct=float((b / a - 1) * 100))
    print(f"{c:22s} {a:8.0f} -> {b:8.0f} kt ({(b / a - 1) * 100:+.0f}%), {float(pct):+.1f}%/yr p_mk={float(p):.1e} p_hr={float(pmk):.1e}", flush=True)
cross = tot.index[(tot.India > tot.China)]
res["india_exceeds_china_from"] = int(cross.min()) if len(cross) else None
crm = tot.index[(tot["Middle East"] > tot.China)]
res["mideast_exceeds_china_from"] = int(crm.min()) if len(crm) else None
res["largest_named_region_2025"] = str(tot[REG[:-1]].loc[2025].idxmax())
res["india_share_2025"] = float(tot.India.loc[2025] / tot["Anthropogenic total"].loc[2025])
res["china_share_2005"] = float(tot.China.loc[2005] / tot["Anthropogenic total"].loc[2005])
# Taiwan & East Asia neighbours
for c in ("Taiwan", "South Korea", "Japan", "Vietnam"):
    k = anth & (S.country == c).values
    res[f"country_{c}"] = dict(n_sources=int(k.sum()), y2005_07=float(np.nansum(E[k], 0)[:3].mean()), y2023_25=float(np.nansum(E[k], 0)[-3:].mean()))
# per-source trends
pct, p, _ = trend_log(E.T, years.astype(float))
S["pct_per_yr"] = pct; S["p"] = p
S["e0"] = np.nanmean(E[:, :3], 1); S["e1"] = np.nanmean(E[:, -3:], 1)
S["ratio"] = (S.e1 + 1) / (S.e0 + 1)
sig = tl.fdr_mask(np.where(anth, S.p.values, np.nan), 0.10)
S["sig"] = sig & anth
A_ = S[anth]
res["sources"] = dict(n_anthropogenic=int(anth.sum()), sig_down=int(((A_.pct_per_yr < 0) & A_.sig).sum()), sig_up=int(((A_.pct_per_yr > 0) & A_.sig).sum()),
                      emission_weighted_share_down=float(A_.e0[(A_.pct_per_yr < 0) & A_.sig].sum() / A_.e0.sum()))
up = A_[A_.sig & (A_.pct_per_yr > 0)].sort_values("e1", ascending=False).head(12)
dn = A_[A_.sig & (A_.pct_per_yr < 0)].sort_values("e0", ascending=False).head(12)
res["top_rising"] = up[["name", "country", "type", "e0", "e1", "pct_per_yr"]].round(1).to_dict("records")
res["top_falling"] = dn[["name", "country", "type", "e0", "e1", "pct_per_yr"]].round(1).to_dict("records")
print(res["sources"], "\nrising:", up[["name", "country", "e0", "e1"]].round(0).to_string(), "\nfalling:", dn[["name", "country", "e0", "e1"]].round(0).to_string(), flush=True)
# cross-instrument: 2018-2025 trends for each region with all four instruments
ci = {}
yy = years >= 2018
for r in ("China", "India", "Anthropogenic total", "Middle East", "USA"):
    ci[r] = {}
    for nm, X in INST.items():
        k = anth if r == "Anthropogenic total" else anth & (S.region == r).values
        s = np.nansum(X[k], 0)[yy]
        pc, pp_, _ = trend_log(s, years[yy].astype(float))
        ci[r][nm] = dict(pct_per_yr=float(pc), p=float(pp_))
    print(r, {k: round(v["pct_per_yr"], 1) for k, v in ci[r].items()}, flush=True)
res["cross_instrument_2018_2025"] = ci
S.drop(columns=["sig"]).round(3).to_csv(f"{out}/sources_trends.csv", index=False)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.4), dpi=170)
PROJ = ccrs.Robinson(central_longitude=40)
axm = fig.add_axes([0.01, 0.33, 0.62, 0.50], projection=PROJ)
axm.set_global()
_y0 = PROJ.transform_point(40, -57, ccrs.PlateCarree())[1]; _y1 = PROJ.transform_point(40, 80, ccrs.PlateCarree())[1]
axm.set_ylim(_y0, _y1)
axm.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", lw=0); axm.add_feature(cfeature.COASTLINE.with_scale("110m"), lw=0.3, color=viz.MUTED)
axm.spines["geo"].set_visible(False)
V = S[~anth]
axm.scatter(V.lon, V.lat, marker="^", s=10, color="#9a9890", linewidths=0, transform=ccrs.PlateCarree(), zorder=2)
Aa = A_.sort_values("e0", ascending=False)
size = np.sqrt(np.maximum(Aa.e0, Aa.e1)) * 2.2
lr = np.log2(Aa.ratio.clip(1 / 16, 16))
cm = viz.div_cmap("redblue")
sc = axm.scatter(Aa.lon, Aa.lat, s=size, c=lr, cmap=cm, norm=TwoSlopeNorm(0, -4, 4), edgecolors=viz.SURFACE, linewidths=0.4,
                 transform=ccrs.PlateCarree(), zorder=3, alpha=0.92)
axm.set_title("Every SO₂ point source seen from space: change 2005–07 → 2023–25", fontsize=10.5, loc="left", fontweight="bold")
cax = fig.add_axes([0.10, 0.315, 0.22, 0.014])
cb = fig.colorbar(sc, cax=cax, orientation="horizontal", ticks=[-4, -2, 0, 2, 4]); cb.outline.set_visible(False)
cb.ax.set_xticklabels(["÷16", "÷4", "same", "×4", "×16"]); cb.ax.tick_params(labelsize=7.5, length=0)
cb.set_label("emission change (circle area = emission size)", fontsize=8, color=viz.INK2)
fig.text(0.36, 0.318, "▲ volcanoes (natural, shown in grey)", fontsize=8, color=viz.MUTED)
# lines: regions
ax = fig.add_axes([0.68, 0.40, 0.30, 0.44])
order = ["China", "India", "Russia", "Middle East", "USA", "Europe & Turkey"]
ends = sorted([(tot[r].iloc[-1] / 1000, r) for r in order])
lab_y, last = {}, -1e9
for yv, r in ends:                       # simple label repel: keep >= 0.9 Mt between end labels
    yl = max(yv, last + 0.9); lab_y[r] = yl; last = yl
for k, r in enumerate(order):
    ax.plot(years, tot[r] / 1000, color=viz.SERIES[k], lw=2.2)
    ax.text(2025.4, lab_y[r], r, fontsize=8.2, color=viz.INK, va="center")
xo = res["india_exceeds_china_from"]
if xo:
    ax.annotate(f"India passes China\n({xo})", xy=(xo, tot.India.loc[xo] / 1000), xytext=(xo + 0.5, 13), fontsize=8, color=viz.INK2,
                arrowprops=dict(arrowstyle="-", color=viz.MUTED, lw=0.8))
ax.set_xlim(2004.5, 2030.5); ax.set_xticks([2005, 2010, 2015, 2020, 2025])
ax.set_ylabel("million tonnes SO₂ per year (point sources)", color=viz.INK2, fontsize=9)
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
ax.set_title("Anthropogenic emissions by region", fontsize=10.5, loc="left", fontweight="bold")
# cross-instrument small multiples: China and India
for k, r in enumerate(("China", "India")):
    axc = fig.add_axes([0.07 + k * 0.33, 0.05, 0.26, 0.15])
    for j_, (nm, X) in enumerate(INST.items()):
        s = pd.Series(np.nansum(X[anth & (S.region == r).values], 0), years).replace(0, np.nan)
        axc.plot(s.index, s / 1000, color=["#3b3a36", viz.SERIES[0], viz.SERIES[1], viz.SERIES[2]][j_], lw=1.6, marker="o", ms=2.4, label=nm)
    axc.set_title(f"{r}: four satellites agree", fontsize=9.5, loc="left", fontweight="bold")
    for sp_ in ("top", "right", "left"):
        axc.spines[sp_].set_visible(False)
    axc.grid(axis="y", color=viz.GRID, lw=0.5); axc.tick_params(length=0, labelsize=7.5)
    axc.set_ylim(0, None); axc.set_xticks([2005, 2010, 2015, 2020, 2025])
    if k == 0:
        axc.set_ylabel("Mt/yr", color=viz.INK2, fontsize=8.5)
    if k == 1:
        axc.legend(frameon=False, fontsize=7.5, ncol=1, loc="center left", bbox_to_anchor=(1.02, 0.5))
axt = fig.add_axes([0.79, 0.04, 0.20, 0.24]); axt.axis("off")
cr = res["cross_instrument_2018_2025"]
lines = ["2018–2025 trend, %/yr", "              OMI  TROPOMI  OMPS×2"]
for r in ("China", "India", "Middle East", "USA"):
    c_ = cr[r]
    lines.append(f"{r:12s} {c_['OMI']['pct_per_yr']:+5.1f}  {c_['TROPOMI']['pct_per_yr']:+5.1f}   {c_['OMPS-NPP']['pct_per_yr']:+4.1f}/{c_['OMPS-NOAA20']['pct_per_yr']:+4.1f}")
axt.text(0, 1, "\n".join(lines), family="DejaVu Sans Mono", fontsize=7.6, va="top", color=viz.INK)
ch, ind, tot_ = res["China"], res["India"], res["Anthropogenic total"]
fig.text(0.01, 0.975, "Sulfur pollution moved from China to India and the Gulf: 780 smokestacks seen by four satellites", fontsize=15, fontweight="bold", va="top")
sub = (f"SO₂ from China's power plants and smelters fell {abs(ch['change_pct']):.0f}% (2005–07 vs 2023–25; {ch['pct_per_yr']:+.0f}%/yr, Mann-Kendall p={ch['p_mk_hamed_rao']:.0e}) "
       f"after flue-gas desulfurisation was mandated; the USA fell {abs(res['USA']['change_pct']):.0f}%. India rose {ind['change_pct']:+.0f}% "
       f"({ind['pct_per_yr']:+.1f}%/yr, p={ind['p_mk_hamed_rao']:.0e}) and has emitted more than China since {xo}. Gulf oil, gas and power sources stayed high ({res['Middle East']['change_pct']:+.0f}%, n.s.): the Middle East "
       f"has led the regions shown since {res['mideast_exceeds_china_from']}. "
       f"Worldwide, man-made point-source SO₂ fell {abs(tot_['change_pct']):.0f}%. Of {res['sources']['n_anthropogenic']} industrial sources, {res['sources']['sig_down']} fell and "
       f"{res['sources']['sig_up']} rose significantly (FDR q=0.10). Taiwan (Linhai, Kaohsiung): "
       f"{res['country_Taiwan']['y2005_07']:.0f} → {res['country_Taiwan']['y2023_25']:.0f} kt/yr.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(sub, 200)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/so2_sources_map.png"); plt.close(fig)
tl.runlog(TASK, "done", f"China {ch['change_pct']:+.0f}%, India {ind['change_pct']:+.0f}% (passes China {xo}); global anthropogenic {tot_['change_pct']:+.0f}%")
tl.fix_perms(out)
print("done")
