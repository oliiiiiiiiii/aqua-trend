# Plain-language glossary (for the tool's audience: high-school / college students, curious public)

## Variables

| Variable | What it measures (one sentence) | Unit | Instrument / dataset | Why it trends |
|---|---|---|---|---|
| **Terrestrial water storage (TWS)** | All the water stored on and under the land — groundwater, soil moisture, snow, ice, lakes — "weighed" by measuring tiny changes in Earth's gravity. | cm of water (as if spread in a layer) | GRACE / GRACE-FO twin satellites | groundwater pumping, drought, glacier melt, wetter climates |
| **Precipitation** | How much rain and snow falls. | mm per day | GPCP (satellites + rain gauges), GPM IMERG | shifting storm tracks, monsoon changes, warming |
| **Sea surface temperature (SST)** | Temperature of the top layer of the ocean. | °C | NOAA OISST (AVHRR satellites + ships/buoys), MODIS | global warming, ocean currents (e.g. Kuroshio) |
| **Marine heatwave (MHW)** | A period of ≥5 days when the sea is hotter than 90 % of past years on that date. | days per year | derived from daily OISST | ocean warming; harms corals, fisheries |
| **Chlorophyll-a** | Green pigment of microscopic ocean plants (phytoplankton) — the base of the marine food web. | mg per m³ | MODIS-Aqua ocean colour | ocean warming & stratification, nutrient runoff |
| **Sea level anomaly** | Height of the sea surface compared with a long-term average. | mm | TOPEX/Jason/Sentinel-6 radar altimeters (NASA-SSH) | melting ice + warming water expands |
| **Sea-ice extent** | Ocean area with at least 15 % ice cover. | million km² | passive-microwave satellites (NSIDC Sea Ice Index) | warming air and ocean |
| **NDVI (vegetation index)** | How green and dense plants are, from the difference between red and near-infrared light reflected by leaves (−1…1; forests ≈ 0.8, desert ≈ 0.1). | unitless | MODIS Terra | farming, tree planting, deforestation, drought, CO₂ fertilisation |
| **Land surface temperature (LST)** | How hot the ground surface itself is (can be much hotter than the air on a sunny day). | °C | MODIS Terra thermal infrared | urbanisation, deforestation, warming, drying soils |
| **NO₂ column** | Amount of nitrogen dioxide gas (from car exhausts, power plants, industry) in the air column above a place. | molecules per cm² | OMI (Aura), TROPOMI | emission controls, economic growth, COVID lockdowns |
| **Aerosol optical depth (AOD)** | How hazy the air is — how much sunlight is blocked by particles (smoke, dust, pollution). | unitless (0 = crystal clear, >1 = very hazy) | MODIS, MERRA-2 | pollution controls, fires, dust storms |

## Statistics words

| Term | Plain meaning |
|---|---|
| **Trend** | The average rate of change over time, e.g. "−3 cm per year". |
| **Seasonal cycle / deseasonalising** | Most variables go up and down every year (summer/winter). We remove that repeating pattern so it doesn't hide or fake a trend. |
| **Anomaly** | The difference from what is normal for that month. |
| **Significant** | The trend is very unlikely (less than 5 % chance) to appear just from random ups and downs. |
| **p-value** | The chance of seeing a trend at least this strong if there were really no trend. Small p (< 0.05) → significant. |
| **Mann-Kendall test** | Counts how often later values are higher than earlier ones; doesn't assume a straight line or bell-curve noise. |
| **Sen's slope** | The median of all pairwise slopes — a trend estimate that is not thrown off by a few extreme years. |
| **t-test on the slope / confidence interval** | Range in which the true trend probably lies (95 % CI). If it doesn't include zero → significant. |
| **Autocorrelation** | Neighbouring months are similar to each other, so the data contain fewer *independent* points than it seems. Ignoring this makes naive tests far too confident (in our test: 35 % false alarms instead of 5 %). |
| **Change point** | A moment when a series suddenly jumps or switches direction (e.g. Antarctic sea ice in 2016). |
| **Field significance / FDR** | When testing thousands of map pixels, some will look significant by luck; the false-discovery-rate correction keeps those false alarms under control. |
| **Years to detect** | How many years of data a trend of this size needs before it becomes reliably significant, given how noisy the data are. |

## Hydrology terms (water-cycle analyses, tasks 20–23)

| Term | Plain meaning |
|---|---|
| **Evapotranspiration (ET)** | All water going from land to air: evaporation from soil and water + "transpiration" (plants breathing out water through leaves). |
| **Potential ET (PET)** | How much water *would* evaporate if water were unlimited — set by sunshine, heat, wind and dry air. |
| **Water-limited vs energy-limited** | In dry places ET is limited by how much water is available (more rain → more ET). In wet places ET is limited by energy (more sunshine → more ET). |
| **Ecosystem Limitation Index (ELI)** | corr(ET, soil moisture) − corr(ET, radiation): positive = water-limited, negative = energy-limited. |
| **VPD (vapour pressure deficit)** | How "thirsty" the air is — the gap between how much water vapour the air could hold and how much it holds. |
| **P − E** | Precipitation minus evaporation: positive = the place receives more water from the sky than it gives back (a destination); negative = a source of atmospheric moisture. |
| **Moisture flux / transport** | The flow of invisible water vapour carried by winds through the atmosphere ("rivers in the sky"), in kg per metre per second. |
| **Recycling ratio** | Share of a region's rain that comes from evaporation inside the same region (rather than moisture blown in from outside). |
| **Water budget** | Storage change = rain − evaporation − runoff (− what people pump or divert). If the satellite-observed storage change doesn't match, the gap is usually human water use. |
| **Groundwater (from GRACE)** | GRACE's total water minus the soil moisture and snow simulated by a land model — what's left is mostly aquifers, lakes and glaciers. |
| **Instrument drift** | A slow change in the satellite or sensor (e.g. orbit timing) that creates a fake trend. |
