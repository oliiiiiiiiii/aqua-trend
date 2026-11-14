# Task 56: Time of emergence — how many years before a trend is detectable?

**Method**
- **Inputs:** for each 0.5° cell, deseasonalised monthly anomalies.
- **Trend and noise:** an OLS slope ω (per year), plus the residual noise sd σ and lag-1 autocorrelation φ.
- **Years needed** (Weatherhead et al. 1998), for 5% significance and 90% power: n* = [3.3 σ/|ω| · √((1+φ)/(1−φ))]^(2/3).
- **"Emerged"** means n* ≤ the length of the record already available.
- **Variables:** GRACE/GRACE-FO water storage (2002–2026), GPCP v2.3 rain (1979–2025), OISST v2.1 SST (1982–2026), MODIS NDVI (2000–2026).
- **Caveat:** n* uses the observed slope, so where the true trend is ~0, n* is large by construction.

## Results
| variable | record | already emerged | median years needed | needs >100 yr | median φ |
|---|---|---|---|---|---|
| water storage (GRACE) | 24 yr | **58%** of land | 20 | 7% | 0.77 |
| rainfall (GPCP) | 47 yr | **18%** of land | 76 | **37%** | 0.09 |
| sea-surface temperature | 45 yr | **68%** of ocean | 35 | 11% | 0.65 |
| greenness (NDVI) | 27 yr | **31%** of land | 36 | 11% | 0.53 |

**Regional means: years needed vs years observed**

| region | years needed | years observed | status |
|---|---|---|---|
| NW India groundwater | 7 | 24 | emerged |
| Caspian | 11 | 24 | emerged |
| India greening | 11 | 27 | emerged |
| Kuroshio/Taiwan Strait SST | 21 | 45 | emerged |
| Sahel rain recovery | 37 | 47 | just emerged |
| **Taiwan rain** | **72** | 47 | not yet detectable (OLS p = 0.08) |

- **Takeaways:**
  - The tropical eastern Pacific needs >100 years for SST because ENSO noise dominates there.
  - China and India are the regions where greening is already detectable.
  - A non-significant rainfall trend usually means "not yet detectable", not "no change". This is the core lesson for users of a trend-detection tool.

## Files
- `time_of_emergence.png`, `stats.json`.
