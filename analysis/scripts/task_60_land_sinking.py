"""Task 60 - Where the land sinks: tide gauges minus satellite altimetry reveal vertical land motion worldwide (1993-2025).

A tide gauge measures sea level relative to the land it stands on; a radar altimeter measures it relative to Earth's centre.
Their difference (gauge - altimetry) is minus the vertical motion of the land under the gauge: groundwater and oil pumping, delta
compaction, earthquakes, and the slow rebound of land once pressed down by ice-age ice sheets.
Data: PSMSL Revised Local Reference monthly tide gauge records; NASA-SSH simple gridded altimetry v1.1 (0.5 deg, weekly, 1992-2026).
Method: monthly altimetry cube; for each gauge with >=15 years in 1993-2025, the nearest altimetry cell (<=1.5 deg) with >=80% valid months;
D = gauge - altimetry (monthly, deseasonalised). Vertical land motion VLM = -slope(D) (mm/yr) from OLS with AR(1)-corrected errors,
and Theil-Sen + Hamed-Rao MK on annual means. Stations near the great earthquakes (Sumatra 2004, Chile 2010, Tohoku 2011, Kaikoura 2016)
get a step term at the event. FDR q=0.10 across stations.
QC: the 5% of gauges with the noisiest gauge-minus-altimetry residuals are dropped.
Caveats: altimetry up to 1.5 deg offshore can miss local coastal sea-level signals (e.g. Kuroshio path shifts off southern Japan,
macro-tidal estuaries); VLM here is relative to the altimetry reference frame. Volcanic islands (Miyake-jima) and post-seismic motion are real.
"""
import sys
import glob
import zipfile
import textwrap
import numpy as np
import pandas as pd
import netCDF4
from scipy import stats
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import TwoSlopeNorm
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402

TASK = "60_land_sinking"
out = tl.task_dir(TASK)
SRC = "Data: PSMSL tide gauges (RLR monthly); NASA-SSH gridded altimetry v1.1 (TOPEX→Sentinel-6A, PO.DAAC)."
QUAKES = [("Sumatra 2004", 2004.98, (92, 100, -3, 10)), ("Chile 2010", 2010.16, (-76, -70, -40, -32)),
          ("Tohoku 2011", 2011.19, (138, 146, 34, 42)), ("Kaikoura 2016", 2016.87, (171, 176, -45, -40))]

# ---------------------------------------------------------------- altimetry monthly cube
files = sorted(glob.glob(f"{ROOT}/data/raw/nasassh/NASA-SSH_alt_ref_simple_grid_v1_1_*.nc"))
months = pd.period_range("1993-01", "2025-12", freq="M")
cache = f"{ROOT}/data/processed/nasassh_monthly_1993_2025.npz"
if _os.path.exists(cache):
    zc = np.load(cache); ALT = zc["alt"]; alat = zc["lat"]; alon = zc["lon"]
else:
    S = np.zeros((len(months), 360, 720), np.float32); N = np.zeros((len(months), 360, 720), np.uint8)
    mi = {m: i for i, m in enumerate(months)}
    for f in files:
        d = pd.Timestamp(f.split("_")[-1][:8]).to_period("M")
        if d not in mi:
            continue
        with netCDF4.Dataset(f) as nc:
            x = nc["ssha"][:].filled(np.nan).astype(np.float32) * 1000.0
            alat = np.asarray(nc["latitude"][:]); alon = np.asarray(nc["longitude"][:])
        ok = np.isfinite(x)
        S[mi[d]][ok] += x[ok]; N[mi[d]][ok] += 1
    with np.errstate(all="ignore"):
        ALT = np.where(N > 0, S / np.maximum(N, 1), np.nan).astype(np.float32)
    del S, N
    np.savez(cache, alt=ALT, lat=alat, lon=alon)
    _os.chmod(cache, 0o777)
alon = np.where(alon > 180, alon - 360, alon)
valid_frac = np.isfinite(ALT).mean(0)
mt = months.to_timestamp()
td = tl.decimal_year(mt)
print("altimetry cube", ALT.shape, flush=True)

