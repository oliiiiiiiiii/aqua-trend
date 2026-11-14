# Task 48: Methane's record surge and the wetland-water hypothesis

**Data and method**
- **NOAA GML global surface CH₄:** annual increase 1984–2025, plus the monthly de-seasonalised trend to June 2026.
- **AIRS v7 CH₄ at 400 hPa:** 60°S–60°N mean, used as a satellite cross-check (Aqua's orbit drifts after 2022).
- **Water and climate inputs:**
  - GRACE/GRACE-FO JPL mascons: annual water storage, 2003–2025.
  - GPCP v2.3 annual tropical-land rain, 1984–2025.
  - Niño3.4.
- **Hypothesis tested:** wetter tropical wetlands (more stored water → more flooding → more microbial methane) explain the year-to-year CH₄ growth.
- **Tests:** Pearson r per 0.5° tropical land cell and for named wetland regions.
  - Significance comes from phase-randomised surrogates (Ebisuzaki 1997; 2000 draws, computed in closed form: by Parseval each surrogate's correlation is linear in cos/sin of its phases).
  - Surrogates keep each series' persistence and slow trends.
  - Each test is also repeated after detrending both series, and on first differences. FDR q = 0.10 across cells.

## Results
**Methane growth:**
- 2021 was the record year at **+17.7 ppb**; 2020 (+14.8) is second.
- Growth then fell to **+4.8 ppb in 2025**, the smallest since 2009. The latest 12 months (to June 2026) show +6.4 ppb.
- AIRS also has 2021 as its record year. AIRS vs NOAA annual growth correlation: r = 0.59 for 2004–2022, but only 0.46 including the orbit-drift years.

**Water storage vs methane growth:**

| region | raw r | naive p | surrogate p | detrended r (p) | first-diff r (p) |
|---|---|---|---|---|---|
| East Africa (L. Victoria) | +0.63 | 0.001 | 0.11 | +0.14 (0.56) | +0.37 (0.09) |
| Sudd | +0.43 | 0.04 | 0.31 | −0.03 (0.93) | +0.44 (0.04) |
| Congo Cuvette | +0.45 | 0.03 | 0.26 | +0.15 (0.49) | +0.17 (0.45) |
| Central Amazon | +0.39 | 0.07 | 0.06 | +0.32 (0.11) | +0.01 (0.97) |
| Niger inland delta | +0.56 | 0.005 | 0.15 | −0.32 (0.23) | +0.16 (0.48) |
| all tropical land 20°S–20°N | +0.51 | 0.01 | 0.11 | +0.03 (0.93) | +0.12 (0.61) |

- **Map:**
  - Raw correlations: |r| > 0.4 on 48% of tropical land, with positive and negative signs, because any trending basin correlates with a trending series.
  - Surrogate p < 0.05 on 8% of cells, against 5% expected by chance.
  - After detrending: |r| > 0.4 on 11% and p < 0.05 on 5%, which is chance level. No cell is FDR-significant in either map.
- **East Africa contradicts the hypothesis:** the basin stayed full (+48 cm in 2023–25 vs +36 cm in 2019–22) while methane growth slowed.
- **Other drivers show nothing:**
  - Tropical rain: r = −0.20 (p = 0.32, n = 42).
  - Niño3.4 (Jul–Jun leading): r = +0.03 (p = 0.81). Same-year: r = −0.03.

**Verdict:**
- **Robust:** the surge and the slowdown in the NOAA record, and the AIRS satellite also sees the 2021 jump.
- **Not supported:** a wetland-water explanation from GRACE, rain or ENSO at annual resolution. The naive p = 0.001 for East Africa comes from shared trends.
- Other candidate drivers (the OH sink, the COVID-19 NOx drop, fossil and agricultural sources) cannot be tested with these data.
- This is a teaching case for the tool: always test correlations against persistence or detrend first.

## Files
- `methane_vs_wetland_water.png`, `stats.json`, `ch4_growth.csv`, `tws_regions_annual.csv`.
