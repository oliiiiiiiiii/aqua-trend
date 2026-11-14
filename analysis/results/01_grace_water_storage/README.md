# Task 01 — Terrestrial water storage trends (GRACE / GRACE-FO), 2002-04 → 2026-09

**Question:** Where is the land losing or gaining water (groundwater + soil moisture + snow + ice + lakes), and is it significant?

**Data:** NASA/JPL GRACE & GRACE-FO mascon RL06.3Mv04 CRI (PO.DAAC, `TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4`), 0.5° grid (native mascons ~3°), 261 monthly solutions (35 missing months incl. the 2017-07→2018-05 mission gap). Units: cm liquid-water-equivalent relative to 2004–2009.

**Method:** deseasonalised monthly anomalies → OLS slope with AR(1)-adjusted effective n; Mann-Kendall + Sen on annual means (years with ≥6 months); BH-FDR (q=0.10) field significance; map shows only pixels where both tests agree at full colour. Volumes: trend × box area (1 cm over 1 km² = 10⁻⁵ km³).

## Headline numbers (whole record unless noted)
| Region | Trend (cm/yr, ±95% CI) | Volume (km³/yr) | Verdict |
|---|---|---|---|
| NW India (Punjab–Haryana–Rajasthan) | **−3.17 ± 0.37** | −14.5 | significant (both tests), SNR 5.8 |
| ↳ 2002–2016 vs 2017–2026 | −2.81 ± 0.56 → −1.02 ± 1.07 | | decline slowed; recent segment not significant |
| North China Plain 2002–2020 | **−1.85 ± 0.41** | | significant |
| ↳ 2020-06 → 2026 | **+2.94 ± 2.29** | | significant **reversal** (South-to-North Water Diversion + pumping limits + 2021/2023 extreme rains) |
| Caspian Sea | **−4.83 ± 1.20** (since 2018: **−8.32 ± 1.11**) | −37.5 | significant & accelerating |
| Tigris–Euphrates (Iraq/Iran/Syria) | −0.82 ± 0.63 | −7.1 | significant |
| Arabian aquifers (Saudi) | −0.68 ± 0.07 | −10.1 | significant, very steady (SNR 5) |
| California Central Valley | −1.03 ± 0.69 | −2.0 | significant |
| East African lakes (Victoria) | **+3.22 ± 1.30** | +12.0 | significant gain (lake-level rise 2019–2024) |
| Greenland | −4.84 ± 0.23 | −291 | sanity check ✔ (literature ≈ −270 Gt/yr) |
| Alaska coastal glaciers | −8.05 ± 0.46 | −49 | significant |
| Patagonia icefields | −11.04 ± 0.70 | −19 | significant |
| High Mountain Asia | −0.77 ± 0.09 | −31 | significant |
| Taiwan | +0.14 (unreliable) | — | island smaller than GRACE footprint → **do not use** |

## Figures
- `map_land_water_security.png` (hero map), `map_global_land_ice.png`, `map_zoom_*.png`
- `ts_*.png` per region, `multi_hotspots.png`
- `hotspots_land.csv` – automatically detected significant clusters with volumes

## Caveats
- GRACE resolution ~300 km: boxes smaller than that (Taiwan, cities) are meaningless.
- Total water storage ≠ groundwater alone; separating groundwater needs soil-moisture/snow from GLDAS (follow-up).
- Pettitt change-points for monotonic series cluster mid-record (2012) — not evidence of a step; use piecewise fits instead.
- The 2017–2018 mission gap is bridged by the trend fit, not interpolated.

## Story value
1. **North China Plain "trend reversal"** – the best teaching example: one linear trend over 2002–2026 is *not* significant by OLS (p=0.08) because the decline reversed; splitting at 2020 gives two highly significant opposite trends. Directly addresses the challenge note that trends can be non-linear.
2. **NW India groundwater** – loses ≈14.5 km³/yr (≈85% of Taiwan's annual water use, ~17 km³) — but the loss is slowing.
3. **Caspian Sea shrinking faster** – loss rate nearly doubled since 2018.
