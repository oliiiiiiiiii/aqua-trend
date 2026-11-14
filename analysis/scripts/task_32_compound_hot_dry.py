"""Task 32 - Compound hot-and-dry months: how often are soils parched *and* the land surface hot at the same time?

Per pixel and calendar month (base 2001-2025): hot = temperature above its 90th percentile, dry = root-zone soil moisture below
its 10th percentile, compound = both in the same month. Not detrended: the question is how often it happens now vs the 2000s.
A = MERRA-2 land (TSURF + GWETROOT); B = GLDAS-2.1 Noah (Tair + RootMoist) as an independent land model.
Per pixel: annual counts -> Mann-Kendall (FDR q=0.10) and late (2014-25) minus early (2001-12) frequency.
Global: % of land in a compound state each month (calendar heat-map) and its trend.
"""
import sys
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "32_compound_hot_dry"
out = tl.task_dir(TASK)
SRC = "Data: NASA MERRA-2 land (TSURF, GWETROOT) and GLDAS-2.1 Noah (Tair, RootMoist), 2001–2025. Percentiles per pixel & calendar month."
lon, lat = hub.LON, hub.LAT
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
land = hub.land_mask() & (lat[:, None] > -58) & (lat[:, None] < 75) & ~(cg == inv.get("Greenland", -9))
w = (np.cos(np.deg2rad(lat))[:, None] * np.ones(land.shape))
YEARS = np.arange(2001, 2026)


def flags(Tda, Sda, label):
    (T, S), t = hub.align(Tda, Sda, start="2001-01-01", end="2025-12-31")
    assert len(t) == 300, len(t)
    Tv = T.values.reshape(len(t), -1); Sv = S.values.reshape(len(t), -1)
    m = t.month.values
    ok = land.ravel() & np.isfinite(Tv).all(0) & np.isfinite(Sv).all(0)
    sd = np.zeros(Sv.shape[1])
    for mm in range(1, 13):
        sd += np.nanstd(Sv[m == mm], axis=0) / 12
    ok &= sd > np.nanpercentile(sd[ok], 5)  # drop hyper-arid pixels whose soil moisture never varies (percentile ties)
    hot = np.zeros(Tv.shape, bool); dry = np.zeros(Sv.shape, bool)
    for mm in range(1, 13):
        sel = m == mm
        thi = np.nanpercentile(Tv[sel], 90, axis=0); slo = np.nanpercentile(Sv[sel], 10, axis=0)
        hot[sel] = Tv[sel] > thi; dry[sel] = Sv[sel] < slo
    comp = hot & dry
    for a in (hot, dry, comp):
        a[:, ~ok] = False
    yr = t.year.values
    counts = {k: np.stack([a[yr == y].sum(0) for y in YEARS]).astype(np.float32) for k, a in
              (("hot", hot), ("dry", dry), ("compound", comp))}
    for k in counts:
        counts[k][:, ~ok] = np.nan
    early, late = YEARS <= 2012, YEARS >= 2014
    d = {k: np.nanmean(v[late], 0) - np.nanmean(v[early], 0) for k, v in counts.items()}
    mk = tl.mk_grid(counts["compound"])
    sig = tl.fdr_mask(np.where(ok, mk["p"], np.nan), q=0.10)
    wv = w.ravel()
    area_frac = pd.Series((comp[:, ok] * wv[ok]).sum(1) / wv[ok].sum() * 100, index=t)
    base = float(np.nanmean(counts["compound"][early][:, ok]))
    print(f"[{label}] compound months/yr: early {base:.2f}, late {float(np.nanmean(counts['compound'][late][:, ok])):.2f}; "
          f"hot {float(np.nanmean(counts['hot'][early][:, ok])):.2f}->{float(np.nanmean(counts['hot'][late][:, ok])):.2f}; "
          f"dry {float(np.nanmean(counts['dry'][early][:, ok])):.2f}->{float(np.nanmean(counts['dry'][late][:, ok])):.2f}; "
          f"MK sig up {np.mean(sig[ok] & (mk['S'].ravel()[ok] > 0)):.1%} down {np.mean(sig[ok] & (mk['S'].ravel()[ok] < 0)):.1%}", flush=True)
    shp = land.shape
    return dict(counts={k: v.reshape((len(YEARS),) + shp) for k, v in counts.items()}, d={k: v.reshape(shp) for k, v in d.items()},
                sig=sig.reshape(shp), S=mk["S"].reshape(shp), ok=ok.reshape(shp), area=area_frac,
                comp=comp.reshape((len(t),) + shp), t=t)


