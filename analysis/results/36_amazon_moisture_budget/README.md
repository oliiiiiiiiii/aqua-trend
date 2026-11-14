# Task 36 — Why is the southern Amazon's dry season drying? (moisture budget + ocean drivers)

**Box and season.** 70–50°W, 15–5°S; Jul–Sep.

**1. MERRA-2 budget, 1980–2025** (mm/day per decade; p from OLS-AR1):

| Term | Mean | Trend | p |
|---|---|---|---|
| P | +1.465 | -0.223 | 3.3e-06 |
| E | +2.794 | -0.258 | 1.8e-07 |
| C | -2.163 | -0.561 | 2.3e-11 |
| east | +5.978 | -0.106 | 0.014 |
| north | -0.092 | -0.284 | 0.0047 |
| west | -2.577 | -0.129 | 0.0099 |
| south | -5.473 | -0.043 | 0.72 |
| inflow | +6.612 | -0.260 | 0.0023 |
| recycling | +0.176 | -0.008 | 0.0013 |
| P_minus_E_minus_C | +0.834 | +0.596 | 4.7e-08 |

Interannual correlations: r(P, C) = +0.64; r(P, E) = +0.77.

The residual P − E − C trends as strongly as the terms themselves (MERRA-2 analysis increments; see data pitfalls). **The reanalysis budget cannot attribute the trend to local vs remote causes.**

**2. Ocean drivers, GPCP 1982–2025.**
- Model: JAS rain ~ TNA SST (OISST, 5–25°N 60–15°W, JAS) + Niño3.4 (JAS) + year.
- Rain trend: -0.180 mm/day per decade (p = 0.0004).
- With drivers: residual trend +0.001 (p = 0.98).
- Coefficients: TNA -0.68 mm/day per °C (p = 0.001); Niño3.4 +0.12 (p = 0.18).
- Detrended check (rules out spurious co-trending):
  - r = -0.48, p = 0.001;
  - sensitivity -0.68 ± 0.19 (1982–2010 alone: -0.71);
  - TNA warming +0.271 °C/decade;
  - **predicted -0.184 ± 0.099 vs observed -0.180 mm/day per decade.**

**3. Map.** JAS rain change (2006–25 minus 1980–99) with mean and changed vapour transport. Drying spans the whole southern and northern Amazon, and the moisture-flow changes point north.

**Caveats.**
- Statistical attribution with one driver. TNA warming itself mixes greenhouse warming, aerosol decline and the AMO.
- Deforestation may contribute and isn't ruled out.

**Files.** `amazon_moisture_budget.png`, `jas_budget_mm_day.csv`, `jas_rain_vs_drivers.csv`, `stats.json`.
