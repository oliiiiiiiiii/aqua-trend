"""Task 09 - Sea ice extent trends (NSIDC Sea Ice Index v4, 1978-2026), Arctic & Antarctic."""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import glob
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402

TASK = "09_sea_ice"
out = tl.task_dir(TASK)
SRC = "Data: NSIDC Sea Ice Index v4 (G02135), passive microwave. Analysis: OLS+AR(1), Mann-Kendall."

frames = []
for f in sorted(glob.glob(ROOT + "/data/raw/nsidc/*_extent_v4.0.csv")):
    d = pd.read_csv(f, skipinitialspace=True)
    d.columns = [c.strip() for c in d.columns]
    frames.append(d)
df = pd.concat(frames)
df = df[(df["extent"] > 0) & (df["year"] >= 1979)]
df["date"] = pd.to_datetime(dict(year=df["year"], month=df["mo"], day=1))
stats = {}
series = {}
for hem, H in (("Arctic", "N"), ("Antarctic", "S")):
    s = df[df["region"].str.strip() == H].set_index("date")["extent"].sort_index()
    s = s[~s.index.duplicated()]
    s = s.reindex(pd.date_range("1979-01-01", s.index.max(), freq="MS"))
    series[hem] = s
    clim = s["1981":"2010"].groupby(s["1981":"2010"].index.month).mean()
    anom = s - clim.reindex(s.index.month).values
    pct = 100 * anom / clim.reindex(s.index.month).values
    series[hem + "_pct"] = pct
    # per calendar month trend in %/decade relative to 1981-2010
    per_month = {}
    for m in range(1, 13):
        sm = s[s.index.month == m].dropna()
        st = tl.series_trend(sm, f"{hem} month {m}", "Mkm2", deseasonalize=False)
        st["pct_per_decade_vs_1981_2010"] = 100 * st["slope_per_decade"] / clim[m]
        per_month[m] = st
    stats[hem] = dict(all_months=tl.series_trend(s, hem, "million km²"), per_month=per_month)
    for a, b in (("1979", "2015-12"), ("2016", "2026-12")):
        stats[hem][f"segment_{a}_{b[:4]}"] = tl.series_trend(s, hem, "million km²", start=a, end=b)

# --- prints ---
for hem in ("Arctic", "Antarctic"):
    st = stats[hem]["all_months"]
    print(f"{hem}: {st['slope_per_decade']:+.3f} ± {st['ci95_per_decade']:.3f} Mkm2/decade p={st['p_ols_ar1']:.2g} {st['verdict']}")
    for m in (2, 3, 9):
        pm = stats[hem]["per_month"][m]
        print(f"   month {m}: {pm['pct_per_decade_vs_1981_2010']:+.1f}%/decade  p={pm['p_ols_ar1']:.2g} MK={pm['mk_hr_p']:.2g}")
    for k in ("segment_1979_2015", "segment_2016_2026"):
        sg = stats[hem][k]
        print(f"   {k}: {sg['slope_per_decade']:+.3f} ± {sg['ci95_per_decade']:.3f} Mkm2/dec p={sg['p_ols_ar1']:.2g} {sg['verdict']}")
for hem in ("Arctic", "Antarctic"):
    s_ = series[hem]; c_ = s_["1981":"2010"].groupby(s_["1981":"2010"].index.month).mean()
    a_ = (s_ - c_.reindex(s_.index.month).values).dropna()
    k, K, p = tl.pettitt(a_.values)
    stats[hem]["pettitt_monthly_anomaly"] = dict(change_month=str(a_.index[k + 1].date()), p=p)
    print(f"{hem} Pettitt change point (monthly anomalies): {a_.index[k+1].date()} p={p:.2g}")
tl.save_json(stats, f"{out}/stats.json")
pd.DataFrame(series).to_csv(f"{out}/sea_ice_extent_series.csv")

