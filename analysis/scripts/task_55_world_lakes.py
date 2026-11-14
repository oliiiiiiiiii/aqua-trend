"""Task 55 - The world's lakes from space, 2009-2025: the Caspian sinks, East Africa's lakes rise, reservoirs follow droughts and dams.

Data: NASA GWM satellite radar-altimetry lake/reservoir levels (10-day; Jason-2 -> Jason-3 -> Sentinel-6A in this window), ~520 targets,
plus the GWM index (type, country, advisories).
Method: 10-day heights (frozen-surface flags dropped) -> monthly medians -> annual means (>=6 months); targets with >=14 of 17 years in
2009-2025. Exclude targets whose advisories flag a mission-merger problem inside the window (J2/J3 or J3/S6a) or a change of reference
mission. Trend: Theil-Sen (m/decade) + Hamed-Rao modified Mann-Kendall, FDR q=0.10 across targets.
'Regulated' = GWM advisory 'Regulated water levels' (dam-operated); others are natural or indirectly affected.
Cross-check: the Caspian's altimetry trend vs the GRACE mass trend over the Caspian basin (FINDINGS #6).
"""
import sys
import json
import tarfile
import textwrap
import numpy as np
import pandas as pd
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

TASK = "55_world_lakes"
out = tl.task_dir(TASK)
SRC = "Data: NASA GWM (Global Water Measurements) satellite radar altimetry of lakes and reservoirs, Jason-2/3 and Sentinel-6A."
idx = {r["Lake ID"]: r for r in json.load(open(f"{ROOT}/data/raw/gwm/index_10day.json"))}
BAD = ("J3/J2", "J2/J3", "S6a/J3", "J3/S6a", "Change of Reference")


def parse(txt):
    rows, nm, lat, lon = [], None, np.nan, np.nan
    for ln in txt.splitlines():
        if "Target database id number and name" in ln:
            nm = ln.split(":")[0].strip()[7:]
        if "Latitude and longitude" in ln:
            p = ln.split(); lat, lon = float(p[0]), float(p[1])
        p = ln.split()
        if len(p) >= 16 and len(p[2]) == 8 and p[2].isdigit() and p[2] != "99999999":
            h = float(p[5])
            if h < 900 and p[13] == "0":
                rows.append((pd.Timestamp(p[2]), h))
    return (pd.Series(dict(rows)).sort_index() if rows else pd.Series(dtype=float)), nm, lat, lon


recs, series = [], {}
with tarfile.open(f"{ROOT}/data/raw/gwm/lake.10.tar.gz", "r:gz") as t:
    for m in t.getmembers():
        if not (m.isfile() and m.name.endswith(".10d.2.txt")):
            continue
        lid = m.name.split("/")[-1][4:10]
        s, nm, la, lo = parse(t.extractfile(m).read().decode("latin1"))
        if s.empty:
            continue
        mo = s.resample("MS").median()
        a = mo.groupby(mo.index.year).agg(["mean", "count"])
        ann = a[a["count"] >= 6]["mean"].loc[2009:2025]
        info = idx.get(lid, {})
        adv = " | ".join(str(info[k]) for k in info if k and k.startswith("Advisory") and info.get(k))
        rec = dict(id=lid, name=nm, lat=la, lon=lo, country=info.get("Country"), gwm_type=info.get("Type"), regulated="Regulated water levels" in adv,
                   n_years=int(len(ann)), advisories=adv, merger_problem=any(b in adv for b in BAD))
        if len(ann) >= 14:
            mk = tl._mk_hr(ann.values)
            rec.update(sen_m_per_decade=float(mk["sen"] * 10), p=float(mk["p"]),
                       change_2009_11_to_2023_25=float(ann.loc[2023:2025].mean() - ann.loc[2009:2011].mean()))
            series[lid] = mo
        recs.append(rec)
D = pd.DataFrame(recs)
U = D[D.sen_m_per_decade.notna() & ~D.merger_problem & (D.gwm_type != "ephemeral")].copy()
U["sig"] = tl.fdr_mask(U.p.values, 0.10)
D.merge(U[["id", "sig"]], on="id", how="left").round(4).to_csv(f"{out}/lake_trends_2009_2025.csv", index=False)
res = dict(n_targets=int(len(D)), n_with_14yr=int(D.sen_m_per_decade.notna().sum()), n_usable=int(len(U)),
           n_sig_up=int((U.sig & (U.sen_m_per_decade > 0)).sum()), n_sig_down=int((U.sig & (U.sen_m_per_decade < 0)).sum()))
for lab, sel in (("regulated", U.regulated), ("not_regulated", ~U.regulated)):
    res[lab] = dict(n=int(sel.sum()), sig_up=int((sel & U.sig & (U.sen_m_per_decade > 0)).sum()), sig_down=int((sel & U.sig & (U.sen_m_per_decade < 0)).sum()),
                    median_trend=float(U.sen_m_per_decade[sel].median()))
