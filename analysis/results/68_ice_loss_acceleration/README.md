# Task 68: Ice loss by region and its acceleration (GRACE/GRACE-FO 2002–2026)

**Data and method**
- **Data:** JPL mascons RL06.3 CRI (GIA-corrected).
- **Regional mass (Gt):** Σ lwe × cell area. Region masks follow task 28, plus Antarctic sub-regions:
  - Amundsen Sea sector: 135–95°W, 80–72°S.
  - Peninsula: 75–55°W, north of 75°S.
  - Rest of West Antarctica: 150–60°W.
  - East Antarctica: the rest.
- **Statistics (deseasonalised):** linear rate; acceleration = 2 × the quadratic coefficient, with AR(1)-corrected errors. Rates are also compared for 2002–12 vs 2013–26.

## Results
| region | rate (Gt/yr) | 2002–12 → 2013–26 | acceleration (Gt/yr²) | total since 2002 |
|---|---|---|---|---|
| Greenland | **−258** | −284 → −208 | **+6.2 ± 1.3** (loss *slowing*, p < 0.01) | −5,569 Gt |
| Antarctica (all) | **−126** | −101 → −96 | +2.2 ± 2.2 (p = 0.32) | −2,457 Gt |
| Amundsen Sea sector | −141 | −121 → −140 | **−1.3 ± 0.6** (loss speeding up, p = 0.02) | −3,022 Gt |
| Antarctic Peninsula | −25 | −39 → −9 | +2.2 (p < 0.01) | |
| East Antarctica | **+58** | +72 → +61 | n.s. | +1,482 Gt (snowfall) |
| Alaska & W Canada | −74 | −58 → −82 | −1.2 (p = 0.08) | |
| Arctic Canada, Svalbard, Russian Arctic | −74 | −63 → −77 | **−1.3 ± 0.3** (p < 0.01) | |
| High Mountain Asia | −31 | −22 → −39 | **−1.5 ± 0.5** (p < 0.01) | |
| Patagonia | −26 | −22 → −31 | **−0.7 ± 0.2** (p < 0.01) | |

- **Sea level:** all ice together contributes ≈ 35 mm of global sea-level rise since 2002.

**Verdict:**
- **Robust:** the rates and the regional contrasts.
- **Acceleration depends on the region:**
  - The mountain glaciers and the Amundsen Sea sector are accelerating.
  - Greenland's loss slowed after the 2012 record melt (cooler, snowier summers, except 2019).
  - Antarctica as a whole shows no significant acceleration in 24 years.
  - This is a lesson on record length versus weather noise.

## Files
- `ice_loss_by_region.png`, `stats.json`, `regional_ice_mass_gt.csv`.
