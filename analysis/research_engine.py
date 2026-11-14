#!/usr/bin/env python3
"""
Aqua Trend 研究引擎雛形（依「總 spec」第 7 節）

輸入：一個區域 + 最多 3 個水文目標
候選：GLDAS_NOAH10_M 2.1（1°、月）裡全部 36 個科學欄位（目前唯一已入庫的產品）
輸出：web/public/data/results/<region>.json + analysis/results/<region>.md

方法（固定、版本化，不依結果挑選）：
  趨勢   ：去季節月距平 → OLS + AR(1) 有效樣本數；年平均 → Mann-Kendall + Sen；目標之間 BY-FDR
  時間   ：月份效果 + 線性時間 迴歸殘差（異常）→ 延遲 −6..+6 月的 Pearson r(ℓ)=corr(e_y(t), e_x(t−ℓ))
           統計量 = 窗口內最大 |r|；零假設 = Ebisuzaki 相位隨機化候選異常（保留自相關），
           已把「挑最佳延遲」算進去
  空間   ：區域內每格的去季節線性趨勢 β_y(s)、β_x(s) 的面積加權相關；零假設 = 所有格點共用同一組
           隨機相位的替代序列（保留空間共變與自相關），重算趨勢場
  校正   ：本輪「目標 × 候選 × 分析類型」整個家族做 Benjamini–Yekutieli FDR，q = 0.05
  穩定性 ：最佳延遲的 r 在前後兩半期是否同號且 |r| ≥ 0.1
  依賴   ：同一模型的分量 / 定義相同的欄位標記為「定義依賴」，不推薦為研究線索
用法：python3 analysis/research_engine.py <region_id> <target1> [target2] [target3]
"""
import glob, json, math, os, re, sys, time
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "gldas_1deg")
CACHE = os.path.join(ROOT, "data", "interim", "engine")
POLICY = dict(version="engine-0.2", max_lag=6, q=0.05, n_surr_time=20000, n_surr_space=2000,
              min_cells_spatial=15, trend_years=(2000, 2025), seed=20261114)

# ---------- 欄位定義 ----------
LV = 2.45e6
def conv(var, a):
    if var.endswith("_acc"):            return a * 8.0, "mm/day"          # 3 小時累積量的月平均 → 每天
    if var in ("Rainf_f_tavg", "Rainf_tavg", "Snowf_tavg", "Evap_tavg"): return a * 86400.0, "mm/day"
    if var in ("ESoil_tavg", "ECanop_tavg", "Tveg_tavg", "PotEvap_tavg"): return a * 86400.0 / LV, "mm/day"
    if var in ("Tair_f_inst", "AvgSurfT_inst") or var.startswith("SoilTMP"): return a - 273.15, "°C"
    if var == "Qair_f_inst": return a * 1000, "g/kg"
    if var == "Psurf_f_inst": return a / 100, "hPa"
    return a, None
ZH = {"Swnet_tavg": "淨短波輻射", "Lwnet_tavg": "淨長波輻射", "Qle_tavg": "潛熱通量", "Qh_tavg": "可感熱通量",
      "Qg_tavg": "地表熱通量", "Snowf_tavg": "降雪率", "Rainf_tavg": "降雨率（不含雪）", "Evap_tavg": "蒸散",
      "Qs_acc": "地表逕流", "Qsb_acc": "地下逕流（基流）", "Qsm_acc": "融雪", "AvgSurfT_inst": "地表溫度",
      "Albedo_inst": "反照率", "SWE_inst": "積雪水當量", "SnowDepth_inst": "雪深", "SoilMoi0_10cm_inst": "土壤水 0–10 cm",
      "SoilMoi10_40cm_inst": "土壤水 10–40 cm", "SoilMoi40_100cm_inst": "土壤水 40–100 cm",
      "SoilMoi100_200cm_inst": "土壤水 100–200 cm", "SoilTMP0_10cm_inst": "土溫 0–10 cm",
      "SoilTMP10_40cm_inst": "土溫 10–40 cm", "SoilTMP40_100cm_inst": "土溫 40–100 cm",
      "SoilTMP100_200cm_inst": "土溫 100–200 cm", "PotEvap_tavg": "潛在蒸散", "ECanop_tavg": "葉面截留蒸發",
      "Tveg_tavg": "植物蒸騰", "ESoil_tavg": "裸土蒸發", "RootMoist_inst": "根層土壤水", "CanopInt_inst": "葉面截留水",
      "Wind_f_inst": "風速", "Rainf_f_tavg": "總降水", "Tair_f_inst": "近地面氣溫", "Qair_f_inst": "比濕",
      "Psurf_f_inst": "地面氣壓", "SWdown_f_tavg": "向下短波輻射", "LWdown_f_tavg": "向下長波輻射"}
