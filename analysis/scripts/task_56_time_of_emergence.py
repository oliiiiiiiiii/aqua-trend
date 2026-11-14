"""Task 56 - Time of emergence: how many years of satellite data does it take before a trend becomes detectable?

The trend-detective lesson: the same statistical test needs ~10 years for groundwater depletion or ocean warming but often >100 years for
rainfall. For each 0.5-degree cell and variable:
  deseasonalised monthly anomalies -> OLS slope w (per year), residual noise sd s and lag-1 autocorrelation phi of the residuals ->
  Weatherhead et al. (1998): n* = [3.3 s / |w| * sqrt((1+phi)/(1-phi))]^(2/3) years to detect the trend (5% level, 90% power).
'Emerged' = n* <= the record length already available.
Variables: GRACE/GRACE-FO water storage (2002-2026), GPCP v2.3 rain (1979-2026), OISST v2.1 sea-surface temperature (1982-),
MODIS NDVI (2000-). Caveat: n* uses the observed slope, so where the true trend is ~0 n* is huge by construction.
"""
import sys
import textwrap
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import BoundaryNorm, ListedColormap
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "56_time_of_emergence"
out = tl.task_dir(TASK)
SRC = "Data: GRACE/GRACE-FO JPL mascons; GPCP v2.3;\nNOAA OISST v2.1; Terra MODIS NDVI.\nMethod: Weatherhead et al. (1998)."


def toe(da, chunk_rows=60):
    times = pd.DatetimeIndex(da.time.values)
    t = tl.decimal_year(times)
    nt, ny, nx = da.shape
    nstar = np.full((ny, nx), np.nan); slope = np.full((ny, nx), np.nan); sd = np.full((ny, nx), np.nan); phi = np.full((ny, nx), np.nan)
    for r0 in range(0, ny, chunk_rows):
        y = np.asarray(da.values[:, r0:r0 + chunk_rows], dtype=np.float64)
        anom, _ = tl.deseason(y, times.month.values)
        Y = anom.reshape(nt, -1)
        w = np.isfinite(Y)
        n = w.sum(0)
        tb = np.where(w, t[:, None], 0).sum(0) / np.maximum(n, 1)
        yb = np.where(w, Y, 0).sum(0) / np.maximum(n, 1)
        dt_ = np.where(w, t[:, None] - tb, 0); dy = np.where(w, Y - yb, 0)
        with np.errstate(all="ignore"):
            b = (dt_ * dy).sum(0) / (dt_ * dt_).sum(0)
            res = np.where(w, dy - b * dt_, np.nan)
            s = np.nanstd(res, 0, ddof=2)
            pair = np.isfinite(res[1:]) & np.isfinite(res[:-1])
            r1 = np.nansum(np.where(pair, res[1:] * res[:-1], 0), 0) / np.nansum(res ** 2, 0)
            p_ = np.clip(np.nan_to_num(r1), 0, 0.95)
            ns = (3.3 * s / np.abs(b) * np.sqrt((1 + p_) / (1 - p_))) ** (2.0 / 3.0)
        ok = n >= 0.7 * nt
        rows = min(chunk_rows, ny - r0)
        for arr, v in ((nstar, ns), (slope, b), (sd, s), (phi, r1)):
            arr[r0:r0 + rows] = np.where(ok, v, np.nan).reshape(rows, nx)
    rec = (times[-1] - times[0]).days / 365.25
    return dict(nstar=nstar, slope=slope, sd=sd, phi=phi, record=rec, start=times[0].year, end=times[-1].year)


land = hub.land_mask()
LA = np.repeat(hub.LAT[:, None], 720, 1)
wgt = np.cos(np.deg2rad(LA))
VARS = [("tws", "Water storage (GRACE)", land, "land"), ("p_gpcp", "Rainfall (GPCP)", land, "land"),
        ("sst", "Sea-surface temperature (OISST)", ~land, "ocean"), ("ndvi", "Vegetation greenness (MODIS NDVI)", land, "land")]
