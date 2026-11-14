"""Stream MODIS-Aqua L3 mapped monthly 9 km granules (OB.DAAC) into a float16 memmap.

usage: python -I fetch_obdaac.py chl [workers]
Output: data/processed/obdaac/<key>/<var>_9km.npy (nmonths, 2160, 4320) south->north, lon -180..180
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import os
import sys
import json
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd

ROOT = ROOT + ""
os.umask(0)
CFG = {
    "chl": dict(short_name="MODISA_L3m_CHL", version="2022.0", pat=".L3m.MO.CHL.chlor_a.9km", var="chlor_a"),
    "kd": dict(short_name="MODISA_L3m_KD", version="2022.0", pat=".L3m.MO.KD.Kd_490.9km", var="Kd_490"),
}


def main():
    key = sys.argv[1]
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    cfg = CFG[key]
    import earthaccess
    import h5py
    earthaccess.login(strategy="netrc")
    res = earthaccess.search_data(short_name=cfg["short_name"], version=cfg["version"],
                                  temporal=("2002-07-01", "2026-12-31"))
    gran = []
    for g in res:
        ur = g["umm"]["GranuleUR"]
        if cfg["pat"] in ur:
            d = g["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10]
            gran.append((pd.Timestamp(d).to_period("M").to_timestamp(), g))
    gran.sort(key=lambda x: x[0])
    times = [t for t, _ in gran]
    n = len(times)
    print(f"{key}: {n} monthly granules {times[0].date()}..{times[-1].date()}", flush=True)
    pdir = f"{ROOT}/data/processed/obdaac/{key}"; rdir = f"{ROOT}/data/raw/obdaac/{key}"
    os.makedirs(pdir, exist_ok=True); os.makedirs(rdir, exist_ok=True)
    json.dump([str(t.date()) for t in times], open(f"{pdir}/times.json", "w"))
    p = f"{pdir}/{cfg['var']}_9km.npy"
    mode = "r+" if os.path.exists(p) else "w+"
    mm = np.lib.format.open_memmap(p, mode=mode, dtype=np.float16, shape=(n, 2160, 4320))
    if mode == "w+":
        mm[:] = np.nan
    donep = f"{pdir}/done.json"
    done = set(json.load(open(donep))) if os.path.exists(donep) else set()
    lock = threading.Lock()

    def work(i):
        t, g = gran[i]
        for attempt in range(4):
            try:
                fs = earthaccess.download([g], local_path=rdir, show_progress=False)
                path = str(fs[0])
                with h5py.File(path, "r") as f:
                    ds = f[cfg["var"]]
                    x = ds[:].astype(np.float32)
                    fv = ds.attrs.get("_FillValue")
                    if fv is not None:
                        x[x == np.float32(np.ravel(fv)[0])] = np.nan
                    lat = f["lat"][:]
                if lat[0] > lat[-1]:
                    x = x[::-1]
                os.remove(path)
                break
            except Exception as exc:
                print(f"retry {i} {t.date()} {exc}", flush=True)
                time.sleep(5 * (attempt + 1))
        else:
            return i, False
        with lock:
            mm[i] = x.astype(np.float16)
            done.add(i)
            if len(done) % 20 == 0:
                mm.flush(); json.dump(sorted(done), open(donep, "w"))
        return i, True

    todo = [i for i in range(n) if i not in done]
    t0 = time.time()
    with ThreadPoolExecutor(workers) as ex:
        futs = [ex.submit(work, i) for i in todo]
        for k, fu in enumerate(as_completed(futs)):
            i, ok = fu.result()
            if (k + 1) % 20 == 0 or not ok:
                el = time.time() - t0
                print(f"[{key}] {k+1}/{len(todo)} ({el/60:.1f} min, eta {el/(k+1)*(len(todo)-k-1)/60:.0f} min) ok={ok}", flush=True)
    mm.flush(); json.dump(sorted(done), open(donep, "w"))
    for dp, dns, fns in os.walk(pdir):
        for x in dns + fns:
            os.chmod(os.path.join(dp, x), 0o777)
    print(f"finished {key}: {len(done)}/{n}", flush=True)


if __name__ == "__main__":
    main()