FORCING = {"Rainf_f_tavg", "Tair_f_inst", "Qair_f_inst", "Psurf_f_inst", "SWdown_f_tavg", "LWdown_f_tavg", "Wind_f_inst",
           "Rainf_tavg", "Snowf_tavg"}
SOIL = ["SoilMoi0_10cm_inst", "SoilMoi10_40cm_inst", "SoilMoi40_100cm_inst", "SoilMoi100_200cm_inst"]
TARGETS = {   # key: (中文, 組成, 單位處理, 類型, 定義依賴的候選)
    "precip":   ("降水", ["Rainf_f_tavg"], "通量", {"Rainf_tavg", "Snowf_tavg"}),
    "et":       ("實際蒸散", ["Evap_tavg"], "通量", {"Qle_tavg", "ESoil_tavg", "ECanop_tavg", "Tveg_tavg"}),
    "soil_root":("根層土壤水", ["RootMoist_inst"], "存量", set(SOIL)),
    "soil_top": ("表層土壤水 0–10 cm", ["SoilMoi0_10cm_inst"], "存量", {"RootMoist_inst"}),
    "runoff":   ("逕流（地表＋基流）", ["Qs_acc", "Qsb_acc"], "通量", {"Qs_acc", "Qsb_acc"}),
    "swe":      ("積雪水當量", ["SWE_inst"], "存量", {"SnowDepth_inst", "Qsm_acc", "Snowf_tavg"}),
    "tws":      ("模型儲水（土壤＋雪＋冠層）", SOIL + ["SWE_inst", "CanopInt_inst"], "存量",
                 set(SOIL) | {"SWE_inst", "CanopInt_inst", "RootMoist_inst", "SnowDepth_inst"}),
}


# ---------- 讀資料（每個區域快取一次） ----------
def region_cells(region_id):
    m = np.load(os.path.join(ROOT, "data", "masks", "regions_1deg.npz"))
    for t in ("basin3", "basin4", "ice", "lme", "sea", "named", "hex"):
        ids = list(m[f"{t}_ids"])
        if region_id in ids:
            k = ids.index(region_id)
            sel = m[t][k] if t == "named" else (m[t] == k)
            return sel[30:180]          # GLDAS 緯度 −59.5..89.5 = 全球 1° 格網第 30–179 列
    sys.exit(f"找不到區域 {region_id}")


def load_region(region_id):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, re.sub(r"[^\w-]", "_", region_id) + ".npz")
    if os.path.exists(f):
        z = np.load(f, allow_pickle=True)
        return {k: z[k] for k in z.files}
    import netCDF4
    files = sorted(glob.glob(os.path.join(SRC, "GLDAS_NOAH10_M.A??????.021.nc4")))
    sel = region_cells(region_id)
    iy, ix = np.nonzero(sel)
    with netCDF4.Dataset(files[0]) as d:
        lat = np.array(d["lat"][:]); names = [v for v, x in d.variables.items() if x.ndim == 3]
    cube = {v: np.full((len(files), iy.size), np.nan, np.float32) for v in names}
    for t, fn in enumerate(files):
        with netCDF4.Dataset(fn) as d:
            for v in names:
                cube[v][t] = np.ma.filled(d[v][0][iy, ix].astype(np.float32), np.nan)
    months = np.array([re.search(r"\.A(\d{6})\.", x).group(1) for x in files])
    out = dict(months=months, lat=lat[iy], lon=np.array(-179.5 + ix), names=np.array(names), **{f"v_{k}": a for k, a in cube.items()})
    np.savez_compressed(f, **out)
    return out


# ---------- 統計工具 ----------
def area_mean(a, w):            # a: (T, cells)
    ok = np.isfinite(a)
    return np.where(ok.any(1), np.nansum(np.where(ok, a, 0) * w, 1) / np.maximum((ok * w).sum(1), 1e-12), np.nan)


def design(month_idx, T):       # 月份效果 + 線性時間
    X = np.zeros((T, 13)); X[np.arange(T), month_idx] = 1; X[:, 12] = (np.arange(T) - T / 2) / 120.0
    return X


def resid(y, X):
    ok = np.isfinite(y)
    b, *_ = np.linalg.lstsq(X[ok], y[ok], rcond=None)
    e = np.full_like(y, np.nan); e[ok] = y[ok] - X[ok] @ b
    return e, b


