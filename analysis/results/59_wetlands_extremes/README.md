# Task 59: Wetlands at the extremes — the Pantanal dries and burns, the Sahel's wetlands refill

**Data and method**
- **Data:**
  - GRACE/GRACE-FO JPL mascons (water storage).
  - GPCP v2.3 rain.
  - NASA FIRMS MODIS **Aqua-only** vegetation-fire detections, 2003–2025 (one satellite, to avoid mixing).
- **Region boxes:**
  - Pantanal: 58.5–55°W, 21–15.5°S.
  - Inner Niger Delta: 6–3°W, 13.5–16.5°N.
  - Lake Chad basin: 13–16°E, 11.5–14.5°N.
- **Tests:**
  - Theil–Sen + Hamed–Rao MK on annual means.
  - Pettitt change point on monthly anomalies.
  - Fires 2019–24 vs 2003–18: rate ratio and Mann–Whitney. The binomial p is not reported because the counts are strongly overdispersed.
  - Spearman correlation of annual fires with the dry-season (Jul–Oct) water-storage anomaly and with the preceding wet season's (Nov–Apr) rain.

## Results
**Pantanal:**
- **Water:** Pettitt change point in **Dec 2019** (p = 1e-25). The mean anomaly fell from +4.6 to −9.8 cm; 2024 is the lowest in the GRACE record (−20 cm annual mean).
- **Rain:** 2003–2025 trend −9%/decade (p = 0.045). The 1981–2025 trend is −2%/decade, n.s., so this is a recent run of dry years rather than a long-term trend.
- **Fires:**
  - 2019–24 mean 17.0k detections/yr vs 9.3k in 2003–18 (**×1.8**, Mann–Whitney p = 0.049).
  - Records: 2020 (31.0k) and 2024 (27.6k).
  - Fires vs the preceding wet season's rain: ρ = −0.51 (p = 0.014). Vs dry-season water storage: ρ = −0.42 (p = 0.053).

**Sahel wetlands (GRACE water-storage trend):**

| region | storage trend | Pettitt step (p) | rain trend since 1981 |
|---|---|---|---|
| Inner Niger Delta | **+13.4 cm/decade** (p = 4e-5) | 2015 (3e-41) | +10%/decade (p = 3e-7) |
| Lake Chad basin | **+12.3 cm/decade** (p = 0.016) | 2012 | +10.5%/decade (p = 4e-7) |

- Lake Chad's lake level from altimetry also rises (task 55).

**Verdict:**
- **Robust:** the Pantanal's water loss since 2019 (GRACE plus rain) and the Sahel refill (GRACE plus 45 years of rain).
- **Significant:** the fire increase in the Pantanal and its link to rain. Fire counts are noisy, with n = 22 years.

## Files
- `wetlands_extremes.png`, `stats.json`.
