# Task 46: Is the Antarctic ozone hole healing?

**Data:** NASA Ozone Watch daily Antarctic ozone-hole area (where ozone is below 220 DU) and minimum ozone, from TOMS, OMI and OMPS, 1979–2026. There are no data for 1995.

**Method**
- Annual metrics: mean area over 7 Sep – 13 Oct, and mean minimum ozone over 21 Sep – 16 Oct.
- Hinged (two-segment) fit against a straight line, with the hinge searched over 1985–2010 and an F-test.
- Trend since 2001 with AR(1)-OLS and Mann–Kendall.
- Sensitivity: the same trend excluding 2020–23. Those years had an unusually persistent vortex, the Hunga Tonga eruption's water vapour and Australian fire smoke.

## Results
- **The growth stopped:**
  - Hole area: hinge at **1993**; it grew +17 million km²/decade before. The hinged fit beats a straight line at p = 4e-10.
  - Minimum ozone: hinge at **1992**, p = 4e-11.
- **The decline is not yet significant:**
  - Since 2001, area changed −0.46 million km²/decade (p = 0.68), or −1.16 without 2020–23 (p = 0.38).
  - Minimum ozone changed +2.8 DU/decade (p = 0.54), or +7.5 without 2020–23 (p = 0.14).
- Mean area was 22.6 million km² in 2000–06 and 21.6 in 2021–25. The 2026 hole is 24.9 million km², one of the larger recent ones.

**Verdict.**
- **Robust:** the hole stopped growing in the 1990s, consistent with the Montreal Protocol.
- **Suggestive:** healing. Year-to-year meteorology still masks it, and published detections use the September-only onset and chemistry-aware attribution.

## Files
- `ozone_hole_hinge.png`, `ozone_hole_annual.csv`, `stats.json`.
