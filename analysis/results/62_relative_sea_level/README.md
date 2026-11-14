# Task 62: The sea level people feel — relative rise = ocean rise + land sinking

**Data and method**
- **Data:** PSMSL tide gauges; NASA-SSH altimetry (cached monthly cube from task 60).
- **Gauges:** the 648 that pass task 60's QC and are not affected by an earthquake step.
- **Trends (1993–2025):** OLS with AR(1)-corrected errors on deseasonalised monthly data, computed on the same months for:
  - the tide gauge (relative sea level, what the coast experiences);
  - the matched altimetry cell (the ocean's absolute rise).
- **Land motion** = ocean rise − relative rise.

## Results
- **Median relative rise:** +3.5 mm/yr, the same as the ocean alone (+3.5).
- **Hotspots:** 4% of gauges exceed twice the global rate (6.8 mm/yr), and land sinking exceeds the ocean rise at 5%.
- **Relative sea level is falling** at 68 gauges, where land rebound after the ice age is faster than the sea's rise: Scandinavia, Alaska, Hudson Bay.
- **Fastest relative rise (mm/yr):**

| gauge | relative rise | ocean | land |
|---|---|---|---|
| **Manila** | **12.5** | 3.9 | −8.6 |
| Daesan (Korea) | 11.6 | | |
| Pago Pago | 10.5 | | |
| Apia | 9.7 | | |
| Grand Isle (Louisiana) | 9.4 | | |
| Sabine Pass, Rockport, Corpus Christi, Galveston (Texas) | 8.3–8.6 | | |
| Venice | 8.1 | | |
| Chennai | 8.0 | | |

- **Caveat:** the UK gauges in the top 20 (Newport, Whitby, Cromer, Liverpool) probably include coastal-altimetry error; see task 60.

**Verdict:** robust. For coastal risk, land subsidence matters as much as ocean rise at the worst-hit coasts.

## Files
- `relative_sea_level.png`, `stats.json`, `relative_sea_level_by_gauge.csv`.
