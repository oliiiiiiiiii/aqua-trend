"""Task 43 - Water and ice move the North Pole and change the length of the day (IERS Earth orientation x GRACE mass).

Data: IERS EOP 20 C04 daily polar motion (x, y) and excess length of day (LOD), 1962-2026; JPL GRACE/GRACE-FO mascons
(global, incl. ice sheets and ocean; GIA removed by JPL), 2002-2026.
Method:
  * Mean pole: 6.4-yr running mean of daily x, y (removes the Chandler + annual wobbles, whose beat period is 6.4 yr).
  * Drift vectors (mas/yr, direction as longitude toward which the pole moves) per era from OLS on annual means.
  * GRACE excitation (mass term, Gross 2007 / Chen et al. 2013):
        chi1 + i chi2 = -1.098 R^4/(C-A) * sum dsigma sin(phi) cos^2(phi) e^{i lambda} dphi dlambda,  C-A = 2.6068e35 kg m^2
    For excitation much slower than the 433-day Chandler period the pole follows chi: x = chi1, y = -chi2 (y toward 90W).
    Split into Greenland, Antarctica, land water & glaciers, ocean. Compared with the change in observed drift between
    1982-2001 (pre-GRACE baseline, dominated by glacial isostatic adjustment) and the GRACE era.
  * LOD: chi3 = 0.753 R^4/C_m * sum dsigma cos^3(phi) dphi dlambda (C_m = 7.1236e37); dLOD = chi3 * 86400 s.
    Observed LOD: annual means, number of days shorter than 86,400 s per year.
"""
import sys
import glob
import textwrap
import numpy as np
import pandas as pd
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "43_earth_rotation"
out = tl.task_dir(TASK)
SRC = "Data: IERS EOP 20 C04 (Paris Observatory), 1962–2026; NASA/JPL GRACE & GRACE-FO mascons RL06.3, 2002–2026."
MAS = 180 / np.pi * 3600e3
R = 6.371e6; CA = 2.6068e35; CM = 7.1236e37

# ------------------------------------------------------------------ observed
e = pd.read_csv(f"{ROOT}/data/raw/eop/eopc04.1962-now.txt", sep=r"\s+", comment="#", header=None)
e.index = pd.to_datetime(dict(year=e[0], month=e[1], day=e[2]))
x = e[5] * 1e3; y = e[6] * 1e3; lod = e[12] * 1e3          # mas, mas, ms
# cascaded boxcars: a 365-day mean nulls the annual wobble, a 433-day mean nulls the Chandler wobble, a second 365-day pass smooths
lp = lambda s: s.rolling(365, center=True).mean().rolling(433, center=True).mean().rolling(365, center=True).mean()
xm = lp(x); ym = lp(y)
ann = pd.DataFrame({"x": x, "y": y, "lod": lod}).groupby(e.index.year).mean()
ann = ann.loc[1962:2025]


def drift(a, b):
    s = ann.loc[a:b]; t = s.index.values.astype(float)
    bx, sx = np.polyfit(t, s.x, 1, cov=True); by, sy = np.polyfit(t, s.y, 1, cov=True)
    vx, vy = bx[0], by[0]
    return dict(period=f"{a}-{b}", vx=float(vx), vy=float(vy), speed=float(np.hypot(vx, vy)), toward_lon_W=float(np.degrees(np.arctan2(vy, vx))),
                se_x=float(np.sqrt(sx[0, 0])), se_y=float(np.sqrt(sy[0, 0])))


eras = [(1962, 1981), (1982, 2001), (2002, 2013), (2014, 2025), (2002, 2025)]
D = {f"{a}-{b}": drift(a, b) for a, b in eras}
for k, v in D.items():
    print(f"drift {k}: {v['speed']:.2f} mas/yr toward {v['toward_lon_W']:.0f}°W (vx {v['vx']:+.2f}±{v['se_x']:.2f}, vy {v['vy']:+.2f}±{v['se_y']:.2f})", flush=True)

