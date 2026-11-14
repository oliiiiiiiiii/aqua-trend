# Task 55: The world's lakes from space, 2009–2025

**Data and method**
- **Data:** NASA GWM satellite radar altimetry, about 520 lakes and reservoirs, 10-day, Jason-2 → Jason-3 → Sentinel-6A.
- **Processing:**
  - Frozen-surface flags are dropped. Values become monthly medians, then annual means (≥6 months per year).
  - Lakes need ≥14 of the 17 years in 2009–2025.
- **Exclusions:** targets whose GWM advisory flags a mission-merger problem inside the window (J2/J3, J3/S6a) or a change of reference mission, plus ephemeral lakes.
- **Trend:** Theil–Sen (m/decade) + Hamed–Rao modified Mann–Kendall, FDR q = 0.10.
- **"Dam-regulated"** means the GWM advisory "Regulated water levels". GWM's own "Reservoir" type also covers any indirect human influence, so it is not used.
- **Caspian cross-check:** GRACE mass over a box around the Caspian.

## Results
- **332 usable lakes:** 53 falling and 46 rising significantly.
  - Dam-regulated (184): 24 falling, 26 rising.
  - Natural or indirectly affected (148): 29 falling, 20 rising.
- **Caspian Sea:** −1.16 m/decade (p = 2e-4), about 2 m lower than in 2009.
  - GRACE over the basin box gives −57 cm/decade (p = 1e-4).
  - Annual altimetry vs GRACE: r = 0.999. Two independent physical measurements agree, which confirms FINDINGS #6 (Caspian shrinking).
- **Other falling lakes (m/decade):** Aral remnants (Aral 2: −5.6), Urmia −0.5, Issyk-Kul −0.5, Salton Sea −2.2, Lake Enriquillo −4.3.
- **Falling reservoirs (m/decade):** Kariba −5.3 (hydropower crisis in the 2019 and 2023–24 droughts), Falcon (Mexico–USA) −7.1, Kajakai (Afghanistan) −3.6, Piedra del Águila −3.8.
- **Rising lakes (m/decade):** East African lakes (task 54: Turkana +3.5, Tanganyika +1.7, Kyoga +1.5, Victoria +1.3), Lake Chad +0.33, Migriggyangzham Co (Tibet) +4.9.
- **Rising reservoirs:** Nasser +4.5 m/decade, still filling despite Ethiopia's GERD. The largest rises are new dams being impounded: Xekaman I (Laos), Jinping I and Huangdeng (China).

**Verdict:**
- **Robust:** the Caspian decline (two methods), the East African rise, and the drought-driven reservoir losses.
- **Not a climate signal:** individual reservoir trends mostly reflect operations and new dams.

## Files
- `world_lakes_trends.png`, `stats.json`, `lake_trends_2009_2025.csv`.
