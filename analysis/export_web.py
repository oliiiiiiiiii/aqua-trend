#!/usr/bin/env python3
"""
把 GLDAS 1° 月資料彙整成「每個區域」的網站資料（依總 spec 第 9 節）

輸出（web/public/data/）：
  catalog/variables.json   每條序列的定義、單位、產品、欄位、換算、視覺通道、限制
  catalog/series_index.json 每個區域有沒有序列、用了幾個 1° 格點、是否用最近格點代替
  series/<region_id>.json  該區域每條序列的月資料（2000-01 起）
  trends/<var>.json        每個區域該變數的趨勢統計（給地圖上色）
  indices.json             ENSO / IOD / PDO 月指數（NOAA）
步驟：python3 analysis/export_web.py aggregate   → 讀 319 個 GLDAS 檔，彙整成區域序列（快取）
      python3 analysis/export_web.py trends      → 算趨勢
      python3 analysis/export_web.py write       → 寫 JSON
"""
import glob, json, math, os, re, sys, warnings
import numpy as np
warnings.filterwarnings("ignore", category=RuntimeWarning)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "gldas_1deg")
OUT = os.path.join(ROOT, "web", "public", "data")
CACHE = os.path.join(ROOT, "data", "interim", "export")
LV = 2.45e6
TREND_YEARS = (2000, 2025)
VERSION = "export-0.1"

# key: (中文, 英文, 單位, 類別, 種類, 欄位, 小數位, 視覺通道, 限制)
VARS = {
    "precip":   ("降水", "Precipitation", "mm/day", "precip", "通量", "Rainf_f_tavg × 86400", 3,
                 "向下雨滴粒子的密度與輸入箭頭寬度", "GLDAS 的驅動降水（GDAS＋GPCP 合成），不是 GPM IMERG；降水不是河川流量"),
    "et":       ("實際蒸散", "Evapotranspiration", "mm/day", "et", "通量", "Evap_tavg × 86400", 3,
                 "向上水氣粒子的數量／密度（顏色可給氣溫）", "陸面模型估計，含蒸發與植物蒸騰；GLDAS-2.1 的蒸散長期趨勢有已知漂移，需和 MERRA-2 交叉驗證"),
    "pet":      ("潛在蒸散", "Potential ET", "mm/day", "vpd", "需求", "PotEvap_tavg × 86400 / 2.45e6", 3,
                 "與實際通量分開的蒸散需求指示環", "代表大氣的蒸散需求，不是已經移動的水；原單位 W/m²"),
    "soil_top": ("表層土壤水 0–10 cm", "Topsoil moisture 0–10 cm", "mm", "soil", "存量", "SoilMoi0_10cm_inst", 2,
                 "表土層含水色階與刻度", "模型土層水量（kg/m² = mm 水深），不是體積含水率，也不是地下水"),
    "soil_root":("根層土壤水", "Root-zone soil moisture", "mm", "soil", "存量", "RootMoist_inst", 1,
                 "根層含水色階與刻度", "模型根層水量；深度依植被類型而定"),
    "tws":      ("模型儲水（土壤＋雪＋冠層）", "Modelled water storage", "mm", "tws", "存量",
                 "SoilMoi 0–200 cm 四層 + SWE_inst + CanopInt_inst", 1,
                 "分層儲水指示槽（依實際組成命名）", "Noah 模型 0–2 m 土壤、積雪、冠層水的總和；不是 GRACE 總儲水異常，不含地下水與地表水"),
    "runoff":   ("逕流（地表＋基流）", "Runoff (surface + baseflow)", "mm/day", "runoff", "通量", "(Qs_acc + Qsb_acc) × 8", 4,
                 "地表到河道的側向產流箭頭", "_acc 是 3 小時累積量的月平均，×8 換成每天；模型產流不等於河川出口流量"),
    "swe":      ("積雪水當量", "Snow water equivalent", "mm", "snow", "存量", "SWE_inst", 2,
                 "雪中儲水刻度", "雪全部融化後的水深，不是雪的厚度或覆蓋率"),
    "p_minus_et":("水分盈餘（降水 − 蒸散）", "P − ET", "mm/day", "precip", "淨量", "(Rainf_f_tavg − Evap_tavg) × 86400", 3,
                 "有零線的正負指示", "沒有扣除逕流等收支項，不能直接當成儲水變化或可用水量"),
    "tair":     ("近地面氣溫", "Near-surface air temperature", "°C", "tair", "環境", "Tair_f_inst − 273.15", 2,
                 "空氣環境或蒸散粒子的溫度色階", "GLDAS 驅動資料的近地面氣溫，不是地表溫度"),
    "vpd":      ("飽和水氣壓差", "Vapour pressure deficit", "kPa", "vpd", "環境",
                 "es(Tair) − e(Qair, Psurf)（Tetens 公式，用月平均計算）", 3,
                 "獨立的蒸散需求刻度", "用月平均的氣溫與比濕計算，會低估月內的乾燥極值"),
    "rn":       ("淨輻射", "Net radiation", "W/m²", "energy", "能量", "Swnet_tavg + Lwnet_tavg", 1,
                 "有數值對應的淨能量箭頭", "地表吸收的淨能量（向下為正）"),
    "wind":     ("風速", "Wind speed", "m/s", "wind", "環境", "Wind_f_inst", 2,
                 "風速刻度（沒有方向資料，不畫流向）", "只有大小，沒有方向"),
}
RAW = sorted({"Rainf_f_tavg", "Evap_tavg", "PotEvap_tavg", "SoilMoi0_10cm_inst", "SoilMoi10_40cm_inst", "SoilMoi40_100cm_inst",
              "SoilMoi100_200cm_inst", "RootMoist_inst", "SWE_inst", "CanopInt_inst", "Qs_acc", "Qsb_acc", "Tair_f_inst",
              "Qair_f_inst", "Psurf_f_inst", "Swnet_tavg", "Lwnet_tavg", "Wind_f_inst"})


