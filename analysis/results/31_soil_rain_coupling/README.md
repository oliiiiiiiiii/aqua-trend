# Task 31 — Does wet soil make its own rain? (null result)

**Question.** Does this month's soil moisture predict next month's rain, beyond what rain persistence and ENSO already explain? This would be the land–atmosphere feedback found in model studies (Koster et al. 2004 "hotspots").

**Method.**
- Data: monthly anomalies 2001–2025, deseasonalised and detrended.
- Statistic: partial r(SM_t, P_t+1 | P_t, P_t−1, Niño3.4_t).
- Season: warm season only (NH May–Aug, SH Nov–Feb; all months within 10° of the equator).
- Significance: Bretherton n_eff from the residuals, FDR q = 0.10.
- Dataset pairs: A = MERRA-2 GWETTOP + IMERG, B = GLDAS SM 0–10 cm + IMERG, C = MERRA-2 + GPCP.
- Placebo: the same statistic using rain in the same season one year later, which one month's soil cannot cause.

**Results.**
- Significant positive coupling: A 0.2%, B 0.3%, C 0.2% of land. Negative is similar.
- |r| > 0.2 on 7.2% (A) of land vs placebo 8.1%. The real test is no better than the placebo.
- Pattern agreement: A vs B r = 0.40, A vs C r = 0.75. The second is high because it shares the soil-moisture field.
- No robust hotspots.

**Interpretation.** At monthly resolution, soil-moisture feedback on rain cannot be distinguished from noise. Any feedback acts on daily timescales, or it is too weak against large-scale weather. Keep this as an honest negative.

**Files.** `map_soil_makes_rain.png`, `map_placebo.png`, `stats.json`, `coupling.nc` (local only).
