# Experiment backlog (hypothesis → data → expected visual → cost → status)

| # | Hypothesis / question | Data | Visual | Cost | Status |
|---|---|---|---|---|---|
| I01 | NCP reversal is driven by policy (water diversion) not just rain: rainfall over NCP 2014–2026 vs storage | GPCP/IMERG + GRACE | 2-panel: storage vs cumulative rain anomaly | low | done (tasks 21/23) |
| I02 | NW India loss slowed after 2016 because of monsoon rains or pumping limits? | GPCP + GRACE | piecewise trend plot | low | done (task 21: GW loss halved; task 22: stronger monsoon inflow) |
| I03 | Caspian Sea level fall confirmed by satellite altimetry | G-REALM/DAHITI lake level | GRACE vs altimetry overlay | med | todo |
| I04 | Lake Victoria rise matches rainfall surge (2019–2020, 2023–24) | GPCP | rain anomaly vs storage | low | done (task 22: convergence +0.50 mm/day/dec) |
| I05 | Groundwater-only trend = GRACE TWS − GLDAS (soil+snow+canopy) | GLDAS Noah (needs GES DISC approval) | groundwater map | med | done (task 21) |
| I06 | Opposite-sign pair: Sahel/East Africa wetting vs Middle East drying (same circulation shift?) | GRACE + GPCP | split map | low | done (task 25 ENSO maps) |
| I07 | Arctic sea-ice "pause" since 2012: is the 2012–2026 trend significantly different from 1979–2011? (segmented regression / Chow test) | NSIDC | two-segment plot | low | todo |
| I08 | Antarctic collapse coincides with Southern Ocean SST warming (OISST around Antarctica) | OISST | SST anomaly vs ice anomaly | low | todo |
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
| I34 | Time of emergence for water-storage trends: where GRACE trends are already detectable, and where 10+ more years are needed | GRACE + trendlib.years_to_detect | years-to-detect map | low | todo |
| I35 | Independent check of rain→snow shift: MODIS snow-cover duration (MOD10CM, LP DAAC/NSIDC) trend 2001–2025 vs MERRA-2 snow share | MODIS snow cover | snow-days trend map | med | done (task 34b: aggregate −1.3 pp/dec p=0.02; Alps/E Europe/Japan confirmed; HMA/Rockies not) |
| I36 | Amazon: link dry-season drying to moisture inflow (task 22 boundary fluxes, JAS) and to MODIS NDVI/fire along the arc | MERRA-2 INT + MODIS | inflow vs rain series | low | done (task 36: TNA warming predicts −0.18 vs observed −0.18 mm/day/dec; MERRA-2 budget non-closing) |
| I37 | Global “record map”: for each pixel, which year of 2002–2025 had the lowest GRACE storage — where are we at record lows *now*? | GRACE | year-of-minimum map | low | done (task 35: 32 % of land at record low, 23 % record high) |
| I38 | Hydroclimate whiplash frequency (monthly SPI-like swings) | GPCP + MERRA-2 | rate series + ratio map | low | done (task 38: null — GPCP ↓, MERRA-2 ↑ n.s.) |
| I39 | Turning points: where did GRACE water-storage trends reverse (depletion → recovery, or the reverse) between 2002–13 and 2014–26? | GRACE | trend-change class map | low | done (task 39: 45 % of land changed; NCP reversal, Central Europe/Caspian worse) |
| I40 | Ocean salinity as a rain gauge: SMAP sea-surface salinity 2015–2026 — salty regions saltier (evaporation) and fresh regions fresher (rain)? | SMAP SSS (PO.DAAC) | SSS trend vs mean-SSS map | med | todo (short record) |
| I41 | Lake Victoria & East African lakes record high: GRACE + IMERG + moisture convergence + MODIS shoreline (NDVI water) | GRACE, IMERG, MERRA-2, MODIS | multi-panel | low | todo |

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
| N08 | Methane surge 2020–22: AIRS CH₄ vs NOAA in situ; tropical wetland flooding (GRACE/IMERG) as the driver? | AIRS CH4_VMR, NOAA GML, GRACE | CH₄ growth vs wetland water map | med | todo (water link) |
| N09 | Taiwan: Hualien 2024 M7.4 aftershock decay (Omori–Utsu) vs Chi-Chi 1999; b-value | USGS M≥4 | Omori fit + map | low | done (task 47: p≈0.95 both; M≥4 rise is detection) |
| N10 | Volcanic SO₂ and the Hunga Tonga 2022 stratospheric water injection | OMI SO2 (OMSO2e), MLS H2O | event maps + series | med | todo |
| N11 | Saharan dust trend from OMI aerosol index vs Sahel greening and rain | OMTO3d UVAI + GPCP + NDVI | trend/correlation maps | low | todo |
