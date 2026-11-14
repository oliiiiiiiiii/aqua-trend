"""Download small non-hydrology datasets for tasks 44+.

* IERS EOP 20 C04 (daily polar motion x/y and length-of-day, 1962-now)
* NASA Ozone Watch daily Antarctic ozone-hole area and minimum ozone (TOMS+OMI+OMPS), 1979-now
* NASA FIRMS MODIS C6.1 active-fire archive, all countries, 2000-2025 (yearly zips) -> aggregated 0.5 deg monthly fire counts

Usage: python fetch_nonhydro.py [eop] [ozone] [firms]
"""
import os
import sys
import glob
import time
import zipfile
import numpy as np
import pandas as pd
import requests
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402

UA = {"User-Agent": "aqua-trend-analysis/1.0"}
RAW = f"{ROOT}/data/raw"
PROC = f"{ROOT}/data/processed"


def dl(url, fn, tries=5):
    if os.path.exists(fn) and os.path.getsize(fn) > 0:
        return True
    os.makedirs(os.path.dirname(fn), exist_ok=True)
    for k in range(tries):
        try:
            with requests.get(url, headers=UA, timeout=600, stream=True) as r:
                if r.status_code == 404:
                    return False
                r.raise_for_status()
                with open(fn + ".part", "wb") as f:
                    for ch in r.iter_content(1 << 20):
                        f.write(ch)
            os.replace(fn + ".part", fn)
            return True
        except requests.RequestException as e:
            print("  retry", url, e, flush=True)
            time.sleep(10 * (k + 1))
    return False


def eop():
    dl("https://datacenter.iers.org/data/latestVersion/EOP_20_C04_one_file_1962-now.txt", f"{RAW}/eop/EOP_20_C04_1962-now.txt")
    print("eop ok", flush=True)


def ozone():
    for y in range(1979, 2027):
        for kind in ("areas", "mins"):
            ok = dl(f"https://ozonewatch.gsfc.nasa.gov/meteorology/figures/ozone/to3{kind}_{y}_toms+omi+omps.txt", f"{RAW}/ozone/to3{kind}_{y}.txt")
            if not ok:
                print("  missing", kind, y, flush=True)
    print("ozone ok", flush=True)


def firms():
    d = f"{RAW}/firms"
    os.makedirs(f"{PROC}/firms", exist_ok=True)
    for y in range(2000, 2026):
        zf = f"{d}/modis_{y}_all_countries.zip"
        out = f"{PROC}/firms/modis_{y}_0p5_monthly.npz"
        if os.path.exists(out) and "count_T" in np.load(out).files:
            continue
        if not dl(f"https://firms.modaps.eosdis.nasa.gov/data/country/zips/modis_{y}_all_countries.zip", zf):
            print("  no zip", y, flush=True)
            continue
        cnt = np.zeros((12, 360, 720), np.float32); frp = np.zeros((12, 360, 720), np.float32)
        cT = np.zeros((12, 360, 720), np.float32); cA = np.zeros((12, 360, 720), np.float32)
        n_all = 0
        with zipfile.ZipFile(zf) as z:
            for nm in z.namelist():
                if not nm.endswith(".csv"):
                    continue
                with z.open(nm) as f:
                    df = pd.read_csv(f, usecols=["latitude", "longitude", "acq_date", "confidence", "frp", "type", "satellite"])
                df = df[(df["type"] == 0) & (df["confidence"] >= 30)]   # presumed vegetation fires, nominal+high confidence
                if df.empty:
                    continue
                mo = pd.to_datetime(df.acq_date).dt.month.values - 1
                i = np.clip(((df.latitude.values + 90) / 0.5).astype(int), 0, 359)
                j = np.clip(((df.longitude.values + 180) / 0.5).astype(int), 0, 719)
                np.add.at(cnt, (mo, i, j), 1)
                np.add.at(frp, (mo, i, j), df.frp.values.astype(np.float32))
                st = df.satellite.astype(str).str.upper().str[0].values
                for code, arr in (("T", cT), ("A", cA)):
                    k = st == code
                    np.add.at(arr, (mo[k], i[k], j[k]), 1)
                n_all += len(df)
        np.savez_compressed(out, count=cnt, frp=frp, count_T=cT, count_A=cA)
        os.chmod(out, 0o777)
        print(f"  firms {y}: {n_all} vegetation-fire detections", flush=True)
    print("firms ok", flush=True)


if __name__ == "__main__":
    what = sys.argv[1:] or ["eop", "ozone", "firms"]
    for w in what:
        globals()[w]()
    for p in (f"{RAW}/eop", f"{RAW}/ozone", f"{RAW}/firms", f"{PROC}/firms"):
        if os.path.exists(p):
            tl.fix_perms(p)
