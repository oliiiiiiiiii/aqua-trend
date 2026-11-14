# Task 67: Is the Amazon losing resilience? An early-warning test with MODIS NDVI — **not yet significant**

**Data and method**
- **Data:** MODIS NDVI monthly (0.5°, 2000–2026), Amazon box 80–44°W, 20°S–8°N.
- **Forest pixels:** mean NDVI > 0.75 and >85% valid months; 2,008 pixels.
- **Processing:** deseasonalise, then remove slow changes with a centred 25-month running mean.
- **Indicator:** lag-1 autocorrelation (AR1) in 60-month rolling windows, and the Kendall τ of AR1 vs time (critical slowing down, Boulton et al. 2022).
- **Significance:** for the forest-mean series, 1,000 phase-randomised surrogates with the same spectrum.
- **Comparison:** τ vs the dry-season (Jul–Oct) GPCP rain trend.

## Results
- **Pixels:** AR1 rose on **59%** of forest pixels (median τ = +0.07). 22% have τ > 0.3 and 11% have τ < −0.3.
- **Forest-average AR1:** 0.20 (window ending 2005) → 0.28 (window ending Oct 2026).
  - τ of the mean of pixel AR1 = +0.43; τ of the AR1 of the forest-mean series = +0.38.
  - **Surrogate p = 0.15: not significant.**
- **Drying link:** the spatial link with dry-season drying is absent (Spearman ρ = +0.01). The north and south halves are similar (median τ 0.07 vs 0.06).

**Verdict:** suggestive at most. The direction matches published resilience-loss studies, but 26 years of NDVI cannot separate it from chance.

**Caveats:**
- NDVI saturates over dense canopy and is cloud-affected.
- MODIS sensor changes.
- Rolling windows make the AR1 series heavily autocorrelated, which is why surrogates are essential.

## Files
- `amazon_resilience.png`, `stats.json`.
