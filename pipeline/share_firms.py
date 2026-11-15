#!/usr/bin/env python3
"""fire_count layer from the share's FIRMS MODIS archive (data/share/firms/modis_<year>_all_countries.zip).

Each zip holds one csv per country. We
  * keep only MODIS vegetation-fire detections: type == 0 (drops 1 active volcano, 2 other static land
    source, 3 offshore); no confidence filter;
  * keep one satellite only (default Terra: Aqua only starts 2002-07, which would double the counts in
    the middle of the series; option --sat Terra,Aqua to use both);
  * dedupe points repeated in several country files (country boxes overlap near borders): key =
    lat/lon (1e-4 deg), month/day, acq_time;
  * bin onto the 0.5 deg mask grid as COUNTS and sum over each region's cells (plain sum, no area mean).
Months inside the source period with no detection = 0; months outside it = NaN
(period = first to last month with data in the zips, taking only complete months).

  python -I pipeline/share_firms.py [--sat Terra] [dir_with_zips]
"""
import csv, glob, io, json, os, re, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from multiprocessing import Pool
import numpy as np
from share_common import cell_index, region_sum, Regions
from regions import save_layer, REPO


def parse_zip(args):
    path, sats = args
    year = int(re.search(r"modis_(\d{4})_", path).group(1))
    z = zipfile.ZipFile(path)
    cols = {k: [] for k in ("lat", "lon", "md", "t")}
    st = dict(files=0, rows=0, kept_type0=0, other_type=0, other_sat=0, aqua_rows=0, mindate="9999", maxdate="0000", notype=0)
    for info in z.infolist():
        if not info.filename.endswith(".csv"):
            continue
        st["files"] += 1
        with z.open(info) as f:
            head = f.readline().decode().strip().split(",")
            ix = {n: i for i, n in enumerate(head)}
            need = [ix[k] for k in ("latitude", "longitude", "acq_date", "acq_time", "satellite")]
            it = ix.get("type"); st["notype"] += it is None
            while True:
                lines = f.readlines(64 << 20)
                if not lines:
                    break
                rows = [l.decode().rstrip("\r\n").split(",") for l in lines if len(l) > 10]
                st["rows"] += len(rows)
                sat = np.array([r[need[4]] for r in rows])
                typ = np.array([r[it] if it is not None else "0" for r in rows])
                dates = [r[need[2]] for r in rows]
                st["mindate"] = min(st["mindate"], min(dates)); st["maxdate"] = max(st["maxdate"], max(dates))
                st["aqua_rows"] += int((sat == "Aqua").sum())
                ok_sat = np.isin(sat, sats); ok_t = typ == "0"
                st["other_sat"] += int((~ok_sat).sum()); st["other_type"] += int((ok_sat & ~ok_t).sum())
                keep = np.flatnonzero(ok_sat & ok_t)
                if keep.size == 0:
                    continue
                cols["lat"].append(np.array([rows[i][need[0]] for i in keep], np.float64))
                cols["lon"].append(np.array([rows[i][need[1]] for i in keep], np.float64))
                cols["md"].append(np.array([int(dates[i][5:7]) * 32 + int(dates[i][8:10]) for i in keep], np.uint64))
                cols["t"].append(np.array([int(rows[i][need[3]]) for i in keep], np.uint64))
    if not cols["lat"]:
        return year, np.zeros((12, 360 * 720), np.float32), st
    lat = np.concatenate(cols["lat"]); lon = np.concatenate(cols["lon"])
    md = np.concatenate(cols["md"]); t = np.concatenate(cols["t"])
    key = (np.round((lat + 90) * 1e4).astype(np.uint64) << np.uint64(43)) | \
          (np.round((lon + 180) * 1e4).astype(np.uint64) << np.uint64(21)) | (md << np.uint64(12)) | t
    _, first = np.unique(key, return_index=True)
    st["kept_type0"] = int(lat.size); st["unique"] = int(first.size)
    lat, lon, md = lat[first], lon[first], md[first]
    month = (md >> np.uint64(5)).astype(np.int64) - 1
    grid = np.zeros((12, 360 * 720), np.float32)
    np.add.at(grid, (month, cell_index(lat, lon)), 1)
    return year, grid, st


if __name__ == "__main__":
    args = sys.argv[1:]
    sats = ["Terra"]
    if "--sat" in args:
        i = args.index("--sat"); sats = args[i + 1].split(","); del args[i:i + 2]
    folder = args[0] if args else os.path.join(REPO, "data/share/firms")
    zips = sorted(glob.glob(os.path.join(folder, "modis_*_all_countries.zip")))
    with Pool(min(8, len(zips))) as p:
        res = p.map(parse_zip, [(z, sats) for z in zips], chunksize=1)
    reg = Regions()
    first = min(s["mindate"] for _, _, s in res); last = max(s["maxdate"] for _, _, s in res)
    years = [y for y, _, _ in res]
    # complete months only: first month counts if data starts on day 1..7 (satellite start), last if it ends >= day 28
    y0, m0, d0 = map(int, first.split("-")); y1, m1, d1 = map(int, last.split("-"))
    if d1 < 28:
        m1 -= 1
        if m1 == 0: y1, m1 = y1 - 1, 12
    months = [f"{y}-{m:02d}" for y in range(y0, y1 + 1) for m in range(1, 13) if (y, m) >= (y0, m0) and (y, m) <= (y1, m1)]
    grids = {y: g for y, g, _ in res}
    ystart = years[0]
    full = np.full((len(reg.ids), 12 * (years[-1] - ystart + 1)), np.nan)   # a year without a zip stays NaN
    for y in years:
        full[:, (y - ystart) * 12:(y - ystart) * 12 + 12] = region_sum(reg, grids[y].T)
    sel = [(int(m[:4]) - ystart) * 12 + int(m[5:]) - 1 for m in months]
    series = full[:, sel].astype(np.float32)
    tot = {k: sum(s.get(k, 0) for _, _, s in res) for k in ("files", "rows", "other_type", "other_sat", "kept_type0", "unique", "aqua_rows", "notype")}
    print("firms:", first, "..", last, "months", months[0], months[-1], tot)
    meta = dict(
        name="野火熱點數", category="fire", product="MODIS FIRMS 野火熱點（Terra，各國 zip 合併去重）",
        nasa=True, family="FIRMS", unit="count/month", visual="地表上閃爍的火點，數量隨熱點數",
        caveat="只計 Terra MODIS 的植被火（type=0，排除火山／工業／離岸），無信心度篩選；"
               "只用 Terra 以避免 Aqua 於 2002-07 加入造成的計數倍增，但 Terra 軌道自約 2020 年起漂移、過境時間提早，"
               "後期偵測數可能略偏；熱點是衛星過境瞬間的偵測，不是燃燒面積；"
               f"{months[0]} 之前為空值，區域內無偵測的月份為 0",
        source="share", processed="2026-11-15",
        source_files=[os.path.basename(z) for z in zips],
        satellites=sats, period_note=f"data {first}..{last}",
        dedupe="zips are per country; points repeated in several country files removed (lat/lon 1e-4, date, time)",
        stats=tot)
    save_layer("fire_count", reg, months, series, meta)
    x = np.load(os.path.join(REPO, "data/interim/layers/fire_count.npz"))
    print("fire_count:", np.isfinite(x["series"]).any(1).sum(), "regions with data;", x["start"], x["series"].shape)
