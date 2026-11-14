"""Reviewed physical quantities and approved series-2 layer mappings (November 2026)."""

REFERENCES = {
    "imerg": ("NASA GPM · IMERG", "https://gpm.nasa.gov/data/imerg", "Multi-satellite estimates of precipitation."),
    "gpcp": ("NOAA NCEI · GPCP monthly precipitation", "https://www.ncei.noaa.gov/products/climate-data-records/precipitation-gpcp-monthly", "Satellite and gauge precipitation estimates on a 2.5-degree grid for version 2.3."),
    "merra": ("NASA GMAO · MERRA-2", "https://gmao.gsfc.nasa.gov/gmao-products/merra-2/", "Reanalysis estimates combine an atmospheric model with assimilated observations."),
    "gldas": ("NASA LDAS · GLDAS model output", "https://ldas.gsfc.nasa.gov/index.php/gldas/model-output", "Noah models water and energy stores and fluxes. Its atmospheric forcing variables describe near-surface conditions."),
    "grace": ("NASA JPL · GRACE and GRACE-FO mascons", "https://grace.jpl.nasa.gov/data/get-data/jpl_global_mascons/", "Monthly gravity variations estimate changes in mass. The JPL solution has approximately 3-degree independent spatial support."),
    "ndvi": ("NASA · MODIS vegetation indices", "https://www.earthdata.nasa.gov/s3fs-public/2025-04/MOD13_User_Guide_V5.pdf", "A red and near-infrared reflectance index describes vegetation greenness."),
    "lst": ("NASA Earth Observatory · Land surface temperature", "https://science.nasa.gov/earth/earth-observatory/global-maps/land-surface-temperature/", "Thermal infrared measurements describe the temperature of the visible land surface."),
    "oisst": ("NOAA NCEI · Optimum Interpolation Sea Surface Temperature", "https://www.ncei.noaa.gov/products/optimum-interpolation-sst", "OISST combines in-situ and remotely sensed surface temperature observations."),
    "drought": ("NOAA NIDIS · Monitoring drought", "https://www.drought.gov/what-is-drought/monitoring-drought", "Rainfall, soil moisture, streamflow and water storage reflect different aspects of drought."),
    "soil-drought": ("NOAA NIDIS · Soil moisture and drought", "https://www.drought.gov/what-is-drought/soil-moisture-and-drought", "Root-zone moisture tracks water available to vegetation and can reflect agricultural drought."),
    "flood": ("USGS · Floods and recurrence intervals", "https://www.usgs.gov/water-science-school/science/floods-and-recurrence-intervals", "Rainfall and rapid snowmelt can contribute to high streamflow and flooding."),
    "marine-heat": ("Hobday et al. · A hierarchical approach to defining marine heatwaves", "https://doi.org/10.1016/j.pocean.2015.12.014", "Identification of individual marine heatwaves requires daily temperature exceedances."),
    "spi": ("NCAR · Standardized Precipitation Index", "https://www.ncl.ucar.edu/Document/Functions/Built-in/dim_spi_n.shtml", "SPI compares precipitation accumulated over a fixed time scale with its historical distribution."),
    "spi-handbook": ("WMO · Standardized Precipitation Index User Guide", "https://digitalcommons.unl.edu/droughtfacpub/209/", "Negative SPI episodes reaching −1 delineate meteorological drought spells."),
    "seasonal": ("WMO · Climatological normals", "https://wmo.int/wmo-climatological-normals", "Monthly averages over a named fixed reference period provide a consistent basis for anomaly comparison."),
}

