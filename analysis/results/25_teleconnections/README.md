# Task 25 — One ocean signal, opposite water effects: ENSO / IOD / PDO fingerprints on rain, ET and water storage

**Method:** per-pixel correlation of deseasonalised, detrended monthly anomalies (IMERG rain 2001–2025, GLDAS ET 2001–2026, GRACE TWS 2002–2026) with Niño3.4, DMI (IOD) and PDO, scanning lags 0–6 months (index leading); AR(1)-adjusted significance (Bretherton 1999) + FDR q=0.10.

| Index → field | land significant + | land significant − | typical lag |
|---|---|---|---|
| ENSO → rain | 10 % | 8 % | 1 month |
| ENSO → ET | 7 % | 5 % | 2 months |
| **ENSO → water storage** | 9 % | 11 % | **4 months** |
| IOD → rain / ET / storage | 3 / 1 / 3 % | 4 / 1 / 3 % | 1 / 2 / 4 months |
| PDO → rain / ET | 2 / 3 % | 2 / 2 % | 1 month |
| PDO → water storage | 20 % | 21 % | 2 months — *suggestive only*: both series are slow, only 2–3 PDO phases in 24 years |

**Cascade:** ENSO's imprint arrives in rain after ~1 month, in evaporation after ~2, and in stored water after ~4 months — the signal propagates through the water cycle.

**Pattern (hero map `map_ENSO_water_storage.png`):** El Niño drains the Amazon/northern South America, southern Africa, Borneo/Indonesia, southern India, Central America; fills SE South America (La Plata), the US Gulf coast, southern China, Kazakhstan — the challenge's "same process, opposite trends in different regions".

**Regional checks:** Taiwan rain vs Niño3.4 r = −0.03 (p = 0.56) — Taiwan's rain decline is not ENSO-driven; Lake Victoria storage vs IOD r = +0.19 at 6-month lag (p = 0.16, n.s. on monthly anomalies — the 2019 extreme IOD drove one big step, not a correlation over the record); Sahel rain vs ENSO r = −0.11 (p = 0.13).
