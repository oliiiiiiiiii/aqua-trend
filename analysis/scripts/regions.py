"""Named analysis regions: (lon_min, lon_max, lat_min, lat_max)."""

REGIONS = {
    # --- Taiwan / East Asia ---
    "Taiwan (island)": (119.9, 122.1, 21.8, 25.4),
    "Taiwan west coast": (120.0, 121.2, 22.4, 25.3),
    "Taipei": (121.35, 121.75, 24.9, 25.2),
    "Taichung": (120.45, 120.85, 24.0, 24.35),
    "Kaohsiung": (120.15, 120.5, 22.5, 22.8),
    "Taiwan Strait": (118.5, 120.3, 22.5, 25.5),
    "East China Sea": (122.0, 128.0, 26.0, 32.0),
    "Kuroshio east of Taiwan": (121.5, 124.0, 21.0, 26.0),
    "North China Plain": (113.0, 119.5, 34.0, 40.5),
    "Beijing": (116.0, 116.8, 39.6, 40.2),
    "Shanghai / Yangtze Delta": (119.5, 122.0, 30.5, 32.0),
    "Pearl River Delta": (112.8, 114.6, 22.2, 23.6),
    "Sichuan Basin": (103.5, 107.5, 28.5, 31.5),
    "Seoul": (126.7, 127.3, 37.35, 37.75),
    "Tokyo": (139.4, 140.0, 35.45, 35.9),
    # --- South Asia / Middle East ---
    "NW India (Punjab-Haryana-Rajasthan)": (72.0, 78.5, 26.0, 32.5),
    "Indo-Gangetic Plain": (75.0, 88.0, 23.5, 30.5),
    "Delhi": (76.8, 77.5, 28.4, 28.9),
    "Dhaka": (90.25, 90.55, 23.65, 23.95),
    "Jharkhand-Odisha coal belt": (83.0, 87.5, 21.0, 24.5),
    "Tigris-Euphrates (Iraq-Iran-Syria)": (38.0, 48.5, 30.0, 38.0),
    "Tehran": (51.1, 51.6, 35.55, 35.85),
    "Caspian Sea": (46.5, 54.5, 36.5, 47.0),
    "Lake Urmia": (45.0, 46.2, 37.0, 38.3),
    "Aral Sea": (58.0, 62.0, 43.5, 46.8),
    "Arabian aquifers (Saudi)": (38.0, 50.0, 20.0, 31.0),
    # --- Americas ---
    "California Central Valley": (-122.5, -118.5, 35.0, 40.0),
    "Los Angeles": (-118.6, -117.7, 33.7, 34.3),
    "US Northeast": (-80.0, -70.0, 38.0, 43.0),
    "US Northern Great Plains": (-104.0, -94.0, 42.0, 49.0),
    "Amazon deforestation arc": (-65.0, -45.0, -13.0, -5.0),
    "Patagonia icefields": (-75.5, -72.0, -52.0, -46.0),
    "Alaska coastal glaciers": (-150.0, -130.0, 58.0, 63.0),
    # --- Africa / Europe ---
    "East African lakes (Victoria)": (30.0, 36.0, -3.5, 1.5),
    "Okavango-Zambezi": (18.0, 30.0, -20.0, -12.0),
    "Sahel": (-17.0, 35.0, 11.0, 18.0),
    "Highveld (Mpumalanga coal)": (28.5, 30.5, -27.0, -25.5),
    "Benelux-Ruhr": (3.0, 9.0, 50.0, 53.0),
    "Po Valley": (7.5, 12.5, 44.5, 46.0),
    # --- Cryosphere ---
    "Greenland": (-73.0, -12.0, 59.0, 84.0),
    "High Mountain Asia": (70.0, 100.0, 27.0, 40.0),
}


def box(name, label=True):
    b = REGIONS[name]
    return (*b, name if label else "")
