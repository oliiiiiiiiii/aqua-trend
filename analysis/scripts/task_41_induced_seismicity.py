"""Task 41 - Human-made earthquakes: wastewater (produced-water) injection and the central-US seismicity boom.

Oil and gas wells bring up far more salty formation water than oil; it is disposed of by injecting it deep underground,
which raises pore pressure on faults. Here: USGS ComCat M>=3 (complete regionally since the 1980s), 1980-2025.
Regions: Oklahoma, Kansas (state polygons), Permian Basin (W Texas / SE New Mexico), Fort Worth Basin, Raton Basin,
and the New Madrid seismic zone as a natural (tectonic) control.
Stats: baseline rate 1980-2008 vs peak year (exact Poisson rate ratio), Pettitt change point, quasi-Poisson trends for
the boom (2009-peak), the post-regulation decline (Oklahoma, after the 2016 injection cuts) and the Permian rise (2017-2025).
"""
import sys
import numpy as np
import pandas as pd
import shapely
from shapely.ops import unary_union
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.shapereader as shp
import textwrap
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import seismo as sz  # noqa: E402

TASK = "41_induced_seismicity"
out = tl.task_dir(TASK)
SRC = "Data: USGS ComCat (ANSS) earthquakes M≥3, 1980–2025. State outlines: Natural Earth."
MMIN = 3.0
D = sz.load("cus_m25", MMIN)
D = D[D.time < "2026-01-01"].reset_index(drop=True)
D["year"] = D.time.dt.year
YRS = np.arange(1980, 2026)

states = {r.attributes["name"]: r.geometry for r in shp.Reader(shp.natural_earth("50m", "cultural", "admin_1_states_provinces")).records()
          if r.attributes.get("admin") == "United States of America"}
box = lambda a, b, c, d: shapely.box(a, c, b, d)
REG = {
    "Oklahoma": states["Oklahoma"],
    "Kansas": states["Kansas"],
    "Permian Basin (TX/NM)": box(-104.8, -101.0, 30.6, 33.3),
    "Fort Worth Basin (TX)": box(-98.3, -96.6, 32.2, 33.6),
    "Raton Basin (CO/NM)": box(-105.4, -104.2, 36.6, 37.7),
    "New Madrid (natural control)": box(-90.6, -88.9, 35.4, 37.5),
}
for nm, g in REG.items():
    D[nm] = shapely.contains_xy(g, D.lon.values, D.lat.values)

rows, series = [], {}
for nm in REG:
    d = D[D[nm]]
    s = d.groupby("year").size().reindex(YRS, fill_value=0)
    s4 = d[d.mag >= 4].groupby("year").size().reindex(YRS, fill_value=0)
    series[nm] = s
    base = s[(s.index >= 1980) & (s.index <= 2008)]
    pk = int(s.idxmax())
    rr = sz.rate_ratio(int(base.sum()), len(base), int(s[pk]), 1)
    k, K, pp = tl.pettitt(s.values.astype(float))
    big = d.loc[d.mag.idxmax()] if len(d) else None
    r = dict(region=nm, n_total=int(len(d)), baseline_per_yr_1980_2008=float(base.mean()), peak_year=pk, peak_count=int(s[pk]),
             peak_vs_baseline=rr["ratio"], peak_vs_baseline_lo=rr["lo"], peak_p=rr["p"], pettitt_change_after=int(YRS[k]), pettitt_p=float(pp),
             m4_total=int(s4.sum()), m4_peak_year=int(s4.idxmax()), m4_peak=int(s4.max()),
             largest_mag=float(big.mag) if big is not None else np.nan, largest_year=int(big.time.year) if big is not None else None,
             largest_place=str(big.place) if big is not None else "", last5_per_yr=float(s[s.index >= 2021].mean()))
    if pk >= 2010 and pk <= 2022 and s[pk] >= 20:
        up = s[(s.index >= 2009) & (s.index <= pk)]
        if len(up) >= 4:
            r["boom_trend"] = sz.rate_trend(up.index.values, up.values)
        dn = s[s.index >= pk]
        if len(dn) >= 5:
            r["decline_trend"] = sz.rate_trend(dn.index.values, dn.values)
        if "decline_trend" in r:
            b_ = np.log(1 + r["decline_trend"]["pct_per_decade"] / 100) / 10
            r["halving_time_yr"] = float(np.log(2) / -b_) if b_ < 0 else None
    if nm.startswith("Permian"):
        rise = s[(s.index >= 2017) & (s.index <= 2022)]
        r["rise_2017_2022"] = sz.rate_trend(rise.index.values, rise.values)
        r["doubling_time_yr"] = float(np.log(2) / np.log(1 + r["rise_2017_2022"]["pct_per_decade"] / 100) * 10)
        r["after_limits_2025_vs_2022"] = sz.rate_ratio(int(s[2022]), 1, int(s[2025]), 1)
    if nm.startswith("New Madrid"):
        r["trend_1980_2025"] = sz.rate_trend(YRS, s.values)
    rows.append(r)
    print({kk: (round(v, 3) if isinstance(v, float) else v) for kk, v in r.items() if not isinstance(v, dict)}, flush=True)
    for kk in ("boom_trend", "decline_trend", "rise_2017_2022", "trend_1980_2025"):
        if kk in r:
            print(f"   {kk}: {r[kk]['pct_per_decade']:+.0f}%/dec p={r[kk]['p']:.2g}", flush=True)