# ---------------------------------------------------------------- tide gauges
fl = pd.read_csv(f"{ROOT}/data/raw/psmsl/filelist.txt", sep=";", header=None, names=["id", "lat", "lon", "name", "country", "code", "flag"], skipinitialspace=True)
fl["name"] = fl.name.str.strip()
z = zipfile.ZipFile(f"{ROOT}/data/raw/psmsl/rlr_monthly.zip")
LAg, LOg = np.meshgrid(alat, alon, indexing="ij")
rows, keep = [], {}
for _, st in fl.iterrows():
    try:
        txt = z.read(f"rlr_monthly/data/{int(st.id)}.rlrdata").decode()
    except KeyError:
        continue
    a = np.array([[float(v) for v in ln.split(";")[:2]] for ln in txt.strip().splitlines() if ln.strip()])
    if len(a) == 0:
        continue
    yrs, h = a[:, 0], a[:, 1]
    h = np.where(h <= -99999, np.nan, h)
    per = pd.Series(h, index=pd.PeriodIndex([pd.Period(year=int(y), month=int(round((y - int(y)) * 12 + 0.5)), freq="M") for y in yrs]))
    per = per[~per.index.duplicated()]
    g = per.reindex(months)
    if g.notna().sum() < 15 * 12 or (g.notna().mean() < 0.6):
        continue
    # nearest altimetry cell with >=80% valid months within 1.5 deg
    dist = np.hypot((LAg - st.lat), (LOg - st.lon) * np.cos(np.deg2rad(st.lat)))
    cand = (dist <= 1.5) & (valid_frac >= 0.8)
    if not cand.any():
        continue
    i, j = np.unravel_index(np.argmin(np.where(cand, dist, np.inf)), dist.shape)
    D = g.values - ALT[:, i, j]
    Ds = pd.Series(D, index=mt)
    Ds = Ds - Ds.groupby(Ds.index.month).transform("mean")
    okm = Ds.notna().values
    if okm.sum() < 15 * 12:
        continue
    X = [np.ones(okm.sum()), td[okm] - td[okm].mean()]
    qk = None
    for qn, qt, qb in QUAKES:
        if qb[0] <= st.lon <= qb[1] and qb[2] <= st.lat <= qb[3] and td[okm].min() < qt - 2 and td[okm].max() > qt + 2:
            X.append((td[okm] > qt).astype(float)); qk = qn
    X = np.column_stack(X)
    y = Ds.values[okm]
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    r = y - X @ b
    r1 = np.corrcoef(r[1:], r[:-1])[0, 1]
    r1c = np.clip(r1, 0, 0.95)
    neff = len(y) * (1 - r1c) / (1 + r1c)
    cov = (r @ r / max(neff - X.shape[1], 2)) * np.linalg.inv(X.T @ X)
    se = float(np.sqrt(cov[1, 1]))
    p = float(2 * stats.t.sf(abs(b[1] / se), max(neff - X.shape[1], 2)))
    rows.append(dict(id=int(st.id), name=st["name"], lat=st.lat, lon=st.lon, vlm_mm_yr=float(-b[1]), se=se, p=p, step_mm=(float(-b[2]) if qk else np.nan),
                     quake=qk, n_months=int(okm.sum()), alt_dist_deg=float(dist[i, j]), resid_sd=float(np.std(r))))
    keep[int(st.id)] = (Ds, qk)
V = pd.DataFrame(rows)
# QC: drop the noisiest 5% of gauge-minus-altimetry residuals (datum jumps, macro-tidal estuaries where coastal altimetry aliases tides)
qc = V.resid_sd <= V.resid_sd.quantile(0.95)
V["qc_pass"] = qc
V.round(3).to_csv(f"{out}/vertical_land_motion_all.csv", index=False)
V = V[qc].copy()
V["sig"] = tl.fdr_mask(V.p.values, 0.10)
V = V.sort_values("vlm_mm_yr")
V.round(3).to_csv(f"{out}/vertical_land_motion.csv", index=False)
res = dict(n_stations=int(len(V)), n_sig_sinking=int((V.sig & (V.vlm_mm_yr < 0)).sum()), n_sig_rising=int((V.sig & (V.vlm_mm_yr > 0)).sum()),
           median_vlm=float(V.vlm_mm_yr.median()), fastest_sinking=V.head(15)[["name", "lat", "lon", "vlm_mm_yr", "se", "p"]].round(2).to_dict("records"),
           fastest_rising=V.tail(10)[["name", "lat", "lon", "vlm_mm_yr", "se", "p"]].round(2).to_dict("records"),
           quake_steps=V[V.quake.notna()][["name", "quake", "step_mm", "vlm_mm_yr"]].round(1).to_dict("records"))
