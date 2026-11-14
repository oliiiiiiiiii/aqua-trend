#!/usr/bin/env python3
"""
網站資料 v2：以隊友 hub.py 匯出的多產品資料（data/hub_export）為主，加上 GLDAS 1° 中 hub 沒有的欄位
輸出 web/public/data/
  catalog/variables.json   每一層：中文名、類別、產品、家族、是否 NASA、單位、期間、視覺通道、限制
  catalog/series_index.json 每個區域有哪些層
  series/<id>.json         {"version":"series-2","layers":{layer:{"start":"YYYY-MM","values":[…]}}}（不含 hex）
  trends/<layer>.json      每個區域（含 hex）該層的趨勢：各層用自己的完整年份
用法：python3 analysis/export_web2.py [trends|series|catalog]（預設全部）
"""
import json, math, os, sys, warnings
import numpy as np
warnings.filterwarnings("ignore", category=RuntimeWarning)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB = os.path.join(ROOT, "data", "hub_export"); OUT = os.path.join(ROOT, "web", "public", "data")
VERSION = "export-2"
# layer: (類別, 視覺通道)
META = {
    "tws": ("tws", "有零基準線的正負儲水異常槽"), "p_imerg": ("precip", "向下雨滴粒子的密度"), "p_gpcp": ("precip", "向下雨滴粒子的密度"),
    "p_m2": ("precip", "向下雨滴粒子的密度"), "p_m2land": ("precip", "向下雨滴粒子的密度"),
    "et_m2": ("et", "向上水氣粒子的數量"), "et_m2land": ("et", "向上水氣粒子的數量"), "et_gldas": ("et", "向上水氣粒子的數量"),
    "pet_gldas": ("vpd", "與實際通量分開的蒸散需求指示環"), "sm_root": ("soil", "根層含水色階與刻度"), "sm_total": ("soil", "0–2 m 土層含水刻度"),
    "sm_m2": ("soil", "根層濕度色階（0–1）"), "runoff": ("runoff", "側向產流箭頭"), "ro_m2": ("runoff", "側向產流箭頭"),
    "swe": ("snow", "雪中儲水刻度"), "tair": ("tair", "空氣或蒸散粒子的溫度色階"), "tsurf_m2": ("tair", "地表溫度色階"),
    "lst_day": ("tair", "地表溫度色階"), "vpd": ("vpd", "蒸散需求刻度"), "rn": ("energy", "淨能量箭頭"), "rn_m2": ("energy", "淨能量箭頭"),
    "swdown": ("energy", "入射日照箭頭"), "wind": ("wind", "風速刻度（無方向）"), "ndvi": ("ndvi", "植被色階／紋理"),
    "sst": ("sst", "海表溫度色階"), "g1:soil_top": ("soil", "表土層含水色階"),
}
DEC = {"tws": 2, "sm_root": 1, "sm_total": 1, "swe": 2, "tair": 2, "tsurf_m2": 2, "lst_day": 2, "sst": 2, "rn": 1, "rn_m2": 1, "swdown": 1,
       "wind": 2, "ndvi": 4, "sm_m2": 4, "vpd": 3, "g1:soil_top": 2}
sys.path.insert(0, os.path.join(ROOT, "analysis"))
from engine3 import FAMILY, CAVEAT   # noqa: E402


def load_layers():
    ids = [str(x) for x in np.load(os.path.join(HUB, "region_ids.npy"))]
    man = json.load(open(os.path.join(HUB, "manifest.json")))
    L = {}
    for name, info in man["layers"].items():
        if info.get("status") != "ok": continue
        z = np.load(os.path.join(HUB, f"{name}.npz"))
        S = z["series"].astype(np.float64); unit = info.get("units", "")
        if unit == "K": S = S - 273.15; unit = "°C"
        if unit == "degC": unit = "°C"
        L[name] = dict(series=S, times=[str(t) for t in z["times"]], coverage=z["coverage"], unit=unit, info=info)
    # GLDAS 1° 表層土壤水（hub 沒有）
    e = os.path.join(ROOT, "data", "interim", "export", "series.npz")
    if os.path.exists(e):
        z = np.load(e); gid = [str(x) for x in z["ids"]]; pos = {k: i for i, k in enumerate(gid)}
        st = z["soil_top"]; months = z["months"]                    # 只解壓一次
        S = np.full((len(ids), st.shape[1]), np.nan)
        for i, rid in enumerate(ids):
            if rid in pos: S[i] = st[pos[rid]]
        L["g1:soil_top"] = dict(series=S, times=[f"{m[:4]}-{m[4:]}" for m in months], coverage=np.isfinite(S).mean(1), unit="mm",
                                info=dict(name="表層土壤水 0–10 cm", product="GLDAS_NOAH10_M 2.1（1°）", nasa=True))
    return ids, L