# ------------------------------------------------------------------ GRACE excitation
f = glob.glob(f"{ROOT}/data/raw/grace/GRCTellus*.nc")[0]
ds = xr.open_dataset(f)
lat = ds.lat.values; lon = ds.lon.values
lonw = np.where(lon > 180, lon - 360, lon)
tg = pd.DatetimeIndex(ds.time.values)
sig = ds.lwe_thickness.values.astype(np.float32) * 10.0     # kg/m^2 (1 cm water = 10 kg/m^2)
landf = ds.land_mask.values > 0.5
phi = np.deg2rad(lat)[:, None]; lam = np.deg2rad(lon)[None, :]
dA = np.deg2rad(0.5) ** 2
k12 = -1.098 * R ** 4 / CA * np.sin(phi) * np.cos(phi) ** 2 * dA
k3 = 0.753 * R ** 4 / CM * np.cos(phi) ** 3 * dA
cg, names = hs.country_grid(lonw[np.argsort(lonw)], lat)
cg = cg[:, np.argsort(np.argsort(lonw))]                      # back to the file's 0..360 order
inv = {v: k for k, v in names.items()}
green = cg == inv.get("Greenland", -9)
antar = landf & (lat[:, None] < -60)
parts = {"Greenland ice": green, "Antarctic ice": antar, "Land water & glaciers": landf & ~green & ~antar, "Ocean": ~landf}


def chi(mask):
    s = np.where(mask[None], sig, 0.0)
    c1 = np.einsum("tij,ij->t", s, k12 * np.cos(lam)); c2 = np.einsum("tij,ij->t", s, k12 * np.sin(lam))
    c3 = np.einsum("tij,ij->t", s, k3 * np.ones_like(lam))
    return pd.DataFrame({"x": c1 * MAS, "y": -c2 * MAS, "lod": c3 * 86400e3}, index=tg)   # mas, mas, ms


G = {k: chi(m) for k, m in parts.items()}
G["Total"] = sum(G[k] for k in parts)
ty = tl.decimal_year(tg)
gtr = {}
for k, g in G.items():
    bx = np.polyfit(ty, g.x, 1)[0]; by = np.polyfit(ty, g.y, 1)[0]; bl = np.polyfit(ty, g.lod, 1)[0]
    gtr[k] = dict(vx=float(bx), vy=float(by), speed=float(np.hypot(bx, by)), toward_lon_W=float(np.degrees(np.arctan2(by, bx))), lod_ms_per_century=float(bl * 100))
    print(f"GRACE {k:24s}: {gtr[k]['speed']:.2f} mas/yr toward {gtr[k]['toward_lon_W']:.0f}°W (vx {bx:+.2f}, vy {by:+.2f}); LOD {bl * 100:+.2f} ms/century", flush=True)
# compare: change in observed drift (GRACE era minus 1982-2001 baseline) vs GRACE-predicted drift
obs_change = dict(vx=D["2002-2025"]["vx"] - D["1982-2001"]["vx"], vy=D["2002-2025"]["vy"] - D["1982-2001"]["vy"])
obs_change["speed"] = float(np.hypot(obs_change["vx"], obs_change["vy"])); obs_change["toward_lon_W"] = float(np.degrees(np.arctan2(obs_change["vy"], obs_change["vx"])))
ang = abs(((obs_change["toward_lon_W"] - gtr["Total"]["toward_lon_W"]) + 180) % 360 - 180)
print(f"observed drift change (2002-25 minus 1982-2001): {obs_change['speed']:.2f} mas/yr toward {obs_change['toward_lon_W']:.0f}°W; "
      f"GRACE predicts {gtr['Total']['speed']:.2f} toward {gtr['Total']['toward_lon_W']:.0f}°W; angle {ang:.0f}°", flush=True)
# interannual: observed annual-mean pole (detrended over GRACE era) vs GRACE annual-mean chi (detrended)
ga = G["Total"].groupby(tg.year).mean().loc[2003:2025]
gcount = G["Total"].groupby(tg.year).size().loc[2003:2025]
ga = ga[gcount >= 8]
oa = ann.loc[ga.index]
dt = lambda s: s - np.polyval(np.polyfit(s.index.values.astype(float), s.values, 1), s.index.values.astype(float))
r_x = float(np.corrcoef(dt(oa.x), dt(ga.x))[0, 1]); r_y = float(np.corrcoef(dt(oa.y), dt(ga.y))[0, 1])
print(f"interannual (detrended annual means, {len(ga)} yrs): r_x={r_x:.2f}, r_y={r_y:.2f}", flush=True)

