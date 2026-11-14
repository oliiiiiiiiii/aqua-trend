# Task 57: The Mekong's heartbeat — Tonle Sap's flood pulse is weaker for the same rain

**Data and method**
- **Lake level:** NASA GWM radar altimetry of Tonle Sap (Cambodia), 10-day.
  - TOPEX 1992–2002; Jason-2/3 and Sentinel-6A 2008–2026.
  - GWM flags the TOPEX→Jason-2 merger at this lake, so the absolute offset between eras is uncertain.
- **Rain:** GPCP May–Oct rain over the lower (100–108°E, 11–20°N) and upper (97–102°E, 20–30°N) Mekong basin.
- **Water mass:** GRACE/GRACE-FO Sep–Nov water storage over Cambodia (102–107°E, 10.5–14.5°N).
- **Per-year quantities:** flood peak (max, mid-Aug to Nov), dry-season low (min, mid-Mar to Jun), amplitude = peak − low.
- **Regressions:**
  1. Jason era only: peak ~ rain_low + rain_up + year.
  2. Both eras: the same with an era dummy instead of the year.
  3. GRACE: the same as (1).
- **Bias control:** the dry-season low. A satellite bias would shift the low and the peak together.

## Results

| | 1993–2001 | 2009–2026 |
|---|---|---|
| mean amplitude | **8.4 m** | **6.7 m** |
| lower-basin rain (mm/day) | 9.0 | 8.9 |

**Jason era (2009–26), with rain held constant:**

| quantity | change per decade | t | p | R² |
|---|---|---|---|---|
| flood peak | **−1.04 m** | −2.9 | 0.012 | 0.61 |
| amplitude | −0.95 m | | 0.012 | |
| dry-season low | −0.09 m | | 0.38 (flat) | |

- **Both eras (rain-adjusted):** the Jason era's amplitude is −1.63 m lower (p = 1.5e-4). Its dry-season low differs by only +0.11 m (p = 0.35), so the era offset is small.
- **Rain-adjusted peak:** 2015–26 is −1.26 m below 2009–13 (Welch p = 0.002).
- **GRACE (independent, no mission merger):**
  - Sep–Nov water mass correlates with the altimetry peak at r = 0.86.
  - Rain-adjusted trend: −0.98 cm/yr (p = 0.001).
- **Lowest rain-adjusted peaks:** the drought years 2015, 2019, 2020 and 2021.

**Verdict:**
- **Robust:** the flood pulse weakening, within one consistent satellite family plus independent GRACE, with a rain control.
- **Plausible but not tested here:** the attribution to the upstream dams (Xiaowan 2010, Nuozhadu 2014, Xayaburi 2019). It is consistent with the timing, but other changes (sand mining, channel incision, irrigation) could contribute.

## Files
- `tonle_sap_flood_pulse.png`, `stats.json`, `tonle_sap_annual.csv`.