def deseason(y, month_idx):
    clim = np.array([np.nanmean(y[month_idx == m]) for m in range(12)])
    return y - clim[month_idx]


def ols_ar1(y):                 # y: 去季節月距平（每月一點）
    ok = np.isfinite(y); t = np.arange(y.size)[ok] / 120.0; v = y[ok]   # 斜率單位：每十年
    tm = t - t.mean(); b = (tm * (v - v.mean())).sum() / (tm ** 2).sum()
    r = v - v.mean() - b * tm; n = v.size
    rho = np.corrcoef(r[:-1], r[1:])[0, 1]
    neff = max(3.0, n * (1 - rho) / (1 + rho)) if rho > 0 else n
    se = math.sqrt((r ** 2).sum() / (neff - 2) / (tm ** 2).sum())
    from scipy import stats
    tcrit = stats.t.ppf(0.975, neff - 2); p = 2 * stats.t.sf(abs(b / se), neff - 2)
    return dict(slope_per_decade=b, ci95=[b - tcrit * se, b + tcrit * se], p=p, n=int(n), n_eff=round(neff, 1), ar1=round(rho, 3))


def mk_sen(x):
    from scipy import stats
    x = np.asarray(x, float); x = x[np.isfinite(x)]; n = x.size
    i, j = np.triu_indices(n, 1); d = x[j] - x[i]
    S = np.sign(d).sum(); var = n * (n - 1) * (2 * n + 5) / 18
    z = (S - np.sign(S)) / math.sqrt(var); p = 2 * stats.norm.sf(abs(z))
    return dict(sen_per_decade=float(np.median(d / (j - i))) * 10, p=float(p), n_years=int(n))


def phase_surrogates(x, n, rng):  # Ebisuzaki 1997：保留功率譜，隨機相位
    T = x.size; F = np.fft.rfft(x)
    ph = rng.uniform(0, 2 * np.pi, (n, F.size)); ph[:, 0] = 0
    if T % 2 == 0: ph[:, -1] = 0
    return np.fft.irfft(np.abs(F) * np.exp(1j * (np.angle(F) + ph)), n=T)


def lag_corr(ey, EX, L):        # ey: (T,), EX: (N,T) → (N, 2L+1)；r(ℓ)=corr(ey(t), ex(t−ℓ))
    out = []
    for l in range(-L, L + 1):
        if l >= 0: a, B = ey[l:], EX[:, :EX.shape[1] - l]
        else:      a, B = ey[:l], EX[:, -l:]
        a = (a - a.mean()) / a.std(); B = (B - B.mean(1, keepdims=True)) / B.std(1, keepdims=True)
        out.append((B * a).mean(1))
    return np.stack(out, 1)


def by_fdr(p, q):
    p = np.asarray(p, float); m = p.size
    if m == 0: return np.zeros(0, bool), np.zeros(0)
    c = (1 / np.arange(1, m + 1)).sum(); o = np.argsort(p)
    adj = np.minimum.accumulate((p[o] * m * c / np.arange(1, m + 1))[::-1])[::-1]
    out = np.empty(m); out[o] = np.minimum(adj, 1)
    return out <= q, out


# ---------- 外部（獨立）候選 ----------
POWER_DEF = {   # 欄位: (中文, 單位, 對應 GLDAS 概念 → 跨資料集驗證用)
    "PRECTOTCORR": ("降水（MERRA-2 校正）", "mm/day", "precip"), "T2M": ("2 m 氣溫（MERRA-2）", "°C", "tair"),
    "GWETROOT": ("根層土壤濕度（MERRA-2，0–1）", "0–1", "soil_root"), "GWETTOP": ("表層土壤濕度（MERRA-2，0–1）", "0–1", "soil_top"),
    "QV2M": ("2 m 比濕（MERRA-2）", "g/kg", None), "ALLSKY_SFC_SW_DWN": ("地表向下短波（CERES/MERRA-2）", "MJ/m²/day", None),
    "WS2M": ("2 m 風速（MERRA-2）", "m/s", None), "EVPTRNS": ("蒸散能量通量（MERRA-2）", "MJ/m²/day", "et"),
    "EVLAND": ("陸地蒸發（MERRA-2）", "mm/day", "et"),
}


