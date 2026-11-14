# Task 41: Human-made earthquakes from wastewater injection

**Background:** oil and gas wells bring up much more salty formation water ("produced water") than oil. Operators dispose of it by injecting it deep underground. That raises the fluid pressure on faults and can trigger earthquakes. This is a water story too: the cause is a human water flow, moved from one rock layer to another.

**Data and method**
- Data: USGS ComCat (ANSS), earthquakes of M≥3 (regionally complete), 1980–2025.
- Regions:
  - Oklahoma and Kansas (state polygons).
  - Permian Basin (W Texas / SE New Mexico).
  - Fort Worth Basin.
  - Raton Basin (coal-bed methane wastewater).
  - New Madrid seismic zone as the natural control.
- Statistics:
  - Exact Poisson rate ratio: peak year vs the 1980–2008 baseline.
  - Pettitt change point.
  - Quasi-Poisson trends for the decline after regulation.

## Results
| region | 1980–2008 /yr | peak | × baseline (95% lower bound) | change point (Pettitt p ≤ 0.01) | largest |
|---|---|---|---|---|---|
| Oklahoma | 1.1 | 887 in 2015 | **×779** (≥551) | from 2008 | M5.8 Pawnee 2016 |
| Kansas | 0.5 | 60 in 2015 | ×116 (≥65) | from 2013 | M4.9 2014 |
| Permian Basin | 0.7 | 213 in 2022 | **×325** (≥203) | rising from 2017 | M5.4 Coalson Draw 2022 |
| Fort Worth Basin | 0.07 | 10 in 2013 | ×145 (≥31) | from 2008 | M4.0 2015 |
| Raton Basin | 2.2 | 22 in 2023 | ×10 (≥6) | from 2001 | M5.3 2011 |
| New Madrid (control) | 2.3 | 7 in 1993 | — | none (p = 0.40) | trend +1 %/decade, p = 0.94 |

- **Regulation works, and it shows in the trend.**
  - **Oklahoma:** after the state ordered disposal-volume cuts in 2016, the rate halved every **1.2 years** (p = 2e-35), from 887 a year to about 17 a year in 2021–25. M≥4 events: 103 in total, with 30 in 2015 alone.
  - **Permian Basin:** the rate doubled every **1.1 years** in 2017–22. Since Texas created seismic response areas in late 2021, it has fallen **−41% from 2022 to 2025** (p = 3e-6), but it remains about 170 a year.
- Oklahoma, Kansas and the Permian Basin hold **85%** of all M≥3 quakes in the south-central US since 2009.
- The naturally active New Madrid zone shows no change. The booms are therefore not a catalogue or detection effect, which would raise every region.

**Verdict:** **Robust** (rate ratios of hundreds, an unchanged control region, and turning points that match policy changes). Caveat: injected-volume data from the state regulators (OCC, Texas RRC) are not included. Pairing them with these counts is the obvious next step.

## Files
- `map_three_eras.png`: epicentres in 1990–2008, 2014–16 and 2022–25.
- `induced_counts.png`: annual M≥3 counts for each region and the control.
- `annual_counts_m3.csv`, `stats.json`.
