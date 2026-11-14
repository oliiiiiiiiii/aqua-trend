"""English display names for the existing region catalogue (data contract §3).

The catalogue (web/public/data/catalog/regions.json) is written in zh-TW. The
front-end build (web/scripts/prep-data.mjs, ``englishName``) derives English
names with fixed rules; this module applies the same rules so the backend and
the globe show the same label for the same region id. Names are labels only —
the region is always identified by its id.
"""
from __future__ import annotations

import re
from typing import Any, Mapping

# ISO 3166-1 alpha-3 (plus the Natural Earth pseudo-codes used by the region
# catalogue) -> English short name. Same table as web/scripts/prep-data.mjs.
ISO_EN: dict[str, str] = {
    "AFG": "Afghanistan", "AGO": "Angola", "ALB": "Albania", "ARE": "United Arab Emirates", "ARG": "Argentina",
    "ARM": "Armenia", "ATA": "Antarctica", "AUS": "Australia", "AUT": "Austria", "AZE": "Azerbaijan",
    "BDI": "Burundi", "BEL": "Belgium", "BEN": "Benin", "BFA": "Burkina Faso", "BGD": "Bangladesh",
    "BGR": "Bulgaria", "BHS": "Bahamas", "BIH": "Bosnia and Herzegovina", "BLR": "Belarus", "BOL": "Bolivia",
    "BRA": "Brazil", "BTN": "Bhutan", "BWA": "Botswana", "CAF": "Central African Republic", "CAN": "Canada",
    "CHE": "Switzerland", "CHL": "Chile", "CHN": "China", "CIV": "Côte d'Ivoire", "CMR": "Cameroon",
    "COD": "DR Congo", "COG": "Congo", "COL": "Colombia", "COM": "Comoros", "CRI": "Costa Rica", "CUB": "Cuba",
    "CZE": "Czechia", "DEU": "Germany", "DJI": "Djibouti", "DNK": "Denmark", "DOM": "Dominican Republic",
    "DZA": "Algeria", "ECU": "Ecuador", "EGY": "Egypt", "ERI": "Eritrea", "ESP": "Spain", "EST": "Estonia",
    "ETH": "Ethiopia", "FIN": "Finland", "FJI": "Fiji", "FLK": "Falkland Islands", "FRA": "France",
    "FRO": "Faroe Islands", "FSM": "Micronesia", "GAB": "Gabon", "GBR": "United Kingdom", "GEO": "Georgia",
    "GHA": "Ghana", "GIN": "Guinea", "GMB": "Gambia", "GNB": "Guinea-Bissau", "GNQ": "Equatorial Guinea",
    "GRC": "Greece", "GRL": "Greenland", "GTM": "Guatemala", "GUM": "Guam", "GUY": "Guyana", "HKG": "Hong Kong",
    "HND": "Honduras", "HRV": "Croatia", "HTI": "Haiti", "HUN": "Hungary", "IDN": "Indonesia", "IND": "India",
    "IRL": "Ireland", "IRN": "Iran", "IRQ": "Iraq", "ISL": "Iceland", "ITA": "Italy", "JAM": "Jamaica",
    "JOR": "Jordan", "JPN": "Japan", "KAZ": "Kazakhstan", "KEN": "Kenya", "KGZ": "Kyrgyzstan", "KHM": "Cambodia",
    "KIR": "Kiribati", "KOR": "South Korea", "KWT": "Kuwait", "LAO": "Laos", "LBR": "Liberia", "LBY": "Libya",
    "LKA": "Sri Lanka", "LSO": "Lesotho", "LTU": "Lithuania", "LVA": "Latvia", "MAR": "Morocco", "MDA": "Moldova",
    "MDG": "Madagascar", "MEX": "Mexico", "MKD": "North Macedonia", "MLI": "Mali", "MMR": "Myanmar",
    "MNG": "Mongolia", "MNP": "Northern Mariana Islands", "MOZ": "Mozambique", "MRT": "Mauritania", "MWI": "Malawi",
    "MYS": "Malaysia", "NAM": "Namibia", "NCL": "New Caledonia", "NER": "Niger", "NFK": "Norfolk Island",
    "NGA": "Nigeria", "NIC": "Nicaragua", "NLD": "Netherlands", "NOR": "Norway", "NPL": "Nepal",
    "NZL": "New Zealand", "OMN": "Oman", "PAK": "Pakistan", "PAN": "Panama", "PER": "Peru", "PHL": "Philippines",
    "PLW": "Palau", "PNG": "Papua New Guinea", "POL": "Poland", "PRI": "Puerto Rico", "PRK": "North Korea",
    "PRT": "Portugal", "PRY": "Paraguay", "QAT": "Qatar", "ROU": "Romania", "RUS": "Russia",
    "SAH": "Western Sahara", "SAU": "Saudi Arabia", "SDN": "Sudan", "SDS": "South Sudan", "SEN": "Senegal",
    "SLB": "Solomon Islands", "SLE": "Sierra Leone", "SOL": "Somaliland", "SOM": "Somalia", "SRB": "Serbia",
    "STP": "São Tomé and Príncipe", "SUR": "Suriname", "SVK": "Slovakia", "SVN": "Slovenia", "SWE": "Sweden",
    "SWZ": "Eswatini", "SYR": "Syria", "TCD": "Chad", "TGO": "Togo", "THA": "Thailand", "TJK": "Tajikistan",
    "TKM": "Turkmenistan", "TLS": "Timor-Leste", "TTO": "Trinidad and Tobago", "TUN": "Tunisia", "TUR": "Türkiye",
    "TWN": "Taiwan", "TZA": "Tanzania", "UGA": "Uganda", "UKR": "Ukraine", "URY": "Uruguay",
    "USA": "United States", "UZB": "Uzbekistan", "VEN": "Venezuela", "VNM": "Vietnam", "VUT": "Vanuatu",
    "YEM": "Yemen", "ZAF": "South Africa", "ZMB": "Zambia", "ZWE": "Zimbabwe",
}

