"""Download (1) MEaSUREs MSAQSO2L4 v2 point-source SO2 emissions catalogue (OMI+OMPS+TROPOMI, 2005-2025, Fioletov et al.)
and (2) Aura MLS v5 daily zonal-mean water vapour ML3DZH2O (2004-2025) for the Hunga Tonga stratospheric-water analysis.
and (3, optional) MLS v5 daily zonal-mean temperature (ML3DZT) and ozone (ML3DZO3) for the Hunga Tonga aftermath.
usage: python -I fetch_so2_mls.py [so2] [h2o] [t] [o3]     (default: so2 h2o)
"""
import os
import sys
import earthaccess
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402

earthaccess.login(strategy="netrc")
PRODS = {"so2": ("MSAQSO2L4", "2", "so2"), "h2o": ("ML3DZH2O", "005", "mls"), "t": ("ML3DZT", "005", "mls_t"), "o3": ("ML3DZO3", "005", "mls_o3")}
for sn, v, sub in [PRODS[k] for k in (sys.argv[1:] or ["so2", "h2o"])]:
    d = f"{ROOT}/data/raw/{sub}"; os.makedirs(d, exist_ok=True)
    g = earthaccess.search_data(short_name=sn, version=v, temporal=("2004-01-01", "2026-12-31"))
    have = set(os.listdir(d))
    g = [x for x in g if x.data_links()[0].split("/")[-1] not in have]
    print(sn, "to download:", len(g), flush=True)
    if sub == "mls_o3":
        # large files (~200 MB/yr): keep only the pressure-level zonal means, then delete the raw file
        import glob as _glob
        import numpy as np
        import netCDF4

        def compact(f):
            with netCDF4.Dataset(f) as nc:
                gz = nc["H2O PressureZM".replace("H2O", "O3")]
                np.savez_compressed(f[:-3] + "_PressureZM.npz", value=np.ma.filled(gz["value"][:].astype(np.float32), np.nan),
                                    lev=np.asarray(gz["lev"][:]), lat=np.asarray(gz["lat"][:]), time=np.asarray(gz["time"][:]),
                                    time_units=gz["time"].units)
            os.remove(f)
        for f in sorted(_glob.glob(f"{d}/*.nc")):
            try:
                compact(f)
            except Exception as e:  # noqa: BLE001
                print("  bad file, re-downloading", os.path.basename(f), e, flush=True); os.remove(f)
        have = {os.path.basename(x).replace("_PressureZM.npz", ".nc") for x in _glob.glob(f"{d}/*_PressureZM.npz")}
        g = [x for x in g if x.data_links()[0].split("/")[-1] not in have]
        for x in g:
            fs = earthaccess.download([x], d, threads=1, show_progress=False)
            compact(str(fs[0]))
            print("  ", os.path.basename(str(fs[0])), flush=True)
    elif g:
        earthaccess.download(g, d, threads=4)
    tl.fix_perms(d)
print("done", flush=True)