def external_candidates(region_id, months):
    out = []
    T = len(months); key = [f"{m[:4]}{m[4:]}" for m in months]
    ind = os.path.join(ROOT, "data", "raw", "indices", "indices.json")
    if os.path.exists(ind):
        d = json.load(open(ind)); st = d["start"].replace("-", "")
        k0 = key.index(st) if st in key else 0
        for k, v in d["indices"].items():
            a = np.full(T, np.nan); vals = np.array([np.nan if x is None else x for x in v["values"]], float)
            a[k0:k0 + vals.size] = vals[:T - k0]
            out.append(dict(key=f"idx:{k}", zh=v["name"], unit=v["unit"], series=a, source=f"{v['agency']}（{v['url']}）",
                            dep="獨立資料", same_concept=None, gridded=False, domain="跨領域：海洋氣候振盪"))
    slug = re.sub(r"[^\w-]", "_", region_id)
    pw = os.path.join(ROOT, "data", "raw", "power", slug + ".json")
    if os.path.exists(pw):
        d = json.load(open(pw))
        for k, (zh, u, concept) in POWER_DEF.items():
            if k not in d["series"]:
                continue
            a = np.full(T, np.nan)
            for i, m in enumerate(key):
                v = d["series"][k].get(m)
                if v is not None and v > -900:
                    a[i] = v
            hyd = k in ("PRECTOTCORR", "GWETROOT", "GWETTOP", "EVLAND", "EVPTRNS")
            out.append(dict(key=f"m2:{k}", zh=zh, unit=u, series=a, source=f"NASA POWER（MERRA-2 等，{d['n_points']} 點平均）",
                            dep="獨立產品", same_concept=concept, gridded=False,
                            domain="水文（另一產品）：預期中的水量收支關係" if hyd else "跨領域：大氣與能量"))
    return out


def verdict_of(p_a, p_b, agree):
    sa, sb = p_a < 0.05, p_b < 0.05
    if not sa and not sb:
        return "兩個資料集都沒有顯著趨勢"
    if agree and sa and sb:
        return "趨勢方向一致且兩者都顯著：Robust"
    if agree:
        return "方向一致，但只有一個資料集顯著：Suggestive"
    if sa and sb:
        return "兩個資料集的顯著趨勢方向相反：結論依資料集而定"
    return "方向相反，且只有一個資料集顯著：不可靠"


