# Task 69: How many "significant" trends appear in data that has none? (why the tool corrects for memory and multiple testing)

**Method**
- **Variables:** GRACE water storage, GPCP rain, OISST sea temperature, MODIS NDVI. 5,000 random pixels each.
- **Twins:** for each pixel, 5 phase-randomised surrogates of its *detrended* deseasonalised monthly anomalies. They keep the pixel's full spectrum (its memory at every time scale) but have random phases, so any trend in them is chance.
- **Tests compared** (share of pixels with p < 0.05):
  - Naive OLS t-test, which assumes independent months.
  - Mann–Kendall on annual means.
  - OLS with AR(1)-corrected effective sample size (the project default).
  - AR(1)-OLS plus Benjamini–Hochberg FDR across pixels (q = 0.10).

## Results: false alarms on trend-free twins (should be about 5%)
| variable | lag-1 memory | naive | Mann–Kendall | AR(1) | AR(1) + FDR | real data, AR(1) + FDR |
|---|---|---|---|---|---|---|
| water storage (GRACE) | 0.96 | **69%** | 22% | 14% | **5%** | 69% |
| rainfall (GPCP) | 0.13 | 21% | 13% | 16% | 5% | 51% |
| sea temperature (OISST) | 0.72 | 41% | 9% | 9% | 0.5% | 80% |
| greenness (NDVI) | 0.63 | 35% | 9% | 9% | 1% | 47% |

- **Naive tests are badly miscalibrated:** up to 14 times too many false alarms for water storage.
- **AR(1) correction alone is not enough** (9–16%). Real variability also has slow, decade-long swings that a one-month memory model misses. Rainfall shows this most clearly: almost no month-to-month memory, yet 21% naive false alarms.
- **Adding FDR across the map** brings false alarms to 5% or less.
- **The real data pass far more often than the twins** (47–80%), so most trends reported in this project are not artefacts of the test.

**Caveats:**
- Surrogates are periodic and Gaussian-like, so they slightly overstate the lowest-frequency power.
- GRACE gaps are linearly interpolated before the FFT.

**Verdict:** teaching result. It justifies the project's rules: AR(1)-corrected tests, Mann–Kendall as a cross-check, FDR for maps, and a second dataset before calling anything robust.

## Files
- `false_trends.png`, `stats.json`.
