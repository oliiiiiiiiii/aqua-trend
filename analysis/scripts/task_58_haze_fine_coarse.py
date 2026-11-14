"""Task 58 - Is Asia's haze getting finer or coarser? AERONET fine-mode (combustion) vs coarse-mode (dust, sea salt) aerosol trends.

Data: NASA AERONET v3 Level 2.0 Spectral Deconvolution Algorithm (SDA, O'Neill et al.) daily fine-mode and coarse-mode AOD at 500 nm.
Fine mode (sub-micron) ~ combustion: power plants, traffic, biomass burning, secondary sulfate/nitrate; coarse mode ~ mineral dust, sea salt.
Method: monthly means (>=3 clear-sky days) -> anomalies vs each site's monthly climatology -> annual means (>=6 months), 2005-2025;
Theil-Sen % per decade + Hamed-Rao modified Mann-Kendall, for sites with >=10 annual values spanning >=12 years. FDR q=0.10 over all tests.
"""
import sys
import glob
import textwrap
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
sys.path.insert(0, f"{ROOT}/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402

TASK = "58_haze_fine_coarse"
out = tl.task_dir(TASK)
SRC = "Data: NASA AERONET v3 Level 2.0 Spectral Deconvolution (fine/coarse aerosol optical depth at 500 nm)."
loc = pd.read_csv(f"{ROOT}/data/raw/aeronet/aeronet_locations_v3.txt", skiprows=1).set_index("Site_Name")
REGION = {"East Asia": (100, 150, 20, 50), "Southeast Asia": (95, 125, -10, 20), "South Asia": (60, 95, 5, 35), "Middle East": (35, 60, 15, 35)}


def region(lat, lon):
    for k, (a, b, c, d) in REGION.items():
        if a <= lon <= b and c <= lat <= d:
            return k
    return "other"


def annual(s):
    s = s.dropna()
    m = s.groupby(s.index.to_period("M")).agg(["mean", "size"])
    m = m[m["size"] >= 3]["mean"]; m.index = m.index.to_timestamp()
    clim = m.groupby(m.index.month).mean()
    an = m - clim.reindex(m.index.month).values
    yr = an.groupby(an.index.year).agg(["mean", "size"]); yr = yr[yr["size"] >= 6]["mean"]
    return yr + clim.mean(), float(clim.mean())


rows, store = [], {}
for f in sorted(glob.glob(f"{ROOT}/data/processed/aeronet_sda/*.csv")):
    s = _os.path.basename(f)[:-4]
    d = pd.read_csv(f, parse_dates=["date"]).set_index("date")
    if d.empty or s not in loc.index:
        continue
    r = dict(site=s, lat=loc.loc[s, "Latitude(decimal_degrees)"], lon=loc.loc[s, "Longitude(decimal_degrees)"])
    r["region"] = region(r["lat"], r["lon"])
    ok = True
    for v in ("tau_f", "tau_c", "eta"):
        yr, mean = annual(d[v])
        yr = yr.loc[2005:2025]
        if len(yr) < 10 or yr.index.max() - yr.index.min() < 12:
            ok = False; break
        mk = tl._mk_hr(yr.values)
        r[f"{v}_mean"] = mean
        r[f"{v}_pct_dec"] = float(mk["sen"] * 10 / mean * 100) if v != "eta" else float(mk["sen"] * 10)
        r[f"{v}_p"] = float(mk["p"])
        store.setdefault(s, {})[v] = yr
    if ok:
        r["n_years"] = int(len(store[s]["tau_f"])); r["first"] = int(store[s]["tau_f"].index.min()); r["last"] = int(store[s]["tau_f"].index.max())
        rows.append(r)
S = pd.DataFrame(rows).set_index("site")
allp = np.concatenate([S.tau_f_p.values, S.tau_c_p.values])
sig = tl.fdr_mask(allp, 0.10)
S["tau_f_sig"] = sig[:len(S)]; S["tau_c_sig"] = sig[len(S):]
S.round(4).to_csv(f"{out}/site_fine_coarse_trends.csv")
print(S[["region", "first", "last", "tau_f_mean", "tau_f_pct_dec", "tau_f_p", "tau_c_mean", "tau_c_pct_dec", "tau_c_p", "eta_pct_dec"]].round(3).to_string(), flush=True)
res = dict(n_sites=int(len(S)))
for reg in REGION:
    sub = S[S.region == reg]
    if len(sub):
        res[reg] = dict(n=int(len(sub)), median_fine_pct_dec=float(sub.tau_f_pct_dec.median()), median_coarse_pct_dec=float(sub.tau_c_pct_dec.median()),
                        fine_sig_down=int((sub.tau_f_sig & (sub.tau_f_pct_dec < 0)).sum()), fine_sig_up=int((sub.tau_f_sig & (sub.tau_f_pct_dec > 0)).sum()),
                        coarse_sig_down=int((sub.tau_c_sig & (sub.tau_c_pct_dec < 0)).sum()), coarse_sig_up=int((sub.tau_c_sig & (sub.tau_c_pct_dec > 0)).sum()),
                        median_eta_change_per_dec=float(sub.eta_pct_dec.median()))
res["sites"] = S.round(4).to_dict("index")
print({k: v for k, v in res.items() if k != "sites"}, flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.8), dpi=170)
order = ["East Asia", "Southeast Asia", "South Asia", "Middle East"]
S2 = S[S.region.isin(order)].copy()
S2["ro"] = S2.region.map({k: i for i, k in enumerate(order)})
S2 = S2.sort_values(["ro", "tau_f_pct_dec"], ascending=[False, False])
ax = fig.add_axes([0.17, 0.08, 0.40, 0.76])
yy = np.arange(len(S2))
CF, CC = viz.SERIES[1], viz.SERIES[3]
for i, (s, r) in enumerate(S2.iterrows()):
    ax.plot([r.tau_f_pct_dec, r.tau_c_pct_dec], [i, i], color=viz.GRID, lw=1.5, zorder=1)
    ax.scatter(r.tau_f_pct_dec, i, s=46 if r.tau_f_sig else 26, color=CF if r.tau_f_sig else viz.SURFACE, edgecolors=CF, linewidths=1.3, zorder=3)
    ax.scatter(r.tau_c_pct_dec, i, s=46 if r.tau_c_sig else 26, marker="s", color=CC if r.tau_c_sig else viz.SURFACE, edgecolors=CC, linewidths=1.3, zorder=3)
