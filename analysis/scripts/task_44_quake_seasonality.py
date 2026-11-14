"""Task 44 - Does the seasonal water load modulate earthquakes? (Schuster test on declustered catalogues vs GRACE load cycle)

Water piling up on land each wet season (rain, snow, groundwater) presses on the crust; unloading in the dry season reverses it.
If faults are close to failure, earthquakes should cluster in one phase of the year.
Regions & catalogues (USGS ComCat, Gardner-Knopoff declustered, magnitude >= regional completeness):
  California M>=2.5 1984-2025; Japan M>=4.0 1990-2025; Himalaya (Nepal arc) M>=4.5 1973-2025; Taiwan M>=4.0 1990-2025.
Test: Schuster (1897) p for annual periodicity of event times; independent halves (odd vs even years) for robustness;
amplitude = (peak-to-mean) relative rate modulation; month of peak vs GRACE water-storage cycle (month of max/min load).
Spatial: Schuster p per 2-deg cell (California, Japan), FDR q=0.10.
"""
import sys
import textwrap
import numpy as np
import pandas as pd
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
import seismo as sz  # noqa: E402
import hub  # noqa: E402

TASK = "44_quake_seasonality"
out = tl.task_dir(TASK)
SRC = "Data: USGS ComCat (declustered, Gardner–Knopoff); NASA/JPL GRACE & GRACE-FO mascons (seasonal water load)."
REG = {
    "California": dict(cat="california_m25", mmin=2.5, y0=1984, box=(-125, -114, 32, 42)),
    "Japan": dict(cat="japan_m4", mmin=4.0, y0=1990, box=(128, 146, 30, 46)),
    "Himalaya (Nepal arc)": dict(cat="global_m45", mmin=4.5, y0=1973, box=(78, 92, 26, 31)),
    "Taiwan": dict(cat="taiwan_m3", mmin=4.0, y0=1990, box=(119, 123, 21, 26)),
}
tws = hub.load("tws")
tg = pd.DatetimeIndex(tws.time.values)
LON, LAT = np.meshgrid(hub.LON, hub.LAT)
land = hub.land_mask()
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def load_cycle(box, pad=2.0):
    m = land & (LON >= box[0] - pad) & (LON <= box[1] + pad) & (LAT >= box[2] - pad) & (LAT <= box[3] + pad)
    s = pd.Series(np.nanmean(tws.values[:, m], 1), index=tg)
    clim = s.groupby(tg.month).mean()
    return clim - clim.mean()


rows, store = [], {}
for nm, c in REG.items():
    d = sz.load(c["cat"], c["mmin"])
    b = c["box"]
    d = d[(d.lon >= b[0]) & (d.lon <= b[1]) & (d.lat >= b[2]) & (d.lat <= b[3]) & (d.time >= f"{c['y0']}-01-01") & (d.time < "2026-01-01")].reset_index(drop=True)
    d["main"] = sz.decluster_gk(d)
    m = d[d.main].copy()
    doy = (m.time.dt.day_of_year.values - 1 + m.time.dt.hour.values / 24) / 365.25
    ph = 2 * np.pi * doy
    p, mu, R = sz.schuster(ph)
    yrs = m.time.dt.year.values
    p_odd, mu_odd, _ = sz.schuster(ph[yrs % 2 == 1]); p_even, mu_even, _ = sz.schuster(ph[yrs % 2 == 0])
    peak_month = (np.degrees(mu) % 360) / 30.4375  # 0..12, 0 = 1 Jan
    cyc = load_cycle(b)
    monthly = m.groupby(m.time.dt.month).size().reindex(range(1, 13), fill_value=0)
    days = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
    rate = monthly / days / (monthly.sum() / 365.25)              # relative rate (1 = mean)
    r_load = float(np.corrcoef(rate.values, cyc.values)[0, 1])
    dSdt = np.gradient(np.r_[cyc.values[-1], cyc.values, cyc.values[0]])[1:-1]
    r_unload = float(np.corrcoef(rate.values, -dSdt)[0, 1])
    row = dict(region=nm, catalogue=c["cat"], min_mag=c["mmin"], start=c["y0"], n_all=int(len(d)), n_main=int(len(m)), schuster_p=p,
               modulation_amp=float(2 * R), peak_month=float(peak_month), peak_month_name=MON[int(peak_month) % 12],
               p_odd_years=p_odd, p_even_years=p_even, phase_diff_halves_deg=float(abs((np.degrees(mu_odd - mu_even) + 180) % 360 - 180)),
               load_max_month=MON[int(cyc.idxmax()) - 1], load_min_month=MON[int(cyc.idxmin()) - 1], load_amp_cm=float((cyc.max() - cyc.min()) / 2),
               r_rate_vs_load=r_load, r_rate_vs_unloading=r_unload)
    rows.append(row); store[nm] = dict(rate=rate, cyc=cyc, m=m)
    print({k: (round(v, 4) if isinstance(v, float) else v) for k, v in row.items()}, flush=True)
