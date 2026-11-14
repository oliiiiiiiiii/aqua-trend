"""Fetch daily NOAA OISST v2.1 for East Asia (105-150E, 10-45N) via PSL OPeNDAP, one .npy per year (resumable)."""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import netCDF4

os.umask(0)
OUT = ROOT + "/data/processed/oisst_daily_eastasia"
os.makedirs(OUT, exist_ok=True)
BOX = (105.0, 150.0, 10.0, 45.0)


def year(y):
    fn = f"{OUT}/sst_{y}.npy"
    if os.path.exists(fn):
        return y, "cached"
    u = f"https://psl.noaa.gov/thredds/dodsC/Datasets/noaa.oisst.v2.highres/sst.day.mean.{y}.nc"
    for attempt in range(5):
        try:
            nc = netCDF4.Dataset(u)
            lat = nc["lat"][:]; lon = nc["lon"][:]
            j0, j1 = np.searchsorted(lat, BOX[2]), np.searchsorted(lat, BOX[3])
            i0, i1 = np.searchsorted(lon, BOX[0]), np.searchsorted(lon, BOX[1])
            nt = nc["sst"].shape[0]
            parts = []
            for a in range(0, nt, 30):
                parts.append(np.ma.filled(nc["sst"][a:min(nt, a + 30), j0:j1, i0:i1], np.nan).astype(np.float32))
            t = nc["time"][:]
            nc.close()
            arr = np.concatenate(parts)
            np.save(fn + ".tmp.npy", arr)
            os.replace(fn + ".tmp.npy", fn)
            np.save(f"{OUT}/time_{y}.npy", np.asarray(t))
            if y == 1982:
                np.save(f"{OUT}/lat.npy", np.asarray(lat[j0:j1])); np.save(f"{OUT}/lon.npy", np.asarray(lon[i0:i1]))
            return y, arr.shape
        except Exception as exc:
            print(f"retry {y} {exc}", flush=True)
            time.sleep(10 * (attempt + 1))
    return y, "FAILED"


if __name__ == "__main__":
    y0 = int(sys.argv[1]) if len(sys.argv) > 1 else 1982
    y1 = int(sys.argv[2]) if len(sys.argv) > 2 else 2026
    t0 = time.time()
    with ThreadPoolExecutor(3) as ex:
        for y, info in ex.map(year, range(y0, y1 + 1)):
            print(f"{y}: {info}  ({(time.time() - t0) / 60:.1f} min)", flush=True)
    for f in os.listdir(OUT):
        os.chmod(os.path.join(OUT, f), 0o777)
    os.chmod(OUT, 0o777)
    print("finished", flush=True)
