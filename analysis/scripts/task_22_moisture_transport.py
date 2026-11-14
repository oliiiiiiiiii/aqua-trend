"""Task 22 - Where water comes from and where it goes: atmospheric moisture transport (MERRA-2), 1980-2026.

(1) P-E source/sink climatology + vertically integrated vapour flux (annual, JJA, DJF)
(2) Trends: P-E, flux magnitude; "wet-gets-wetter / dry-gets-drier" test (trend vs climatology)
(3) Boundary inflow by side for target boxes (W/E/S/N), seasonal cycle and trends; budget check vs P-E
(4) Bulk precipitation recycling ratio (Brubaker et al. 1993) and trend
(5) Ocean source -> land rain: correlation of destination rain with ocean evaporation everywhere (lag 0-1)
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import json
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "22_moisture_transport"
out = tl.task_dir(TASK)
SRC = "Data: NASA MERRA-2 (M2TMNXINT vertically integrated water-vapour flux; M2TMNXFLX evaporation & bias-corrected precipitation)."
use_gpu = "gpu" in sys.argv
LATm = -90 + 0.5 * np.arange(361); LONm = -180 + 0.625 * np.arange(576)
DY = 0.5 * 111.195e3
DX = 0.625 * 111.195e3 * np.cos(np.deg2rad(LATm))  # m, per latitude


def m2(key, var):
    t, a = hub._gd(key, var, "native")
    return xr.DataArray(a, dims=("time", "lat", "lon"), coords={"time": t, "lat": LATm, "lon": LONm})


U = m2("m2int", "UFLXQV"); V = m2("m2int", "VFLXQV")
E = m2("m2flx", "EVAP") * 86400.0; P = m2("m2flx", "PRECTOTCORR") * 86400.0  # mm/day
(U, V, E, P), t = hub.align(U, V, E, P)
print("MERRA-2 months:", len(t), t[0].date(), t[-1].date(), flush=True)
PE = P - E
full_years = len(t) >= 400


def flux_map(pe, u, v, title, sub, fn, extent=None, vmax=6, step=6, scale=6000):
    fig = plt.figure(figsize=(13, 6.8) if extent is None else (11, 8), dpi=170)
    pr = ccrs.Robinson(central_longitude=150) if extent is None else ccrs.PlateCarree()
    ax = fig.add_axes([0.02, 0.14, 0.96, 0.72], projection=pr)
    if extent:
        ax.set_extent(extent, crs=ccrs.PlateCarree())
    else:
        ax.set_global()
    im = ax.pcolormesh(LONm, LATm, pe, transform=ccrs.PlateCarree(), cmap=viz.div_cmap("water"), vmin=-vmax, vmax=vmax,
                       shading="auto")
    s = step if extent is None else max(1, step // 3)
    lo, la = np.meshgrid(LONm[::s], LATm[::s])
    ax.quiver(lo, la, u[::s, ::s], v[::s, ::s], transform=ccrs.PlateCarree(), color=viz.INK, alpha=0.7,
              scale=scale if extent is None else scale / 2, width=0.0012 if extent is None else 0.002, regrid_shape=None)
    ax.add_feature(cfeature.COASTLINE.with_scale("110m" if extent is None else "50m"), linewidth=0.5, edgecolor=viz.INK2)
    fig.text(0.02, 0.965, title, fontsize=15, fontweight="bold", va="top")
    fig.text(0.02, 0.915, sub, fontsize=10, color=viz.INK2, va="top")
    cax = fig.add_axes([0.30, 0.08, 0.40, 0.022])
    cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both"); cb.outline.set_visible(False)
    cb.set_label("precipitation − evaporation (mm/day): orange = source (dries air into land/sea), blue = sink",
                 fontsize=9, color=viz.INK2); cb.ax.tick_params(labelsize=8, length=0)
    fig.text(0.02, 0.012, SRC + " Arrows: vertically integrated water-vapour flux.", fontsize=7.5, color=viz.MUTED)
    fig.savefig(fn); plt.close(fig)


# ---- (1) climatology maps ----
mon = t.month
for nm, sel in {"annual": np.ones(len(t), bool), "JJA": np.isin(mon, [6, 7, 8]), "DJF": np.isin(mon, [12, 1, 2])}.items():
    pe = PE.values[sel].mean(0); u = U.values[sel].mean(0); v = V.values[sel].mean(0)
    flux_map(pe, u, v, f"Rivers in the sky: where the atmosphere picks up and drops water ({nm})",
             f"MERRA-2 {t[0].year}–{t[-1].year} mean. Orange = evaporation exceeds rain (moisture source), blue = rain exceeds "
             "evaporation (destination).", f"{out}/map_PminusE_flux_{nm}.png")
    flux_map(pe, u, v, f"Moisture highways around Taiwan & East Asia ({nm})",
             "MERRA-2 mean P − E with water-vapour flux arrows", f"{out}/map_PminusE_flux_{nm}_eastasia.png",
             extent=(90, 150, 0, 50), vmax=10, step=6, scale=6000)

# ---- (2) trends ----
g_pe = tl.grid_trends(PE.values, t, use_gpu=use_gpu, annual_min=12)
mag = np.sqrt(U ** 2 + V ** 2)
g_mag = tl.grid_trends(mag.values, t, use_gpu=use_gpu, annual_min=12)
viz.trend_map(LONm, LATm, g_pe["slope_dec"], g_pe["sig_both"], f"{out}/map_PminusE_trend.png",
              f"Is the water cycle intensifying? Trend in P − E, {t[0].year}–{t[-1].year}",
              "Blue = more net water delivered (wetter), orange = more net water removed (drier).",
              "P − E trend (mm/day per decade)", vmax=0.4, cmap="water", source=SRC, central_lon=150)
viz.trend_map(LONm, LATm, g_mag["pct_dec"], g_mag["sig_both"], f"{out}/map_flux_strength_trend.png",
              "Are the atmospheric moisture highways getting stronger?",
              f"Trend in vertically integrated water-vapour transport, {t[0].year}–{t[-1].year} (% per decade)",
              "% per decade", vmax=8, cmap="redblue", source=SRC, central_lon=150)
clim_pe = PE.values.mean(0)
w = np.cos(np.deg2rad(LATm))[:, None] * np.ones_like(clim_pe)
ok = np.isfinite(g_pe["slope_dec"]) & (np.abs(LATm)[:, None] < 60)
wet = ok & (clim_pe > 0.5); dry = ok & (clim_pe < -0.5)
wgw = {"wet_regions_mean_trend": float(np.sum(g_pe["slope_dec"][wet] * w[wet]) / np.sum(w[wet])),
       "dry_regions_mean_trend": float(np.sum(g_pe["slope_dec"][dry] * w[dry]) / np.sum(w[dry])),
       "spatial_corr_trend_vs_clim": float(np.corrcoef(clim_pe[ok], g_pe["slope_dec"][ok])[0, 1])}
print("wet-gets-wetter test:", wgw, flush=True)

# ---- (3) boundary fluxes ----
BOXES = {"Taiwan & seas": (117.5, 125.0, 20.0, 27.0), "North China Plain": (113.0, 120.0, 34.0, 41.0),
         "Yangtze basin": (103.0, 122.0, 25.0, 33.0), "NW India": (70.0, 80.0, 25.0, 33.0),
         "Indian subcontinent": (68.0, 90.0, 8.0, 30.0), "Sahel": (-17.0, 35.0, 10.0, 18.0),
         "East Africa (Victoria)": (28.0, 38.0, -5.0, 3.0), "Amazon": (-75.0, -50.0, -15.0, 5.0),
         "Middle East": (35.0, 60.0, 25.0, 40.0)}


def boundary(box):
    lo0, lo1, la0, la1 = box
    i0, i1 = np.argmin(np.abs(LONm - lo0)), np.argmin(np.abs(LONm - lo1))
    j0, j1 = np.argmin(np.abs(LATm - la0)), np.argmin(np.abs(LATm - la1))
    Uv, Vv = U.values, V.values
    west = (Uv[:, j0:j1 + 1, i0] * DY).sum(1)            # kg/s, positive = into box
    east = -(Uv[:, j0:j1 + 1, i1] * DY).sum(1)
    south = (Vv[:, j0, i0:i1 + 1] * DX[j0]).sum(1)
    north = -(Vv[:, j1, i0:i1 + 1] * DX[j1]).sum(1)
    area = ((LONm[i1] - LONm[i0]) * 111.195e3) * ((LATm[j1] - LATm[j0]) * 111.195e3) * np.cos(np.deg2rad((la0 + la1) / 2))
    to_mm_day = 86400.0 / area  # kg/s -> mm/day over box
    sub = lambda da: float(0)
    Pb = P.values[:, j0:j1 + 1, i0:i1 + 1]; Eb = E.values[:, j0:j1 + 1, i0:i1 + 1]
    wl = np.cos(np.deg2rad(LATm[j0:j1 + 1]))[:, None]
    pm = (Pb * wl).sum((1, 2)) / (wl.sum() * Pb.shape[2]); em = (Eb * wl).sum((1, 2)) / (wl.sum() * Eb.shape[2])
    df = pd.DataFrame({"west": west * to_mm_day, "east": east * to_mm_day, "south": south * to_mm_day,
                       "north": north * to_mm_day, "P": pm, "E": em}, index=t)
    df["net_conv"] = df[["west", "east", "south", "north"]].sum(1)
    inflow = sum(np.clip(df[c], 0, None) for c in ("west", "east", "south", "north"))
    # Brubaker (1993) bulk recycling: rho = E*A / (E*A + 2*F_in); with fluxes in mm/day over A -> rho = E/(E + 2*Fin)
    df["inflow"] = inflow
    df["recycling"] = df["E"] / (df["E"] + 2 * inflow)
    return df


bstats = {}
fig, axes = plt.subplots(3, 3, figsize=(15, 11), dpi=150)
fig.subplots_adjust(left=0.05, right=0.98, top=0.90, bottom=0.07, hspace=0.45, wspace=0.25)
cols = {"west": viz.SERIES[0], "east": viz.SERIES[1], "south": viz.SERIES[2], "north": viz.SERIES[6]}
for ax, (nm, box) in zip(axes.ravel(), BOXES.items()):
    df = boundary(box)
    df.to_csv(f"{out}/boundary_{nm.split(' (')[0].replace(' ', '_').replace('&', 'and')}.csv")
    clim = df.groupby(df.index.month).mean()
    x = np.arange(1, 13)
    bottom_pos = np.zeros(12); bottom_neg = np.zeros(12)
    for c in ("west", "east", "south", "north"):
        vals = clim[c].values
        pos = np.clip(vals, 0, None); neg = np.clip(vals, None, 0)
        ax.bar(x, pos, bottom=bottom_pos, color=cols[c], width=0.75, label=f"from {c}" if nm == "Taiwan & seas" else None)
        ax.bar(x, neg, bottom=bottom_neg, color=cols[c], width=0.75, alpha=0.45)
        bottom_pos += pos; bottom_neg += neg
    ax.plot(x, clim["P"] - clim["E"], color=viz.INK, lw=1.8, marker="o", ms=3, label="P − E" if nm == "Taiwan & seas" else None)
    ax.plot(x, clim["net_conv"], color="#e34948", lw=1.2, ls="--", label="net inflow" if nm == "Taiwan & seas" else None)
    ax.axhline(0, color=viz.AXIS, lw=0.8)
    ax.set_xticks(x); ax.set_xticklabels(list("JFMAMJJASOND"), fontsize=8)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.tick_params(length=0, labelsize=8); ax.grid(axis="y", color=viz.GRID, lw=0.5)
    ax.set_title(nm, fontsize=11, loc="left")
    ann = df.resample("YS").mean()
    st_in = {c: tl.series_trend(df[c], c, "mm/day") for c in ("west", "east", "south", "north", "inflow", "recycling", "net_conv")}
    bstats[nm] = dict(box=box, mean={c: float(df[c].mean()) for c in df.columns},
                      budget_check_netconv_vs_PminusE=float(df["net_conv"].mean() / (df["P"] - df["E"]).mean())
                      if abs((df["P"] - df["E"]).mean()) > 0.05 else None,
                      trends={c: dict(per_decade=v["slope_per_decade"], pct=v["pct_per_decade"], p=v["p_ols_ar1"],
                                      verdict=v["verdict"]) for c, v in st_in.items()})
    print(f"{nm:24s} inflow W/E/S/N {df['west'].clip(lower=0).mean():.1f}/{df['east'].clip(lower=0).mean():.1f}/"
          f"{df['south'].clip(lower=0).mean():.1f}/{df['north'].clip(lower=0).mean():.1f} mm/day; recycling "
          f"{df['recycling'].mean():.2f} (trend {st_in['recycling']['slope_per_decade']:+.3f}/dec p={st_in['recycling']['p_ols_ar1']:.2g}); "
          f"netconv/(P-E) {bstats[nm]['budget_check_netconv_vs_PminusE']}", flush=True)
axes[0, 0].legend(fontsize=7.5, frameon=False, loc="upper left", ncol=2)
fig.text(0.05, 0.965, "Where each region's moisture comes in: inflow through each side of the box, by month", fontsize=15,
         fontweight="bold", va="top")
fig.text(0.05, 0.935, "Bars: moisture entering (+) or leaving (−, faded) through the west/east/south/north edges, in mm/day over the box. "
         "Black: P − E. Dashed red: net inflow (should match P − E).", fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/boundary_inflow_seasonal.png"); plt.close(fig)

# ---- (5) ocean source -> land rain ----
Pimerg = hub.load("p_imerg")
Em_hub = hub.load("et_m2")
land = hub.land_mask()
dest = {"Taiwan": (120.0, 122.0, 22.0, 25.3), "South China": (108.0, 118.0, 21.0, 26.0), "NW India": (72.0, 78.5, 26.0, 32.5),
        "Sahel": (-17.0, 35.0, 11.0, 18.0), "East Africa (Victoria)": (30.0, 36.0, -3.5, 1.5), "North China Plain": (113.0, 119.5, 34.0, 40.5)}
src_res = {}
for nm, b in dest.items():
    s = tl.area_mean(Pimerg, b).to_series()
    (Ea,), tt = hub.align(Em_hub, start=str(s.index[0].date()), end=str(s.index[-1].date()))
    s = s.reindex(tt)
    best = None
    for lag in (0, 1):
        # evaporation leads rain by `lag` months
        rr = tl.grid_corr(Ea.values, s.values, tt, lag=lag, use_gpu=use_gpu)
        rr["r"] = np.where(~land, rr["r"], np.nan); rr["sig"] = rr["sig"] & ~land
        if best is None or np.nanmax(rr["r"]) > np.nanmax(best["r"]):
            best = rr; best["lag"] = lag
    src_res[nm] = dict(lag=best["lag"], frac_ocean_sig_pos=float(np.mean(best["sig"] & (best["r"] > 0))))
    ext = (b[0] - 60, b[1] + 60, max(-60, b[2] - 40), min(70, b[3] + 35))
    viz.trend_map(hub.LON, hub.LAT, best["r"], best["sig"], f"{out}/ocean_source_{nm.split(' (')[0].replace(' ', '_')}.png",
                  f"Which ocean feeds {nm}'s rain?",
                  f"Correlation of ocean evaporation (MERRA-2) with {nm} rainfall (IMERG) {best['lag']} month(s) later; "
                  "red = more evaporation there goes with more rain here.", "correlation r", vmax=0.5, cmap="redblue",
                  extent=ext, proj="plate", source=SRC, boxes=[(*b, nm)], ocean=True)
    print(f"ocean source for {nm}: lag {best['lag']}, sig+ ocean fraction {src_res[nm]['frac_ocean_sig_pos']:.1%}", flush=True)

tl.save_json(dict(wet_gets_wetter=wgw, boundaries=bstats, ocean_sources=src_res,
                  period=f"{t[0].date()}..{t[-1].date()}"), f"{out}/stats.json")
tl.runlog(TASK, "done", f"wet-gets-wetter corr {wgw['spatial_corr_trend_vs_clim']:+.2f}; months {len(t)}")
tl.fix_perms()
print("done")
