# Task 24 — Taiwan water deep-dive: is Taiwan getting drier? (IMERG 0.1°, GLDAS 0.25°)

**Data:** GPM IMERG V07 Final monthly 0.1° (1998–2025-09; 315 pixels over Taiwan, Natural Earth 50 m mask); GLDAS-2.1 Noah 0.25° (2000–2026-07) for ET/runoff.

## Results
| Quantity | Trend | p (OLS-AR1 / MK) | Verdict |
|---|---|---|---|
| Annual rain (island mean, monthly anomalies) | **−12.9 %/decade** | 0.005 | significant (single dataset) |
| Winter NE monsoon (Nov–Apr, mean 498 mm) | −11.9 %/decade | 0.13 / 0.002 | one test |
| Plum rain (May–Jun, 526 mm) | −4.4 %/decade | 0.64 | none |
| Typhoon season (Jul–Oct, 1068 mm) | **−15.9 %/decade** | 0.066 / 0.028 | one test |
| Extreme-rain months (> 1998–2012 95th pct) | 0.57 → 0.29 per year (1998–2011 → 2012–2025) | — | halved |
| GLDAS rain forcing | −8.7 %/decade | 0.049 | significant |
| **GLDAS ET** | **+3.8 %/decade** | 0.002 | significant |
| **GLDAS runoff (what reaches rivers & reservoirs)** | **−18.7 %/decade** | 0.008 | significant |
| 2021 drought: Jan–May rain | **59 % of normal** (island mean) | — | matches the reported worst drought in ~56 years |
| ENSO link (Niño3.4) | r ≈ −0.05 … −0.10 for all seasons | > 0.6 | Taiwan's rain trend is *not* ENSO-driven |

Per-pixel seasonal maps: no pixel survives FDR (27 seasonal values per pixel are too noisy) → the signal is island-wide, not local.

## Interpretation
Less rain (especially fewer big typhoon/winter-monsoon months) **and** rising evaporation (warmer, more vegetation) → runoff, the water that fills Taiwan's reservoirs, falls about twice as fast as rain. That is the water-centric story for Taiwan: **evaporation amplifies drought**.

## Caveats (important)
- IMERG annual totals drop from ≈2,400 mm (1998–2008) to ≈1,760 mm (2017–2024); IMERG under-estimates mountain rain and its inputs changed at the TRMM→GPM transition (2014) — part of the trend may be inhomogeneity. GPCP (task 05a, independent processing, 2.5°) agrees on the sign (−16 %/decade since 2002).
- The record starts with very wet years (1998, 2005, Morakot 2009) and ends with dry ones (2020 no landfalling typhoon, 2021 drought, 2023): over a century CWA station records show no significant annual trend, so this is a **multi-decadal swing** until verified with CWA gauges (needs a free CWA API key; GHCN-Daily has no Taiwan stations).

**Figures:** `map_taiwan_seasonal_rain_trends.png`, `ts_taiwan_rain_imerg.png`, `map_2021_drought.png`.

## Robustness check (added later)
| Test | Result |
|---|---|
| IMERG 0.1° island pixels, start year 1998 / 1999 / 2000 / 2001 / 2003 / 2005 | −12.9 / −10.4 / −11.8 / −11.9 / −15.6 / −25.3 %/decade — all significant (both tests) |
| IMERG 0.5° box incl. surrounding sea, 2001–2025 | −5.4 %/decade, p = 0.28 |
| GPCP (2.5°), 2001–2025, island box | −12.8 %/decade, p = 0.009 |
| MERRA-2 (gauge-corrected reanalysis), 2001–2025 | −2.5 %/decade, p = 0.61 |
| IMERG − GPCP difference, Pettitt change point | 2012, p = 0.0002 (island); 2016, p = 0.035 (2.5° box) |
**Verdict:** the decline is concentrated over island land pixels in IMERG and GPCP and absent in MERRA-2 and the sea-inclusive box; a step in the IMERG–GPCP difference points to input changes. → **Suggestive**, needs CWA rain-gauge verification.

## ET/runoff cross-model check (task 20c)
MERRA-2 over Taiwan 2001–2025: ET −0.15 %/decade (p = 0.94), rain −2.2 % (p = 0.67), runoff −6.5 % (p = 0.50); GLDAS ET +2.8 %/decade (p = 0.03). → The GLDAS "rising ET, runoff falling twice as fast" result is **not reproduced**; do not quote it.