def derive(g):
    T = g["Tair_f_inst"] - 273.15
    es = 0.6108 * np.exp(17.27 * T / (T + 237.3))
    q = g["Qair_f_inst"]; p = g["Psurf_f_inst"] / 1000.0
    e = q * p / (0.622 + 0.378 * q)
    return {
        "precip": g["Rainf_f_tavg"] * 86400, "et": g["Evap_tavg"] * 86400, "pet": g["PotEvap_tavg"] * 86400 / LV,
        "soil_top": g["SoilMoi0_10cm_inst"], "soil_root": g["RootMoist_inst"],
        "tws": g["SoilMoi0_10cm_inst"] + g["SoilMoi10_40cm_inst"] + g["SoilMoi40_100cm_inst"] + g["SoilMoi100_200cm_inst"]
               + g["SWE_inst"] + g["CanopInt_inst"],
        "runoff": (g["Qs_acc"] + g["Qsb_acc"]) * 8, "swe": g["SWE_inst"],
        "p_minus_et": (g["Rainf_f_tavg"] - g["Evap_tavg"]) * 86400, "tair": T, "vpd": np.maximum(es - e, 0),
        "rn": g["Swnet_tavg"] + g["Lwnet_tavg"], "wind": g["Wind_f_inst"],
    }


def build_weights():
    from scipy import sparse
    m = np.load(os.path.join(ROOT, "data", "masks", "regions_1deg.npz"))
    regs = json.load(open(os.path.join(OUT, "catalog", "regions.json")))["regions"]
    ids = [r["id"] for r in regs]; pos = {k: i for i, k in enumerate(ids)}
    lat = -59.5 + np.arange(150); lon = -179.5 + np.arange(360)
    cw = np.repeat(np.cos(np.deg2rad(lat))[:, None], 360, 1).ravel()
    rows, cols = [], []
    for t in ("basin3", "basin4", "ice", "lme", "sea", "hex"):
        a = m[t][30:180].ravel(); tid = m[f"{t}_ids"]
        ok = a >= 0
        rows.append(np.array([pos[tid[k]] for k in a[ok]])); cols.append(np.nonzero(ok)[0])
    nm = m["named"][:, 30:180].reshape(len(m["named_ids"]), -1)
    for k, rid in enumerate(m["named_ids"]):
        c = np.nonzero(nm[k])[0]; rows.append(np.full(c.size, pos[rid])); cols.append(c)
    rows = np.concatenate(rows); cols = np.concatenate(cols)
    W = sparse.csr_matrix((cw[cols], (rows, cols)), shape=(len(ids), lat.size * lon.size))
    return W, ids, regs, lat, lon, cw


