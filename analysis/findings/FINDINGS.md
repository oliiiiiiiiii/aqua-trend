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

## W13. The ocean–land seesaw: when the continents soak up rain, global sea level drops — **Robust (GRACE land, GRACE ocean, altimetry agree)**
- Year-to-year swings (seasons and quadratic trend removed): GRACE ocean mass mirrors water stored on non-glaciated land, **r = +0.67**; altimetry sea level follows the same wiggles (r = +0.65 with ocean mass).
- **2011 La Niña:** ≈ 1622 Gt of extra rain parked on the continents → ocean mass **−5.0 mm** (altimetry −7.7 mm) — about 1.5 years of the long-term rise undone, temporarily. **2016 El Niño** did the opposite: land released ≈ 1816 Gt, ocean +6.2 mm.
- ENSO leads ocean mass by **5 months** (r = +0.41, p = 0.0001, AR(1)-adjusted).
- **Where the borrowed water sits** (share of the global land swing): Brazil 30%, Russia 13%, India 9%, Australia 7%; by continent South America 32%, Africa 26%, Europe & N Asia 18%. The Amazon basin is the planet's biggest "sponge"; the La Plata basin swings the opposite way (dry when the Amazon is wet).
- Why it matters: a sea-level record of a few years can show a fake "acceleration" or "pause" just from where rain falls — detecting the climate trend needs the land water removed (source → destination accounting).
- Visual: `results/30_ocean_land_seesaw/seesaw_timeseries.png`, `map_where_land_water_swings.png`.

## W14. 2024 was the most widespread hot-and-dry year of the satellite era — **Robust record (2 land models + GRACE); linear trend model-dependent**
- Compound month = root-zone soil moisture below its 10th percentile **and** temperature above its 90th, per pixel and calendar month. By chance alone this happens about 1% of the time.
- **Both land models rank 2024 first:** 8.9% (MERRA-2) and 8.0% (GLDAS) of land in this state in an average month. The previous records were 6.1% (2002) and 5.4% (2019). In both models the most widespread 24-month window ends in May 2025.
- **Where (Jun 2023 – May 2025):** the Amazon basin, Cameroon and Congo, southern Africa (Zambia, Zimbabwe, Madagascar), Mexico, Morocco and Algeria, and Canada. Hardest hit: Cameroon 7.0, Brazil 6.4, Venezuela 5.8, Bolivia 5.5, Peru 5.2, Zimbabwe 4.9 compound months out of 24 (≈ 0.5 expected by chance).
- **GRACE independently confirms it:** Mexico's storage in Oct 2023 was the lowest of all 259 months; the Amazon in Sep 2024 was the 3rd-lowest month (−16.6 cm); southern Africa in Jan 2025 ranked 7th.
- **The honest part:**
  - Hot months rose in both models (MERRA-2 1.1 → 1.8, GLDAS 0.9 → 2.0 per year, 2001–12 vs 2014–25).
  - **Dry months go opposite ways:** MERRA-2 1.6 → 1.3 vs GLDAS 1.0 → 1.9. GLDAS's drying matches its known forcing drift.
  - So the 25-year compound trend is model-dependent: MERRA-2 3.7 → 4.6% (p = 0.51) vs GLDAS 1.0 → 4.2% (p = 0.0004).
  - No pixel has a significant trend in annual counts: 25 years of mostly-zero counts give little statistical power.
- Visual: `results/32_compound_hot_dry/map_2023_25_compound_event.png` (map), `calendar_compound_hot_dry.png` (every month since 2001; 2023–25 is the darkest band).

## W15. The southern Amazon's dry season is getting drier and longer, and a warming Atlantic explains why — **Robust (3 rain datasets; attribution quantitatively consistent)**
- **Jul–Sep rain** over the southern Amazon / deforestation arc (70–50°W, 15–5°S):
  - GPCP **-10%/decade** over 1979–2025 (p = 3e-04);
  - IMERG **-17%** (p = 0.01);
  - MERRA-2 gauge-corrected **-26%** (p = 5e-04).
  - Both OLS-AR1 and Mann-Kendall agree in every dataset.
