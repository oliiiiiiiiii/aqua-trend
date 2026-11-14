"""Task 27 - How each major river basin's water balance is moving (Budyko space), 2001-2012 vs 2013-2025.

Per HydroBASINS level-3 basin (rasterised on the 0.5 deg grid):
  aridity index  AI = PET / P   (atmospheric demand vs supply)
  evaporative index EI = ET / P (share of rain returned to the air);  runoff ratio = R / P
Arrows early -> late; Fu's Budyko curve (w = 2.6) for reference. Map of change in runoff ratio.
GLDAS-2.1 (P forcing, ET, PET, runoff) for internal consistency.
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import glob
import numpy as np
import pandas as pd
import geopandas as gpd
import regionmask
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "27_budyko_basins"
out = tl.task_dir(TASK)
SRC = "Data: NASA GLDAS-2.1 Noah (rain forcing, ET, potential ET, runoff); basins: HydroBASINS level 3."
HB = ROOT + "/data/raw/hydrobasins/unz"
gdf = pd.concat([gpd.read_file(f) for f in sorted(glob.glob(f"{HB}/hybas_*_lev03_v1c.shp"))], ignore_index=True)
gdf = gdf[gdf["SUB_AREA"] > 60000].reset_index(drop=True)
gdf["bid"] = np.arange(len(gdf))
lon, lat = hub.LON, hub.LAT
mask = regionmask.from_geopandas(gdf, numbers="bid", names="HYBAS_ID", overlap=False).mask(lon, lat, wrap_lon=False).values
print("basins:", len(gdf), "rasterised cells:", int(np.isfinite(mask).sum()), flush=True)
P, ET, PET, RO = hub.load("rain_gldas"), hub.load("et_gldas"), hub.load("pet_gldas"), hub.load("runoff")
(P, ET, PET, RO), t = hub.align(P, ET, PET, RO, start="2001-01-01", end="2025-12-31")
w = np.cos(np.deg2rad(lat))[:, None] * np.ones((360, 720))
periods = {"early": (t.year <= 2012), "late": (t.year >= 2013)}
means = {}
for nm, sel in periods.items():
    means[nm] = {k: np.nanmean(v.values[sel], 0) * 365 for k, v in (("P", P), ("ET", ET), ("PET", PET), ("R", RO))}
rows = []
for b in range(len(gdf)):
    m = (mask == b)
    if m.sum() < 4:
        continue
    ww = w[m]
    rec = dict(bid=b, HYBAS_ID=int(gdf.loc[b, "HYBAS_ID"]), area_km2=float(gdf.loc[b, "SUB_AREA"]), cells=int(m.sum()),
               lon=float(np.average(np.meshgrid(lon, lat)[0][m], weights=ww)),
               lat=float(np.average(np.meshgrid(lon, lat)[1][m], weights=ww)))
    for nm in periods:
        for k in ("P", "ET", "PET", "R"):
            v = means[nm][k][m]; ok = np.isfinite(v)
            rec[f"{k}_{nm}"] = float(np.sum(v[ok] * ww[ok]) / np.sum(ww[ok])) if ok.any() else np.nan
        rec[f"AI_{nm}"] = rec[f"PET_{nm}"] / rec[f"P_{nm}"]; rec[f"EI_{nm}"] = rec[f"ET_{nm}"] / rec[f"P_{nm}"]
        rec[f"RR_{nm}"] = rec[f"R_{nm}"] / rec[f"P_{nm}"]
    # annual runoff-ratio trend significance
    rr_ann = []
    for y in range(2001, 2026):
        sel = t.year == y
        if sel.sum() < 12:
            continue
        pv = np.nanmean(P.values[sel][:, m], 0); rv = np.nanmean(RO.values[sel][:, m], 0)
        rr_ann.append((y, np.nansum(rv * ww) / np.nansum(pv * ww)))
    yy = np.array([a for a, _ in rr_ann], float); vv = np.array([b_ for _, b_ in rr_ann])
    st = tl.series_trend(pd.Series(vv, index=pd.to_datetime([f"{int(a)}-07-01" for a in yy])), "rr", "-", deseasonalize=False)
    rec.update(RR_trend_per_decade=st["slope_per_decade"], RR_p=st["p_ols_ar1"], RR_mk_p=st["mk_hr_p"])
    rows.append(rec)
df = pd.DataFrame(rows)
df["dAI"] = df["AI_late"] - df["AI_early"]; df["dEI"] = df["EI_late"] - df["EI_early"]; df["dRR"] = df["RR_late"] - df["RR_early"]
df["sig_RR"] = (df["RR_p"] < 0.05) & (df["RR_mk_p"] < 0.05)
df.to_csv(f"{out}/basins_budyko.csv", index=False)
print(f"basins analysed {len(df)}; runoff ratio significantly down in {int(((df.dRR < 0) & df.sig_RR).sum())}, up in {int(((df.dRR > 0) & df.sig_RR).sum())}", flush=True)
print(df.sort_values("dRR")[["HYBAS_ID", "lon", "lat", "AI_early", "AI_late", "EI_early", "EI_late", "RR_early", "RR_late", "RR_p"]].head(10).round(3).to_string(), flush=True)

# --- Budyko arrow plot ---
fig, ax = plt.subplots(figsize=(10, 7.5), dpi=170)
fig.subplots_adjust(left=0.09, right=0.97, top=0.86, bottom=0.10)
xs = np.logspace(-1, np.log10(30), 200); wfu = 2.6
ax.plot(xs, 1 + xs - (1 + xs ** wfu) ** (1 / wfu), color=viz.MUTED, lw=1.5, ls="--", label="Budyko curve (Fu, w = 2.6)")
ax.plot([0.1, 1], [0.1, 1], color=viz.AXIS, lw=1); ax.axhline(1, color=viz.AXIS, lw=1)
for _, r in df.iterrows():
    col = "#b84a1f" if (r.dRR < 0 and r.sig_RR) else ("#1c5cab" if (r.dRR > 0 and r.sig_RR) else viz.MUTED)
    al = 0.95 if r.sig_RR else 0.35
    ax.annotate("", xy=(r.AI_late, r.EI_late), xytext=(r.AI_early, r.EI_early),
                arrowprops=dict(arrowstyle="-|>", color=col, lw=1.0 + 1.2 * r.sig_RR, alpha=al, mutation_scale=8))
ax.set_xscale("log"); ax.set_xlim(0.15, 25); ax.set_ylim(0.1, 1.15)
for sp in ("top", "right"):
    ax.spines[sp].set_visible(False)
ax.grid(color=viz.GRID, lw=0.5); ax.tick_params(length=0)
ax.set_xlabel("aridity index  PET / P   (→ drier climate)", color=viz.INK2)
ax.set_ylabel("evaporative index  ET / P   (↑ less water left for rivers)", color=viz.INK2)
ax.plot([], [], color="#b84a1f", lw=2, label="runoff ratio falling (significant)")
ax.plot([], [], color="#1c5cab", lw=2, label="runoff ratio rising (significant)")
ax.plot([], [], color=viz.MUTED, lw=1, label="not significant")
ax.legend(frameon=False, fontsize=9, loc="lower right")
fig.text(0.09, 0.965, "How the world's river basins are moving in water-balance space", fontsize=14, fontweight="bold", va="top")
fig.text(0.09, 0.915, "Each arrow = one large basin, from its 2001–2012 average to its 2013–2025 average. "
         "Up/right = more of the rain is evaporated, less becomes river flow.", fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.97, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/budyko_arrows.png"); plt.close(fig)

# --- map of runoff-ratio change by basin ---
dmap = np.full((360, 720), np.nan); smap = np.zeros((360, 720), bool)
for _, r in df.iterrows():
    dmap[mask == r.bid] = r.dRR * 100; smap[mask == r.bid] = r.sig_RR
viz.trend_map(lon, lat, dmap, smap, f"{out}/map_runoff_ratio_change.png",
              "Is less of the rain reaching the rivers?",
              "Change in runoff ratio (runoff ÷ rain, percentage points), 2013–2025 vs 2001–2012, per large river basin. "
              "Orange = rivers get a smaller share.", "Δ runoff ratio (percentage points)", vmax=10, cmap="water", source=SRC)
tl.save_json(dict(n_basins=len(df), n_sig_down=int(((df.dRR < 0) & df.sig_RR).sum()), n_sig_up=int(((df.dRR > 0) & df.sig_RR).sum()),
                  frac_moving_up_right=float(((df.dAI > 0) & (df.dEI > 0)).mean())), f"{out}/stats.json")
tl.runlog(TASK, "done", f"{len(df)} basins; runoff ratio sig down {int(((df.dRR < 0) & df.sig_RR).sum())}, up {int(((df.dRR > 0) & df.sig_RR).sum())}")
tl.fix_perms()
print("done")