#: regions whose catalogue name is zh-only and has a fixed English name
FIXED_EN: dict[str, str] = {
    "sea-CAR": "Caribbean Sea", "sea-MED": "Mediterranean Sea", "sea-SEA": "Southeast Asian seas",
    "sea-ARO": "Arctic Ocean", "sea-NPO": "North Pacific", "sea-EPO": "Equatorial Pacific",
    "sea-SPO": "South Pacific", "sea-NAO": "North Atlantic", "sea-EAO": "Equatorial Atlantic",
    "sea-SAO": "South Atlantic", "sea-ARS": "Arabian Sea", "sea-BOB": "Bay of Bengal",
    "sea-EIO": "Equatorial Indian Ocean", "sea-SIO": "South Indian Ocean", "sea-SOO": "Southern Ocean",
    "ice-EAN": "East Antarctic Ice Sheet", "ice-WAN": "West Antarctic Ice Sheet",
    "named-taiwan-main-island": "Taiwan main island (coastline)",
    "named-taiwan-island": "Taiwan window (land + sea rectangle)",
}

_CJK = re.compile(r"[⺀-鿿豈-﫿＀-￯　-〿]")
_RIVER = re.compile(r"^(.+?) 流域（")
_HEX = re.compile(r"^(.+?) 六角格 (\w+)$")


def _latin(text: str) -> bool:
    """True when ``text`` has no CJK characters (Latin names with diacritics are fine)."""
    return not _CJK.search(text)


def _lat_lon(centroid: Any) -> str:
    lon, lat = float(centroid[0]), float(centroid[1])
    return f"{abs(lat):.0f}°{'N' if lat >= 0 else 'S'} {abs(lon):.0f}°{'E' if lon >= 0 else 'W'}"


def zh_place_names(regions: list[Mapping[str, Any]], countries: Mapping[str, Mapping[str, Any]]) -> dict[str, str]:
    """zh place label -> English, for the prefixes used in hex-cell names."""
    out = {str(v.get("zh")): ISO_EN.get(iso, iso) for iso, v in countries.items()}
    for r in regions:
        if r.get("id") in FIXED_EN:
            out[str(r.get("name"))] = FIXED_EN[str(r["id"])]
    out["中華人民共和國"] = "China"
    return out


def english_name(region: Mapping[str, Any], zh_to_en: Mapping[str, str]) -> str:
    """English label of one catalogue region; falls back to the zh name, never to another region."""
    rid, name, rtype = str(region["id"]), str(region.get("name", "")), region.get("type")
    if rid in FIXED_EN:
        return FIXED_EN[rid]
    countries = region.get("countries") or []
    places = [ISO_EN.get(c.get("iso"), str(c.get("iso"))) for c in countries[:3]]
    where = f" ({', '.join(places)}{', …' if len(countries) > 3 else ''})" if places else ""
    if rtype in ("basin3", "basin4"):
        river = _RIVER.match(name)
        if river and _latin(river.group(1)):
            return f"{river.group(1)} basin{where}"
        pfaf = region.get("pfaf", rid)
        return f"{'Island basin' if name.startswith('島嶼') else 'Basin'} {pfaf}{where}"
    if rtype == "hex":
        m = _HEX.match(name)
        prefix = None
        if m:
            prefix = m.group(1) if _latin(m.group(1)) else zh_to_en.get(m.group(1))
        if prefix is None and region.get("centroid"):
            prefix = _lat_lon(region["centroid"])
        return f"{prefix or 'Hex'} hex {m.group(2) if m else rid[-6:]}"
    return name if name and _latin(name) else (name or rid)
