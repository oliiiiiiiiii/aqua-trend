# web/public/data：給前端的資料說明（v2）

全部是靜態 JSON / GeoJSON，用 `fetch()` 讀取，不需要後端或 NASA 帳號。
資料日期 2026-11-14；產生方式見最後一節。數值缺值一律是 `null`，畫圖時要斷開，**不要當成 0**。

## 使用者流程 → 要讀哪個檔

| 使用者動作 | 讀的檔案 |
|---|---|
| 地球上畫區域邊界 | `geo/<圖層>.geojson`（`basin3`、`basin4`、`ice`、`lme`、`sea`、`named`、`hex`） |
| 點到區域：名稱、面積、可選類別、警告 | `catalog/regions.json`（用 `id` 對照） |
| 搜尋國家 | `catalog/countries.json` |
| 選類別後，決定要畫哪個資料層 | `catalog/variables.json` 的 `category_default_layer` 與 `layers` |
| 畫時間序列 | `series/<區域 id>.json`；先查 `catalog/series_index.json` 確認該區有哪些層 |
| 地圖依趨勢上色 | `trends/<資料層>.json` |
| Demo 區域的研究線索與證據 | `results/index.json` → `results/<區域 id>.json` |
| 氣候指數曲線 | `indices.json` |

## catalog/variables.json

```json
{"category_default_layer": {"precip": "p_imerg", "et": "et_m2", "soil": "sm_root", "tws": "tws", ...},
 "layers": {"p_imerg": {"name": "降水", "category": "precip", "product": "GPM IMERG 月資料", "nasa": true,
                        "family": "IMERG", "unit": "mm/day", "start": "1998-01", "end": "2025-09",
                        "visual": "向下雨滴粒子的密度", "caveat": null}, ...}}
```

共 26 層。前端選了 17 類之中的某一類之後，預設畫 `category_default_layer` 指定的那一層；同類的其他層可以讓使用者切換，或在證據區疊圖比較。`caveat` 不是 `null` 時，畫面上要顯示。

| 類別 | 資料層（產品） |
|---|---|
| 總儲水 | `tws`（GRACE/GRACE-FO 距平，cm） |
| 降水 | `p_imerg`（GPM IMERG）、`p_gpcp`（GPCP，NOAA 發布）、`p_m2`、`p_m2land`（MERRA-2） |
| 蒸散 | `et_m2`、`et_m2land`（MERRA-2）、`et_gldas`（GLDAS） |
| 土壤水 | `sm_root`、`sm_total`（GLDAS，mm）、`sm_m2`（MERRA-2，0–1）、`g1_soil_top`（GLDAS 1°，0–10 cm） |
| 逕流 | `runoff`（GLDAS）、`ro_m2`（MERRA-2） |
| 積雪 | `swe`（GLDAS） |
| 溫度 | `tair`（GLDAS 氣溫）、`tsurf_m2`（MERRA-2 地表溫度）、`lst_day`（MODIS 白天地表溫度） |
| 蒸散需求 | `vpd`、`pet_gldas`（GLDAS） |
| 能量 | `rn`、`swdown`（GLDAS）、`rn_m2`（MERRA-2） |
| 風 | `wind`（GLDAS） |
| 植被 | `ndvi`（MODIS） |
| 海溫 | `sst`（NOAA OISST） |

## series/<區域 id>.json（version: series-2）

```json
{"id": "b3-6030026140", "version": "series-2",
 "layers": {"p_imerg": {"start": "1998-01", "values": [1.02, 0.31, ...]},
            "tws":     {"start": "2002-04", "values": [..., null, ...]}}}
```

- 每一層有自己的 `start`。`values[i]` 是 `start` 之後第 i 個月的值，所以不同層的長度不一樣。
- GRACE（`tws`）在 2017-07 到 2018-05 之間有衛星交接空窗，早期也有零星缺月，都是 `null`。
- 共 1,706 個檔：`basin3`、`basin4`、`ice`、`lme`、`sea`、`named` 都有。**`hex` 沒有序列檔**，只有趨勢；使用者選到 hex 時，建議提示改選所在的流域。
- 只放區域內有效覆蓋 ≥ 30% 的層。海溫只放海洋區域。
- 單位見 `variables.json`。溫度已經換成 °C。

## trends/<資料層>.json

```json
{"layer": "p_imerg", "unit": "mm/day", "period": "1998–2024",
 "fields": ["slope_per_decade","ci95_lo","ci95_hi","p","p_by","mk_p","sen_per_decade","mean","n_eff","coverage"],
 "regions": {"named-taiwan-main-island": [-0.7726, -1.3078, -0.2375, 0.00479, 0.0408, 0.00352, -1.0014, 5.658, 324.0, 1.0], ...}}
```

