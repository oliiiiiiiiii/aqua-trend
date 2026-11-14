"""Copy the hero figures into findings/figures/ with ranked, descriptive names, and write an index (markdown)."""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import os
import shutil

R = ROOT + ""
HERO = [
    # (rank-name, source path, caption)
    ("W01_gerd_dam_filling", "results/23_water_transfers/transfer_nile.png", "GRACE sees Ethiopia's GERD reservoir fill (+7 km³/yr after 2020)"),
    ("W01b_gerd_ndvi_confirmation", "results/23_water_transfers/gerd_ndvi_before_after.png", "MODIS confirms the GERD lake appearing (independent of GRACE)"),
    ("W02_moisture_highways_eastasia_JJA", "results/22_moisture_transport/map_PminusE_flux_JJA_eastasia.png", "Summer moisture highways into East Asia/Taiwan (MERRA-2)"),
    ("W03_rivers_in_the_sky_annual", "results/22_moisture_transport/map_PminusE_flux_annual.png", "Global moisture sources (orange) and destinations (blue)"),
    ("W04_boundary_inflow", "results/22_moisture_transport/boundary_inflow_seasonal.png", "Which side each region's moisture enters from, by month"),
    ("W05_ELI_water_vs_energy", "results/20_et_correlations/map_ELI_water_vs_energy_limited.png", "What limits evaporation: water or energy"),
    ("W06_ELI_MERRA2", "results/20_et_correlations/map_ELI_MERRA2.png", "Same regime map from MERRA-2 (cross-model check)"),
    ("W06b_ET_trend_models_agree", "results/20_et_correlations/map_ET_trend_models_agree.png", "ET trend where GLDAS and MERRA-2 agree"),
    ("W07_ET_vs_P", "results/20_et_correlations/corr_ET_vs_P.png", "ET follows rain in dry lands, opposes it in wet lands"),
    ("W08_groundwater_trend", "results/21_water_budget/map_groundwater_trend.png", "Hidden groundwater loss (GRACE − GLDAS)"),
    ("W09_soil_vs_groundwater_bars", "results/21_water_budget/bars_soil_vs_groundwater.png", "Soil or aquifer? Splitting the water loss"),
    ("W10_taiwan_seasonal_rain", "results/24_taiwan_water/map_taiwan_seasonal_rain_trends.png", "Taiwan rain trends by season (IMERG 0.1°)"),
    ("W11_taiwan_2021_drought", "results/24_taiwan_water/map_2021_drought.png", "Taiwan's 2021 drought from space"),
    ("W12_snwd_source_destination", "results/23_water_transfers/transfer_snwd.png", "China South-to-North Water Diversion: source vs destination"),
    ("W13_indus", "results/23_water_transfers/transfer_indus.png", "Indus: glaciers to irrigated plains"),
    ("W14_india_green_vs_groundwater", "results/26_india_green_vs_groundwater/india_green_vs_groundwater.png", "India's greening vs groundwater"),
    ("W17_mhw_calendar_kenting", "results/08c_marine_heatwaves/calendar_Southern_Taiwan.png", "Every marine-heatwave day at Kenting since 1982"),
    ("W18_eli_placebo", "results/20_et_correlations/eli_shift_vs_placebo.png", "ELI shift vs placebo (robustness)"),
    ("W19_ocean_source_taiwan", "results/22_moisture_transport/ocean_source_Taiwan.png", "Ocean evaporation vs Taiwan rain (null result)"),
    ("W20_sea_level_sources", "results/28_land_to_ocean/sources_to_ocean_bars.png", "Where the water in sea-level rise comes from (GRACE mass budget)"),
    ("W21_land_to_ocean_series", "results/28_land_to_ocean/cumulative_mass.png", "Water leaving the land, arriving in the ocean"),
    ("W24_ocean_land_seesaw", "results/30_ocean_land_seesaw/seesaw_timeseries.png", "Ocean–land seesaw: rain stored on land lowers global sea level (2011: −5 mm)"),
    ("W25_where_land_water_swings", "results/30_ocean_land_seesaw/map_where_land_water_swings.png", "Where the ocean's borrowed water sits (Amazon = biggest sponge)"),
    ("W26_record_2024_hot_dry", "results/32_compound_hot_dry/map_2023_25_compound_event.png", "2024: the most widespread hot-and-dry year (Amazon, southern Africa, Mexico)"),
    ("W27_hot_dry_calendar", "results/32_compound_hot_dry/calendar_compound_hot_dry.png", "Every month since 2001: share of land hot AND dry"),
    ("W28_amazon_dry_season", "results/33_seasonal_swing/amazon_dry_season.png", "Southern Amazon dry season: drier and longer in 3 rain datasets"),
    ("W29_rain_replacing_snow", "results/34_rain_replacing_snow/map_snow_fraction_trend.png", "Rain replacing snow: snow share of precipitation falling across snowy land"),
    ("W30_snow_water_towers", "results/34_rain_replacing_snow/bars_regions_snow_share.png", "Water towers losing snow share (HMA 49%→41%, Alps 20%→14%)"),
    ("W31_record_low_high_now", "results/35_record_map/map_record_low_high_now.png", "Where land water is at a record low/high right now (32% / 23% of land)"),
    ("W32_year_of_lowest_storage", "results/35_record_map/map_year_of_lowest_storage.png", "When each place hit its driest point of the satellite era"),
    ("W28b_amazon_why", "results/36_amazon_moisture_budget/amazon_moisture_budget.png", "Why the Amazon dry season dries: a warming tropical Atlantic accounts for the trend"),
    ("W33_eastasia_extremes", "results/37_eastasia_extremes/eastasia_extremes.png", "East Asia extremes ranked: Yangtze 2022 record-low storage, Henan 2021, Taiwan 2021"),
    ("W34_turning_points", "results/39_turning_points/map_turning_points.png", "Turning points: where land water trends reversed after 2014 (45% of land changed)"),
    ("N01_quakes_detection", "results/40_global_earthquakes/global_quake_counts.png", "Earthquakes aren't increasing: only small-quake detection is (and a 1983 magnitude-scale trap)"),
    ("N02_quakes_map", "results/40_global_earthquakes/map_big_quakes_timeline.png", "Four decades of large earthquakes + the 2004–2012 great-quake burst test"),
    ("N03_quakes_where", "results/40_global_earthquakes/map_quake_rate_change.png", "Where the small-quake 'increase' lives: network growth, not tectonics"),
    ("N04_induced_map", "results/41_induced_seismicity/map_three_eras.png", "Human-made earthquakes: the wastewater boom moved from Oklahoma to West Texas"),
    ("N05_induced_counts", "results/41_induced_seismicity/induced_counts.png", "Injection regions ×100–×800 vs a flat natural control; regulation halves the rate"),
    ("N06_pole_drift", "results/43_earth_rotation/pole_drift_water.png", "Water and ice steer the North Pole: GRACE predicts the post-2000 drift change within 10°"),
    ("N07_length_of_day", "results/43_earth_rotation/length_of_day.png", "The Earth spins faster: record short days in the 2020s, while melting ice lengthens the day"),
    ("N08_ozone_hole", "results/46_ozone_hole/ozone_hole_hinge.png", "The ozone hole stopped growing in 1993 (p=4e-10); recovery not yet significant"),
    ("N09_quake_seasonality", "results/44_quake_seasonality/seasonal_quakes_vs_water_load.png", "Null: seasonal water load does not detectably modulate earthquakes"),
    ("N10_no2_trend", "results/42_airs_omi/map_no2_trend.png", "OMI NO₂ 2005–25: US/Europe/East Asia cleaner, India & Gulf at records"),
    ("N11_canada_smoke", "results/42_airs_omi/map_canada_2023_smoke.png", "Canada 2023 fires seen by AIRS (CO) and OMI (aerosol): rank 1 of 22 in both"),
    ("N12_no2_vs_co", "results/42_airs_omi/regional_no2_vs_co.png", "Combustion fingerprints: OMI NO₂ vs AIRS CO by region"),
    ("N13_ozone_two_sensors", "results/42_airs_omi/ozone_airs_vs_omi.png", "AIRS (infrared) vs OMI (UV) ozone: r = 0.92; Antarctic spring r = 0.99"),
    ("N14_fire_smoke_corr", "results/42_airs_omi/map_fire_smoke_correlation.png", "Where fires burn, AIRS CO and OMI aerosol follow"),
    ("N15_water_vapour_per_K", "results/42_airs_omi/map_water_vapour_per_K.png", "Warmer air, wetter air: AIRS water vapour 6%/K over oceans"),
    ("N16_taiwan_aftershocks", "results/47_taiwan_aftershocks/taiwan_aftershocks.png", "Chi-Chi 1999 vs Hualien 2024: same Omori decay (p ≈ 0.95)"),
    ("N17_fire_trend", "results/45_fire_trends/map_fire_trend.png", "The world is burning less: fire detections −11%/decade (Terra & Aqua agree)"),
    ("N18_fire_regions", "results/45_fire_trends/regional_fire_series.png", "Fire regions year by year, Terra vs Aqua"),
    ("N19_so2_sources", "results/49_so2_sources/so2_sources_map.png", "SO₂ moved from China to India and the Gulf: 780 sources, four satellites"),
    ("N20_hunga_tonga_water", "results/50_hunga_tonga_water/hunga_tonga_stratospheric_water.png", "Hunga Tonga added 13% to stratospheric water; half remains"),
    ("N21_dust_greening", "results/51_dust_greening/dust_trends_and_greening.png", "Less dust over the Sahel and Middle East; greener years are cleaner"),
    ("N22_methane_null", "results/48_methane/methane_vs_wetland_water.png", "Methane surge vs wetland water: a correlation that is only shared trend"),
    ("N23_asia_haze", "results/52_asia_haze/asia_haze_trends.png", "Asia's haze map redrawn: AERONET confirms clearer East Asia (Taipei −39%/dec), hazier India"),
    ("N24_hunga_aftermath", "results/53_hunga_aftermath/hunga_aftermath_temperature_ozone.png", "After Hunga Tonga: the wet stratosphere cooled 2 K and lost 3% ozone"),
    ("W35_east_africa_lakes", "results/54_east_africa_lakes/east_africa_lakes.png", "East Africa's lakes ratchet upward in Indian Ocean Dipole years (Turkana +6.7 m)"),
    ("W36_world_lakes", "results/55_world_lakes/world_lakes_trends.png", "The world's lakes from space: the Caspian sinks (−1.2 m/decade), East Africa rises"),
    ("W37_tonle_sap_pulse", "results/57_tonle_sap_pulse/tonle_sap_flood_pulse.png", "The Mekong's heartbeat weakens: Tonle Sap flood peak −1 m/decade for the same rain"),
    ("W38_time_of_emergence", "results/56_time_of_emergence/time_of_emergence.png", "How long must we watch? Rain trends can take a century to emerge"),
    ("N25_haze_fine_coarse", "results/58_haze_fine_coarse/haze_fine_vs_coarse.png", "Asia's haze changes grain: fine combustion particles −43%/dec in East Asia, +21% in South Asia"),
    ("W39_wetlands_extremes", "results/59_wetlands_extremes/wetlands_extremes.png", "Wetlands at the extremes: the Pantanal dries and burns, the Sahel's wetlands refill"),
    ("W22_water_memory", "results/29_water_memory/map_water_memory_lag.png", "Water memory: months from rain to peak storage"),
    ("W23_VPD_sign_flip", "results/20_et_correlations/corr_ET_vs_VPD.png", "ET vs air dryness: opposite signs in wet vs dry lands"),
    ("W15_enso_water_storage", "results/25_teleconnections/map_ENSO_water_storage.png", "One ocean signal, opposite water effects (ENSO)"),
    ("W16_iod_water_storage", "results/25_teleconnections/map_Indian_water_storage.png", "Indian Ocean Dipole fingerprint on water storage"),
    ("G01_land_water_storage", "results/01_grace_water_storage/map_land_water_security.png", "Land water storage trends (GRACE)"),
    ("G02_nw_india_series", "results/01_grace_water_storage/ts_NW_India.png", "NW India groundwater decline"),
    ("G03_ncp_reversal", "results/01_grace_water_storage/ts_North_China_Plain.png", "North China Plain: depletion then recovery"),
    ("G04_precip_trend", "results/05a_gpcp_precip/map_precip_trend_pct.png", "Rainfall trends 1979–2026 (GPCP)"),
    ("G05_greening", "results/07_modis_ndvi/map_global.png", "Greening of China & India (MODIS NDVI)"),
    ("G06_arctic_before_after", "results/09b_sea_ice_maps/before_after_N_09.png", "Arctic September ice: 1980s vs 2020s"),
    ("G07_antarctic_stripes", "results/09_sea_ice/stripes_antarctic.png", "Antarctic sea ice: a trend that flipped"),
    ("G08_sea_level", "results/12_sea_level/map_sea_level_trend.png", "Sea level rise 1993–2026"),
    ("G09_gmsl_acceleration", "results/12_sea_level/ts_global_mean_sea_level.png", "Global sea level is accelerating"),
    ("G10_sst_eastasia", "results/08a_sst_oisst/map_sst_trend_eastasia.png", "Seas around Taiwan warming"),
    ("G11_mhw_calendar_taiwan", "results/08c_marine_heatwaves/calendar_Taiwan_Strait.png", "Marine heatwave days, Taiwan Strait"),
    ("G12_chlorophyll", "results/08b_chlorophyll/map_chl_trend_global.png", "Ocean chlorophyll: trends not yet detectable"),
]
os.umask(0)
dst = f"{R}/findings/figures"
os.makedirs(dst, exist_ok=True)
lines = ["# Figure gallery (hero visuals)\n",
         "Ranked hero figures. W = water/hydrology pivot, G = earlier global trends. Each figure links to its source task folder "
         "(`results/<task>/README.md` has the numbers and caveats).\n"]
index = ["| # | What it shows | Source |", "|---|---|---|"]
blocks = []
for name, src, cap in HERO:
    p = f"{R}/{src}"
    tag = name.split("_")[0]
    if os.path.exists(p):
        shutil.copy2(p, f"{dst}/{name}.png")
        os.chmod(f"{dst}/{name}.png", 0o777)
        index.append(f"| [{tag}](#{tag.lower()}) | {cap} | `{src}` |")
        blocks.append(f"### {tag}\n**{cap}**  \n<sub>source: `{src}`</sub>\n\n![{cap}](figures/{name}.png)\n")
    else:
        index.append(f"| {tag} | {cap} — not produced yet | `{src}` |")
lines += index + ["\n---\n"] + blocks
open(f"{R}/findings/GALLERY.md", "w").write("\n".join(lines) + "\n")
os.chmod(f"{R}/findings/GALLERY.md", 0o777)
print("\n".join(lines))