# A source may have observations on a finer grid than the prepared regional mean.
# Version is the upstream identifier only when the prepared source actually names it.
PRODUCT_FAMILIES = {
    "imerg": ("NASA GPM / GES DISC", "IMERG", None, "0.1°", "Satellite and gauge precipitation estimate"),
    "gpcp": ("GPCP / NOAA", "GPCP", "2.3", "2.5°", "Satellite and gauge precipitation estimate"),
    "merra": ("NASA GMAO / GES DISC", "MERRA-2", "MERRA-2", "0.5° × 0.625°", "Atmospheric reanalysis"),
    "gldas": ("NASA GSFC / GES DISC", "GLDAS Noah", "2.1", "0.25°", "Land surface model and forcing"),
    "grace": ("NASA JPL", "GRACE / GRACE-FO JPL mascons", None, "Approximately 3°", "Satellite gravity inversion"),
    "ndvi": ("NASA MODIS / LP DAAC", "MODIS", None, "0.05° input to regional preparation", "Satellite optical reflectance"),
    "lst": ("NASA Terra MODIS / LP DAAC", "Terra MODIS", None, "Input grid not documented in release", "Satellite thermal infrared retrieval"),
    "oisst": ("NOAA NCEI", "OISST", "2.1", "0.25°", "Observation-based interpolated analysis"),
}
PRODUCTS = {
    "p_imerg": ("imerg", "IMERG monthly precipitation"),
    "p_gpcp": ("gpcp", "GPCP monthly precipitation v2.3"),
    "p_m2": ("merra", "MERRA-2 PRECTOTCORR"),
    "p_m2land": ("merra", "MERRA-2 PRECTOTLAND"),
    "et_m2": ("merra", "MERRA-2 EVAP"),
    "et_m2land": ("merra", "MERRA-2 EVLAND"),
    "et_gldas": ("gldas", "GLDAS Noah evapotranspiration"),
    "sm_root": ("gldas", "GLDAS Noah root-zone water"),
    "sm_m2": ("merra", "MERRA-2 GWETROOT"),
    "sm_total": ("gldas", "GLDAS Noah 0–2 m soil water"),
    "g1_soil_top": ("gldas", "GLDAS Noah 1° surface soil water"),
    "tws": ("grace", "JPL terrestrial water storage anomaly"),
    "runoff": ("gldas", "GLDAS Noah surface and subsurface runoff"),
    "ro_m2": ("merra", "MERRA-2 RUNOFF + BASEFLOW"),
    "swe": ("gldas", "GLDAS Noah snow water equivalent"),
    "tair": ("gldas", "GLDAS near-surface air temperature forcing"),
    "tsurf_m2": ("merra", "MERRA-2 TSURF"),
    "lst_day": ("lst", "Terra MODIS daytime land surface temperature"),
    "vpd": ("gldas", "GLDAS forcing-derived vapor pressure deficit"),
    "pet_gldas": ("gldas", "GLDAS Noah potential evapotranspiration"),
    "rn": ("gldas", "GLDAS Noah net surface radiation"),
    "rn_m2": ("merra", "MERRA-2 SWLAND + LWLAND"),
    "swdown": ("gldas", "GLDAS downward shortwave forcing"),
    "wind": ("gldas", "GLDAS near-surface wind forcing"),
    "ndvi": ("ndvi", "MODIS NDVI"),
    "sst": ("oisst", "NOAA OISST v2.1"),
}

LIMITATIONS = {
    "tws": "Coarse gravity signals can include mass changes outside the boundary and non-hydrological signals after major earthquakes.",
    "lst_day": "The prepared release flags Terra orbital drift after 2020. Changes in overpass time can affect daytime temperature trends.",
    "et_gldas": "The prepared release flags possible long-term drift in GLDAS evapotranspiration.",
    "pet_gldas": "The prepared release flags possible long-term drift in GLDAS potential evapotranspiration.",
    "g1_soil_top": "Only source grid cells inside the study boundary are eligible. The legacy export used nearby cells for some small regions.",
}