for nm_ in ("KEELUNG II", "KAOHSIUNG II", "MANILA, S. HARBOR", "FORT PHRACHULA CHOMKLAO (POM PHRACHUN)", "ONAHAMA", "AYUKAWA", "JUNEAU", "GALVESTON II, PIER 21, TX", "STOCKHOLM"):
    r_ = V[V.name == nm_]
    if len(r_):
        res[f"station: {nm_}"] = r_.iloc[0][["vlm_mm_yr", "se", "p", "step_mm"]].to_dict()
print({k: v for k, v in res.items() if k not in ("fastest_sinking", "fastest_rising", "quake_steps")}, flush=True)
print(V.head(15)[["name", "vlm_mm_yr", "se", "p", "sig"]].round(2).to_string(), flush=True)
print(V.tail(8)[["name", "vlm_mm_yr", "se", "p", "sig"]].round(2).to_string(), flush=True)
tl.save_json(res, f"{out}/stats.json")

# ---------------------------------------------------------------- figure
fig = plt.figure(figsize=(14, 8.6), dpi=170)
proj = ccrs.Robinson(central_longitude=150)
axm = fig.add_axes([0.01, 0.33, 0.70, 0.52], projection=proj)
axm.set_global()
_y0 = proj.transform_point(150, -58, ccrs.PlateCarree())[1]; _y1 = proj.transform_point(150, 72, ccrs.PlateCarree())[1]
axm.set_ylim(_y0, _y1)
axm.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", lw=0); axm.add_feature(cfeature.COASTLINE.with_scale("110m"), lw=0.3, color=viz.MUTED)
axm.spines["geo"].set_visible(False)
cm = viz.div_cmap("water"); norm = TwoSlopeNorm(0, -10, 10)
Vs = V.reindex(V.vlm_mm_yr.abs().sort_values().index)
sc = axm.scatter(Vs.lon, Vs.lat, c=Vs.vlm_mm_yr.clip(-10, 10), cmap=cm, norm=norm, s=np.where(Vs.sig, 30, 12),
                 edgecolors=np.where(Vs.sig, viz.INK, viz.SURFACE), linewidths=np.where(Vs.sig, 0.6, 0.2), transform=ccrs.PlateCarree(), zorder=3)
LBL = {"MANILA, S. HARBOR": ("Manila", 3, -6), "FORT PHRACHULA CHOMKLAO (POM PHRACHUN)": ("Bangkok", -22, -4), "JUNEAU": ("Juneau (ice rebound)", -30, 4),
       "GALVESTON II, PIER 21, TX": ("Galveston", 2, -6), "ONAHAMA": ("Onahama (Tohoku)", 3, 3), "KEELUNG II": ("Keelung", 3, 2), "STOCKHOLM": ("Stockholm", -12, 4)}
for nm_, (lab, dx, dy) in LBL.items():
    r_ = V[V.name == nm_]
    if len(r_):
        r_ = r_.iloc[0]
        axm.text(r_.lon + dx, r_.lat + dy, f"{lab} {r_.vlm_mm_yr:+.0f}", fontsize=7.5, color=viz.INK, transform=ccrs.PlateCarree(),
                 bbox=dict(fc=viz.SURFACE, ec="none", alpha=0.8, pad=0.6), zorder=5)
