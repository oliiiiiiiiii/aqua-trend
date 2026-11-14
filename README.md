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
| W2 | Taiwan rain decline: depends on the dataset and pixel choice and needs gauge verification. | Suggestive |

The **negative results** are also recorded: GLDAS ET drift, the Terra LST orbit-drift "cooling", and the evaporation-regime shift that is model-dependent. They show why a trend needs a second dataset.

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
