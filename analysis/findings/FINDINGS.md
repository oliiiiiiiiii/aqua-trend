# Earth System Trend Detective — curated findings (living document)

Ranked by **statistical robustness × real-world impact × visual punch**. Every number below comes from `results/<task>/` (stats JSON + figures).
Method everywhere: deseasonalised monthly anomalies → OLS with AR(1)-corrected effective sample size **and** Mann-Kendall (Hamed-Rao) / Sen; maps use Benjamini-Hochberg FDR (q = 0.10) and show only pixels where both tests agree at full colour.

Verdict scale: **Robust** = significant in both tests + physically consistent second dataset · **Significant** = both tests, single dataset · **Suggestive** = p < 0.2 or one test only.

---

# 💧 WATER FIRST (hydrology pivot, Nov 14) — water at the centre, everything else correlated against it

## W1. Space sees a dam fill: Ethiopia's GERD stores ≈ 40 km³ — **Robust (two independent NASA sensors)**
- GRACE water storage in the Blue Nile basin: +0.65 → **+2.33 cm/yr** after the first filling (Jul 2020), p = 0.009, ≈ **+7.2 km³/yr** — while basin rainfall changed by only −2 %.
- Source-vs-destination framing: water held upstream in Ethiopia; Egypt/Lake Nasser storage flat.
- **Independent confirmation (MODIS NDVI):** the cells that became the reservoir track the surrounding land (≈ 0.27–0.30) until 2021, then drop 0.23 (2022) → 0.22 → 0.17 → **0.11 (2025)** while surroundings stay ≈ 0.30 — the new lake appears exactly where and when GRACE gains water.
- Visual: `results/23_water_transfers/transfer_nile.png` (basin outlines + arrow + paired series), `gerd_ndvi_before_after.png` (before/after NDVI + year-by-year).

## W2. Taiwan getting drier? A land-only, dataset-dependent signal — **Suggestive (needs CWA gauges)**
- IMERG 0.1° island pixels: rain **−10 … −25 %/decade, significant for every start year 1998–2005** (−12.9 %/decade from 1998, p = 0.005); typhoon season −16 %, winter monsoon −12 %; extreme-rain months halved; 2021 Jan–May at 59 % of normal.
- But: IMERG at 0.5° (island + surrounding sea) −5.4 %/decade (p = 0.28); MERRA-2 −2.5 % (n.s.); GPCP −12.8 % (p = 0.009); IMERG − GPCP difference has a **step around 2012–2016 (Pettitt p = 0.0002)** → gauge-network or satellite-constellation change likely contributes.
- ET/runoff: GLDAS ET +2.8…3.8 %/decade (p ≈ 0.02) and runoff −18.7 %/decade, **but MERRA-2 shows ET −0.2 % (p = 0.94), rain −2.2 %, runoff −6.5 % (all n.s.)** → "evaporation amplifies Taiwan's drought" is **not supported** across models.
- Not ENSO-linked (|r| < 0.1). Rain arrives through the southern moisture gateway (task 22, r = +0.40), with no significant transport trend 2001–25.
- **Teaching value:** the same question gives "significant drying" or "no trend" depending on dataset and pixel choice — show both, and explain why gauge verification matters.
- Visual: `results/24_taiwan_water/map_taiwan_seasonal_rain_trends.png`, `map_2021_drought.png`.

## W3. China's South-to-North Water Diversion: decline slowed, recovery needed the rain — **Robust (phases)**
- Hai basin (Beijing–Tianjin–Hebei) storage: **−1.62 cm/yr** (2002–14, p = 7e-5) → **−1.05** (2015–20, p = 0.008, diverted water flowing) → **+2.58 cm/yr** (2021–26, p = 0.08) while basin rain rose 1.43 → 1.63 → 2.01 mm/day. Source (Han River) shows no detectable loss (transfer ≈ 10 km³/yr vs basin noise).
- Groundwater-only budget (task 21): the **aquifer** kept falling at the same rate after the diversion started (−1.44 → −1.46 cm/yr); the total slowed only because soils got wetter. Aquifers began recovering only after 2021 (+2.4 cm/yr, record floods + managed recharge).
- Visual: `results/23_water_transfers/transfer_snwd.png`.