res = dict(min_mag=MMIN, regions=rows)
# share of all M>=3 central-US quakes 2009-2025 in Oklahoma+Kansas+Permian
tot = D[(D.year >= 2009)]
res["share_ok_ks_permian_2009_2025"] = float(tot[tot["Oklahoma"] | tot["Kansas"] | tot["Permian Basin (TX/NM)"]].shape[0] / len(tot))
print("share of box M>=3 since 2009 in OK+KS+Permian:", round(res["share_ok_ks_permian_2009_2025"], 3), flush=True)

# ---------------------------------------------------------------- figure 1: three eras map
EXT = [-106.5, -93.0, 29.0, 38.6]
eras = [(1990, 2008, "Before the boom"), (2014, 2016, "Oklahoma's peak"), (2022, 2025, "Today: the Permian Basin")]
fig = plt.figure(figsize=(14, 5.5), dpi=180)
for k, (a, b, ttl) in enumerate(eras):
    ax = fig.add_axes([0.01 + k * 0.33, 0.05, 0.32, 0.72], projection=ccrs.PlateCarree())
    ax.set_extent(EXT, ccrs.PlateCarree())
    ax.add_feature(cfeature.LAND.with_scale("50m"), facecolor="#f1f0eb")
    ax.add_feature(cfeature.STATES.with_scale("50m"), linewidth=0.5, edgecolor=viz.MUTED)
    ax.add_feature(cfeature.BORDERS.with_scale("50m"), linewidth=0.6, edgecolor=viz.INK2)
    ax.add_feature(cfeature.COASTLINE.with_scale("50m"), linewidth=0.5, edgecolor=viz.INK2)
    e = D[(D.year >= a) & (D.year <= b)].sort_values("mag")
    ax.scatter(e.lon, e.lat, s=3 + (e.mag - 2.8) ** 2.5 * 12, color=viz.RED_ARM[2], alpha=0.55, linewidths=0.2, edgecolors="white",
               transform=ccrs.PlateCarree(), zorder=3)
    n_yr = len(e[(e.lon > EXT[0]) & (e.lon < EXT[1]) & (e.lat > EXT[2]) & (e.lat < EXT[3])]) / (b - a + 1)
    ax.set_title(f"{ttl}, {a}–{b}\n{n_yr:,.0f} quakes M≥3 per year", fontsize=11, loc="left", color=viz.INK)
    for nm, (x, y) in {"OK": (-97.6, 35.6), "KS": (-98.5, 38.2), "TX": (-99.5, 31.2), "NM": (-106.0, 34.5)}.items():
        ax.text(x, y, nm, fontsize=8, color=viz.MUTED, transform=ccrs.PlateCarree(), ha="center")
for m in (3, 4, 5):
    fig.axes[0].scatter([], [], s=3 + (m - 2.8) ** 2.5 * 12, color=viz.RED_ARM[2], alpha=0.6, label=f"M{m}")
fig.axes[0].legend(loc="lower left", frameon=True, fontsize=8, framealpha=0.9, edgecolor="none", title="magnitude", title_fontsize=8)
ok = {r["region"]: r for r in rows}
fig.text(0.01, 0.965, "Human-made earthquakes: the wastewater boom moved from Oklahoma to West Texas", fontsize=15, fontweight="bold", va="top")
sub = (f"Oil and gas wells bring up salty ‘produced water’ that is injected deep underground, raising pressure on faults. Oklahoma went from "
       f"{ok['Oklahoma']['baseline_per_yr_1980_2008']:.1f} M≥3 quakes a year (1980–2008) to {ok['Oklahoma']['peak_count']} in {ok['Oklahoma']['peak_year']}, then fell "
       f"after injection cuts in 2016; the Permian Basin is now the hotspot.")
