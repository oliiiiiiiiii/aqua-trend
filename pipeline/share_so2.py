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
import datetime as dt, glob, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, netCDF4
from share_common import cell_index, region_sum, Regions
from regions import save_layer, REPO

def annual_region_totals(reg, emissions, lat, lon):
    """Sum catalogue sources; an incomplete source-year total remains unknown."""
    em = np.ma.filled(np.ma.asarray(emissions, dtype="f8"), np.nan)
    ci = cell_index(lat, lon)
    valid = np.isfinite(em)
    grid = np.zeros((360 * 720, em.shape[1]))
    observed = np.zeros_like(grid)
    np.add.at(grid, ci, np.where(valid, em, 0.0))
    np.add.at(observed, ci, valid.astype("f8"))
    nsrc = np.bincount(ci, minlength=360 * 720)
    total = region_sum(reg, grid)
    expected = region_sum(reg, nsrc.astype("f8"))
    available = region_sum(reg, observed)
    return np.where((expected > 0) & (available == expected), total, np.nan)


def main(path):
    with netCDF4.Dataset(path) as d:
        years = [int(y) for y in d["Year"][:]]
        em = d["Catalogue"]["Emissions"][:]
        lat = np.asarray(d["Latitude"][:], "f8"); lon = np.asarray(d["Longitude"][:], "f8")
    reg = Regions()
    annual = annual_region_totals(reg, em, lat, lon)
    months = [f"{y}-{m:02d}" for y in years for m in range(1, 13)]
    series = np.repeat(annual, 12, axis=1)
    meta = dict(
        name="SO₂ 點源年排放量", category="so2", product="MSAQSO2L4 v2 多衛星 SO₂ 排放目錄（OMI／OMPS／TROPOMI）",
        nasa=True, family="MSAQSO2L4", unit="kt/yr", visual="點源冒出的黃煙柱，高度隨排放量",
        caveat="這是年度點源排放目錄，不是網格濃度；年值重複 12 個月只供顯示，不能做月異常分析。"
               "依 0.5° 格點遮罩歸屬區域，邊界附近可能分錯區；區域無目錄點源或任一點源該年缺值時為空值。",
        source="NASA MSAQSO2L4 local input", processed=dt.date.today().isoformat(),
        source_files=[os.path.basename(path)],
        variable="Catalogue/Emissions (merged multi-satellite, kt SO2 per year)",
        method="Point sources assigned through the 0.5 degree region mask; sum per region and year",
        missing_policy="All catalogue sources assigned to a region must have finite emissions in a year",
        temporal_resolution="annual", temporal="annual, repeated for each month of the year for display only")
    save_layer("so2_emis", reg, months, series, meta)
    print("so2_emis:", np.isfinite(series).any(1).sum(), "regions with data;", months[0], series.shape)


if __name__ == "__main__":
    paths = sys.argv[1:] or sorted(glob.glob(os.path.join(REPO, "data/share/so2/MSAQSO2L4_*.nc")))
    if not paths:
        sys.exit("No MSAQSO2L4 input file; see pipeline/README.md for official input sources.")
    main(paths[-1])
