# Task 07b — Daytime land surface temperature (MODIS Terra MOD11C3), 2000-02 → 2026-10 — ⚠ ARTEFACT CASE

**Headline (2000–2026):** apparent significant daytime *cooling* of −0.7 … −0.9 °C/decade over the Indo-Gangetic Plain, Sahel, Delhi, Loess Plateau, Inner Mongolia (p ≈ 4e-5).

**But:** for **2000–2019** none of these is significant (IGP −0.14, p=0.55; Sahel −0.13, p=0.43; Delhi +0.06; Loess −0.28, p=0.25). The "cooling" appears only when 2020–2026 are included — when **Terra's orbit drifted** to an earlier equator-crossing time (≈10:30 → ≈9:30 local), so the satellite sees the ground earlier and cooler in the morning.

**Verdict:** instrument artefact, *not* a climate signal. Only 8 % of land is significant at all (33 % of it warming).

**Teaching value (great demo for the tool):** a trend can be statistically significant and still be wrong. Always ask "did the instrument change?" (orbit drift, sensor swap, algorithm version). Do not use MODIS-Terra daytime LST after 2019 for trends; use Aqua (stable to ~2022), night-time LST, or reanalysis air temperature instead.
