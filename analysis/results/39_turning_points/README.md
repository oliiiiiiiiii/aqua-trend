# Task 39 — Turning points in land water storage (GRACE, 2002–13 vs 2014–26)

**Method.**
- Data: deseasonalised GRACE TWS per pixel.
- Trends: OLS per era with AR(1)-adjusted SE. Change z = (bB − bA)/√(seA² + seB²), then FDR q = 0.10.
- Six classes from the signs and relative sizes of the two trends. Ice sheets are excluded.

**Results.**
- Significant change on 44.9% of land.
- Class shares: Reversal: loss → gain 11.8%, Loss slowing 6.7%, Loss accelerating 7.1%, Reversal: gain → loss 10.5%, Gain slowing 2.4%, Gain accelerating 6.3%.
- Top countries per class (share of area):
  - Reversal: loss → gain: Bangladesh 90%, Malawi 86%, Somalia 76%, Mozambique 74%, Egypt 69%, Japan 62%
  - Loss slowing: Saudi Arabia 78%, Iraq 57%, Oman 56%, Libya 52%, Yemen 49%, Cambodia 40%
  - Loss accelerating: Tunisia 95%, Romania 94%, Bulgaria 71%, Greece 69%, Tajikistan 66%, Kyrgyzstan 63%
  - Reversal: gain → loss: Poland 100%, Paraguay 74%, Ecuador 71%, Guatemala 68%, Morocco 63%, Zambia 53%

Regions (cm/yr):

| Region | 2002–13 | 2014–26 | p (change) |
|---|---|---|---|
| NW India | -2.15 ± 0.34 | -2.26 ± 0.58 | 0.867 |
| North China Plain | -1.31 ± 0.38 | +1.20 ± 0.70 | 0.002 |
| California Central Valley | -1.33 ± 0.68 | +0.43 ± 0.92 | 0.124 |
| Middle East (Tigris-Euphrates) | -1.62 ± 0.42 | n/a (AR(1) n_eff too small) | — |
| Caspian region | -2.36 ± 0.73 | -5.37 ± 0.70 | 0.003 |
| Sahel | +0.53 ± 0.12 | +1.86 ± 0.35 | 0.000 |
| East Africa lakes | +0.66 ± 0.76 | +2.84 ± 0.87 | 0.058 |
| Southern Amazon | +0.31 ± 0.31 | -0.81 ± 0.72 | 0.154 |
| Central Europe | +0.04 ± 0.23 | -0.83 ± 0.25 | 0.009 |
| Patagonia | -2.99 ± 0.18 | -4.24 ± 0.15 | 0.000 |

**Caveats.**
- Results depend on the breakpoint. NW India's slowdown appears with W3b's phases but not with this split; see FINDINGS W19.
- Where residuals are extremely persistent (non-linear trajectories), the AR(1) n_eff becomes too small and the pixel or region is left blank.

**Files.** `map_turning_points.png`, `countries_turning_points.csv`, `regions_turning_points.csv`, `stats.json`.
