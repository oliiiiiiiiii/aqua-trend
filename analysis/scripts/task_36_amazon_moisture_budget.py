"""Task 36 - Why is the southern Amazon's dry season drying?  Source -> destination moisture budget + ocean drivers.

Box: southern Amazon (70-50W, 15-5S); season Jul-Sep (JAS), 1980-2025.
(1) MERRA-2 moisture budget per JAS: rain P (PRECTOTCORR), local evaporation E (EVAP), net moisture convergence C through the four
    box walls (UFLXQV/VFLXQV), inflow by wall, bulk recycling ratio E/(E + 2*inflow) (Brubaker 1993). Trends 1980-2025.
(2) Map: JAS change 2006-25 minus 1980-99 of vapour transport (arrows) and P - E (shading) over South America.
(3) Ocean drivers: GPCP JAS rain vs tropical North Atlantic SST (OISST, 5-25N 15-60W) and Nino3.4 (JAS), 1982-2025;
    multiple regression rain ~ TNA + Nino3.4 + time -> how much of the trend survives after the ocean drivers.
"""
import sys
import numpy as np
import pandas as pd
import xarray as xr
import statsmodels.api as sm
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

TASK = "36_amazon_moisture_budget"
out = tl.task_dir(TASK)
SRC = "Data: NASA MERRA-2 (M2TMNXINT vapour flux, M2TMNXFLX EVAP & PRECTOTCORR) 1980–2025; GPCP v2.3; NOAA OISST; Niño3.4."
BOX = (-70.0, -50.0, -15.0, -5.0)
LATm = -90 + 0.5 * np.arange(361); LONm = -180 + 0.625 * np.arange(576)
DY = 0.5 * 111.195e3
DX = 0.625 * 111.195e3 * np.cos(np.deg2rad(LATm))


def m2(key, var):
    t, a = hub._gd(key, var, "native")
    return t, a


tU, U = m2("m2int", "UFLXQV"); _, V = m2("m2int", "VFLXQV")
tE, E = m2("m2flx", "EVAP"); _, P = m2("m2flx", "PRECTOTCORR")
assert (tU == tE).all()
t = tU
sel = (t.year >= 1980) & (t.year <= 2025)
t, U, V, E, P = t[sel], U[sel], V[sel], E[sel] * 86400.0, P[sel] * 86400.0
lo0, lo1, la0, la1 = BOX
i0, i1 = np.argmin(np.abs(LONm - lo0)), np.argmin(np.abs(LONm - lo1))
j0, j1 = np.argmin(np.abs(LATm - la0)), np.argmin(np.abs(LATm - la1))
west = (U[:, j0:j1 + 1, i0] * DY).sum(1); east = -(U[:, j0:j1 + 1, i1] * DY).sum(1)
south = (V[:, j0, i0:i1 + 1] * DX[j0]).sum(1); north = -(V[:, j1, i0:i1 + 1] * DX[j1]).sum(1)
area = ((LONm[i1] - LONm[i0]) * 111.195e3) * ((LATm[j1] - LATm[j0]) * 111.195e3) * np.cos(np.deg2rad((la0 + la1) / 2))
k = 86400.0 / area
wl = np.cos(np.deg2rad(LATm[j0:j1 + 1]))[:, None] * np.ones((1, i1 - i0 + 1))
bm = lambda X: (X[:, j0:j1 + 1, i0:i1 + 1] * wl).sum((1, 2)) / wl.sum()
df = pd.DataFrame({"west": west * k, "east": east * k, "south": south * k, "north": north * k, "P": bm(P), "E": bm(E)}, index=t)
df["C"] = df[["west", "east", "south", "north"]].sum(1)
df["inflow"] = sum(np.clip(df[c], 0, None) for c in ("west", "east", "south", "north"))
df["recycling"] = df["E"] / (df["E"] + 2 * df["inflow"])
df["P_minus_E_minus_C"] = df["P"] - df["E"] - df["C"]
j = df[df.index.month.isin([7, 8, 9])]
jas = j.groupby(j.index.year).mean()
jas.to_csv(f"{out}/jas_budget_mm_day.csv")
idx = pd.to_datetime([f"{y}-07-01" for y in jas.index])
res = {"box": BOX, "budget_trends_1980_2025": {}}
for c in ("P", "E", "C", "east", "north", "west", "south", "inflow", "recycling", "P_minus_E_minus_C"):
    st = tl.series_trend(pd.Series(jas[c].values, index=idx), c, "mm/day", deseasonalize=False)
    res["budget_trends_1980_2025"][c] = dict(mean=float(jas[c].mean()), slope_per_decade=st["slope_per_decade"], ci=st["ci95_per_decade"],
                                             pct_per_decade=st["pct_per_decade"], p=st["p_ols_ar1"], mk_p=st["mk_annual_p"])