# Product priority is ordered within a quantity only. Fluxes with land-only
# support are separate from all-surface fluxes, as are modeled vs. daytime skin temperatures.
# id: label, quantity, unit, temporal support, approved products, direct aliases.
CONCEPTS = {
    "precip": ("Precipitation", "Liquid-water-equivalent precipitation reaching the surface per day.", "mm/day", "monthly_mean_rate", ["p_imerg","p_gpcp","p_m2"], ["rainfall","rain","降雨量","降水","降雨","降水量"]),
    "precip_land": ("Land precipitation", "Precipitation rate over the land fraction of the grid.", "mm/day", "monthly_mean_rate", ["p_m2land"], ["land rainfall","陸地降水"]),
    "et": ("Surface evaporation", "Water evaporating or transpiring into the atmosphere across the modeled surface.", "mm/day", "monthly_mean_rate", ["et_m2"], ["evaporation","蒸發","地表蒸發"]),
    "et_land": ("Land evapotranspiration", "Actual evaporation and transpiration from the land surface per day.", "mm/day", "monthly_mean_rate", ["et_m2land","et_gldas"], ["evapotranspiration","actual evapotranspiration","蒸散","蒸發散","蒸散量"]),
    "soil_root": ("Root-zone soil water", "Water stored over the Noah model root zone, expressed as an equivalent water depth.", "mm", "monthly_mean_state", ["sm_root"], ["soil moisture","root-zone soil moisture","土壤水分","根層土壤水","土壤濕度"]),
    "soil_total": ("Soil water at 0–2 m", "Integrated water mass in the modeled upper two metres of soil, expressed as water depth.", "mm", "monthly_mean_state", ["sm_total"], ["soil water storage","深層土壤水","全土層水量"]),
    "soil_top": ("Soil water at 0–10 cm", "Water stored in the upper ten centimetres of modeled soil.", "mm", "monthly_mean_state", ["g1_soil_top"], ["surface soil moisture","topsoil water","表層土壤水"]),
    "soil_wetness": ("Relative root-zone wetness", "Relative wetness of the MERRA-2 root zone on a dimensionless scale.", "fraction", "monthly_mean_state", ["sm_m2"], ["relative soil wetness","根層相對濕度"]),
    "tws": ("Terrestrial water storage anomaly", "Regional mass change from gravity observations expressed as a water-depth anomaly.", "cm", "monthly_mean_anomaly", ["tws"], ["water storage","terrestrial water storage","陸地儲水","總儲水異常"]),
    "runoff": ("Runoff", "Modeled surface runoff and subsurface drainage per unit land area, expressed as a water-depth rate.", "mm/day", "monthly_mean_rate", ["runoff","ro_m2"], ["runoff generation","逕流","徑流"]),
    "swe": ("Snow water equivalent", "Water depth that would result if the modeled snowpack melted.", "mm", "monthly_mean_state", ["swe"], ["snowpack","snow water","snowpack change","積雪","雪水當量"]),
    "tair": ("Near-surface air temperature", "Temperature of the near-surface atmosphere in land-model forcing.", "°C", "monthly_mean_state", ["tair"], ["air temperature","氣溫","近地面氣溫"]),
    "tsurf": ("Land surface temperature", "Modeled temperature at the land surface averaged across the month.", "°C", "monthly_mean_state", ["tsurf_m2"], ["surface skin temperature","陸地表面溫度","地表溫度"]),
    "lst_day": ("Daytime land surface temperature", "Temperature of visible land surfaces sampled during clear daytime satellite overpasses.", "°C", "monthly_daytime_composite", ["lst_day"], ["daytime surface temperature","日間地表溫度"]),
    "vpd": ("Vapor pressure deficit", "Difference between saturation and actual vapor pressure in near-surface air.", "kPa", "monthly_mean_state", ["vpd"], ["vpd","atmospheric drying demand","飽和水氣壓差","蒸氣壓差"]),
    "pet": ("Potential evapotranspiration", "Modeled evaporative demand under assumed water availability.", "mm/day", "monthly_mean_rate", ["pet_gldas"], ["potential evaporation","潛在蒸散"]),
    "rn": ("Net surface radiation", "Net shortwave plus net longwave radiation at the land surface.", "W/m2", "monthly_mean_flux", ["rn","rn_m2"], ["net radiation","淨輻射"]),
    "swdown": ("Downward shortwave radiation", "Incoming solar radiation at the surface.", "W/m2", "monthly_mean_flux", ["swdown"], ["incoming solar radiation","入射日照","向下短波輻射"]),
    "wind": ("Near-surface wind speed", "Speed of near-surface wind in land-model forcing.", "m/s", "monthly_mean_state", ["wind"], ["wind speed","風速"]),
    "ndvi": ("Vegetation greenness", "Normalized difference vegetation index (NDVI) estimated from red and near-infrared surface reflectance.", "NDVI", "monthly_composite", ["ndvi"], ["ndvi","vegetation greening","plant greenness","植生指數","植被綠度","植被變化"]),
    "sst": ("Sea surface temperature", "Temperature of the ocean surface from an observation-based analysis.", "°C", "monthly_mean_state", ["sst"], ["sst","sea temperature","海溫","海表溫度"]),
}

