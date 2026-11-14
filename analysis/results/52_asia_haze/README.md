# Task 52: Asia's haze map redrawn — AERONET ground stations vs MERRA-2

**Data and method**
- **Data:**
  - NASA AERONET v3 Level 2.0 daily AOD from ~45 Asian sun-photometer sites, converted to 550 nm with the 440–870 Ångström exponent.
  - MERRA-2 total and sulfate AOD. MERRA-2 assimilates MODIS satellite AOD, and assimilated AERONET until ~2014, so it is not fully independent before then.
  - The SO₂ catalogue from task 49.
- **Station trends:**
  - Monthly means need ≥3 clear-sky days. Annual mean anomalies need ≥6 months.
  - Trend: Theil–Sen + Hamed–Rao Mann–Kendall, for 2005–2025 sites with ≥10 years spanning ≥12 years.
  - MERRA-2 is sampled in the same months at each station's grid cell.
- **Map:** MERRA-2 trend per cell (AR(1)-OLS and MK must both pass), FDR q = 0.10.

## Results
- **27 qualifying stations:** 16 show a significant decline, 3 a rise. AERONET and MERRA-2 trends correlate across stations (r = 0.87), with the same sign at 89% of stations.
- **Declines (%/decade):**

| station | AERONET | MERRA-2 | period |
|---|---|---|---|
| Beijing-CAMS | −68 | | 2013–25 |
| Beijing | −30 | | 2006–18 |
| Gosan (Jeju) | −59 | | |
| Shirahama | −51 | | |
| Seoul | −48 | | |
| EPA-NCU (Chungli, Taiwan) | **−45** | −15 | |
| Taipei | **−39** | −25 | |
| Osaka | −37 | | |
| Hong Kong | −19 | | |
| Chiang Mai | −15 | | |
| Manila | −17 | | |

- **Rises (%/decade):** Gandhi College (Ganges plain) +19, Jaipur +16, Dhaka +15. Kanpur (+4) and Lahore (+7) are not significant.
- **Taiwan:**
  - Total AOD from MERRA-2: 0.36 → 0.30 (−14%/decade).
  - Sulfate AOD: −17%/decade (p < 1e-5).
  - Sulfate AOD correlates with China's point-source SO₂ at r = 0.89. After detrending r = 0.39, so most of the link is the shared decline.
  - Both Taiwanese AERONET stations fall about 2–3× faster than MERRA-2 shows, so the reanalysis underestimates the local clean-up.

**Verdict:**
- **Robust:** East Asian clearing and the South Asian rise; ground and satellite-based records agree.
- **Plausible, not proven:** that China's SO₂ cuts are the main driver of Taiwan's improvement. The year-to-year evidence is weaker than the trend match, and Taiwan's own controls also matter.

## Files
- `asia_haze_trends.png`, `stats.json`, `aeronet_site_trends.csv`.
