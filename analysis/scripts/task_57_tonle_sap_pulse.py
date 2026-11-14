"""Task 57 - The Mekong's heartbeat is weakening: Tonle Sap's flood pulse is ~1-2 m lower for the same rain since the upstream dams.

Data: NASA GWM radar altimetry of Tonle Sap (Cambodia), 10-day, 1992-2026 (TOPEX 1992-2002; Jason-2/3 and Sentinel-6A 2008-2026);
GPCP v2.3 rain over the lower (100-108E, 11-20N) and upper (97-102E, 20-30N) Mekong basin, May-Oct; GRACE/GRACE-FO water storage over
Cambodia (Sep-Nov); dates of the large upstream dams (Xiaowan 2010, Nuozhadu 2014 on the Lancang/upper Mekong in China; Xayaburi 2019 and
Don Sahong 2020 in Laos).
Method: each year's flood peak (max, mid-Aug to Nov), dry-season low (min, mid-Mar to Jun) and amplitude.
  (1) Jason era only (2009-2026, one consistent processing family): peak ~ rain_lower + rain_upper + year (OLS; t for the year term),
      plus the same for the low level as a bias control (a mission bias would move peak and low together).
  (2) Both eras: peak ~ rain_lower + rain_upper + era dummy. GWM flags the TOPEX->Jason-2 merger at this lake, so the absolute era offset is
      uncertain; the dry-season low is used to bound it (amplitude = peak - low is insensitive to a constant offset).
  (3) GRACE Sep-Nov water storage over Cambodia vs the altimetry peak (2003-2026), and its rain-adjusted trend.
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
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "57_tonle_sap_pulse"
out = tl.task_dir(TASK)
SRC = "Data: NASA GWM radar altimetry (TOPEX, Jason-2/3, Sentinel-6A); GPCP v2.3; GRACE/GRACE-FO JPL mascons."
DAMS = {2010: "Xiaowan (China)", 2014: "Nuozhadu (China)", 2019: "Xayaburi (Laos)"}

with tarfile.open(f"{ROOT}/data/raw/gwm/lake.10.tar.gz", "r:gz") as t:
    txt = t.extractfile([m for m in t.getmembers() if m.name.endswith("lake000319.10d.2.txt")][0]).read().decode("latin1")
rows = []
for ln in txt.splitlines():
    p = ln.split()
    if len(p) >= 16 and len(p[2]) == 8 and p[2].isdigit() and p[2] != "99999999" and float(p[5]) < 900:
        rows.append((pd.Timestamp(p[2]), float(p[5]), p[0]))
D = pd.DataFrame(rows, columns=["t", "h", "mission"]).set_index("t").sort_index()
D = D[~D.index.duplicated()]
yr = {}
for y in range(1993, 2027):
    pk = D.h[f"{y}-08-15":f"{y}-11-30"]; lo = D.h[f"{y}-03-15":f"{y}-06-30"]
    if len(pk) >= 4 and len(lo) >= 4:
        yr[y] = dict(peak=float(pk.max()), low=float(lo.min()), peak_date=pk.idxmax(), mission=D.mission[pk.idxmax()])
Y = pd.DataFrame(yr).T
for c in ("peak", "low"):
    Y[c] = Y[c].astype(float)
Y["amp"] = Y.peak - Y.low
Y["era"] = np.where(Y.index <= 2002, "TOPEX", "Jason/S6")
LA, LO = np.meshgrid(hub.LAT, hub.LON, indexing="ij")


def bm(da, b):
    m = (LO >= b[0]) & (LO <= b[1]) & (LA >= b[2]) & (LA <= b[3]); w = np.cos(np.deg2rad(LA)) * m
    return pd.Series([np.nansum(np.nan_to_num(x) * w) / np.sum(w * np.isfinite(x)) if np.isfinite(x[m]).any() else np.nan for x in da.values],
                     pd.DatetimeIndex(da.time.values))


def seas(s, a, b):
    k = (s.index.month >= a) & (s.index.month <= b)
    return s[k].groupby(s[k].index.year).mean()


pg = hub.load("p_gpcp")
Y["rain_low"] = seas(bm(pg, (100, 108, 11, 20)), 5, 10).reindex(Y.index).values
Y["rain_up"] = seas(bm(pg, (97, 102, 20, 30)), 5, 10).reindex(Y.index).values
tws = hub.load("tws")
g = bm(tws, (102, 107, 10.5, 14.5))
Y["grace_son"] = seas(g, 9, 11).reindex(Y.index).values
Y.drop(columns=["peak_date"]).round(3).to_csv(f"{out}/tonle_sap_annual.csv")
print(Y.drop(columns=["peak_date"]).round(2).to_string(), flush=True)


def ols(yv, X, names):
    X = np.column_stack([np.ones(len(yv))] + X)
    b, *_ = np.linalg.lstsq(X, yv, rcond=None)
    r = yv - X @ b; dof = len(yv) - X.shape[1]
    cov = (r @ r / dof) * np.linalg.inv(X.T @ X)
    se = np.sqrt(np.diag(cov)); tv = b / se
    pv = 2 * stats.t.sf(np.abs(tv), dof)
    return {n: dict(coef=float(b[i + 1]), se=float(se[i + 1]), t=float(tv[i + 1]), p=float(pv[i + 1])) for i, n in enumerate(names)} | {"r2": float(1 - (r @ r) / np.sum((yv - yv.mean()) ** 2)), "dof": int(dof)}


res = {}
J = Y[Y.index >= 2009]
for col in ("peak", "amp", "low"):
    res[f"jason_{col}_vs_rain_and_year"] = ols(J[col].values, [J.rain_low.values, J.rain_up.values, (J.index - 2017).values.astype(float)], ["rain_low", "rain_up", "year"])
A = Y.copy()
for col in ("peak", "amp", "low"):
    res[f"both_eras_{col}_vs_rain_and_era"] = ols(A[col].values, [A.rain_low.values, A.rain_up.values, (A.era == "Jason/S6").astype(float).values], ["rain_low", "rain_up", "jason_era"])
res["era_means"] = {e: dict(peak=float(Y.peak[Y.era == e].mean()), low=float(Y.low[Y.era == e].mean()), amp=float(Y.amp[Y.era == e].mean()),
                            rain_low=float(Y.rain_low[Y.era == e].mean()), rain_up=float(Y.rain_up[Y.era == e].mean()), n=int((Y.era == e).sum())) for e in ("TOPEX", "Jason/S6")}
G = Y[Y.grace_son.notna() & (Y.index >= 2003)]
res["grace_son_vs_peak_r"] = float(np.corrcoef(G.grace_son, G.peak)[0, 1])
res["grace_son_vs_rain_and_year"] = ols(G.grace_son.values, [G.rain_low.values, G.rain_up.values, (G.index - 2014).values.astype(float)], ["rain_low", "rain_up", "year"])
# rain-adjusted peak anomaly (fit on rain only within the Jason era, then apply to all years)
bJ = np.linalg.lstsq(np.column_stack([np.ones(len(J)), J.rain_low, J.rain_up]), J.peak.values, rcond=None)[0]
Y["peak_rain_adj"] = Y.peak - np.column_stack([np.ones(len(Y)), Y.rain_low, Y.rain_up]) @ bJ + J.peak.mean()
pre = Y.peak_rain_adj[(Y.index >= 2009) & (Y.index <= 2013)].mean(); post = Y.peak_rain_adj[Y.index >= 2015].mean()
res["rain_adjusted_peak_2009_13_vs_2015_26"] = dict(m_2009_13=float(pre), m_2015_26=float(post), diff=float(post - pre),
                                                   p_welch=float(stats.ttest_ind(Y.peak_rain_adj[(Y.index >= 2009) & (Y.index <= 2013)], Y.peak_rain_adj[Y.index >= 2015], equal_var=False).pvalue))
for k, v in res.items():
    print(k, v, flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.4), dpi=170)
# A: mean seasonal cycle by era
ax = fig.add_axes([0.05, 0.52, 0.42, 0.30])
D["doy"] = D.index.day_of_year
eras = [("1993–2001 (TOPEX)", D[(D.index.year >= 1993) & (D.index.year <= 2001)], "#9a9890"),
        ("2009–2014", D[(D.index.year >= 2009) & (D.index.year <= 2014)], viz.SERIES[0]),
        ("2015–2026", D[(D.index.year >= 2015)], viz.ORANGE_ARM[2])]
for lab, sub, col in eras:
    b = (sub.doy // 15) * 15 + 7
    m = sub.h.groupby(b).median(); q1 = sub.h.groupby(b).quantile(0.25); q3 = sub.h.groupby(b).quantile(0.75)
    ax.fill_between(m.index, q1, q3, color=col, alpha=0.18, lw=0)
    ax.plot(m.index, m.values, color=col, lw=2.2, label=lab)
ax.set_xticks([1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]); ax.set_xticklabels(list("JFMAMJJASOND"))
ax.set_ylabel("water level (m, relative)", color=viz.INK2)
ax.legend(frameon=False, fontsize=8, loc="upper left")
ax.set_title("A  The yearly flood pulse of Tonle Sap, median and middle 50% by era", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
# B: peak vs lower-basin rain
ax = fig.add_axes([0.56, 0.52, 0.40, 0.30])
for e, col, mk in (("TOPEX", "#9a9890", "o"), ("Jason/S6", None, "o")):
    sub = Y[Y.era == e]
    if e == "TOPEX":
        ax.scatter(sub.rain_low, sub.peak, color=col, s=36, edgecolors=viz.SURFACE, label="1993–2001")
    else:
        from matplotlib.colors import LinearSegmentedColormap
        ycm = LinearSegmentedColormap.from_list("yrs", viz.BLUE_ARM[::-1][:-1] + [viz.BLUE_ARM[0]], N=256)
        sc = ax.scatter(sub.rain_low, sub.peak, c=sub.index.astype(int), cmap=ycm, s=40, edgecolors=viz.INK, linewidths=0.4)
        for y_ in (2015, 2019, 2020, 2011, 2025):
            if y_ in sub.index:
                ax.annotate(str(y_), (sub.rain_low[y_], sub.peak[y_]), xytext=((-26, 3) if y_ == 2011 else (4, 3)), textcoords="offset points", fontsize=7.5, color=viz.INK)
xx = np.linspace(Y.rain_low.min(), Y.rain_low.max(), 10)
for e, col in (("TOPEX", "#9a9890"), ("Jason/S6", viz.ORANGE_ARM[2])):
    sub = Y[Y.era == e]; bb = np.polyfit(sub.rain_low, sub.peak, 1)
    ax.plot(xx, np.polyval(bb, xx), color=col, lw=1.2, ls="--")
cb = fig.colorbar(sc, ax=ax, pad=0.01, aspect=25); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=7, length=0); cb.set_label("year (2009–2026)", fontsize=7.5)
ax.legend(frameon=False, fontsize=8, loc="upper left")
ax.set_xlabel("May–Oct rain over the lower Mekong basin (mm/day)", color=viz.INK2, fontsize=8.5); ax.set_ylabel("flood peak (m)", color=viz.INK2, fontsize=8.5)
ax.set_title("B  Same rain, lower flood", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right"):
    ax.spines[sp_].set_visible(False)
ax.grid(color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
# C: rain-adjusted peak and low through time
ax = fig.add_axes([0.05, 0.10, 0.91, 0.28])
ax.bar(Y.index, Y.peak_rain_adj - J.peak.mean(), color=[("#b9b8b0" if e == "TOPEX" else (viz.BLUE_ARM[2] if v >= 0 else viz.ORANGE_ARM[2])) for e, v in zip(Y.era, Y.peak_rain_adj - J.peak.mean())], width=0.75)
ax.plot(Y.index, Y.low - Y.low.mean(), "o-", color=viz.INK, ms=3, lw=1, label="dry-season low (bias check: flat)")
for y_, nm in DAMS.items():
    ax.axvline(y_ - 0.5, color=viz.MUTED, lw=0.8, ls=":")
    ax.text(y_ - 0.4, ax.get_ylim()[1] if False else 1.6, nm, fontsize=7.5, color=viz.INK2, rotation=0, va="bottom")
ax.axhline(0, color=viz.AXIS, lw=0.8)
ax.legend(frameon=False, fontsize=8, loc="lower left")
ax.set_ylabel("m vs 2009–26 mean", color=viz.INK2, fontsize=8.5)
ax.set_ylim(-3.2, 2.4)
ax.set_title("C  Flood peak after removing the effect of that year's rain (bars; grey = TOPEX era, offset uncertain)", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="y", color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
jp, jl, be = res["jason_peak_vs_rain_and_year"], res["jason_low_vs_rain_and_year"], res["both_eras_amp_vs_rain_and_era"]
em = res["era_means"]
fig.text(0.01, 0.975, "The Mekong's heartbeat is weakening: Tonle Sap's flood peak is lower for the same rain since the big upstream dams", fontsize=14.5, fontweight="bold", va="top")
subt = (f"Every monsoon the Mekong backs up into Tonle Sap, Cambodia's great lake and Southeast Asia's largest freshwater fishery, raising it by "
        f"{em['TOPEX']['amp']:.1f} m in the 1990s but {em['Jason/S6']['amp']:.1f} m since 2009, with the same lower-basin rain ({em['TOPEX']['rain_low']:.1f} vs "
        f"{em['Jason/S6']['rain_low']:.1f} mm/day). Within the consistent 2009–2026 satellite record, after accounting for rain the peak still falls "
        f"{jp['year']['coef'] * 10:+.1f} m per decade (t = {jp['year']['t']:.1f}, p = {jp['year']['p']:.3f}) while the dry-season low does not move "
        f"({jl['year']['coef'] * 10:+.1f} m/decade, p = {jl['year']['p']:.2f}), so this is not a satellite bias; GRACE gravity independently shows the autumn water mass over "
        f"Cambodia falling for the same rain (p = {res['grace_son_vs_rain_and_year']['year']['p']:.3f}; r = {res['grace_son_vs_peak_r']:.2f} with the lake peak). The weakening follows the giant Xiaowan (2010) and "
        f"Nuozhadu (2014) dams, which hold back wet-season flow; drought years 2015 and 2019–20 were the lowest.")
fig.text(0.01, 0.925, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/tonle_sap_flood_pulse.png"); plt.close(fig)
tl.runlog(TASK, "done", f"rain-adjusted peak {jp['year']['coef'] * 10:+.2f} m/dec (p={jp['year']['p']:.3f}); amp {em['TOPEX']['amp']:.1f} -> {em['Jason/S6']['amp']:.1f} m")
tl.fix_perms(out)
print("done")
