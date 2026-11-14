# Task 45: Where is the world burning more, and where less? (MODIS active fires 2003–2025)

**Data and method**
- Data: NASA FIRMS, MODIS C6.1. Vegetation fires only (type 0), confidence ≥30. Aggregated to 0.5° monthly counts, split by satellite: Terra (overpass 10:30) and Aqua (13:30).
- Per-cell test: Sen slope with Mann–Kendall and FDR q = 0.10, run separately on each satellite's annual counts.
- A cell counts as **robust** when Aqua is significant and Terra trends in the same direction.
- Orbit-drift check: the analysis is repeated for 2003–2019, before Terra (2020) and Aqua (2022) began drifting.

## Results
- **Global:**
  - Aqua **−11%/decade** (p = 1e-4) and Terra **−10%/decade** (p = 2e-4).
  - The same in 2003–2019: −12% and −10%, so this is not an orbit-drift artefact.
  - This matches the documented global decline in burned area as savannas are converted to farmland.
- **Cells:** robust decline on **25%** of burning land and increase on 6%. Where the full-period trend is significant, 98% of cells have the same sign over 2003–2019.
- **Declines:** northern African savanna (−11%/decade, both satellites significant), the Russian and Kazakh steppe croplands, eastern China (straw-burning bans), Indonesia & Malaysia (−51%/decade, both significant, after the 2015 peak), the Brazilian Cerrado, and mainland SE Asia (Aqua −20%/decade).
- **Increases:** central India, NE China, and the Andes–Amazon edge in Peru and Bolivia.
- **Boreal North America:** +30%/decade with a record in 2023, but too variable to be significant (p = 0.07).
- **Punjab & Haryana crop stubble:**
  - Aqua shows no long-term trend, while Terra shows −41%/decade.
  - Both collapse after 2021, with Aqua falling from 22k detections in 2021 to 7k in 2025.
  - The satellite disagreement is consistent with burning moving to later in the day. Treat it as unresolved.

**Verdict.**
- **Robust:** the global decline, the African savanna, Indonesia and the steppe.
- **Suggestive:** the boreal increase.
- **Unresolved:** the Punjab long-term trend.

## Files
- `map_fire_trend.png`, `regional_fire_series.png`, `regions_fire_trends.csv`, `stats.json`.
