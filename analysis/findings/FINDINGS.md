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

## W19. Turning points: on 45% of land the water-storage trend changed course after 2014 — **Significant (GRACE; AR(1)-adjusted, FDR)**
- Trend 2014–26 compared with 2002–13 (z-test on AR(1)-adjusted standard errors):
  - **reversal from loss to gain 12%** of land;
  - **reversal from gain to loss 10%**;
  - accelerating loss 7%; slowing loss 7%; accelerating gain 6%.
- **Recoveries:**
  - North China Plain -1.3 → **+1.2 cm/yr** (p = 0.002; the diversion plus floods, W3);
  - Bangladesh, Malawi, Mozambique, Somalia and Egypt (most of their area);
  - the Sahel's gain accelerated (+0.5 → +1.9).
  - Saudi Arabia and Iraq: depletion slowing.
- **New or worse losses:**
  - Central Europe +0.04 → **-0.83 cm/yr** (p = 0.01; the 2018–22 European droughts); Poland is 100% gain → loss.
  - Caspian region -2.4 → **-5.4**.
  - Patagonia -3.0 → -4.2.
  - Romania, Tunisia, Greece and Central Asia: accelerating loss.
  - Paraguay, Morocco and Zambia: gain → loss.
- **Sensitivity:** NW India shows no change in this two-era split (-2.1 → -2.3, box 70–80°E). With W3b's box and three phases, GRACE total storage does slow (−4.1 → −3.0 → −1.7 cm/yr) while GLDAS soil + snow stays near zero. So that slowdown is real in GRACE, but depends on the breakpoints.
- Visual: `results/39_turning_points/map_turning_points.png`.

## W11. Null results worth showing (honesty = credibility)
- **Hydroclimate whiplash (dry↔wet swings) is not robustly increasing at monthly scale over land (task 38).**
  - Definition: a 3-month rain total below its 10th percentile followed within 3 months by one above its 90th, or the reverse.
  - Land-mean events per location per year, 1980–2002 → 2003–25: GPCP 0.194 → 0.167 (×0.86, trend p = 0.009, a *decrease*); MERRA-2 0.151 → 0.157 (×1.04, p = 0.29).
  - The two maps agree in sign on 57% of land, and their annual series correlate at r = 0.41. No pixel passes FDR.
  - Published increases use daily data, longer records or different definitions. Our monthly satellite-era test can't confirm them, and GPCP's pre-1987 satellite inputs may affect variance.
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
# 🌍 BEYOND WATER (Nov 14): earthquakes, atmosphere and Earth rotation, held to the same standard

## N1. Is the Earth shaking more? No. Only small-quake detection is rising, and a 1983 magnitude switch fakes a trend. **Robust null + artefact (teaching case)**
- **USGS M≥4.5 counts: +22 %/decade** (p = 2e-52). The excess vanishes by M≈5.5, and the ratio of M≥4.5 to M≥6 rose from 20 to 27 (p = 3e-8).
  - Per 10° cell, small quakes rose significantly in 49% of cells. Large quakes changed significantly in 0%.
  - This is network growth, not tectonics.
- **Large quakes have no trend** after declustering, in the moment-magnitude era (1983–2025), in either catalogue:
  - USGS M≥6: −1.5 %/decade (p = 0.29).
  - M≥7: +1.0 %/decade (p = 0.78).
  - GCMT Mw≥6: +2.4 %/decade (p = 0.13).
- **The trap.** USGS magnitudes switched from mb/Ms to Mw in 1982–83, so the M≥6 count steps from 65 to 93 per year (Pettitt p = 0.002).
  - Starting in 1973 gives a "significant" **+4.8 %/decade (p = 0.001)** that is entirely the scale change.
  - It is a seismic twin of W6 (the Terra LST orbit drift).
- **Great-quake burst 2004–12** (5 of the 6 M≥8.5 since 1973 within 8 years): scan statistic with Monte Carlo p = 0.02 (USGS) / 0.03 (GCMT).
  - Borderline, because the threshold was chosen after the burst was noticed.
- Visuals: `results/40_global_earthquakes/global_quake_counts.png`, `map_big_quakes_timeline.png`, `map_quake_rate_change.png`, `detection_fmd_by_decade.png`.

## N2. Human-made earthquakes: wastewater injection turned Oklahoma into a quake zone, then West Texas. **Robust (×100s rate ratios, natural control flat)**
- Oklahoma M≥3: **1.1/yr (1980–2008) → 887 in 2015 (×779)**. After the 2016 injection cuts, the rate halved every 1.2 years (p = 2e-35), to about 17/yr now.
- Permian Basin: ×325, doubling every 1.1 years in 2017–22. After Texas's late-2021 response areas it fell **−41%** from 2022 to 2025 (p = 3e-6).
- Kansas ×116, Fort Worth ×145, and Raton Basin ×10 (from 2001, coal-bed-methane water).
- The natural New Madrid zone is flat (p = 0.94), so the booms are not a detection artefact.
- Water link: the driver is the disposal of produced water, a human transfer of water from one rock layer to another.
- Visuals: `results/41_induced_seismicity/map_three_eras.png`, `induced_counts.png`.

