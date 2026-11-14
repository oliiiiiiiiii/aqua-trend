# Task 60: Where the land sinks — tide gauges minus satellite altimetry (1993–2025)

**Data and method**
- **Principle:** a tide gauge measures sea level relative to the land it stands on; an altimeter measures it relative to Earth's centre. Gauge − altimetry = −(vertical land motion, VLM).
- **Data:**
  - PSMSL RLR monthly tide gauges.
  - NASA-SSH simple-gridded altimetry v1.1 (0.5°, weekly → monthly; cached in `data/processed/nasassh_monthly_1993_2025.npz`).
- **Gauge selection:** ≥15 years in 1993–2025 with ≥60% coverage, matched to the nearest altimetry cell within 1.5° that has ≥80% valid months.
- **Model:** the deseasonalised difference series is fitted with OLS. Errors are AR(1)-corrected, plus a step term for gauges near the great earthquakes:
  - Sumatra 2004.
  - Chile 2010.
  - Tohoku 2011.
  - Kaikoura 2016.
- **QC and testing:** the 5% noisiest residuals are dropped (36 gauges). FDR q = 0.10.

## Results (682 gauges)
- **Overall:** **230 sinking and 184 rising significantly**; median VLM −0.09 mm/yr.
- **Sinking (mm/yr):**

| gauge | VLM | likely cause |
|---|---|---|
| Miyake-jima (Japan) | −28 | volcanic deflation after the 2000 eruption |
| Kushimoto, Uragami, Muroto | −13 to −15 | Nankai interseismic subsidence; possibly Kuroshio path effects |
| **Manila** | **−8.6 ± 0.6** | groundwater pumping |
| Ko Taphao Noi (Phuket) | −8.5 | after the Sumatra 2004 earthquake |
| Pago Pago −7.3, Apia −6.2 | | after the Samoa 2009 earthquake |
| Venice | −5.8 | subsidence |
| Galveston | −4.0 | oil and groundwater pumping |
| Bangkok (Fort Phrachula) | −3.6 | groundwater pumping |

- **Rising (mm/yr):**
  - Southeast Alaska glacial-isostatic rebound: Skagway +21.5, Elfin Cove +21, Yakutat +17, Juneau +15.5.
  - Stockholm +5.3, from rebound after the ice age.
  - Onahama +12.6, post-seismic rebound.
- **Earthquake steps (coseismic drops):** Onahama −365 mm, Kamaishi −402 mm, Miyako, Soma (−660 mm; the gauge was destroyed by the tsunami, so a datum change is possible).
- **Taiwan:** the PSMSL RLR records for Keelung and Kaohsiung end in 1995 and 1989, so neither can be analysed.

**Caveats:**
- A few mm/yr of coastal-altimetry error is possible in shallow tidal seas. UK North Sea and Irish Sea gauges (Whitby, Cromer, Newport, Liverpool, about −5 mm/yr) exceed glacial-isostatic predictions of about −1 mm/yr.
- VLM is measured in the altimetry reference frame.

**Verdict:** robust as a global pattern. The physically known signals all appear with the right sign and size: glacial rebound, groundwater subsidence and earthquake cycles. Single values need GNSS confirmation.

## Files
- `land_sinking_map.png`, `stats.json`, `vertical_land_motion.csv` (after QC), `vertical_land_motion_all.csv`.