## W3b. The hidden loss is groundwater — and in NW India it is slowing — **Robust**
- GRACE − GLDAS (soil + snow): NW India TWS −3.17 = soil +0.18 + **groundwater −3.37 cm/yr** (p = 7e-20); the climate alone would *add* ≈ 31 mm/yr, so ≈ 63 mm/yr is withdrawn by people.
- NW India aquifer loss: −4.15 (2003–10) → −2.60 (2011–16) → −1.97 cm/yr (2017–24) — roughly halved (2009 Punjab subsoil-water law + wetter monsoons).
- Same aquifer signature: North China Plain (−1.23), Central Valley (−1.14), Arabian fossil aquifers (−0.88, SNR huge), Tigris–Euphrates (−0.75); Sahel aquifers *recharging* (+0.80).
- Visual: `results/21_water_budget/map_groundwater_trend.png`, `bars_soil_vs_groundwater.png`.

## W4. Indus: irrigation plains deplete faster even in wetter years; glacier headwaters now losing — **Robust**
- Punjab plains −2.06 → **−2.68 cm/yr** after 2010 (p = 3e-11, ≈ −7.8 km³/yr) despite +16 % rain; Upper Indus/Karakoram +0.1 → **−2.22 cm/yr** (p = 4e-6).
- Same pattern in Amu Darya headwaters (−2.1 cm/yr after 2008).

## W5. India & China lead the world's greening — **Robust** (and it's linked to water)
- 41 % of vegetated land has a significant NDVI trend, 89 % of it greening; China (5.4 M km²) and India (3.5 M km², irrigated croplands) dominate; Loess Plateau +14 %/decade.
- Visual: `results/07_modis_ndvi/map_global.png`. Follow-up task 26: is India's greening paid for with groundwater?

## W6. ⚠ A "significant" trend that is fake: MODIS-Terra daytime land cooling — **Artefact (teaching case)**
- −0.9 °C/decade "cooling" over the Indo-Gangetic Plain/Sahel (p = 4e-5) vanishes for 2000–2019 (p = 0.55): it is created by Terra's orbit drift after 2020.
- Demo for the tool: significance ≠ reality — always check the instrument history.

---


## W7. What limits evaporation — water or energy? Regime map robust; the "shift" is model-dependent — **Robust map / Suggestive shift**
- Ecosystem Limitation Index (corr(ET, soil moisture) − corr(ET, radiation)): water-limited drylands vs energy-limited boreal/tropical forests. **GLDAS and MERRA-2 agree: pattern r = +0.59, same sign on 77 % of land** → robust.
- Same variable, opposite relations: ET vs VPD is positive on 40 % of land and negative on 36 % — the challenge's "same process, opposite trends".
- Shift 2014–25 vs 2003–13: GLDAS +0.059 (95 % CI +0.042…+0.076, beats an odd/even-year placebo) **but MERRA-2 −0.012 (CI −0.025…+0.001)**; shift patterns barely correlate (r = 0.14). Given GLDAS forcing drift (W11), the global shift toward water limitation is **not robust across models** in our data (Denissen et al. 2022 report it with other products) → present as an open question / model-disagreement teaching case.
- Visual: `results/20_et_correlations/map_ELI_water_vs_energy_limited.png`, `map_ELI_MERRA2.png`, `corr_ET_vs_VPD.png`.

