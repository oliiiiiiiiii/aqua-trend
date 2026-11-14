#!/usr/bin/env python3
"""
在「隊友資料所在的機器」上跑：用他的 hub.py 載入每一層 0.5° 月資料，
彙整成 aqua-trend 每個區域（7,641 個）的面積加權月序列，輸出小檔案帶回 Mac。

用法：
  AQUA_ROOT=/path/to/analysis python3 hub_export.py regions_0p5.npz [輸出資料夾]
  （AQUA_ROOT 是隊友 repo 裡的 analysis/ 資料夾，裡面有 scripts/hub.py 與 data/）
輸出：<輸出資料夾>/<layer>.npz（series[R, T] float32、coverage[R]、times、units…）
      <輸出資料夾>/cells_<區域>.npz（Demo 區域的格點級序列，給空間分析用）
      <輸出資料夾>/manifest.json（每層的來源、期間、單位、失敗原因）
只讀不寫隊友的資料；不需要 scipy。
"""
import glob, json, os, subprocess, sys, time, traceback
import numpy as np

AQ = os.environ.get("AQUA_ROOT")
if not AQ or not os.path.exists(os.path.join(AQ, "scripts", "hub.py")):
    sys.exit("請設定 AQUA_ROOT=隊友 repo 的 analysis/ 資料夾（裡面要有 scripts/hub.py）")
sys.path.insert(0, os.path.join(AQ, "scripts"))
import hub  # noqa: E402

MASK = sys.argv[1] if len(sys.argv) > 1 else "regions_0p5.npz"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/aqua_hub_export")
os.makedirs(OUT, exist_ok=True)

# 層名：(說明, 產品, 是否 NASA)
LAYERS = {
    "tws":       ("陸地總儲水異常", "GRACE/GRACE-FO JPL mascon", True),
    "p_imerg":   ("降水", "GPM IMERG 月資料", True),
    "p_gpcp":    ("降水", "GPCP v2.3（NOAA PSL 發布）", False),
    "p_m2":      ("降水（校正）", "MERRA-2 M2TMNXFLX PRECTOTCORR", True),
    "p_m2land":  ("陸地降水", "MERRA-2 M2TMNXLND PRECTOTLAND", True),
    "et_m2":     ("蒸發", "MERRA-2 M2TMNXFLX EVAP", True),
    "et_m2land": ("陸地蒸發", "MERRA-2 M2TMNXLND EVLAND", True),
    "sm_m2":     ("根層土壤濕度（0–1）", "MERRA-2 M2TMNXLND GWETROOT", True),
    "ro_m2":     ("逕流", "MERRA-2 M2TMNXLND RUNOFF+BASEFLOW", True),
    "rn_m2":     ("淨輻射", "MERRA-2 M2TMNXLND SWLAND+LWLAND", True),
    "tsurf_m2":  ("地表溫度", "MERRA-2 M2TMNXLND TSURF", True),
    "et_gldas":  ("蒸散", "GLDAS Noah 2.1 0.25°→0.5°", True),
    "pet_gldas": ("潛在蒸散", "GLDAS Noah 2.1", True),
    "sm_root":   ("根層土壤水", "GLDAS Noah 2.1", True),
    "sm_total":  ("0–2 m 土壤水", "GLDAS Noah 2.1", True),
    "runoff":    ("逕流", "GLDAS Noah 2.1", True),
    "swe":       ("積雪水當量", "GLDAS Noah 2.1", True),
    "tair":      ("近地面氣溫", "GLDAS Noah 2.1 forcing", True),
    "vpd":       ("飽和水氣壓差", "GLDAS Noah 2.1 forcing（計算）", True),
    "rn":        ("淨輻射", "GLDAS Noah 2.1", True),
    "swdown":    ("向下短波", "GLDAS Noah 2.1 forcing", True),
    "wind":      ("風速", "GLDAS Noah 2.1 forcing", True),
    "ndvi":      ("植被指數 NDVI", "MODIS（0.05°→0.5°）", True),
    "lst_day":   ("白天地表溫度", "MODIS Terra LST（2020 後軌道漂移）", True),
    "sst":       ("海表溫度", "NOAA OISST v2.1", False),
}
ONLY = os.environ.get("ONLY")  # 例如 ONLY=tws,p_imerg 只跑部分層
DEMO = ["b3-6030026140", "named-taiwan-main-island", "b3-1030011660", "b3-4030031750", "b3-5030073410", "b3-7030008710"]

