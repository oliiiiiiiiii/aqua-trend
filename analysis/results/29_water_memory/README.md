# Task 29 — Water memory: how long after rain does stored water respond? (IMERG × GRACE)

**Method:** per-pixel correlation of deseasonalised, detrended IMERG rain anomalies with GRACE water-storage anomalies, rain leading by 0–9 months; lag of the maximum (positive, FDR-significant) correlation. 2002-04 → 2025-09.

- Of land with a significant rain→storage link: **67 % peaks after 1 month**, 13 % after 2, 5 % after 3, ~10 % after 4–9 months.
- Slow-memory regions (snowpack, big aquifers, floodplains): California Central Valley **5 months** (Sierra snowpack + reservoirs), **Okavango–Zambezi 4 months** (the delayed Okavango flood pulse from the Angolan highlands), North China Plain 3, Tigris–Euphrates 3 (Anatolian snowmelt), Sahel 2; fast: NW India, Indo-Gangetic Plain, Amazon arc, East Africa 1 month.
- Where storage is *not* linked to rain (grey): ice sheets/glaciers, pumping-dominated or inflow-fed regions.

**Figures:** `map_water_memory_lag.png` (hero), `map_rain_storage_maxcorr.png`; `regional_lags.csv`, `water_memory.nc`.
