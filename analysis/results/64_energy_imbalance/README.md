# Task 64: Earth's energy imbalance has more than doubled (CERES, 2000–2026)

**Data and method**
- **Data:** CERES EBAF Ed4.2.1 monthly TOA fluxes (1°): net, reflected shortwave (all-sky and clear-sky), and incoming solar.
- **Derived quantities:**
  - Absorbed solar (ASR) = solar − reflected SW.
  - Outgoing longwave (OLR) = ASR − net.
  - The cloud part of ASR = all-sky ASR − clear-sky ASR.
- **Global series:** area-weighted means, deseasonalised. This removes the ±10 W m⁻² annual cycle caused by Earth's orbital eccentricity.
- **Trend 2001–2025:** OLS with AR(1)-corrected errors, Mann–Kendall on annual means, and a quadratic acceleration test.
- **Map:** absorbed-SW trend per cell (Theil–Sen; AR(1)-OLS and MK; FDR).
- **Anchoring:** EBAF anchors the absolute imbalance to in-situ ocean heat uptake; the trend comes from CERES.

## Results
- **Imbalance:** **0.67 W m⁻² (2001–05) → 1.65 W m⁻² (2021–25)**, ×2.4.
  - Trend: +0.45 ± 0.14 W m⁻² per decade (p = 7e-10; MK p = 2e-4).
  - Record year: 2023. The last 12 months (to Jul 2026) average 1.96 W m⁻².

**Decomposition (W m⁻² per decade):**

| component | trend | acceleration test |
|---|---|---|
| absorbed sunlight | **+0.88 ± 0.12** | accelerating, p = 1e-6 |
| — cloud part (fewer and dimmer clouds) | +0.47 | |
| — clear-sky part (sea ice and snow loss, cleaner air) | +0.41 | |
| outgoing longwave (a warmer planet radiates more) | +0.42 | partly offsets the gain |

- **Map:** darkening (more absorption) appears over the NE Pacific, the Arctic margins and eastern China. The tropical Pacific dipole is an ENSO cloud shift, and India's haze growth shows as blue.

**Verdict:** robust. The size is consistent with published CERES analyses (e.g. Loeb et al. 2021, "doubling"). It is the most direct measure of the planet's heating rate.

## Files
- `energy_imbalance.png`, `stats.json`, `global_toa_anomalies.csv`.