# Each entry is a curated, complete selection plan. New sentences go to a
# configured model; similarity or keyword hits never impersonate a saved plan.
PHENOMENA = {
    "drought": {
        "label": "Drought", "aliases": ["droughts","meteorological drought","乾旱","干旱","氣象乾旱"],
        "recipes": ["spi-3","spi-6","spi-12","recorded-drought"],
        "links": [
            ("precip","core_indicator","drought","Sustained precipitation deficits characterize meteorological drought. Regional monthly precipitation supplies the SPI input."),
            ("soil_root","response","soil-drought","Root-zone water tracks moisture available to vegetation during agricultural drought."),
            ("tws","response","drought","Changes in regional land water storage provide hydrological context across the event and recovery."),
        ],
        "limit": "The SPI describes meteorological drought. Observed impacts and event counts require a documented event catalogue.",
    },
    "flood": {
        "label":"Flooding", "aliases":["flood","floods","river flooding","inundation","洪水","淹水","水災","洪澇","洪涝"],
        "recipes":["recorded-flood"],
        "links":[
            ("precip","related_condition","flood","Monthly precipitation tracks water input that can contribute to flooding. Individual storms require finer observations."),
            ("runoff","related_condition","flood","Regional runoff estimates water generated on land. River overflow and flood occurrence require separate observations."),
        ],
        "limit":"Monthly mean conditions cannot resolve individual flood peaks or local inundation.",
    },
    "vegetation-stress": {
        "label":"Vegetation stress", "aliases":["water stress in vegetation","plant water stress","vegetation water stress","植被壓力","植被水分壓力","植物缺水"],
        "recipes":[],
        "links":[("ndvi","response","ndvi","NDVI tracks changes in canopy greenness, which can accompany vegetation stress."),
                 ("soil_root","related_condition","soil-drought","Root-zone moisture describes a constraint on water supply to vegetation.")],
        "limit":"Greenness varies with season, land cover and multiple disturbances. Attribution requires additional observations.",
    },
    "snow-cover": {
        "label":"Seasonal snow cover", "aliases":["a change in seasonal snow cover","change in seasonal snow cover","snow cover","snow cover change","季節積雪覆蓋","積雪覆蓋變化"],
        "recipes":[], "links":[("swe","related_condition","gldas","Snow water equivalent describes the water stored in the snowpack. Changes in regional snow water help characterize seasonal snow conditions.")],
        "limit":"A fractional snow-cover observation is required to measure changes in snow-covered area.",
    },
    "ocean-warming": {
        "label":"Ocean surface warming", "aliases":["ocean warming","warming oceans","sea surface warming","海洋暖化","海洋升溫","海表升溫"],
        "recipes":[], "links":[("sst","core_indicator","oisst","A trend in regional monthly sea surface temperature measures surface warming in the selected period.")],
        "limit":"The series describes the surface. Heat content at depth requires subsurface measurements.",
    },
    "marine-heatwave": {
        "label":"Marine heatwaves", "aliases":["marine heatwave","marine heat wave","marine heat waves","海洋熱浪","海洋热浪"],
        "recipes":[], "links":[("sst","related_condition","marine-heat","Monthly sea surface temperatures describe thermal background. Individual marine heatwaves require daily threshold exceedances.")],
        "limit":"Daily sea surface temperatures are required to identify marine heatwave frequency and duration.",
    },
    "land-warming": {
        "label":"Land warming", "aliases":["warming temperatures","regional warming","warming air temperatures","warming","陸地升溫","氣溫上升","區域暖化"],
        "recipes":[], "links":[("tair","core_indicator","gldas","Near-surface air temperature provides a monthly measure of warming over land.")],
        "limit":"Monthly means cannot isolate individual hot days.",
    },
    "heatwave": {
        "label":"Heatwaves", "aliases":["heatwave","heat wave","heat waves","熱浪","热浪"],
        "recipes":[], "links":[("tair","related_condition","gldas","Monthly near-surface air temperature describes the background thermal conditions during hot periods.")],
        "limit":"Daily temperature measurements and a regional heatwave definition are required for counts or duration.",
    },
}

