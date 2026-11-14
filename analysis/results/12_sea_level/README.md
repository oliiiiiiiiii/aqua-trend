# Task 12 — Sea level rise, NASA-SSH simple gridded altimetry, 1993 → 2026

**Data:** `NASA_SSH_REF_SIMPLE_GRID_V11` (PO.DAAC) — weekly 0.5° SSH anomalies from the TOPEX/Poseidon → Jason-1/2/3 → Sentinel-6 reference missions (1,776 files) → monthly means.
**Method:** per-pixel OLS+AR(1) + MK (FDR q=0.10); global mean (66°S–66°N, cos-lat weighted) with quadratic fit and Newey-West (HAC, 12 lags) standard errors for acceleration.

## Results
| Quantity | Value |
|---|---|
| Global mean rate 1993–2026 | **3.19 mm/yr** (total ≈ **+10.4 cm**) |
| Acceleration | **0.059 ± 0.020 mm/yr²** (p = 3e-9) |
| Rate at start → end | 2.2 mm/yr (1993) → **4.2 mm/yr (2026)** — nearly doubled. Sanity ✔ (NASA: 2.1 → 4.5 mm/yr; our value omits GIA correction) |
| Taiwan seas / Taiwan Strait | 3.40 ± 0.52 / 3.44 ± 0.45 mm/yr (≈1.1× global) |
| East China Sea | 3.48 ± 0.39 mm/yr |
| Gulf of Mexico | 4.32 ± 0.53 mm/yr (1.36× global) |
| Bay of Bengal | 4.22 ± 1.28 mm/yr (1.32× global) |
| US East Coast shelf | 4.14 ± 0.77 mm/yr |
| Philippine Sea | 4.13 ± 4.05 mm/yr (ENSO-dominated, borderline) |

Fastest regional rise: Kuroshio Extension east of Japan, SW Pacific/Tasman, Gulf of Mexico. Almost the entire ocean is significant (FDR).

## Figures
`map_sea_level_trend.png` (hero), `map_sea_level_eastasia.png`, `ts_global_mean_sea_level.png` (acceleration), `ts_*.png`.

## Caveats
Altimetry measures absolute sea level; coastal *relative* sea level also includes land subsidence (important in SW Taiwan — Yunlin/Changhua — where pumping-driven subsidence of several cm/yr dwarfs the ocean signal). No GIA correction applied.
