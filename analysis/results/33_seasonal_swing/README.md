# Task 33 — Is the water cycle's seasonal swing growing? (+ 33b southern Amazon dry season)

**Question.** Over time, are wet seasons getting wetter and dry seasons drier? And is the yearly swing of stored water (GRACE) growing?

**Method.**
- Rain datasets: GPCP 1979–2025, with IMERG and GPCP 2001–2025 as cross-checks.
- Seasons: per pixel, the climatologically wettest and driest 3-month windows. Pixels whose dry season gets under 15 mm per 3 months are treated as always dry and excluded from the % change.
- Trend test: OLS-AR1 and Mann-Kendall must both pass (max p), then FDR q = 0.10.
- Four classes from the signs of the two trends.
- GRACE: an annual harmonic fitted year by year (years with at least 10 months), then the trend of the amplitude.

**Results.**

GPCP 1979–2025 classes (all / significant):

| Class | All | Significant |
|---|---|---|
| amplifying | 17% | 1.3% |
| wetter_all_year | 34% | 6.6% |
| drier_all_year | 32% | 5.4% |
| damping | 17% | 1.6% |

- 2001–2025: about 0% significant in both IMERG and GPCP.
- IMERG and GPCP classes agree on 61% of land.
- GRACE amplitude: no significant pixels. The spatial r with the rain-swing change is -0.06.
- **Verdict:** no global amplification of the seasonal swing. It's symmetric noise plus regional signals.

Regional seasonal series (area means have far more power than pixels), % per decade:

| Region / season | GPCP 1979–2025 | IMERG 2001–25 | MERRA-2 2001–25 |
|---|---|---|---|
| Southern Amazon | -10.3 (p=0.000) | -16.5 (p=0.009) | -25.8 (p=0.001) |
| Southern Africa | -9.5 (p=0.016) | -11.2 (p=0.178) | +0.3 (p=0.981) |
| Ganges-Brahmaputra | -11.0 (p=0.023) | +0.4 (p=0.977) | +17.0 (p=0.317) |
| Sahel (wet season) | +7.0 (p=0.000) | +6.3 (p=0.012) | +26.0 (p=0.000) |
| Taiwan dry season | +0.3 (p=0.936) | -11.2 (p=0.458) | +3.0 (p=0.831) |
| Mekong dry season | +9.9 (p=0.022) | -4.2 (p=0.726) | +12.9 (p=0.398) |

Seasons: Amazon and southern Africa Jul–Sep; Ganges Dec–Feb; Sahel Jul–Sep; Taiwan Nov–Jan; Mekong Jan–Mar.

**33b: southern Amazon (70–50°W, 15–5°S).**
- Jul–Sep rain trends: GPCP -10.3%/decade, IMERG -16.5%, MERRA-2 -25.8%.
- Dry-season length (months under 100 mm): GPCP +5.6, IMERG +13.1, MERRA-2 +17.0 days/decade. All have p < 0.003.
- GRACE Sep–Nov storage: -2.0 cm/decade (p = 0.32). 2024 is the lowest at -39.3 cm (absolute).

**Files.**
- Figures: `amazon_dry_season.png` (hero), `map_seasonal_swing_classes.png`, `map_wet_season_trend.png`, `map_dry_season_trend.png`, `map_grace_annual_amplitude_trend.png`.
- Data: `regions.csv`, `regional_season_trends.json`, `amazon_*.csv`, `stats.json`, `amazon_stats.json`.