BASELINES = {
    "seasonal-2003-2020": {
        "baseline_id":"seasonal-2003-2020", "version":"historical-monthly-1", "start":"2003-01", "end":"2020-12",
        "minimum_samples":8, "purpose":"seasonal_reference", "rule":"Historical reference mean for each calendar month, using at least eight available years for every month. This shorter project reference covers the modern satellite record.", "source_ref":"seasonal",
    },
    "spi-1991-2020": {
        "baseline_id":"spi-1991-2020", "version":"gamma-calibration-1", "start":"1991-01", "end":"2020-12",
        "minimum_samples":30, "purpose":"calibration_reference", "rule":"Thirty complete rolling precipitation totals ending in each calendar month of 1991–2020. Each window includes all preceding months required by the registered scale.", "source_ref":"spi",
    },
}

def reference(ref_id):
    title, url, statement = REFERENCES[ref_id]
    return {"id":ref_id, "title":title, "url":url, "statement":statement, "version":"2026-11-15"}

def recipes():
    output = {}
    for scale in (3, 6, 12):
        rid = f"spi-{scale}"
        output[rid] = {
            "indicator_id":rid, "label":f"Standardized Precipitation Index ({scale} months)", "version":"spi-gamma-1",
            "kind":"derived_indicator", "phenomenon_id":"drought", "phenomenon_applicability":"Meteorological drought.",
            "scale":scale, "scale_months":scale, "required_variables":["precip"], "unit":"standard deviations",
            "required_unit":"mm/day", "required_cadence":"monthly", "calendar":"gregorian",
            "calibration_reference":BASELINES["spi-1991-2020"], "baseline_requirements":BASELINES["spi-1991-2020"],
            "standard_refs":[reference("spi-handbook"),reference("spi")],
            "computation":"Multiply each monthly mean rate by calendar days. Sum complete rolling windows. Fit a two-parameter gamma by maximum likelihood to positive totals by calendar month with a separate zero probability mass. Map the mixed CDF through the standard normal quantile, clipping probabilities to [1e-12, 1−1e-12].",
            "event_rule":"Negative SPI episodes reaching −1 qualify. Recovery at zero or higher ends an episode. Gaps and record edges censor spells.",
            "aggregation":"Assign each episode to its onset year. Report counts with complete exposure and known starts. Duration and cumulative negative SPI require complete spells.",
            "interpretation":"Standardized accumulated precipitation deficit at the selected scale. Independent event documentation is required to establish observed impacts.",
        }
    for phenomenon in ("drought","flood"):
        rid = "recorded-" + phenomenon
        output[rid] = {
            "indicator_id":rid, "label":f"Recorded {phenomenon} events", "version":"catalogue-onset-year-1",
            "kind":"recorded_event", "phenomenon_id":phenomenon, "phenomenon_applicability":f"{phenomenon.title()} events satisfying the registered source definition.",
            "required_variables":[], "baseline_requirements":None, "standard_refs":[reference(phenomenon)],
            "computation":"Use unique events from one approved coverage catalogue with an explicit event definition.",
            "event_rule":"Preserve recorded precision, censoring and gaps. Keep one count per event in the onset year.",
            "aggregation":"Count annual onsets over fully documented exposure. Use uncensored durations in days and comparable severity measures with the same definition and unit.",
            "interpretation":"Changes in registration and spatial coverage can affect measured event frequency.",
        }
    return output