def aggregate():
    import netCDF4
    from scipy import sparse
    os.makedirs(CACHE, exist_ok=True)
    W, ids, regs, lat, lon, cw = build_weights()
    files = sorted(glob.glob(os.path.join(SRC, "GLDAS_NOAH10_M.A??????.021.nc4")))
    months = [re.search(r"\.A(\d{6})\.", f).group(1) for f in files]
    R, T = len(ids), len(files)
    S = {k: np.full((R, T), np.nan, np.float32) for k in VARS}
    land = None
    for t, f in enumerate(files):
        with netCDF4.Dataset(f) as d:
            g = {v: np.ma.filled(d[v][0].astype(np.float64), np.nan) for v in RAW}
        if land is None:
            land = np.isfinite(g["SoilMoi0_10cm_inst"]).ravel()
        for k, a in derive(g).items():
            x = a.ravel(); ok = np.isfinite(x)
            num = W @ np.where(ok, x, 0); den = W @ ok.astype(float)
            with np.errstate(invalid="ignore", divide="ignore"):
                S[k][:, t] = np.where(den > 0, num / den, np.nan)
        if (t + 1) % 40 == 0:
            print(f"  {t + 1}/{T}", flush=True)
    # 1° 沒有陸地格點的區域：用中心點最近的陸地格點（≤ 2°），並標記
    ncell = np.asarray((W.multiply(land[None, :]) > 0).sum(1)).ravel()
    LA, LO = np.meshgrid(lat, lon, indexing="ij"); la_l, lo_l = LA.ravel()[land], LO.ravel()[land]
    nearest = {}
    for i, r in enumerate(regs):
        if ncell[i] == 0 and r.get("surface") != "ocean" and r.get("centroid"):
            cx, cy = r["centroid"]; d2 = (la_l - cy) ** 2 + ((lo_l - cx) * math.cos(math.radians(cy))) ** 2
            j = int(np.argmin(d2))
            if d2[j] <= 4.0:
                nearest[i] = int(np.nonzero(land)[0][j])
    if nearest:
        idx = sorted(nearest)
        for t, f in enumerate(files):
            with netCDF4.Dataset(f) as d:
                g = {v: np.ma.filled(d[v][0].astype(np.float64), np.nan) for v in RAW}
            dv = derive(g)
            for k in VARS:
                x = dv[k].ravel()
                S[k][idx, t] = x[[nearest[i] for i in idx]]
    np.savez_compressed(os.path.join(CACHE, "series.npz"), months=np.array(months), ids=np.array(ids),
                        ncell=ncell, nearest=np.array(sorted(nearest)), **S)
    print(f"區域 {R}、月 {T}；有陸地格點 {int((ncell > 0).sum())}、最近格點代替 {len(nearest)}")