## N3. Water and ice are steering the North Pole, and the day is getting shorter anyway. **Robust (space geodesy and GRACE agree within 10°)**
- The mean pole drifted toward Canada (72–97°W) until 2001, then turned east (27°E in 2002–13, 10°W in 2014–25).
- **GRACE mass change predicts a change in drift of 5.0 mas/yr toward 15°E. The observed change is 5.1 mas/yr toward 24°E**, with interannual r = 0.73 / 0.54.
  - Contributions: Greenland 2.6 mas/yr toward 46°W, Antarctica 2.0 toward 59°E, ocean 1.6 toward 12°E.
  - **Land water (groundwater pumping) 1.2 toward 69°E.** That is the hydrology hub again.
- Length of day: the record short day was **−1.65 ms (5 Jul 2024)**, and 168–239 days per year since 2020 were shorter than 86,400 s.
  - The core speeds the Earth up, while ice melt (by GRACE) lengthens the day by +1.5 ms per century.
- Visuals: `results/43_earth_rotation/pole_drift_water.png`, `length_of_day.png`.

## N4. The ozone hole stopped growing in the 1990s; healing is still in the noise. **Robust break / Suggestive recovery**
- Hole area grew +17 million km²/decade until **1993**, and the hinged fit beats a straight line (p = 4e-10).
- Since 2001: −0.5 million km²/decade (p = 0.68), or −1.2 (p = 0.38) without the anomalous 2020–23 years.
- The 2026 hole is 24.9 million km².
- Cross-check from task 42: AIRS (infrared) and OMI (UV) Antarctic spring ozone agree year to year.
- Visual: `results/46_ozone_hole/ozone_hole_hinge.png`.

## N5. AIRS × OMI: two sensors, one atmosphere. Ozone agrees, smoke is seen by both, and the pollution map is redrawn. **Robust (cross-sensor)**
- **Ozone:** AIRS (infrared) vs OMI (UV) anomalies give r = 0.92, and Antarctic spring ozone r = 0.994.
  - AIRS reads +3 DU higher, and the gap drifts −1.7 DU/decade, so the trend magnitudes differ. That argues for a second sensor.
- **Smoke:** Canada 2023 summer fires were ×4.9 normal, and AIRS CO and OMI aerosol were both **rank 1 of 22**.
  - Year to year, Canadian fires track aerosol at r = 0.94 and CO at r = 0.76.
- **NO₂ 2005–25:** Eastern US −27%/decade, Western Europe −22%, Japan & Korea −24%, East China −18% (−42% since its 2011 peak), Taiwan −15%. North India +13% and the Persian Gulf +10% are at record highs.
  - COVID Feb–Apr 2020: −29 to −34% in China, the US and Europe.
  - AIRS CO is falling globally (−2.9%/decade).
- **Water link:** AIRS water vapour rises 6.0% per K over the oceans, close to the ≈7%/K physics predicts.
- Visuals: `results/42_airs_omi/map_no2_trend.png`, `map_canada_2023_smoke.png`, `regional_no2_vs_co.png`, `ozone_airs_vs_omi.png`, `map_fire_smoke_correlation.png`, `map_water_vapour_per_K.png`.

## N6. Taiwan's great earthquakes: Chi-Chi 1999 and Hualien 2024 aftershocks fade at the same Omori rate. **Robust**
- Omori p = 0.95 [0.88–1.02] and 0.96 [0.90–1.05].
- Hualien had 391 M≥4 aftershocks in its first year (Chi-Chi 205), partly because of better detection.
  - Island-wide, M≥4 counts rise +9%/decade (p = 0.006), but M≥5 are flat (p = 0.93).
- Visual: `results/47_taiwan_aftershocks/taiwan_aftershocks.png`.

## N7. The world is burning less: MODIS fire detections −11% per decade in both satellites. **Robust**
- Robust decline on 25% of burning land: African savannas, the steppe croplands, eastern China, Indonesia (−51%/decade) and the Cerrado.
- Robust increase on 6%: central India, NE China and the Andes–Amazon edge.
- Unchanged before orbit drift (2003–19).
- Boreal North America: +30%/decade with the 2023 record, but p = 0.07.
- Punjab: the satellites disagree (Terra −41%/decade, Aqua flat), though both show the collapse after 2021.
- Visuals: `results/45_fire_trends/map_fire_trend.png`, `regional_fire_series.png`.

## N8. Sulfur pollution moved from China to India and the Gulf: 780 smokestacks, four satellites. **Robust (4 independent instruments)**
- Point-source SO₂ (NASA MEaSUREs catalogue), 2005–07 vs 2023–25:
  - Falling: China −92% (−14%/yr), USA −92%, Europe & Turkey −69%, the whole world −52%.
  - Rising: India +103% (+3.8%/yr).
  - Middle East: +9%, not significant.
- India has out-emitted China since 2017, and the Middle East has led the named regions since 2016.
- OMI, OMPS-NPP, TROPOMI and OMPS-NOAA20 agree on 2018–25 trends: China −7 to −8%/yr, India +2 to +5%/yr.
- Of 672 industrial sources, 314 fell and 136 rose (FDR).
- Taiwan's one detectable source (Linhai, Kaohsiung) fell from 60 to 13 kt/yr; Vietnam's sources rose ×4.6.
- Visual: `results/49_so2_sources/so2_sources_map.png`.

