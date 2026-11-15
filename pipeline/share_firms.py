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
Months with selected-satellite archive records but no regional vegetation detection = 0.
A month with no selected-satellite records anywhere in its archive is unknown (NaN).
These detection archives do not establish cloud-free observation coverage for each region.

  python -I pipeline/share_firms.py [--sat Terra] [dir_with_zips]
"""
import calendar, datetime as dt, glob, os, re, sys, zipfile
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
    observed_months = np.zeros(12, dtype=bool)
    for info in z.infolist():
        if not info.filename.endswith(".csv"):
            continue
        st["files"] += 1
        with z.open(info) as f:
            head = f.readline().decode().strip().split(",")
            ix = {n: i for i, n in enumerate(head)}
            need = [ix[k] for k in ("latitude", "longitude", "acq_date", "acq_time", "satellite")]
            if "type" not in ix:
                raise ValueError(f"{path}:{info.filename}: missing type column; vegetation fires cannot be identified")
            it = ix["type"]
            while True:
                lines = f.readlines(64 << 20)
                if not lines:
                    break
                rows = [l.decode().rstrip("\r\n").split(",") for l in lines if len(l) > 10]
                if not rows:
                    continue
                st["rows"] += len(rows)
                sat = np.array([r[need[4]] for r in rows])
                typ = np.array([r[it] for r in rows])
                dates = [r[need[2]] for r in rows]
                st["aqua_rows"] += int((sat == "Aqua").sum())
                ok_sat = np.isin(sat, sats); ok_t = typ == "0"
                satellite_dates = [dates[i] for i in np.flatnonzero(ok_sat)]
                if satellite_dates:
                    if any(int(date[:4]) != year for date in satellite_dates):
                        raise ValueError(f"{path}: observation year differs from archive year")
                    st["mindate"] = min(st["mindate"], min(satellite_dates))
                    st["maxdate"] = max(st["maxdate"], max(satellite_dates))
                    for date in satellite_dates:
                        observed_months[int(date[5:7]) - 1] = True
                st["other_sat"] += int((~ok_sat).sum()); st["other_type"] += int((ok_sat & ~ok_t).sum())
                keep = np.flatnonzero(ok_sat & ok_t)
                if keep.size == 0:
                    continue
                cols["lat"].append(np.array([rows[i][need[0]] for i in keep], np.float64))
                cols["lon"].append(np.array([rows[i][need[1]] for i in keep], np.float64))
                cols["md"].append(np.array([int(dates[i][5:7]) * 32 + int(dates[i][8:10]) for i in keep], np.uint64))
                cols["t"].append(np.array([int(rows[i][need[3]]) for i in keep], np.uint64))
    grid = np.full((12, 360 * 720), np.nan, np.float32)
    grid[observed_months] = 0
    if not cols["lat"]:
        return year, grid, st
    lat = np.concatenate(cols["lat"]); lon = np.concatenate(cols["lon"])
    md = np.concatenate(cols["md"]); t = np.concatenate(cols["t"])
    key = (np.round((lat + 90) * 1e4).astype(np.uint64) << np.uint64(43)) | \
          (np.round((lon + 180) * 1e4).astype(np.uint64) << np.uint64(21)) | (md << np.uint64(12)) | t
    _, first = np.unique(key, return_index=True)
    st["kept_type0"] = int(lat.size); st["unique"] = int(first.size)
    lat, lon, md = lat[first], lon[first], md[first]
    month = (md >> np.uint64(5)).astype(np.int64) - 1
    np.add.at(grid, (month, cell_index(lat, lon)), 1)
    return year, grid, st


def archive_months(first, last):
    """Conservative archive boundaries, not a claim of complete satellite coverage."""
    y0, m0, d0 = map(int, first.split("-")); y1, m1, d1 = map(int, last.split("-"))
    if d0 > 7:
        m0 += 1
        if m0 == 13: y0, m0 = y0 + 1, 1
    if d1 < calendar.monthrange(y1, m1)[1]:
        m1 -= 1
        if m1 == 0: y1, m1 = y1 - 1, 12
    return [f"{y}-{m:02d}" for y in range(y0, y1 + 1) for m in range(1, 13)
            if (y0, m0) <= (y, m) <= (y1, m1)]


def monthly_region_counts(reg, grid):
    counts = region_sum(reg, grid.T)
    counts[:, ~np.isfinite(grid).any(axis=1)] = np.nan
    return counts


if __name__ == "__main__":
    args = sys.argv[1:]
    sats = ["Terra"]
    if "--sat" in args:
        i = args.index("--sat"); sats = args[i + 1].split(","); del args[i:i + 2]
    folder = args[0] if args else os.path.join(REPO, "data/share/firms")
    zips = sorted(glob.glob(os.path.join(folder, "modis_*_all_countries.zip")))
    if not zips:
        sys.exit("No FIRMS archives found; see pipeline/README.md for official input sources.")
    with Pool(min(8, len(zips))) as p:
        res = p.map(parse_zip, [(z, sats) for z in zips], chunksize=1)
    reg = Regions()
    dated = [s for _, _, s in res if s["mindate"] != "9999"]
    if not dated:
        sys.exit("No records for the selected satellite; empty archives are not zero-fire observations.")
    first = min(s["mindate"] for s in dated); last = max(s["maxdate"] for s in dated)
    years = [y for y, _, _ in res]
    months = archive_months(first, last)
    if not months:
        sys.exit("No usable months after excluding partial archive boundaries.")
    grids = {y: g for y, g, _ in res}
    ystart = years[0]
    full = np.full((len(reg.ids), 12 * (years[-1] - ystart + 1)), np.nan)   # a year without a zip stays NaN
    for y in years:
        full[:, (y - ystart) * 12:(y - ystart) * 12 + 12] = monthly_region_counts(reg, grids[y])
    sel = [(int(m[:4]) - ystart) * 12 + int(m[5:]) - 1 for m in months]
    series = full[:, sel].astype(np.float32)
    tot = {k: sum(s.get(k, 0) for _, _, s in res) for k in ("files", "rows", "other_type", "other_sat", "kept_type0", "unique", "aqua_rows", "notype")}
    print("firms:", first, "..", last, "months", months[0], months[-1], tot)
    meta = dict(
        name="野火熱點數", category="fire", product=f"MODIS FIRMS 野火熱點（{','.join(sats)}，各國 zip 合併去重）",
        nasa=True, family="FIRMS", unit="count/month", visual="地表上閃爍的火點，數量隨熱點數",
        caveat="只計 Terra MODIS 的植被火（type=0，排除火山／工業／離岸），無信心度篩選；"
               "只用 Terra 以避免 Aqua 於 2002-07 加入造成的計數倍增，但 Terra 軌道自約 2020 年起漂移、過境時間提早，"
               "後期偵測數可能略偏；熱點是衛星過境瞬間的偵測，不是燃燒面積；"
               "0 表示來源檔未記錄區域火點，不代表沒有火災；雲、煙與缺測可遮蔽火點，未做逐區觀測覆蓋校正。"
               f"{months[0]} 之前及全檔無所選衛星記錄的月份為空值",
        source="NASA FIRMS local archive input", processed=dt.date.today().isoformat(),
        source_files=[os.path.basename(z) for z in zips],
        satellites=sats, period_note=f"data {first}..{last}",
        temporal_resolution="monthly",
        coverage_policy="Months without selected-satellite archive rows are null; regional observation/cloud coverage is not established",
        dedupe="zips are per country; points repeated in several country files removed (lat/lon 1e-4, date, time)",
        stats=tot)
    save_layer("fire_count", reg, months, series, meta)
    x = np.load(os.path.join(REPO, "data/interim/layers/fire_count.npz"))
    print("fire_count:", np.isfinite(x["series"]).any(1).sum(), "regions with data;", x["start"], x["series"].shape)