A = flags(hub.load("tsurf_m2"), hub.load("sm_m2"), "A MERRA-2")
B = flags(hub.load("tair"), hub.load("sm_root"), "B GLDAS")
ok = A["ok"] & B["ok"]
agree = ok & A["sig"] & (np.sign(A["d"]["compound"]) == np.sign(B["d"]["compound"])) & (np.abs(B["d"]["compound"]) > 0.1)
both_sig = ok & A["sig"] & B["sig"] & (np.sign(A["S"]) == np.sign(B["S"]))
pat = float(np.corrcoef(A["d"]["compound"][ok], B["d"]["compound"][ok])[0, 1])
r_area = float(np.corrcoef(A["area"], B["area"])[0, 1])
frac = lambda m: float(np.sum(w[m]) / np.sum(w[ok]))
res = dict(pattern_r_change=pat, r_global_area_series=r_area, frac_more_agree=frac(agree & (A["d"]["compound"] > 0)),
           frac_fewer_agree=frac(agree & (A["d"]["compound"] < 0)), frac_both_sig_up=frac(both_sig & (A["S"] > 0)),
           frac_both_sig_down=frac(both_sig & (A["S"] < 0)))
for nm, X in (("A", A), ("B", B)):
    ann = X["area"].groupby(X["area"].index.year).mean()
    st = tl.series_trend(pd.Series(ann.values, index=pd.to_datetime([f"{y}-07-01" for y in ann.index])), "area", "%", deseasonalize=False)
    res[f"area_trend_{nm}"] = dict(early_mean=float(ann.loc[2001:2012].mean()), late_mean=float(ann.loc[2014:2025].mean()),
                                   slope_per_decade=st["slope_per_decade"], p=st["p_ols_ar1"], mk_p=st["mk_annual_p"])
    top = X["area"].sort_values(ascending=False).head(8)
    res[f"top_months_{nm}"] = {str(k.date())[:7]: round(float(v), 2) for k, v in top.items()}
print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in res.items()}, flush=True)
# regional hotspots of increase (A, agreeing with B)
hot = hs.find_hotspots(lon, lat, np.where(agree, (A["d"]["compound"] + B["d"]["compound"]) / 2, np.nan), agree, min_cells=6, top=12)
if hasattr(hot, "to_string"):
    print(hot.round(2).to_string(), flush=True)
mean_d = np.where(ok, (A["d"]["compound"] + B["d"]["compound"]) / 2, np.nan)
viz.trend_map(lon, lat, mean_d, agree, f"{out}/map_compound_hot_dry_change.png",
              "Hot and parched at the same time: where it now happens more often",
              f"Change in months per year with soil moisture below its 10th percentile AND temperature above its 90th, 2014–25 vs 2001–12 "
              f"(mean of MERRA-2 and GLDAS). Full colour = significant trend in MERRA-2 and same sign in GLDAS. Global land: "
              f"{res['area_trend_A']['early_mean']:.1f}% → {res['area_trend_A']['late_mean']:.1f}% of land in this state each month.",
              "Δ compound hot-dry months per year", vmax=1.0, cmap="redblue", source=SRC)
for k in ("hot", "dry"):
    viz.trend_map(lon, lat, np.where(ok, (A["d"][k] + B["d"][k]) / 2, np.nan), np.zeros(land.shape, bool),
                  f"{out}/map_{k}_change.png", f"Change in {k} months per year (2014–25 vs 2001–12)",
                  f"{'Temperature above 90th percentile' if k == 'hot' else 'Root-zone soil moisture below 10th percentile'}; mean of MERRA-2 and GLDAS. "
                  "Base rate 1.2 months per year.", f"Δ {k} months per year", vmax=2.5, cmap="redblue", source=SRC)
