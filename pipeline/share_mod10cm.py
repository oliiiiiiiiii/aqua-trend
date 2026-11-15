#!/usr/bin/env python3
"""snow_cover layer from MOD10CM monthly CMG snow cover (data/share/mod10cm/*.hdf, 0.05 deg).

Valid = 0..100 only (211 night, 250 cloud, 253 no decision, 254 water, 255 fill -> NaN).
Antarctica is 'deliberately mapped as snow' (QA == 252): those cells are masked too (not observed).
0.05 -> 0.5 deg NaN-aware block mean, then cos-lat area mean per region via Regions.mean.
Duplicate files for one month (2001-07 appears twice, byte-identical data) -> the newest production time wins.

  python -I pipeline/share_mod10cm.py [dir_with_hdf]
"""
import datetime as dt, glob, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from pyhdf.SD import SD
from regions import Regions, to_half_degree, save_layer, REPO

folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "data/share/mod10cm")
files = {}
for f in sorted(glob.glob(os.path.join(folder, "MOD10CM.A*.hdf"))):
    y, doy, prod = re.search(r"\.A(\d{4})(\d{3})\.\d+\.(\d+)\.", f).groups()
    ym = (dt.date(int(y), 1, 1) + dt.timedelta(int(doy) - 1)).strftime("%Y-%m")
    if ym not in files or prod > files[ym][1]:
        files[ym] = (f, prod)
months = sorted(files)
LAT = 90 - 0.025 - 0.05 * np.arange(3600); LON = -180 + 0.025 + 0.05 * np.arange(7200)
reg = Regions()
series = np.full((len(reg.ids), len(months)), np.nan, np.float32); cover = np.zeros(len(reg.ids), np.float32)
for k, ym in enumerate(months):
    d = SD(files[ym][0])
    a = d.select("Snow_Cover_Monthly_CMG")[:].astype(np.float32)
    qa = d.select("Snow_Spatial_QA")[:]
    a[(a > 100) | (qa == 252)] = np.nan
    mu, fr = reg.mean(to_half_degree(a, LAT, LON))
    series[:, k] = mu; cover = np.maximum(cover, fr)
meta = dict(
    name="積雪覆蓋率", category="snow", product="MODIS Terra MOD10CM v6.1 月積雪覆蓋（CMG 0.05°）",
    nasa=True, family="MODIS", unit="%", visual="地面覆蓋的白色雪層，面積隨覆蓋率",
    caveat="只用 0–100 的有效值；雲、極夜、水體不計入，高緯冬季區域常因極夜／雲而無值；"
           "南極被產品固定標為雪，已遮除；2000-08、2001-06、2002-03、2003-12、2016-02、2022-10 無檔案（空值）",
    source="share", processed="2026-11-15",
    source_files=[os.path.basename(files[m][0]) for m in months],
    variable="Snow_Cover_Monthly_CMG (0-100 %), QA 252 masked")
save_layer("snow_cover", reg, months, series, meta, cover=cover)
x = np.load(os.path.join(REPO, "data/interim/layers/snow_cover.npz"))
print("snow_cover:", np.isfinite(x["series"]).any(1).sum(), "regions with data;", x["start"], x["series"].shape, len(months), "months")
