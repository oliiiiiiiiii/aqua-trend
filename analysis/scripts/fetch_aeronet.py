"""Download NASA AERONET Version 3 Level 2.0 daily-average aerosol optical depth for selected Asian sites (2002-2026).

Output: data/processed/aeronet/<site>.csv with date, AOD_500nm, AOD_440nm, AE_440_870 and AOD_550 (= AOD_500 * (550/500)^-AE).
usage: python -I fetch_aeronet.py
"""
import os
import io
import sys
import time
import numpy as np
import pandas as pd
import requests
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402

SITES = ["Taipei_CWB", "NCU_Taiwan", "EPA-NCU", "Chiayi", "Kaohsiung", "Lulin", "Dongsha_Island",
         "Beijing", "Beijing-CAMS", "Beijing_RADI", "XiangHe", "Taihu", "SONET_Shanghai", "SONET_Nanjing", "Hefei", "SACOL",
         "Hong_Kong_PolyU", "Hong_Kong_Hok_Tsui", "Seoul_SNU", "Yonsei_University", "Anmyon", "Gosan_SNU", "Baengnyeong",
         "Osaka", "Noto", "Shirahama", "Fukuoka", "Bac_Giang", "Chiang_Mai_Met_Sta", "Singapore", "Manila_Observatory",
         "Kanpur", "Gandhi_College", "Lahore", "Karachi", "Jaipur", "Pune", "Dhaka_University", "Nainital", "Pokhara", "Kathmandu-Bode", "Lumbini",
         "Solar_Village", "Kuwait_University", "Mezaira"]
UA = {"User-Agent": "aqua-trend-analysis/1.0"}
URL = "https://aeronet.gsfc.nasa.gov/cgi-bin/print_web_data_v3"
outd = f"{ROOT}/data/processed/aeronet"; os.makedirs(outd, exist_ok=True)
for s in SITES:
    fn = f"{outd}/{s}.csv"
    if os.path.exists(fn):
        continue
    params = dict(site=s, year=2002, month=1, day=1, year2=2026, month2=12, day2=31, AOD20=1, AVG=20, if_no_html=1)
    for k in range(4):
        try:
            r = requests.get(URL, params=params, headers=UA, timeout=300)
            r.raise_for_status()
            break
        except requests.RequestException as e:
            print("  retry", s, e, flush=True); time.sleep(10 * (k + 1))
    else:
        continue
    lines = [ln for ln in r.text.splitlines() if ln.startswith("AERONET_Site,") or ln.startswith(s + ",")]
    if len(lines) < 2:
        print(f"{s}: no Level 2.0 data", flush=True)
        pd.DataFrame(columns=["date", "AOD_500", "AOD_440", "AE_440_870", "AOD_550"]).to_csv(fn, index=False)
        continue
    df = pd.read_csv(io.StringIO("\n".join(lines)), na_values=[-999.0, "-999."])
    out = pd.DataFrame({"date": pd.to_datetime(df["Date(dd:mm:yyyy)"], format="%d:%m:%Y"),
                        "AOD_500": df.get("AOD_500nm"), "AOD_440": df.get("AOD_440nm"), "AE_440_870": df.get("440-870_Angstrom_Exponent")})
    out["AOD_550"] = out.AOD_500 * (550 / 500) ** (-out.AE_440_870)
    miss = out.AOD_550.isna() & out.AOD_440.notna() & out.AE_440_870.notna()
    out.loc[miss, "AOD_550"] = out.AOD_440[miss] * (550 / 440) ** (-out.AE_440_870[miss])
    out.to_csv(fn, index=False)
    print(f"{s}: {len(out)} days {out.date.min().date()}..{out.date.max().date()}", flush=True)
    time.sleep(2)
tl.fix_perms(outd)
print("done", flush=True)
