# Task 09 — Sea ice extent (NSIDC Sea Ice Index v4), 1979 → 2026

**Data:** NSIDC G02135 v4 monthly extent CSVs (open), Arctic (N) and Antarctic (S). Anomalies vs 1981–2010 for each calendar month.
**Method:** OLS+AR(1) and Mann-Kendall (Hamed-Rao) per calendar month and on deseasonalised monthly series; Pettitt change-point on monthly anomalies; segment fits.

## Results
| Series | Trend | p | Verdict |
|---|---|---|---|
| Arctic, all months | −0.51 ± 0.07 M km²/decade | 1e-25 | significant |
| Arctic September (minimum) | **−11.6 %/decade** vs 1981–2010 | 3e-12 | significant — sanity check ✔ (literature ≈ −12 %/decade) |
| Arctic March (maximum) | −2.5 %/decade | 1e-12 | significant |
| Arctic 2016–2026 only | +0.06 ± 0.43 M km²/decade | 0.79 | **no trend in the last decade** (a "pause", short-record caveat) |
| Antarctic, all months 1979–2026 | −0.08 ± 0.14 | 0.24 | not significant overall… |
| Antarctic 1979–2015 | **+0.24 ± 0.10** | 8e-6 | significant *growth* |
| Antarctic change-point | **Sep 2016** | Pettitt p = 4e-23 | abrupt regime shift; record lows 2023 |

## Figures
- `stripes_arctic.png`, `stripes_antarctic.png` — year × month anomaly "stripes" (hero visuals)
- `ts_arctic_september.png`, `ts_antarctic_anomaly.png`

## Story value
- **Antarctic: a trend that flipped** — whole-record linear trend says "nothing happening" (p=0.24) while the change-point test finds one of the most abrupt shifts in the climate record. Perfect demo of why the tool should offer change-point + segment trends, not just one line.
- **Arctic: steady loss** (−12%/decade in September) with an apparent pause since ~2012–2016 — demo of how the significance of a short window differs from the long record.
