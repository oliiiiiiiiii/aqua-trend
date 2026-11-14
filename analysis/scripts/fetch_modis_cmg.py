"""Stream MODIS monthly CMG granules (LP DAAC): download -> QA + reduce -> delete raw.

Outputs (data/processed/modis/<key>/):
  global_0p1.npy   float16 memmap (nmonths, 1800, 3600)  - 2x2 block mean of valid 0.05 deg pixels
  eastasia_0p05.npy float16 memmap (nmonths, 700, 900)  - full-res subset lon 100..145E, lat 15..50N
  times.json       list of month-start dates; done.json list of finished indices (resumable)

usage: python -I fetch_modis_cmg.py <key> [workers]
  keys: ndvi (MOD13C2), lst_day / lst_night (MOD11C3, both written in one pass with key lst)
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
    "ndvi": dict(short_name="MOD13C2", version="061",
                 vars={"ndvi": "CMG 0.05 Deg Monthly NDVI", "evi": "CMG 0.05 Deg Monthly EVI"},
                 qa="CMG 0.05 Deg Monthly pixel reliability"),
    "lst": dict(short_name="MOD11C3", version="061",
                vars={"lst_day": "LST_Day_CMG", "lst_night": "LST_Night_CMG"},
                qa=None),
}
EA = (100.0, 145.0, 15.0, 50.0)  # lon0, lon1, lat0, lat1


def reduce_file(path, cfg):
    from pyhdf.SD import SD
    f = SD(path)
    out = {}
    if cfg["qa"]:
        rel = f.select(cfg["qa"]).get().astype(np.int16)
        good = (rel == 0) | (rel == 1)
    else:
        good = None
    for key, sds in cfg["vars"].items():
        d = f.select(sds)
        a = d.attributes()
        raw = d.get()
        fill = a.get("_FillValue", None)
        x = raw.astype(np.float32)
        bad = np.zeros(raw.shape, bool)
        if fill is not None:
            bad |= raw == fill
        if "valid_range" in a:
            lo, hi = a["valid_range"]
            bad |= (raw < lo) | (raw > hi)
        sf = float(a.get("scale_factor", 1.0))
        off = float(a.get("add_offset", 0.0))
        if cfg["short_name"] == "MOD13C2":
            x = (x - off) / sf  # MODIS VI convention: value = raw / 10000
        else:
            x = x * sf + off  # LST: raw * 0.02 (K)
            bad |= raw == 0
        if good is not None:
            bad |= ~good
        x[bad] = np.nan
        out[key] = x  # (3600, 7200), row 0 = 90N
    f.end()
    return out


def block_mean(x, k=2):
    ny, nx = x.shape
    v = x.reshape(ny // k, k, nx // k, k)
    with np.errstate(all="ignore"):
        return np.nanmean(v, axis=(1, 3))


def main():
    key = sys.argv[1]
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    cfg = CFG[key]
    import earthaccess
    earthaccess.login(strategy="netrc")
    res = earthaccess.search_data(short_name=cfg["short_name"], version=cfg["version"],
                                  temporal=("2000-02-01", "2026-12-31"))
    gran = []
    for g in res:
        d = g["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10]
        gran.append((pd.Timestamp(d).to_period("M").to_timestamp(), g))
    gran.sort(key=lambda x: x[0])
    times = [t for t, _ in gran]
    n = len(times)
    print(f"{cfg['short_name']}: {n} granules {times[0].date()} .. {times[-1].date()}", flush=True)
    pdir = f"{ROOT}/data/processed/modis/{key}"
    rdir = f"{ROOT}/data/raw/modis/{key}"
    os.makedirs(pdir, exist_ok=True); os.makedirs(rdir, exist_ok=True)
    json.dump([str(t.date()) for t in times], open(f"{pdir}/times.json", "w"))
    mm = {}
    for v in cfg["vars"]:
        for nm, shp in (("global_0p1", (n, 1800, 3600)), ("eastasia_0p05", (n, 700, 900))):
            p = f"{pdir}/{v}_{nm}.npy"
            mode = "r+" if os.path.exists(p) else "w+"
            mm[(v, nm)] = np.lib.format.open_memmap(p, mode=mode, dtype=np.float16, shape=shp)
            if mode == "w+":
                mm[(v, nm)][:] = np.nan
    donep = f"{pdir}/done.json"
    done = set(json.load(open(donep))) if os.path.exists(donep) else set()
    lock = threading.Lock()
    # East Asia indices in the 0.05 grid (row 0 = 89.975N; col 0 = -179.975)
    r0 = int(round((90 - EA[3]) / 0.05)); r1 = int(round((90 - EA[2]) / 0.05))
    c0 = int(round((EA[0] + 180) / 0.05)); c1 = int(round((EA[1] + 180) / 0.05))

    def work(i):
        t, g = gran[i]
        for attempt in range(4):
            try:
                fs = earthaccess.download([g], local_path=rdir, show_progress=False)
                path = str(fs[0])
                red = reduce_file(path, cfg)
                os.remove(path)
                break
            except Exception as exc:
                print(f"retry {i} {t.date()} {exc}", flush=True)
                time.sleep(5 * (attempt + 1))
        else:
            return i, False
        with lock:
            for v, x in red.items():
                mm[(v, "global_0p1")][i] = block_mean(x)[::-1].astype(np.float16)  # flip to south->north
                mm[(v, "eastasia_0p05")][i] = x[r0:r1, c0:c1][::-1].astype(np.float16)
            done.add(i)
            if len(done) % 10 == 0:
                for a in mm.values():
                    a.flush()
                json.dump(sorted(done), open(donep, "w"))
        return i, True

    todo = [i for i in range(n) if i not in done]
    t0 = time.time()
    with ThreadPoolExecutor(workers) as ex:
        futs = [ex.submit(work, i) for i in todo]
        for k, fu in enumerate(as_completed(futs)):
            i, ok = fu.result()
            if (k + 1) % 10 == 0 or not ok:
                el = time.time() - t0
                print(f"[{key}] {k+1}/{len(todo)} ({el/60:.1f} min, eta {el/(k+1)*(len(todo)-k-1)/60:.0f} min) ok={ok}",
                      flush=True)
    for a in mm.values():
        a.flush()
    json.dump(sorted(done), open(donep, "w"))
    for dp, dns, fns in os.walk(pdir):
        for x in dns + fns:
            os.chmod(os.path.join(dp, x), 0o777)
    print(f"finished {key}: {len(done)}/{n}", flush=True)


if __name__ == "__main__":
    main()
