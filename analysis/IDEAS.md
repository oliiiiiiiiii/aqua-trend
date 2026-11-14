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
| I19 | Three Gorges / Yangtze reservoir filling 2003–2010 in GRACE | GRACE + HydroBASINS | storage step | low | todo |
| I20 | SWOT lake/reservoir levels (2023–26) for GERD, Lake Victoria, Caspian — independent check of GRACE storage changes | SWOT_L2_HR_LakeSP (PO.DAAC) | lake-level series vs GRACE | med | todo |
| I21 | Quantify GLDAS-2.1 forcing inhomogeneity (SWdown/PET jumps) globally; mask affected pixels for ET trends | GLDAS vs MERRA-2 | change-point map | low | todo |
| I22 | Atmospheric rivers / typhoon moisture into Taiwan: hourly IVT extremes trend | MERRA-2 M2T1NXINT (hourly, heavy) | AR-day calendar | high | parked |
| I23 | Taiwan rain verification with CWA gauges (needs a free CWA open-data API key from the user) | CWA | gauge vs IMERG | low | needs user |
| I24 | Where do aquifer losses go? Map GRACE land loss + ocean gain as one "mass flow" figure (task 28 extension) | GRACE | flow map | low | todo |
| I25 | Soil-moisture "flash drought" frequency trend (GLDAS/MERRA-2 SM percentiles) | GLDAS + MERRA-2 | event calendar | med | todo |
