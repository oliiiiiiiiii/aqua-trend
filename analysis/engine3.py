#!/usr/bin/env python3
"""
Aqua Trend 研究引擎 0.3：接入隊友 hub.py 匯出的多產品資料（data/hub_export/）

和 0.2 的差別
- 水文目標改用 spec 指定的產品：降水=GPM IMERG、總儲水=GRACE、蒸散=MERRA-2、土壤水=GLDAS 0.25°…
  每個目標另外用同概念的其他產品做交叉驗證（M9）
- 候選＝hub 的所有層 + GLDAS 1° 中 hub 沒有的欄位（去重）+ 氣候指數
- 每對變數用各自的共同期間（不是單一固定期間）；有缺月時只用有觀測的月份計算相關
- 產品家族與資料依賴：同家族＝同源模型；GLDAS 降水驅動來自 GPCP、IMERG 與 GPCP 共用測站校正＝部分依賴
用法：python3 analysis/engine3.py <region_id> <target1> [target2] [target3]
目標：precip tws et soil runoff snow
"""
import json, math, os, re, sys, time, warnings
import numpy as np
warnings.filterwarnings("ignore", category=RuntimeWarning)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import research_engine as E   # 重用統計工具：resid、ols_ar1、mk_sen、phase_surrogates、by_fdr、verdict_of、load_region、conv、ZH

ROOT = E.ROOT
HUB = os.environ.get("AQUA_HUB", os.path.join(ROOT, "data", "hub_export"))
POLICY = dict(version="engine-0.3", max_lag=6, q=0.05, n_surr_time=int(os.environ.get("NS_TIME", 20000)), n_surr_space=int(os.environ.get("NS_SPACE", 2000)), min_months=120,
              min_cells_spatial=15, seed=20261114, max_gap_frac=0.15)  # 合成驗證：缺月 10.7% 時誤報率 5.5%
M0 = (1979, 1); NM = (2026 - 1979 + 1) * 12          # 主時間軸 1979-01 ~ 2026-12
MONTHS = [f"{1979 + i // 12}-{i % 12 + 1:02d}" for i in range(NM)]
MI = np.array([i % 12 for i in range(NM)])

# 產品家族（同家族＝同源）與部分依賴
FAMILY = {"tws": "GRACE", "p_imerg": "IMERG", "p_gpcp": "GPCP", "sst": "OISST", "ndvi": "MODIS", "lst_day": "MODIS"}
for k in ("p_m2", "p_m2land", "et_m2", "et_m2land", "sm_m2", "ro_m2", "rn_m2", "tsurf_m2"): FAMILY[k] = "MERRA-2"
for k in ("et_gldas", "pet_gldas", "sm_root", "sm_total", "runoff", "swe", "tair", "vpd", "rn", "swdown", "wind"): FAMILY[k] = "GLDAS"
PARTIAL = {frozenset(("GLDAS", "GPCP")): "GLDAS-2.1 的降水驅動來自 GPCP", frozenset(("IMERG", "GPCP")): "IMERG Final 與 GPCP 共用 GPCC 測站校正",
           frozenset(("MERRA-2", "GPCP")): "MERRA-2 校正降水使用 CPCU/GPCP 測站資料",
           frozenset(("IMERG", "GLDAS")): "GLDAS-2.1 的降水驅動（GPCP）與 IMERG 共用 GPCC 測站",
           frozenset(("MERRA-2", "GLDAS")): "兩個模型的降水輸入都含測站校正，非完全獨立"}
CONCEPT = {"precip": {"p_imerg", "p_gpcp", "p_m2", "p_m2land", "g:Rainf_f_tavg", "g:Rainf_tavg"},
           "et": {"et_m2", "et_m2land", "et_gldas", "g:Qle_tavg", "g:ESoil_tavg", "g:ECanop_tavg", "g:Tveg_tavg"},
           "soil": {"sm_root", "sm_total", "sm_m2", "g:SoilMoi0_10cm_inst", "g:SoilMoi10_40cm_inst", "g:SoilMoi40_100cm_inst", "g:SoilMoi100_200cm_inst"},
           "runoff": {"runoff", "ro_m2", "g:Qs_acc", "g:Qsb_acc"},
           "snow": {"swe", "g:SnowDepth_inst", "g:Snowf_tavg", "g:Qsm_acc"},
           "tws": {"tws", "sm_total", "sm_root", "swe", "g:CanopInt_inst"}}