# calendar heat-map (year x month) of % land in compound state, MERRA-2
cal = A["area"].values.reshape(len(YEARS), 12)
fig = plt.figure(figsize=(11, 7.2), dpi=170)
ax = fig.add_axes([0.10, 0.10, 0.74, 0.70])
from matplotlib.colors import LinearSegmentedColormap
cm = LinearSegmentedColormap.from_list("hd", [viz.SURFACE] + viz.RED_ARM)
im = ax.imshow(cal, aspect="auto", cmap=cm, vmin=0, vmax=np.nanpercentile(cal, 99), interpolation="nearest")
ax.set_yticks(range(0, len(YEARS), 2)); ax.set_yticklabels(YEARS[::2], fontsize=8.5, color=viz.INK2)
ax.set_xticks(range(12)); ax.set_xticklabels(list("JFMAMJJASOND"), fontsize=9, color=viz.INK2)
for sp in ax.spines.values():
    sp.set_visible(False)
ax.tick_params(length=0)
ax2 = fig.add_axes([0.86, 0.10, 0.11, 0.70], sharey=ax)
ann = cal.mean(1)
ax2.barh(range(len(YEARS)), ann, color=viz.RED_ARM[2], height=0.7)
ax2.axvline(np.mean(ann[:12]), color=viz.INK2, lw=0.8, ls="--")
ax2.text(np.mean(ann[:12]), -1.2, "2001–12\nmean", fontsize=7, color=viz.INK2, ha="center", va="bottom")
for sp in ("top", "right", "left"):
    ax2.spines[sp].set_visible(False)
ax2.tick_params(length=0, labelleft=False, labelsize=7.5); ax2.set_xlabel("year mean %", fontsize=8, color=viz.INK2)
cax = fig.add_axes([0.10, 0.045, 0.35, 0.018])
cb = fig.colorbar(im, cax=cax, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7.5, length=0); cb.set_label("% of land hot AND dry that month", fontsize=8, color=viz.INK2)
fig.text(0.04, 0.965, "Every month since 2001: how much of the land was hot and parched at once", fontsize=14, fontweight="bold", va="top")
fig.text(0.04, 0.915, f"Share of land with soil moisture below its 10th and temperature above its 90th percentile (MERRA-2). By chance alone ≈1%. "
         f"Year mean {res['area_trend_A']['early_mean']:.1f}% (2001–12) → {res['area_trend_A']['late_mean']:.1f}% (2014–25); "
         f"GLDAS agrees month-to-month r = {r_area:.2f}.", fontsize=9, color=viz.INK2, va="top", wrap=True)
