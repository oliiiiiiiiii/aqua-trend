"""Download earthquake catalogues for the non-hydrology experiments (tasks 40+).

* USGS ComCat (FDSN event web service, CSV, eventtype=earthquake), year chunks split adaptively when > 19,000 events.
* Global CMT (GCMT) NDK files, 1976-now (independent moment-magnitude catalogue for the global M>=6 cross-check).

Output: data/raw/eq/usgs_<name>/<chunk>.csv, data/raw/eq/gcmt/*.ndk and combined data/processed/eq/<name>.csv.gz
Usage: python fetch_earthquakes.py [name ...]   (default: all)
"""
import os
import sys
import time
import glob
import io
import math
import pandas as pd
import requests
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402

UA = {"User-Agent": "aqua-trend-analysis/1.0"}
RAW = f"{ROOT}/data/raw/eq"
PROC = f"{ROOT}/data/processed/eq"
END = "2026-11-01"
# name: (minmag, start_year, bbox lon0, lon1, lat0, lat1 or None)
SETS = {
    "global_m45": (4.5, 1973, None),
    "cus_m25": (2.5, 1980, (-109.0, -88.0, 25.0, 40.5)),       # Oklahoma/Kansas/Texas/New Mexico/Colorado/Arkansas
    "taiwan_m3": (3.0, 1973, (118.5, 123.5, 20.5, 26.5)),
    "california_m25": (2.5, 1984, (-125.0, -114.0, 32.0, 42.0)),
    "japan_m4": (4.0, 1990, (128.0, 146.0, 30.0, 46.0)),
}
BASE = "https://earthquake.usgs.gov/fdsnws/event/1/"


def get(url, params, tries=6):
    for k in range(tries):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=180)
            if r.status_code == 200:
                return r.text
            if r.status_code == 204:
                return ""
            print("  http", r.status_code, r.text[:200], flush=True)
        except requests.RequestException as e:
            print("  err", e, flush=True)
        time.sleep(5 * (k + 1))
    raise RuntimeError(f"failed {url} {params}")


def fetch_range(name, minmag, bbox, t0, t1):
    d = f"{RAW}/usgs_{name}"
    os.makedirs(d, exist_ok=True)
    fn = f"{d}/{t0[:10]}_{t1[:10]}.csv"
    if os.path.exists(fn) and os.path.getsize(fn) > 0:
        return
    p = dict(starttime=t0, endtime=t1, minmagnitude=minmag, eventtype="earthquake", orderby="time-asc")
    if bbox:
        p.update(minlongitude=bbox[0], maxlongitude=bbox[1], minlatitude=bbox[2], maxlatitude=bbox[3])
    n = int(get(BASE + "count", p).strip() or 0)
    if n > 19000:
        mid = (pd.Timestamp(t0) + (pd.Timestamp(t1) - pd.Timestamp(t0)) / 2).strftime("%Y-%m-%dT%H:%M:%S")
        fetch_range(name, minmag, bbox, t0, mid)
        fetch_range(name, minmag, bbox, mid, t1)
        return
    txt = get(BASE + "query", dict(p, format="csv")) if n else "time,latitude,longitude,depth,mag,magType\n"
    with open(fn + ".part", "w") as f:
        f.write(txt)
    os.replace(fn + ".part", fn)
    print(f"  {name} {t0[:10]}..{t1[:10]}: {n}", flush=True)


def usgs(name):
    minmag, y0, bbox = SETS[name]
    years = list(range(y0, int(END[:4]) + 1))
    for y in years:
        t0 = f"{y}-01-01T00:00:00"
        t1 = f"{y + 1}-01-01T00:00:00" if y < int(END[:4]) else f"{END}T00:00:00"
        fetch_range(name, minmag, bbox, t0, t1)
    fs = sorted(glob.glob(f"{RAW}/usgs_{name}/*.csv"))
    df = pd.concat([pd.read_csv(f) for f in fs if os.path.getsize(f) > 60], ignore_index=True)
    df = df.drop_duplicates("id").sort_values("time")
    os.makedirs(PROC, exist_ok=True)
    df.to_csv(f"{PROC}/{name}.csv.gz", index=False)
    print(name, len(df), "events", df.time.min(), df.time.max(), flush=True)


def gcmt():
    d = f"{RAW}/gcmt"
    os.makedirs(d, exist_ok=True)
    urls = ["https://www.ldeo.columbia.edu/~gcmt/projects/CMT/catalog/jan76_dec20.ndk"]
    mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    for y in range(2021, 2027):
        for m in mon:
            urls.append(f"https://www.ldeo.columbia.edu/~gcmt/projects/CMT/catalog/NEW_MONTHLY/{y}/{m}{str(y)[2:]}.ndk")
    rows = []
    for u in urls:
        fn = f"{d}/{os.path.basename(u)}"
        if not os.path.exists(fn):
            r = requests.get(u, headers=UA, timeout=300)
            if r.status_code != 200:
                continue
            open(fn, "w").write(r.text)
            print("  gcmt", os.path.basename(u), flush=True)
        lines = open(fn).read().splitlines()
        for i in range(0, len(lines) - 4, 5):
            l1, l2, l4 = lines[i], lines[i + 1], lines[i + 3]
            try:
                date = l1[5:15].strip().replace("/", "-"); tm = l1[16:26].strip()
                lat, lon = float(l1[27:33]), float(l1[34:41]); dep = float(l1[42:47])
                expo = int(l4[0:2])
                m0 = float(lines[i + 4][49:56]) * 10 ** expo          # scalar moment, dyne-cm (line 5)
                mw = 2.0 / 3.0 * math.log10(m0) - 10.7333
                rows.append(dict(time=f"{date}T{tm}", latitude=lat, longitude=lon, depth=dep, mw=round(mw, 2), name=l2[:16].strip()))
            except Exception:
                continue
    df = pd.DataFrame(rows).drop_duplicates("name").sort_values("time")
    os.makedirs(PROC, exist_ok=True)
    df.to_csv(f"{PROC}/gcmt.csv.gz", index=False)
    print("gcmt", len(df), "events", df.time.min(), df.time.max(), flush=True)


if __name__ == "__main__":
    names = sys.argv[1:] or list(SETS) + ["gcmt"]
    for nm in names:
        gcmt() if nm == "gcmt" else usgs(nm)
    tl.fix_perms(RAW); tl.fix_perms(PROC)
