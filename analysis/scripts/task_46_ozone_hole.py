"""Task 46 - Is the Antarctic ozone hole healing? NASA Ozone Watch (TOMS + OMI + OMPS), 1979-2026.

Metrics per year (Ozone Watch conventions): mean hole area 7 Sep - 13 Oct (area < 220 DU), mean daily minimum ozone 21 Sep - 16 Oct,
and the date the hole closes (area falls below 1 million km2 after the peak).
Tests: piecewise ("hockey-stick") regression with a hinge searched over 1993-2008 vs a single line (F-test);
post-2001 slope with AR(1)-OLS and Mann-Kendall; years 2020-2023 flagged (persistent vortex, Hunga Tonga eruption water vapour,
Australian smoke) as a sensitivity test.
"""
import sys
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

TASK = "46_ozone_hole"
out = tl.task_dir(TASK)
SRC = "Data: NASA Ozone Watch (TOMS 1979–2004, OMI 2005–, OMPS), daily Antarctic ozone-hole area and minimum ozone."


def read(kind, y):
    f = f"{ROOT}/data/raw/ozone/to3{kind}_{y}.txt"
    if not _os.path.exists(f):
        return None
    d = pd.read_csv(f, sep=r"\s+", skiprows=6, header=None, usecols=[0, 1], names=["date", "v"])
    d["date"] = pd.to_datetime(d.date, errors="coerce")
    d = d.dropna().set_index("date").v
    return d.where(d > -9000)


rows = []
for y in range(1979, 2027):
    a = read("areas", y); m = read("mins", y)
    if a is None:
        continue
    A = a[f"{y}-09-07":f"{y}-10-13"]; M = m[f"{y}-09-21":f"{y}-10-16"] if m is not None else pd.Series(dtype=float)
    if A.notna().sum() < 20:
        continue
    pk = a[f"{y}-08-01":f"{y}-12-31"].idxmax()
    after = a[pk:f"{y}-12-31"]
    close = after[after < 1.0].index.min() if (after < 1.0).any() else pd.NaT
    rows.append(dict(year=y, area_mean=float(A.mean()), area_max=float(a[f"{y}-08-01":f"{y}-12-31"].max()), min_ozone=float(M.mean()),
                     close_doy=float(close.day_of_year) if pd.notna(close) else np.nan))
df = pd.DataFrame(rows).set_index("year")
df.to_csv(f"{out}/ozone_hole_annual.csv")
print(df.round(1).tail(12).to_string(), flush=True)


def hinge_fit(s, hinges=range(1985, 2011)):
    x = s.index.values.astype(float); yv = s.values
    X1 = np.column_stack([np.ones_like(x), x]); b1, rss1 = np.linalg.lstsq(X1, yv, rcond=None)[:2]
    best = None
    for h in hinges:
        X2 = np.column_stack([np.ones_like(x), np.minimum(x, h), np.maximum(x - h, 0)])
        b2, rss2 = np.linalg.lstsq(X2, yv, rcond=None)[:2]
        if best is None or rss2[0] < best[1]:
            best = (h, rss2[0], b2)
    h, rss2, b2 = best
    n = len(x); F = ((rss1[0] - rss2) / 2) / (rss2 / (n - 4))
    return dict(hinge=int(h), slope_before=float(b2[1]), slope_after=float(b2[2]),
                F=float(F), p_vs_line=float(stats.f.sf(F, 2, n - 4)))


res = {}
for col, unit in (("area_mean", "million km²"), ("min_ozone", "DU"), ("close_doy", "day of year")):
    s = df[col].dropna()
    hf = hinge_fit(s)
    post = s.loc[2001:2026]
    st = tl.series_trend(pd.Series(post.values, index=pd.to_datetime([f"{y}-10-01" for y in post.index])), col, unit, deseasonalize=False)
    ex = post.drop([y for y in (2020, 2021, 2022, 2023) if y in post.index])
    st_ex = tl.series_trend(pd.Series(ex.values, index=pd.to_datetime([f"{y}-10-01" for y in ex.index])), col, unit, deseasonalize=False)
    pre = s.loc[:2000]
    res[col] = dict(hinge=hf, post2001_slope_per_decade=st["slope_per_decade"], post2001_p=st["p_ols_ar1"], post2001_mk_p=st["mk_annual_p"],
                    post2001_excl_2020_23_slope=st_ex["slope_per_decade"], post2001_excl_2020_23_p=st_ex["p_ols_ar1"],
                    pre2000_slope_per_decade=float(np.polyfit(pre.index, pre.values, 1)[0] * 10),
                    mean_1979_1983=float(s.loc[1979:1983].mean()), mean_2000_2006=float(s.loc[2000:2006].mean()), mean_2021_2025=float(s.loc[2021:2025].mean()))
    print(col, {k: (round(v, 3) if isinstance(v, float) else v) for k, v in res[col].items()}, flush=True)