R, res = {}, {}
for key, lab, mask, dom in VARS:
    da = hub.load(key)
    if key == "p_gpcp":
        da = da.sel(time=slice("1979-01-01", "2025-12-31"))
    r = toe(da)
    m = mask & np.isfinite(r["nstar"]) & (np.abs(LA) <= 70)
    ww = wgt * m
    em = (r["nstar"] <= r["record"]) & m
    R[key] = r
    res[key] = dict(label=lab, domain=dom, record_years=float(r["record"]), start=int(r["start"]), end=int(r["end"]),
                    frac_emerged=float(np.sum(ww * em) / np.sum(ww)),
                    median_nstar=float(np.nanmedian(np.where(m, r["nstar"], np.nan))),
                    frac_need_over_50=float(np.sum(ww * (r["nstar"] > 50)) / np.sum(ww)),
                    frac_need_over_100=float(np.sum(ww * (r["nstar"] > 100)) / np.sum(ww)),
                    median_phi=float(np.nanmedian(np.where(m, r["phi"], np.nan))))
    print(key, res[key], flush=True)
# named hotspots (years needed at the hotspot mean series)
HOT = {"NW India groundwater (GRACE)": ("tws", (73, 79, 27, 32)), "Caspian (GRACE)": ("tws", (46.5, 54.5, 36.5, 47)),
       "Taiwan rain (GPCP)": ("p_gpcp", (119.5, 122.5, 21.5, 25.5)), "Sahel rain (GPCP)": ("p_gpcp", (-17, 35, 10, 18)),
       "Kuroshio / Taiwan Strait SST": ("sst", (118, 125, 20, 27)), "India greening (NDVI)": ("ndvi", (73, 88, 18, 30))}
LAm, LOm = np.meshgrid(hub.LAT, hub.LON, indexing="ij")
for nm, (key, b) in HOT.items():
    da = hub.load(key)
    if key == "p_gpcp":
        da = da.sel(time=slice("1979-01-01", "2025-12-31"))
    mm = (LOm >= b[0]) & (LOm <= b[1]) & (LAm >= b[2]) & (LAm <= b[3])
    ww = np.cos(np.deg2rad(LAm)) * mm
    s = pd.Series([np.nansum(np.nan_to_num(x) * ww) / np.sum(ww * np.isfinite(x)) if np.isfinite(x[mm]).any() else np.nan for x in da.values],
                  pd.DatetimeIndex(da.time.values))
    st = tl.series_trend(s, nm, "")
    an = s - s.groupby(s.index.month).transform("mean")
    tt = tl.decimal_year(an.index); okk = an.notna().values
    bb = np.polyfit(tt[okk], an.values[okk], 1); rr = an.values - np.polyval(bb, tt)
    rv = pd.Series(rr).dropna().values
    ph = float(np.corrcoef(rv[1:], rv[:-1])[0, 1])
    res[f"hotspot: {nm}"] = dict(years_needed=tl.years_to_detect(bb[0], np.nanstd(rr), ph), record=float((s.index[-1] - s.index[0]).days / 365.25),
                                 p_ols_ar1=st.get("p_ols_ar1"), slope_per_decade=float(bb[0] * 10))
    print(nm, res[f"hotspot: {nm}"], flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.8), dpi=170)
bounds = [0, 5, 10, 15, 20, 30, 50, 100, 1000]
colors = ["#0d366b", "#1c5cab", "#2a78d6", "#6da7ec", "#b7d3f6", "#f2a27e", "#eb6834", "#7a2e10"]
cmap = ListedColormap(colors); norm = BoundaryNorm(bounds, cmap.N)
proj = ccrs.Robinson()
for k, (key, lab, mask, dom) in enumerate(VARS):
    r_, c_ = divmod(k, 2)
    ax = fig.add_axes([0.01 + c_ * 0.355, 0.47 - r_ * 0.385, 0.34, 0.34], projection=proj)
    ax.set_global()
    f = np.where(mask & (np.abs(LA) <= 75), R[key]["nstar"], np.nan)
    im = ax.pcolormesh(hub.LON, hub.LAT, f, cmap=cmap, norm=norm, transform=ccrs.PlateCarree(), shading="auto", rasterized=True)
    ax.contour(hub.LON, hub.LAT, np.where(mask, (R[key]["nstar"] <= R[key]["record"]).astype(float), np.nan), levels=[0.5], colors=[viz.INK],
               linewidths=0.2, transform=ccrs.PlateCarree())
    ax.add_feature(cfeature.COASTLINE.with_scale("110m"), lw=0.3, color=viz.INK2)
    ax.spines["geo"].set_visible(False)
    rr_ = res[key]
    ax.set_title(f"{'ABCD'[k]}  {lab}, {rr_['start']}–{rr_['end']}", fontsize=10, loc="left", fontweight="bold")
    ax.text(0.5, -0.04, f"already detectable on {100 * rr_['frac_emerged']:.0f}% of {dom}; >100 years needed on {100 * rr_['frac_need_over_100']:.0f}%",
            transform=ax.transAxes, ha="center", fontsize=7.8, color=viz.INK2)
