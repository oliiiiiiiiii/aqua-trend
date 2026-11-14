# Task 35 — Where is land water at a record low (or high) right now?

**Method.**
- Data: GRACE/GRACE-FO TWS with the seasonal cycle removed, as a 12-month running mean (at least 9 valid months).
- Per pixel: the timing of the lowest and highest value over 2003-02-01 – 2026-09-01.
- "Record now" means the extreme falls within the last 36 months. By chance under stationarity that happens 14.6% of the time.
- Ice sheets are excluded.

**Results.**
- Record low now: 31.6% of land area. Record high now: 23.2%.
- Countries most at record low: Syria 100%, Romania 100%, Tunisia 100%, Kyrgyzstan 100%, Poland 100%, Iran 94%, Saudi Arabia 94%, Afghanistan 93%, Sweden 93%, Iraq 88%.
- Countries most at record high: Burkina Faso 100%, Ghana 100%, Senegal 100%, Ethiopia 100%, Somaliland 100%, Uganda 100%, S. Sudan 97%, Tanzania 97%.

Share of land by year of its minimum and maximum:

| Year | Lowest storage | Highest storage |
|---|---|---|
| 2003 | 9.8% | 9.2% |
| 2004 | 3.3% | 6.5% |
| 2005 | 3.9% | 8.3% |
| 2006 | 3.6% | 6.3% |
| 2007 | 2.3% | 3.1% |
| 2008 | 2.8% | 2.1% |
| 2009 | 2.3% | 1.8% |
| 2010 | 3.8% | 1.6% |
| 2011 | 2.9% | 5.5% |
| 2012 | 3.6% | 4.3% |
| 2013 | 4.5% | 1.2% |
| 2014 | 1.8% | 2.0% |
| 2015 | 1.8% | 2.9% |
| 2016 | 5.8% | 2.1% |
| 2017 | 1.8% | 3.2% |
| 2018 | 0.0% | 0.0% |
| 2019 | 1.8% | 2.9% |
| 2020 | 4.2% | 5.1% |
| 2021 | 1.8% | 2.0% |
| 2022 | 4.2% | 3.9% |
| 2023 | 3.7% | 3.7% |
| 2024 | 5.3% | 5.8% |
| 2025 | 5.4% | 9.2% |
| 2026 | 19.6% | 7.2% |

**Caveats.**
- Records cluster at the end of the series wherever a trend exists, so this complements the trend maps (task 01) rather than replacing them.
- The GRACE→GRACE-FO gap (Jul 2017 – May 2018) is left empty.
- Recent months are subject to reprocessing.

**Files.**
- Figures: `map_record_low_high_now.png`, `map_year_of_lowest_storage.png`.
- Data: `countries_record_now.csv`, `stats.json`, `records.nc` (local only).
