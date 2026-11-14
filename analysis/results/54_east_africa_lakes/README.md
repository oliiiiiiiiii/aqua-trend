# Task 54: East Africa's rising lakes ratchet upward in Indian Ocean Dipole years

**Data and method**
- **Lake levels:** NASA GWM (former G-REALM) radar altimetry, 10-day, TOPEX → Jason-1/2/3 → Sentinel-6A, 1992–Nov 2026, with GWM's cross-mission biases applied.
  - Lake IDs were verified against each file's header name and coordinates.
  - Monthly medians are taken as anomalies against the 2003–12 mean.
- **Other data:**
  - GRACE/GRACE-FO JPL mascons (3° native, so the map looks blocky).
  - GPCP v2.3 (1981–) and IMERG V07 (1998–) rain over the Lake Victoria basin box (29–36°E, 4°S–2°N).
  - NOAA DMI (Indian Ocean Dipole) and Niño3.4.
- **Tests:**
  - Pettitt change points.
  - Wet-season level gain (Sep–Oct of year y → May–Jun of y+1) against that year's Oct–Dec short rains and the Sep–Nov DMI.
  - Short rains vs DMI, including the partial correlation given Niño3.4.

## Results
**Lake levels:**

| lake | now vs 2003–12 | record (month) | rise after 2019 | rise after 2023 | wet-season gain vs short rains, r (n) |
|---|---|---|---|---|---|
| Turkana | **+6.7 m** | +7.3 (May 2026) | +3.1 | +1.8 | 0.54 (34) |
| Rukwa | **+5.7 m** | +6.4 (Apr 2026) | +4.8 | +2.3 | 0.63 (31) |
| Naivasha | **+4.3 m** | +4.9 (Oct 2025) | +3.3 | +1.9 | 0.67 (25) |
| Tanganyika | +2.3 m | +3.4 (May 2024) | +1.9 | +1.5 | 0.71 (34) |
| Kyoga | +1.6 m | +2.7 (Jun 2021) | +3.1 | +1.6 | 0.55 (34) |
| Victoria | +1.2 m | +2.3 (May 2024) | +1.4 | +1.0 | **0.82** (34) |
| Malawi | +0.5 m | +1.6 (Apr 2026) | +1.5 | +1.1 | 0.26 (n.s.) |
| Mweru | +0.7 m | +2.7 (May 2020) | +2.4 | +1.1 | 0.56 (34) |

- **The ratchet:** on 6 of 8 lakes, the three largest wet-season rises since 1992 came in **1997, 2019 and 2023**, the three strongest positive-IOD years (DMI 0.97, 0.90, 0.89).
- **Short rains vs IOD:** r = 0.70 (GPCP, n = 45, p = 1e-7) and r = 0.77 (IMERG, n = 27). The partial r given Niño3.4 is 0.56, so the dipole matters beyond ENSO.
- **Annual rain has no trend** (−0.4%/decade, p = 0.43). The lakes rise in steps because the water arrives in a few extreme seasons and drains slowly.
- **GRACE:** the Victoria basin holds +49 cm more water in 2020–25 than in 2003–12.

**Verdict:** robust. Three independent data types (altimetry, gravity, rain) agree, and the physical mechanism is known.
- **Human impact:** the rising lakes flooded shoreline towns (Baringo/Naivasha, Kisumu) and displaced people.
- **Caveats:**
  - Victoria's outflow is regulated at the Owen Falls/Nalubaale dam.
  - Turkana's inflow is affected by the Gibe III dam (filled 2015–17).
  - Naivasha has an altimetry gap from 2002 to 2008.

## Files
- `east_africa_lakes.png`, `stats.json`, `lake_level_anomalies_monthly.csv`.
