# Task 26 — Is India's greening paid for with groundwater? — mostly a NULL result (useful)

**Data:** MODIS NDVI (Rabi / dry season Dec–Mar, when greenness needs irrigation) 2001–2026 at 0.1°; groundwater trend = GRACE − GLDAS soil+snow (task 21).

| Test | Result | Verdict |
|---|---|---|
| Dry-season greening | 69 % of vegetated South-Asian pixels significantly greening; NW India +0.039 NDVI/decade (p = 3e-10) | robust greening |
| Spatial: where fields greened most, did aquifers fall fastest? | Spearman r = **+0.09** (wrong sign); naive p = 5e-4 but **p = 0.58** after accounting for GRACE's ~300 km footprint (n_eff ≈ 38) | **not supported** |
| Temporal (NW India): Rabi NDVI vs groundwater, year by year | r = −0.84 (p = 2e-7) | co-trending series (one up, one down) — not evidence of causation by itself |

**Lesson for the tool:** thousands of map pixels make tiny correlations look "significant" (p = 5e-4) unless you account for spatial autocorrelation — the honest p is 0.58. GRACE is too coarse to match field-scale irrigation patterns; well-level data (CGWB) would be needed.
