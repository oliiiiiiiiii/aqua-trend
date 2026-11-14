# Task 40: Is the Earth shaking more? Global earthquake rates, 1973–2025

**Question:** do earthquake counts show a real trend, or only better detection?

**Data**
- USGS ComCat: 287,308 events of M≥4.5, 1973–2025.
- Global CMT (GCMT): an independent moment-magnitude catalogue, 1976–2025.

**Method**
- Gardner–Knopoff declustering removes aftershocks and foreshocks; 34% of USGS events remain as mainshocks.
- Annual counts are tested with a quasi-Poisson log-linear trend and Mann–Kendall.

## Results
| series | period | trend | p (quasi-Poisson / MK) |
|---|---|---|---|
| USGS M≥4.5, all events | 1973–2025 | **+21.7 %/decade** | 2e-52 / 3e-15 |
| USGS M≥4.5, mainshocks | 1973–2025 | **+13.2 %/decade** | 1e-77 / 3e-16 |
| USGS M≥6, mainshocks | 1983–2025 | −1.5 %/decade [−4.1, +1.3] | 0.29 / 0.40 |
| USGS M≥7, mainshocks | 1983–2025 | +1.0 %/decade [−5.7, +8.0] | 0.78 / 0.75 |
| GCMT Mw≥6, mainshocks | 1983–2025 | +2.4 %/decade [−0.7, +5.6] | 0.13 / 0.11 |

- **Small quakes increase because detection improves.**
  - The excess of M≥4.5 events shrinks to zero by M≈5.5 (`detection_fmd_by_decade.png`).
  - The ratio of M≥4.5 to M≥6 mainshocks rose from 20 to 27 (Kendall τ = 0.59, p = 3e-8).
  - Per 10° cell (`map_quake_rate_change.png`, 2005–25 vs 1984–2004, exact Poisson test with FDR):
    - M4.5–5.4 rose significantly in **49%** of 275 cells and fell in 1%.
    - M≥6 changed significantly in **0%** of 90 cells (all cells ×0.99).
- **A trap that fakes a trend: the 1982–83 magnitude-scale switch.**
  - Before 1982, almost no USGS M≥6 magnitudes were moment magnitudes; from 1984 on, 99% are.
  - The M≥6 mainshock count steps from 65 to 93 per year (Pettitt change point after 1982, p = 0.002).
  - Starting the trend in 1973 therefore gives a false **+4.8 %/decade (p = 0.001)**.
  - Decade b-values: 0.98 in 1973–84 against 0.84–0.90 afterwards.
- **Sensitivity checks**
  - M≥6, 1990–2025: −3.2 %/decade (p = 0.07).
  - No foreshock window: −2.0 %/decade (p = 0.13).
  - Without declustering: −1.6 %/decade (p = 0.38).
  - M≥5.5: −0.5 %/decade (p = 0.62).
  - GCMT 1976–2025: +3.0 %/decade (p = 0.014). This comes from GCMT's sparse early years, and from 1990 it is +2.9 %/decade (p = 0.13).
  - The two catalogues disagree in sign since 1983, so there is **no robust change in the rate of large earthquakes**.
- **The 2004–2012 burst of great earthquakes**
  - The event: 5 of the 6 M≥8.5 mainshocks since 1973 fell within 8 years (Sumatra 2004, Nias 2005, Chile 2010, Tōhoku 2011, Indian Ocean 2012; the sixth is Kamchatka 2025).
  - The test: a scan statistic over window lengths of 3–15 years, calibrated by Monte Carlo.
    - USGS M≥8.5: p = 0.02. GCMT Mw≥8.5: p = 0.03. M≥8: p = 0.04.
    - These p-values are borderline: the threshold and the catalogue start were chosen after the burst was known, and century-long catalogues (e.g. Shearer & Stark 2012) find such bursts consistent with chance.
- **Energy:** three years (2011, 2004 and 2010) hold 33% of all seismic moment released since 1976.

**Verdict.**
- **Robust null:** large-earthquake rates are steady.
- **Robust artefact:** small-quake "increase" (detection).
- **Teaching case:** the 1983 magnitude-scale step.

## Files
- `global_quake_counts.png`: small multiples per threshold, plus the panel showing the magnitude-type switch.
- `detection_fmd_by_decade.png`: rate at or above each magnitude, relative to 1985–94.
- `map_quake_rate_change.png`: change in mainshock rate per 10° cell, small vs large quakes.
- `map_big_quakes_timeline.png`: all M≥6 mainshocks by depth since 1983, and the timeline of M≥7 mainshocks.
- `annual_counts.csv`, `stats.json`.
