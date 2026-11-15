#!/usr/bin/env python3
"""Build new series-2 layers from NASA files fetched by fetch_earthdata.py (data/share/...).

Each layer: read monthly (or daily -> monthly) grids, regrid to 0.5 deg, area-average per region,
write data/interim/layers/<layer>.npz. Then run merge_series.py <layer>.

  python3 -I pipeline/earthdata_layers.py aod to3_m2 tqv lst_night
(OMI OMTO3d was dropped on 2026-11-15; omi_layer() is kept for a future re-add.)
Single-threaded on purpose (netCDF-C is not thread-safe).
"""
import datetime as dt, glob, os, re, sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, netCDF4  # noqa: E402
import regions as R  # noqa: E402

SHARE = os.path.join(R.REPO, "data", "share")
TODAY = dt.date.today().isoformat()
OMI_G = "/HDFEOS/GRIDS/OMI_Column_Amount_O3/"
OMI_MIN_DAYS = 10   # a cell's monthly mean needs >= 10 valid daily retrievals


def ym_merra(f):
    return re.search(r"Nx\.(\d{4})(\d{2})\.", f).expand(r"\1-\2")


def ym_modis(f):
    y, doy = re.search(r"\.A(\d{4})(\d{3})\.", f).groups()
    return (dt.date(int(y), 1, 1) + dt.timedelta(int(doy) - 1)).strftime("%Y-%m")


def ym_omi(f):
    return re.search(r"_(\d{4})m(\d{2})\d{2}_", f).expand(r"\1-\2")


def read(d, path, offset=0.0):
    v = d[path]; v.set_auto_mask(True)
    a = np.ma.filled(np.ma.asarray(v[:], dtype="f8"), np.nan)
    a = np.where(np.abs(a) > 1e14, np.nan, a)        # MERRA-2 / OMI fill sentinels
    return np.squeeze(a) + offset


def monthly_files(folder, pattern, ymf):
    # sort by month, not file name: MERRA2_401 reprocessed months would otherwise land at the end
    out = {}
    for f in sorted(glob.glob(os.path.join(SHARE, folder, pattern))):
        out.setdefault(ymf(f), f)  # one file per month
    return sorted(out.items())


def merra_layer(folder, var, offset=0.0):
    def gen():
        for ym, f in monthly_files(folder, "*.subset.nc4", ym_merra):
            with netCDF4.Dataset(f) as d:
                yield ym, R.to_half_degree(read(d, var, offset), d["lat"][:], d["lon"][:])
    return gen


def modis_layer(folder, var, offset=0.0):
    def gen():
        for ym, f in monthly_files(folder, "*.nc4", ym_modis):
            with netCDF4.Dataset(f) as d:
                yield ym, R.to_half_degree(read(d, var, offset), d["lat"][:], d["lon"][:])
    return gen


def omi_layer(var):
    def gen():
        by_month = defaultdict(list)
        for ym, f in monthly_files("gesdisc/omto3d", "*.subset.nc4", ym_omi):
            by_month[ym].append(f)
        for ym in sorted(by_month):
            s = c = None
            for f in by_month[ym]:
                with netCDF4.Dataset(f) as d:
                    a = read(d, OMI_G + "Data_Fields/" + var); lat = d[OMI_G + "YDim"][:]; lon = d[OMI_G + "XDim"][:]
                ok = np.isfinite(a)
                s = np.where(ok, a, 0) if s is None else s + np.where(ok, a, 0)
                c = ok.astype(int) if c is None else c + ok
            m = np.where(c >= OMI_MIN_DAYS, s / np.maximum(c, 1), np.nan)
            yield ym, R.to_half_degree(m, lat, lon)
    return gen


M2 = "MERRA-2"
LAYERS = {
    "aod": dict(gen=merra_layer("gesdisc/m2aer", "TOTEXTTAU"), meta=dict(
        name="氣膠光學厚度（550 nm）", category="aod", product="MERRA-2 M2TMNXAER TOTEXTTAU", nasa=True,
        family=M2, unit="1", visual="霧霾濃淡", source_files="gesdisc/m2aer/*.subset.nc4",
        caveat="再分析模型（同化 MODIS 等衛星 AOD）；2000 年前可同化的觀測較少")),
    "to3_m2": dict(gen=merra_layer("gesdisc/m2slv", "TO3"), meta=dict(
        name="臭氧柱總量（再分析）", category="ozone", product="MERRA-2 M2TMNXSLV TO3", nasa=True,
        family=M2, unit="DU", visual="臭氧層厚薄", source_files="gesdisc/m2slv/*.subset.nc4", caveat=None)),
    "tqv": dict(gen=merra_layer("gesdisc/m2slv", "TQV"), meta=dict(
        name="大氣可降水量", category="vapor", product="MERRA-2 M2TMNXSLV TQV", nasa=True,
        family=M2, unit="mm", visual="空氣中的水氣量", source_files="gesdisc/m2slv/*.subset.nc4", caveat=None)),
    "lst_night": dict(gen=modis_layer("modis/lst", "LST_Night_CMG", -273.15), meta=dict(
        name="夜間地表溫度", category="tair", product="MODIS Terra MOD11C3 LST_Night（0.05°→0.25°→0.5°）",
        nasa=True, family="MODIS", unit="°C", visual="夜間地表冷暖", source_files="modis/lst/*.nc4",
        caveat="Terra 2020 年後軌道漂移，過境時間變早")),
}


def build(name):
    spec = LAYERS[name]; regs = R.Regions(); months, fields = [], []
    series_cols = []
    for ym, fld in spec["gen"]():
        mu, _ = regs.mean(fld); months.append(ym); series_cols.append(mu)
    if not months:
        print(f"{name}: no input files yet"); return
    S = np.stack(series_cols, 1)
    meta = dict(spec["meta"], source="earthdata", processed=TODAY,
                method="0.5° regrid → cos-lat area mean per region, ≥30% valid coverage")
    R.save_layer(name, regs, months, S, meta)
    print(f"{name}: {len(months)} months {months[0]}..{months[-1]}, "
          f"regions with data {int(np.isfinite(S).any(1).sum())}/{len(regs.ids)}")


if __name__ == "__main__":
    names = sys.argv[1:] or list(LAYERS)
    for n in names:
        build(n)
