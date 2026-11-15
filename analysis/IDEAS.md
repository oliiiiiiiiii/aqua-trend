# Experiment backlog (hypothesis → data → expected visual → cost → status)

| # | Hypothesis / question | Data | Visual | Cost | Status |
|---|---|---|---|---|---|
| I01 | NCP reversal is driven by policy (water diversion) not just rain: rainfall over NCP 2014–2026 vs storage | GPCP/IMERG + GRACE | 2-panel: storage vs cumulative rain anomaly | low | done (tasks 21/23) |
| I02 | NW India loss slowed after 2016 because of monsoon rains or pumping limits? | GPCP + GRACE | piecewise trend plot | low | done (task 21: GW loss halved; task 22: stronger monsoon inflow) |
| I03 | Caspian Sea level fall confirmed by satellite altimetry | GWM lake level | GRACE vs altimetry overlay | med | done (task 55: r=0.999) |
| I04 | Lake Victoria rise matches rainfall surge (2019–2020, 2023–24) | GPCP | rain anomaly vs storage | low | done (task 22: convergence +0.50 mm/day/dec) |
| I05 | Groundwater-only trend = GRACE TWS − GLDAS (soil+snow+canopy) | GLDAS Noah (needs GES DISC approval) | groundwater map | med | done (task 21) |
| I06 | Opposite-sign pair: Sahel/East Africa wetting vs Middle East drying (same circulation shift?) | GRACE + GPCP | split map | low | done (task 25 ENSO maps) |
| I07 | Arctic sea-ice "pause" since 2012: is the 2012–2026 trend significantly different from 1979–2011? (segmented regression / Chow test) | NSIDC | two-segment plot | low | done (task 61: 3% pre-chosen vs 41% anywhere; hinge p=0.08) |
| I08 | Antarctic collapse coincides with Southern Ocean SST warming (OISST around Antarctica) | OISST | SST anomaly vs ice anomaly | low | done (task 61: annual r=−0.47, surrogate p=0.08) |
| I09 | Sea-ice concentration maps: 1980s vs 2020s September extent outline (GeoTIFF) | NSIDC G02135 geotiff | before/after map | low | done (task 09b) |
| I10 | Taiwan drying? GPCP says −16 %/decade since 2002 — verify with IMERG 0.1° (land-only Taiwan), split typhoon season (Jul–Oct) vs plum-rain (May–Jun) vs winter | IMERG (GES DISC) / GHCN stations | seasonal bar + map | med | partly (task 24 + robustness: suggestive) |
| I11 | Typhoon-rain decline near Taiwan: count of months with extreme rainfall (>p95) per decade | GPCP/IMERG | decadal bar chart | low | done (task 24) |
| I12 | Southern Amazon drying + deforestation → NDVI drop + LST rise (compound) | GPCP + MODIS NDVI/LST | 3-panel map | med | after MODIS |
| I13 | Sea level rise hotspots (W Pacific, Taiwan coast) vs global mean, 1993–2026 | NASA-SSH (PO.DAAC) | trend map + Taiwan series | low | done (task 12) |
| I14 | Chlorophyll "time of emergence": how many years until each pixel's trend would become significant (Weatherhead 1998 formula from noise & AR1) | MODIS-Aqua CHL | map of years-to-detection | low | done (years_to_detect in trendlib) |
| I15 | Marine heatwave days per year around Taiwan & East China Sea (Hobday definition), 1982–2026 | OISST daily (PSL OPeNDAP) | heatwave-day calendar heatmap + trend | med | done (task 08c) |
| I16 | Taiwan coastal subsidence vs sea-level rise (Yunlin/Changhua): relative SLR | Sentinel-1 InSAR (heavy) | — | high | parked |
| I17 | GERD filling: compare GRACE gain (≈7 km³/yr) with reported reservoir volume (altimetry of the reservoir surface + area from Landsat/Sentinel) | GRACE + SWOT/altimetry | storage vs reported volume | med | todo |
| I18 | Greening cools the land: Loess Plateau & Inner Mongolia NDVI +9…14 %/dec while daytime LST −0.7…−0.85 °C/dec — evaporative cooling (ET up?) | MODIS NDVI/LST + GLDAS ET | 3-panel map NDVI↑ ET↑ LST↓ | low | superseded — LST cooling is a Terra drift artefact (task 07b) |
| I19 | Three Gorges / Yangtze reservoir filling 2003–2010 in GRACE | GRACE + HydroBASINS | storage step | low | done (task 37: not cleanly detectable; Yangtze 2022 record low found) |
| I20 | SWOT lake/reservoir levels (2023–26) for GERD, Lake Victoria, Caspian — independent check of GRACE storage changes | SWOT_L2_HR_LakeSP (PO.DAAC) | lake-level series vs GRACE | med | todo |
| I21 | Quantify GLDAS-2.1 forcing inhomogeneity (SWdown/PET jumps) globally; mask affected pixels for ET trends | GLDAS vs MERRA-2 | change-point map | low | todo |
| I22 | Atmospheric rivers / typhoon moisture into Taiwan: hourly IVT extremes trend | MERRA-2 M2T1NXINT (hourly, heavy) | AR-day calendar | high | parked |
| I23 | Taiwan rain verification with CWA gauges (needs a free CWA open-data API key from the user) | CWA | gauge vs IMERG | low | needs user |
| I24 | Where do aquifer losses go? Map GRACE land loss + ocean gain as one "mass flow" figure (task 28 extension) | GRACE | flow map | low | todo |
| I25 | Soil-moisture "flash drought" frequency trend (GLDAS/MERRA-2 SM percentiles) | GLDAS + MERRA-2 | event calendar | med | superseded by I28 / task 32 |
| I26 | **Ocean ↔ land seesaw:** in La Niña years (2010–11) rain stored on land (Australia, Amazon) makes global sea level *drop*. Which land regions hold the ocean's borrowed water, and how much of the interannual GMSL wiggle do they explain? | GRACE land/ocean mass + altimetry GMSL + Niño3.4 | land-share map + seesaw time series | low | done (task 30: r=+0.67, 2011 −5 mm, Brazil 30 %) |
| I27 | **Does wet soil make its own rain?** Land–atmosphere coupling hotspots: r(soil moisture_t, rain_t+1 \| rain_t); does the coupling strengthen as soils dry? | MERRA-2 GWETTOP/ROOT + IMERG/GPCP, GLDAS SM cross-check | coupling-hotspot map | med | done (task 31: null — no better than placebo) |
| I28 | **Compound hot-and-dry months** (soil moisture < p10 and surface temp > p90 together): how often now vs 2000s? Supersedes I25 | MERRA-2 TSURF + GWETROOT, GLDAS SM + Tair cross-check | change-in-frequency map + calendar | med | done (task 32: 2024 record in both models; trend model-dependent) |
| I29 | **Is the water cycle's seasonal swing growing?** Trend in the annual amplitude of stored water (GRACE) and in wettest- vs driest-season rain (IMERG/GPCP) — "wet seasons wetter, dry seasons drier" in time, not just space | GRACE + IMERG + GPCP | amplitude-trend map + 4-way classification | low | done (task 33: global null; southern Amazon dry season robust drying, Sahel wet season wetting) |
| I30 | **Rain replacing snow:** trend in the snowfall fraction of precipitation and in snowpack (SWE) / melt timing — mountain water towers | MERRA-2 PRECSN/PRECTOT + GLDAS SWE | snow-fraction trend map + melt-timing shift | med | done (task 34: snowy-land snow share 35%→31%, 26% sig loss / 0% gain) |
| I31 | Is rain getting more convective (more intense)? Convective fraction PRECCU/(PRECCU+PRECLS) trend | MERRA-2 (model physics — caveat) | trend map | low | done in task 34: mixed (+13 % / −10 % of land), not a finding |
| I32 | Surface water that appeared / vanished 2000–2025 (Tibetan lakes, Aral, Urmia, GERD) from MODIS NDVI water signature, paired with GRACE | MODIS NDVI 0.05° + GRACE | appear/vanish map | med | todo (NDVI water mask noisy; Caspian masked) |
| I33 | (redundant with GRACE trend map) Storage-drought frequency: months with GRACE storage below the 10th percentile, 2002–13 vs 2014–26 | GRACE | change map | low | todo (fold into task 33) |
| I34 | Time of emergence for water-storage trends: where GRACE trends are already detectable, and where 10+ more years are needed | GRACE + trendlib.years_to_detect | years-to-detect map | low | done (task 56: SST 68%, TWS 58%, NDVI 31%, rain 18% emerged) |
| I35 | Independent check of rain→snow shift: MODIS snow-cover duration (MOD10CM, LP DAAC/NSIDC) trend 2001–2025 vs MERRA-2 snow share | MODIS snow cover | snow-days trend map | med | done (task 34b: aggregate −1.3 pp/dec p=0.02; Alps/E Europe/Japan confirmed; HMA/Rockies not) |
| I36 | Amazon: link dry-season drying to moisture inflow (task 22 boundary fluxes, JAS) and to MODIS NDVI/fire along the arc | MERRA-2 INT + MODIS | inflow vs rain series | low | done (task 36: TNA warming predicts −0.18 vs observed −0.18 mm/day/dec; MERRA-2 budget non-closing) |
| I37 | Global “record map”: for each pixel, which year of 2002–2025 had the lowest GRACE storage — where are we at record lows *now*? | GRACE | year-of-minimum map | low | done (task 35: 32 % of land at record low, 23 % record high) |
| I38 | Hydroclimate whiplash frequency (monthly SPI-like swings) | GPCP + MERRA-2 | rate series + ratio map | low | done (task 38: null — GPCP ↓, MERRA-2 ↑ n.s.) |
| I39 | Turning points: where did GRACE water-storage trends reverse (depletion → recovery, or the reverse) between 2002–13 and 2014–26? | GRACE | trend-change class map | low | done (task 39: 45 % of land changed; NCP reversal, Central Europe/Caspian worse) |
| I40 | Ocean salinity as a rain gauge: SMAP sea-surface salinity 2015–2026 — salty regions saltier (evaporation) and fresh regions fresher (rain)? | SMAP SSS (PO.DAAC) | SSS trend vs mean-SSS map | med | todo (short record) |
| I41 | Lake Victoria & East African lakes record high: GRACE + IMERG + moisture convergence + MODIS shoreline (NDVI water) | GRACE, IMERG, GWM altimetry | multi-panel | low | done (task 54: Turkana +6.7 m, Victoria gain~short rains r=0.82; top-3 rises = 1997/2019/2023 IOD years on 6/8 lakes) |
| I42 | World lakes from altimetry: rising/falling map, Caspian vs GRACE | NASA GWM | map + series | low | done (task 55: 53 falling / 46 rising; Caspian −1.16 m/dec, r=0.999 with GRACE) |
| I43 | Reservoir drought fingerprint: do reservoir level anomalies track GRACE/SPI drought across basins (Kariba, Mead, Brazil hydropower)? | GWM + GRACE + GPCP | per-reservoir lag correlation | med | todo |
| I44 | Mekong flood pulse (Tonle Sap) vs upstream dams, rain-controlled | GWM + GPCP + GRACE | multi-panel | low | done (task 57: −1.04 m/dec rain-adjusted, GRACE confirms) |
| I45 | Other dammed rivers' downstream lakes/wetlands: Inner Niger Delta, Sudd, Okavango, Pantanal — flood-pulse amplitude from GRACE + altimetry | GWM, GRACE, GPCP | pulse amplitude series | med | done (task 59: Pantanal step 2019 + fires ×1.8; Niger delta/Lake Chad +12–13 cm/dec) |
| I46 | Vertical land motion from tide gauges minus altimetry (global) | PSMSL + NASA-SSH | VLM map | low | done (task 60: 230 sinking / 184 rising; Manila −8.6 mm/yr) |
| I47 | Relative sea-level rise felt at each coast = altimetry rise + land sinking: which cities face the fastest relative rise? | PSMSL + NASA-SSH | ranked map | low | done (task 62: Manila +12.5 mm/yr; 4% of gauges > 2x global) |
| I48 | Taiwan land subsidence (Yunlin/Changhua) — needs InSAR (OPERA DISP-S1 / Sentinel-1) since PSMSL lacks modern Taiwan gauges | OPERA DISP | subsidence map | high | todo |
| I49 | Amazon resilience: rolling AR1 of NDVI (critical slowing down) with surrogate test | MODIS NDVI | τ map + series | med | done (task 67: τ>0 on 59%, p=0.15 — not significant) |
| I50 | Ice loss by region with acceleration (GRACE) | GRACE | curves + rates | low | done (task 68: glaciers & ASE accelerating, Greenland slowing) |
| I51 | Repeat the resilience test with VOD (AMSR passive microwave, less saturation) or MODIS EVI | LPRM VOD / MOD13C2 EVI | τ map | med | todo |
| I52 | Calibrate the trend tests on phase-randomised twins (false-alarm rates of naive / MK / AR(1) / FDR) | GRACE, GPCP, OISST, NDVI | grouped bars | low | done (task 69: naive 69% for TWS; AR(1)+FDR ≤5%) |

