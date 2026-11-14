"""Fetch AIRS (Aqua) and OMI (Aura) Level-3 fields through NASA Cloud OPeNDAP variable subsetting -> monthly 1-deg cubes.

products
  airs    AIRS3STM v7.0 monthly (AIRS-only), ascending (13:30 LT) + descending (01:30) node:
          SurfAirTemp, TotH2OVap, TotO3, CO_VMR (600/500/400 hPa), CloudFrc
  airs_ch4 AIRS3STM v7.0: CH4_VMR ascending + descending at 600/500/400/300/250 hPa (AIRS CH4 peak sensitivity ~200-400 hPa)
  omto3   OMTO3d v004 daily 1 deg: ColumnAmountO3, UVAerosolIndex -> monthly mean (>=5 valid days)
  omno2   OMNO2d v004 daily 0.25 deg: ColumnAmountNO2TropCloudScreened -> monthly mean at 0.25 deg (>=3 valid days)
Outputs: data/processed/airs_omi/<product>/<var>.npy (time, lat, lon) south->north, -180..180; times.json; done.json
usage: python -I fetch_airs_omi.py <product> [workers]
"""
import os
import sys
import io
import re
import json
import time
import threading
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
os.umask(0)

AIRS_VARS = {"SurfAirTemp_A": "/ascending/Data_Fields/SurfAirTemp_A", "SurfAirTemp_D": "/descending/Data_Fields/SurfAirTemp_D",
             "TotH2OVap_A": "/ascending/Data_Fields/TotH2OVap_A", "TotH2OVap_D": "/descending/Data_Fields/TotH2OVap_D",
             "TotO3_A": "/ascending/Data_Fields/TotO3_A", "TotO3_D": "/descending/Data_Fields/TotO3_D",
             "CloudFrc_A": "/ascending/Data_Fields/CloudFrc_A",
             "CO_VMR_A": "/ascending/Data_Fields/CO_VMR_A[4:1:6][0:1:179][0:1:359]",
             "CO_VMR_D": "/descending/Data_Fields/CO_VMR_D[4:1:6][0:1:179][0:1:359]"}
CH4_VARS = {"CH4_VMR_A": "/ascending/Data_Fields/CH4_VMR_A[4:1:8][0:1:179][0:1:359]",
            "CH4_VMR_D": "/descending/Data_Fields/CH4_VMR_D[4:1:8][0:1:179][0:1:359]"}
NLEV = {"CO_VMR_A": 3, "CO_VMR_D": 3, "CH4_VMR_A": 5, "CH4_VMR_D": 5}
CFG = {
    "airs_ch4": dict(short_name="AIRS3STM", version="7.0", start="2002-09-01", daily=False, vars=CH4_VARS),
    "airs": dict(short_name="AIRS3STM", version="7.0", start="2002-09-01", daily=False),
    "omto3": dict(short_name="OMTO3d", version="004", start="2004-10-01", daily=True, min_days=5,
                  vars={"ColumnAmountO3": "/HDFEOS/GRIDS/OMI_Column_Amount_O3/Data_Fields/ColumnAmountO3",
                        "UVAerosolIndex": "/HDFEOS/GRIDS/OMI_Column_Amount_O3/Data_Fields/UVAerosolIndex"}),
    "omno2": dict(short_name="OMNO2d", version="004", start="2004-10-01", daily=True, min_days=3,
                  vars={"NO2Trop": "/HDFEOS/GRIDS/ColumnAmountNO2/Data_Fields/ColumnAmountNO2TropCloudScreened"}),
}
SH = {"airs": (180, 360), "airs_ch4": (180, 360), "omto3": (180, 360), "omno2": (720, 1440)}
io_lock = threading.Lock()


