# Task 23 — Water moved by people: source vs destination basins (GRACE/GRACE-FO + HydroBASINS)

**Method:** HydroBASINS level-4 polygons (picked by a point) rasterised to the 0.5° GRACE grid; basin-mean water-storage anomalies; OLS+AR(1)/MK trends before vs after a key event; GPCP rain change between the two periods as a climate check. Volumes = trend × basin area.

| Transfer | Source basin: before → after (cm/yr) | Destination basin: before → after (cm/yr) | Rain change after (src / dst) | Reading |
|---|---|---|---|---|
| **Nile – GERD** (first filling Jul 2020) | Blue Nile, Ethiopia: +0.65 (p=1e-8) → **+2.33** (p=0.009) ≈ **+7.2 km³/yr** | Egypt / Lake Nasser: +0.04 → +0.25 (p=0.08) | −2 % / +40 % (desert) | **Reservoir filling visible from space**; ≈ 40 km³ stored since 2020 with no extra rain ✔ |
| **China South-to-North** (middle route Dec 2014) | Han River: +0.13 → +0.58 (both n.s.) | Hai basin: **−1.62** (2002–14, p=7e-5) → **−1.05** (2015–20, p=0.008) → **+2.58** (2021–26, p=0.08) | +9 % / +24 % (Hai rain 1.43 → 1.63 → 2.01 mm/day) | Decline **slowed by a third** once diverted water arrived (2015–20, rain only +14 %); full recovery only with the very wet 2021–26 years + aquifer replenishment → task 21 |
| **Indus** (2010 flood as split) | Upper Indus/Karakoram: +0.09 → **−2.22** (p=4e-6) | Punjab plains: **−2.06 → −2.68** (p=3e-11) ≈ −7.8 km³/yr | +3 % / +16 % | Punjab depletion *accelerated* despite wetter years → pumping; headwaters now losing ice/snow |
| **Amu Darya → Aral** | Pamir headwaters: +0.39 → **−2.07** (p=0.001) after 2008 | Aral basin: −0.32 → −0.41 (p=3e-4) | +1 % / +30 % | headwater (glacier/snow) losses; Aral keeps drying |
| **Colorado** | Upper Colorado: +0.00 → −2.17 (n.s., short) | Lower Colorado/S. Calif: −0.69 (p=0.006) → −1.41 (n.s.) | +14 % / +5 % | steady downstream loss; post-2022 too short |

**Bug fixed (Nov 14):** a first version averaged basins with a NaN-unsafe sum, turning missing GRACE months into zeros; numbers above are from the corrected run (`min_count=1`, NaN-aware weights).

**Figures:** `transfer_nile.png` (hero), `transfer_snwd.png`, `transfer_indus.png`, `transfer_aral.png`, `transfer_colorado.png`; series CSVs per pair.

**Caveats:** GRACE footprint ~300 km — basins < ~150,000 km² are smoothed by neighbours (Upper Indus, Colorado sub-basins). Storage change in a basin mixes natural variability, reservoirs and pumping; rain change is a first-order check only — task 21 does the full budget (P − ET − runoff).

## Independent check of the GERD gain (task 23b, `gerd_ndvi_before_after.png`)
MODIS dry-season NDVI (Jan–Apr, 0.1°): 7 cells along the Blue Nile upstream of the dam turn from vegetation to water. Their NDVI tracks the surrounding land until 2021 (0.27 vs 0.28 on average), then 0.232 vs 0.292 (2022), 0.223 vs 0.300 (2023), 0.174 vs 0.307 (2024), **0.106 vs 0.303 (2025)** — matching the successive fillings. Two independent NASA sensors (gravity and optical) agree.
(SWOT LakeSP was tried first: GERD is absent from SWOT's prior lake database and the checked passes missed the main reservoir body.)
