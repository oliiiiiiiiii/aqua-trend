"""Task 20c - Cross-model check of the ET results with MERRA-2 land (independent land model + gauge-corrected rain).

(1) ELI from MERRA-2: r(EVLAND, GWETROOT) - r(EVLAND, SWLAND+LWLAND); pattern agreement with GLDAS ELI.
(2) ELI shift 2014-25 vs 2003-13 with placebo + block bootstrap (as task 20b).
(3) ET trends: MERRA-2 EVLAND vs GLDAS Evap - sign agreement of significant trends.
(4) Basin runoff ratio change with MERRA-2 (P = PRECTOTLAND, R = RUNOFF + BASEFLOW) vs GLDAS (task 27).
"""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import glob
import numpy as np
import pandas as pd
import xarray as xr

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402
import hotspots as hs  # noqa: E402

TASK = "20_et_correlations"
out = tl.task_dir(TASK)
SRC = "Data: NASA MERRA-2 land (M2TMNXLND: EVLAND, GWETROOT, SWLAND+LWLAND, PRECTOTLAND, RUNOFF+BASEFLOW). AR(1)-adjusted r, FDR."
lon, lat = hub.LON, hub.LAT
land = hub.land_mask() & (lat[:, None] > -58)
cg, names = hs.country_grid(lon, lat); inv = {v: k for k, v in names.items()}
land &= ~(cg == inv.get("Greenland", -9))
w = np.cos(np.deg2rad(lat))[:, None] * np.ones((360, 720))
E, S, R = hub.load("et_m2land"), hub.load("sm_m2"), hub.load("rn_m2")
(E, S, R), t = hub.align(E, S, R, start="2003-01-01")
print("MERRA-2 land months:", len(t), t[0].date(), t[-1].date(), flush=True)


def eli(sel):
    tt = t[sel]
    a = tl.grid_corr(E.values[sel], S.values[sel], tt)["r"]
    b = tl.grid_corr(E.values[sel], R.values[sel], tt)["r"]
    return np.where(land, a - b, np.nan)


yrs = t.year.values
eli_all = eli(np.ones(len(t), bool))
g20 = xr.open_dataset(f"{out}/correlation_fields.nc")
ok = land & np.isfinite(eli_all) & np.isfinite(g20["ELI"].values)
pat_r = float(np.corrcoef(eli_all[ok], g20["ELI"].values[ok])[0, 1])
sign_agree = float(np.sum(w[ok] * (np.sign(eli_all[ok]) == np.sign(g20["ELI"].values[ok]))) / np.sum(w[ok]))
print(f"ELI pattern: r(MERRA-2, GLDAS) = {pat_r:+.2f}; sign agreement {sign_agree:.0%} of land", flush=True)
viz.trend_map(lon, lat, eli_all, ok, f"{out}/map_ELI_MERRA2.png", "What limits evaporation? (independent check with MERRA-2)",
              f"ELI from MERRA-2 land. Pattern correlation with the GLDAS map: r = {pat_r:+.2f}; same sign on {sign_agree:.0%} of land.",
              "ELI (−1 energy-limited … +1 water-limited)", vmax=1.0, cmap=viz.div_cmap("water").reversed(), source=SRC)
real = eli(yrs >= 2014) - eli(yrs <= 2013)
plac = eli(yrs % 2 == 1) - eli(yrs % 2 == 0)
ok2 = land & np.isfinite(real) & np.isfinite(plac)
res = {"pattern_r_vs_gldas": pat_r, "sign_agreement": sign_agree}
for nm, d in (("real", real), ("placebo", plac)):
    v = d[ok2]; ww = w[ok2]
    res[nm] = dict(mean=float(np.sum(v * ww) / np.sum(ww)), frac_gt_0p2=float(np.sum(ww[v > 0.2]) / np.sum(ww)),
                   frac_lt_m0p2=float(np.sum(ww[v < -0.2]) / np.sum(ww)))