res["top_falling"] = U.sort_values("sen_m_per_decade").head(10)[["name", "country", "regulated", "sen_m_per_decade", "p"]].round(3).to_dict("records")
res["top_rising"] = U.sort_values("sen_m_per_decade", ascending=False).head(10)[["name", "country", "regulated", "sen_m_per_decade", "p"]].round(3).to_dict("records")
print({k: v for k, v in res.items() if not k.startswith("top")}, flush=True)
print(U.sort_values("sen_m_per_decade")[["name", "country", "regulated", "sen_m_per_decade", "p", "sig"]].round(3).head(15).to_string(), flush=True)
print(U.sort_values("sen_m_per_decade")[["name", "country", "regulated", "sen_m_per_decade", "p", "sig"]].round(3).tail(15).to_string(), flush=True)

# Caspian: altimetry vs GRACE
import hub  # noqa: E402
tws = hub.load("tws")
LA, LO = np.meshgrid(hub.LAT, hub.LON, indexing="ij")
cm_ = (LO >= 46.5) & (LO <= 54.5) & (LA >= 36.5) & (LA <= 47.0)
w = np.cos(np.deg2rad(LA)) * cm_
g = pd.Series([np.nansum(np.nan_to_num(x) * w) / np.sum(w * np.isfinite(x)) if np.isfinite(x[cm_]).any() else np.nan for x in tws.values],
              pd.DatetimeIndex(tws.time.values)).dropna()
ga = g.groupby(g.index.year).mean().loc[2009:2025]
mk_g = tl._mk_hr(ga.values)
casp = U[U.name.str.contains("Caspian", na=False)]
if len(casp):
    c0 = casp.iloc[0]
    res["caspian"] = dict(altimetry_m_per_decade=float(c0.sen_m_per_decade), altimetry_p=float(c0.p),
                          grace_cm_per_decade_box=float(mk_g["sen"] * 10), grace_p=float(mk_g["p"]),
                          note="GRACE box mean includes surrounding land; the lake's level change spread over the box area is a lower bound")
    cs = series[c0.id]
    cann = cs.groupby(cs.index.year).mean().loc[2009:2025]
    res["caspian"]["r_annual_altimetry_vs_grace"] = float(np.corrcoef(cann.reindex(ga.index).values, ga.values)[0, 1])
    print("Caspian", res["caspian"], flush=True)
tl.save_json(res, f"{out}/stats.json")

# ------------------------------------------------------------------ figure
fig = plt.figure(figsize=(14, 8.6), dpi=170)
proj = ccrs.Robinson(central_longitude=20)
axm = fig.add_axes([0.01, 0.36, 0.66, 0.50], projection=proj)
axm.set_global()
_y0 = proj.transform_point(20, -45, ccrs.PlateCarree())[1]; _y1 = proj.transform_point(20, 72, ccrs.PlateCarree())[1]
axm.set_ylim(_y0, _y1)
axm.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#ecebe6", lw=0)
axm.add_feature(cfeature.COASTLINE.with_scale("110m"), lw=0.3, color=viz.MUTED)
axm.spines["geo"].set_visible(False)
cm = viz.div_cmap("water")
norm = TwoSlopeNorm(0, -2, 2)
U = U.sort_values("sen_m_per_decade", key=np.abs)
for reg, mk_ in ((False, "o"), (True, "s")):
    sub = U[U.regulated == reg]
    sc = axm.scatter(sub.lon, sub.lat, c=sub.sen_m_per_decade.clip(-2, 2), cmap=cm, norm=norm, marker=mk_, s=np.where(sub.sig, 46, 18),
                     edgecolors=np.where(sub.sig, viz.INK, viz.SURFACE), linewidths=np.where(sub.sig, 0.8, 0.3), transform=ccrs.PlateCarree(), zorder=3)
for nm_, dx, dy in (("Caspian Sea", -24, -7), ("Kariba", -10, -8), ("Nasser", 3, 2), ("Turkana", 4, 0), ("Salton Sea", -26, -5), ("Chad 1", -12, 4),
                    ("Urmia 1", -6, 6), ("Victoria 1", -18, -3), ("Issyk-Kul", 3, 4)):
    r_ = U[U.name == nm_]
    if len(r_):
        r_ = r_.iloc[0]
        axm.text(r_.lon + dx, r_.lat + dy, f"{nm_.replace(' 1', '')} {r_.sen_m_per_decade:+.1f}", fontsize=7.5, color=viz.INK, transform=ccrs.PlateCarree(),
                 bbox=dict(fc=viz.SURFACE, ec="none", alpha=0.8, pad=0.6), zorder=5)