for c, v in res["budget_trends_1980_2025"].items():
    print(f"{c:18s} mean {v['mean']:+.3f}  trend {v['slope_per_decade']:+.3f}/dec ({v['pct_per_decade']:+.1f}%)  p={v['p']:.3g} mk={v['mk_p']:.3g}", flush=True)
r_pc = float(np.corrcoef(jas["P"], jas["C"])[0, 1]); r_pe = float(np.corrcoef(jas["P"], jas["E"])[0, 1])
res["interannual_r_P_vs_C"] = r_pc; res["interannual_r_P_vs_E"] = r_pe
print(f"interannual r(P, C) = {r_pc:+.2f}; r(P, E) = {r_pe:+.2f}", flush=True)

# --- (3) ocean drivers ---
sst = xr.open_dataset(f"{ROOT}/data/raw/oisst/sst.mon.mean.nc")["sst"]
sst = tl.standardize_coords(sst)
tna = sst.sel(lat=slice(5, 25), lon=slice(-60, -15))
wts = np.cos(np.deg2rad(tna.lat))
tna = tna.weighted(wts).mean(("lat", "lon")).to_series()
tna.index = pd.DatetimeIndex(tna.index).to_period("M").to_timestamp()
tna_j = tna[tna.index.month.isin([7, 8, 9])]; tna_j = tna_j.groupby(tna_j.index.year).mean()
n34 = hub.index("nino34"); n34_j = n34[n34.index.month.isin([7, 8, 9])]; n34_j = n34_j.groupby(n34_j.index.year).mean()
gp = hub.load("p_gpcp")
lm = xr.DataArray(hub.land_mask(), dims=("lat", "lon"), coords={"lat": gp.lat, "lon": gp.lon})
g = tl.area_mean(gp.where(lm), BOX).to_series(); g = g[g.index.month.isin([7, 8, 9])]
gc = g.groupby(g.index.year).count(); g = g.groupby(g.index.year).mean()[gc == 3]
D = pd.DataFrame({"rain": g, "tna": tna_j, "n34": n34_j}).dropna()
D = D[(D.index >= 1982) & (D.index <= 2025)]
D["year"] = D.index.astype(float)
X0 = sm.add_constant(D[["year"]]); m0 = sm.OLS(D["rain"], X0).fit()
X1 = sm.add_constant(D[["tna", "n34", "year"]]); m1 = sm.OLS(D["rain"], X1).fit()
Xd = sm.add_constant(D[["tna", "n34"]]); md = sm.OLS(D["rain"], Xd).fit()
st_tna = tl.series_trend(pd.Series(D["tna"].values, index=pd.to_datetime([f"{y}-07-01" for y in D.index])), "tna", "C", deseasonalize=False)
res["drivers_1982_2025"] = dict(
    rain_trend_mm_day_dec=float(m0.params["year"] * 10), rain_trend_p=float(m0.pvalues["year"]),
    rain_trend_after_drivers_mm_day_dec=float(m1.params["year"] * 10), rain_trend_after_drivers_p=float(m1.pvalues["year"]),
    tna_coef_mm_day_per_C=float(m1.params["tna"]), tna_p=float(m1.pvalues["tna"]), n34_coef=float(m1.params["n34"]), n34_p=float(m1.pvalues["n34"]),
    r2_drivers_only=float(md.rsquared), r_rain_tna=float(np.corrcoef(D["rain"], D["tna"])[0, 1]),
    r_rain_n34=float(np.corrcoef(D["rain"], D["n34"])[0, 1]), tna_warming_C_dec=st_tna["slope_per_decade"], tna_warming_p=st_tna["p_ols_ar1"],
    share_of_trend_explained=float(1 - m1.params["year"] / m0.params["year"]))