- 斜率是去季節月距平的 OLS，單位是「該層單位 / 十年」。95% CI 已用 AR(1) 有效樣本數 `n_eff` 修正。
- 每一層只用自己的完整年份（`period`）。GRACE 從 2003 年起算。
- `p_by` 是同一區域所有層一起做 Benjamini–Yekutieli 校正後的 p 值，顯著標記請用 `p_by < 0.05`。`mk_p`、`sen_per_decade` 是年平均的 Mann-Kendall 與 Sen 斜率，當作第二種檢定一起顯示。
- 百分比：`slope / |mean| × 100`。但 `tws` 是距平、溫度的平均可能接近 0，這兩類**不要**顯示百分比。
- 所有區域（含 hex）都有。

## results/（Demo 區域的研究結果，engine-0.3）

`results/index.json` 每個區域有：

- `targets`：水文目標的產品、期間、每十年變化、`p_by`；
- `validation`：同一概念換成其他產品的交叉驗證判定；
- `top_cross_domain`：前 6 條跨領域線索；`top_hydrology`：前 4 條水文線索；
- `products`：本次用到的產品清單。

`results/<區域 id>.json` 是完整結果，欄位依總 spec 7.7：

| 區塊 | 內容 |
|---|---|
| `status`、`completeness` | 完成狀態；目前候選＝hub 全部層＋GLDAS 1° 未重複欄位＋氣候指數，尚未涵蓋官方 Resources 全量目錄 |
| `catalog.skipped` | 沒有進入分析的候選與原因：重複映射、不適用或工程缺口 |
| `targets[]` | `layer`、`product`、`period`、`ols`（斜率、CI、p、`p_by`、`n_eff`）、`mk`、`missing_months`、`note`、`data_caveat`、`series`（1979-01 起的主時間軸） |
| `validation[]` | 同概念的其他產品：趨勢、`r_anomaly`、`verdict`、`dependency`、`series` |
| `tests[]`（共通） | `kind`（`time` 或 `space`）、`candidate`、`product`、`dependency`、`dependency_note`、`domain`、`data_caveat`、`p`、`p_by`、`significant`、`recommended`、`why_not` |
| `tests[]`（時間） | `period`、`n`、`missing_frac`、`lags`、`r_lag`（完整延遲曲線）、`best_lag`、`lag_support`、`edge_peak`、`halves`、`season_note`、`r_raw`、`r_deseason`、`r_anom_lag0` |
| `tests[]`（空間） | `period`、`n_cells`、`r`、`beta_target`、`beta_candidate`（每個 0.5° 格點的趨勢，可畫散佈圖） |
| `family` | 檢定家族大小、校正方法、顯著數、推薦數 |

- **延遲方向**：`r(ℓ) = corr(水文(t), 候選(t − ℓ))`。`best_lag > 0` 是候選先變，`< 0` 是水文先變，單位是月。`edge_peak: true` 表示最強延遲落在 ±6 月的邊界，實際延遲可能更長。
- **`dependency`**：
  - `獨立`：唯一會被推薦的類別。
  - `部分依賴`：例如 GLDAS 的降水驅動和 IMERG 共用測站資料，顯著也不推薦。
  - `同源模型`：同一產品家族內的關係。
  - `定義依賴`：候選是目標的組成，或根本是同一個量。
- **`domain`**：「跨領域」是其他東西怎麼影響水，「水文」是水循環內部的關係。畫面上請分兩區顯示。
- **推薦條件**：`dependency = 獨立`、BY 校正後顯著、前後半期同號且 |r| ≥ 0.1。先後順序只是統計線索，不代表因果。

## 資料來源

| 資料 | 機構 | 備註 |
|---|---|---|
| GRACE/GRACE-FO JPL mascon | NASA JPL | 距平；有效解析度約 300 km |
| GPM IMERG 月資料 | NASA GES DISC | |
| MERRA-2（M2TMNXFLX、M2TMNXLND） | NASA GMAO / GES DISC | 再分析模型 |
| GLDAS Noah 2.1（0.25° 與 1°） | NASA GES DISC | 陸面模型；蒸散趨勢有已知漂移 |
| MODIS NDVI、LST | NASA LP DAAC | LST 在 2020 年後有 Terra 軌道漂移 |
| GPCP v2.3、OISST、Niño3.4／DMI／PDO | NOAA（非 NASA） | 要標明機構 |
| HydroBASINS、Marine Regions、IPCC AR6 分區、H3、Natural Earth | 各上游 | 區域邊界，見根目錄 README 第 15 節 |

這些產品都是隊友 `hub.py` 先整理成 0.5° 月網格，再用 `analysis/hub_export.py` 平均到各區域。

## 重現

```bash
# 在有隊友資料的機器上（例如 meow1）
AQUA_ROOT=<隊友 repo>/analysis python hub_export.py regions_0p5.npz ~/aqua_hub_export   # → 複製到 data/hub_export
python3 analysis/export_web2.py                                                         # catalog / trends / series
python3 analysis/engine3.py <區域 id> <目標…>     # 目標：precip tws et soil runoff snow
python3 analysis/build_results_index.py
```