axm.set_title("Lake & reservoir level trend 2009–2025 (m per decade)", fontsize=10.5, loc="left", fontweight="bold")
cax = fig.add_axes([0.08, 0.355, 0.22, 0.013]); cb = fig.colorbar(sc, cax=cax, orientation="horizontal"); cb.outline.set_visible(False)
cb.ax.tick_params(labelsize=7.5, length=0)
cb.set_label("m per decade (● natural/indirect, ■ dam-regulated; black edge: FDR-significant)", fontsize=7.8, color=viz.INK2)
# right: histogram of trends
ax = fig.add_axes([0.72, 0.52, 0.26, 0.30])
bins = np.linspace(-2, 2, 33)
v = U.sen_m_per_decade.clip(-2, 2)
ax.hist([v[~U.regulated], v[U.regulated]], bins=bins, stacked=True, color=[viz.SERIES[0], "#b9b8b0"], label=["natural / indirect", "dam-regulated"])
ax.axvline(0, color=viz.INK, lw=0.8)
ax.legend(frameon=False, fontsize=7.8)
ax.set_xlabel("trend, m per decade (clipped at ±2)", fontsize=8.5, color=viz.INK2); ax.set_ylabel("number of lakes", fontsize=8.5, color=viz.INK2)
ax.set_title(f"{res['n_usable']} lakes: {res['n_sig_up']} rising, {res['n_sig_down']} falling (FDR)", fontsize=10, loc="left", fontweight="bold")
for sp_ in ("top", "right"):
    ax.spines[sp_].set_visible(False)
ax.tick_params(length=0, labelsize=7.5); ax.grid(axis="y", color=viz.GRID, lw=0.5)
# bottom: example series
EX = [("Caspian Sea", "Caspian Sea"), ("Kariba", "Kariba (hydropower)"), ("Nasser", "Nasser (Aswan)"),
      ("Chad 1", "Lake Chad (Sahel)"), ("Salton Sea", "Salton Sea (California)")]
for k, (nm_, lab) in enumerate(EX):
    r_ = U[U.name == nm_]
    if not len(r_):
        continue
    s_ = series[r_.iloc[0].id]
    s_ = s_["2008-07":] - s_["2009":"2011"].mean()
    axs = fig.add_axes([0.04 + k * 0.193, 0.07, 0.16, 0.18])
    axs.plot(s_.index, s_.values, color=viz.SERIES[0] if r_.iloc[0].sen_m_per_decade > 0 else viz.ORANGE_ARM[2], lw=1.2)
    axs.axhline(0, color=viz.AXIS, lw=0.8)
    axs.set_title(f"{lab}\n{r_.iloc[0].sen_m_per_decade:+.2f} m/decade", fontsize=8.3, loc="left", fontweight="bold")
    for sp_ in ("top", "right", "left"):
        axs.spines[sp_].set_visible(False)
    axs.grid(axis="y", color=viz.GRID, lw=0.5); axs.tick_params(length=0, labelsize=7)
    axs.set_xticks([pd.Timestamp(f"{y}-01-01") for y in (2010, 2015, 2020, 2025)]); axs.set_xticklabels(["2010", "2015", "2020", "2025"])
    if k == 0:
        axs.set_ylabel("m vs 2009–11", fontsize=7.5, color=viz.INK2)
cs_ = res.get("caspian", {})
fig.text(0.01, 0.975, "The world's lakes from space: the Caspian sinks, East Africa's lakes rise, reservoirs swing with droughts", fontsize=15, fontweight="bold", va="top")
subt = (f"Radar altimeters (Jason-2/3, Sentinel-6A) measure the water level of {res['n_usable']} lakes and reservoirs with a consistent 2009–2025 record. "
        f"{res['n_sig_down']} are falling and {res['n_sig_up']} rising significantly (FDR). The Caspian, Earth's largest lake, dropped "
        f"{abs(cs_.get('altimetry_m_per_decade', np.nan)):.1f} m per decade, confirmed independently by GRACE gravity (annual r = {cs_.get('r_annual_altimetry_vs_grace', np.nan):.2f}); "
        f"Urmia, the Aral remnants and Issyk-Kul fall too. East Africa's lakes rose (task 54) and Lake Chad is recovering. Dam-regulated reservoirs swing with "
        f"droughts and operations: Kariba's 2019–2024 droughts emptied it, while Nasser filled despite Ethiopia's new dam upstream.")
fig.text(0.01, 0.928, "\n".join(textwrap.wrap(subt, 195)), fontsize=9.1, color=viz.INK2, va="top")
fig.text(0.99, 0.006, SRC, fontsize=7, color=viz.MUTED, ha="right")
fig.savefig(f"{out}/world_lakes_trends.png"); plt.close(fig)
tl.runlog(TASK, "done", f"{res['n_usable']} lakes: {res['n_sig_down']} falling, {res['n_sig_up']} rising (FDR); Caspian {cs_.get('altimetry_m_per_decade', np.nan):+.2f} m/dec")
tl.fix_perms(out)
print("done")
