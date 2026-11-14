# Task 51: Less dust over the Sahel, Sahara edge and Middle East — two records agree, and greener land means cleaner air

**Data and method** (2005–2025 annual means, 1° grid, 25°W–80°E and 0–50°N)
- **Data:**
  - MERRA-2 dust AOD at 550 nm (M2TMNXAER DUEXTTAU). This is a reanalysis that assimilates MODIS/MISR/AERONET AOD.
  - OMI OMTO3d UV aerosol index: an independent UV-absorption measurement.
  - Terra MODIS NDVI and GPCP rain.
- **OMI drift control:** over the clean South Pacific and South Indian Ocean the trend is −0.002 and +0.022 per decade (p = 0.91 and 0.10), so there is no drift.
- **Cell trends:** Theil–Sen slope; p is the larger of the AR(1)-OLS and Mann–Kendall p; FDR q = 0.10.
- **Coupling test:** per-cell correlation of detrended OMI aerosol index vs detrended NDVI, on cells with mean NDVI > 0.12, against closed-form phase-randomised surrogates (2000 draws), with FDR.
- **Wind:** GLDAS wind was checked and rejected as a driver. Its monthly anomalies do not track dust (r ≈ 0), and the forcing winds trend spuriously (+0.6 m/s/decade in the Sahel).

## Results
**Trends:**
- **Dust belt** (mean AOD > 0.15): MERRA-2 shows a significant decline on 24% of cells and a rise on 1%. OMI shows a decline on 52% and a rise on 0.2%. Trend signs agree on 86% of cells.
- **Regions:**

| region | dust AOD %/decade (p) | OMI aerosol index /decade (p) | NDVI %/decade (p) | detrended OMI–NDVI r (surrogate p) |
|---|---|---|---|---|
| Sahel | −8.9 (0.01) | −0.11 (0.001) | +3.9 (0.001) | −0.25 (0.23) |
| Lake Chad / Bodélé | −7.8 (<0.001) | −0.15 (0.003) | +4.5 (0.01) | −0.26 (0.29); MERRA-2 dust–NDVI −0.57 (0.005) |
| Iraq–Syria | **−16.6** (0.001) | −0.16 (<0.001) | +7.7 (<0.001) | **−0.82 (<0.001)** |
| Arabian Peninsula | −8.8 (0.03) | −0.16 (<0.001) | +2.7 (0.005) | **−0.82 (<0.001)** |
| Thar / NW India | −1.6 (0.74) | −0.07 (0.05) | +15.0 (<0.001) | −0.57 (0.01) |
| Taklimakan | +14.5 (MERRA-2) | −0.03 (OMI) | — | disagree → not interpreted |

**Coupling map:** in years when vegetation is greener than its trend, OMI sees less aerosol on **89%** of vegetated dust-belt land. The negative correlation is FDR-significant on 29% of that land; positive on 0.1%.

**Verdict:**
- **Robust:** the decline in Sahel, Sahara-edge, Middle East and Arabian dust (two independent records), and the year-to-year coupling of dust with greenness.
- **Not tested:** the trend attribution (vegetation vs winds), because no trustworthy wind record is available here.

## Files
- `dust_trends_and_greening.png`, `stats.json`, `regional_annual.csv`.
