"""Task 20b - Is the shift toward water-limited evaporation real? Placebo test for the ELI change.

Real split: 2003-2013 vs 2014-2025. Placebo: odd vs even years (same sample sizes, no temporal trend).
If the real |dELI| distribution is wider and skewed (toward +, water limitation) beyond the placebo, the shift is credible.
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "20_et_correlations"
out = tl.task_dir(TASK)
et, sm, rn = hub.load("et_gldas"), hub.load("sm_root"), hub.load("rn")
(E, S, R), t = hub.align(et, sm, rn, start="2003-01-01")
lon, lat = hub.LON, hub.LAT
land = hub.land_mask() & (lat[:, None] > -58)
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
land &= ~(cg == inv.get("Greenland", -9))
w = np.cos(np.deg2rad(lat))[:, None] * np.ones((360, 720))


def eli(sel):
    tt = t[sel]
    a = tl.grid_corr(E.values[sel], S.values[sel], tt)["r"]
    b = tl.grid_corr(E.values[sel], R.values[sel], tt)["r"]
    return a - b


yrs = t.year.values
real = eli(yrs >= 2014) - eli(yrs <= 2013)
plac = eli(yrs % 2 == 1) - eli(yrs % 2 == 0)
ok = land & np.isfinite(real) & np.isfinite(plac)
res = {}
for nm, d in (("real (2014-25 minus 2003-13)", real), ("placebo (odd minus even years)", plac)):
    v = d[ok]; ww = w[ok]
    res[nm] = dict(weighted_mean=float(np.sum(v * ww) / np.sum(ww)), sd=float(np.sqrt(np.sum(ww * (v - np.sum(v * ww) / np.sum(ww)) ** 2) / np.sum(ww))),
                   frac_gt_0p2=float(np.sum(ww[v > 0.2]) / np.sum(ww)), frac_lt_m0p2=float(np.sum(ww[v < -0.2]) / np.sum(ww)))
    print(nm, {k: round(x, 3) for k, x in res[nm].items()}, flush=True)
# block bootstrap of the area-weighted mean dELI for the real split using spatial blocks of 5x5 deg
blk = (np.floor((lat[:, None] + 90) / 5) * 100 + np.floor((lon[None, :] + 180) / 5)).astype(int)
ids = np.unique(blk[ok]); rng = np.random.default_rng(0)
vals = {i: (real[ok & (blk == i)], w[ok & (blk == i)]) for i in ids}
boots = []
for _ in range(2000):
    pick = rng.choice(ids, size=len(ids), replace=True)
    num = sum(np.sum(vals[i][0] * vals[i][1]) for i in pick); den = sum(np.sum(vals[i][1]) for i in pick)
    boots.append(num / den)
ci = np.percentile(boots, [2.5, 97.5])
res["real_mean_bootstrap_95ci"] = [float(ci[0]), float(ci[1])]
print("real mean dELI 95% CI (5-deg block bootstrap):", ci, flush=True)
fig, ax = plt.subplots(figsize=(9, 4.8), dpi=170)
fig.subplots_adjust(left=0.08, right=0.97, top=0.80, bottom=0.14)
bins = np.linspace(-1.2, 1.2, 61)
ax.hist(plac[ok], bins=bins, weights=w[ok], density=True, color=viz.SERIES[0], alpha=0.55, label="placebo: odd vs even years (no trend)")
ax.hist(real[ok], bins=bins, weights=w[ok], density=True, histtype="step", lw=2.2, color=viz.SERIES[1], label="real: 2014–25 vs 2003–13")
ax.axvline(0, color=viz.AXIS, lw=1)
for sp in ("top", "right", "left"):
    ax.spines[sp].set_visible(False)
ax.set_yticks([]); ax.tick_params(length=0)
ax.set_xlabel("change in ELI (→ more water-limited)", color=viz.INK2)
ax.legend(frameon=False, fontsize=9)
fig.text(0.08, 0.965, "Is evaporation really shifting toward water limitation?", fontsize=14, fontweight="bold", va="top")
fig.text(0.08, 0.905, f"Real mean shift {res['real (2014-25 minus 2003-13)']['weighted_mean']:+.3f} (95% CI {ci[0]:+.3f}…{ci[1]:+.3f}); "
         f"placebo mean {res['placebo (odd minus even years)']['weighted_mean']:+.3f}. Area-weighted over ice-free land.",
         fontsize=9.5, color=viz.INK2, va="top")
fig.savefig(f"{out}/eli_shift_vs_placebo.png"); plt.close(fig)
tl.save_json(res, f"{out}/eli_placebo.json")
tl.runlog("20b_eli_placebo", "done", f"real mean dELI {res['real (2014-25 minus 2003-13)']['weighted_mean']:+.3f} CI {ci[0]:+.3f}..{ci[1]:+.3f}")
tl.fix_perms()
print("done")