# 目標：(中文, 主要層, 驗證層們, 類型)
TARGET_NOTE = {"tws": "GRACE 的有效解析度約 300 km，小區域會混到周圍；大地震（如 2010 智利 M8.8、2011 日本 M9.0）會造成非水文的重力跳動；2017-07 ~ 2018-05 為衛星交接空窗",
               "precip": "IMERG Final 是多衛星降水估計並含測站校正", "et": "MERRA-2 蒸發是再分析模型估計"}
TARGETS = {"precip": ("降水", "p_imerg", ["p_gpcp", "p_m2"], "通量"),
           "tws": ("陸地總儲水異常（GRACE）", "tws", ["sm_total"], "存量"),
           "et": ("實際蒸散", "et_m2", ["et_gldas", "et_m2land"], "通量"),
           "soil": ("根層土壤水", "sm_root", ["sm_m2"], "存量"),
           "runoff": ("逕流", "runoff", ["ro_m2"], "通量"),
           "snow": ("積雪水當量", "swe", [], "存量")}
CAVEAT = {"lst_day": "MODIS Terra 2020 年後軌道漂移，會造成假的降溫趨勢（隊友 FINDINGS W6）",
          "et_gldas": "GLDAS-2.1 蒸散長期趨勢有已知漂移（隊友 FINDINGS W11）", "pet_gldas": "GLDAS-2.1 潛在蒸散趨勢有已知漂移",
          "tws": "GRACE 有效解析度約 300 km；大地震會造成非水文的重力跳動", "p_gpcp": "GPCP 由 NOAA PSL 發布（非 NASA 入口）",
          "sst": "NOAA OISST（非 NASA）", "idx:nino34": "NOAA 資料（非 NASA）", "idx:dmi": "NOAA PSL 資料（非 NASA）", "idx:pdo": "NOAA 資料（非 NASA）"}
# GLDAS 1° 欄位中和 hub 重複者（去重：只留 hub 版本）
DUP_G1 = {"Evap_tavg": "et_gldas", "PotEvap_tavg": "pet_gldas", "RootMoist_inst": "sm_root", "SWE_inst": "swe",
          "Tair_f_inst": "tair", "SWdown_f_tavg": "swdown", "Wind_f_inst": "wind", "Rainf_f_tavg": "（GLDAS 降水驅動，hub 未匯出；保留）"}


def on_axis(times, vals):
    out = np.full(NM, np.nan)
    for t, v in zip(times, vals):
        y, m = int(t[:4]), int(t[5:7]); i = (y - 1979) * 12 + m - 1
        if 0 <= i < NM: out[i] = v
    return out


def load_hub():
    if not os.path.exists(os.path.join(HUB, "region_ids.npy")):
        sys.exit(f"找不到 {HUB}：請先把 meow1 上的 aqua_hub_export 複製過來")
    ids = [str(x) for x in np.load(os.path.join(HUB, "region_ids.npy"))]
    man = json.load(open(os.path.join(HUB, "manifest.json")))
    return ids, man


