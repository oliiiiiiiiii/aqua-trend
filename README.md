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
| N1 | Earthquakes are not increasing. Small-quake counts rise +22%/decade from better detection. Large quakes (M≥6, M≥7, GCMT Mw≥6) show no trend since 1983. Starting in 1973 shows a false +5%/decade, created by a magnitude-scale switch. | Robust null + artefact |
| N2 | Human-made earthquakes: wastewater injection raised Oklahoma ×779 (887 M≥3 quakes in 2015) and the Permian Basin ×325. Regulation halved the rate every 1.2 years. The natural New Madrid zone is flat. | Robust |
| N3 | Water and ice steer the North Pole: GRACE mass change predicts the post-2000 drift change (5.0 vs 5.1 mas/yr, 10° apart). Groundwater pumping pushes the pole toward India. Record short day: −1.65 ms on 5 Jul 2024. | Robust (2 independent systems) |
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
