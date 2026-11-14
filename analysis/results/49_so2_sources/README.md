# Task 49: SO₂ point sources from space, 2005–2025 (780 sources, four satellites)

**Data and method**
- **Data:** NASA MEaSUREs MSAQSO2L4 v2, the SO₂ emissions catalogue of Fioletov et al. It gives annual kt/yr for 780 sources: 493 power plants, 104 oil & gas, 75 smelters and 108 volcanoes.
- **Satellites:** each source has independent estimates from OMI (2005–), OMPS-NPP (2012–), TROPOMI (2018–) and OMPS-NOAA20 (2018–). The "Catalogue" group merges them.
- **Anthropogenic** means all non-volcanic sources.
- **Trends:**
  - Theil–Sen slope of log emissions, with Mann–Kendall p.
  - Region totals use the Hamed–Rao autocorrelation-corrected Mann–Kendall. AR(1)-OLS is unusable here: curved declines leave residuals with r₁ ≈ 1.
  - FDR q = 0.10 across sources.

## Results
| region | 2005–07 (kt/yr) | 2023–25 | change | Sen %/yr | p (Hamed–Rao) |
|---|---|---|---|---|---|
| China | 26,118 | 2,169 | **−92%** | −13.9 | <1e-6 |
| USA | 4,975 | 383 | **−92%** | −13.3 | 2e-4 |
| Europe & Turkey | 5,910 | 1,861 | −69% | −5.8 | 1e-5 |
| Russia | 4,069 | 2,874 | −29% | −1.7 | 0.006 |
| India | 3,158 | 6,424 | **+103%** | +3.8 | 5e-8 |
| Middle East | 7,962 | 8,645 | +9% | +0.4 | 0.12 (n.s.) |
| all anthropogenic | 65,331 | 31,351 | −52% | −4.3 | 1e-4 |
| volcanoes | 20,610 | 14,885 | −28% | −2.3 | 0.04 |

- **Crossovers:** India has emitted more than China since 2017, and the Middle East has led all the named regions since 2016. China's share of the global total fell from 38% (2005) to 7%; India now has 19%.
- **Sources:** of 672 industrial sources, 314 fell significantly and 136 rose. The sources that fell held 77% of 2005 emissions.
- **Largest risers:** Iranian gas fields (Tonbak, Zagros), Turkmenistan (Mary), and Indian coal hubs (Neyveli, Vindhyachal, Tamnar, Korba).
- **Largest fallers:** dozens of Chinese plants and smelters (>95% cuts), Norilsk (−37%) and Khark Island.
- **Four satellites agree on the 2018–25 trends (%/yr):**
  - China: −6.7 to −8.4.
  - India: +1.7 to +5.1.
  - USA: mostly falling (−3.8 to −8.6; OMPS-NOAA20 +0.5).
- **East Asia:**
  - Taiwan (Linhai, Kaohsiung): 60 → 13 kt/yr.
  - South Korea: 122 → 107.
  - Japan: 113 → 54.
  - Vietnam: 42 → 192.

**Verdict:** robust. Independent instruments agree, and the effect is large (×12 in China).

## Files
- `so2_sources_map.png`, `stats.json`, `so2_by_region_kt.csv`, `sources_trends.csv`.