# --- figure 1: anomaly stripes heatmap (year x month), % vs 1981-2010 ---
for hem in ("Arctic", "Antarctic"):
    pct = series[hem + "_pct"]
    tab = pct.groupby([pct.index.year, pct.index.month]).mean().unstack()
    fig, ax = plt.subplots(figsize=(11, 5.2), dpi=180)
    fig.subplots_adjust(left=0.07, right=0.97, top=0.82, bottom=0.24)
    vmax = 30 if hem == "Arctic" else 20
    im = ax.imshow(tab.T.values, aspect="auto", cmap=viz.div_cmap("bluered"), vmin=-vmax, vmax=vmax,
                   extent=[tab.index.min() - 0.5, tab.index.max() + 0.5, 12.5, 0.5], interpolation="nearest")
    ax.set_yticks(range(1, 13)); ax.set_yticklabels(list("JFMAMJJASOND"))
    for sp in ax.spines.values():
        sp.set_visible(False)
    ax.tick_params(length=0)
    fig.text(0.07, 0.965, f"{hem} sea ice: every month of every year since 1979", fontsize=14, fontweight="bold", va="top")
    sub = ("Extent anomaly vs 1981–2010 for the same calendar month. Red = less ice. "
           + ("Steady decline in all seasons; September falls fastest." if hem == "Arctic"
              else "Slow, significant growth until 2015, then an abrupt collapse from 2016."))
    fig.text(0.07, 0.905, sub, fontsize=9.5, color=viz.INK2, va="top")
    cax = fig.add_axes([0.35, 0.115, 0.3, 0.025])
    cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both")
    cb.outline.set_visible(False); cb.ax.tick_params(labelsize=8, length=0, colors=viz.INK2)
    cb.set_label("extent anomaly (%)", fontsize=9, color=viz.INK2)
    fig.text(0.07, 0.012, SRC, fontsize=7, color=viz.MUTED, ha="left")
    fig.savefig(f"{out}/stripes_{hem.lower()}.png"); plt.close(fig)

# --- figure 2: time series of key months ---
pm = stats["Arctic"]["per_month"][9]
s9 = series["Arctic"][series["Arctic"].index.month == 9]
viz.ts_figure(s9, f"{out}/ts_arctic_september.png", "Arctic September sea ice minimum, 1979–2026", "million km²",
              pm, rolling=0, subtitle=f"{pm['pct_per_decade_vs_1981_2010']:+.1f}% per decade relative to 1981–2010",
              source=SRC, show_pct=False)
anom12 = series["Antarctic"].sub(series["Antarctic"].groupby(series["Antarctic"].index.month).transform(
    lambda x: x["1981":"2010"].mean() if False else x.mean()))
sA = series["Antarctic"]
sg1 = stats["Antarctic"]["segment_1979_2015"]; sg2 = stats["Antarctic"]["segment_2016_2026"]
clim = sA["1981":"2010"].groupby(sA["1981":"2010"].index.month).mean()
an = sA - clim.reindex(sA.index.month).values
viz.ts_figure(an, f"{out}/ts_antarctic_anomaly.png", "Antarctic sea ice: a trend that flipped", "million km²",
              None, subtitle=(f"1979–2015: {sg1['slope_per_decade']:+.2f} Mkm²/decade (p={sg1['p_ols_ar1']:.2g}); "
                              f"2016–2026: {sg2['slope_per_decade']:+.2f} Mkm²/decade (p={sg2['p_ols_ar1']:.2g}). "
                              "Monthly anomaly vs 1981–2010."),
              source=SRC, events=[("2016-09-01", "2016 collapse"), ("2023-02-01", "2023 record low")])
tl.runlog(TASK, "done", f"Arctic Sept {stats['Arctic']['per_month'][9]['pct_per_decade_vs_1981_2010']:+.1f}%/dec; "
          f"Antarctic 1979-2015 {sg1['slope_per_decade']:+.2f} vs 2016-26 {sg2['slope_per_decade']:+.2f} Mkm2/dec")
tl.fix_perms()
print("done")