ax.set_yticks(yy); ax.set_yticklabels([f"{s.replace('_', ' ')} ({r.first}–{r.last})" for s, r in S2.iterrows()], fontsize=7.6)
ax.axvline(0, color=viz.INK, lw=0.8)
prev = None
for i, (s, r) in enumerate(S2.iterrows()):
    if r.region != prev:
        ax.text(-0.42, i, r.region, transform=ax.get_yaxis_transform(), fontsize=9, fontweight="bold", color=viz.INK, va="center", ha="left") if False else None
        if prev is not None:
            ax.axhline(i - 0.5, color=viz.AXIS, lw=0.8)
        prev = r.region
for reg in order:
    idx_ = [i for i, (s, r) in enumerate(S2.iterrows()) if r.region == reg]
    if idx_:
        ax.text(1.01, np.mean(idx_), reg, transform=ax.get_yaxis_transform(), fontsize=9, fontweight="bold", color=viz.INK, va="center")
ax.set_xlim(-80, 60)
ax.set_xlabel("trend 2005–2025 (% per decade)", color=viz.INK2)
ax.scatter([], [], color=CF, s=40, label="fine mode (combustion)"); ax.scatter([], [], color=CC, marker="s", s=40, label="coarse mode (dust, sea salt)")
ax.scatter([], [], color=viz.SURFACE, edgecolors=viz.INK2, s=26, label="hollow: not significant (FDR)")
ax.legend(frameon=False, fontsize=8, loc="upper right")
for sp_ in ("top", "right", "left"):
    ax.spines[sp_].set_visible(False)