## Non-hydrology experiments (user request 2026-11-14: "run non-water data the same way, e.g. earthquakes")
| id | idea | data | output | cost | status |
|---|---|---|---|---|---|
| N01 | Global earthquake rates: real change vs detection | USGS ComCat M≥4.5 + GCMT | counts by magnitude, rate-change map, great-quake burst test | low | done (task 40: small-quake rise is detection; M≥6 flat since 1983; 1983 magnitude-scale trap) |
| N02 | Induced seismicity from wastewater injection | USGS M≥3 central US | three-era map + regional counts vs natural control | low | done (task 41: Oklahoma ×779, Permian ×325, regulation halves the rate every 1.2 yr) |
| N03 | AIRS × OMI: ozone cross-check, smoke (CO vs aerosol vs fires), NO₂ vs CO combustion fingerprints, water vapour per K | AIRS3STM v7, OMTO3d, OMNO2d, FIRMS | 6 figures | med | done (task 42: ozone r=0.92, Canada 2023 rank 1 in CO & AI, NO₂ redrawn) |
| N04 | Polar motion & length of day vs GRACE mass excitation | IERS C04 + GRACE mascons | pole path, drift attribution, LOD | low | done (task 43: GRACE explains post-2000 drift change within 10°) |
| N05 | Seasonal water-load modulation of earthquakes | USGS + GRACE | Schuster test per region and cell | low | done (task 44: null) |
| N06 | Global fire trends: savanna decline vs boreal rise, Terra/Aqua cross-check | FIRMS MODIS C6.1 | trend map + regional series | low | done (task 45: global −11%/dec both satellites; savanna/steppe/E China/Indonesia down; boreal n.s.) |
| N07 | Ozone hole recovery: hinge test | NASA Ozone Watch | hinge plot | low | done (task 46: break 1993, recovery n.s.) |
| N08 | Methane surge 2020–22: AIRS CH₄ vs NOAA in situ; tropical wetland flooding (GRACE/IMERG) as the driver? | AIRS CH4_VMR, NOAA GML, GRACE | CH₄ growth vs wetland water map | med | done (task 48: null — correlation is shared trend; surrogate & detrended tests fail) |
| N09 | Taiwan: Hualien 2024 M7.4 aftershock decay (Omori–Utsu) vs Chi-Chi 1999; b-value | USGS M≥4 | Omori fit + map | low | done (task 47: p≈0.95 both; M≥4 rise is detection) |
| N10 | Volcanic SO₂ and the Hunga Tonga 2022 stratospheric water injection | MSAQSO2L4 point sources, MLS H2O | event maps + series | med | done (task 49: China −92%, India +103%, 4 satellites agree; task 50: Hunga +13% strat. water, e-fold 4.5 yr) |
| N11 | Saharan dust trend from OMI aerosol index vs Sahel greening and rain | OMTO3d UVAI + GPCP + NDVI | trend/correlation maps | low | done (task 51: dust down 9–17%/dec, MERRA-2 & OMI agree; greener years cleaner, 89% of land) |
| N12 | Hunga Tonga aftermath: stratospheric cooling and ozone response | MLS T, O3 (ML3DZT, ML3DZO3) | time–height anomaly sections | low | done (task 53: −1.6 K, −2.8% O₃ in year 1; cooling robust, ozone fades) |
| N13 | East Asia "brightening": sulfate AOD drop (MERRA-2) vs surface sunshine (CERES) | M2TMNXAER, CERES EBAF | trend maps + China series | med | done (task 63: E China TOA clear-sky SW −2.2 W/m²/dec, r=0.96 with AOD; IGP dimming −6.7) |
| N14 | SO₂/NO₂ ratio as a coal-vs-traffic fingerprint per city | MSAQSO2L4 + OMNO2d | scatter by city/year | low | todo |
| N15 | Taiwan & SE Asia air: Vietnam's SO₂ ×4.6 vs Taiwan −78% — does it reach Taiwan? (MERRA-2 sulfate AOD, back-trajectory proxy via winds) | M2TMNXAER, AERONET | regional series | med | done (task 52: 27 AERONET sites, Taipei −39%/dec, sulfate tracks China SO₂ r=0.89) |
| N16 | AERONET Ångström exponent: is Asia's haze getting coarser (dust) or finer (combustion)? Fine/coarse split trends | AERONET SDA | site trends | low | done (task 58: EA fine −43%/dec, SA fine +21%/dec, dust down in both) |
| N17 | Mount Pinatubo-style check for smaller eruptions: MLS/OMPS volcanic SO₂ and stratospheric aerosol since 2004 (Raikoke 2019, Ruang 2024) | MLS SO2, OMPS LP | event series | med | todo |
| N18 | Earth's energy imbalance (CERES TOA net), decomposition SW/LW and cloud/clear | CERES EBAF | series + bars + map | low | done (task 64: 0.67→1.65 W/m², ASR +0.88/dec accelerating) |
| N19 | Low-cloud decline in the NE Pacific & marine heatwaves ("the Blob"): CERES cloud SW vs OISST, 2013–2025 | CERES EBAF + OISST | lagged correlation map | med | done (task 66: sig + on 48% of ocean; stratocumulus +6.5–6.7 W/m²/K) |
| N20 | Arctic darkening: CERES clear-sky absorbed SW vs NSIDC sea-ice concentration loss (ice-albedo feedback strength, W/m² per % ice) | CERES + NSIDC | scatter + map | med | done (task 65: 15.5 W/m² per Mkm², r=−0.96; clouds mask ~49%) |
