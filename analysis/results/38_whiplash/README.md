# Task 38 — Hydroclimate whiplash (null / dataset-dependent)

**Method.**
- Per pixel: 3-month rain totals turned into empirical percentiles for each calendar end-month (1980–2025).
- Event: S3(t) ≤ p10 and S3(t+3) ≥ p90, or the reverse. Consecutive months are merged.
- Compare 1980–2002 with 2003–2025, using a binomial test for equal Poisson rates and FDR.
- Aggregate trend: the land-area-weighted annual rate.
- Data: GPCP at 2.5° (native) and MERRA-2 PRECTOTCORR at 0.5°.

**Results.**

| | GPCP | MERRA-2 |
|---|---|---|
| events/yr 1980–2002 | 0.194 | 0.151 |
| events/yr 2003–2025 | 0.167 | 0.157 |
| ratio | 0.86 | 1.04 |
| trend p (OLS-AR1 / MK) | 0.009 / 0.003 | 0.29 / 0.19 |
| dry→wet early → late | 0.095 → 0.081 | 0.074 → 0.079 |
| wet→dry early → late | 0.099 → 0.086 | 0.077 → 0.078 |
| pixels with more / fewer | 35% / 52% | 45% / 39% |

- Annual-series r = 0.41.
- Map sign agreement at 2.5°: 57%.

**Verdict.** No robust change, and the two datasets disagree on the sign. Keep this as an honest null.

**Files.** `whiplash_rate_series.png`, `map_whiplash_change_merra2.png`, `land_whiplash_rate.csv`, `stats.json`.
