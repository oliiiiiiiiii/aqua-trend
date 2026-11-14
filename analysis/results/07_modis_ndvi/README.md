# Task 07 — Vegetation greenness (MODIS Terra MOD13C2 NDVI), 2000-02 → 2026-10

**Data:** MOD13C2 v6.1 monthly 0.05° CMG (LP DAAC), QA: pixel reliability ≤ 1; aggregated to 0.1° globally, kept at 0.05° for East Asia. Barren pixels (mean NDVI < 0.12) excluded.

## Results
- **41 % of vegetated land** has a significant NDVI trend (both tests, FDR); **89 % of those are greening**.
- Biggest greening clusters: **China** (5.4 M km², +0.034 NDVI/decade), **India** (3.5 M km², +0.038/decade — irrigated cropland), Sudan/S. Sudan/Chad, Turkey/Iran, Sahel.
- Regional: Loess Plateau **+14.4 %/decade** (Grain-for-Green afforestation), Beijing +12.4 %, Inner Mongolia +9.1 %, North China Plain +7.9 %, Indo-Gangetic Plain +7.5 %, Sahel +4.2 %, Taiwan +2.1 % (all p < 0.001).
- Browning: Rondônia −1.2 %/decade (p=2e-4), Mato Grosso −1.4 %/decade (p=0.006) — Amazon deforestation frontier.
- Robust to the Terra orbit drift: 2000–2019 trends are as strong (Loess +17 %/dec, IGP +6.4 %/dec).

**Figures:** `map_global.png` (hero), `map_zoom_india.png`, `map_zoom_china.png`, `map_zoom_amazon.png`, `map_eastasia_0p05.png`, `map_taiwan_0p05.png`, `ts_*.png`.
