# Task 34 — Rain replacing snow (MERRA-2 1980–2025)

**Question.** Is a growing share of precipitation falling as rain instead of snow? What does that mean for the natural water storage that snowpack provides?

**Method.**
- Data: MERRA-2 M2TMNXINT monthly PRECSN (snowfall), PRECCU (convective rain) and PRECLS (large-scale rain), summed to calendar-year totals and regridded to 0.5°.
- Snow fraction = S / (S + CU + LS).
- Trend test: OLS-AR1 and Mann-Kendall must both pass, then FDR q = 0.10, over land with a mean snow fraction of at least 5% and annual precipitation above 100 mm.
- Cross-check: the GLDAS-2.1 March SWE trend vs the MERRA-2 snow-fraction trend over 2001–2025.
- Side result: the convective share of rain, CU/(CU+LS).

**Results.**
- Snowy land: 56 million km².
- Mean snow share 35.2% (1980s) → 31.3% (2016–25), -1.14 pp/decade.
- Significant loss on 26.3% of snowy land, gain on 0.0%.
- Snowfall amount: significantly down on 2.9%, up on 1.3%. Mostly no detectable change in amount; the shift is in phase.

| Region | Snow % 1980s | Snow % 2016–25 | pp/decade | p | Snowfall %/dec (p) |
|---|---|---|---|---|---|
| High Mountain Asia | 48.5 | 40.7 | -2.02 | 0.000 | +5.1 (0.15) |
| Alps | 20.2 | 14.3 | -1.49 | 0.000 | -5.3 (0.02) |
| NE China & Mongolia | 18.4 | 13.2 | -1.24 | 0.001 | -5.4 (0.02) |
| Rockies | 37.3 | 33.6 | -1.17 | 0.006 | -0.6 (0.73) |
| Scandinavia | 35.2 | 32.9 | -1.12 | 0.007 | -2.3 (0.04) |
| Siberia | 42.5 | 41.1 | -0.75 | 0.035 | -0.8 (0.39) |
| Canadian Prairies & boreal | 35.4 | 33.0 | -0.69 | 0.024 | +0.3 (0.81) |
| Eastern Europe & W Russia | 33.3 | 30.9 | -0.68 | 0.089 | -0.5 (0.65) |
| Japan & Korea | 17.0 | 13.3 | -0.67 | 0.020 | -2.8 (0.11) |
| Andes (south) | 24.6 | 25.7 | +0.16 | 0.704 | -0.7 (0.66) |

- GLDAS March SWE trend vs MERRA-2 snow-share trend: same sign on 60% of snowy land. GLDAS SWE falls on 64%.
- Convective share of rain: up on 13% and down on 10% of land, i.e. mixed (model physics).

**Caveats.** The rain/snow split is diagnosed by the reanalysis model, so this is a single dataset. A natural next step is an independent check with station snow/rain records or MODIS snow cover.

**Files.**
- Figures: `map_snow_fraction_trend.png`, `bars_regions_snow_share.png`, `map_snowfall_amount_trend.png`, `map_convective_share_trend.png`.
- Data: `regions.csv`, `snowy_land_snow_fraction_pct.csv`, `stats.json`.

## 34b — Independent check with MODIS/Terra snow cover (MOD10CM v61, 2001–2025)

**Method.**
- Data: 0.05° monthly snow cover, averaged to 0.5°, keeping cells with at least 50% valid sub-pixels. Night, cloud and water codes are set to NaN.
- Metric: the March–May mean, over land where spring cover is at least 10%.
- Trend test: OLS-AR1 and Mann-Kendall, then FDR.

**Results.**
- Snowy-land spring cover: 62.8% → 59.9%, -1.27 pp/decade (p = 0.018).
- Pixel FDR: significant decline on 0.02% and increase on 0.01% of snowy land. The pixel level has too little power.
- Same sign as MERRA-2 2001–25 snow-share trends on 62% of snowy land; pattern r = 0.26.

| Region | Spring cover 2001–05 | 2021–25 | pp/decade | p |
|---|---|---|---|---|
| Japan & Korea | 31.3 | 21.8 | -5.63 | 0.004 |
| Eastern Europe & W Russia | 42.4 | 29.9 | -5.46 | 0.038 |
| NE China & Mongolia | 30.3 | 24.8 | -4.40 | 0.068 |
| Alps | 42.2 | 34.7 | -4.01 | 0.021 |
| Scandinavia | 63.6 | 60.9 | -1.69 | 0.302 |
| Siberia | 80.2 | 76.8 | -1.48 | 0.307 |
| High Mountain Asia | 37.9 | 36.2 | +0.52 | 0.681 |
| Rockies | 33.6 | 39.2 | +1.25 | 0.565 |
| Canadian Prairies & boreal | 57.2 | 59.7 | +1.48 | 0.506 |
| Andes (south) | 25.8 | 30.7 | +2.07 | 0.240 |

**Verdict.**
- The aggregate decline and the Alps, eastern Europe and Japan & Korea are confirmed by an independent satellite.
- High Mountain Asia and the Rockies are not, so the MERRA-2 phase-shift signal there stays model-only.

**Files.** `map_modis_spring_snow_cover_trend.png`, `modis_regions_spring_snow_cover.csv`, `modis_snow_stats.json`, `modis_snowy_land_mam_cover_pct.csv`.
