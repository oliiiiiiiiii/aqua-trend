# Task 42: AIRS × OMI — how the two A-Train sensors relate

**Data**
- AIRS/Aqua L3 v7 monthly (AIRS3STM, AIRS-only): surface air temperature, total water vapour, total ozone, CO at 500 hPa and cloud fraction.
- OMI/Aura: OMTO3d v4 (total ozone and UV aerosol index) and OMNO2d v4 (cloud-screened tropospheric NO₂). Daily files were averaged to monthly means: ≥5 valid days for OMTO3d, ≥3 for NO₂.
- MODIS active fires (FIRMS) as a third, independent dataset.
- Period: Oct 2004 to Sep 2026.
- Fields were subset through NASA Cloud OPeNDAP (`scripts/fetch_airs_omi.py`).

**Method**
- Deseasonalised anomalies.
- Correlation per pixel with the Bretherton effective sample size and FDR q = 0.10.
- Trends from AR(1)-OLS plus Mann–Kendall, using `trendlib.grid_trends`.

## A. Same quantity, different physics: total ozone (`ozone_airs_vs_omi.png`)
- Monthly anomaly correlation between AIRS (infrared emission) and OMI (UV backscatter): **median r = 0.92**, significant on 100% of the globe.
  - Agreement drops over the Sahara and Arabia, where desert emissivity disturbs the infrared retrieval.
- Antarctic Sep–Oct ozone, year to year: **r = 0.994**.
- **Bias:** AIRS reads **+3.2 DU higher** between 60°S and 60°N, and the gap **drifts −1.7 DU/decade** (p < 0.001).
- **Trends:** the two sensors' trend maps agree in sign on 75% of the area (pattern r = 0.62).
- The Antarctic spring trend is +3.4 DU/decade in AIRS but +7.2 in OMI.
- The same quantity can show different trends from different instruments, so a second sensor is essential.

## B. Smoke: CO, aerosol and fires (`map_fire_smoke_correlation.png`, `map_canada_2023_smoke.png`)
- **Monthly level:** across 6,681 regularly burning 1° cells, fire anomalies correlate positively and significantly with AIRS CO in **45%** of cells and with the OMI aerosol index in **24%**.
  - Strongest in Siberia, Canada, Indonesia, Australia, the Amazon arc and the Sahel.
- **Canada 2023:** Jun–Aug fire detections were **×4.9** the 2005–25 average. AIRS CO over Canada averaged 126 ppbv against a 101 ppbv normal, and both CO and aerosol were **rank 1 of 22 summers**.
  - The plume extends across the Atlantic toward Europe.
- **Year to year:** Canadian summer fire counts track the OMI aerosol index at **r = 0.94** and AIRS CO at **r = 0.76**.

## C. Combustion fingerprints: NO₂ vs CO (`map_no2_trend.png`, `regional_no2_vs_co.png`)
- NO₂ fell significantly on 26% of polluted cells and rose on 18%.
- AIRS CO is falling almost everywhere (37% of the globe significantly down, 1% up; global −2.9%/decade).

| region | NO₂ %/decade | NO₂ peak | 2025 vs peak | CO %/decade | Feb–Apr 2020 (COVID) |
|---|---|---|---|---|---|
| East China | −18 | 2011 | −42% | −13 | −29% |
| Eastern US | −27 | 2005 | −45% | −7 | −34% |
| Western Europe | −22 | 2006 | −33% | −6 | −34% |
| Japan & Korea | −24 | 2005 | −40% | −11 | −22% |
| Taiwan | −15 | 2005 | −21% | −7 | −20% |
| Highveld (S. Africa) | −15 | 2008 | −22% | −5 | −17% |
| North India | **+13** | 2025 | (record) | −3 | −13% |
| Persian Gulf | **+10** | 2025 | (record) | −4 | −7% |

All NO₂ trends have p < 1e-4.

## D. Water link: water vapour per degree (`map_water_vapour_per_K.png`)
- Over the oceans, AIRS water vapour rises **6.0% per K** of surface-air warming month to month, close to the Clausius–Clapeyron ≈7%/K.
- Over land it rises 1.6%/K (median), because dry continents have little water to evaporate.
- In the deep tropics, humidity follows the circulation rather than local temperature.

**Caveats**
- AIRS v7 L3 has been AIRS-only since the AMSU microwave loss. Its long-term water-vapour and temperature trends are weak (ocean T +0.08 K/decade, p = 0.2), so they are not used as findings.
- Aqua and Aura drift later in local time from about 2022. Sensitivity check: NO₂ trends for 2005–2021 have the same signs, e.g. Eastern US −45%/decade, East China −12%/decade.

## Files
- Figures: `ozone_airs_vs_omi.png`, `map_fire_smoke_correlation.png`, `map_canada_2023_smoke.png`, `map_no2_trend.png`, `regional_no2_vs_co.png`, `map_water_vapour_per_K.png`.
- Data: `regions_no2_co.csv`, `stats.json`.