fig.text(0.01, 0.91, "\n".join(textwrap.wrap(sub, 190)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.99, 0.015, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/map_three_eras.png"); plt.close(fig)

# ---------------------------------------------------------------- figure 2: annual counts small multiples
fig, axs = plt.subplots(2, 3, figsize=(13, 7.4), dpi=170)
fig.subplots_adjust(left=0.06, right=0.98, top=0.80, bottom=0.08, hspace=0.45, wspace=0.2)
for ax, nm in zip(axs.ravel(), REG):
    s = series[nm]; r = ok[nm]
    ctrl = "control" in nm
    ax.bar(s.index, s.values, width=0.8, color=viz.BLUE_ARM[2] if ctrl else viz.RED_ARM[2], linewidth=0)
    ax.set_title(nm, fontsize=10.5, loc="left", fontweight="bold", color=viz.INK)
    if ctrl:
        t = r["trend_1980_2025"]
        lab = f"natural seismicity: steady\n{r['baseline_per_yr_1980_2008']:.1f}/yr before 2009, {r['last5_per_yr']:.1f}/yr 2021–25\n(trend p={t['p']:.2f})"
    else:
        lab = (f"{r['baseline_per_yr_1980_2008']:.1f}/yr in 1980–2008 → {r['peak_count']} in {r['peak_year']}\n"
               f"(×{r['peak_vs_baseline']:,.0f}); largest M{r['largest_mag']:.1f} in {r['largest_year']}")
        if r.get("halving_time_yr") and nm == "Oklahoma":
            lab += f"\nafter the cuts: halving every {r['halving_time_yr']:.1f} yr"
        if "rise_2017_2022" in r:
            a_ = r["after_limits_2025_vs_2022"]
            lab += (f"\n2017–22: doubling every {r['doubling_time_yr']:.1f} yr; 2025 vs 2022:\n"
                    f"{(a_['ratio'] - 1) * 100:+.0f}% (p={a_['p']:.0e})")
    ax.text(0.02, 0.97, lab, transform=ax.transAxes, fontsize=8.3, va="top", color=viz.INK2)
    ax.set_ylim(0, max(s.max() * 1.6, 5))
    for sp in ("top", "right", "left"):
        ax.spines[sp].set_visible(False)
    ax.grid(axis="y", color=viz.GRID, lw=0.6); ax.set_axisbelow(True); ax.tick_params(length=0, labelsize=8.5)
    ax.set_xlim(1979, 2026)
ax = axs[0, 0]
ax.axvline(2016, color=viz.INK2, lw=0.8, ls=":")
ax.text(2016.4, ax.get_ylim()[1] * 0.45, "2016: state orders\ninjection cuts", fontsize=7.5, color=viz.INK2)
ax = axs[0, 2]
ax.axvline(2021.7, color=viz.INK2, lw=0.8, ls=":")
ax.text(2021.2, ax.get_ylim()[1] * 0.50, "late 2021: Texas\nseismic response\nareas", fontsize=7.5, color=viz.INK2, ha="right")
axs[0, 0].set_ylabel("earthquakes M≥3 per year", color=viz.INK2); axs[1, 0].set_ylabel("earthquakes M≥3 per year", color=viz.INK2)
fig.text(0.06, 0.965, "Where we inject wastewater, the ground shakes; where we don't, nothing changed", fontsize=15, fontweight="bold", va="top")
sub = (f"Annual counts of M≥3 earthquakes. Every oil- and gas-wastewater region steps up (Pettitt p ≤ 0.01: Raton Basin from "
       f"{ok['Raton Basin (CO/NM)']['pettitt_change_after'] + 1}, Oklahoma from {ok['Oklahoma']['pettitt_change_after'] + 1}, Kansas from "
       f"{ok['Kansas']['pettitt_change_after'] + 1}), while the naturally active New Madrid zone stays flat (p = {ok['New Madrid (natural control)']['trend_1980_2025']['p']:.2f}). Oklahoma, Kansas and the Permian Basin hold "
       f"{res['share_ok_ks_permian_2009_2025']:.0%} of all M≥3 quakes in the south-central US since 2009.")
fig.text(0.06, 0.915, "\n".join(textwrap.wrap(sub, 175)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/induced_counts.png"); plt.close(fig)

pd.DataFrame(series).to_csv(f"{out}/annual_counts_m3.csv")
tl.save_json(res, f"{out}/stats.json")
tl.runlog(TASK, "done", f"Oklahoma {ok['Oklahoma']['baseline_per_yr_1980_2008']:.1f}/yr -> {ok['Oklahoma']['peak_count']} ({ok['Oklahoma']['peak_year']}); "
          f"Permian 2017-22 doubling {ok['Permian Basin (TX/NM)'].get('doubling_time_yr', float('nan')):.1f} yr; New Madrid flat")
tl.fix_perms(out)
print("done")