def trends():
    from scipy import stats
    z = np.load(os.path.join(CACHE, "series.npz"))
    months = z["months"]; yrs = np.array([int(m[:4]) for m in months]); mi = np.array([int(m[4:]) - 1 for m in months])
    sel = (yrs >= TREND_YEARS[0]) & (yrs <= TREND_YEARS[1])
    out = {}
    for k in VARS:
        Y = z[k][:, sel].astype(np.float64)                      # (R, T)
        # 去季節
        clim = np.stack([np.nanmean(Y[:, mi[sel] == m], 1) for m in range(12)], 1)
        D = Y - clim[:, mi[sel]]
        T = D.shape[1]; t = (np.arange(T) - (T - 1) / 2) / 120.0      # 每十年
        ok = np.isfinite(D).all(1) & (np.nanstd(Y, 1) > 1e-9)
        Dm = D - np.nanmean(D, 1, keepdims=True)
        b = (Dm * t).sum(1) / (t ** 2).sum()
        res = Dm - b[:, None] * t
        rho = np.clip((res[:, 1:] * res[:, :-1]).sum(1) / np.maximum((res ** 2).sum(1), 1e-30), -0.99, 0.99)
        neff = np.where(rho > 0, T * (1 - rho) / (1 + rho), T); neff = np.maximum(neff, 4)
        se = np.sqrt((res ** 2).sum(1) / (neff - 2) / (t ** 2).sum())
        tc = stats.t.ppf(0.975, neff - 2); p = 2 * stats.t.sf(np.abs(b / np.maximum(se, 1e-30)), neff - 2)
        # 年平均 MK + Sen
        A = np.stack([np.nanmean(Y[:, yrs[sel] == y], 1) for y in range(TREND_YEARS[0], TREND_YEARS[1] + 1)], 1)
        n = A.shape[1]; i, j = np.triu_indices(n, 1); dd = A[:, j] - A[:, i]
        Sx = np.sign(dd).sum(1); var = n * (n - 1) * (2 * n + 5) / 18
        zz = (Sx - np.sign(Sx)) / math.sqrt(var); pmk = 2 * stats.norm.sf(np.abs(zz))
        sen = np.median(dd / (j - i), 1) * 10
        mean = np.nanmean(Y, 1)
        out[k] = dict(b=np.where(ok, b, np.nan), lo=np.where(ok, b - tc * se, np.nan), hi=np.where(ok, b + tc * se, np.nan),
                      p=np.where(ok, p, np.nan), pmk=np.where(ok, pmk, np.nan), sen=np.where(ok, sen, np.nan),
                      mean=np.where(ok, mean, np.nan), neff=np.where(ok, neff, np.nan))
    # 每個區域：各變數的趨勢為一個家族做 BY
    keys = list(VARS); P = np.stack([out[k]["p"] for k in keys], 1)    # (R, K)
    PBY = np.full_like(P, np.nan)
    for r in range(P.shape[0]):
        okk = np.isfinite(P[r]); m = okk.sum()
        if m == 0: continue
        c = (1 / np.arange(1, m + 1)).sum(); pv = P[r, okk]; o = np.argsort(pv)
        adj = np.minimum.accumulate((pv[o] * m * c / np.arange(1, m + 1))[::-1])[::-1]
        tmp = np.empty(m); tmp[o] = np.minimum(adj, 1); PBY[r, okk] = tmp
    for i, k in enumerate(keys):
        out[k]["pby"] = PBY[:, i]
    np.savez_compressed(os.path.join(CACHE, "trends.npz"), **{f"{k}__{f}": v for k, d in out.items() for f, v in d.items()})
    print("趨勢完成")


def sig(x, nd):
    return None if not np.isfinite(x) else round(float(x), nd)


def sigp(x):      # p 值保留 3 位有效數字，不會變成 0
    return None if not np.isfinite(x) else float(f"{float(x):.3g}")