print("drivers:", {k_: round(v_, 3) for k_, v_ in res["drivers_1982_2025"].items()}, flush=True)
# detrended check: does the year-to-year sensitivity to Atlantic SST, times the Atlantic warming, reproduce the trend?
from scipy import stats as _st
dtr = lambda s_: s_ - np.polyval(np.polyfit(D.year, s_, 1), D.year)
Dd = pd.DataFrame({"rain": dtr(D.rain), "tna": dtr(D.tna), "n34": dtr(D.n34)})
mdt = sm.OLS(Dd.rain, sm.add_constant(Dd[["tna", "n34"]])).fit()
r_det = float(np.corrcoef(Dd.rain, Dd.tna)[0, 1])
_r1 = lambda x: np.corrcoef(x[1:], x[:-1])[0, 1]
_ne = len(Dd) * (1 - _r1(Dd.rain.values) * _r1(Dd.tna.values)) / (1 + _r1(Dd.rain.values) * _r1(Dd.tna.values))
_tt = r_det * np.sqrt((_ne - 2) / (1 - r_det ** 2))
early = D.year <= 2010
mearly = sm.OLS(Dd.rain[early], sm.add_constant(Dd[["tna", "n34"]][early])).fit()
tna_tr = float(np.polyfit(D.year, D.tna, 1)[0] * 10); rain_tr = float(np.polyfit(D.year, D.rain, 1)[0] * 10)
res["drivers_detrended_check"] = dict(r_detrended=r_det, p_detrended=float(2 * _st.t.sf(abs(_tt), _ne - 2)), sensitivity_mm_day_per_C=float(mdt.params["tna"]),
                                      sensitivity_se=float(mdt.bse["tna"]), sensitivity_1982_2010=float(mearly.params["tna"]), tna_trend_C_dec=tna_tr,
                                      observed_rain_trend=rain_tr, predicted_from_tna=float(mdt.params["tna"] * tna_tr),
                                      predicted_ci95=float(1.96 * mdt.bse["tna"] * tna_tr))
print("detrended check:", {k_: round(v_, 3) for k_, v_ in res["drivers_detrended_check"].items()}, flush=True)
D.to_csv(f"{out}/jas_rain_vs_drivers.csv")

# --- (2) map of JAS change ---
mon = t.month.values; yr = t.year.values
s_old = np.isin(mon, [7, 8, 9]) & (yr <= 1999); s_new = np.isin(mon, [7, 8, 9]) & (yr >= 2006)
dU = U[s_new].mean(0) - U[s_old].mean(0); dV = V[s_new].mean(0) - V[s_old].mean(0)
dPr = P[s_new].mean(0) - P[s_old].mean(0)
cU = U[np.isin(mon, [7, 8, 9])].mean(0); cV = V[np.isin(mon, [7, 8, 9])].mean(0)

fig = plt.figure(figsize=(14, 7.6), dpi=170)
ax = fig.add_axes([0.02, 0.12, 0.45, 0.70], projection=ccrs.PlateCarree())
ax.set_extent([-85, -30, -35, 15], ccrs.PlateCarree())
im = ax.pcolormesh(LONm, LATm, dPr, transform=ccrs.PlateCarree(), cmap=viz.div_cmap("water"), vmin=-1.2, vmax=1.2, shading="auto")
s = 5
lo, la = np.meshgrid(LONm[::s], LATm[::s])
ax.quiver(lo, la, cU[::s, ::s], cV[::s, ::s], transform=ccrs.PlateCarree(), color=viz.MUTED, alpha=0.45, scale=5000, width=0.0022)
q = ax.quiver(lo, la, dU[::s, ::s], dV[::s, ::s], transform=ccrs.PlateCarree(), color=viz.INK, scale=700, width=0.0030)
ax.quiverkey(q, 0.70, 1.03, 50, "change in vapour transport: 50 kg m⁻¹ s⁻¹", labelpos="E", fontproperties={"size": 8})
ax.add_feature(cfeature.COASTLINE.with_scale("50m"), linewidth=0.6, edgecolor=viz.INK2)
ax.add_feature(cfeature.BORDERS.with_scale("50m"), linewidth=0.3, edgecolor=viz.MUTED)
ax.plot([BOX[0], BOX[1], BOX[1], BOX[0], BOX[0]], [BOX[2], BOX[2], BOX[3], BOX[3], BOX[2]], color=viz.INK, lw=1.4, transform=ccrs.PlateCarree())
cax = fig.add_axes([0.06, 0.07, 0.36, 0.018])
cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both"); cb.outline.set_visible(False); cb.ax.tick_params(labelsize=8, length=0)
cb.set_label("change in Jul–Sep rain (mm/day, MERRA-2 gauge-corrected), 2006–25 minus 1980–99\ngrey arrows = mean moisture flow, black = its change", fontsize=8, color=viz.INK2)
# budget bars
B = res["budget_trends_1980_2025"]
ax2 = fig.add_axes([0.60, 0.50, 0.37, 0.28])
items = [("Rain (P)", "P"), ("Local evaporation (E)", "E"), ("Moisture inflow, all walls", "inflow"), ("  …from the east", "east"),
         ("  …across the north wall", "north"), ("Residual P−E−C", "P_minus_E_minus_C")]
yy = np.arange(len(items))[::-1]
vals = [B[c]["slope_per_decade"] for _, c in items]; cis = [B[c]["ci"] for _, c in items]
ax2.barh(yy, vals, xerr=cis, color=[viz.ORANGE_ARM[2] if v < 0 else viz.BLUE_ARM[2] for v in vals], height=0.6,
         error_kw=dict(ecolor=viz.INK2, lw=0.8, capsize=2))
