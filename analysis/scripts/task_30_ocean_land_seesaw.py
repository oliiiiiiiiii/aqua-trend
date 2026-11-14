"""Task 30 - Ocean <-> land seesaw: when it pours on the continents, global sea level drops.

Interannual (deseasonalised, quadratically detrended) GRACE mass anomalies:
  L(t) = water stored on non-glaciated land (aquifers, lakes, soil, snow; ice sheets & glacier regions excluded), Gt
  O(t) = ocean mass, Gt  -> both in mm of global sea level (1 mm = 361.8 Gt; land gain = sea-level fall)
Compares with altimetry GMSL (task 12) and Nino3.4 (lags 0-12 months).
Map: where the land's borrowed water sits -> per-pixel regression of storage on L(t), and each region's share of var(L)
(share_i = cov(m_i, L) / var(L); shares sum to 1).
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

TASK = "30_ocean_land_seesaw"
out = tl.task_dir(TASK)
SRC = "Data: NASA/JPL GRACE & GRACE-FO mascons RL06.3 (2002–2026), NASA-SSH altimetry, NOAA Niño3.4. Deseasonalised, quadratic trend removed."
GT_PER_MM = 361.8
lon, lat = hub.LON, hub.LAT
tws = hub.load("tws")
times = pd.DatetimeIndex(tws.time.values)
A = tws.values.astype(np.float64)  # cm
land = hub.land_mask()
area = hs.cell_area_km2(lon, lat) * 1e6
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
LON, LAT = np.meshgrid(lon, lat)
greenland = land & ((cg == inv.get("Greenland", -9)) | ((LON > -75) & (LON < -10) & (LAT > 59) & (LAT < 84)
                                                       & ~np.isin(cg, [inv.get("Canada", -9), inv.get("Iceland", -9)])))
antarctica = land & (LAT < -60)
boxes = [(-155, -120, 55, 66), (70, 100, 27, 40), (-76, -68, -56, -40), (-25, -13, 63, 67)]
glac = land & (LAT > 72)
for b in boxes:
    glac |= land & (LON >= b[0]) & (LON <= b[1]) & (LAT >= b[2]) & (LAT <= b[3])
other = land & ~greenland & ~antarctica & ~glac
ocean = ~land

valid = ~np.isnan(A).all(axis=(1, 2))
tv = times[valid]
ty = tl.decimal_year(tv)
months = tv.month.values


def anom(y):
    """Deseasonalise and remove a quadratic trend (valid months only). y: (nt_valid, ...)."""
    y = np.asarray(y, np.float64)
    shp = y.shape
    y2 = y.reshape(shp[0], -1)
    a, _ = tl.deseason(y2, months)
    X = np.column_stack([np.ones_like(ty), ty - ty.mean(), (ty - ty.mean()) ** 2])
    ok = np.isfinite(a)
    res = np.full_like(a, np.nan)
    cols_full = ok.all(0)
    if cols_full.any():
        beta, *_ = np.linalg.lstsq(X, a[:, cols_full], rcond=None)
        res[:, cols_full] = a[:, cols_full] - X @ beta
    for j in np.where(~cols_full & (ok.sum(0) > 24))[0]:
        b, *_ = np.linalg.lstsq(X[ok[:, j]], a[ok[:, j], j], rcond=None)
        res[:, j] = a[:, j] - X @ b
    return res.reshape(shp)


Av = A[valid]
mass = Av / 100.0 * area[None] / 1e9  # Gt per pixel (cm -> m, * m2 = m3 = 1e-9 Gt)
L_gt = np.nansum(np.where(other[None], mass, 0), axis=(1, 2))
O_gt = np.nansum(np.where(ocean[None], mass, 0), axis=(1, 2))
L = anom(L_gt); O = anom(O_gt)
L_sle = -L / GT_PER_MM  # land gain -> sea level fall (mm)
O_sle = O / GT_PER_MM
s = lambda v: pd.Series(v, index=tv).reindex(pd.date_range(tv[0], tv[-1], freq="MS"))
L_s, O_s = s(L_sle), s(O_sle)
r_lo = float(np.corrcoef(L_sle, O_sle)[0, 1])
slope_lo = float(np.polyfit(L_sle, O_sle, 1)[0])
print(f"land (SLE) vs ocean mass anomaly: r = {r_lo:+.2f}, slope {slope_lo:.2f}; sd land {np.std(L_sle):.2f} mm, ocean {np.std(O_sle):.2f} mm", flush=True)
gm = pd.read_csv(f"{ROOT}/results/12_sea_level/regional_series_mm.csv", index_col=0, parse_dates=True)["Global mean"]
gm.index = gm.index.to_period("M").to_timestamp()
gmv = gm.reindex(tv)
okg = gmv.notna().values
G = np.full(len(tv), np.nan)
ty_full, m_full = ty, months  # altimetry may be shorter than GRACE: anomaly over the overlap only
ty, months = ty_full[okg], m_full[okg]
G[okg] = anom(gmv.values[okg][:, None])[:, 0]
ty, months = ty_full, m_full
G_s = s(G)
both = np.isfinite(G)
r_go = float(np.corrcoef(G[both], O_sle[both])[0, 1])
r_gl = float(np.corrcoef(G[both], L_sle[both])[0, 1])
print(f"altimetry GMSL vs ocean mass r = {r_go:+.2f}; vs land (SLE) r = {r_gl:+.2f}", flush=True)
# ENSO lag scan (Nino3.4 leads)
n34 = hub.index("nino34")
lagr = {}
for lag in range(0, 13):
    x = n34.shift(lag).reindex(tv).values
    k = np.isfinite(x)
    lagr[lag] = float(np.corrcoef(x[k], O_sle[k])[0, 1])
best = max(lagr, key=lambda k: abs(lagr[k]))
x = n34.shift(best).reindex(tv).values; k = np.isfinite(x)
r1 = lambda v: np.corrcoef(v[1:], v[:-1])[0, 1]
neff = k.sum() * (1 - r1(x[k]) * r1(O_sle[k])) / (1 + r1(x[k]) * r1(O_sle[k]))
from scipy import stats
tt = lagr[best] * np.sqrt((neff - 2) / (1 - lagr[best] ** 2)); p_enso = float(2 * stats.t.sf(abs(tt), neff - 2))
print(f"Nino3.4 -> ocean mass: best lag {best} months r = {lagr[best]:+.2f} (n_eff {neff:.0f}, p = {p_enso:.2g})", flush=True)
# events
sm3 = lambda ser: ser.rolling(3, center=True, min_periods=2).mean()
ev = {}
for nm, (a, b) in {"La Nina 2010-12": ("2010-06", "2012-06"), "El Nino 2015-16": ("2015-01", "2016-12"),
                   "La Nina 2020-23": ("2020-06", "2023-03"), "El Nino 2023-24": ("2023-04", "2024-12")}.items():
    o = sm3(O_s)[a:b]; l_ = sm3(L_s)[a:b]; g_ = sm3(G_s)[a:b]
    f = o.idxmin() if "La Nina" in nm else o.idxmax()
    ev[nm] = dict(month=str(f.date()), ocean_mass_mm=float(o[f]), land_as_sle_mm=float(l_[f]),
                  gmsl_altimetry_mm=float(g_[f]) if np.isfinite(g_[f]) else None, land_gt=float(-l_[f] * GT_PER_MM))
    print(nm, {kk: (round(vv, 2) if isinstance(vv, float) else vv) for kk, vv in ev[nm].items()}, flush=True)

# --- where is the borrowed water? per-pixel regression on L(t) & share of var(L) ---
M = anom(np.where(other[None], mass, np.nan))  # Gt anomalies per pixel
H = anom(np.where(other[None], Av, np.nan))  # cm anomalies
Lc = L - L.mean()
var_L = float(np.sum(Lc ** 2))
with np.errstate(all="ignore"):
    share = np.nansum(M * Lc[:, None, None], axis=0) / var_L
    beta_cm = np.nansum(H * Lc[:, None, None], axis=0) / var_L * 100.0  # cm per 100 Gt of land anomaly
share = np.where(other, share, np.nan); beta_cm = np.where(other, beta_cm, np.nan)
print("sum of shares (should be 1):", round(float(np.nansum(share)), 3), flush=True)
gc = tl.grid_corr(H, L, tv, deseasonalize=False, detrend=False)
sig = gc["sig"] & other
rows = []
for cid, nm in names.items():
    m = other & (cg == cid)
    if m.sum() == 0:
        continue
    rows.append(dict(country=nm, share=float(np.nansum(share[m])), area_mkm2=float(area[m].sum() / 1e12)))
cs = pd.DataFrame(rows).sort_values("share", ascending=False)
cs.to_csv(f"{out}/country_share_of_land_water_swings.csv", index=False)
print(cs.head(12).round(3).to_string(), flush=True)
cont = {"Australia": (110, 155, -45, -10), "South America": (-82, -34, -56, 13), "Africa": (-18, 52, -35, 37),
        "South & SE Asia": (60, 150, -11, 35), "North America": (-170, -52, 13, 72), "Europe & N Asia": (-12, 180, 35, 72)}
cont_share = {}
for nm, b in cont.items():
    m = other & (LON >= b[0]) & (LON <= b[1]) & (LAT >= b[2]) & (LAT <= b[3])
    cont_share[nm] = float(np.nansum(share[m]))
print("continent shares:", {k: round(v, 3) for k, v in cont_share.items()}, flush=True)

# --- figure 1: seesaw time series (one unit, small multiples; no dual axis) ---
fig, axs = plt.subplots(2, 1, figsize=(12, 7.2), dpi=170, sharex=True, gridspec_kw=dict(height_ratios=[2.2, 1]))
fig.subplots_adjust(left=0.08, right=0.86, top=0.82, bottom=0.08, hspace=0.12)
ax = axs[0]
for nm, ser, c, lw in (("Ocean mass (GRACE)", sm3(O_s), viz.SERIES[0], 2.4),
                       ("Land water, as its sea-level effect (GRACE)", sm3(L_s), viz.SERIES[1], 2.0),
                       ("Altimetry sea level (incl. heat expansion)", sm3(G_s), viz.MUTED, 1.4)):
    ax.plot(ser.index, ser.values, color=c, lw=lw, label=nm)
    last = ser.dropna()
    ax.text(last.index[-1], last.values[-1], "  " + nm.split(" (")[0], fontsize=8.5, color=viz.INK2, va="center")
ax.axhline(0, color=viz.AXIS, lw=0.8)
e = ev["La Nina 2010-12"]
ax.annotate(f"2011: rain stored on land\npulls sea level down {abs(e['ocean_mass_mm']):.1f} mm\n(≈ {e['land_gt']:.0f} Gt of water)",
            xy=(pd.Timestamp(e["month"]), e["ocean_mass_mm"]), xytext=(pd.Timestamp("2005-06-01"), e["ocean_mass_mm"] - 0.3),
            fontsize=9, color=viz.INK, arrowprops=dict(arrowstyle="-", color=viz.INK2, lw=0.8), va="center")
ax.set_ylabel("global sea level anomaly (mm)", color=viz.INK2)
ax.legend(frameon=False, fontsize=8.5, loc="lower left", bbox_to_anchor=(0, 1.0), ncol=3)
nn = n34.reindex(pd.date_range(tv[0], tv[-1], freq="MS"))
axs[1].bar(nn.index, nn.values, width=25, color=np.where(nn.values > 0, viz.RED_ARM[2], viz.BLUE_ARM[2]), linewidth=0)
axs[1].set_ylabel("Niño3.4 (°C)", color=viz.INK2)
axs[1].text(0.005, 0.92, "El Niño (red) / La Niña (blue)", transform=axs[1].transAxes, fontsize=8.5, color=viz.INK2, va="top")
for a_ in axs:
    for sp in ("top", "right", "left"):
        a_.spines[sp].set_visible(False)
    a_.grid(axis="y", color=viz.GRID, lw=0.6); a_.tick_params(length=0)
fig.text(0.08, 0.965, "The ocean–land seesaw: when the continents soak up rain, global sea level drops", fontsize=14.5,
         fontweight="bold", va="top")
fig.text(0.08, 0.92, f"Year-to-year swings (seasons and long-term trend removed). Ocean mass mirrors land water: r = {r_lo:+.2f}. "
         f"ENSO leads ocean mass by {best} months (r = {lagr[best]:+.2f}, p = {p_enso:.1g}).", fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/seesaw_timeseries.png"); plt.close(fig)

# --- figure 2: where the borrowed water sits ---
top = cs.head(8)
viz.trend_map(lon, lat, beta_cm, sig, f"{out}/map_where_land_water_swings.png",
              "Where the ocean's borrowed water goes",
              "Storage change (cm) for each 100 Gt the continents gain in a wet year (ice sheets & glaciers excluded). Largest shares of the "
              "global swing: " + ", ".join(f"{r.country} {r.share:.0%}" for r in top.itertuples()) + ".",
              "cm per 100 Gt of extra land water", vmax=1.5, cmap="water", source=SRC)
tl.save_json(dict(r_land_ocean=r_lo, slope_ocean_on_land=slope_lo, sd_land_mm=float(np.std(L_sle)), sd_ocean_mm=float(np.std(O_sle)),
                  r_gmsl_ocean_mass=r_go, r_gmsl_land=r_gl, enso_lag_r=lagr, enso_best_lag=best, enso_p=p_enso, events=ev,
                  continent_share=cont_share, top_countries=top.to_dict("records")), f"{out}/stats.json")
pd.DataFrame({"land_as_sle_mm": L_s, "ocean_mass_mm": O_s, "gmsl_altimetry_mm": G_s}).to_csv(f"{out}/seesaw_series_mm.csv")
xr.Dataset({"beta_cm_per_100gt": (("lat", "lon"), beta_cm.astype(np.float32)), "share": (("lat", "lon"), share.astype(np.float32))},
           coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/seesaw_maps.nc")
tl.runlog(TASK, "done", f"land-ocean r={r_lo:+.2f}; 2011 dip {ev['La Nina 2010-12']['ocean_mass_mm']:.1f} mm; ENSO lag {best} r={lagr[best]:+.2f}")
tl.fix_perms(out)
print("done")
