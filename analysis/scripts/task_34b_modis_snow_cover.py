"""Task 34b - Independent satellite check of 'rain replacing snow': MODIS/Terra snow cover (MOD10CM v61, 0.05 deg monthly).

Spring (Mar-May) snow-cover fraction per pixel, 2001-2025 -> trend (OLS-AR1 & MK, FDR q=0.10) on the 0.5 deg hub grid.
Compared with the MERRA-2 snow-share trend over the same years (task 34) and GLDAS March SWE.
Codes: 0-100 % snow; 211 night, 250 cloud, 253 no decision, 254 water, 255 fill -> NaN. Antarctica excluded.
"""
import sys
import glob
import os
import re
import numpy as np
import pandas as pd
import xarray as xr
from pyhdf.SD import SD, SDC
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "34_rain_replacing_snow"
out = tl.task_dir(TASK)
SRC = "Data: MODIS/Terra MOD10CM v61 monthly snow cover (NSIDC), 2001–2025; MERRA-2 M2TMNXINT."
lon, lat = hub.LON, hub.LAT
cache = f"{ROOT}/data/processed/hub/modis_snowcover_0p5.npy"
files = sorted(glob.glob(f"{ROOT}/data/raw/mod10cm/MOD10CM.A*.hdf"))
by_month = {}
for f in files:
    m = re.search(r"A(\d{4})(\d{3})\.061\.(\d+)\.hdf", os.path.basename(f))
    y, doy, prod = int(m.group(1)), int(m.group(2)), m.group(3)
    ts = (pd.Timestamp(year=y, month=1, day=1) + pd.Timedelta(days=doy - 1)).to_period("M").to_timestamp()
    if ts not in by_month or prod > by_month[ts][0]:
        by_month[ts] = (prod, f)
times = pd.DatetimeIndex(sorted(by_month))
print(len(files), "files ->", len(times), "months", times[0].date(), times[-1].date(), flush=True)
if os.path.exists(cache) and np.load(cache, mmap_mode="r").shape[0] == len(times):
    cube = np.load(cache)
else:
    cube = np.full((len(times), 360, 720), np.nan, np.float32)
    for i, ts in enumerate(times):
        a = SD(by_month[ts][1], SDC.READ).select("Snow_Cover_Monthly_CMG").get().astype(np.float32)
        a[a > 100] = np.nan
        a = a[::-1]  # north->south to south->north
        blk = a.reshape(360, 10, 720, 10)
        cnt = np.isfinite(blk).sum((1, 3))
        with np.errstate(all="ignore"):
            m_ = np.nanmean(blk, axis=(1, 3))
        m_[cnt < 50] = np.nan
        cube[i] = m_
    np.save(cache, cube); os.chmod(cache, 0o777)
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
land = hub.land_mask() & (lat[:, None] > -60) & ~(cg == inv.get("Greenland", -9))
w = np.cos(np.deg2rad(lat))[:, None] * np.ones(land.shape)
YRS = np.arange(2001, 2026)
mam = np.full((len(YRS), 360, 720), np.nan, np.float32)
for i, y in enumerate(YRS):
    sel = (times.year == y) & times.month.isin([3, 4, 5])
    if sel.sum() == 3:
        with np.errstate(all="ignore"):
            mam[i] = np.nanmean(cube[sel], 0)
clim = np.nanmean(mam, 0)
snowy = land & (clim >= 10) & (np.isfinite(mam).sum(0) >= 20)
r = tl.ols_ar1(mam.reshape(len(YRS), -1), YRS.astype(float), min_frac=0.8)
mk = tl.mk_grid(mam.reshape(len(YRS), -1))
p = np.where(snowy.ravel(), np.fmax(r["p"], mk["p"]), np.nan)
sig = tl.fdr_mask(p, q=0.10).reshape(land.shape)
tr = np.where(snowy, r["slope"].reshape(land.shape) * 10, np.nan)  # percentage points per decade
f_ = lambda m: float(np.sum(w[m]) / np.sum(w[snowy]))
res = dict(n_months=len(times), snowy_land_frac_sig_down=f_(sig & (tr < 0)), snowy_land_frac_sig_up=f_(sig & (tr > 0)),
           frac_any_down=f_(snowy & (tr < 0)), mean_trend_pp_dec=float(np.nansum(tr[snowy] * w[snowy]) / np.sum(w[snowy])))
ser = pd.Series([float(np.nansum(mam[i][snowy] * w[snowy]) / np.sum(w[snowy][np.isfinite(mam[i][snowy])])) for i in range(len(YRS))],
                index=pd.to_datetime([f"{y}-04-01" for y in YRS]))
st = tl.series_trend(ser, "MAM snow cover", "%", deseasonalize=False)
res["snowy_land_mam_cover"] = dict(first5=float(ser.iloc[:5].mean()), last5=float(ser.iloc[-5:].mean()), slope_pp_dec=st["slope_per_decade"],
                                   p=st["p_ols_ar1"], mk_p=st["mk_annual_p"])
