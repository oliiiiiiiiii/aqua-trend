# Task 21 — Land water budget: what the climate supplies vs what the land keeps, and the human gap

**Data:** GRACE/GRACE-FO total water storage (TWS); GLDAS-2.1 Noah soil moisture (0–200 cm), snow, ET, runoff; GPM IMERG rain.
**Method:** groundwater + surface water = TWS − GLDAS (soil + snow) anomalies (Rodell et al. 2009). GLDAS Noah has **no irrigation, pumping or reservoirs**, so the trend of this residual maps human-driven (and lake/glacier) storage change. Per-pixel OLS+AR(1) & MK, FDR q=0.10. Regional flux budgets P − ET − R vs observed dS/dt (2003–2024).

## Storage split (2002–2026, cm/yr)
| Region | TWS | = soil | + groundwater/lakes | GW p | Reading |
|---|---|---|---|---|---|
| **NW India** | −3.17 | +0.18 | **−3.37** | 7e-20 | entirely aquifer loss (soil even slightly wetter) |
| Indo-Gangetic Plain | −1.44 | −0.03 | −1.32 | 3e-11 | aquifer |
| **North China Plain** | −0.88 | +0.27 | **−1.23** | 0.0015 | aquifer |
| California Central Valley | −1.04 | −0.00 | −1.14 | 2e-4 | aquifer (pumping in droughts) |
| Arabian aquifers | −0.69 | +0.08 | −0.88 | 3e-43 | fossil groundwater mining |
| Tigris–Euphrates | −0.83 | −0.08 | −0.75 | 2e-4 | aquifer + reservoirs |
| Caspian Sea | −4.82 | −0.13 | −3.28 | 4e-5 | lake level fall |
| East African lakes | +3.24 | −0.08 | +3.22 | 0.005 | lake rise (Victoria) |
| Sahel | +0.84 | +0.04 | +0.80 | 5e-4 | aquifer recharge with the rainfall recovery |

## Phase budgets (groundwater component, cm/yr)
| Region | 2003–2010/14 | middle | latest | Reading |
|---|---|---|---|---|
| **NW India** | −4.15 (2003–10) | −2.60 (2011–16) | −1.97 (2017–24) | loss **halved** — Punjab's 2009 subsoil-water law (delayed rice transplanting) + wetter monsoons; still significant depletion |
| **Hai basin (S→N diversion destination)** | −1.44 (2003–14) | **−1.46** (2015–20) | +2.37 (2021–24, p=0.12) | aquifer decline did **not** slow when diverted water arrived — total storage slowed only because soils got wetter; aquifers began recovering only after 2021 (record floods + managed recharge) |

## Climate supply vs storage (2003–2024, mm/yr)
NW India: P 684 − ET 553 − R 100 = **+31** supplied by climate, yet storage **−32** → ≈ **63 mm/yr withdrawn by people**. Same sign in NCP (+32 vs −9), Central Valley (+21 vs −10), Tigris–Euphrates (+16 vs −8). Caveat: flux budgets do not close well (IMERG rain ≠ GLDAS forcing rain; lake outflows not in GLDAS runoff — e.g. Lake Victoria +352 vs +32) → use the storage split as the robust result, the flux gap as indicative.

## Figures
`map_groundwater_trend.png` (**hero**), `map_groundwater_{south_asia,east_asia,middle_east,north_america}.png`, `bars_soil_vs_groundwater.png`, `map_soilmoisture_trend.png`; tables `regional_budget.csv`, `phase_budgets.csv`, `groundwater_hotspots.csv`.

**Bug note:** the first run's phase table used a NaN-unsafe basin mean (missing GRACE months → 0); corrected here.