- **Dry-season length** (months under 100 mm): GPCP +6 days/decade (p = 2e-04), IMERG +13, MERRA-2 +17. The GPCP mean went from 4.1 months (1979–2000) to 4.8 months (2014–25).
- **GRACE:** end-of-dry-season storage (Sep–Nov) -2.0 cm/decade is not significant (p = 0.32), but **2024 is the lowest** of the GRACE era. This connects to W14: the Amazon was the epicentre of the 2023–25 compound hot-dry event.
- **Caveat:** the three rain products share some gauge input (GPCC), though gauges are sparse in the Amazon so the satellite and model parts dominate. The physics fits published work on dry-season lengthening in the southern Amazon (deforestation plus warming of the tropical North Atlantic).
- **Also robust in all three datasets:** the Sahel wet season is getting wetter: GPCP +7%/decade, IMERG +6%, MERRA-2 +26%. Southern Africa, Ganges and Mekong dry-season trends appear only in GPCP and are not robust.
- Visual: `results/33_seasonal_swing/amazon_dry_season.png`.
- **Why (task 36): a warming tropical North Atlantic accounts for the trend.**
  - Year to year, a warmer tropical North Atlantic means a drier southern Amazon dry season: detrended r = -0.48 (p = 0.001), sensitivity -0.68 mm/day per °C. The sensitivity is stable, at -0.71 from 1982–2010 data alone.
  - The Atlantic warmed +0.27 °C/decade. That predicts **-0.18 ± 0.10 mm/day per decade, against the observed -0.18** (GPCP 1982–2025).
  - After removing Atlantic and ENSO influence, the residual trend is +0.001 (p = 0.98).
  - Mechanism: the rain belt shifts north toward the warmer Atlantic. MERRA-2 moisture-flow changes point north over the Amazon. 2005, 2010, 2023 and 2024 are all warm-Atlantic dry years.
  - The MERRA-2 dry-season budget shows rain -0.22, evaporation -0.26 and total inflow -0.26 mm/day per decade, with the recycling ratio falling. But the budget residual trends by +0.60, so the reanalysis cannot separate local (deforestation) from remote causes.
  - This doesn't exclude a deforestation contribution; it shows the ocean driver alone is enough to explain the size of the trend.
  - Visual: `results/36_amazon_moisture_budget/amazon_moisture_budget.png`.

## W16. Rain is replacing snow on the world's snowy land — **Robust in aggregate and for the Alps, eastern Europe, Japan & Korea (MERRA-2 + MODIS); High Mountain Asia model-only**
- MERRA-2, 1980–2025: on snowy land (56 million km² with at least 5% snow), the share of precipitation falling as snow went from **35.2% (1980s) to 31.3% (2016–25)**, -1.14 percentage points per decade (p < 1e-6, Mann-Kendall agrees).
- Spatially: a significant loss of snow share on **26% of snowy land and a significant gain on 0%**. 89% of snowy land has a negative trend.
- Water towers:
  - High Mountain Asia 49% → 41% (-2.0 pp/decade);
  - Alps 20% → 14%, where snowfall itself is also down -5.3%/decade (p = 0.02);
  - NE China & Mongolia 18% → 13%;
  - Rockies 37% → 34%.
  - Only the southern Andes shows no change.
- **Why it matters for water:** snow stores winter precipitation and releases it in spring and summer, when crops and cities need it. Rain runs off at once. A smaller snow share means less natural storage, even where total precipitation is unchanged; total snowfall amounts are mostly not significant.
- **Caveats:**
  - The rain/snow split comes from the reanalysis model, but its temperature is constrained by observations.
  - GLDAS March snowpack falls on 64% of snowy land, but its sign agrees with the MERRA-2 snow-share trend on only 60% of land (2001–25).
  - The MERRA-2 convective share of rain has mixed trends (+ on 13%, − on 10% of land). That's model physics, so this is not a finding.
- Visual: `results/34_rain_replacing_snow/map_snow_fraction_trend.png`, `bars_regions_snow_share.png`.
- **Independent satellite check (task 34b, MODIS/Terra snow cover, 2001–2025).**
  - Spring (Mar–May) snow cover on snowy land fell from 62.8% (2001–05) to 59.9% (2021–25), -1.27 pp/decade (p = 0.018, Mann-Kendall p = 0.021). 66% of snowy land has a negative trend.
  - Regional declines: Japan & Korea -5.6 pp/decade (p = 0.004), eastern Europe and western Russia -5.5 (p = 0.04), Alps -4.0 (p = 0.02).
  - **But High Mountain Asia (+0.5, n.s.) and the Rockies (+1.3, n.s.) show no decline in snow cover.** The MERRA-2 phase shift there is not seen by the satellite.
  - Pixel-level sign agreement with MERRA-2 is 62% (pattern r = 0.26). Single pixels don't pass FDR over 25 years.
  - Visual: `results/34_rain_replacing_snow/map_modis_spring_snow_cover_trend.png`.

