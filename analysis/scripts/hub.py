"""hub - every water & driver layer on one 0.5 deg monthly grid (lat -89.75..89.75, lon -179.75..179.75).

load(name) -> xr.DataArray(time, lat, lon) in friendly units. Names:
  water : tws (cm), dsdt (cm/month), p_gpcp, p_imerg, p_m2 (mm/day), et_gldas, et_m2, pet_gldas,
          esoil, ecanop, tveg (mm/day), runoff (mm/day: Qs+Qsb), sm_root (kg/m2=mm), sm_total (0-200 cm, mm), swe (mm)
  other : tair (degC), vpd (kPa), rn (W/m2 net radiation), ef (evaporative fraction), swdown (W/m2), wind (m/s),
          ndvi, lst_day (degC), sst (degC)
  index : nino34, dmi, pdo -> pd.Series
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import json
import os
import glob
import numpy as np
import pandas as pd
import xarray as xr

R = ROOT
LAT = -89.75 + 0.5 * np.arange(360)
LON = -179.75 + 0.5 * np.arange(720)
LV = 2.45e6  # J/kg


def _da(arr, times, name, units):
    return xr.DataArray(np.asarray(arr, np.float32), dims=("time", "lat", "lon"),
                        coords={"time": pd.DatetimeIndex(times), "lat": LAT, "lon": LON}, name=name,
                        attrs={"units": units})


def _block(a, k):
    nt, ny, nx = a.shape
    with np.errstate(all="ignore"):
        import warnings
        warnings.simplefilter("ignore")
        return np.nanmean(a.reshape(nt, ny // k, k, nx // k, k), axis=(2, 4))


def _gd(key, var, grid="g0p5"):
    d = f"{R}/data/processed/gesdisc/{key}"
    times = pd.DatetimeIndex(json.load(open(f"{d}/times.json")))
    a = np.load(f"{d}/{var}_{grid}.npy", mmap_mode="r")
    done = sorted(json.load(open(f"{d}/done.json"))) if os.path.exists(f"{d}/done.json") else list(range(len(times)))
    sel = np.zeros(len(times), bool); sel[done] = True
    return times[sel], np.asarray(a[sel], np.float32)


def _merra_to_hub(a):
    """MERRA-2 native (nt, 361 lat -90..90, 576 lon -180..179.375) -> hub 0.5 deg."""
    lat_m = -90 + 0.5 * np.arange(361); lon_m = -180 + 0.625 * np.arange(576)
    da = xr.DataArray(a, dims=("time", "lat", "lon"), coords={"lat": lat_m, "lon": lon_m})
    da = xr.concat([da, da.isel(lon=[0]).assign_coords(lon=[180.0])], dim="lon")
    return da.interp(lat=LAT, lon=LON).values.astype(np.float32)


def load(name):
    if name == "tws":
        f = glob.glob(f"{R}/data/raw/grace/GRCTellus*.nc")[0]
        import trendlib as tl
        da = tl.standardize_coords(xr.open_dataset(f)["lwe_thickness"])
        mon = pd.DatetimeIndex(da.time.values).to_period("M").to_timestamp()
        da = da.assign_coords(time=mon).groupby("time").mean()
        full = pd.date_range(mon.min(), mon.max(), freq="MS")
        return _da(da.reindex(time=full).values, full, "tws", "cm")
    if name == "dsdt":
        t = load("tws")
        d = (t.shift(time=-1) - t.shift(time=1)) / 2.0  # centred difference, cm/month
        d.name = "dsdt"; d.attrs["units"] = "cm/month"
        return d
    if name == "p_gpcp":
        ds = xr.open_dataset(f"{R}/data/raw/gpcp/precip.mon.mean.nc", decode_times=False)
        tt = (pd.Timestamp("1800-01-01") + pd.to_timedelta(ds["time"].values.astype(float), unit="D")).to_period("M").to_timestamp()
        import trendlib as tl
        da = tl.standardize_coords(ds["precip"].assign_coords(time=tt))
        a = np.repeat(np.repeat(da.values, 5, axis=1), 5, axis=2)
        return _da(a, tt, "p_gpcp", "mm/day")
    if name == "p_imerg":
        t, a = _gd("imerg", "precipitation")
        return _da(a, t, "p_imerg", "mm/day")
    m2l = {"et_m2land": ("EVLAND", 86400.0, "mm/day"), "sm_m2": ("GWETROOT", 1.0, "fraction"),
           "p_m2land": ("PRECTOTLAND", 86400.0, "mm/day"), "tsurf_m2": ("TSURF", 1.0, "K")}
    if name in m2l:
        v, f, u = m2l[name]
        t, a = _gd("m2lnd", v, "native")
        return _da(_merra_to_hub(a * f), t, name, u)
    if name == "rn_m2":
        t, a = _gd("m2lnd", "SWLAND", "native"); _, b = _gd("m2lnd", "LWLAND", "native")
        return _da(_merra_to_hub(a + b), t, name, "W/m2")
    if name == "ro_m2":
        t, a = _gd("m2lnd", "RUNOFF", "native"); _, b = _gd("m2lnd", "BASEFLOW", "native")
        return _da(_merra_to_hub((a + b) * 86400.0), t, name, "mm/day")
    if name in ("et_m2", "p_m2"):
        t, a = _gd("m2flx", "EVAP" if name == "et_m2" else "PRECTOTCORR", "native")
        return _da(_merra_to_hub(a * 86400.0), t, name, "mm/day")
    gl = {"et_gldas": ("Evap_tavg", 86400.0, "mm/day"), "pet_gldas": ("PotEvap_tavg", 86400.0 / LV, "mm/day"),
          "esoil": ("ESoil_tavg", 86400.0 / LV, "mm/day"), "ecanop": ("ECanop_tavg", 86400.0 / LV, "mm/day"),
          "tveg": ("Tveg_tavg", 86400.0 / LV, "mm/day"), "sm_root": ("RootMoist_inst", 1.0, "mm"),
          "swe": ("SWE_inst", 1.0, "mm"), "swdown": ("SWdown_f_tavg", 1.0, "W/m2"), "wind": ("Wind_f_inst", 1.0, "m/s"),
          "rain_gldas": ("Rainf_f_tavg", 86400.0, "mm/day")}
    if name in gl:
        v, f, u = gl[name]
        t, a = _gd("gldas", v)
        return _da(a * f, t, name, u)
    if name == "runoff":
        t, a = _gd("gldas", "Qs_acc"); _, b = _gd("gldas", "Qsb_acc")
        return _da((a + b) * 8.0, t, name, "mm/day")  # 3-hourly accumulations -> per day
    if name == "sm_total":
        parts = [_gd("gldas", v)[1] for v in ("SoilMoi0_10cm_inst", "SoilMoi10_40cm_inst", "SoilMoi40_100cm_inst",
                                              "SoilMoi100_200cm_inst")]
        t = _gd("gldas", "SoilMoi0_10cm_inst")[0]
        return _da(sum(parts), t, name, "mm")
    if name == "tair":
        t, a = _gd("gldas", "Tair_f_inst")
        return _da(a - 273.15, t, name, "degC")
    if name == "vpd":
        t, T = _gd("gldas", "Tair_f_inst"); _, q = _gd("gldas", "Qair_f_inst"); _, p = _gd("gldas", "Psurf_f_inst")
        Tc = T - 273.15
        es = 0.61094 * np.exp(17.625 * Tc / (Tc + 243.04))  # kPa
        e = q * (p / 1000.0) / (0.622 + 0.378 * q)
        return _da(np.clip(es - e, 0, None), t, name, "kPa")
    if name == "rn":
        t, a = _gd("gldas", "Swnet_tavg"); _, b = _gd("gldas", "Lwnet_tavg")
        return _da(a + b, t, name, "W/m2")
    if name == "ef":
        t, a = _gd("gldas", "Qle_tavg"); _, b = _gd("gldas", "Qh_tavg")
        with np.errstate(all="ignore"):
            ef = a / (a + b)
        ef[(a + b) < 10] = np.nan
        return _da(np.clip(ef, -0.5, 1.5), t, name, "fraction")
    if name in ("ndvi", "lst_day"):
        key = "ndvi" if name == "ndvi" else "lst"
        d = f"{R}/data/processed/modis/{key}"
        t = pd.DatetimeIndex(json.load(open(f"{d}/times.json")))
        cache = f"{R}/data/processed/hub/{name}_0p5.npy"
        if os.path.exists(cache):
            out = np.load(cache)
        else:
            a = np.load(f"{d}/{name}_global_0p1.npy", mmap_mode="r")
            out = np.empty((len(t), 360, 720), np.float32)
            for i0 in range(0, len(t), 24):
                out[i0:i0 + 24] = _block(np.asarray(a[i0:i0 + 24], np.float32), 5)
            if name == "lst_day":
                out = out - 273.15
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            np.save(cache, out)
            os.chmod(cache, 0o777)
        return _da(out, t, name, "NDVI" if name == "ndvi" else "degC")
    if name == "sst":
        import trendlib as tl
        da = tl.standardize_coords(xr.open_dataset(f"{R}/data/raw/oisst/sst.mon.mean.nc")["sst"]).sel(time=slice("1982", None))
        t = pd.DatetimeIndex(da.time.values)
        a = da.values.astype(np.float32)
        a[a < -1.5] = np.nan  # sea ice
        return _da(_block(a, 2), t, name, "degC")
    raise KeyError(name)


def index(name):
    """Monthly climate index as pd.Series (NOAA PSL/NCEI formats)."""
    f = {"nino34": "nina34.anom.data", "dmi": "dmi.had.long.data", "pdo": "ersst.v5.pdo.dat"}[name]
    rows = []
    for line in open(f"{R}/data/raw/indices/{f}"):
        parts = line.split()
        if len(parts) == 13 and parts[0].isdigit() and 1800 < int(parts[0]) < 2100:
            y = int(parts[0])
            for m, v in enumerate(parts[1:], 1):
                v = float(v)
                if abs(v) < 90:
                    rows.append((pd.Timestamp(year=y, month=m, day=1), v))
    s = pd.Series(dict(rows)).sort_index()
    s.name = name
    return s


def align(*das, start=None, end=None):
    """Intersect time axes of several DataArrays (and optional window)."""
    t = das[0].time.values
    for d in das[1:]:
        t = np.intersect1d(t, d.time.values)
    t = pd.DatetimeIndex(t)
    if start:
        t = t[t >= pd.Timestamp(start)]
    if end:
        t = t[t <= pd.Timestamp(end)]
    return [d.sel(time=t) for d in das], t


def land_mask():
    f = glob.glob(f"{R}/data/raw/grace/GRCTellus*.nc")[0]
    import trendlib as tl
    return tl.standardize_coords(xr.open_dataset(f)["land_mask"]).values > 0.5