cax = fig.add_axes([0.06, 0.045, 0.6, 0.014])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", ticks=bounds[:-1] + [1000]); cb.outline.set_visible(False)
cb.ax.set_xticklabels(["0", "5", "10", "15", "20", "30", "50", "100", ">100"]); cb.ax.tick_params(labelsize=7.5, length=0)
cb.set_label("years of monthly data needed to detect the present trend (5% significance, 90% power); black outline: already emerged", fontsize=8, color=viz.INK2)
# right: bars + hotspot list
ax = fig.add_axes([0.80, 0.52, 0.18, 0.30])
labs = ["Water storage", "Rainfall", "Sea temperature", "Greenness"]
fr = [100 * res[k]["frac_emerged"] for k, *_ in VARS]
ax.barh(range(4)[::-1], fr, color=[viz.SERIES[2], viz.SERIES[0], viz.SERIES[1], viz.SERIES[5]], height=0.6)
for i, (v, k) in enumerate(zip(fr, [k for k, *_ in VARS])):
    ax.text(v + 1.5, 3 - i, f"{v:.0f}%  (median {res[k]['median_nstar']:.0f} yr)", va="center", fontsize=8, color=viz.INK)
ax.set_yticks(range(4)[::-1]); ax.set_yticklabels(labs, fontsize=8.5)
ax.set_xlim(0, 115); ax.set_xlabel("% of area where the trend has already emerged", fontsize=8.5, color=viz.INK2)
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.tick_params(length=0, labelsize=8); ax.grid(axis="x", color=viz.GRID, lw=0.5)
ax.set_title("Which trends can we already see?", fontsize=10, loc="left", fontweight="bold")
axt = fig.add_axes([0.73, 0.10, 0.26, 0.33]); axt.axis("off")
lines = ["Years needed vs years observed (regional means):", ""]
for k, v in res.items():
    if k.startswith("hotspot: "):
        yn = v["years_needed"]
        lines.append(f"{k[9:]:30s} {yn:6.0f} yr  (have {v['record']:.0f})" if np.isfinite(yn) else f"{k[9:]:30s}   n/a")
axt.text(0, 1, "\n".join(lines), family="DejaVu Sans Mono", fontsize=7.4, va="top", color=viz.INK)
fig.text(0.01, 0.975, "How long must we watch? Ocean warming and groundwater loss show up in a decade; rainfall trends can take a century", fontsize=14.5, fontweight="bold", va="top")
tw_, pg_, ss_, nd_ = res["tws"], res["p_gpcp"], res["sst"], res["ndvi"]
subt = (f"For every place on Earth we ask how many years of monthly data a standard trend test needs to detect the trend that is there now, given the year-to-year noise "
        f"and its memory (Weatherhead et al. 1998). Sea-surface warming has emerged over {100 * ss_['frac_emerged']:.0f}% of the ocean and water-storage trends over "
        f"{100 * tw_['frac_emerged']:.0f}% of land, but rainfall trends only over {100 * pg_['frac_emerged']:.0f}% of land even with {pg_['record_years']:.0f} years of data; "
        f"on {100 * pg_['frac_need_over_100']:.0f}% of land they would need more than a century. A non-significant rain trend is usually 'not yet detectable', not 'no change'.")
fig.text(0.01, 0.925, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/time_of_emergence.png"); plt.close(fig)
tl.runlog(TASK, "done", "emerged: " + ", ".join(f"{k} {100 * res[k]['frac_emerged']:.0f}%" for k, *_ in VARS))
tl.fix_perms(out)
print("done")
