# Task 05a — Precipitation trends, GPCP v2.3 monthly, 1979-01 → 2026-10

**Data:** GPCP v2.3 (satellite + gauge, 2.5°), NOAA PSL copy (open). **Method:** same pipeline as other tasks (OLS+AR(1) on deseasonalised monthly anomalies; MK+Sen on annual means; FDR q=0.10). Trends in % of local mean per decade. Polar latitudes (>60°) masked (GPCP unreliable there).

| Region | 1979–2026 %/decade | p (OLS-AR1 / MK-HR) | since 2002-04 %/decade | p | verdict (full record) |
|---|---|---|---|---|---|
| Sahel | +5.9 | 5.4e-06 / 6.8e-08 | +5.0 | 0.032 | significant (OLS-AR1 & MK-HR agree) |
| East African lakes (Victoria) | +0.8 | 0.52 / 0.53 | +2.5 | 0.45 | no significant trend |
| North China Plain | +6.6 | 9.1e-05 / 0.018 | +15.8 | 0.00036 | significant (OLS-AR1 & MK-HR agree) |
| NW India (Punjab-Haryana-Rajasthan) | +6.0 | 0.004 / 0.027 | +17.8 | 0.0016 | significant (OLS-AR1 & MK-HR agree) |
| Tigris-Euphrates (Iraq-Iran-Syria) | -5.9 | 0.0043 / 0.13 | -4.1 | 0.5 | significant in one test |
| California Central Valley | -2.2 | 0.44 / 0.55 | +4.4 | 0.46 | no significant trend |
| Caspian Sea | +2.3 | 0.081 / 0.064 | -1.5 | 0.67 | suggestive (p<0.20) |
| Taiwan (island) | -5.3 | 0.0052 / 1.6e-05 | -15.8 | 0.0026 | significant (OLS-AR1 & MK-HR agree) |
| Amazon deforestation arc | -3.5 | 7.5e-06 / 0.0031 | -10.5 | 3.2e-06 | significant (OLS-AR1 & MK-HR agree) |
| Okavango-Zambezi | -2.4 | 0.15 / 0.089 | -17.6 | 0.00032 | suggestive (p<0.20) |
| US Northern Great Plains | -0.4 | 0.73 / 0.99 | -3.1 | 0.39 | no significant trend |

## Interpretation / links to GRACE (task 01)
- **North China Plain**: rainfall up +6.6 %/decade (since 2002: +15.8 %/decade, p=0.0004). The post-2020 GRACE storage recovery is therefore *partly rain-driven* (2021 Henan & 2023 Hebei floods), not only the South-to-North Water Diversion → present both drivers honestly.
- **NW India**: rainfall up (+17.8 %/decade since 2002) — consistent with the slowing groundwater loss after 2016; pumping still dominates the long-term decline.
- **Sahel**: +5.9 %/decade (p=5e-6) — the well-known rainfall recovery after the 1970s–80s droughts.
- **Amazon deforestation arc**: −3.5 %/decade (−10.5 %/decade since 2002, p=3e-6) — southern Amazon drying.
- **Tigris–Euphrates**: −5.9 %/decade — rainfall decline adds to the groundwater loss seen by GRACE.
- **Taiwan (one 2.5° cell, mostly sea)**: −5.3 %/decade (since 2002: −15.8 %/decade, p=0.003). Signal comes mainly from fewer extreme typhoon months after ~2010 → **must be verified with IMERG 0.1° / station data before use**.

## Figures
`map_precip_trend_pct.png` (hero), `map_precip_trend_abs.png`, `map_precip_trend_eastasia.png`, `ts_*.png`, `hotspots.csv`.
