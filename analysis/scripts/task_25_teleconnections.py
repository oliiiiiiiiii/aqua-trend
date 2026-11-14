"""Task 25 - One ocean signal, opposite water effects worldwide: ENSO / IOD / PDO fingerprints on rain, ET and water storage.

Per-pixel correlation (AR(1)-adjusted, FDR) of deseasonalised, detrended monthly anomalies of
  precipitation (IMERG), ET (GLDAS), water storage (GRACE) with Nino3.4, DMI (IOD), PDO, at the best lag 0..6 months.
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import numpy as np
import pandas as pd
import xarray as xr

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
from regions import REGIONS  # noqa: E402

TASK = "25_teleconnections"
out = tl.task_dir(TASK)
SRC = "Data: GPM IMERG, GLDAS-2.1, GRACE/GRACE-FO; indices: NOAA PSL Niño3.4, HadISST DMI, ERSSTv5 PDO. AR(1)-adjusted r, FDR q=0.10."
lon, lat = hub.LON, hub.LAT
land = hub.land_mask() & (lat[:, None] > -58)
fields = {"rain": hub.load("p_imerg"), "ET": hub.load("et_gldas"), "water storage": hub.load("tws")}
idx = {"ENSO (Niño3.4)": hub.index("nino34"), "Indian Ocean Dipole": hub.index("dmi"), "PDO": hub.index("pdo")}
summary = {}
for iname, s in idx.items():
    for fname, f in fields.items():
        (F,), t = hub.align(f, start="2002-04-01" if fname == "water storage" else "2001-01-01")
        sx = s.reindex(t)
        ok = sx.notna().values
        t2 = t[ok]
        F2 = F.sel(time=t2).values
        # field first (keeps map shape); negative lag => index leads field by |lag| months
        bl = tl.best_lag(F2, sx.values[ok], t2, lags=range(0, -7, -1))
        bl["best_lag"] = -bl["best_lag"]
        r = np.where(land, bl["r"], np.nan); sig = bl["sig"] & land
        lagm = np.where(sig, bl["best_lag"], np.nan)
        frac_pos = float(np.mean(sig & (r > 0)) / np.mean(land)); frac_neg = float(np.mean(sig & (r < 0)) / np.mean(land))
        summary[f"{iname} -> {fname}"] = dict(frac_land_sig_pos=frac_pos, frac_land_sig_neg=frac_neg,
                                              median_lag_months=float(np.nanmedian(lagm)) if np.isfinite(lagm).any() else None)
        print(f"{iname:22s} -> {fname:13s}: sig+ {frac_pos:.0%} sig- {frac_neg:.0%} of land, median lag {summary[f'{iname} -> {fname}']['median_lag_months']}",
              flush=True)
        tag = f"{iname.split(' ')[0]}_{fname.replace(' ', '_')}"
        viz.trend_map(lon, lat, r, sig, f"{out}/map_{tag}.png",
                      f"Same ocean signal, opposite effects: {iname} and {fname}",
                      f"Correlation of monthly {fname} anomalies with {iname} (best lag 0–6 months; {t2[0].year}–{t2[-1].year}). "
                      "Red = goes up when the index is positive (e.g. El Niño), blue = goes down.",
                      "correlation r", vmax=0.6, cmap="redblue",
                      source=SRC)
        xr.Dataset({"r": (("lat", "lon"), r.astype(np.float32)), "sig": (("lat", "lon"), sig.astype("i1")),
                    "lag": (("lat", "lon"), bl["best_lag"].astype(np.float32))},
                   coords={"lat": lat, "lon": lon}).to_netcdf(f"{out}/corr_{tag}.nc")

# regional examples: Lake Victoria vs IOD, Taiwan rain vs ENSO, Australia storage vs ENSO
ex = {"East African lakes (Victoria)": ("Indian Ocean Dipole", "water storage"), "Taiwan (island)": ("ENSO (Niño3.4)", "rain"),
      "Sahel": ("ENSO (Niño3.4)", "rain")}
for r, (iname, fname) in ex.items():
    s = tl.area_mean(fields[fname], REGIONS[r]).to_series()
    best = None
    for lag in range(0, 7):
        res = tl.grid_corr(idx[iname].reindex(s.index).values[:, None], s.values[:, None], s.index, lag=lag)
        if best is None or abs(res["r"][0]) > abs(best[1]):
            best = (lag, float(res["r"][0]), float(res["p"][0]))
    summary[f"{r} vs {iname}"] = dict(lag=best[0], r=best[1], p=best[2])
    print(f"{r} {fname} vs {iname}: best lag {best[0]} r={best[1]:+.2f} p={best[2]:.2g}", flush=True)
tl.save_json(summary, f"{out}/summary.json")
tl.runlog(TASK, "done", "; ".join(f"{k}: +{v['frac_land_sig_pos']:.0%}/-{v['frac_land_sig_neg']:.0%}"
                                  for k, v in summary.items() if "frac_land_sig_pos" in v and "ENSO" in k))
tl.fix_perms()
print("done")
