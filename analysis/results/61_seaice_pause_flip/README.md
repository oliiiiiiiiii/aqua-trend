# Task 61: Two sea-ice traps — a cherry-picked Arctic "pause" and an Antarctic collapse that coincides with ocean warming

**Data and method**
- **Data:** NSIDC Sea Ice Index v4 monthly extent (1979–2026); NOAA OISST v2.1 (1982–2026).
- **Arctic, September minimum 1979–2025:**
  - One line vs the best continuous two-segment fit (hinge searched 2000–2016), compared with an F-test.
  - Slope since 2012.
  - Monte Carlo (20,000 runs): the long-term trend plus AR(1) noise with the observed residual sd (0.52 M km²) and φ (0.16).
- **Antarctic:**
  - Extent anomaly vs the Southern Ocean SST anomaly at 50–60°S, which is open water and avoids the sea-ice SST mask.
  - Pettitt change points, lagged monthly correlations, and annual correlations (raw, detrended, first differences).
  - Phase-randomised surrogates (5,000) to account for persistence.

## Results
**Arctic:**
- **Long-term loss:** −0.76 M km²/decade (1979–2025).
- **Since 2012**, the record-low year: −0.01 M km²/decade, 95% CI −0.62 to +0.60, n = 14.
- **How rare is a 14-year window this flat?**
  - Fixed in advance as the last 14 years: **2.8%** of simulated records.
  - Anywhere in a 47-year record: **41%** (look-elsewhere effect).
- **Breakpoint model** (hinge 2016) vs one line: p = 0.08.
- **Verdict:** a slowdown is possible but not demonstrated. The start year was chosen after seeing the data (2012 is the record low), which is the classic cherry-picking trap. Recent literature discusses a slowdown since about 2012 as internal variability.

**Antarctic:**
- **Ice change point:** Aug 2016 (p = 4e-23). Mean anomaly +0.10 → −0.75 M km²; record low in Jul 2023 (−2.39 M km²).
- **SST change point at 50–60°S:** Mar 2009 (p = 9e-41). The 2016–25 mean is +0.29 °C above 1982–2015.
- **Annual correlation:** r = −0.47 (naive p = 0.001, surrogate **p = 0.08**); detrended −0.45 (surrogate p = 0.08). First differences: r = −0.06 (p = 0.70).
- **Verdict:**
  - Ice and the ocean co-vary at multi-year scale, but with few independent swings the link is not significant once persistence is allowed for.
  - Year-to-year changes do not co-move.
  - The warming ocean "setting the stage" is suggestive, not proof.
- The 12-month-smoothed correlation (r = −0.53) has an effective n of only about 2. This is a reminder that smoothing inflates apparent correlation.

## Files
- `seaice_pause_and_flip.png`, `stats.json`.
