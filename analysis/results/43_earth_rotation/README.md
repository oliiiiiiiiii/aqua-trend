# Task 43: Water and ice move the North Pole and change the length of the day

**Data**
- IERS EOP 20 C04 daily polar motion and length of day (LOD), 1962 to Oct 2026.
- JPL GRACE/GRACE-FO global mascons, 2002–2026. These include the ice sheets and the ocean, and JPL has already removed GIA.

**Method**
- Mean pole: cascaded 365-day, 433-day and 365-day running means of daily x, y. This removes the annual and Chandler wobbles.
- Drift vectors: OLS on annual means for each era.
- GRACE mass excitation (Gross 2007 / Chen et al. 2013): χ₁ + iχ₂ = −1.098 R⁴/(C−A) Σ Δσ sinφ cos²φ e^{iλ} ΔφΔλ, with C−A = 2.6068×10³⁵ kg m².
  - For excitation much slower than the 433-day Chandler period, the pole follows χ: x = χ₁ and y = −χ₂.
  - LOD effect: χ₃ = 0.753 R⁴/C_m Σ Δσ cos³φ, with C_m = 7.1236×10³⁷ kg m².

## Results
**Observed drift of the mean pole**

| era | speed | toward |
|---|---|---|
| 1962–1981 | 5.2 mas/yr | 72°W (Canada, mostly post-glacial rebound) |
| 1982–2001 | 2.6 mas/yr | 97°W |
| 2002–2013 | 4.8 mas/yr | **27°E** |
| 2014–2025 | 3.3 mas/yr | 10°W |
| 2002–2025 | 4.4 mas/yr | 7°W |

**GRACE-predicted drift, 2002–2026 (mass term)**

| source | speed | toward |
|---|---|---|
| Greenland ice | 2.6 mas/yr | 46°W |
| Antarctic ice | 2.0 mas/yr | 59°E |
| Land water & glaciers | 1.2 mas/yr | **69°E** (groundwater pumping in India and the Middle East; cf. Seo et al. 2023) |
| Ocean (receiving the meltwater) | 1.6 mas/yr | 12°E |
| **Total** | **5.0 mas/yr** | **15°E** |

- **Test: the observed change in drift** (2002–25 minus the 1982–2001 baseline, which removes the steady GIA and mantle part) is **5.1 mas/yr toward 24°E**.
  - GRACE predicts 5.0 mas/yr toward 15°E, so the **directions differ by 10° and the speeds by 2%**.
  - Year-to-year departures from the trend also correlate: r = 0.73 for x and 0.54 for y, over 21 years.
- **Length of day**
  - The shortest day on record was **−1.65 ms on 5 July 2024** (relative to 86,400 s).
  - Days shorter than 86,400 s: 0–2 per year in 2013–2017, against **168–239 per year in 2020–2025**.
  - The annual mean fell 1.61 ms/decade over 2016–2025. This comes from motions in the liquid core.
  - GRACE mass redistribution (polar ice to the ocean) *lengthens* the day by **+1.5 ms per century**, of the same order as published climate estimates (≈1.3 ms/century for 2000–2018).

**Verdict:** **Robust**.
- Two independent measurement systems agree on both direction and size: space geodesy (VLBI/GNSS) for the pole, and gravimetry for the mass.
- **Caveats**
  - The 1982–2001 baseline is not purely GIA: it also contains earlier climate-driven mass change.
  - The excitation uses the mass term only; currents and winds have a negligible effect on trends.
  - The interannual comparison ignores the slight amplification of motions with periods of a few years by the Chandler resonance.

## Files
- `pole_drift_water.png`: the mean pole path since 1963, drift vectors by era, and the GRACE attribution against the observed change.
- `length_of_day.png`: daily LOD with the record short days, and days per year shorter than 86,400 s.
- `grace_pole_excitation.csv`, `eop_annual_means.csv`, `stats.json`.
