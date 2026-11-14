# Task 50: Hunga Tonga–Hunga Ha'apai (15 Jan 2022) waters the stratosphere

**Data and method**
- **Data:** Aura MLS v5 Level-3 daily zonal-mean water vapour (ML3DZH2O), 2004-08 to 2025-12, 4° latitude bins, 82°S–82°N, 100–1 hPa.
- **Monthly means and anomalies:**
  - Monthly means require ≥10 days.
  - Anomalies are taken against the 2005–2021 climatology.
  - The 8.25 hPa level zig-zags against its neighbours (a retrieval-grid artefact), so it is replaced by log-p interpolation.
- **Water mass:** stratospheric water mass = Σ q·Δp/g·area, with q = vmr·18.015/28.964.
- **Drift and excess:** the slow 2005–2021 drift (+2.8%/decade; MLS v5 is known to drift ~2–3%/decade against frost-point balloons) is fitted and extrapolated. The excess is measured against that line.
- **Decay:** exponential fit after the peak, with a moving-block bootstrap CI.
- **Sampling caveat:** Aura MLS observed on 179 days in 2024 and 105 in 2025 (spacecraft power management), so some months are blank.

## Results
- **Normal stratospheric water:** 1,311 Mt (100–1 hPa).
- **Peak excess:** **+170 Mt (+13%)** in January 2023, **9 σ** beyond 2005–21 variability.
  - Every one of the 46 measured months since February 2022 exceeds the largest pre-eruption value.
  - Without the drift correction the peak is +205 Mt.
- **Annual mean excess:**

  | year | excess |
  |---|---|
  | 2022 | +142 Mt |
  | 2023 | +149 Mt |
  | 2024 | +105 Mt |
  | 2025 | +101 Mt |

- **Decay:** e-folding **4.5 yr** (95% CI 3.0–8.5). 53% of the peak remained at the end of 2025, and the excess falls to 10% around 2033.
- **Where the water went** (panels A and B):
  - The plume entered at 20–40 hPa in the southern tropics.
  - The Brewer–Dobson circulation carried it upward to 1–5 hPa within a year and across both hemispheres.
  - It reached Antarctica in 2023.
- **Pettitt** puts the change point at Jan 2020 (p = 7e-19). This is not physical: the test is pulled earlier by slightly positive 2020–21 anomalies, so the monthly exceedance count and z-score are the headline instead.

**Verdict:** robust. This is the largest perturbation in the 21-year MLS record and is consistent with published estimates (~150 Mt, ~10%). The exact decay time is uncertain because of reduced 2024–25 sampling.

## Files
- `hunga_tonga_stratospheric_water.png`, `stats.json`, `stratospheric_water_mass.csv`.
