# Task 27 — River basins in Budyko space (GLDAS) — ⚠ ARTEFACT-AFFECTED

**What was done:** 188 HydroBASINS level-3 basins (> 60,000 km²); aridity index PET/P, evaporative index ET/P, runoff ratio R/P for 2001–2012 vs 2013–2025 (GLDAS-2.1); arrows in `budyko_arrows.png`, map `map_runoff_ratio_change.png`.

**Raw result:** runoff ratio significantly *down* in 59 basins, *up* in 10.

**Why it is not trustworthy as is:** the biggest movers (Quebec–Labrador AI 1.0 → 1.7, ET 0.67 → 1.20 mm/day) are driven by a GLDAS-2.1 PET/ET drift with flat temperature and radiation (see task 20 caveat). The *rain* decline in those basins is real (GLDAS, IMERG and GPCP agree: Quebec −10 %, N Australia −16 %, Zambia −22 %), but how it splits between ET and runoff is not.

**Re-check:** basin runoff ratios recomputed with MERRA-2 land (`basins_runoff_ratio_MERRA2.csv`, task 20c) — only basins where both models agree should be quoted.

## MERRA-2 re-check (task 20c, `basins_runoff_ratio_MERRA2.csv`) — **models disagree**
| | runoff ratio significantly down | significantly up |
|---|---|---|
| GLDAS-2.1 | 59 basins | 10 basins |
| MERRA-2 | 8 basins | **65 basins** |
| both models, same sign (down) | 5 basins | — |
Change patterns correlate at r = 0.20 only. **Verdict: no robust basin-scale runoff-ratio trend; the split of rain into evaporation vs river flow is model-dependent.** Teaching case: two respected NASA models give opposite answers — a trend tool should show model spread.
