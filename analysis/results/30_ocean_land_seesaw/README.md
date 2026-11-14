# Task 30 — Ocean ↔ land seesaw (GRACE + altimetry + ENSO)

**Question.** Water moves between ocean and land from year to year. When the continents store extra rain, does global sea level measurably drop, and which regions hold that water?

**Method.**
- Data: GRACE/GRACE-FO JPL mascons, monthly 2002–2026.
- Two series in Gt, converted to sea-level equivalent (1 mm = 361.8 Gt; land gain = sea-level fall):
  - land water L(t), summed over non-glaciated land (Greenland, Antarctica and glacier regions excluded);
  - ocean mass O(t).
- Each series is deseasonalised and has a quadratic trend removed.
- Compared with NASA-SSH altimetry GMSL (task 12), treated the same way, and with Niño3.4 at lags 0–12 months (Bretherton n_eff).
- Map: per-pixel regression of storage anomalies on L(t) (cm per 100 Gt), with significance from the AR(1)-adjusted correlation and FDR q = 0.10.
- Country share = cov(m_i, L)/var(L), summed per country. Shares add to 1.

**Results.**
- r(land as SLE, ocean mass) = +0.67, slope 1.11. The rest is ice-sheet and glacier interannual variability plus noise.
- Standard deviations: land 1.78 mm, ocean 2.95 mm.
- Altimetry GMSL vs ocean mass r = +0.65.
- ENSO leads by 5 months, p = 0.0001.
- Events (3-month means):

| Event | Month | Ocean mass (mm) | Land as SLE (mm) | Altimetry (mm) | Land Gt |
|---|---|---|---|---|---|
| La Nina 2010-12 | 2011-04-01 | -5.0 | -4.5 | -7.7 | +1622 |
| El Nino 2015-16 | 2016-04-01 | +6.2 | +5.0 | 5.9 | -1816 |
| La Nina 2020-23 | 2023-03-01 | -2.5 | -1.9 | -1.0 | +698 |
| El Nino 2023-24 | 2023-11-01 | +6.0 | +2.7 | 4.4 | -972 |

- Continent shares: Australia 7%, South America 32%, Africa 26%, South & SE Asia 10%, North America 5%, Europe & N Asia 18%.
- Top countries: see `country_share_of_land_water_swings.csv`.

**Caveats.**
- The quadratic detrend can bend the last 1–2 years, so the 2025–26 dip is provisional.
- The GRACE→GRACE-FO gap (2017-07 to 2018-05) is left empty.
- The ice-sheet masks are boxes.

**Files.**
- Figures: `seesaw_timeseries.png`, `map_where_land_water_swings.png`.
- Data: `seesaw_series_mm.csv`, `country_share_of_land_water_swings.csv`, `stats.json`, `seesaw_maps.nc` (local only).