blk = (np.floor((lat[:, None] + 90) / 5) * 100 + np.floor((lon[None, :] + 180) / 5)).astype(int)
ids = np.unique(blk[ok2]); rng = np.random.default_rng(0)
vals = {i: (real[ok2 & (blk == i)], w[ok2 & (blk == i)]) for i in ids}
boots = []
for _ in range(2000):
    pick = rng.choice(ids, size=len(ids), replace=True)
    boots.append(sum(np.sum(vals[i][0] * vals[i][1]) for i in pick) / sum(np.sum(vals[i][1]) for i in pick))
res["real"]["ci95"] = [float(x) for x in np.percentile(boots, [2.5, 97.5])]
dg = g20["ELI_late"].values - g20["ELI_early"].values
ok3 = ok2 & np.isfinite(dg)
res["shift_pattern_r_vs_gldas"] = float(np.corrcoef(real[ok3], dg[ok3])[0, 1])
print("ELI shift MERRA-2:", res["real"], "placebo:", res["placebo"], "shift-pattern r vs GLDAS:", round(res["shift_pattern_r_vs_gldas"], 2), flush=True)
viz.trend_map(lon, lat, real, ok2 & (np.abs(real) > 0.2), f"{out}/map_ELI_shift_MERRA2.png",
              "Shift toward water-limited evaporation — MERRA-2 check",
              f"Change in ELI 2014–25 vs 2003–13 from MERRA-2: mean {res['real']['mean']:+.3f} (95% CI {res['real']['ci95'][0]:+.3f}…{res['real']['ci95'][1]:+.3f}); "
              f"placebo {res['placebo']['mean']:+.3f}. Brown = toward water limitation.", "ΔELI", vmax=0.8,
              cmap=viz.div_cmap("water").reversed(), source=SRC)
# ET trends: MERRA-2 vs GLDAS
(Ea,), te = hub.align(hub.load("et_m2land"), start="2001-01-01", end="2025-12-31")
gm = tl.grid_trends(Ea.values, te, annual_min=10)
(Ga,), tg = hub.align(hub.load("et_gldas"), start="2001-01-01", end="2025-12-31")
gg = tl.grid_trends(Ga.values, tg, annual_min=10)
sm_, sg_ = gm["sig_both"] & land, gg["sig_both"] & land
both = sm_ & sg_
res["ET_trend"] = dict(merra2_sig_up=float(np.mean(sm_ & (gm["slope_dec"] > 0)) / np.mean(land)),
                       merra2_sig_down=float(np.mean(sm_ & (gm["slope_dec"] < 0)) / np.mean(land)),
                       gldas_sig_up=float(np.mean(sg_ & (gg["slope_dec"] > 0)) / np.mean(land)),
                       both_sig_same_sign=float(np.mean(both & (np.sign(gm["slope_dec"]) == np.sign(gg["slope_dec"]))) / np.mean(land)),
                       both_sig_opposite=float(np.mean(both & (np.sign(gm["slope_dec"]) != np.sign(gg["slope_dec"]))) / np.mean(land)))
print("ET trends:", {k: round(v, 3) for k, v in res["ET_trend"].items()}, flush=True)
agree = np.where(both & (np.sign(gm["slope_dec"]) == np.sign(gg["slope_dec"])), (gm["slope_dec"] + gg["slope_dec"]) / 2, np.nan)
viz.trend_map(lon, lat, agree * 365 / 10, np.isfinite(agree), f"{out}/map_ET_trend_models_agree.png",
              "Where two independent models agree evaporation is changing",
              "ET trend shown only where GLDAS and MERRA-2 both have significant trends of the same sign (mean of the two, 2001–2025).",
              "ET trend (mm/yr per decade)", vmax=60, cmap="water", source=SRC + " + GLDAS-2.1.")
