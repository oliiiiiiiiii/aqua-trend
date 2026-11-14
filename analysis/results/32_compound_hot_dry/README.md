# Task 32 — Compound hot-and-dry months

**Question.** How often are soils parched *and* the land hot in the same month, and is that becoming more common?

**Method.**
- Per pixel and calendar month, over the 2001–2025 base period:
  - hot = temperature above its 90th percentile;
  - dry = root-zone soil moisture below its 10th percentile;
  - compound = both in the same month.
- No detrending: the question is the frequency now vs then.
- Two land models: A = MERRA-2 (TSURF, GWETROOT); B = GLDAS-2.1 Noah (Tair, RootMoist).
- Hyper-arid pixels whose soil moisture never varies are dropped (the lowest 5% of variability).
- Per-pixel Mann-Kendall on annual counts with FDR; difference between 2014–25 and 2001–12.
- Global series: area-weighted % of land in a compound state each month.

**Results.**
- **2024 is the record year in both models:** 8.9% (A) and 8.0% (B) of land per month. Previous records: 6.1% (2002) and 5.4% (2019).
- The two global monthly series agree at r = 0.63.
- Top months, MERRA-2: 2002-07, 2023-10, 2023-09, 2024-09, 2024-05, 2024-02. Top months, GLDAS: 2024-09, 2024-08, 2016-02, 2015-09, 2019-03, 2015-10.
- 2023–25 event: most compound months in Cameroon (7.0), Brazil (6.4), Venezuela (5.8), Bolivia (5.5), Peru (5.2), Zimbabwe (4.9), Mexico (4.8), Zambia (4.5).
- GRACE check:
  - Mexico, Oct 2023: −15.4 cm, the lowest of all 259 months.
  - Amazon, Sep 2024: −16.6 cm, 3rd lowest (2016: −20.4).
  - Zambia–Zimbabwe, Jan 2025: −11.4 cm, 7th lowest.
- **Trend (not robust):**
  - Hot months: 1.12 → 1.80 per year (A), 0.91 → 2.00 (B).
  - Dry months: **1.61 → 1.28 (A) vs 1.04 → 1.85 (B)**, opposite signs.
  - Compound share of land: A 3.7 → 4.6% (p = 0.51); B 1.0 → 4.2% (p = 0.0004).
  - Pattern r of the change maps = 0.33.
  - No pixel passes FDR: counts are mostly 0 or 1 per year.

**Caveats.**
- These are land models, not observations; GRACE is the observational check.
- GLDAS's soil drying is likely affected by its PET/forcing drift (see `data-pitfalls` and task 20c).
- TSURF is skin temperature and Tair is 2 m air temperature.

**Files.**
- Figures: `map_2023_25_compound_event.png`, `calendar_compound_hot_dry.png`, `map_compound_hot_dry_change.png`, `map_hot_change.png`, `map_dry_change.png`.
- Data: `global_compound_area_pct.csv`, `countries_2023_25_compound_months.csv`, `stats.json`.
