"""Stream GES DISC monthly products (download -> extract variables -> regrid -> delete raw) into float32 memmaps.

usage: python -I fetch_gesdisc.py <key> [workers] [start] [end]
keys:
  gldas   GLDAS_NOAH025_M 2.1 (2000-01 ->): global 0.5 deg (block mean of 0.25) + East Asia 0.25 subset
  m2int   MERRA2 M2TMNXINT (UFLXQV, VFLXQV, DQVDT_DYN, ...) native 0.5x0.625
  m2flx   MERRA2 M2TMNXFLX (EVAP, PRECTOT, PRECTOTCORR) native 0.5x0.625
  m2aer   MERRA2 M2TMNXAER aerosol optical depth by species (dust, sea salt, sulfate, BC, OC, total) + dust surface mass
  imerg   GPM_3IMERGM V07 precipitation: global 0.5 deg + East Asia 0.1 subset (mm/day)
Outputs: data/processed/gesdisc/<key>/<var>_<grid>.npy (+ times.json, done.json, grid json)
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
EA = (100.0, 145.0, 15.0, 50.0)

GLDAS_VARS = ["Evap_tavg", "PotEvap_tavg", "ESoil_tavg", "ECanop_tavg", "Tveg_tavg", "Rainf_f_tavg", "Qs_acc", "Qsb_acc",
              "SoilMoi0_10cm_inst", "SoilMoi10_40cm_inst", "SoilMoi40_100cm_inst", "SoilMoi100_200cm_inst",
              "RootMoist_inst", "SWE_inst", "Tair_f_inst", "Qair_f_inst", "Psurf_f_inst", "Swnet_tavg", "Lwnet_tavg",
              "Qle_tavg", "Qh_tavg", "SWdown_f_tavg", "Wind_f_inst"]
CFG = {
    "gldas": dict(short_name="GLDAS_NOAH025_M", version="2.1", start="2000-01-01", vars=GLDAS_VARS, kind="gldas"),
    "m2int": dict(short_name="M2TMNXINT", version="5.12.4", start="1980-01-01",
                  vars=["UFLXQV", "VFLXQV", "DQVDT_DYN", "DQVDT_PHY", "DQVDT_ANA", "PRECCU", "PRECLS", "PRECSN", "EVAP"],
                  kind="merra"),
    "m2flx": dict(short_name="M2TMNXFLX", version="5.12.4", start="1980-01-01", vars=["EVAP", "PRECTOT", "PRECTOTCORR"],
                  kind="merra"),
    "m2lnd": dict(short_name="M2TMNXLND", version="5.12.4", start="2000-01-01",
                  vars=["EVLAND", "GWETROOT", "GWETTOP", "SWLAND", "LWLAND", "PRECTOTLAND", "RUNOFF", "BASEFLOW", "TSURF", "LHLAND", "SHLAND"],
                  kind="merra"),
    "m2aer": dict(short_name="M2TMNXAER", version="5.12.4", start="1980-01-01",
                  vars=["DUEXTTAU", "TOTEXTTAU", "SSEXTTAU", "SUEXTTAU", "BCEXTTAU", "OCEXTTAU", "DUSMASS"], kind="merra"),
    "imerg": dict(short_name="GPM_3IMERGM", version="07", start="1998-01-01", vars=["precipitation"], kind="imerg"),
}


def block(x, ky, kx):
    ny, nx = x.shape
    v = x[: ny // ky * ky, : nx // kx * kx].reshape(ny // ky, ky, nx // kx, kx)
    with np.errstate(all="ignore"):
        return np.nanmean(v, axis=(1, 3))


def reduce_gldas(path, vars_):
    import netCDF4
    out = {}
    with netCDF4.Dataset(path) as nc:
        nc.set_auto_mask(True)
        lat = nc["lat"][:]; lon = nc["lon"][:]
        for v in vars_:
            if v not in nc.variables:
                continue
            x = np.ma.filled(nc[v][0], np.nan).astype(np.float32)  # (600, 1440), lat -59.875..89.875
            g = np.full((360, 720), np.nan, np.float32)
            g[60:, :] = block(x, 2, 2)  # 0.5 deg rows from lat -59.75
            r0 = int(round((EA[2] - lat[0]) / 0.25)); r1 = int(round((EA[3] - lat[0]) / 0.25))
            c0 = int(round((EA[0] - lon[0]) / 0.25)); c1 = int(round((EA[1] - lon[0]) / 0.25))
            out[(v, "g0p5")] = g
            out[(v, "ea0p25")] = x[r0:r1, c0:c1]
    return out


def reduce_merra(path, vars_):
    import netCDF4
    out = {}
    with netCDF4.Dataset(path) as nc:
        nc.set_auto_mask(True)
        for v in vars_:
            if v in nc.variables:
                out[(v, "native")] = np.ma.filled(nc[v][0], np.nan).astype(np.float32)  # (361, 576)
    return out


def reduce_imerg(path, vars_):
    import h5py
    with h5py.File(path, "r") as f:
        x = f["Grid/precipitation"][0].astype(np.float32)  # (3600 lon, 1800 lat), mm/hr
        fv = f["Grid/precipitation"].attrs.get("_FillValue")
    x = x.T  # (lat, lon), south->north
    if fv is not None:
        x[x == np.ravel(fv)[0]] = np.nan
    x[x < 0] = np.nan
    x = x * 24.0  # mm/day
    r0 = int(round((EA[2] + 90) / 0.1)); r1 = int(round((EA[3] + 90) / 0.1))
    c0 = int(round((EA[0] + 180) / 0.1)); c1 = int(round((EA[1] + 180) / 0.1))
    return {("precipitation", "g0p5"): block(x, 5, 5), ("precipitation", "ea0p1"): x[r0:r1, c0:c1]}


SHAPES = {"g0p5": (360, 720), "ea0p25": (140, 180), "native": (361, 576), "ea0p1": (350, 450)}


def main():
    key = sys.argv[1]
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    cfg = CFG[key]
    start = sys.argv[3] if len(sys.argv) > 3 else cfg["start"]
    end = sys.argv[4] if len(sys.argv) > 4 else "2026-12-31"
    import earthaccess
    earthaccess.login(strategy="netrc")
    res = earthaccess.search_data(short_name=cfg["short_name"], version=cfg["version"], temporal=(start, end))
    gran = []
    for g in res:
        d = g["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10]
        gran.append((pd.Timestamp(d).to_period("M").to_timestamp(), g))
    gran.sort(key=lambda x: x[0])
    # de-duplicate months (keep last listed)
    seen = {}
    for t, g in gran:
        seen[t] = g
    gran = sorted(seen.items())
    times = [t for t, _ in gran]
    n = len(times)
    print(f"{key}: {n} months {times[0].date()}..{times[-1].date()}", flush=True)
    pdir = f"{ROOT}/data/processed/gesdisc/{key}"; rdir = f"{ROOT}/data/raw/gesdisc/{key}"
    os.makedirs(pdir, exist_ok=True); os.makedirs(rdir, exist_ok=True)
    tj = f"{pdir}/times.json"
    if os.path.exists(tj) and json.load(open(tj)) != [str(t.date()) for t in times]:
        raise SystemExit("times changed vs existing cube; move old outputs first")
    json.dump([str(t.date()) for t in times], open(tj, "w"))
    grids = {"gldas": ["g0p5", "ea0p25"], "merra": ["native"], "imerg": ["g0p5", "ea0p1"]}[cfg["kind"]]
    mm = {}
    for v in cfg["vars"]:
        for gname in grids:
            p = f"{pdir}/{v}_{gname}.npy"
            mode = "r+" if os.path.exists(p) else "w+"
            mm[(v, gname)] = np.lib.format.open_memmap(p, mode=mode, dtype=np.float32, shape=(n,) + SHAPES[gname])
            if mode == "w+":
                mm[(v, gname)][:] = np.nan
    donep = f"{pdir}/done.json"
    done = set(json.load(open(donep))) if os.path.exists(donep) else set()
    lock = threading.Lock()
    io_lock = threading.Lock()  # netCDF4/HDF5 C library is not thread-safe
    red = {"gldas": reduce_gldas, "merra": reduce_merra, "imerg": reduce_imerg}[cfg["kind"]]

    def work(i):
        t, g = gran[i]
        sub = f"{rdir}/{i}"
        os.makedirs(sub, exist_ok=True)
        for attempt in range(5):
            try:
                fs = earthaccess.download([g], local_path=sub, show_progress=False)
                path = str(fs[0])
                with io_lock:
                    r = red(path, cfg["vars"])
                os.remove(path)
                break
            except Exception as exc:
                print(f"retry {i} {t.date()} {type(exc).__name__}: {str(exc)[:120]}", flush=True)
                time.sleep(5 * (attempt + 1))
        else:
            return i, False
        with lock:
            for k, x in r.items():
                if k in mm:
                    mm[k][i] = x
            done.add(i)
            if len(done) % 20 == 0:
                for a in mm.values():
                    a.flush()
                json.dump(sorted(done), open(donep, "w"))
        try:
            os.rmdir(sub)
        except OSError:
            pass
        return i, True

    todo = [i for i in range(n) if i not in done][::-1]  # newest first
    t0 = time.time()
    with ThreadPoolExecutor(workers) as ex:
        futs = [ex.submit(work, i) for i in todo]
        for k, fu in enumerate(as_completed(futs)):
            i, ok = fu.result()
            if (k + 1) % 20 == 0 or not ok:
                el = time.time() - t0
                print(f"[{key}] {k+1}/{len(todo)} ({el/60:.1f} min, eta {el/(k+1)*(len(todo)-k-1)/60:.0f} min) ok={ok}", flush=True)
    for a in mm.values():
        a.flush()
    json.dump(sorted(done), open(donep, "w"))
    for dp, dns, fns in os.walk(pdir):
        for x in dns + fns:
            os.chmod(os.path.join(dp, x), 0o777)
    os.chmod(pdir, 0o777)
    print(f"finished {key}: {len(done)}/{n}", flush=True)


if __name__ == "__main__":
    main()
