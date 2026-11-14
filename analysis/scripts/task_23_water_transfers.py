"""Task 23 - Water moved by people: source vs destination basins seen by GRACE/GRACE-FO (+ rain context).

Pairs (HydroBASINS level-4 polygons picked by a point):
  China South-to-North Water Diversion (middle route opened Dec 2014): Han River (Danjiangkou) -> Hai River / North China Plain
  Colorado River: Upper Colorado (Lake Powell) -> Lower Colorado / Southern California
  Indus: Upper Indus (glaciers) -> Punjab irrigation plains
  Nile: Blue Nile / GERD reservoir (filling from Jul 2020) -> Egypt (Lake Nasser)
  Amu Darya: Pamir headwaters -> Aral Sea
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import numpy as np
import pandas as pd
import geopandas as gpd
import regionmask
from shapely.geometry import Point
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import xarray as xr

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "23_water_transfers"
out = tl.task_dir(TASK)
SRC = "Data: NASA/JPL GRACE & GRACE-FO mascons (PO.DAAC); GPCP precipitation; basins: HydroBASINS lev-4. Trends: OLS+AR(1) & MK."
HB = ROOT + "/data/raw/hydrobasins/unz"
_cache = {}


def basin(region, pt, level=4):
    key = (region, level)
    if key not in _cache:
        _cache[key] = gpd.read_file(f"{HB}/hybas_{region}_lev{level:02d}_v1c.shp")
    g = _cache[key]
    hit = g[g.contains(Point(*pt))]
    return hit.iloc[[0]]


PAIRS = [
    dict(name="China South-to-North Water Diversion", short="snwd", event="2014-12-12", event_label="middle route opens",
         src=("as", (111.5, 32.6), "Han River basin (Danjiangkou)"), dst=("as", (116.0, 39.0), "Hai River basin (Beijing-Tianjin-Hebei)"),
         extent=(104, 124, 28, 44), more_events=[("2018-09-01", "aquifer replenishment"), ("2021-07-20", "2021 floods")]),
    dict(name="Colorado River", short="colorado", event="2022-08-16", event_label="first federal shortage cuts (2022)",
         src=("na", (-108.5, 39.0), "Upper Colorado (Lake Powell)"), dst=("na", (-114.5, 34.0), "Lower Colorado / S. California"),
         extent=(-122, -104, 30, 44)),
    dict(name="Indus", short="indus", event="2010-08-01", event_label="2010 mega-flood",
         src=("as", (75.5, 35.3), "Upper Indus (Karakoram glaciers)"), dst=("as", (73.0, 30.5), "Punjab plains (irrigation)"),
         extent=(64, 82, 22, 38)),
    dict(name="Nile (GERD)", short="nile", event="2020-07-15", event_label="GERD first filling",
         src=("af", (36.5, 10.5), "Blue Nile / GERD (Ethiopia)"), dst=("af", (32.5, 23.5), "Lake Nasser / Egypt"),
         extent=(25, 45, 5, 32)),
    dict(name="Amu Darya -> Aral Sea", short="aral", event="2008-01-01", event_label="",
         src=("as", (71.0, 38.5), "Amu Darya headwaters (Pamir)"), dst=("as", (60.0, 45.0), "Aral Sea basin"),
         extent=(54, 76, 34, 48)),
]

tws = hub.load("tws")
pg = hub.load("p_gpcp")
lon, lat = hub.LON, hub.LAT
trend_grid = xr.open_dataset(ROOT + "/results/01_grace_water_storage/trend_grid.nc")
results = {}
for P in PAIRS:
    polys = {}
    ser = {}
    for role in ("src", "dst"):
        reg, pt, label = P[role]
        b = basin(reg, pt)
        polys[role] = b
        m = regionmask.from_geopandas(b, names="HYBAS_ID").mask(lon, lat).notnull().values
        if m.sum() < 2:  # small basin: use 3x3 cells around the point
            j = np.argmin(np.abs(lat - pt[1])); i = np.argmin(np.abs(lon - pt[0]))
            m = np.zeros_like(m); m[j - 1:j + 2, i - 1:i + 2] = True
        w = np.cos(np.deg2rad(lat))[:, None] * m
        s_tws = (tws * w).sum(("lat", "lon"), min_count=1) / (w * tws.notnull()).sum(("lat", "lon"))
        s_p = (pg * w).sum(("lat", "lon"), min_count=1) / (w * pg.notnull()).sum(("lat", "lon"))
        ser[role] = dict(tws=s_tws.to_series(), p=s_p.to_series(), area_km2=float(b["SUB_AREA"].iloc[0]), label=label,
                         cells=int(m.sum()))
    ev = pd.Timestamp(P["event"])
    rec = {}
    for role in ("src", "dst"):
        s = ser[role]["tws"]; p = ser[role]["p"]
        a = ser[role]["area_km2"]
        st_all = tl.series_trend(s, f"{role} all", "cm")
        st_pre = tl.series_trend(s, f"{role} pre", "cm", end=ev)
        st_post = tl.series_trend(s, f"{role} post", "cm", start=ev)
        pp_pre = tl.series_trend(p, "p pre", "mm/day", start="2002-04-01", end=ev)
        pp_post = tl.series_trend(p, "p post", "mm/day", start=ev)
        rec[role] = dict(label=ser[role]["label"], area_km2=a, grace_cells=ser[role]["cells"],
                         trend_all_cm_yr=st_all["slope_per_decade"] / 10, p_all=st_all["p_ols_ar1"],
                         trend_pre_cm_yr=st_pre["slope_per_decade"] / 10, p_pre=st_pre["p_ols_ar1"],
                         trend_post_cm_yr=st_post["slope_per_decade"] / 10, p_post=st_post["p_ols_ar1"],
                         vol_pre_km3_yr=st_pre["slope_per_decade"] / 10 * a * 1e-5,
                         vol_post_km3_yr=st_post["slope_per_decade"] / 10 * a * 1e-5,
                         rain_mean_pre=float(p[(p.index >= "2002-04-01") & (p.index < ev)].mean()),
                         rain_mean_post=float(p[p.index >= ev].mean()),
                         rain_pct_change=float(100 * (p[p.index >= ev].mean() / p[(p.index >= "2002-04-01") & (p.index < ev)].mean() - 1)))
        print(f"{P['name'][:28]:28s} {role}: {ser[role]['label'][:32]:32s} pre {rec[role]['trend_pre_cm_yr']:+.2f} (p={rec[role]['p_pre']:.2g}) "
              f"post {rec[role]['trend_post_cm_yr']:+.2f} (p={rec[role]['p_post']:.2g}) cm/yr; vol {rec[role]['vol_pre_km3_yr']:+.1f}->{rec[role]['vol_post_km3_yr']:+.1f} km3/yr; "
              f"rain {rec[role]['rain_pct_change']:+.0f}%", flush=True)
    results[P["name"]] = rec

    # ---- figure: map (GRACE trend + basins + arrow) | paired series ----
    fig = plt.figure(figsize=(14, 6.2), dpi=170)
    ax = fig.add_axes([0.02, 0.12, 0.42, 0.72], projection=ccrs.PlateCarree())
    ax.set_extent(P["extent"], crs=ccrs.PlateCarree())
    tg = trend_grid["trend_cm_per_yr"].values
    lm = hub.land_mask()
    ax.imshow(np.where(lm, tg, np.nan), origin="lower", extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree(),
              cmap=viz.div_cmap("water"), vmin=-3, vmax=3, interpolation="nearest", alpha=0.85)
    ax.add_feature(cfeature.COASTLINE.with_scale("50m"), linewidth=0.5, edgecolor=viz.INK2)
    ax.add_feature(cfeature.BORDERS.with_scale("50m"), linewidth=0.3, edgecolor=viz.MUTED)
    ax.add_feature(cfeature.RIVERS.with_scale("50m"), linewidth=0.5, edgecolor="#2a78d6", alpha=0.7)
    for role, col in (("src", "#b84a1f"), ("dst", "#0d366b")):
        polys[role].boundary.plot(ax=ax, color=col, linewidth=2.0, transform=ccrs.PlateCarree())
    c1 = polys["src"].geometry.iloc[0].representative_point(); c2 = polys["dst"].geometry.iloc[0].representative_point()
    ax.annotate("", xy=(c2.x, c2.y), xytext=(c1.x, c1.y), xycoords=ccrs.PlateCarree()._as_mpl_transform(ax),
                arrowprops=dict(arrowstyle="-|>", color=viz.INK, lw=2.2, mutation_scale=18))
    ax.text(c1.x, c1.y - 0.8, "SOURCE", color="#b84a1f", fontsize=9, fontweight="bold", ha="center", transform=ccrs.PlateCarree())
    ax.text(c2.x, c2.y + 0.6, "DESTINATION", color="#0d366b", fontsize=9, fontweight="bold", ha="center", transform=ccrs.PlateCarree())
    ax2 = fig.add_axes([0.52, 0.14, 0.45, 0.66])
    for role, col in (("src", "#eb6834"), ("dst", "#2a78d6")):
        s = ser[role]["tws"].asfreq("MS")
        ax2.plot(s.index, s.values, color=col, lw=0.6, alpha=0.35)
        r12 = s.rolling(12, center=True, min_periods=8).mean()
        ax2.plot(r12.index, r12.values, color=col, lw=2.2, label=f"{ser[role]['label']}")
    for e_, lab_ in [(ev, P["event_label"])] + P.get("more_events", []):
        e_ = pd.Timestamp(e_)
        ax2.axvline(e_, color=viz.MUTED, ls=":", lw=1.2)
        ax2.text(e_, ax2.get_ylim()[1], " " + lab_, fontsize=8.5, color=viz.INK2, va="top")
    for sp in ("top", "right", "left"):
        ax2.spines[sp].set_visible(False)
    ax2.grid(axis="y", color=viz.GRID, lw=0.6); ax2.tick_params(length=0)
    ax2.set_ylabel("water storage anomaly (cm)", color=viz.INK2)
    ax2.legend(frameon=False, fontsize=8.5, loc="lower left")
    s_, d_ = rec["src"], rec["dst"]
    fig.text(0.02, 0.965, f"{P['name']}: where the water comes from and where it goes", fontsize=15, fontweight="bold", va="top")
    fig.text(0.02, 0.915, (f"Source {s_['trend_pre_cm_yr']:+.1f} → {s_['trend_post_cm_yr']:+.1f} cm/yr;  destination "
                           f"{d_['trend_pre_cm_yr']:+.1f} → {d_['trend_post_cm_yr']:+.1f} cm/yr (before → after {ev.year}).  "
                           f"Rain change after {ev.year}: source {s_['rain_pct_change']:+.0f}%, destination {d_['rain_pct_change']:+.0f}%."),
             fontsize=10, color=viz.INK2, va="top")
    fig.text(0.02, 0.06, "Map: GRACE water-storage trend 2002–2026 (orange = losing, blue = gaining).", fontsize=8, color=viz.INK2)
    fig.text(0.02, 0.015, SRC, fontsize=7.5, color=viz.MUTED)
    fig.savefig(f"{out}/transfer_{P['short']}.png"); plt.close(fig)
    pd.DataFrame({"src_tws_cm": ser["src"]["tws"], "dst_tws_cm": ser["dst"]["tws"],
                  "src_p_mm_day": ser["src"]["p"], "dst_p_mm_day": ser["dst"]["p"]}).to_csv(f"{out}/series_{P['short']}.csv")
tl.save_json(results, f"{out}/stats.json")
tl.runlog(TASK, "done", "; ".join(f"{k[:20]}: dst {v['dst']['trend_pre_cm_yr']:+.1f}->{v['dst']['trend_post_cm_yr']:+.1f}"
                                  for k, v in results.items()))
tl.fix_perms()
print("done")
