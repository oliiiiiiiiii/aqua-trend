# aqua-trend: Earth-system water trend analysis

NASA Space Apps 2026, *Be An Earth System Trend Detective!*. This branch (`analysis/water-trends`) holds the analysis behind the project. The approach is water first: we put hydrology (rain, evaporation, stored water, runoff, moisture transport) at the centre and correlate everything else against it, always as maps. Each trend is checked against a second dataset before we call it robust.

**Start here**
- [`analysis/findings/FINDINGS.md`](analysis/findings/FINDINGS.md): ranked findings, each with its numbers, robustness verdict and caveats.
- [`analysis/findings/GALLERY.md`](analysis/findings/GALLERY.md): the hero figures, rendered inline.
- [`analysis/findings/glossary.md`](analysis/findings/glossary.md): plain-language definitions of variables and statistics.
- [`analysis/IDEAS.md`](analysis/IDEAS.md): the experiment backlog and the status of each item.
- [`analysis/RUNLOG.md`](analysis/RUNLOG.md): one line per task run.

## Headline results so far
| | Finding | Verdict |
|---|---|---|
| W1 | GRACE detects Ethiopia's GERD reservoir filling: storage rises +7 km³/yr after 2020 with no extra rain. MODIS NDVI independently shows the lake appearing. | Robust (2 sensors) |
| W3 | The hidden loss is groundwater. NW India's aquifers lose about 3.4 cm/yr, and the rate has roughly halved since 2003–10. The North China Plain kept depleting after the South-to-North diversion until the 2021+ floods. | Robust |
| W4 | Indus: the Punjab plains deplete faster even in wetter years, and the Karakoram headwaters now lose 2.2 cm/yr. | Robust |
| W8 | Rain follows moisture convergence by the winds (r = 0.57–0.81), not upwind ocean evaporation. | Robust |
| W9 | Marine heatwave days at Kenting rose from 6 to 115 per year, with 211 in 2024. | Robust |
| W12 | Land loses 703 Gt/yr and the ocean gains 731 Gt/yr (closure within 4%). Aquifers and lakes add about 0.3 mm/yr to sea level. | Robust |
| W13 | Ocean–land seesaw: when the continents soak up rain, sea level drops. In 2011 about 1,600 Gt was parked on land and ocean mass fell 5 mm. The Amazon is the biggest "sponge". | Robust |
| W14 | 2024 was the most widespread hot-and-dry year of the satellite era in both land models (Amazon, southern Africa, Mexico). GRACE shows Mexico at a record low. | Robust record |
| W15 | The southern Amazon's dry season is drier (−10 to −26%/decade) and longer (+6 to +17 days/decade) in 3 rain datasets. A warming tropical Atlantic quantitatively accounts for the trend. | Robust |
| W16 | Rain is replacing snow: the snow share on snowy land fell from 35% to 31% (MERRA-2). MODIS spring snow cover confirms the decline for the Alps, eastern Europe and Japan & Korea, but not for High Mountain Asia. | Robust in aggregate |
| W17 | 32% of land is at its lowest water storage of the GRACE era, against about 15% by chance. Record lows span the Middle East, Central Asia and eastern Europe; record highs span the Sahel and East Africa. | Significant |
| W18 | East Asia extremes ranked: Yangtze 2022 storage was the lowest of 259 months, Henan July 2021 rain was the wettest of 25 years, and Taiwan's Jan–May 2021 rain was the 2nd driest. | Robust |
| W19 | Turning points: on 45% of land the storage trend changed course after 2014. The North China Plain reversed to gain; Central Europe and the Caspian got worse. | Significant |
| W20 | East Africa's lakes ratchet upward in Indian Ocean Dipole years: Turkana +6.7 m, Rukwa +5.7 m, Naivasha +4.3 m (altimetry + GRACE). | Robust |
| W21 | The world's lakes from space: Caspian −1.2 m/decade (altimetry and GRACE agree, r = 0.999); 53 lakes falling, 46 rising. | Robust |
| W22 | The Mekong's heartbeat weakens: Tonle Sap's flood peak −1 m/decade for the same rain (altimetry + GRACE). | Robust |
| W23 | Time of emergence: ocean warming emerged on 68% of the ocean, rainfall trends on only 18% of land (Taiwan rain needs 72 years). | Teaching |
| W24 | The Pantanal dried out after 2019 and fires nearly doubled; the Sahel's Inner Niger Delta and Lake Chad refill (+12–13 cm/decade). | Robust |
| W25 | Where the land sinks: 682 tide gauges minus altimetry — Manila −8.6 mm/yr (groundwater), Alaska +20 (ice-age rebound), Tohoku −0.4 m quake drop. | Robust pattern |
| W26 | Two sea-ice traps: the Arctic 'pause' since 2012 is cherry-picked (41% chance anywhere); the Antarctic collapse coincides with ocean warming but p = 0.08. | Teaching |
| W28 | Arctic darkening: each million km² of summer sea ice lost adds 15.5 W/m² of absorbed sunlight (r = −0.96; NSIDC + CERES). | Robust |
| W29 | Ice loss by region (GRACE): Greenland −258 Gt/yr but slowing since 2012; Amundsen Sea and mountain glaciers accelerating. | Robust |
| W30 | Test calibration: a naive trend test flags 69% of trend-free water-storage twins; AR(1) + FDR brings false alarms to ≤5%. | Teaching |
| N1 | Earthquakes are not increasing. Small-quake counts rise +22%/decade from better detection. Large quakes (M≥6, M≥7, GCMT Mw≥6) show no trend since 1983. Starting in 1973 shows a false +5%/decade, created by a magnitude-scale switch. | Robust null + artefact |
| N2 | Human-made earthquakes: wastewater injection raised Oklahoma ×779 (887 M≥3 quakes in 2015) and the Permian Basin ×325. Regulation halved the rate every 1.2 years. The natural New Madrid zone is flat. | Robust |
| N3 | Water and ice steer the North Pole: GRACE mass change predicts the post-2000 drift change (5.0 vs 5.1 mas/yr, 10° apart). Groundwater pumping pushes the pole toward India. Record short day: −1.65 ms on 5 Jul 2024. | Robust (2 independent systems) |
| N5 | AIRS × OMI: ozone agrees (r = 0.92); Canada 2023 smoke was rank 1 of 22 in both AIRS CO and OMI aerosol; NO₂ fell −15 to −27%/decade in the US, Europe, East Asia and Taiwan, but rose in North India (+13%) and the Persian Gulf (+10%). | Robust (cross-sensor) |
| N7 | The world is burning less: fire detections −11%/decade in both MODIS satellites (savannas, steppe, E China, Indonesia). | Robust |
| N8 | SO₂ moved from China (−92%) to India (+103%) and the Gulf; four satellites agree. | Robust |
| N9 | Hunga Tonga added +13% to stratospheric water (9σ); half is still there after four years. | Robust |
| N10 | Less dust over the Sahel (−9%/dec) and Iraq–Syria (−17%/dec); greener years are cleaner years. | Robust |
| N12 | Asia's haze redrawn: 27 AERONET ground stations — Taipei −39%/dec, Beijing −68%/dec, Seoul −48%; India's Ganges plain +19%. | Robust |
| N13 | Hunga Tonga's wet stratosphere cooled 2 K and lost 3% ozone in year 1 (cooling robust; ozone dip fades). | Robust / Significant |
| N14 | Asia's haze changes grain: fine combustion particles −43%/decade in East Asia, +21% in South Asia; dust falls in both. | Robust |
| N15 | Clearing skies over East Asia: CERES clear-sky reflection −2.2 W/m²/decade, tracking haze (r = 0.96); ground sunshine +5–6 W/m²/decade. | Robust |
| N16 | Earth's energy imbalance more than doubled: 0.67 → 1.65 W/m² (CERES); the planet absorbs +0.88 W/m² more sunlight per decade. | Robust |
| N17 | When the sea warms, the clouds thin: +7 W/m² per K over stratocumulus decks (CERES + OISST), amplifying heatwaves like the NE Pacific Blob. | Robust |
| N4 | The ozone hole stopped growing in 1993 (p = 4e-10); recovery since 2001 is not yet significant. | Robust break / Suggestive recovery |
| W2 | Taiwan rain decline: depends on the dataset and pixel choice and needs gauge verification. | Suggestive |

