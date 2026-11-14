# Task 20 — Evapotranspiration (蒸發量) at the centre: what controls it, where, and is that changing?

**Data:** GLDAS-2.1 Noah monthly ET + drivers (root-zone soil moisture, net radiation Rn, air temperature, VPD from T/q/p) 2000–2026; GPM IMERG rain; MODIS NDVI & daytime LST (LST only to 2019 — Terra orbit drift, task 07b); GRACE TWS. All on a common 0.5° grid (`scripts/hub.py`).
**Method:** per-pixel correlation of deseasonalised + detrended monthly anomalies with **AR(1)-adjusted effective sample size** (Bretherton 1999) and BH-FDR (q = 0.10) — `trendlib.grid_corr` (validated: 5.5 % false positives on AR(1) noise vs 25 % for a naive test).

## ET vs everything else (share of ice-free land with significant correlation)
| Driver | median r | sig. positive | sig. negative | Meaning |
|---|---|---|---|---|
| Soil moisture | +0.35 | **69 %** | 5 % | most land is water-limited |
| Net radiation | +0.34 | **79 %** | 4 % | energy matters almost everywhere |
| Precipitation | +0.20 | 61 % | **15 %** | sign flips: rainy months are cloudy (less ET) in wet regions |
| Air temperature | +0.10 | 45 % | 17 % | sign flips: hot months = dry months in drylands |
| **Air dryness (VPD)** | +0.01 | **40 %** | **36 %** | **clearest sign flip**: thirsty air pulls water in wet places, signals drought (plants shut stomata) in dry places |
| NDVI (MODIS, independent) | +0.16 | 53 % | 3 % | greener ↔ more ET |
| Land surface temperature (2000–19) | −0.05 | 25 % | **40 %** | evaporative cooling: more ET ↔ cooler surface |
| GRACE water storage | +0.12 | 41 % | 5 % | independent satellite confirmation of water limitation |

→ **Same variable, opposite relationships in different regions** — exactly the challenge's point; maps `corr_ET_vs_*.png`.

## What limits evaporation? Ecosystem Limitation Index (Denissen et al. 2020)
ELI = r(ET, SM) − r(ET, Rn): water-limited (ELI > 0) in deserts/drylands, Australia, southern Africa, Central Asia, NE Brazil, western US; energy-limited (ELI < 0) in boreal forests, Amazon, Congo, Maritime Continent, southern China, Sichuan Basin (−1.0), Taiwan (−0.17). Maps `map_ELI_*.png`.

## Is it shifting? 2014–2025 vs 2003–2013 (`map_ELI_shift_*.png`, `eli_shift_vs_placebo.png`)
| | mean ΔELI | sd | land > +0.2 | land < −0.2 |
|---|---|---|---|---|
| **Real split** | **+0.059** (95 % CI **+0.042 … +0.076**, 5° block bootstrap) | 0.27 | **29.3 %** | 17.6 % |
| Placebo (odd vs even years, no trend) | +0.005 | 0.20 | 15.6 % | 14.9 % |

**GLDAS verdict: shift toward water-limited evaporation beats the placebo** — *but see the MERRA-2 cross-check below: not reproduced* — ≈ 14 % of land moved toward water limitation beyond chance vs ≈ 3 % toward energy limitation (consistent with Denissen et al. 2022, *Nature Climate Change*). Hotspots: Europe/Benelux (−0.59 → −0.22, drought summers 2018–2022), boreal Canada & Siberia, India/Indo-Gangetic Plain (0.06 → 0.27), North China Plain (0.02 → 0.22), southern Africa, eastern Brazil. Toward energy limitation: wetter Sahel interior, Mongolia/N China, Australia (wet 2020–22).

## ET trend (GLDAS 2000–2026)
Significant increase over **45 % of land**, decrease 3 %. NW India +14 %/decade, North China Plain +12 %, Indo-Gangetic +7.5 %, Sahel +6.9 %, Benelux +5.8 %, Taiwan +2.4 % (p = 0.04). ⚠ **Caveat found:** GLDAS-2.1 potential ET rises ~20 % globally and *doubles* in Quebec–Labrador while air temperature and sunshine are flat (forcing inhomogeneity; a downward-shortwave jump in 2025). **GLDAS ET/PET *trends* are therefore not trustworthy**; correlation-based results (ELI, detrended anomalies) are much less exposed. Cross-model check with MERRA-2 land → `merra2_crosscheck.json` (task 20c).

## Files
`corr_ET_vs_{P,SM,Rn,Tair,VPD,NDVI,LST,TWS}.png`, `map_ELI_water_vs_energy_limited.png` (hero), `map_ELI_{region}.png`, `map_ELI_shift_2003-13_vs_2014-25.png`, `eli_shift_vs_placebo.png`, `map_ET_trend.png`, `regional_table.csv`, `summary.json`, `eli_placebo.json`, `correlation_fields.nc`.

## Cross-model check with MERRA-2 land (task 20c, `merra2_crosscheck.json`)
- ELI *map*: MERRA-2 vs GLDAS pattern r = **+0.59**, same sign on **77 %** of land → the water- vs energy-limited regime map is robust (`map_ELI_MERRA2.png`).
- ELI *shift* 2014–25 vs 2003–13: MERRA-2 mean **−0.012** (95 % CI −0.025…+0.001; placebo +0.011); shift-pattern r with GLDAS = 0.14 → **the shift is model-dependent, not robust** (`map_ELI_shift_MERRA2.png`).
