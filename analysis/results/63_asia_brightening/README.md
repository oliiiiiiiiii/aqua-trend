# Task 63: Clearing skies over East Asia — CERES sees less sunlight reflected, more reaching the ground

**Data and method**
- **CERES EBAF Ed4.2.1 monthly** (2000-03 to 2026-07, 1°). The original 2 GB file was reduced to `data/processed/ceres/ebaf_sw.npz` (7 variables).
  - TOA clear-sky reflected shortwave: measured by the CERES radiometers over cloud-free scenes.
  - Surface clear-sky and all-sky downward shortwave: computed by radiative transfer, with MODIS-constrained aerosols.
- **Aerosol:** MERRA-2 total AOD.
- **Trends 2005–2025:** Theil–Sen; p = max(AR(1)-OLS, Mann–Kendall); FDR q = 0.10.
- **Regressions:** regional annual series, reflection vs AOD, raw and detrended.

## Results
| region | AOD 2005–07 → 2023–25 | TOA clear-sky reflected SW | surface clear-sky SW | surface all-sky SW | reflection vs AOD r (detrended) |
|---|---|---|---|---|---|
| Eastern China | 0.59 → 0.44 | **−2.17 W m⁻²/decade** (p = 2e-5) | **+6.4** (p < 0.001) | **+5.4** (p = 0.012) | **0.96** (0.83) |
| Korea & Japan | 0.34 → 0.25 | −1.62 | +3.3 | +5.5 | 0.96 (0.47) |
| Indo-Gangetic Plain | 0.35 → 0.40 | −0.33 (p = 0.03) | −3.1 | **−6.7** (dimming) | −0.09 (n.s.) |

- **Aerosol "mirror" strength over eastern China:** about 19 W m⁻² of clear-sky reflection per unit AOD (16 detrended).
- **India:** the ground dims as haze grows, but the TOA reflection does not track AOD. This is consistent with soot-rich, light-absorbing aerosol (cf. the fine-mode rise in task 58).

**Caveats:**
- The surface fluxes are computed, not measured.
- TOA clear-sky reflection also responds to snow and albedo changes (visible over Siberia and Tibet in map A).

**Verdict:** robust for East Asia. An independent radiometer measurement agrees with the aerosol record year by year.

## Files
- `asia_brightening.png`, `stats.json`.