# ---------- 主流程 ----------
def run(region_id, targets):
    t0 = time.time(); rng = np.random.default_rng(POLICY["seed"])
    D = load_region(region_id)
    months = [str(m) for m in D["months"]]; T = len(months); mi = np.array([int(m[4:]) - 1 for m in months])
    w = np.cos(np.deg2rad(D["lat"])); ncell = w.size
    names = [str(n) for n in D["names"]]
    cell = {v: conv(v, D[f"v_{v}"].astype(float))[0] for v in names}
    unit = {v: conv(v, np.zeros(1))[1] or "" for v in names}
    def tgt_cells(k): return sum(cell[v] for v in TARGETS[k][1])
    series = {v: area_mean(cell[v], w) for v in names}
    X = design(mi, T)
    yrs = np.array([int(m[:4]) for m in months]); y0, y1 = POLICY["trend_years"]; in_tr = (yrs >= y0) & (yrs <= y1)
    ext = external_candidates(region_id, months)

    reg = json.load(open(os.path.join(ROOT, "web", "public", "data", "catalog", "regions.json")))["regions"]
    rinfo = next(r for r in reg if r["id"] == region_id)
    sources = [dict(product="GLDAS_NOAH10_M 2.1（1°、月）", agency="NASA GES DISC", doi="10.5067/SXAVCZFAQLNO", role="水文目標＋同源候選")]
    if any(c["key"].startswith("m2:") for c in ext):
        sources.append(dict(product="NASA POWER 月資料（MERRA-2 等）", agency="NASA LaRC", url="https://power.larc.nasa.gov/", role="獨立候選＋跨資料集驗證"))
    if any(c["key"].startswith("idx:") for c in ext):
        sources.append(dict(product="氣候指數 Niño3.4 / DMI / PDO", agency="NOAA PSL（非 NASA）", url="https://psl.noaa.gov/", role="獨立候選"))
    res = dict(policy=POLICY, region=dict(id=region_id, name=rinfo["name"], type=rinfo["type"], area_km2=rinfo["area_km2"], cells_1deg=int(ncell)),
               data=dict(sources=sources, period=f"{months[0][:4]}-{months[0][4:]} ~ {months[-1][:4]}-{months[-1][4:]}", months=int(T),
                         candidates_total=len(names) + len(ext),
                         completeness="部分完成：候選只含 GLDAS 1°、NASA POWER（MERRA-2）與 NOAA 氣候指數，尚未接入官方 Resources 全量目錄"),
               targets=[], validation=[], tests=[])

    def trend_of(y):
        ds = deseason(y, mi); o = ols_ar1(ds[in_tr])
        ann = [np.nanmean(y[yrs == yy]) for yy in range(y0, y1 + 1)]
        return o, mk_sen(ann), float(np.nanmean(y[in_tr]))

    # --- 目標趨勢 ---
    for k in targets:
        y = area_mean(tgt_cells(k), w); o, mk, mean = trend_of(y)
        res["targets"].append(dict(key=k, name=TARGETS[k][0], kind=TARGETS[k][2], unit="mm/day" if TARGETS[k][2] == "通量" else "mm",
                                   mean=mean, ols=o, mk=mk, pct_per_decade=o["slope_per_decade"] / abs(mean) * 100 if abs(mean) > 1e-6 else None,
                                   series=[None if not np.isfinite(v) else round(float(v), 5) for v in y]))
        # 跨資料集驗證：同概念的獨立產品
        for c in ext:
            if c["same_concept"] != k:
                continue
            xo, xmk, xm = trend_of(c["series"])
            ey, _ = resid(y, X); ex, _ = resid(c["series"], X); ok = np.isfinite(ey) & np.isfinite(ex)
            r_anom = float(np.corrcoef(ey[ok], ex[ok])[0, 1]); dsy, dsx = deseason(y, mi), deseason(c["series"], mi)
            ok2 = np.isfinite(dsy) & np.isfinite(dsx)
            agree = (np.sign(o["slope_per_decade"]) == np.sign(xo["slope_per_decade"]))
            both_sig = o["p"] < 0.05 and xo["p"] < 0.05
            verdict = verdict_of(o["p"], xo["p"], agree)
            res["validation"].append(dict(target=k, product=c["source"], field=c["key"][3:], name=c["zh"], unit=c["unit"],
                                          slope_per_decade=xo["slope_per_decade"], ci95=xo["ci95"], p=xo["p"], mean=xm,
                                          pct_per_decade=xo["slope_per_decade"] / abs(xm) * 100 if abs(xm) > 1e-6 else None,
                                          r_anomaly=r_anom, r_deseason=float(np.corrcoef(dsy[ok2], dsx[ok2])[0, 1]),
                                          n=int(ok.sum()), verdict=verdict,
                                          series=[None if not np.isfinite(v) else round(float(v), 4) for v in c["series"]]))
    sig, adj = by_fdr([t["ols"]["p"] for t in res["targets"]], POLICY["q"])
    for t, s_, a in zip(res["targets"], sig, adj): t["ols"]["p_by"] = float(a); t["significant"] = bool(s_)

    L = POLICY["max_lag"]; half = T // 2
    def tt_trend(A):
        tt = (np.arange(A.shape[0]) - A.shape[0] / 2) / 120.0
        Am = A - np.nanmean(A, 0); okk = np.isfinite(Am)
        tmm = np.where(okk, tt[:, None], 0).sum(0) / np.maximum(okk.sum(0), 1)
        tc = np.where(okk, tt[:, None] - tmm, 0)
        return (tc * np.where(okk, Am, 0)).sum(0) / np.maximum((tc ** 2).sum(0), 1e-12)

    for k in targets:
        ycell = tgt_cells(k); y = area_mean(ycell, w); ey, _ = resid(y, X)
        cands = [dict(key=v, zh=ZH.get(v, v), unit=unit[v], series=series[v], gridded=True, domain="同源模型",
                      dep="定義依賴" if v in TARGETS[k][3] else "同源模型", source="GLDAS_NOAH10_M 2.1", field=v)
                 for v in names if v not in TARGETS[k][1]]
        cands += [dict(c, field=c["key"].split(":", 1)[1]) for c in ext if c["same_concept"] != k]
        for c in cands:
            x = c["series"]
            if np.nanstd(x) < 1e-9 or np.isfinite(x).sum() < 120:
                res["tests"].append(dict(target=k, candidate=c["key"], candidate_zh=c["zh"], kind="time", status="不適用",
                                         reason="區域內沒有有效變異或共同樣本少於 120 個月"))
                continue
            ex, _ = resid(x, X); ok = np.isfinite(ey) & np.isfinite(ex)
            # 共同期間：取兩者都有值的連續最長區段
            idx = np.nonzero(ok)[0]; a0, a1 = idx.min(), idx.max() + 1
            a, b = ey[a0:a1].copy(), ex[a0:a1].copy()
            if not np.isfinite(a).all() or not np.isfinite(b).all():
                good = np.isfinite(a) & np.isfinite(b); a = np.where(good, a, 0); b = np.where(good, b, 0)
            r_obs = lag_corr(a, b[None, :], L)[0]
            sur = phase_surrogates(b - b.mean(), POLICY["n_surr_time"], rng)
            null = np.abs(lag_corr(a, sur, L)).max(1)
            stat = np.abs(r_obs).max(); p = (1 + (null >= stat).sum()) / (null.size + 1)
            li = int(np.argmax(np.abs(r_obs))); best = li - L
            support = [l - L for l in range(2 * L + 1) if abs(r_obs[l]) >= 0.9 * stat and np.sign(r_obs[l]) == np.sign(r_obs[li])]
            def rr(lo, hi):
                aa = a[lo:hi]; bb = np.roll(b, best)[lo:hi]
                m2 = np.ones(aa.size, bool)
                if best > 0: m2[:max(0, best - lo)] = False
                return float(np.corrcoef(aa[m2], bb[m2])[0, 1])
            hh = a.size // 2; r1, r2 = rr(0, hh), rr(hh, a.size)
            stable = bool(np.sign(r1) == np.sign(r2) == np.sign(r_obs[li]) and min(abs(r1), abs(r2)) >= 0.1)
            m3 = np.isfinite(y) & np.isfinite(x)
            raw = float(np.corrcoef(y[m3], x[m3])[0, 1])
            dsy, dsx = deseason(y, mi), deseason(x, mi); m4 = np.isfinite(dsy) & np.isfinite(dsx)
            r_des = float(np.corrcoef(dsy[m4], dsx[m4])[0, 1])
            res["tests"].append(dict(target=k, candidate=c["key"], candidate_zh=c["zh"], unit=c["unit"], source=c["source"], field=c["field"],
                                     kind="time", dependency=c["dep"], domain=c["domain"], status="已分析",
                                     period=f"{months[a0][:4]}-{months[a0][4:]} ~ {months[a1 - 1][:4]}-{months[a1 - 1][4:]}", n=int(a.size),
                                     lags=list(range(-L, L + 1)), r_lag=[round(float(z), 4) for z in r_obs], best_lag=best,
                                     r_best=float(r_obs[li]), lag_support=support, p=float(p), r_raw=raw, r_deseason=r_des,
                                     r_anom_lag0=float(r_obs[L]), halves=[r1, r2], stable=stable))
            if not c["gridded"] or ncell < POLICY["min_cells_spatial"]:
                continue
            xc = cell[c["key"]]
            dy = np.stack([deseason(ycell[:, j], mi) for j in range(ncell)], 1)[in_tr]
            dx = np.stack([deseason(xc[:, j], mi) for j in range(ncell)], 1)[in_tr]
            good = (np.isfinite(dy).mean(0) > 0.9) & (np.isfinite(dx).mean(0) > 0.9)
            if good.sum() < POLICY["min_cells_spatial"]:
                res["tests"].append(dict(target=k, candidate=c["key"], candidate_zh=c["zh"], kind="space", status="不適用", reason="有效格點不足"))
                continue
            by_, bx = tt_trend(dy[:, good]), tt_trend(dx[:, good]); ww = w[good]
            if np.std(bx) < 1e-12 or np.std(by_) < 1e-12:
                res["tests"].append(dict(target=k, candidate=c["key"], candidate_zh=c["zh"], kind="space", status="不適用", reason="趨勢場沒有空間變異")); continue
            def wc(a_, b_):
                am = (a_ * ww).sum() / ww.sum(); bm = (b_ * ww).sum() / ww.sum()
                return (ww * (a_ - am) * (b_ - bm)).sum() / math.sqrt((ww * (a_ - am) ** 2).sum() * (ww * (b_ - bm) ** 2).sum())
            r_sp = wc(by_, bx)
            tt = (np.arange(dx.shape[0]) - dx.shape[0] / 2) / 120.0; tc = tt - tt.mean()
            A = np.nan_to_num(dx[:, good] - np.nanmean(dx[:, good], 0) - bx[None, :] * tc[:, None])
            F = np.fft.rfft(A, axis=0); Ns = POLICY["n_surr_space"]; cnt = 0
            bym = (by_ * ww).sum() / ww.sum()
            for s0 in range(0, Ns, 250):
                ns = min(250, Ns - s0)
                ph = rng.uniform(0, 2 * np.pi, (ns, F.shape[0], 1)); ph[:, 0] = 0
                if A.shape[0] % 2 == 0: ph[:, -1] = 0
                S = np.fft.irfft(F[None] * np.exp(1j * ph), n=A.shape[0], axis=1)
                bs = (tc[None, :, None] * (S - S.mean(1, keepdims=True))).sum(1) / (tc ** 2).sum()
                am = (bs * ww).sum(1, keepdims=True) / ww.sum()
                rs = (ww * (bs - am) * (by_ - bym)).sum(1) / np.sqrt((ww * (bs - am) ** 2).sum(1) * (ww * (by_ - bym) ** 2).sum())
                cnt += (np.abs(rs) >= abs(r_sp)).sum()
            res["tests"].append(dict(target=k, candidate=c["key"], candidate_zh=c["zh"], unit=c["unit"], source=c["source"], field=c["field"],
                                     kind="space", dependency=c["dep"], domain=c["domain"], status="已分析", n_cells=int(good.sum()),
                                     period=f"{y0}–{y1}", r=float(r_sp), p=float((1 + cnt) / (Ns + 1)),
                                     beta_target=[round(float(z), 5) for z in by_], beta_candidate=[round(float(z), 5) for z in bx],
                                     cells=[[float(D["lat"][j]), float(D["lon"][j])] for j in np.nonzero(good)[0]]))

    done = [t for t in res["tests"] if t["status"] == "已分析"]
    sig, adj = by_fdr([t["p"] for t in done], POLICY["q"])
    for t, s_, a in zip(done, sig, adj):
        t["p_by"] = float(a); t["significant"] = bool(s_)
        indep = t["dependency"] in ("獨立資料", "獨立產品")
        t["recommended"] = bool(s_ and indep and (t["kind"] == "space" or t["stable"]))
        t["why_not"] = (None if t["recommended"] else
                        "校正後不顯著" if not s_ else
                        "定義依賴：候選是目標的組成或同一個量" if t["dependency"] == "定義依賴" else
                        "同源模型：同一個陸面模型內部的關係，不是獨立證據" if t["dependency"] == "同源模型" else
                        "前後半期不穩定")
        if t["kind"] == "time":
            if s_ and abs(t["r_raw"]) > 0.5 and abs(t["r_anom_lag0"]) < 0.5 * abs(t["r_raw"]):
                t["season_note"] = "原始連動強，調整季節後減弱：大部分來自共同季節循環，但調整後仍有異常連動"
            elif s_:
                t["season_note"] = "調整季節循環與長期趨勢後仍有異常連動"
            elif abs(t["r_raw"]) > 0.5:
                t["season_note"] = "原始資料連動，調整季節與趨勢後證據不足：與共同季節變化的解釋一致"
            elif abs(t["r_deseason"]) > 0.3:
                t["season_note"] = "去季節後仍相關，但去趨勢後證據不足：主要是共同長期走勢"
            else:
                t["season_note"] = "證據不足"
    rec = [t for t in done if t["recommended"]]
    res["family"] = dict(size=len(done), method="Benjamini–Yekutieli FDR", q=POLICY["q"],
                         not_applicable=sum(t["status"] == "不適用" for t in res["tests"]),
                         n_significant=int(sig.sum()), n_recommended=len(rec),
                         n_same_model_significant=sum(t.get("significant", False) and t["dependency"] == "同源模型" for t in done),
                         note="FDR 控制的是整個檢定家族的錯誤發現率，不是每條推薦正確的機率")
    res["status"] = "已完成（部分候選）" if rec else "已完成（部分候選）：目前未找到可靠關聯"
    res["runtime_s"] = round(time.time() - t0, 1)
    return res