# basin runoff ratio with MERRA-2
import geopandas as gpd, regionmask
HB = ROOT + "/data/raw/hydrobasins/unz"
gdf = pd.concat([gpd.read_file(f) for f in sorted(glob.glob(f"{HB}/hybas_*_lev03_v1c.shp"))], ignore_index=True)
gdf = gdf[gdf["SUB_AREA"] > 60000].reset_index(drop=True); gdf["bid"] = np.arange(len(gdf))
mask = regionmask.from_geopandas(gdf, numbers="bid", names="HYBAS_ID", overlap=False).mask(lon, lat, wrap_lon=False).values
(Pm, Rm), tb = hub.align(hub.load("p_m2land"), hub.load("ro_m2"), start="2001-01-01", end="2025-12-31")
rows = []
for b in range(len(gdf)):
    m = mask == b
    if m.sum() < 4:
        continue
    ww = w[m]
    rr = []
    for y in range(2001, 2026):
        sel = tb.year == y
        p_ = np.nansum(np.nanmean(Pm.values[sel][:, m], 0) * ww); r_ = np.nansum(np.nanmean(Rm.values[sel][:, m], 0) * ww)
        rr.append(r_ / p_ if p_ > 0 else np.nan)
    rr = np.array(rr)
    st = tl.series_trend(pd.Series(rr, index=pd.to_datetime([f"{y}-07-01" for y in range(2001, 2026)])), "rr", "-", deseasonalize=False)
    rows.append(dict(HYBAS_ID=int(gdf.loc[b, "HYBAS_ID"]), RR_early=float(np.nanmean(rr[:12])), RR_late=float(np.nanmean(rr[12:])),
                     p=st["p_ols_ar1"], mk=st["mk_hr_p"]))
bm = pd.DataFrame(rows); bm["sig"] = (bm.p < 0.05) & (bm.mk < 0.05); bm["dRR"] = bm.RR_late - bm.RR_early
bm.to_csv(f"{out}/../27_budyko_basins/basins_runoff_ratio_MERRA2.csv", index=False)
gl = pd.read_csv(f"{out}/../27_budyko_basins/basins_budyko.csv")
mm = bm.merge(gl[["HYBAS_ID", "dRR", "sig_RR"]], on="HYBAS_ID", suffixes=("_m2", "_gldas"))
res["basins"] = dict(n=len(bm), merra2_sig_down=int(((bm.dRR < 0) & bm.sig).sum()), merra2_sig_up=int(((bm.dRR > 0) & bm.sig).sum()),
                     both_sig_down=int(((mm.dRR_m2 < 0) & mm.sig & (mm.dRR_gldas < 0) & mm.sig_RR).sum()),
                     dRR_corr=float(np.corrcoef(mm.dRR_m2, mm.dRR_gldas)[0, 1]))
print("basins:", res["basins"], flush=True)
# Taiwan: does MERRA-2 also show rising ET / falling runoff?
tw = (119.9, 122.1, 21.8, 25.4)
for nm_, da_ in (("ET_m2", hub.load("et_m2land")), ("P_m2", hub.load("p_m2land")), ("R_m2", hub.load("ro_m2")),
                 ("ET_gldas", hub.load("et_gldas"))):
    s_ = tl.area_mean(da_, tw).to_series()["2001":"2025"]
    st_ = tl.series_trend(s_, nm_, "mm/day")
    res.setdefault("taiwan", {})[nm_] = dict(mean_mm_yr=float(s_.mean() * 365), pct_dec=st_["pct_per_decade"], p=st_["p_ols_ar1"])
print("Taiwan:", {k: {kk: round(vv, 3) for kk, vv in v.items()} for k, v in res["taiwan"].items()}, flush=True)
tl.save_json(res, f"{out}/merra2_crosscheck.json")
tl.runlog("20c_merra2_crosscheck", "done", f"ELI pattern r={pat_r:+.2f}; MERRA-2 shift {res['real']['mean']:+.3f} CI {res['real']['ci95']}")
tl.fix_perms()
print("done")