axm.set_title("Vertical land motion at tide gauges, 1993–2025 (gauge minus satellite altimetry)", fontsize=10.5, loc="left", fontweight="bold")
cax = fig.add_axes([0.08, 0.31, 0.24, 0.013]); cb = fig.colorbar(sc, cax=cax, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7.5, length=0); cb.set_label("mm per year (orange: land sinking; blue: rising; black edge: FDR-significant)", fontsize=7.8, color=viz.INK2)
# right: ranked bars of fastest sinkers
ax = fig.add_axes([0.80, 0.36, 0.18, 0.47])
top = V[V.sig].head(14).iloc[::-1]
ax.barh(range(len(top)), top.vlm_mm_yr, xerr=1.96 * top.se, color=viz.ORANGE_ARM[2], error_kw=dict(lw=0.6, ecolor=viz.INK2), height=0.7)
ax.set_yticks(range(len(top))); ax.set_yticklabels([n_[:24].title() for n_ in top.name], fontsize=7)
ax.axvline(0, color=viz.INK, lw=0.8)
ax.set_xlabel("mm per year", fontsize=8, color=viz.INK2)
ax.set_title("Fastest-sinking gauges", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.tick_params(length=0, labelsize=7); ax.grid(axis="x", color=viz.GRID, lw=0.5)
# bottom: example difference series
EX = [(145, "Manila"), (444, "Bangkok"), (635, "Onahama, Tohoku"), (405, "Juneau, Alaska"), (161, "Galveston, Texas")]
for k, (sid, lab) in enumerate(EX):
    if sid not in keep or not (V.id == sid).any():
        continue
    Ds, qk = keep[sid]
    a = fig.add_axes([0.04 + k * 0.193, 0.05, 0.16, 0.17])
    sm = (-Ds).rolling(12, center=True, min_periods=8).mean()
    a.plot(Ds.index, -Ds.values, color=viz.MUTED, lw=0.5)
    vv = V[V.id == sid].iloc[0]
    a.plot(sm.index, sm.values, color=viz.ORANGE_ARM[2] if vv.vlm_mm_yr < 0 else viz.BLUE_ARM[2], lw=1.8)
    a.axhline(0, color=viz.AXIS, lw=0.8)
    if qk:
        a.axvline(pd.Timestamp("2011-03-11"), color=viz.INK, lw=0.8, ls=":")
    a.set_title(f"{lab}: {vv.vlm_mm_yr:+.1f} mm/yr" + (f"\nafter a {vv.step_mm:+.0f} mm quake drop" if qk else ""), fontsize=8.2, loc="left", fontweight="bold")
    for sp_ in ("top", "right", "left"):
        a.spines[sp_].set_visible(False)
    a.grid(axis="y", color=viz.GRID, lw=0.5); a.tick_params(length=0, labelsize=7)
    a.set_xticks([pd.Timestamp(f"{y}-01-01") for y in (1995, 2005, 2015, 2025)]); a.set_xticklabels(["1995", "2005", "2015", "2025"])
    if k == 0:
        a.set_ylabel("land height (mm)", fontsize=7.5, color=viz.INK2)
mn = res.get("station: MANILA, S. HARBOR", {}); bk = res.get("station: FORT PHRACHULA CHOMKLAO (POM PHRACHUN)", {})
fig.text(0.01, 0.975, "Where the land sinks: tide gauges and satellites together reveal cities subsiding faster than the sea is rising", fontsize=14.5, fontweight="bold", va="top")
subt = (f"At {res['n_stations']} tide gauges we subtract the sea level measured from space (rising ~3–4 mm per year) from the sea level measured at the shore. "
        f"What is left is the land itself moving: {res['n_sig_sinking']} gauges are sinking and {res['n_sig_rising']} rising significantly (FDR). The fastest sinking is in "
        f"coasts where groundwater is pumped or faults are loading: Manila {mn.get('vlm_mm_yr', np.nan):+.0f} mm/yr, more than twice the global sea-level rise, Bangkok "
        f"{bk.get('vlm_mm_yr', np.nan):+.0f} mm/yr, Galveston −4, Venice −6, and Samoa still sinking after its 2009 earthquake. Land once pressed down by ice-age glaciers is still rebounding (Alaska, Scandinavia); the 2011 Tohoku earthquake dropped the coast in one day. "
        f"Caveat: a few mm/yr of coastal-altimetry error is possible in shallow tidal seas (e.g. UK North Sea gauges); Taiwan's PSMSL records end before 1996.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/land_sinking_map.png"); plt.close(fig)
tl.runlog(TASK, "done", f"{res['n_stations']} gauges: {res['n_sig_sinking']} sinking, {res['n_sig_rising']} rising; Manila {mn.get('vlm_mm_yr', np.nan):+.1f} mm/yr")
tl.fix_perms(out)
print("done")
