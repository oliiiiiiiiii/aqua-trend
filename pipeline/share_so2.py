#!/usr/bin/env python3
"""so2 layer from the share's MSAQSO2L4 file (data/share/so2/*.nc).

NOTE: this product is NOT a gridded column. It is an annual emissions CATALOGUE of 780 point sources
(smelters, power plants, oil and gas, volcanoes), group 'Catalogue' = merged OMI/OMPS/TROPOMI estimate,
Emissions in kt SO2 per year, 2005-2025. We sum the emissions of all sources inside each region per year
and repeat that annual value for the 12 months of the year (step series).
Regions with no catalogue source at all stay NaN (the catalogue lists only large point sources, so 'no
source' is not evidence of zero emissions).

  python -I pipeline/share_so2.py [path/to/MSAQSO2L4_*.nc]
"""
import glob, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, netCDF4
from share_common import cell_index, region_sum, Regions
from regions import save_layer, REPO

path = sys.argv[1] if len(sys.argv) > 1 else glob.glob(os.path.join(REPO, "data/share/so2/MSAQSO2L4_*.nc"))[0]
d = netCDF4.Dataset(path)
years = [int(y) for y in d["Year"][:]]
em = np.ma.filled(d["Catalogue"]["Emissions"][:].astype("f8"), np.nan)      # (source, year) kt/yr
lat = np.asarray(d["Latitude"][:], "f8"); lon = np.asarray(d["Longitude"][:], "f8")
ci = cell_index(lat, lon)
grid = np.zeros((360 * 720, len(years)))
np.add.at(grid, ci, np.nan_to_num(em))
nsrc = np.bincount(ci, minlength=360 * 720)
reg = Regions()
S = region_sum(reg, grid)                                # (R, years) kt/yr
nreg = region_sum(reg, nsrc.astype("f8"))[:, 0]          # sources per region
S[nreg == 0] = np.nan
months = [f"{y}-{m:02d}" for y in years for m in range(1, 13)]
series = np.repeat(S, 12, axis=1)
meta = dict(
    name="SO₂ 點源年排放量", category="so2", product="MSAQSO2L4 v2 多衛星 SO₂ 排放目錄（OMI／OMPS／TROPOMI）",
    nasa=True, family="MSAQSO2L4", unit="kt/yr", visual="點源冒出的黃煙柱，高度隨排放量",
    caveat="這是年度點源排放目錄（780 個大型污染源與火山），不是網格濃度；每年的值重複套用到 12 個月，"
           "沒有月變化。區域內沒有目錄污染源者為空值；整體不確定度約 50%",
    source="share", processed="2026-11-15",
    source_files=[os.path.basename(path)],
    variable="Catalogue/Emissions (merged multi-satellite, kt SO2 per year); sum of point sources inside each region",
    temporal="annual, repeated for each month of the year")
save_layer("so2_emis", reg, months, series, meta)
x = np.load(os.path.join(REPO, "data/interim/layers/so2_emis.npz"))
print("so2_emis:", np.isfinite(x["series"]).any(1).sum(), "regions with data;", x["start"], x["series"].shape)
