# Task 65: Arctic darkening — the ice-albedo feedback measured from space

**Data and method**
- **Sea ice:** NSIDC Sea Ice Index v4 monthly concentration GeoTIFFs, 25 km polar stereographic.
  - Jun–Aug of 2001–2025 were downloaded for this task.
  - Pixels are converted to lat/lon with pyproj (Hughes ellipsoid).
  - The pole hole is set to 100% ice.
- **Sunlight:** CERES EBAF Ed4.2.1 absorbed sunlight (incoming − reflected), clear-sky and all-sky.
- **Per cell:** JJA ice concentration is averaged into CERES 1° cells north of 60°N (ocean pixels only). In each cell, JJA absorbed sunlight is regressed on JJA ice concentration across years. Cells qualify if they had ≥15% ice in some year and a range ≥10 points.
- **Arctic-wide:** mean JJA absorbed sunlight over cells with summer ice vs total JJA ice area, raw and detrended.

## Results
- **Summer (JJA) sea-ice area:** 6.77 → 5.72 million km² (2001–05 → 2021–25), −0.50 M km² per decade (p = 1e-4).
- **Absorbed sunlight over the summer-ice cells:**

| | change per decade | p | 2001–05 → 2021–25 |
|---|---|---|---|
| clear-sky | **+7.0 W m⁻²** | 4e-6 | 271 → 287 W m⁻² |
| all-sky | +3.0 W m⁻² | 0.015 | |

- **Arctic-wide sensitivity:**

| | per million km² of ice lost | r | detrended |
|---|---|---|---|
| clear-sky | **+15.5 W m⁻²** | **−0.96** | 15.5 W m⁻², r = −0.92 |
| all-sky | +8.3 W m⁻² | −0.81 | 11.9 W m⁻², r = −0.85 |

- **Cell by cell (3,224 cells):**
  - 99.9% of cells have a negative ice–absorption correlation (median r = −0.89).
  - Median gain for 10 points of ice lost: +14.0 W m⁻² clear-sky, +7.2 W m⁻² all-sky.
  - Clouds mask about 49% of the effect.

**Verdict:** robust. This is a direct observational estimate of the ice-albedo feedback, consistent with published CERES-based estimates. It is the clear-sky part behind task 64's rising energy imbalance.

## Files
- `arctic_darkening.png`, `stats.json`, `arctic_jja_series.csv`.