def granules(cfg):
    import earthaccess
    res = earthaccess.search_data(short_name=cfg["short_name"], version=cfg["version"], temporal=(cfg["start"], "2026-12-31"))
    out = []
    for g in res:
        d = pd.Timestamp(g["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10])
        cid = g["meta"]["collection-concept-id"]; gid = g["umm"]["GranuleUR"]
        out.append((d, f"https://opendap.earthdata.nasa.gov/collections/{cid}/granules/{gid}"))
    seen = {}
    for d, u in sorted(out):
        seen[d] = u
    return sorted(seen.items())


def fetch(session, url, ce, tries=6):
    import netCDF4
    for k in range(tries):
        try:
            r = session.get(url + ".dap.nc4", params={"dap4.ce": ce}, timeout=300)
            if r.status_code == 200:
                with io_lock:
                    with netCDF4.Dataset("mem.nc", memory=r.content) as nc:
                        nc.set_auto_mask(True)
                        out = {}

                        def walk(g):
                            for v in g.variables.values():
                                out[v.name] = np.ma.filled(v[:].astype(np.float32), np.nan)
                            for sg in g.groups.values():
                                walk(sg)
                        walk(nc)
                return out
            if r.status_code in (400, 404):
                print("  bad", r.status_code, url[-70:], re.sub(r"<[^>]+>|\s+", " ", r.text)[300:600], flush=True)
                return None
            print("  http", r.status_code, flush=True)
        except Exception as e:  # noqa: BLE001
            print("  err", type(e).__name__, str(e)[:120], flush=True)
        time.sleep(4 * (k + 1))
    return None


def main():
    key = sys.argv[1]; workers = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    cfg = CFG[key]
    import earthaccess
    earthaccess.login(strategy="netrc")
    local = threading.local()

    def sess():
        if not hasattr(local, "s"):
            local.s = earthaccess.get_requests_https_session()
        return local.s
    gr = granules(cfg)
    pdir = f"{ROOT}/data/processed/airs_omi/{key}"; os.makedirs(pdir, exist_ok=True)
    if cfg["daily"]:
        months = sorted({d.to_period("M").to_timestamp() for d, _ in gr})
        months = [m for m in months if m < pd.Timestamp.today().to_period("M").to_timestamp()]
        vars_ = cfg["vars"]
    else:
        months = [d for d, _ in gr]
        vars_ = cfg.get("vars", AIRS_VARS)
    n = len(months)
    print(f"{key}: {len(gr)} granules, {n} months {months[0].date()}..{months[-1].date()}", flush=True)
    json.dump([str(m.date()) for m in months], open(f"{pdir}/times.json", "w"))
    mm = {}
    for v in vars_:
        shp = (n, NLEV[v]) + SH[key] if v in NLEV else (n,) + SH[key]
        p = f"{pdir}/{v}.npy"
        mode = "r+" if os.path.exists(p) and np.load(p, mmap_mode="r").shape == shp else "w+"
        mm[v] = np.lib.format.open_memmap(p, mode=mode, dtype=np.float32, shape=shp)
        if mode == "w+":
            mm[v][:] = np.nan
    donep = f"{pdir}/done.json"
    done = set(json.load(open(donep))) if os.path.exists(donep) else set()
    ce = ";".join(vars_.values())
    lock = threading.Lock()
    t0 = time.time()
    if not cfg["daily"]:
        def work(i):
            if i in done:
                return
            r = fetch(sess(), dict(gr)[months[i]], ce)
            if r is None:
                return
            with lock:
                for v in vars_:
                    if v in r:
                        mm[v][i] = r[v][::-1] if r[v].ndim == 2 else r[v][:, ::-1]   # AIRS rows run north->south
                done.add(i)
        with ThreadPoolExecutor(workers) as ex:
            list(ex.map(work, range(n)))
    else:
        bym = {}
        for d, u in gr:
            bym.setdefault(d.to_period("M").to_timestamp(), []).append(u)
        for i, m in enumerate(months):
            if i in done:
                continue
            with ThreadPoolExecutor(workers) as ex:
                rs = [r for r in ex.map(lambda u: fetch(sess(), u, ce), bym[m]) if r is not None]
            for v, path in vars_.items():
                src = path.split("/")[-1]
                arrs = [r[src] for r in rs if src in r]
                if not arrs:
                    continue
                stack = np.stack(arrs)
                if v == "NO2Trop":
                    stack[stack < -1e29] = np.nan
                    stack = stack / 1e15        # 1e15 molecules/cm2
                elif v == "ColumnAmountO3":
                    stack[(stack <= 0) | (stack > 1000)] = np.nan
                elif v == "UVAerosolIndex":
                    stack[(stack < -30) | (stack > 30)] = np.nan
                cnt = np.isfinite(stack).sum(0)
                with np.errstate(all="ignore"):
                    mean = np.nanmean(stack, 0)
                mean[cnt < cfg["min_days"]] = np.nan
                mm[v][i] = mean
            done.add(i)
            if (len(done) % 6) == 0:
                for a in mm.values():
                    a.flush()
                json.dump(sorted(done), open(donep, "w"))
                el = time.time() - t0
                print(f"[{key}] {m.date()} ({len(rs)} days) {len(done)}/{n}, {el / 60:.0f} min", flush=True)
    for a in mm.values():
        a.flush()
    json.dump(sorted(done), open(donep, "w"))
    for dp, dns, fns in os.walk(pdir):
        for x in dns + fns:
            os.chmod(os.path.join(dp, x), 0o777)
    os.chmod(pdir, 0o777)
    print(f"finished {key}: {len(done)}/{n} in {(time.time() - t0) / 60:.0f} min", flush=True)


if __name__ == "__main__":
    main()