res["largest_area_years"] = df.area_mean.sort_values(ascending=False).head(5).round(1).to_dict()
res["latest"] = df.iloc[-1].to_dict(); res["latest_year"] = int(df.index[-1])
tl.save_json(res, f"{out}/stats.json")

fig, axs = plt.subplots(1, 2, figsize=(13, 5.4), dpi=170)
fig.subplots_adjust(left=0.06, right=0.98, top=0.76, bottom=0.11, wspace=0.22)
for ax, col, ttl, unit in ((axs[0], "area_mean", "Hole area, 7 Sep – 13 Oct mean", "million km²"), (axs[1], "min_ozone", "Lowest ozone, 21 Sep – 16 Oct mean", "Dobson units")):
    s = df[col].dropna(); hf = res[col]["hinge"]
    ax.bar(s.index, s.values, color=[viz.ORANGE_ARM[2] if y in (2020, 2021, 2022, 2023) else viz.BLUE_ARM[2] for y in s.index], width=0.8)
    x = np.arange(s.index.min(), s.index.max() + 1)
    X2 = np.column_stack([np.ones_like(x), np.minimum(x, hf["hinge"]), np.maximum(x - hf["hinge"], 0)])
    b = np.linalg.lstsq(np.column_stack([np.ones(len(s)), np.minimum(s.index, hf["hinge"]), np.maximum(s.index - hf["hinge"], 0)]), s.values, rcond=None)[0]
    ax.plot(x, X2 @ b, color=viz.INK, lw=1.8)
    r = res[col]
    ax.set_title(ttl, fontsize=10.5, loc="left", fontweight="bold", color=viz.INK)
    ax.text(0.02, 0.97, f"hinge {hf['hinge']} (vs straight line p={hf['p_vs_line']:.0e})\nsince 2001: {r['post2001_slope_per_decade']:+.2f} {unit}/decade "
            f"(p={r['post2001_p']:.2f}); without 2020–23: {r['post2001_excl_2020_23_slope']:+.2f} (p={r['post2001_excl_2020_23_p']:.2f})",
            transform=ax.transAxes, fontsize=8.3, va="top", color=viz.INK2)
    ax.set_ylabel(unit, color=viz.INK2)
    ax.set_ylim(0, s.max() * 1.3)
    for sp_ in ("top", "right", "left"):
        ax.spines[sp_].set_visible(False)
    ax.grid(axis="y", color=viz.GRID, lw=0.6); ax.set_axisbelow(True); ax.tick_params(length=0, labelsize=8.5)
fig.text(0.06, 0.965, "The ozone hole stopped growing in the 1990s, but healing is still hidden in the noise", fontsize=15, fontweight="bold", va="top")
a_ = res["area_mean"]
sub = (f"Antarctic ozone-hole area grew {a_['hinge']['slope_before'] * 10:+.0f} million km²/decade until {a_['hinge']['hinge']} (the Montreal Protocol was signed in 1987); "
       f"a hinged fit beats a straight line (p={a_['hinge']['p_vs_line']:.0e}). Since then it has levelled off: {a_['mean_2000_2006']:.1f} million km² in 2000–06 vs "
       f"{a_['mean_2021_2025']:.1f} in 2021–25, and {df.area_mean.iloc[-1]:.1f} in {df.index[-1]}. Orange: 2020–23, years with an unusually "
       f"stable polar vortex, the Hunga Tonga eruption's water vapour and Australian fire smoke. Recovery is detectable as a break in the trend, not yet as a clear decline.")
fig.text(0.06, 0.915, "\n".join(textwrap.wrap(sub, 175)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/ozone_hole_hinge.png"); plt.close(fig)
tl.runlog(TASK, "done", f"area hinge {res['area_mean']['hinge']['hinge']} p={res['area_mean']['hinge']['p_vs_line']:.1e}; post-2001 {res['area_mean']['post2001_slope_per_decade']:+.2f} Mkm2/dec p={res['area_mean']['post2001_p']:.2f}")
tl.fix_perms(out)
print("done")