The **negative results** are also recorded:
- GLDAS ET drift.
- The Terra LST orbit-drift "cooling".
- The model-dependent evaporation-regime shift.
- No detectable soil-moisture → rain feedback at monthly scale.
- No global "wet seasons wetter" amplification.
- No robust whiplash trend.
- No detectable seasonal water-load modulation of earthquakes.
- No significant Amazon early-warning (resilience-loss) signal in MODIS NDVI yet (surrogate p = 0.15).
- Methane's 2020–22 surge vs tropical wetland water: r = +0.63, but it is a shared trend (surrogate p = 0.11; detrended r = +0.14).

They show why a trend needs a second dataset.

## Layout
```
analysis/
  scripts/      trendlib.py (statistics: AR(1)-adjusted OLS, Mann-Kendall/Sen, FDR, Bretherton correlation, Pettitt)
                hub.py (all water layers on one 0.5° monthly grid), viz.py (figure style), fetch_*.py (data download)
                task_NN_*.py (one script per experiment), make_gallery.py, sync_repo.sh
  results/NN_*/ README.md + figures (png) + stats (json/csv) for each task
  findings/     FINDINGS.md, GALLERY.md, glossary.md, figures/
```
Raw and processed satellite data (~46 GB), `*.nc`/`*.npy` grids, the virtualenv and logs are **not** in git.

## Reproduce
1. `python -m venv .venv && .venv/bin/pip install -r analysis/requirements.txt` (`cupy` is optional; the code falls back to the CPU).
2. Put your NASA Earthdata Login in `~/.netrc`, and approve the GES DISC app in your Earthdata profile.
3. Run the `analysis/scripts/fetch_*.py` scripts, then `analysis/scripts/task_*.py` in numeric order. Paths resolve relative to the repo, or you can set `AQUA_ROOT=/path/to/analysis`.

Data: GRACE/GRACE-FO JPL mascons, NASA-SSH, MODIS (NDVI, LST, chlorophyll), GLDAS Noah 2.1, MERRA-2, GPM IMERG, GPCP, NOAA OISST, NSIDC Sea Ice Index, HydroBASINS.