def layer(name, ridx, rid):
    z = np.load(os.path.join(HUB, f"{name}.npz"))
    times = [str(t) for t in z["times"]]
    s = on_axis(times, z["series"][ridx].astype(float))
    key = rid.replace("-", "_")
    cells = None
    if f"cells__{key}" in z.files:
        A = z[f"cells__{key}"].astype(float); C = np.full((NM, A.shape[1]), np.nan)
        for j, t in enumerate(times):
            i = (int(t[:4]) - 1979) * 12 + int(t[5:7]) - 1
            if 0 <= i < NM: C[i] = A[j]
        idx = z[f"cellidx__{key}"]; cells = (C, -89.75 + 0.5 * (idx // 720))
    return s, float(z["coverage"][ridx]), cells


def resid_axis(y):               # 月份效果＋線性時間，只在有值的月份估計
    X = np.zeros((NM, 13)); X[np.arange(NM), MI] = 1; X[:, 12] = (np.arange(NM) - NM / 2) / 120.0
    return E.resid(y, X)[0]


def deseason(y):
    clim = np.array([np.nanmean(y[MI == m]) if np.isfinite(y[MI == m]).any() else np.nan for m in range(12)])
    return y - clim[MI]


def span(*arrs):                 # 共同期間：兩者都有值的第一個到最後一個月
    ok = np.ones(NM, bool)
    for a in arrs: ok &= np.isfinite(a)
    if not ok.any(): return None
    i = np.nonzero(ok)[0]; return i[0], i[-1] + 1, ok


def trend(y, anomaly=False):   # anomaly=True：距平產品（GRACE）不算百分比
    sp = span(y)
    if sp is None: return None
    a0, a1, _ = sp
    # 只用完整年份
    y0 = int(MONTHS[a0][:4]) + (0 if MONTHS[a0][5:] == "01" else 1); y1 = int(MONTHS[a1 - 1][:4]) - (0 if MONTHS[a1 - 1][5:] == "12" else 1)
    if y1 - y0 + 1 < 10: return None
    b0, b1 = (y0 - 1979) * 12, (y1 - 1979 + 1) * 12
    ds = deseason(y)[b0:b1]
    o = E.ols_ar1(ds) if np.isfinite(ds).sum() > 60 else None
    ann = [np.nanmean(y[(yy - 1979) * 12:(yy - 1979 + 1) * 12]) if np.isfinite(y[(yy - 1979) * 12:(yy - 1979 + 1) * 12]).sum() >= 10 else np.nan for yy in range(y0, y1 + 1)]
    mk = E.mk_sen([a for a in ann if np.isfinite(a)])
    mean = float(np.nanmean(y[b0:b1]))
    gaps = int((~np.isfinite(y[b0:b1])).sum())
    return dict(period=f"{y0}–{y1}", ols=o, mk=mk, mean=mean, missing_months=gaps,
                pct_per_decade=(o["slope_per_decade"] / abs(mean) * 100) if (o and abs(mean) > 1e-6 and not anomaly) else None)


def dependency(fa, fb, ca, cb):
    if ca and cb and ca == cb: return "同概念（交叉驗證用）", None
    if fa == fb: return "同源模型", f"同屬 {fa}"
    note = PARTIAL.get(frozenset((fa, fb)))
    if note: return "部分依賴", note
    return "獨立", None


def concept_of(key):
    for c, s in CONCEPT.items():
        if key in s: return c
    return None


def time_test(y, x, rng):
    ey, ex = resid_axis(y), resid_axis(x)
    sp = span(ey, ex)
    if sp is None: return None, "沒有共同期間"
    a0, a1, ok = sp; n = int(ok[a0:a1].sum())
    if n < POLICY["min_months"]: return None, f"共同有效月份只有 {n} 個（< {POLICY['min_months']}）"
    gap = 1 - n / (a1 - a0)
    if gap > POLICY["max_gap_frac"]: 
        # 改用最長連續段
        best, cur, s0 = (0, 0, 0), 0, a0
        for i in range(a0, a1):
            if ok[i]: cur += 1; best = max(best, (cur, i - cur + 1, i + 1))
            else: cur = 0
        n2, a0, a1 = best
        if n2 < POLICY["min_months"]: return None, f"缺月太多（{gap:.0%}），最長連續段只有 {n2} 個月"
        ok = np.zeros(NM, bool); ok[a0:a1] = True; gap = 0.0
    m = ok[a0:a1]; a = np.where(m, ey[a0:a1], 0.0); b = np.where(m, ex[a0:a1], 0.0)
    L = POLICY["max_lag"]

    def lagr(A, B):  # 只用兩邊都有觀測的月份
        out = []
        for l in range(-L, L + 1):
            if l >= 0: aa, bb, ma, mb = A[l:], B[:, :B.shape[1] - l], m[l:], m[:m.size - l]
            else: aa, bb, ma, mb = A[:l], B[:, -l:], m[:l], m[-l:]
            mm = ma & mb; aa = aa[mm]; bb = bb[:, mm]
            aa = (aa - aa.mean()) / aa.std(); bb = (bb - bb.mean(1, keepdims=True)) / bb.std(1, keepdims=True)
            out.append((bb * aa).mean(1))
        return np.stack(out, 1)
    r_obs = lagr(a, b[None])[0]
    sur = E.phase_surrogates(b - b[m].mean() * m, POLICY["n_surr_time"], rng)
    null = np.abs(lagr(a, sur)).max(1); stat = np.abs(r_obs).max()
    p = (1 + (null >= stat).sum()) / (null.size + 1)
    li = int(np.argmax(np.abs(r_obs))); best = li - L
    support = [l - L for l in range(2 * L + 1) if abs(r_obs[l]) >= 0.9 * stat and np.sign(r_obs[l]) == np.sign(r_obs[li])]
    h = (a1 - a0) // 2
    def half(lo, hi):
        A = ey[a0:a1]; B = np.roll(ex[a0:a1], best); mm = m.copy() & np.roll(m, best)
        if best > 0: mm[:best] = False
        elif best < 0: mm[best:] = False
        mm[:lo] = False; mm[hi:] = False
        return float(np.corrcoef(A[mm], B[mm])[0, 1]) if mm.sum() > 24 else float("nan")
    r1, r2 = half(0, h), half(h, a1 - a0)
    stable = bool(np.isfinite(r1) and np.isfinite(r2) and np.sign(r1) == np.sign(r2) == np.sign(r_obs[li]) and min(abs(r1), abs(r2)) >= 0.1)
    okr = np.isfinite(y) & np.isfinite(x); raw = float(np.corrcoef(y[okr], x[okr])[0, 1])
    dy, dx = deseason(y), deseason(x); okd = np.isfinite(dy) & np.isfinite(dx); rds = float(np.corrcoef(dy[okd], dx[okd])[0, 1])
    return dict(period=f"{MONTHS[a0]} ~ {MONTHS[a1 - 1]}", n=int(m.sum()), missing_frac=round(gap, 3),
                null_note=("有缺月：相關只用有觀測的月份，替代序列以 0 異常補缺月（近似）" if gap > 0 else None),
                lags=list(range(-L, L + 1)), r_lag=[round(float(v), 4) for v in r_obs], best_lag=best, r_best=float(r_obs[li]),
                lag_support=support, p=float(p), halves=[r1, r2], stable=stable, r_raw=raw, r_deseason=rds,
                edge_peak=bool(abs(best) == L), edge_note=("最強延遲在搜尋窗口邊界（±%d 月），實際延遲可能更長" % L) if abs(best) == L else None,
                r_anom_lag0=float(r_obs[L])), None


def space_test(Cy, Cx, w, rng):
    sp = span(np.nanmean(Cy, 1), np.nanmean(Cx, 1))
    if sp is None: return None, "沒有共同期間"
    a0, a1, _ = sp
    y0 = int(MONTHS[a0][:4]) + (MONTHS[a0][5:] != "01"); y1 = int(MONTHS[a1 - 1][:4]) - (MONTHS[a1 - 1][5:] != "12")
    if y1 - y0 + 1 < 10: return None, "共同完整年份少於 10 年"
    b0, b1 = (y0 - 1979) * 12, (y1 - 1979 + 1) * 12
    dy = np.stack([deseason(Cy[:, j]) for j in range(Cy.shape[1])], 1)[b0:b1]
    dx = np.stack([deseason(Cx[:, j]) for j in range(Cx.shape[1])], 1)[b0:b1]
    good = (np.isfinite(dy).mean(0) > 0.8) & (np.isfinite(dx).mean(0) > 0.8)
    if good.sum() < POLICY["min_cells_spatial"]: return None, f"有效格點 {int(good.sum())} 個，不足 {POLICY['min_cells_spatial']}"
    dy, dx, ww = dy[:, good], dx[:, good], w[good]
    T = dy.shape[0]; tt = (np.arange(T) - T / 2) / 120.0; tc = tt - tt.mean()
    def tr(A):
        Am = A - np.nanmean(A, 0); ok = np.isfinite(Am)
        return (np.where(ok, tc[:, None], 0) * np.where(ok, Am, 0)).sum(0) / np.maximum((np.where(ok, tc[:, None], 0) ** 2).sum(0), 1e-12)
    by, bx = tr(dy), tr(dx)
    if np.std(bx) < 1e-12 or np.std(by) < 1e-12: return None, "趨勢場沒有空間變異"
    bym = (by * ww).sum() / ww.sum()
    def wc(a): am = (a * ww).sum() / ww.sum(); return (ww * (a - am) * (by - bym)).sum() / math.sqrt((ww * (a - am) ** 2).sum() * (ww * (by - bym) ** 2).sum())
    r = wc(bx)
    A = np.nan_to_num(dx - np.nanmean(dx, 0) - bx[None] * tc[:, None]); F = np.fft.rfft(A, axis=0); cnt = 0; Ns = POLICY["n_surr_space"]
    for s0 in range(0, Ns, 250):
        ns = min(250, Ns - s0); ph = rng.uniform(0, 2 * np.pi, (ns, F.shape[0], 1)); ph[:, 0] = 0
        if T % 2 == 0: ph[:, -1] = 0
        S = np.fft.irfft(F[None] * np.exp(1j * ph), n=T, axis=1)
        bs = (tc[None, :, None] * (S - S.mean(1, keepdims=True))).sum(1) / (tc ** 2).sum()
        am = (bs * ww).sum(1, keepdims=True) / ww.sum()
        rs = (ww * (bs - am) * (by - bym)).sum(1) / np.sqrt((ww * (bs - am) ** 2).sum(1) * (ww * (by - bym) ** 2).sum())
        cnt += (np.abs(rs) >= abs(r)).sum()
    return dict(period=f"{y0}–{y1}", n_cells=int(good.sum()), r=float(r), p=float((1 + cnt) / (Ns + 1)),
                beta_target=[round(float(v), 5) for v in by], beta_candidate=[round(float(v), 5) for v in bx]), None


def run(rid, targets):
    t0 = time.time(); rng = np.random.default_rng(POLICY["seed"])
    ids, man = load_hub(); ri = ids.index(rid)
    reg = next(r for r in json.load(open(os.path.join(ROOT, "web", "public", "data", "catalog", "regions.json")))["regions"] if r["id"] == rid)
    # --- 候選目錄：hub 各層 + GLDAS 1° 未重複欄位 + 指數 ---
    cands, skipped = {}, []
    for name, info in man["layers"].items():
        if info.get("status") != "ok":
            skipped.append(dict(key=name, product=info.get("product"), reason="工程缺口：" + info.get("error", "讀取失敗"))); continue
        s, cov, cells = layer(name, ri, rid)
        unit = info.get("units", "")
        if unit == "K":                                   # MERRA-2 TSURF → °C
            s = s - 273.15; cells = (cells[0] - 273.15, cells[1]) if cells else None; unit = "°C"
        if name == "sst" and reg.get("surface") != "ocean":
            skipped.append(dict(key=name, product=info["product"], reason="不適用：海溫只在海洋格點有值，陸地區域內只有沿岸格點")); continue
        if not np.isfinite(s).any() or cov < 0.3:
            skipped.append(dict(key=name, product=info["product"], reason=f"不適用：區域內有效覆蓋 {cov:.0%}")); continue
        cands[name] = dict(key=name, zh=info["name"], product=info["product"], nasa=info["nasa"], unit=unit,
                           family=FAMILY.get(name, name), series=s, cells=cells, concept=concept_of(name), unit_fixed=unit)
    try:
        D = E.load_region(rid); w1 = np.cos(np.deg2rad(D["lat"]))
        g_months = [str(m) for m in D["months"]]
        for v in [str(x) for x in D["names"]]:
            if v in DUP_G1 and not DUP_G1[v].startswith("（"):
                skipped.append(dict(key="g:" + v, product="GLDAS_NOAH10_M 2.1", reason=f"重複映射：和 hub 的 {DUP_G1[v]} 是同一產品，只保留 0.25° 版本")); continue
            a = E.area_mean(E.conv(v, D[f"v_{v}"].astype(float))[0], w1)
            cands["g:" + v] = dict(key="g:" + v, zh=E.ZH.get(v, v), product="GLDAS_NOAH10_M 2.1（1°）", nasa=True,
                                   unit=E.conv(v, np.zeros(1))[1] or "", family="GLDAS",
                                   series=on_axis([f"{m[:4]}-{m[4:]}" for m in g_months], a), cells=None, concept=concept_of("g:" + v))
    except SystemExit:
        pass
    ind = json.load(open(os.path.join(HUB, "indices.json"))) if os.path.exists(os.path.join(HUB, "indices.json")) else {}
    for k, nm in (("nino34", "聖嬰指數 Niño 3.4"), ("dmi", "印度洋偶極 DMI"), ("pdo", "太平洋十年振盪 PDO")):
        if "values" in ind.get(k, {}):
            cands["idx:" + k] = dict(key="idx:" + k, zh=nm, product="NOAA PSL / NCEI 氣候指數", nasa=False, unit="", family="INDEX:" + k,
                                     series=on_axis(ind[k]["months"], ind[k]["values"]), cells=None, concept=None)
    res = dict(policy=POLICY, region=dict(id=rid, name=reg["name"], type=reg["type"], area_km2=reg["area_km2"]),
               catalog=dict(n_candidates=len(cands), skipped=skipped, hub_manifest=dict(created=man.get("created"), commit=man.get("teammate_commit")),
                            products=sorted({c["product"] for c in cands.values()})),
               targets=[], validation=[], tests=[])
    # --- 目標 ---
    for k in targets:
        zh, main, vals, kind = TARGETS[k]
        if main not in cands:
            res["targets"].append(dict(key=k, name=zh, layer=main, status="無資料", reason=next((s["reason"] for s in skipped if s["key"] == main), "未匯出")))
            continue
        c = cands[main]; tr = trend(c["series"], anomaly=(main == "tws"))
        res["targets"].append(dict(key=k, name=zh, layer=main, product=c["product"], unit=c["unit"], kind=kind, status="ok", note=TARGET_NOTE.get(k), **(tr or {}),
                                   series=[None if not np.isfinite(v) else round(float(v), 5) for v in c["series"]]))
        for v in vals:
            if v not in cands: continue
            ct = trend(cands[v]["series"])
            if not ct or not tr or not ct["ols"] or not tr["ols"]: continue
            ey, ex = resid_axis(c["series"]), resid_axis(cands[v]["series"]); okk = np.isfinite(ey) & np.isfinite(ex)
            agree = np.sign(tr["ols"]["slope_per_decade"]) == np.sign(ct["ols"]["slope_per_decade"])
            dep, note = dependency(c["family"], cands[v]["family"], None, None)
            res["validation"].append(dict(target=k, layer=v, name=cands[v]["zh"], product=cands[v]["product"], unit=cands[v]["unit"],
                                          period=ct["period"], slope_per_decade=ct["ols"]["slope_per_decade"], ci95=ct["ols"]["ci95"], p=ct["ols"]["p"],
                                          pct_per_decade=ct["pct_per_decade"], r_anomaly=float(np.corrcoef(ey[okk], ex[okk])[0, 1]) if okk.sum() > 24 else None,
                                          dependency=dep, dependency_note=note,
                                          verdict=E.verdict_of(tr["ols"]["p"], ct["ols"]["p"], agree),
                                          series=[None if not np.isfinite(x) else round(float(x), 5) for x in cands[v]["series"]]))
    ok_t = [t for t in res["targets"] if t.get("status") == "ok" and t.get("ols")]
    sig, adj = E.by_fdr([t["ols"]["p"] for t in ok_t], POLICY["q"])
    for t, s_, a in zip(ok_t, sig, adj): t["ols"]["p_by"] = float(a); t["significant"] = bool(s_)
    # --- 關聯 ---
    for k in targets:
        zh, main, vals, kind = TARGETS[k]
        if main not in cands: continue
        y = cands[main]; ycon = k
        for key, c in cands.items():
            if key == main: continue
            con = c["concept"]
            if con == ycon or key in vals:
                continue                       # 同概念 → 已在交叉驗證
            dep, note = dependency(y["family"], c["family"], None, None)
            if key in CONCEPT.get(ycon, set()) or (ycon == "tws" and con in ("soil", "snow")):
                dep, note = "定義依賴", "候選是目標的組成或同一個量"
            base = dict(target=k, candidate=key, candidate_zh=c["zh"], product=c["product"], nasa=c["nasa"], unit=c["unit"],
                        dependency=dep, dependency_note=note, data_caveat=CAVEAT.get(key),
                        domain=("跨領域：海洋氣候振盪" if key.startswith("idx:") else
                                "水文" if con in CONCEPT else "跨領域：大氣、能量與地表"))
            r, why = time_test(y["series"], c["series"], rng)
            res["tests"].append(dict(base, kind="time", status="已分析" if r else "不適用", reason=why, **(r or {})))
            if y["cells"] is not None and c["cells"] is not None:
                r2, why2 = space_test(y["cells"][0], c["cells"][0], np.cos(np.deg2rad(y["cells"][1])), rng)
                res["tests"].append(dict(base, kind="space", status="已分析" if r2 else "不適用", reason=why2, **(r2 or {})))
    done = [t for t in res["tests"] if t["status"] == "已分析"]
    sig, adj = E.by_fdr([t["p"] for t in done], POLICY["q"])
    for t, s_, a in zip(done, sig, adj):
        t["p_by"] = float(a); t["significant"] = bool(s_)
        indep = t["dependency"] == "獨立"     # spec 7.6：依賴來源不視為獨立證據 → 部分依賴只列出不推薦
        t["recommended"] = bool(s_ and indep and (t["kind"] == "space" or t["stable"]))
        t["why_not"] = None if t["recommended"] else ("校正後不顯著" if not s_ else
                       "部分依賴：候選與目標共用部分輸入資料（" + (t.get("dependency_note") or "") + "），不視為獨立證據" if t["dependency"] == "部分依賴" else
                       "同源模型：同一產品家族內的關係" if t["dependency"] == "同源模型" else
                       "定義依賴：候選是目標的組成或同一個量" if t["dependency"] == "定義依賴" else "前後半期不穩定")
        if t["kind"] == "time":
            t["season_note"] = ("原始連動強，調整季節後減弱：大部分來自共同季節循環，但調整後仍有異常連動" if s_ and abs(t["r_raw"]) > 0.5 and abs(t["r_anom_lag0"]) < 0.5 * abs(t["r_raw"])
                                else "調整季節循環與長期趨勢後仍有異常連動" if s_
                                else "原始資料連動，調整後證據不足：與共同季節變化的解釋一致" if abs(t["r_raw"]) > 0.5
                                else "去季節後仍相關，但去趨勢後證據不足：主要是共同長期走勢" if abs(t["r_deseason"]) > 0.3 else "證據不足")
    rec = [t for t in done if t["recommended"]]
    res["family"] = dict(size=len(done), method="Benjamini–Yekutieli FDR", q=POLICY["q"],
                         not_applicable=sum(t["status"] == "不適用" for t in res["tests"]), n_significant=int(sig.sum()),
                         n_recommended=len(rec), note="FDR 控制整個檢定家族的錯誤發現率，不是每條推薦正確的機率")
    full = not any(s["reason"].startswith("工程缺口") for s in skipped)
    res["status"] = ("已完成" if full else "部分完成：有工程缺口（見 catalog.skipped）") + ("" if rec else "；目前未找到可靠關聯")
    res["completeness"] = "候選＝隊友 hub.py 的所有層＋GLDAS 1° 未重複欄位＋氣候指數；尚未涵蓋官方 Resources 全量目錄（AppEEARS、Giovanni 其他產品）"
    res["runtime_s"] = round(time.time() - t0, 1)
    return res


if __name__ == "__main__":
    rid, tg = sys.argv[1], sys.argv[2:5]
    for k in tg: assert k in TARGETS, f"目標要是 {list(TARGETS)}"
    res = run(rid, tg)
    out = os.path.join(ROOT, "web", "public", "data", "results", re.sub(r"[^\w-]", "_", rid) + ".json")
    def clean(o):   # NaN / Inf → null，瀏覽器 JSON.parse 才讀得了
        if isinstance(o, (float, np.floating)): return None if not np.isfinite(o) else float(o)
        if isinstance(o, (np.integer,)): return int(o)
        if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)): return [clean(v) for v in o]
        return o
    json.dump(clean(res), open(out, "w"), ensure_ascii=False, allow_nan=False)
    print(json.dumps(dict(status=res["status"], family=res["family"], targets=[(t["key"], t.get("layer"), t.get("ols", {}).get("slope_per_decade") if t.get("ols") else None) for t in res["targets"]],
                          validation=[(v["target"], v["layer"], v["verdict"]) for v in res["validation"]], skipped=len(res["catalog"]["skipped"]),
                          runtime=res["runtime_s"]), ensure_ascii=False, indent=1))