# ---------- 區域權重（不需要 scipy） ----------
m = np.load(MASK)
lat = m["lat"]; assert lat.size == 360 and abs(lat[0] + 89.75) < 1e-6, "遮罩格網要和 hub 一樣（0.5°，-89.75 起）"
w = np.repeat(np.cos(np.deg2rad(lat))[:, None], 720, 1).ravel().astype(np.float64)
ids, parts = [], []          # parts: (layer index array 或 named bool) 依序對應區域
for t in ("basin3", "basin4", "ice", "lme", "sea", "hex"):
    a = m[t].ravel(); tid = [str(x) for x in m[f"{t}_ids"]]
    parts.append(("flat", len(ids), a, len(tid))); ids += tid
named = m["named"].reshape(m["named"].shape[0], -1); nid = [str(x) for x in m["named_ids"]]
parts.append(("named", len(ids), named, len(nid))); ids += nid
R = len(ids); idpos = {k: i for i, k in enumerate(ids)}
total_w = np.zeros(R)
for kind, off, a, n in parts:
    if kind == "flat":
        ok = a >= 0; total_w[off:off + n] = np.bincount(a[ok], weights=w[ok], minlength=n)
    else:
        total_w[off:off + n] = a.astype(float) @ w


def regional(x2d):          # x2d: (T, 259200) → (R, T)
    T = x2d.shape[0]; out = np.full((R, T), np.nan, np.float32); cov = np.zeros((R, T), np.float32)
    for ti in range(T):
        x = x2d[ti]; ok = np.isfinite(x); xv = np.where(ok, x, 0.0) * w; wv = ok * w
        for kind, off, a, n in parts:
            if kind == "flat":
                sel = a >= 0
                num = np.bincount(a[sel], weights=xv[sel], minlength=n); den = np.bincount(a[sel], weights=wv[sel], minlength=n)
            else:
                af = a.astype(float); num = af @ xv; den = af @ wv
            with np.errstate(invalid="ignore", divide="ignore"):
                out[off:off + n, ti] = np.where(den > 0, num / den, np.nan)
            cov[off:off + n, ti] = np.where(total_w[off:off + n] > 0, den / np.maximum(total_w[off:off + n], 1e-12), 0)
    return out, cov


manifest = dict(created=time.strftime("%Y-%m-%d %H:%M"), aqua_root=AQ, mask=os.path.abspath(MASK), regions=R, layers={})
try:
    manifest["teammate_commit"] = subprocess.run(["git", "-C", AQ, "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
except Exception:
    pass
np.save(os.path.join(OUT, "region_ids.npy"), np.array(ids))

for name, (zh, prod, nasa) in LAYERS.items():
    if ONLY and name not in ONLY.split(","):
        continue
    f = os.path.join(OUT, f"{name}.npz")
    if os.path.exists(f):
        print(f"略過 {name}（已存在）"); manifest["layers"][name] = json.load(open(f + ".json")); continue
    t0 = time.time()
    try:
        da = hub.load(name)
        times = [str(x)[:7] for x in da.time.values]
        A = np.asarray(da.values, np.float32).reshape(len(times), -1)
        ser, cov = regional(A)
        # Demo 區域的格點級序列（空間分析用）
        cells = {}
        for rid in DEMO:
            i = idpos[rid]
            for kind, off, a, n in parts:
                if off <= i < off + n:
                    sel = (a == i - off) if kind == "flat" else a[i - off]
            cells[rid.replace("-", "_")] = np.nonzero(sel)[0]
        np.savez_compressed(f, series=ser, coverage=cov.mean(1).astype(np.float32), times=np.array(times),
                            **{f"cells__{k}": A[:, v] for k, v in cells.items()}, **{f"cellidx__{k}": v for k, v in cells.items()})
        info = dict(name=zh, product=prod, nasa=nasa, units=da.attrs.get("units", ""), start=times[0], end=times[-1],
                    n_months=len(times), seconds=round(time.time() - t0, 1), status="ok")
        del da, A
    except Exception as e:  # noqa: BLE001
        info = dict(name=zh, product=prod, nasa=nasa, status="failed", error=f"{type(e).__name__}: {e}",
                    trace=traceback.format_exc()[-600:])
    if info["status"] == "ok":
        json.dump(info, open(f + ".json", "w"), ensure_ascii=False)
    manifest["layers"][name] = info
    print(f"{name:10s} {info['status']:6s} {info.get('start','')}~{info.get('end','')} {info.get('error','')}", flush=True)

ind = {}
for k in ("nino34", "dmi", "pdo"):
    try:
        s = hub.index(k); ind[k] = dict(months=[str(x)[:7] for x in s.index], values=[float(v) for v in s.values])
    except Exception as e:  # noqa: BLE001
        ind[k] = dict(error=str(e))
json.dump(ind, open(os.path.join(OUT, "indices.json"), "w"))
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), ensure_ascii=False, indent=1)
print("完成 →", OUT, "；共", sum(os.path.getsize(x) for x in glob.glob(os.path.join(OUT, "*"))) // 1_000_000, "MB")