ax2.set_yticks(yy); ax2.set_yticklabels([f"{lb}  {v:+.2f}{'' if B[c]['p'] < 0.05 else ' (n.s.)'}" for (lb, c), v in zip(items, vals)], fontsize=8.5, color=viz.INK2)
ax2.axvline(0, color=viz.AXIS, lw=1); ax2.set_axisbelow(True)
for sp_ in ("top", "right", "left"):
    ax2.spines[sp_].set_visible(False)
ax2.grid(axis="x", color=viz.GRID, lw=0.6); ax2.tick_params(length=0, labelsize=8)
ax2.set_xlabel("Jul–Sep trend 1980–2025 (mm/day per decade; ±95% CI)", fontsize=8.5, color=viz.INK2)
ax2.text(0, 1.04, "Dry-season moisture budget (MERRA-2): rain, evaporation and inflow all fall —\nbut the residual trend is as large, so the reanalysis cannot split local vs remote", transform=ax2.transAxes, fontsize=9, fontweight="bold")
# drivers scatter
dr = res["drivers_1982_2025"]
ax3 = fig.add_axes([0.60, 0.09, 0.34, 0.27])
ra = D["rain"] - D["rain"].mean(); ta = D["tna"] - D["tna"].mean()
sc = ax3.scatter(ta, ra, c=D.index, cmap=matplotlib.colors.LinearSegmentedColormap.from_list("yr", viz.BLUE_ARM[::-1]), s=28, edgecolor=viz.SURFACE, lw=0.6)
for y_ in (2005, 2010, 2023, 2024):
    if y_ in D.index:
        ax3.annotate(str(y_), (ta[y_], ra[y_]), xytext=(-26, 5) if y_ == 2023 else (4, -9), textcoords="offset points", fontsize=7.5, color=viz.INK2)
bb = np.polyfit(ta, ra, 1); xx = np.linspace(ta.min(), ta.max(), 10)
ax3.plot(xx, np.polyval(bb, xx), color=viz.INK2, lw=1, ls="--")
for sp_ in ("top", "right"):
    ax3.spines[sp_].set_visible(False)
ax3.grid(color=viz.GRID, lw=0.5); ax3.tick_params(length=0, labelsize=8); ax3.set_axisbelow(True)
ax3.set_xlabel("tropical N. Atlantic SST anomaly, Jul–Sep (°C)", fontsize=8.5, color=viz.INK2)
ax3.set_ylabel("Jul–Sep rain anomaly (mm/day)", fontsize=8.5, color=viz.INK2)
cbx = fig.colorbar(sc, ax=ax3, fraction=0.04, pad=0.02); cbx.outline.set_visible(False); cbx.ax.tick_params(labelsize=7, length=0)
ax3.text(0, 1.04, f"Warm Atlantic → dry Amazon: r = {dr['r_rain_tna']:+.2f}; the Atlantic warmed {dr['tna_warming_C_dec']:+.2f} °C/decade", transform=ax3.transAxes,
         fontsize=9, color=viz.INK)
fig.text(0.02, 0.975, "Why is the southern Amazon's dry season drying? A warming tropical Atlantic accounts for the trend",
         fontsize=14.5, fontweight="bold", va="top")
dc = res["drivers_detrended_check"]
fig.text(0.02, 0.93, f"Year-to-year, a warmer tropical North Atlantic means a drier southern Amazon (detrended r = {dc['r_detrended']:+.2f}, p = {dc['p_detrended']:.3f}; "
         f"{dc['sensitivity_mm_day_per_C']:+.2f} mm/day per °C). The Atlantic warmed {dc['tna_trend_C_dec']:+.2f} °C/decade → predicted rain trend "
         f"{dc['predicted_from_tna']:+.2f} ± {dc['predicted_ci95']:.2f}\nmm/day per decade vs observed {dc['observed_rain_trend']:+.2f} (GPCP 1982–2025). "
         f"After removing Atlantic + ENSO the residual trend is {dr['rain_trend_after_drivers_mm_day_dec']:+.3f} (p = {dr['rain_trend_after_drivers_p']:.2f}).",
         fontsize=9.3, color=viz.INK2, va="top")
fig.text(0.98, 0.008, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/amazon_moisture_budget.png"); plt.close(fig)
tl.save_json(res, f"{out}/stats.json")
tl.runlog(TASK, "done", f"JAS P {B['P']['slope_per_decade']:+.2f}, E {B['E']['slope_per_decade']:+.2f}, C {B['C']['slope_per_decade']:+.2f} mm/day/dec; "
          f"TNA explains {dr['share_of_trend_explained']:.0%}")
tl.fix_perms(out)
print("done")