def trends(ids, L):
    from scipy import stats
    os.makedirs(os.path.join(OUT, "trends"), exist_ok=True)
    F = ["slope_per_decade", "ci95_lo", "ci95_hi", "p", "p_by", "mk_p", "sen_per_decade", "mean", "n_eff", "coverage"]
    P = {}
    out = {}
    for name, d in L.items():
        Y = d["series"]; t = d["times"]; yr = np.array([int(x[:4]) for x in t]); mo = np.array([int(x[5:7]) for x in t])
        full = [y for y in range(yr.min(), yr.max() + 1) if ((yr == y).sum() == 12)]
        y0, y1 = full[0], full[-1]
        if name == "tws": y0 = max(y0, 2003)
        sel = (yr >= y0) & (yr <= y1); Ys = Y[:, sel]; ms = mo[sel] - 1
        clim = np.stack([np.nanmean(Ys[:, ms == m], 1) for m in range(12)], 1); D = Ys - clim[:, ms]
        T = D.shape[1]; tt = (np.arange(T) - (T - 1) / 2) / 120.0
        ok = np.isfinite(D); n = ok.sum(1)
        Dm = np.where(ok, D - np.nanmean(D, 1, keepdims=True), 0); tm = np.where(ok, tt, 0)
        tc = np.where(ok, tt - (tm.sum(1, keepdims=True) / np.maximum(n[:, None], 1)), 0)
        b = (tc * Dm).sum(1) / np.maximum((tc ** 2).sum(1), 1e-12)
        res = np.where(ok, Dm - b[:, None] * tc, 0)
        rho = np.clip((res[:, 1:] * res[:, :-1]).sum(1) / np.maximum((res ** 2).sum(1), 1e-30), -0.99, 0.99)
        neff = np.maximum(np.where(rho > 0, n * (1 - rho) / (1 + rho), n), 4)
        se = np.sqrt((res ** 2).sum(1) / (neff - 2) / np.maximum((tc ** 2).sum(1), 1e-12))
        tq = stats.t.ppf(0.975, neff - 2); p = 2 * stats.t.sf(np.abs(b / np.maximum(se, 1e-30)), neff - 2)
        A = np.stack([np.where(np.isfinite(Y[:, yr == y]).sum(1) >= 10, np.nanmean(Y[:, yr == y], 1), np.nan) for y in range(y0, y1 + 1)], 1)
        good = (n >= 0.85 * T) & (np.nanstd(Ys, 1) > 1e-9) & (d["coverage"] >= 0.3)
        nn = A.shape[1]; ii, jj = np.triu_indices(nn, 1); dd = A[:, jj] - A[:, ii]          # (R, pairs)，含 NaN
        valid = np.isfinite(dd); S = np.where(valid, np.sign(dd), 0).sum(1)
        m_ = np.isfinite(A).sum(1).astype(float); var = m_ * (m_ - 1) * (2 * m_ + 5) / 18
        pmk = np.where((m_ >= 10) & good, 2 * stats.norm.sf(np.abs((S - np.sign(S)) / np.sqrt(np.maximum(var, 1)))), np.nan)
        sen = np.where((m_ >= 10) & good, np.nanmedian(dd / (jj - ii), 1) * 10, np.nan)
        mean = np.nanmean(Ys, 1)
        out[name] = dict(period=f"{y0}–{y1}", rows={i: [b[i], b[i] - tq[i] * se[i], b[i] + tq[i] * se[i], p[i], None, pmk[i], sen[i], mean[i], neff[i], d["coverage"][i]]
                                                    for i in np.nonzero(good)[0]})
        for i in out[name]["rows"]: P.setdefault(i, []).append((name, p[i]))
    # 每個區域：所有層的趨勢為一個家族，做 BY
    for i, lst in P.items():
        pv = np.array([x[1] for x in lst]); m = pv.size; c = (1 / np.arange(1, m + 1)).sum(); o = np.argsort(pv)
        adj = np.minimum.accumulate((pv[o] * m * c / np.arange(1, m + 1))[::-1])[::-1]; a = np.empty(m); a[o] = np.minimum(adj, 1)
        for (name, _), v in zip(lst, a): out[name]["rows"][i][4] = v
    def fmt(v, k):
        if v is None or not np.isfinite(v): return None
        return float(f"{v:.3g}") if k in (3, 4, 5) else round(float(v), 6)
    for name, o in out.items():
        rows = {ids[i]: [fmt(v, k) for k, v in enumerate(r)] for i, r in o["rows"].items()}
        json.dump(dict(layer=name, unit=L[name]["unit"], period=o["period"], fields=F, regions=rows,
                       note="slope 是去季節月距平的 OLS（每十年）；p_by 是同一區域所有層一起做 BY 校正"),
                  open(os.path.join(OUT, "trends", f"{name.replace(':', '_')}.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    print("trends", len(out), "層")


def series(ids, L):
    regs = {r["id"]: r for r in json.load(open(os.path.join(OUT, "catalog", "regions.json")))["regions"]}
    os.makedirs(os.path.join(OUT, "series"), exist_ok=True)
    index = {}; tot = 0
    for i, rid in enumerate(ids):
        if regs[rid]["type"] == "hex": continue
        layers = {}
        for name, d in L.items():
            if d["coverage"][i] < 0.3: continue
            a = d["series"][i]
            if name == "sst" and regs[rid].get("surface") != "ocean": continue
            ok = np.nonzero(np.isfinite(a))[0]
            if ok.size < 24: continue
            a0, a1 = ok[0], ok[-1] + 1; v = np.round(a[a0:a1], DEC.get(name, 3)).tolist()
            v = [None if x != x else x for x in v]
            layers[name.replace(":", "_")] = dict(start=d["times"][a0], values=v)
        if not layers: continue
        index[rid] = sorted(layers)
        f = os.path.join(OUT, "series", f"{rid}.json")
        s = json.dumps(dict(id=rid, version="series-2", layers=layers), ensure_ascii=False, separators=(",", ":"))
        open(f, "w").write(s); tot += len(s)
    json.dump(dict(version="series-2", note="hex 區域只有 trends，沒有 series 檔", regions=index),
              open(os.path.join(OUT, "catalog", "series_index.json"), "w"), separators=(",", ":"))
    print("series", len(index), "檔", round(tot / 1e6, 1), "MB")


def catalog(ids, L):
    lay = {}
    for name, d in L.items():
        cat, vis = META.get(name, (None, None)); info = d["info"]
        lay[name.replace(":", "_")] = dict(name=info.get("name"), category=cat, product=info.get("product"), nasa=info.get("nasa"),
                                           family=FAMILY.get(name, "GLDAS"), unit=d["unit"], start=d["times"][0], end=d["times"][-1],
                                           visual=vis, caveat=CAVEAT.get(name))
    default = {"precip": "p_imerg", "et": "et_m2", "soil": "sm_root", "tws": "tws", "runoff": "runoff", "snow": "swe", "tair": "tair",
               "vpd": "vpd", "energy": "rn", "wind": "wind", "ndvi": "ndvi", "sst": "sst"}
    json.dump(dict(version=VERSION, generated="2026-11-14", source="隊友 hub.py（0.5° 月網格）匯出，加上 GLDAS 1° 表層土壤水",
                   category_default_layer=default, layers=lay,
                   trend_method="去季節月距平 OLS（AR(1) 有效樣本數修正 95% CI）；年平均 Mann-Kendall＋Sen；各層用自己的完整年份（GRACE 從 2003 起）；同一區域所有層一起做 Benjamini–Yekutieli"),
              open(os.path.join(OUT, "catalog", "variables.json"), "w"), ensure_ascii=False, indent=1)
    print("catalog", len(lay), "層")


if __name__ == "__main__":
    ids, L = load_layers()
    for st in sys.argv[1:] or ["catalog", "trends", "series"]:
        {"catalog": catalog, "trends": trends, "series": series}[st](ids, L)
