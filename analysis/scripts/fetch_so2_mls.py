"""Download (1) MEaSUREs MSAQSO2L4 v2 point-source SO2 emissions catalogue (OMI+OMPS+TROPOMI, 2005-2025, Fioletov et al.)
and (2) Aura MLS v5 daily zonal-mean water vapour ML3DZH2O (2004-2025) for the Hunga Tonga stratospheric-water analysis.
usage: python -I fetch_so2_mls.py
"""
import os
import sys
import earthaccess
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402

earthaccess.login(strategy="netrc")
for sn, v, sub in (("MSAQSO2L4", "2", "so2"), ("ML3DZH2O", "005", "mls")):
    d = f"{ROOT}/data/raw/{sub}"; os.makedirs(d, exist_ok=True)
    g = earthaccess.search_data(short_name=sn, version=v, temporal=("2004-01-01", "2026-12-31"))
    have = set(os.listdir(d))
    g = [x for x in g if x.data_links()[0].split("/")[-1] not in have]
    print(sn, "to download:", len(g), flush=True)
    if g:
        earthaccess.download(g, d, threads=4)
    tl.fix_perms(d)
print("done", flush=True)
