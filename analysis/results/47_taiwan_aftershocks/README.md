# Task 47: Taiwan's two great earthquakes — aftershock decay (Omori's law)

**Data and method**
- Data: USGS ComCat, M≥4 around Taiwan.
- Aftershocks: events within the Gardner–Knopoff radius of each mainshock (86 km for Chi-Chi, 79 km for Hualien), over 0.1–730 days.
- Fit: the Omori–Utsu law n(t) = K/(t+c)^p by maximum likelihood (Ogata 1983), with 200 bootstrap resamples for the CI of p.
- Background: the declustered pre-mainshock rate in the same circle since 1990.

## Results
| | Chi-Chi 1999 (M7.7) | Hualien 2024 (M7.4) |
|---|---|---|
| aftershocks M≥4, first year | 205 | 391 |
| aftershocks M≥4.5, first year | 120 | 202 |
| Omori p [95% CI] | **0.95** [0.88–1.02] | **0.96** [0.90–1.05] |
| c (days) | 0.20 | 0.35 |
| M≥6 aftershocks (2 yr) / largest | 9 / M6.5 | 4 / M6.4 |
| background M≥4 per yr | 2.7 | 3.6 |
| extrapolated return to background | ≈13 yr | ≈19 yr |

- Both sequences decay at the same Omori rate (p ≈ 0.95). The burst around day 20 of Hualien is the M6+ doublet of 22–23 April 2024.
- **Detection caveat:** Hualien's higher aftershock count is partly better detection.
  - Island-wide, independent M≥4 quakes rise +9 %/decade (p = 0.006) and M≥4.5 rise +12 %/decade (p = 0.007).
  - But **M≥5 are flat** (+1 %/decade, p = 0.93). This is the same detection artefact as the global result in task 40.

**Verdict:**
- **Robust:** both sequences obey Omori's law with p ≈ 0.95.
- **Not a real trend:** the rise in island-wide M≥4 counts (it is detection).
- The return-to-background times are extrapolations.

## Files
- `taiwan_aftershocks.png`, `stats.json`.