## N9. Hunga Tonga watered the stratosphere: +13%, 9σ, still half there after four years. **Robust**
- Aura MLS: +170 Mt of extra water at 100–1 hPa (peak Jan 2023), after removing the instrument's slow drift.
- All 46 months since Feb 2022 exceed the largest pre-eruption value.
- The plume rose from 20–40 hPa to 1–5 hPa and spread pole to pole.
- E-folding decay time 4.5 yr (95% CI 3.0–8.5); 53% remained at the end of 2025.
- Caveat: MLS sampling dropped to ~50% of days in 2024 and ~30% in 2025.
- Visual: `results/50_hunga_tonga_water/hunga_tonga_stratospheric_water.png`.

## N10. Less dust over the Sahel, the Sahara's edge and the Middle East; greener years are cleaner years. **Robust (two independent records)**
- Two records: MERRA-2 dust AOD and OMI's UV aerosol index (no drift over clean oceans).
- Declines since 2005, from MERRA-2 with OMI agreeing:
  - Sahel −9%/decade.
  - Iraq–Syria −17%/decade.
  - Arabia −9%/decade.
- Trend signs agree on 86% of the dust belt.
- Year to year, detrended: greener-than-trend years have less aerosol on 89% of vegetated dust-belt land (FDR-significant on 29%).
  - Iraq–Syria and Arabia: r = −0.82.
  - The 2008 Fertile Crescent drought is the dust peak; the wet 2019 is the low.
- Taklimakan: the two records disagree, so it is not interpreted.
- Visual: `results/51_dust_greening/dust_trends_and_greening.png`.

## N11. ⚠ Methane's record surge does not follow the tropics' water once shared trends are removed. **Null (teaching case)**
- NOAA: +17.7 ppb in 2021 (record), then +4.8 in 2025, the smallest rise since 2009. AIRS also has 2021 as its record year.
- East African water storage (GRACE) correlates with methane growth at r = +0.63.
  - Naive p = 0.001, but the surrogate test that preserves persistence gives p = 0.11.
  - Detrended, r = +0.14; the basin stayed full while methane slowed.
- Raw correlation maps show |r| > 0.4 on 48% of tropical land. After detrending, significance falls to chance (5%).
- Tropical rain (r = −0.20) and El Niño (r = +0.03) show no link either.
- Visual: `results/48_methane/methane_vs_wetland_water.png`.

## N12. Asia's haze map redrawn: ground sun-photometers confirm clearer East Asian skies and hazier South Asia. **Robust (AERONET + MERRA-2/MODIS)**
- 27 AERONET stations with ≥10 years of data: 16 show a significant decline in aerosol optical depth, 3 a rise. Station trends match MERRA-2 at r = 0.87.
- Declines (%/decade):
  - Beijing-CAMS −68 (2013–25).
  - Seoul −48.
  - Taiwan: EPA-NCU (Chungli) **−45**, Taipei **−39**.
  - Osaka −37.
- Rises (%/decade): Ganges plain (Gandhi College) +19, Jaipur +16, Dhaka +15.
- Over Taiwan, MERRA-2 sulfate AOD falls −17%/decade and tracks China's SO₂ emissions (r = 0.89).
  - Detrended, r = 0.39, so most of the link is the shared trend.
  - The reanalysis underestimates Taiwan's local clean-up 2–3×.
- Visual: `results/52_asia_haze/asia_haze_trends.png`.

## N13. Hunga Tonga's aftermath: the wetter southern stratosphere turned colder and briefly lost ozone. **Robust cooling / Significant first-year ozone dip**
- Aura MLS, 15–55°S, 15–40 hPa, Feb 2022–Jan 2023: water +49%, temperature −1.6 K, ozone −2.8%.
- At the peak levels: cooling −2.1 K (7 σ) and ozone −3.0% (3.5 σ). Both are beyond every 12-month mean of 2005–21.
- Since 2022, monthly water anomalies anticorrelate with temperature (r = −0.63, vs −0.06 before) and with ozone (r = −0.56).
- The ozone dip fades over two years (−1.0%, 2.2 σ).
- Visual: `results/53_hunga_aftermath/hunga_aftermath_temperature_ozone.png`.

## N-nulls. Non-water nulls
- **Seasonal water load does not detectably modulate earthquakes (task 44).**
  - Schuster p: California 0.96 (17k mainshocks), Japan 0.31, Himalaya 0.14 (winter peak as published, but only 434 events), Taiwan 0.83.
  - No 1° cell passes FDR. The signal needs complete local catalogues.
- **Global M≥6 rate since 1983** (task 40): no trend in either catalogue (see N1).
- **Methane growth vs tropical wetland water, rain and ENSO** (task 48): naive correlations vanish under surrogate and detrended tests (see N11).
- **GLDAS wind as a dust driver** (task 51): its monthly anomalies do not track dust (r ≈ 0), and its forcing winds trend spuriously.

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
