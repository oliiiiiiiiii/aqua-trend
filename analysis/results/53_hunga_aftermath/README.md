# Task 53: Hunga Tonga aftermath — the wetter southern stratosphere cooled and lost some ozone

**Data and method**
- **Data:** Aura MLS v5 L3 daily zonal means of H₂O, temperature and O₃ on pressure levels, 2005–2025.
- **Region:** monthly means for 15–55°S, where the plume stayed in 2022, at 100–1 hPa.
- **Anomalies:** relative to the 2005–2021 monthly climatology, minus each level's linear 2005–2021 trend extrapolated forward. This removes CO₂ cooling, ozone recovery and instrument drift.
- **8.25 hPa level:** replaced by log-p interpolation in all three products (retrieval-grid artefact; see task 50).
- **Tests:**
  - First-year (Feb 2022–Jan 2023) and two-year (Feb 2022–Jan 2024) mean anomalies at each level, compared with all 12- and 24-month means of 2005–2021 (z-score and empirical rank).
  - Monthly coupling in the 15–40 hPa layer.

## Results
**15–40 hPa layer (~22–28 km), first year:**

| quantity | anomaly |
|---|---|
| H₂O | **+49%** |
| temperature | **−1.6 K** |
| O₃ | **−2.8%** |

**Peaks:**

| quantity | first year | two-year mean |
|---|---|---|
| water vapour | **+66%** at 26 hPa, 83 σ | +44%, 72 σ |
| temperature | **−2.1 K** at 22 hPa, 7 σ; no 2005–21 12-month mean is as cold | −1.0 K, 9 σ |
| ozone | **−3.0%** at 26 hPa, 3.5 σ; no 2005–21 12-month mean as low | −1.0%, 2.2 σ (5.5% of pre-eruption 24-month means are as extreme) |

**Year by year (15–40 hPa):**

| year | H₂O | temperature | O₃ |
|---|---|---|---|
| 2022 | +47% | −1.6 K | −2.9% |
| 2023 | +21% | +0.2 K | +1.5% |
| 2024 | +15% | −0.7 K | −1.5% |

**Monthly coupling (15–40 hPa):**

| | H₂O–temperature r | H₂O–O₃ r |
|---|---|---|
| 2022–25 | **−0.63** | **−0.56** |
| 2005–21 | −0.06 | −0.22 |

**Verdict:**
- **Robust:** the extra water and the cooling.
- **Significant but small:** the first-year ozone dip; it is not robust over two years. QBO-related ozone swings of similar size occurred in 2016–17.

## Files
- `hunga_aftermath_temperature_ozone.png`, `stats.json`, `plume_layer_anomalies.csv`.