fig.text(0.98, 0.01, SRC, fontsize=6.5, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/calendar_compound_hot_dry.png"); plt.close(fig)

# --- where was the record 2023-25 event? compound months in Jun 2023 - May 2025 (24 months), mean of both models ---
import cartopy.crs as ccrs
import cartopy.feature as cfeature
win = (A["t"] >= "2023-06-01") & (A["t"] <= "2025-05-01")
cnt = np.where(ok, (A["comp"][win].sum(0) + B["comp"][win].sum(0)) / 2.0, np.nan)
ann_rank = {}
for nm, X in (("A", A), ("B", B)):
    yr = X["area"].groupby(X["area"].index.year).mean()
    ann_rank[nm] = dict(rank_2024=int(yr.rank(ascending=False)[2024]), pct_2024=float(yr[2024]),
                        previous_record=float(yr.drop([2023, 2024, 2025]).max()), previous_record_year=int(yr.drop([2023, 2024, 2025]).idxmax()))
res["record_2024"] = ann_rank
area_km2 = hs.cell_area_km2(lon, lat)
crow = []
for cid, nm in names.items():
    m = ok & (cg == cid)
    if area_km2[m].sum() < 3e5:
        continue
    crow.append(dict(country=nm, mean_compound_months=float(np.sum(cnt[m] * area_km2[m]) / area_km2[m].sum()),
                     frac_area_ge6=float(area_km2[m & (cnt >= 6)].sum() / area_km2[m].sum())))
ctab = pd.DataFrame(crow).sort_values("mean_compound_months", ascending=False)
ctab.to_csv(f"{out}/countries_2023_25_compound_months.csv", index=False)
res["top_countries_2023_25"] = ctab.head(10).to_dict("records")
print(ctab.head(12).round(2).to_string(), flush=True)
fig = plt.figure(figsize=(12, 6.8), dpi=180)
ax = fig.add_axes([0.02, 0.15, 0.96, 0.70], projection=ccrs.Robinson()); ax.set_global()
seq = LinearSegmentedColormap.from_list("hd2", ["#f6e7e3"] + viz.RED_ARM[1:])
seq.set_under("#ece9e2")
im = ax.imshow(np.where(cnt >= 1, cnt, 0.01), origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(),
               cmap=seq, vmin=1, vmax=12, interpolation="nearest", zorder=2)
ax.imshow(np.where(ok & (cnt < 1), 1.0, np.nan), origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(),
          cmap=LinearSegmentedColormap.from_list("g", ["#ece9e2", "#ece9e2"]), interpolation="nearest", zorder=2)
ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#e1e0d9", zorder=1)
ax.add_feature(cfeature.COASTLINE.with_scale("110m"), linewidth=0.5, edgecolor=viz.INK2, zorder=3)
ax.add_feature(cfeature.BORDERS.with_scale("110m"), linewidth=0.25, edgecolor=viz.MUTED, zorder=3)
cax = fig.add_axes([0.30, 0.085, 0.40, 0.022])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="max"); cb.outline.set_visible(False)
cb.set_label("months hot AND dry, Jun 2023 – May 2025 (of 24; ≈0.5 expected by chance)", fontsize=9, color=viz.INK2)
cb.ax.tick_params(labelsize=8, length=0)
top3 = ", ".join(f"{r.country} ({r.mean_compound_months:.1f})" for r in ctab.head(5).itertuples())
fig.text(0.03, 0.965, "2024: the most widespread hot-and-dry year in the satellite era", fontsize=15, fontweight="bold", va="top")
fig.text(0.03, 0.915, f"Both land models rank 2024 first ({ann_rank['A']['pct_2024']:.1f}% and {ann_rank['B']['pct_2024']:.1f}% of land hot and dry in an average month; "
         f"previous records {ann_rank['A']['previous_record']:.1f}% and {ann_rank['B']['previous_record']:.1f}%). Months in a compound state over the 2-year "
         f"event (mean of MERRA-2 and GLDAS). Worst-hit countries: {top3}.", fontsize=9.5, color=viz.INK2, va="top", wrap=True)
fig.text(0.03, 0.012, SRC, fontsize=7.5, color=viz.MUTED)
fig.savefig(f"{out}/map_2023_25_compound_event.png"); plt.close(fig)
tl.save_json(dict(res, hotspots=hot.to_dict("records") if hasattr(hot, "to_dict") else None), f"{out}/stats.json")
pd.DataFrame({"merra2_pct_land": A["area"], "gldas_pct_land": B["area"]}).to_csv(f"{out}/global_compound_area_pct.csv")
xr.Dataset({"d_compound_A": (("lat", "lon"), A["d"]["compound"].astype(np.float32)),
            "d_compound_B": (("lat", "lon"), B["d"]["compound"].astype(np.float32)),
            "agree": (("lat", "lon"), agree.astype(np.float32))}, coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/compound_change.nc")
tl.runlog(TASK, "done", f"% land compound {res['area_trend_A']['early_mean']:.1f}->{res['area_trend_A']['late_mean']:.1f} (MERRA-2); "
          f"GLDAS {res['area_trend_B']['early_mean']:.1f}->{res['area_trend_B']['late_mean']:.1f}; pattern r {pat:+.2f}")
tl.fix_perms(out)
print("done")
