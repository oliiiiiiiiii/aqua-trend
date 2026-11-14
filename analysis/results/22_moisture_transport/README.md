# Task 22 — Where water comes from and where it goes: atmospheric moisture transport (MERRA-2, 1980–2026)

**Data:** MERRA-2 `M2TMNXINT` (vertically integrated water-vapour flux UFLXQV/VFLXQV, convergence DQVDT_DYN) and `M2TMNXFLX` (EVAP, PRECTOTCORR), 561 months (1980-01 → 2026-09); GPM IMERG for regional rain.

## 1. Rivers in the sky (maps)
`map_PminusE_flux_{annual,JJA,DJF}.png` (global, streamlines ∝ flux) and `..._eastasia.png`: subtropical oceans are the moisture **sources** (E > P, orange); ITCZ, monsoon belts and storm tracks are the **destinations** (blue). Summer: the SW monsoon stream from the Bay of Bengal/South China Sea and the flow around the Pacific subtropical high converge over Taiwan/East China Sea into the Meiyu–Baiu rain belt. Winter: NE monsoon flow along the coast of China past Taiwan.

## 2. Inflow through each side of a region (boundary integrals, `boundary_inflow_seasonal.png`, `boundary_*.csv`)
Validation: net boundary convergence reproduces MERRA-2's own vertically integrated convergence DQVDT_DYN (Amazon 2.00 vs 1.99 mm/day, India 0.36 vs 0.30, Sahel −0.51 vs −0.46, NCP 0.00 vs −0.02) ✔. (It does *not* equal MERRA-2 P − E because of the reanalysis' assimilation increments and the observation-corrected precipitation — a known MERRA-2 property; the `budget_check` ratios in `stats.json` reflect that, not an error.)

**Which side feeds the rain?** Correlation of monthly rain anomalies (IMERG, 2001–2025) with each side's inflow anomaly, and inflow trends (mm/day per decade; * = p < 0.05):

| Region | W | E | S | N | **net convergence** | Reading |
|---|---|---|---|---|---|---|
| Taiwan & seas | +0.21* | −0.08 | **+0.40*** | −0.25* | **+0.78*** (trend −0.13, n.s.) | rain arrives through the **southern gateway** (monsoon/typhoon); no significant transport trend 2001–25 |
| North China Plain | +0.26* (trend **+0.57***) | −0.32* | **+0.64*** | −0.39* | **+0.77*** | southerly supply drives rain; westerly inflow strengthening |
| NW India | −0.36* | +0.49* | +0.16* (trend **+0.38***) | −0.36* | **+0.72*** (trend **+0.20***) | stronger monsoon moisture supply → wetter decade → slower groundwater loss (task 21) |
| Yangtze basin | +0.38* | −0.47* | **+0.54*** (trend **+0.74***) | +0.05 | **+0.81*** | strengthening southerly monsoon inflow |
| East Africa (Victoria) | +0.36* | −0.09 | +0.32* | +0.35* | **+0.77*** (trend **+0.50***) | rising moisture convergence ↔ rising lake (task 01/21) |
| Sahel | +0.36* | +0.06 | +0.43* | −0.27* | +0.57* | monsoon (south/west) inflow |
| Amazon | +0.17* | +0.01 | +0.35* | +0.42* | +0.75* | — |

**Key insight:** in every region, monthly rain follows the *net moisture convergence* (r = 0.57–0.81) much more than any local or upwind evaporation (see §4).

## 3. Recycling ratio (Brubaker et al. 1993, E/(E + 2·inflow))
Sahel 0.29, Amazon 0.20, Taiwan & seas 0.16, Middle East 0.15, Yangtze 0.13, NW India 0.11, NCP 0.06. Trends: Amazon **−0.008/decade (p = 6e-14)**, NW India +0.006/decade (p = 0.005), NCP +0.005/decade (p = 7e-6). Caveat: MERRA-2 uses fixed vegetation, so the Amazon decline is not a deforestation signal in the model — treat as suggestive.

## 4. Ocean source → land rain (task 22b, `ocean_source_*.png`)
Month-to-month correlation of ocean evaporation (MERRA-2) with downstream rain is **weak and scattered** (Taiwan: 23 significant ocean cells, max r = 0.27; South China: 1) — **a null result with a physical message**: rain variability is controlled by how much moisture the winds *converge*, not by evaporation changes at the source.

## 5. Trends in the water cycle (`map_PminusE_trend.png`, `map_flux_strength_trend.png`)
"Wet-gets-wetter" test: spatial r(trend, climatology) = +0.11 only; both wet and dry regions show negative P − E trends — MERRA-2 ocean evaporation/precipitation trends are affected by observing-system changes (Bosilovich et al. 2017) → **do not use MERRA-2 P − E trends for headline claims**; flux maps and boundary-inflow correlations are robust.