# ------------------------------------------------------------------ LOD
lod_ann = ann.lod
short = (lod < 0).groupby(e.index.year).sum().loc[1962:2026]
lod_min = lod.idxmin()
lod_tr = {f"{a}-{b}": float(np.polyfit(np.arange(a, b + 1), lod_ann.loc[a:b].values, 1)[0] * 10) for a, b in ((1972, 2025), (2002, 2025), (2016, 2025))}
res = dict(drift=D, grace_drift=gtr, observed_drift_change=obs_change, angle_obs_vs_grace_deg=float(ang),
           interannual_r=dict(x=r_x, y=r_y, n_years=int(len(ga))),
           lod=dict(min_ms=float(lod.min()), min_date=str(lod_min.date()), days_shorter_than_86400s=dict((int(k), int(v)) for k, v in short.items() if v > 0),
                    annual_mean_trend_ms_per_decade=lod_tr, annual_mean_2025=float(lod_ann.loc[2025]), annual_mean_max=float(lod_ann.max()),
                    annual_mean_max_year=int(lod_ann.idxmax()), grace_climate_lod_ms_per_century=gtr["Total"]["lod_ms_per_century"]))
print("LOD:", {k: v for k, v in res["lod"].items() if k != "days_shorter_than_86400s"}, flush=True)
print("short days per year:", res["lod"]["days_shorter_than_86400s"], flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure 1: pole path + drift arrows + attribution
fig = plt.figure(figsize=(13, 7.2), dpi=180)
ax = fig.add_axes([0.06, 0.1, 0.44, 0.7])
ok = xm.notna() & ym.notna()
X, Y = xm[ok].values, ym[ok].values
tt = tl.decimal_year(xm[ok].index)
pts = np.column_stack([-Y, X])   # plot with 90°W pointing left? -> use x axis = y_p (toward 90°W) to the left
seg = np.concatenate([pts[:-1, None], pts[1:, None]], axis=1)
lc = LineCollection(seg, cmap="viridis", linewidths=3)
lc.set_array(tt[:-1]); ax.add_collection(lc)
ax.autoscale(); ax.set_aspect("equal")
cb = fig.colorbar(lc, cax=fig.add_axes([0.10, 0.045, 0.36, 0.014]), orientation="horizontal")
cb.outline.set_visible(False); cb.ax.tick_params(labelsize=8, length=0); cb.set_label("year (wobbles removed: cascaded 1-yr and 433-day means)", fontsize=8.5, color=viz.INK2)
for yr in (1966, 1980, 1990, 2000, 2010, 2020):
    k = np.argmin(abs(tt - yr - 0.5))
    if abs(tt[k] - yr - 0.5) < 0.1:
        ax.plot(*pts[k], "o", color="white", mec=viz.INK, ms=5, zorder=5)
        ax.annotate(str(yr), pts[k], xytext=(6, -3), textcoords="offset points", fontsize=8.5, color=viz.INK2)
ax.set_xlabel("← toward 90°W (Canada)     mean pole, mas     toward 90°E (Siberia) →", fontsize=8.5, color=viz.INK2)
ax.set_ylabel("toward Greenwich (0°) →   mas", fontsize=8.5, color=viz.INK2)
for sp_ in ("top", "right"):
    ax.spines[sp_].set_visible(False)
ax.grid(color=viz.GRID, lw=0.5); ax.tick_params(length=0, labelsize=8)
ax.set_title(f"Path of the mean North Pole, {int(tt[0])}–{int(tt[-1])} (1 mas ≈ 3 cm on the ground)", fontsize=10, loc="left", color=viz.INK)
ax.set_position([0.05, 0.17, 0.46, 0.63])
# right: (top) observed drift by era, (bottom) observed change vs GRACE prediction, both as vectors (left = toward 90W)
def arrow(ax_, x1, y1, c, label, x0=0.0, y0=0.0, ls="-", lw=2.2, dx=0.0, dy=0.0, ha="center"):
    ax_.annotate("", xy=(x1, y1), xytext=(x0, y0), arrowprops=dict(arrowstyle="-|>", color=c, lw=lw, ls=ls, shrinkA=0, shrinkB=0))
    if label:
        ax_.text(x1 + dx, y1 + dy, label, fontsize=7.8, color=c, ha=ha, va="center")


def vec_axes(rect, title, lim):
    a_ = fig.add_axes(rect)
    a_.axhline(0, color=viz.AXIS, lw=0.6); a_.axvline(0, color=viz.AXIS, lw=0.6)
    a_.set_xlim(-lim, lim); a_.set_ylim(-lim * 0.55, lim)
    a_.set_aspect("equal")
    for sp_ in ("top", "right"):
        a_.spines[sp_].set_visible(False)
    a_.tick_params(length=0, labelsize=7.5); a_.grid(color=viz.GRID, lw=0.5)
    a_.set_title(title, fontsize=9.5, loc="left", color=viz.INK)
    return a_


cols = {"1962-1981": viz.MUTED, "1982-2001": viz.INK2, "2002-2013": viz.BLUE_ARM[3], "2014-2025": viz.BLUE_ARM[1]}
ax2 = vec_axes([0.56, 0.48, 0.42, 0.32], "Observed drift of the pole by era (mas per year)", 6.5)
for k, c in cols.items():
    v = D[k]
    xx, yy = -v["vy"], v["vx"]
    arrow(ax2, xx, yy, c, f"{k.replace('-', '–')}\n{v['speed']:.1f} mas/yr", dx=0.0, dy=0.75 if yy >= 0 else -0.75)
ax2.text(-6.3, -3.2, "← toward 90°W (Canada)", fontsize=7.5, color=viz.MUTED); ax2.text(6.3, -3.2, "toward 90°E →", fontsize=7.5, color=viz.MUTED, ha="right")
ax3 = vec_axes([0.56, 0.07, 0.42, 0.34], "What changed after 2000, and what GRACE mass change predicts", 6.5)
gc = {"Greenland ice": viz.SERIES[0], "Antarctic ice": viz.SERIES[6], "Land water & glaciers": viz.BROWN_ARM[2], "Ocean": viz.SERIES[2]}
x0, y0 = 0.0, 0.0
offs = {"Greenland ice": (-0.25, 0.0, "right"), "Antarctic ice": (0.25, -0.2, "left"), "Land water & glaciers": (0.9, -0.45, "left"), "Ocean": (0.3, -0.1, "left")}
for k in gc:
    v = gtr[k]
    x1, y1 = x0 - v["vy"], y0 + v["vx"]
    arrow(ax3, x1, y1, gc[k], None, x0=x0, y0=y0, lw=1.6)
    ox, oy, ha = offs[k]
    ax3.text((x0 + x1) / 2 + ox, (y0 + y1) / 2 + oy, k, fontsize=7.6, color=gc[k], ha=ha, va="center")
    x0, y0 = x1, y1
arrow(ax3, x0, y0, viz.RED_ARM[3], f"GRACE total\n{gtr['Total']['speed']:.1f} mas/yr", lw=2.4, dx=-1.2, dy=0.55)
v = obs_change
arrow(ax3, -v["vy"], v["vx"], viz.INK, f"observed change\n{v['speed']:.1f} mas/yr", ls="--", lw=1.8, dx=1.6, dy=0.4)
fig.text(0.02, 0.965, "Water and ice are steering the North Pole", fontsize=15, fontweight="bold", va="top")
sub = (f"In 1962–81 the pole crept toward Canada ({D['1962-1981']['toward_lon_W']:.0f}°W), mostly because the land is still rebounding from the ice age. "
       f"Since ~2000 it has turned east: {D['2014-2025']['speed']:.1f} mas/yr toward {abs(D['2014-2025']['toward_lon_W']):.0f}°{'W' if D['2014-2025']['toward_lon_W'] > 0 else 'E'} in 2014–25. "
       f"Mass changes weighed by GRACE (melting Greenland and Antarctica, groundwater pumping, a fuller ocean) predict a push of {gtr['Total']['speed']:.1f} mas/yr toward "
       f"{abs(gtr['Total']['toward_lon_W']):.0f}°{'W' if gtr['Total']['toward_lon_W'] > 0 else 'E'}, within {ang:.0f}° of the observed change in drift.")
fig.text(0.02, 0.915, "\n".join(textwrap.wrap(sub, 175)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.98, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/pole_drift_water.png"); plt.close(fig)

# ------------------------------------------------------------------ figure 2: length of day
fig, axs = plt.subplots(2, 1, figsize=(11, 7.0), dpi=170, sharex=True, gridspec_kw=dict(height_ratios=[2.2, 1]))
fig.subplots_adjust(left=0.09, right=0.97, top=0.82, bottom=0.08, hspace=0.12)
ax = axs[0]
ax.plot(lod.index, lod.values, color=viz.BLUE_ARM[4], lw=0.4)
lr = lod.rolling(365, center=True, min_periods=300).mean()
ax.plot(lr.index, lr.values, color=viz.BLUE_ARM[1], lw=2.4, label="1-year running mean")
ax.axhline(0, color=viz.INK2, lw=0.8)
ax.annotate(f"shortest day: {lod.min():+.2f} ms\n({lod_min.strftime('%d %b %Y')})", (lod_min, lod.min()), xytext=(-150, -5), textcoords="offset points",
            fontsize=8.5, color=viz.INK2, arrowprops=dict(arrowstyle="-", color=viz.MUTED, lw=0.6))
ax.set_ylabel("length of day minus 86,400 s (ms)", color=viz.INK2)
ax.text(pd.Timestamp("1963-01-01"), 0.15, "days shorter than 86,400 s below this line", fontsize=8, color=viz.INK2)
ax.legend(frameon=False, fontsize=8.5, loc="upper right")
ax2 = axs[1]
sh = short.loc[:2025]
ax2.bar(pd.to_datetime([f"{k}-07-01" for k in sh.index]), sh.values, width=300, color=viz.ORANGE_ARM[2])
ax2.set_ylabel("days per year\nshorter than 86,400 s", color=viz.INK2)
for a in axs:
    for sp_ in ("top", "right", "left"):
        a.spines[sp_].set_visible(False)
    a.grid(axis="y", color=viz.GRID, lw=0.6); a.tick_params(length=0, labelsize=8.5)
fig.text(0.09, 0.965, "The Earth is spinning faster: the shortest days on record came in the 2020s", fontsize=15, fontweight="bold", va="top")
sub = (f"Length of day from IERS. Days were ~{res['lod']['annual_mean_max']:.1f} ms longer than 86,400 s in {res['lod']['annual_mean_max_year']}; since 2016 the annual mean has "
       f"fallen {abs(lod_tr['2016-2025']):.2f} ms per decade (molten-core motions, not tides). Melting ice works the other way: GRACE mass shifts "
       f"lengthen the day by {gtr['Total']['lod_ms_per_century']:+.2f} ms per century, hidden for now under the core's larger swings.")
fig.text(0.09, 0.915, "\n".join(textwrap.wrap(sub, 135)), fontsize=9.5, color=viz.INK2, va="top")
fig.text(0.97, 0.01, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/length_of_day.png"); plt.close(fig)

pd.DataFrame({k: v.x for k, v in G.items()}).add_suffix("_x_mas").join(pd.DataFrame({k: v.y for k, v in G.items()}).add_suffix("_y_mas")).to_csv(f"{out}/grace_pole_excitation.csv")
ann.to_csv(f"{out}/eop_annual_means.csv")
tl.runlog(TASK, "done", f"pole drift 2014-25 {D['2014-2025']['speed']:.1f} mas/yr toward {D['2014-2025']['toward_lon_W']:.0f}W; GRACE predicts "
          f"{gtr['Total']['speed']:.1f} toward {gtr['Total']['toward_lon_W']:.0f}W (angle {ang:.0f} deg vs observed change); LOD min {lod.min():.2f} ms")
tl.fix_perms(out)
print("done")