## W17. A world splitting into record-dry and record-wet: 32% of land is at its lowest water storage of the GRACE era — **Significant (GRACE; vs 15% by chance)**
- 12-month mean storage (seasons removed), 2003–2026: for **32% of land the lowest value occurred in the last three years** (Oct 2023 – Sep 2026), and for 23% the highest did. A stationary climate would put about 15% in each.
- 38% of land reached its driest point of the satellite era in 2022 or later.
- **Record low now** (share of each country's area): Syria 100%, Romania 100%, Tunisia 100%, Kyrgyzstan 100%, Poland 100%, Iran 94%, Saudi Arabia 94%, Afghanistan 93%, Sweden 93%, Iraq 88%. These fall in a belt across the Middle East, Central Asia, eastern Europe and Scandinavia, plus Mexico and the western US, the southern Amazon and Patagonia.
- **Record high now:** Burkina Faso 100%, Ghana 100%, Senegal 100%, Ethiopia 100%, Somaliland 100%, Uganda 100%, S. Sudan 97%, Tanzania 97%. The Sahel and East Africa are getting wetter, matching W8 (more moisture convergence) and the Lake Victoria rise.
- **Caveat:** under a trend, records naturally cluster at the end of the series, so this map is a vivid way of showing the trends plus recent extremes (2023–25 droughts, see W14). The most recent GRACE-FO months may still be revised.
- Visual: `results/35_record_map/map_record_low_high_now.png`, `map_year_of_lowest_storage.png`.

## W18. East Asia's water extremes, ranked from space — **Robust (GRACE + IMERG)**
- **2022 Yangtze heat-drought:** basin water storage fell to **-10.5 cm in 2022-09, the lowest of all 259 GRACE months.** The previous record was -8.9 cm (2003-11). IMERG July–August rain was 52% of normal, the driest of 25 years.
- **2021 Henan / North China floods:** July rain over Henan was 247% of normal, the wettest of 25 years. North China Plain storage jumped **+13.6 cm in 3 months** (#2 of 231 3-month gains), the start of the aquifer recovery in W3.
- **Taiwan 2021:** January–May island rain was 60% of normal (#2 driest of 25). Pearl River storage reached -8.6 cm in 2021-06 (#11).
- **Three Gorges (I19), not cleanly detectable:**
  - Reservoir region minus the upstream Sichuan basin steps up through the impoundment stages: +0.3 → +0.5 → +2.2 → +4.9 cm.
  - It then falls back to -0.1 cm after the dam reached 175 m.
  - GRACE's roughly 300 km footprint can't separate a narrow reservoir of about 22 km³ from regional drought and wet variability.
- Visual: `results/37_eastasia_extremes/eastasia_extremes.png`, `three_gorges.png`.

## W11. Null results worth showing (honesty = credibility)
- **"Wet seasons wetter, dry seasons drier" over time is not a global pattern (task 33).**
  - Classes from GPCP 1979–2025: amplifying 17%, damping 17%, wetter all year 34%, drier all year 32%.
  - Only 1–7% of land is significant, and about 0% over 2001–25. The class maps from IMERG and GPCP agree on 61% of land (25% by chance).
  - The GRACE annual-cycle amplitude has no significant trend on any land pixel. Only 16 years have 10 or more months.
- **Does wet soil make its own rain? Not detectable at monthly scale (task 31).**
  - Test: partial r(soil moisture_t, rain_t+1 | rain_t, rain_t−1, ENSO), warm season.
  - Result: significant on only 0.2–0.3% of land in every dataset pair. |r| > 0.2 occurs on 7% of land, against 8% for a placebo using rain a year later. Pattern agreement between the soil models is r = 0.40.
  - Any soil → rain feedback is too weak or too fast for monthly data, so it would need daily data or model experiments.
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
