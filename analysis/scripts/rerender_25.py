"""Re-render task 25 maps from saved correlation fields (after the viz text-wrap fix)."""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys, glob
import numpy as np, xarray as xr
sys.path.insert(0, ROOT + "/scripts")
import viz, trendlib as tl
out = ROOT + "/results/25_teleconnections"
SRC = "Data: GPM IMERG, GLDAS-2.1, GRACE/GRACE-FO; indices: NOAA PSL Niño3.4, HadISST DMI, ERSSTv5 PDO. AR(1)-adjusted r, FDR q=0.10."
NAMES = {"ENSO": "ENSO (Niño3.4)", "Indian": "Indian Ocean Dipole", "PDO": "PDO"}
for f in sorted(glob.glob(f"{out}/corr_*.nc")):
    tag = f.split("corr_")[1][:-3]
    idx, field = tag.split("_", 1); field = field.replace("_", " ")
    ds = xr.open_dataset(f)
    lagtxt = int(np.nanmedian(np.where(ds["sig"].values > 0, ds["lag"].values, np.nan))) if (ds["sig"].values > 0).any() else 0
    viz.trend_map(ds.lon.values, ds.lat.values, ds["r"].values, ds["sig"].values > 0, f"{out}/map_{tag}.png",
                  f"Same ocean signal, opposite effects: {NAMES[idx]} and {field}",
                  f"Correlation of monthly {field} anomalies with {NAMES[idx]} (best lag 0–6 months, typical {lagtxt} months). "
                  "Red = goes up when the index is positive (El Niño / positive IOD / warm PDO), blue = goes down.",
                  "correlation r", vmax=0.6, cmap="redblue", source=SRC)
    print("rendered", tag)
tl.fix_perms(out)