## W8. Rivers in the sky: rain follows moisture convergence, and convergence explains the wet trends — **Robust**
- MERRA-2 boundary inflow (validated against MERRA-2's own convergence: Amazon 2.00 vs 1.99 mm/day): monthly rain tracks net convergence at r = 0.57–0.81 in every region; upwind *ocean evaporation* barely matters (null result, task 22b).
- Trends: Lake Victoria region convergence **+0.50 mm/day per decade** (↔ lake rise); NW India +0.20 (southern monsoon inflow +0.38) ↔ slower groundwater loss; Yangtze southern inflow +0.74. Taiwan's rain enters through the southern gateway (r = +0.40) but no significant transport trend yet.
- Visual: `results/22_moisture_transport/map_PminusE_flux_JJA_eastasia.png` (streamlines), `boundary_inflow_seasonal.png`.

## W9. Marine heatwaves around Taiwan went from rare to normal — **Robust**
- Kenting reefs: **6 → 115 heatwave days per year** (1982–91 → 2016–25), +30 days/yr per decade (p = 5e-6); record 211 days in 2024. Kuroshio east of Taiwan: 241 days in 2024. Region mean 9 → 112 days/yr.
- Visual: `results/08c_marine_heatwaves/calendar_Southern_Taiwan.png` (every heatwave day since 1982).

## W10. One ocean signal, opposite water effects: ENSO's cascade rain → ET → storage — **Robust**
- ENSO significantly moves rain on 18 % of land (lag ~1 month), ET on 12 % (~2 months), GRACE water storage on 20 % (~4 months): the signal propagates through the water cycle.
- El Niño drains the Amazon, southern Africa, Borneo, southern India; fills La Plata, the US Gulf coast, southern China. Taiwan's rain is not ENSO-linked (r = −0.03).
- Visual: `results/25_teleconnections/map_ENSO_water_storage.png`.

## W12. Planet-scale source → destination: land loses 703 Gt of water a year, the ocean gains 731 — **Robust (mass closes within 4 %)**
- GRACE: Greenland −258, Antarctica −126, glaciers −212, **aquifers/lakes/soil −107 Gt/yr (+0.29 mm/yr of sea level ≈ Antarctica)**; ocean +731 Gt/yr (2.02 mm/yr). Altimetry 3.47 mm/yr − ocean mass 2.02 = thermal expansion 1.45 mm/yr (Argo ≈ 1.3 ✔).
- Visual: `results/28_land_to_ocean/sources_to_ocean_bars.png`, `cumulative_mass.png`.

## W11. Null results worth showing (honesty = credibility)
- India's greening vs groundwater: spatial r = +0.09, p = 0.58 after spatial-autocorrelation correction (naive p = 5e-4) → not supported (task 26).
- Ocean evaporation upwind does not predict downstream monthly rain (task 22b).
- ⚠ GLDAS-2.1 PET/ET *trends* drift (Quebec ET doubles with flat T and radiation). MERRA-2 cross-check: ET rises significantly on 42 % of land in GLDAS vs 19.5 % in MERRA-2; **both agree on only 12 %** (`map_ET_trend_models_agree.png`). Basin runoff ratios: GLDAS 59 down / 10 up vs MERRA-2 8 down / 65 up (r = 0.20) → **no robust basin runoff trend**; teaching case on model spread.

---
## 1. The Arctic's summer ice cap has shrunk by an area ≈ 68 × Taiwan — **Robust**
- September sea-ice extent: **−11.6 % per decade** (vs 1981–2010), p = 3e-12; 2.45 million km² of September ice lost between 1979–88 and 2017–26.
- Hero visual: `results/09b_sea_ice_maps/before_after_N_09.png` (1980s ice edge drawn on today's ice).
- Also: `results/09_sea_ice/stripes_arctic.png`, `ts_arctic_september.png`.
- Twist for discussion: 2016–2026 alone shows no significant trend (p = 0.79) — a short window can hide a long-term trend.

## 2. Antarctic sea ice: a trend that flipped — **Robust (change-point)**
- 1979–2015: significant *growth* (+0.24 ± 0.10 M km²/decade, p = 8e-6). Whole record: "no trend" (p = 0.24).
- Pettitt change-point: **September 2016**, p = 4e-23; record lows in 2023.
- Teaching value: a single straight line says "nothing is happening" while one of the most abrupt shifts in the climate record is in the data.
- Visual: `results/09_sea_ice/stripes_antarctic.png`, `ts_antarctic_anomaly.png`.

## 3. NW India is draining its groundwater (but the loss is slowing) — **Robust**
- GRACE/GRACE-FO: **−3.17 ± 0.37 cm/yr** (2002–2026), ≈ **−14.5 km³ of water per year** — ≈ 85 % of Taiwan's annual water use, lost every year. Total ≈ 77 cm of water since 2002.
- Slowing: −2.8 cm/yr (2002–2016) → −1.0 cm/yr (2017–2026, n.s.) while GPCP rainfall rose +18 %/decade since 2002 → pumping still dominates the long-term loss; wetter monsoons are masking it lately.
- Visual: `results/01_grace_water_storage/ts_NW_India.png`, `map_zoom_south_asia.png`, `map_land_water_security.png`.

## 4. North China Plain: from depletion to recovery — **Robust (two significant segments)**
- 2002–2020: **−1.85 ± 0.41 cm/yr** (p = 2e-8); 2020–2026: **+2.94 ± 2.29 cm/yr** (p = 0.02).
- Drivers: South-to-North Water Diversion (2014→, aquifer recharge since 2018), pumping controls, *and* wetter years (GPCP rain +16 %/decade since 2002; 2021 & 2023 extreme floods).
- Teaching value: the full-record linear trend is not significant by OLS (p = 0.08) precisely because the trend reversed — the best demo of non-linear trends.
- Visual: `results/01_grace_water_storage/ts_North_China_Plain.png`.

## 5. Sea level: +10 cm since 1993, and the rise is speeding up — **Robust**
- Global mean (NASA-SSH altimetry): 3.19 mm/yr; acceleration **0.059 ± 0.020 mm/yr²** (p = 3e-9): **2.2 mm/yr (1993) → 4.2 mm/yr (2026)**.
- Taiwan's seas: 3.4 mm/yr (≈ global); fastest: Kuroshio Extension, Gulf of Mexico (4.3 mm/yr), Bay of Bengal (4.2 mm/yr).
- Visual: `results/12_sea_level/map_sea_level_trend.png`, `ts_global_mean_sea_level.png`.

## 6. Caspian Sea shrinking faster and faster — **Significant**
- GRACE: −4.83 ± 1.20 cm/yr (2002–2026) → **−8.32 ± 1.11 cm/yr since 2018**; −37.5 km³/yr. Impacts: ports, fisheries, Caspian seals, Kazakhstan/Azerbaijan coasts.
- Follow-up: confirm with lake-level altimetry (IDEAS I03).

## 7. The world's rain belts are shifting — **Significant (single dataset)**
- GPCP 1979–2026: Sahel **+5.9 %/decade** (p = 5e-6, rainfall recovery); southern Amazon (deforestation arc) **−3.5 %/decade** (−10.5 %/decade since 2002, p = 3e-6); Tigris–Euphrates −5.9 %/decade.
- Visual: `results/05a_gpcp_precip/map_precip_trend_pct.png`.

## 8. Middle East & Arabian aquifers: steady depletion — **Significant**
- Arabian aquifers −0.68 ± 0.07 cm/yr (SNR 5), Tigris–Euphrates −0.82 ± 0.63 cm/yr; the largest connected loss cluster on Earth (11.6 M km², −163 km³/yr incl. Caspian/Central Asia).

## 9. Ocean chlorophyll: trends mostly not yet detectable — **Suggestive (teaching case)**
- MODIS-Aqua 2002–2026: only 4 % of the ocean significant (80 % of it declining, subtropical gyres). Years-to-detect (Weatherhead): N Pacific gyre ≈ 42 yr (19 more needed).
- Teaching value: "sometimes all a trend needs to become significant is a longer period" (challenge text).

## Watch-list (needs verification before use)
- **Taiwan getting drier?** GPCP (2.5° cell, mostly sea) says −5.3 %/decade since 1979 and −15.8 %/decade since 2002 (p = 0.003), driven by fewer extreme typhoon months. GHCN-Daily has no Taiwan stations → verify with GPM IMERG 0.1° once GES DISC access is approved.

## Pending tasks (data downloading / blocked)
- SST trends since 1982 (OISST) & marine heatwaves around Taiwan · MODIS NDVI greening/browning · MODIS land surface temperature · OMI NO₂ / MERRA-2 aerosol / GPM IMERG / GLDAS (blocked until "NASA GESDISC DATA ARCHIVE" is approved in Earthdata) · MODIS AOD (needs "LAADS Web" approval).
