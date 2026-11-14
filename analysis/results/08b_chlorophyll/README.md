# Task 08b — Ocean chlorophyll-a, MODIS-Aqua L3 monthly 9 km, 2002-07 → 2026-04

**Data:** `MODISA_L3m_CHL` R2022.0 (OB.DAAC), 339 monthly 9 km granules streamed into a float16 cube (raw files deleted). Trend fitted to log10(chl) and reported as % per decade; regional series are geometric means.

## Results
- Only **4 % of the ocean** has a significant (FDR, both tests) trend; of that **80 % is decreasing** — subtropical gyres (N Atlantic 13°S…, NW Pacific/Philippine Sea −12 %/decade, N Pacific gyre), consistent with warming-driven stratification; increases in the Sea of Japan/Okhotsk/Kuril region and parts of the Southern Ocean.
- Kuroshio east of Taiwan: −4.7 %/decade (OLS-AR1 p=0.007, MK p=0.06 → one test).
- Taiwan Strait (+0.9 %/dec, p=0.66) and East China Sea shelf (+2.2 %/dec, p=0.36): no significant trend.
- Baltic Sea: +11.1 %/decade (p=7e-5, eutrophication) — strongest regional signal.

## Story value
Demonstrates the challenge's point that "sometimes all a trend needs to become significant is a longer period": chlorophyll needs ~30–40 years to emerge from natural variability (Henson et al. 2010). Good contrast case vs SST (task 08a), where nearly all the ocean is significant.

## Caveats
MODIS-Aqua is past its design life (orbit drift since 2022); trends in the last years may carry calibration drift — cross-check with VIIRS/PACE (follow-up).