ax.grid(axis="x", color=viz.GRID, lw=0.5); ax.tick_params(length=0)
ax.set_title("Fine vs coarse aerosol trend at each AERONET station", fontsize=10, loc="left", fontweight="bold")
# right: example stations
EX = [s for s in ("Beijing-CAMS", "Beijing", "Taipei_CWB", "EPA-NCU", "Kanpur", "Gandhi_College", "Solar_Village", "Mezaira") if s in store]
picks = []
for grp in (("Beijing-CAMS", "Beijing"), ("Taipei_CWB", "EPA-NCU"), ("Gandhi_College", "Kanpur"), ("Solar_Village", "Mezaira")):
    for g_ in grp:
        if g_ in store:
            picks.append(g_); break
for k, s in enumerate(picks):
    a = fig.add_axes([0.74, 0.70 - k * 0.205, 0.24, 0.15])
    f_, c_ = store[s]["tau_f"], store[s]["tau_c"]
    idx_ = f_.index.intersection(c_.index)
    a.stackplot(idx_, f_[idx_].values, c_[idx_].values, colors=[CF, CC], alpha=0.85, lw=0)
    a.set_xlim(2004.5, 2025.5); a.set_xticks([2005, 2010, 2015, 2020, 2025])
    a.set_title(f"{s.replace('_', ' ')}: fine {S.loc[s, 'tau_f_pct_dec']:+.0f}%, coarse {S.loc[s, 'tau_c_pct_dec']:+.0f}% /decade", fontsize=8.6, loc="left", fontweight="bold")
    for sp_ in ("top", "right", "left"):
        a.spines[sp_].set_visible(False)
    a.grid(axis="y", color=viz.GRID, lw=0.5); a.tick_params(length=0, labelsize=7)
    a.set_ylabel("AOD 500 nm", fontsize=7.5, color=viz.INK2)
ea, sa, me = res.get("East Asia", {}), res.get("South Asia", {}), res.get("Middle East", {})
fig.text(0.01, 0.975, "Asia's haze is changing grain: combustion particles collapse in East Asia and grow in South Asia, while dust falls in both",
         fontsize=14.2, fontweight="bold", va="top")
subt = (f"NASA's AERONET sun-photometers split aerosol into fine particles (smoke, soot, sulfate and nitrate from burning) and coarse particles (desert dust, sea salt). "
        f"At {ea.get('n', 0)} East Asian stations the fine mode fell a median {ea.get('median_fine_pct_dec', np.nan):+.0f}% per decade ({ea.get('fine_sig_down', 0)} significant), "
        f"the fingerprint of cleaner power plants and traffic; coarse dust fell less ({ea.get('median_coarse_pct_dec', np.nan):+.0f}%). At all {sa.get('n', 0)} South Asian stations the "
        f"fine mode rose (median {sa.get('median_fine_pct_dec', np.nan):+.0f}% per decade, {sa.get('fine_sig_up', 0)} significant) while the coarse mode fell "
        f"({sa.get('median_coarse_pct_dec', np.nan):+.0f}%): South Asia's haze is becoming more combustion-dominated even as its dust declines (task 51).")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/haze_fine_vs_coarse.png"); plt.close(fig)
tl.runlog(TASK, "done", f"median fine/coarse %/dec: EA {ea.get('median_fine_pct_dec', np.nan):+.0f}/{ea.get('median_coarse_pct_dec', np.nan):+.0f}, SA {sa.get('median_fine_pct_dec', np.nan):+.0f}/{sa.get('median_coarse_pct_dec', np.nan):+.0f}, ME {me.get('median_fine_pct_dec', np.nan):+.0f}/{me.get('median_coarse_pct_dec', np.nan):+.0f}")
tl.fix_perms(out)
print("done")
