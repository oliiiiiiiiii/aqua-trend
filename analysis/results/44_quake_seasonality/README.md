# Task 44: Does the seasonal water load modulate earthquakes? (null result)

**Idea:** water piles up on land in the wet season and drains away in the dry season. The changing load stresses the crust. Published studies report seasonal earthquake modulation in the Himalaya (Bettinelli et al. 2008), California (Johnson et al. 2017) and NE Japan (snow load; Heki 2003).

**Method**
- USGS ComCat catalogues, Gardner–Knopoff declustered, above the regional completeness magnitude.
- Schuster test for an annual cycle in event times.
- Robustness: the same test on odd and even years separately.
- Each region is compared with its GRACE seasonal water-load cycle.
- Spatial test: Schuster p for each 1° cell (≥50 mainshocks) in California and Japan, with FDR.

## Results
| region | mainshocks | Schuster p | peak month, modulation | GRACE load max / min |
|---|---|---|---|---|
| California M≥2.5 (1984–2025) | 17,165 | 0.96 | (Jan, ±0.3%) | Apr / Oct |
| Japan M≥4 (1990–2025) | 6,179 | 0.31 | (Aug, ±3%) | Dec / Jun |
| Himalaya M≥4.5 (1973–2025) | 434 | 0.14 | (Jan, ±13%) | Sep / May |
| Taiwan M≥4 (1990–2025) | 736 | 0.83 | (Dec, ±3%) | Jun / Jan |

- No 1° cell in California (63 tested) or Japan (44 tested) passes FDR.
- The odd-year and even-year phases disagree by 60–180°.
- The Himalayan winter peak points the same way as Bettinelli et al., but it is not significant with 434 USGS events.

**Verdict:** **Null**. Hydrological stress (~1 kPa) is too small to detect in regional catalogues of M≥2.5–4.5. The published signals use complete local catalogues reaching much smaller magnitudes, or stress modelling that targets particular faults.

## Files
- `seasonal_quakes_vs_water_load.png`, `map_seasonal_cells.png`, `seasonality_by_region.csv`, `stats.json`.