def report(res):
    f = res["family"]
    L = [f"# {res['region']['name']}（{res['region']['id']}）", "",
         f"狀態：**{res['status']}**。{res['data']['completeness']}。",
         f"資料期間 {res['data']['period']}；區域 {res['region']['area_km2']:,} km²、1° 格點 {res['region']['cells_1deg']} 個；候選 {res['data']['candidates_total']} 個。",
         f"檢定家族 {f['size']} 項（{f['method']}，q={f['q']}）：顯著 {f['n_significant']}，其中同源模型 {f['n_same_model_significant']}；推薦 {f['n_recommended']}；不適用 {f['not_applicable']}。", "",
         "資料來源：" + "；".join(f"{s['product']}（{s['agency']}）— {s['role']}" for s in res["data"]["sources"]), "",
         "## 1. 水文目標的趨勢（2000–2025，GLDAS）", "",
         "| 目標 | 平均 | 每十年（OLS-AR1） | 95% CI | p（BY） | MK p | Sen 每十年 |", "|---|---|---|---|---|---|---|"]
    for t in res["targets"]:
        o = t["ols"]; pct = f"（{t['pct_per_decade']:+.1f}%）" if t["pct_per_decade"] is not None else ""
        L.append(f"| {t['name']} | {t['mean']:.3g} {t['unit']} | {o['slope_per_decade']:+.3g}{pct} | {o['ci95'][0]:+.3g} ~ {o['ci95'][1]:+.3g} | {o['p_by']:.2g} | {t['mk']['p']:.2g} | {t['mk']['sen_per_decade']:+.3g} |")
    if res["validation"]:
        L += ["", "## 2. 跨資料集驗證（GLDAS vs 獨立產品）", "",
              "| 目標 | 獨立產品欄位 | 該產品每十年 | p | 異常相關 r | 判定 |", "|---|---|---|---|---|---|"]
        for v in res["validation"]:
            pct = f"（{v['pct_per_decade']:+.1f}%）" if v["pct_per_decade"] is not None else ""
            tn = next(t["name"] for t in res["targets"] if t["key"] == v["target"])
            L.append(f"| {tn} | {v['name']} | {v['slope_per_decade']:+.3g} {v['unit']}{pct} | {v['p']:.2g} | {v['r_anomaly']:+.2f} | {v['verdict']} |")
    L += ["", "## 3. 推薦的研究線索（只限獨立資料，校正後顯著且穩定）", ""]
    rec = sorted([t for t in res["tests"] if t.get("recommended")], key=lambda t: -abs(t.get("r_best", t.get("r", 0))))
    if not rec:
        L.append("目前未找到可靠關聯。")
    for title, sel in (("### 3a. 跨領域：其他東西怎麼影響水", lambda t: t["domain"].startswith("跨領域")),
                       ("### 3b. 水文跨產品：預期中的水量收支關係", lambda t: t["domain"].startswith("水文"))):
        part = [t for t in rec if sel(t)]
        if not rec:
            break
        L += ["", title, ""]
        if not part:
            L.append("無。"); continue
        L += ["| 水文目標 | 候選 | r | 延遲（月，正=候選先變） | p（BY） | 前後半期 r | 季節說明 |", "|---|---|---|---|---|---|---|"]
        for t in part:
            tn = next(x["name"] for x in res["targets"] if x["key"] == t["target"])
            L.append(f"| {tn} | {t['candidate_zh']} | {t['r_best']:+.2f} | {t['best_lag']:+d}（{min(t['lag_support']):+d}~{max(t['lag_support']):+d}） | {t['p_by']:.2g} | {t['halves'][0]:+.2f} / {t['halves'][1]:+.2f} | {t['season_note']} |")
    ns = [t for t in res["tests"] if t.get("status") == "已分析" and t["dependency"] in ("獨立資料", "獨立產品") and not t.get("recommended")]
    if ns:
        L += ["", "已檢驗但未推薦的獨立候選：" + "；".join(f"{next(x['name'] for x in res['targets'] if x['key']==t['target'])}×{t['candidate_zh']}（r={t['r_best']:+.2f}，{t['why_not']}）" for t in sorted(ns, key=lambda t: t['p'])[:12])]
    sm = sorted([t for t in res["tests"] if t.get("significant") and t["dependency"] == "同源模型" and t["kind"] == "time"], key=lambda t: -abs(t["r_best"]))[:6]
    if sm:
        L += ["", "同源模型內部關係（顯著但不推薦，僅供理解模型）：" + "；".join(f"{next(x['name'] for x in res['targets'] if x['key']==t['target'])}×{t['candidate_zh']} r={t['r_best']:+.2f} 延遲 {t['best_lag']:+d}" for t in sm)]
    L += ["", f"_{res['family']['note']}。方法版本 {res['policy']['version']}，執行 {res['runtime_s']} 秒。_"]
    return "\n".join(L)


if __name__ == "__main__":
    rid, tg = sys.argv[1], sys.argv[2:5]
    for k in tg:
        assert k in TARGETS, f"目標要是 {list(TARGETS)}"
    res = run(rid, tg)
    slug = re.sub(r"[^\w-]", "_", rid)
    os.makedirs(os.path.join(ROOT, "web", "public", "data", "results"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "analysis", "results"), exist_ok=True)
    open(os.path.join(ROOT, "web", "public", "data", "results", f"{slug}.json"), "w").write(json.dumps(res, ensure_ascii=False, default=float))
    md = report(res)
    open(os.path.join(ROOT, "analysis", "results", f"{slug}.md"), "w").write(md)
    print(md)
