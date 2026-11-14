# Task 66: When the sea warms, the clouds thin — a satellite map of the low-cloud feedback

**Data and method**
- **Data:**
  - CERES EBAF Ed4.2.1 cloud shortwave effect = all-sky minus clear-sky absorbed sunlight. A positive anomaly means clouds are letting in more sunlight.
  - NOAA OISST v2.1, block-averaged to 1°.
  - Monthly, 2001–2025.
- **Per ocean cell:** deseasonalised and linearly detrended anomalies.
  - Pearson r with the Bretherton effective-n significance (`trendlib.grid_corr`), FDR q = 0.10.
  - Regression slope in W m⁻² per K.

## Results
- **Map:** significant positive (warmer sea → less cloud reflection) on **48% of the ocean**; significant negative on 12%.

| region | median r | median slope (W m⁻² per K) | cells significant | box r (detrended) |
|---|---|---|---|---|
| California stratocumulus | +0.38 | **+6.7** | 98% | +0.50 |
| Peru stratocumulus | +0.33 | **+6.5** | 77% | +0.41 |
| Namibia stratocumulus | +0.31 | **+6.7** | 94% | +0.49 |
| NE Pacific "Blob" | +0.36 | +4.0 | 94% | +0.41 |
| Central equatorial Pacific | −0.48 | **−16.9** | 85% | −0.62 |

- **Blob heatwave 2014–15:** SST +0.9 K, with clouds letting in +2.5 W m⁻² extra.
- **2019–20:** SST +1.0 K, cloud effect +4.9 W m⁻².
- In the central equatorial Pacific the sign flips: warm water triggers deep convective clouds (ENSO).

**Verdict:** robust. This is an observed positive low-cloud feedback over the subtropical stratocumulus decks, which amplifies marine heatwaves. It also explains the cloud part of task 64's rising energy imbalance.

## Files
- `cloud_sst_feedback.png`, `stats.json`.