def write():
    z0 = np.load(os.path.join(CACHE, "series.npz")); z = {k: z0[k] for k in z0.files}
    t0 = np.load(os.path.join(CACHE, "trends.npz")); tr = {k: t0[k] for k in t0.files}
    ids = [str(x) for x in z["ids"]]; ncell = z["ncell"]; near = set(int(x) for x in z["nearest"])
    months = [str(m) for m in z["months"]]
    regs = {r["id"]: r for r in json.load(open(os.path.join(OUT, "catalog", "regions.json")))["regions"]}
    for d in ("series", "trends"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    os.makedirs(os.path.join(OUT, "catalog"), exist_ok=True)

    # variables.json
    vj = dict(version=VERSION, product=dict(id="GLDAS_NOAH10_M", version="2.1", resolution="1° 月網格", doi="10.5067/SXAVCZFAQLNO",
                                          agency="NASA GSFC / GES DISC", nature="觀測驅動的陸面模型（Noah），2.1 版為 open-loop，不是直接衛星量測",
                                          period=f"{months[0][:4]}-{months[0][4:]} ~ {months[-1][:4]}-{months[-1][4:]}"),
              series={k: dict(name=v[0], name_en=v[1], unit=v[2], category=v[3], kind=v[4], formula=v[5],
                              visual=v[7], caveat=v[8]) for k, v in VARS.items()},
              trend_method=dict(period=f"{TREND_YEARS[0]}–{TREND_YEARS[1]}",
                                slope="去季節月距平的 OLS 斜率（每十年），95% 信賴區間用 AR(1) 有效樣本數修正",
                                mk="年平均的 Mann-Kendall 檢定與 Sen 斜率（每十年）",
                                correction="每個區域把各變數的 OLS p 值視為一個家族，做 Benjamini–Yekutieli FDR",
                                note="這是單一變數趨勢，不是跨變數關聯；顯著不代表因果"))
    json.dump(vj, open(os.path.join(OUT, "catalog", "variables.json"), "w"), ensure_ascii=False, indent=1)

    # series 檔
    index = {}
    keys = list(VARS)
    part, nparts = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 1)
    for i, rid in enumerate(ids):
        has = np.isfinite(z["precip"][i]).sum() > 0 and regs[rid]["type"] not in ("lme", "sea") \
            and regs[rid].get("surface") != "ocean"          # 陸面模型只給陸地／冰區域
        if has:
            index[rid] = dict(cells_1deg=int(ncell[i]), nearest_cell=i in near)
        if not has or i % nparts != part:
            continue
        if not has:
            continue
        av = set(regs[rid].get("available", []))
        vals = {}
        for k in keys:
            a = z[k][i]
            if not np.isfinite(a).any():
                continue
            nd = VARS[k][6]
            l = np.round(a.astype(np.float64), nd).tolist()
            if not np.isfinite(a).all():
                l = [None if x != x else x for x in l]
            vals[k] = l
        approx = i in near
        json.dump(dict(id=rid, product="GLDAS_NOAH10_M 2.1", start=f"{months[0][:4]}-{months[0][4:]}", n=len(months),
                       cells_1deg=int(ncell[i]), nearest_cell=approx,
                       note="區域比 1° 格點小，用中心最近的陸地格點代替" if approx else None, vars=vals),
                  open(os.path.join(OUT, "series", f"{rid}.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump(dict(version=VERSION, product="GLDAS_NOAH10_M 2.1", regions=index),
              open(os.path.join(OUT, "catalog", "series_index.json"), "w"), separators=(",", ":"))

    # trends/<var>.json：{fields:[…], regions:{id:[…]}}
    F = ["slope_per_decade", "ci95_lo", "ci95_hi", "p", "p_by", "mk_p", "sen_per_decade", "mean", "n_eff"]
    for k in keys:
        nd = VARS[k][6] + 2
        rows = {}
        for i, rid in enumerate(ids):
            if rid not in index:
                continue
            b = tr[f"{k}__b"][i]
            if not np.isfinite(b):
                continue
            rows[rid] = [sig(b, nd), sig(tr[f"{k}__lo"][i], nd), sig(tr[f"{k}__hi"][i], nd), sigp(tr[f"{k}__p"][i]),
                         sigp(tr[f"{k}__pby"][i]), sigp(tr[f"{k}__pmk"][i]), sig(tr[f"{k}__sen"][i], nd),
                         sig(tr[f"{k}__mean"][i], nd), sig(tr[f"{k}__neff"][i], 1)]
        json.dump(dict(var=k, unit=VARS[k][2], period=f"{TREND_YEARS[0]}–{TREND_YEARS[1]}", fields=F, regions=rows),
                  open(os.path.join(OUT, "trends", f"{k}.json"), "w"), ensure_ascii=False, separators=(",", ":"))

    # 氣候指數
    ind = json.load(open(os.path.join(ROOT, "data", "raw", "indices", "indices.json")))
    json.dump(ind, open(os.path.join(OUT, "indices.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    tot = sum(os.path.getsize(os.path.join(OUT, "series", f)) for f in os.listdir(os.path.join(OUT, "series")))
    print(f"series {len(index)} 檔，共 {tot / 1e6:.1f} MB；trends {len(keys)} 檔")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "write":
        write()
    else:
        for st in sys.argv[1:] or ["aggregate", "trends", "write"]:
            {"aggregate": aggregate, "trends": trends, "write": write}[st]()