df = pd.DataFrame(rows); df.to_csv(f"{out}/seasonality_by_region.csv", index=False)
res = dict(regions=rows)

# spatial Schuster maps (California, Japan) on 1-deg cells
cells = {}
for nm, step in (("California", 1.0), ("Japan", 1.0)):
    m = store[nm]["m"]; b = REG[nm]["box"]
    ph = 2 * np.pi * ((m.time.dt.day_of_year.values - 1) / 365.25)
    ix = ((m.lon.values - b[0]) // step).astype(int); iy = ((m.lat.values - b[2]) // step).astype(int)
    nx, ny = int((b[1] - b[0]) / step), int((b[3] - b[2]) / step)
    P = np.full((ny, nx), np.nan); MU = np.full((ny, nx), np.nan); N = np.zeros((ny, nx), int)
    for j in range(ny):
        for i in range(nx):
            s = (ix == i) & (iy == j)
            N[j, i] = s.sum()
            if s.sum() >= 50:
                P[j, i], MU[j, i], _ = sz.schuster(ph[s])
    sig = tl.fdr_mask(P, q=0.10)
    cells[nm] = dict(P=P, MU=MU, N=N, sig=sig, box=b, step=step)
    res[f"{nm}_cells"] = dict(n_tested=int(np.isfinite(P).sum()), n_sig=int(sig.sum()))
    print(nm, "cells tested", int(np.isfinite(P).sum()), "significant (FDR)", int(sig.sum()), flush=True)
tl.save_json(res, f"{out}/stats.json")

# ---------------------------------------------------------------- figure: polar-ish monthly rates vs water load
fig, axs = plt.subplots(2, 2, figsize=(12.5, 7.6), dpi=170)
fig.subplots_adjust(left=0.07, right=0.97, top=0.78, bottom=0.08, hspace=0.55, wspace=0.18)
for ax, r in zip(axs.ravel(), rows):
    st = store[r["region"]]
    x = np.arange(1, 13)
    sigr = r["schuster_p"] < 0.05 and r["p_odd_years"] < 0.1 and r["p_even_years"] < 0.1
    ax.bar(x, st["rate"].values, color=viz.RED_ARM[2] if sigr else viz.AXIS, width=0.7, label="earthquake rate (1 = average)")
    ax.axhline(1, color=viz.INK2, lw=0.7)
    ax.set_ylim(0.6, 1.4)
    for mo in x[st["cyc"].values > 0]:
        ax.axvspan(mo - 0.5, mo + 0.5, color=viz.BLUE_ARM[4], alpha=0.45, zorder=0, lw=0)
    ax.set_xticks(x); ax.set_xticklabels([m_[0] for m_ in MON], fontsize=8.5)
    ax.tick_params(length=0, labelsize=8)
    for sp_ in ("top", "right"):
        ax.spines[sp_].set_visible(False)
    ax.set_xlim(0.4, 12.6)
    verdict = "significant in both halves" if sigr else ("significant overall only" if r["schuster_p"] < 0.05 else "not significant")
    ax.set_title(f"{r['region']}: {r['n_main']:,} mainshocks M≥{r['min_mag']:g}", fontsize=10.5, loc="left", fontweight="bold", color=viz.INK, pad=16)
    ax.text(0.01, 1.0, f"Schuster p = {r['schuster_p']:.1g} ({verdict}); peak {r['peak_month_name']}, ±{r['modulation_amp'] * 100:.0f}%",
            transform=ax.transAxes, fontsize=8.2, color=viz.INK2, va="bottom")
axs[0, 0].set_ylabel("relative earthquake rate", color=viz.INK2); axs[1, 0].set_ylabel("relative earthquake rate", color=viz.INK2)
fig.text(0.07, 0.965, "Does the yearly water load rock the faults?", fontsize=15, fontweight="bold", va="top")
sub = ("Bars: earthquake rate by calendar month (aftershocks removed), red where the annual cycle is significant overall and in odd and even years separately. "
       "Blue shading: months when GRACE weighs above-average water on the region (wet-season load). Stress from hydrological loading is about 1 kPa, a thousand times smaller "
       "than an earthquake's stress drop, so any modulation is subtle.")
fig.text(0.07, 0.915, "\n".join(textwrap.wrap(sub, 170)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/seasonal_quakes_vs_water_load.png"); plt.close(fig)

# ---------------------------------------------------------------- figure: maps of Schuster significance
fig = plt.figure(figsize=(12.5, 6.4), dpi=170)
import matplotlib.colors as mcolors
cyc_cmap = plt.get_cmap("twilight_shifted")
for k, nm in enumerate(("California", "Japan")):
    C = cells[nm]; b = C["box"]
    ax = fig.add_axes([0.03 + k * 0.49, 0.12, 0.44, 0.68], projection=ccrs.PlateCarree())
    ax.set_extent([b[0], b[1], b[2], b[3]], ccrs.PlateCarree())
    ax.add_feature(cfeature.LAND.with_scale("50m"), facecolor="#ecebe6"); ax.add_feature(cfeature.COASTLINE.with_scale("50m"), lw=0.5)
    ax.add_feature(cfeature.STATES.with_scale("50m"), lw=0.3, edgecolor=viz.MUTED)
    lon_e = np.arange(b[0], b[1] + 1e-6, C["step"]); lat_e = np.arange(b[2], b[3] + 1e-6, C["step"])
    month = (np.degrees(C["MU"]) % 360) / 30.4375
    ax.pcolormesh(lon_e, lat_e, np.where(C["sig"], np.nan, month), cmap=cyc_cmap, vmin=0, vmax=12, alpha=0.25, transform=ccrs.PlateCarree())
    pm = ax.pcolormesh(lon_e, lat_e, np.where(C["sig"], month, np.nan), cmap=cyc_cmap, vmin=0, vmax=12, transform=ccrs.PlateCarree())
    ax.set_title(f"{nm}: {res[f'{nm}_cells']['n_sig']} of {res[f'{nm}_cells']['n_tested']} cells with a significant annual cycle", fontsize=10, loc="left")
cax = fig.add_axes([0.3, 0.06, 0.4, 0.025])
cb = fig.colorbar(pm, cax=cax, orientation="horizontal", ticks=np.arange(0.5, 12, 1)); cb.ax.set_xticklabels(MON, fontsize=8)
cb.outline.set_visible(False); cb.set_label("month in which earthquakes peak (faded = not significant, FDR q = 0.10)", fontsize=8.5, color=viz.INK2)
fig.text(0.03, 0.965, "Where earthquakes keep a calendar", fontsize=15, fontweight="bold", va="top")
fig.text(0.03, 0.915, "Schuster test for an annual cycle in declustered earthquake times, per 1° cell with ≥50 mainshocks.", fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/map_seasonal_cells.png"); plt.close(fig)
tl.runlog(TASK, "done", "; ".join(f"{r['region']} p={r['schuster_p']:.2g} peak {r['peak_month_name']}" for r in rows))
tl.fix_perms(out)
print("done")