print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in res.items() if not isinstance(v, dict)}, res["snowy_land_mam_cover"], flush=True)
# MERRA-2 snow-share trend over the same years
def annual(var):
    t, a = hub._gd("m2int", var, "native")
    days = t.days_in_month.values.astype(np.float32)
    o = np.zeros((len(YRS), 361, 576), np.float32)
    for i, y in enumerate(YRS):
        m = t.year == y
        o[i] = np.tensordot(days[m], a[m], axes=(0, 0))
    return hub._merra_to_hub(o)
S = annual("PRECSN"); T_ = S + annual("PRECCU") + annual("PRECLS")
with np.errstate(all="ignore"):
    frac = S / T_ * 100
rm = tl.ols_ar1(frac.reshape(len(YRS), -1), YRS.astype(float), min_frac=0.9)
mtr = rm["slope"].reshape(land.shape) * 10
both = snowy & np.isfinite(mtr) & np.isfinite(tr)
res["sign_agree_modis_vs_merra2"] = float(np.sum(w[both & (np.sign(mtr) == np.sign(tr))]) / np.sum(w[both]))
res["sign_agree_where_modis_sig"] = float(np.sum(w[both & sig & (np.sign(mtr) == np.sign(tr))]) / max(np.sum(w[both & sig]), 1e-9))
res["pattern_r_modis_vs_merra2"] = float(np.corrcoef(tr[both], mtr[both])[0, 1])
print("MODIS spring cover vs MERRA-2 snow share (2001-25): sign agreement", round(res["sign_agree_modis_vs_merra2"], 3),
      "where MODIS significant", round(res["sign_agree_where_modis_sig"], 3), "pattern r", round(res["pattern_r_modis_vs_merra2"], 2), flush=True)
regs = {"Alps": (5, 16, 44, 48.5), "Scandinavia": (5, 30, 58, 70), "Rockies": (-125, -104, 37, 55), "High Mountain Asia": (70, 100, 27, 40),
        "Andes (south)": (-75, -66, -50, -30), "Japan & Korea": (126, 146, 33, 45), "NE China & Mongolia": (110, 135, 40, 53),
        "Eastern Europe & W Russia": (25, 60, 48, 62), "Canadian Prairies & boreal": (-120, -85, 50, 62), "Siberia": (60, 140, 55, 70)}
LON, LAT = np.meshgrid(lon, lat)
rows = []
for nm, b in regs.items():
    m = snowy & (LON >= b[0]) & (LON <= b[1]) & (LAT >= b[2]) & (LAT <= b[3])
    if m.sum() < 3:
        continue
    s_ = pd.Series([float(np.nansum(mam[i][m] * w[m]) / np.sum(w[m][np.isfinite(mam[i][m])])) for i in range(len(YRS))], index=ser.index)
    st_ = tl.series_trend(s_, nm, "%", deseasonalize=False)
    rows.append(dict(region=nm, mam_cover_2001_05=float(s_.iloc[:5].mean()), mam_cover_2021_25=float(s_.iloc[-5:].mean()),
                     pp_per_decade=st_["slope_per_decade"], p=st_["p_ols_ar1"], mk_p=st_["mk_annual_p"]))
df = pd.DataFrame(rows).sort_values("pp_per_decade"); df.to_csv(f"{out}/modis_regions_spring_snow_cover.csv", index=False)
print(df.round(3).to_string(), flush=True)
res["regions"] = rows
viz.trend_map(lon, lat, tr, sig, f"{out}/map_modis_spring_snow_cover_trend.png",
              "Spring snow cover from space: MODIS, 2001–2025 (independent check)",
              f"Trend in March–May snow-covered fraction (percentage points per decade). Snowy land: {res['snowy_land_mam_cover']['first5']:.0f}% → "
              f"{res['snowy_land_mam_cover']['last5']:.0f}% covered (2001–05 → 2021–25). Significant decline on {res['snowy_land_frac_sig_down']:.0%}, increase on "
              f"{res['snowy_land_frac_sig_up']:.0%}. Same sign as the MERRA-2 snow-share trend on {res['sign_agree_modis_vs_merra2']:.0%} of snowy land.",
              "spring snow cover change (pp per decade)", vmax=8, cmap="water", source=SRC)
tl.save_json(res, f"{out}/modis_snow_stats.json")
ser.to_csv(f"{out}/modis_snowy_land_mam_cover_pct.csv")
tl.runlog("34b_modis_snow_cover", "done", f"MAM cover sig down {res['snowy_land_frac_sig_down']:.0%} / up {res['snowy_land_frac_sig_up']:.0%}; "
          f"agree with MERRA-2 {res['sign_agree_modis_vs_merra2']:.0%}")
tl.fix_perms(out)
print("done")
