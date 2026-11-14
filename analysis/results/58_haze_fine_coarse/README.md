# Task 58: Is Asia's haze getting finer or coarser? AERONET fine vs coarse aerosol

**Data and method**
- **Data:** NASA AERONET v3 Level 2.0 Spectral Deconvolution (SDA, O'Neill), daily fine-mode and coarse-mode AOD at 500 nm.
  - Fine mode ≈ combustion and secondary aerosol (sulfate, nitrate, smoke, soot).
  - Coarse mode ≈ desert dust and sea salt.
- **Processing:** monthly means need ≥3 days; annual anomaly means need ≥6 months, 2005–2025.
- **Trend:** Theil–Sen %/decade + Hamed–Rao Mann–Kendall, for sites with ≥10 years spanning ≥12 years. FDR q = 0.10 over all 50 tests.

## Results (25 stations)
| region | stations | fine mode, median %/decade | fine: sig. down / up | coarse mode, median %/decade | coarse: sig. down / up |
|---|---|---|---|---|---|
| East Asia | 14 | **−43** | 11 / 0 | −21 | 8 / 0 |
| Southeast Asia | 3 | −6 | | −24 | |
| South Asia | 7 | **+21** | 0 / 6 | **−23** | |
| Middle East | 1 (Mezaira) | +9 | n.s. | −10 | n.s. |

- **Biggest fine-mode drops (%/decade):** Gosan (Jeju) −72, Beijing-CAMS −58, Shirahama −58, Fukuoka −54, Seoul −52, EPA-NCU (Taiwan) −52, Taipei −41.
- **Fine-mode rises in South Asia (%/decade):** Jaipur +29, Gandhi College +28, Dhaka +22, Karachi +21, Kanpur +21, Lahore +18.
- **South Asia's coarse mode falls** (Kanpur −28, Pokhara −28, Dhaka −27, Lahore −23), consistent with the dust decline in task 51. The fine-mode fraction rose by +0.07 per decade.

**Verdict:**
- **Robust:** East Asia's combustion clean-up, and South Asia's shift toward a combustion-dominated haze with less dust.
- **Insufficient data:** the Middle East has a single station.

## Files
- `haze_fine_vs_coarse.png`, `stats.json`, `site_fine_coarse_trends.csv`.
