# web/public/data：給前端的資料說明（v3，`data-2026-11-15`）

全部是靜態 JSON，用 `fetch()` 讀取，不需要後端或 NASA 帳號；`next build`（`output: "export"`）時會一起打包，部署在任何靜態主機都能用。
數值缺值一律是 `null`，畫圖時要斷開，**不要當成 0**。

## 檔案

| 檔案 | 內容 |
|---|---|
| `catalog/manifest.json` | 資料發布 manifest：`dataset_version`、目錄／區域版本、每層狀態（`ready / pending / invalid`）、品質政策 |
| `catalog/variables.json` | 類別 → 預設資料層（`category_default_layer`），以及每層的名稱、單位、產品、期間、來源、caveat |
| `catalog/series_index.json` | 每個區域有哪些資料層 |
| `catalog/regions.json`、`catalog/countries.json` | 區域名稱、面積；國家搜尋 |
| `series/<區域 id>.json` | 各區域的月序列（series-2 格式，見下） |
| `gen/` | 地球圖層（`npm run prep` 產生，前端地球用） |

舊版的 `geo/`、`trends/`、`results/`、`indices.json`（舊 Aqua Trend 引擎的輸出）沒有還原：新規格的分析在瀏覽器內完成，程式也沒有引用它們。需要時可從 commit `37b5590` 取回。

## series/<區域 id>.json（version: series-2）

```json
{"id": "b4-5040591050", "version": "series-2",
 "layers": {"aod":        {"start": "1980-01", "values": [0.092, 0.111, ...]},
            "fire_count": {"start": "2000-11", "values": [134.0, 58.0, ...]}}}
```

- 每一層有自己的 `start`；`values[i]` 是 `start` 之後第 i 個月的值，所以不同層長度不同。
- 1,706 個檔：`basin3`（268）、`basin4`（1,313）、`ice`、`lme`、`sea`、`named`。`hex` 沒有序列檔。
- 區域平均：0.5° 格網、cos(緯度) 面積加權；區域內有效面積 < 30% 的月份是 `null`。
- 先查 `catalog/series_index.json` 確認該區有哪些層。

## 資料層（34 層，17 類）

| 類別 | 資料層 | 期間 |
|---|---|---|
| 降水 `precip` | `p_imerg`（GPM IMERG，預設）、`p_gpcp`（GPCP，NOAA）、`p_m2`、`p_m2land`（MERRA-2） | IMERG 1998–2025-09；MERRA-2 1980– |
| 蒸散 `et` | `et_m2`（預設）、`et_m2land`（MERRA-2）、`et_gldas`（GLDAS） | MERRA-2 1980–；GLDAS 2000– |
| 土壤水 `soil` | `sm_root`（預設）、`sm_total`、`g1_soil_top`（GLDAS）、`sm_m2`（MERRA-2，0–1） | |
| 總儲水 `tws` | `tws`（GRACE/GRACE-FO 距平） | 2002-04– |
| 逕流 `runoff` | `runoff`（GLDAS，預設）、`ro_m2`（MERRA-2） | |
| 積雪 `snow` | `swe`（GLDAS，預設）、`snow_cover`（MODIS MOD10CM 覆蓋率 %） | |
| 溫度 `tair` | `tair`（GLDAS，預設）、`tsurf_m2`（MERRA-2）、`lst_day`、`lst_night`（MODIS） | |
| 蒸散需求 `vpd` | `vpd`（預設）、`pet_gldas` | |
| 能量 `energy` | `rn`（GLDAS，預設）、`rn_m2`（MERRA-2）、`rn_ceres`（CERES 衛星）、`swdown` | |
| 風 `wind` | `wind` | |
| 植被 `ndvi` | `ndvi`（MODIS） | |
| 海溫 `sst` | `sst`（NOAA OISST，只有海洋區域） | |
| **氣膠 `aod`**（新） | `aod`（MERRA-2 TOTEXTTAU） | 1980– |
| **野火 `fire`**（新） | `fire_count`（MODIS FIRMS Terra 植被火熱點數／月） | 2000-11–2025 |
| **SO₂ `so2`**（新） | `so2_emis`（點源**年**排放 kt/yr，值重複 12 個月，不是濃度） | 2005–2025 |
| **臭氧 `ozone`**（新） | `to3_m2`（MERRA-2 臭氧柱總量 DU） | 1980– |
| **水氣 `vapor`**（新） | `tqv`（MERRA-2 大氣可降水量 mm） | 1980– |

各層精確期間、單位、caveat 以 `variables.json` 為準。`caveat` 不是 `null` 時，畫面上要顯示。MERRA-2 陸面層（`p_m2land`、`et_m2land`、`sm_m2`、`ro_m2`、`rn_m2`、`tsurf_m2`）在本版從 2000 延長到 1980。

## 資料放在哪裡

| 層級 | 位置 | 誰需要 |
|---|---|---|
| 前端資料（本資料夾） | git，隨網站部署 | 所有人；clone 後 `npm run dev` 即可 |
| 每層區域序列中間檔（`data/interim/layers/*.npz`） | GitHub Release `data-2026-11-15` 的附件 | 想改合併邏輯、重產 JSON 的人（`pipeline/merge_series.py`） |
| 原始 NASA 檔（約 20 GB） | 團隊分享站 http://meow1.csie.ntu.edu.tw:3266/（`data/share/` 同名資料夾），或用自己的 Earthdata token 跑 `pipeline/fetch_earthdata.py` 重抓 | 重跑整條管線的人 |

## 重現

見 [`pipeline/README.md`](../../../pipeline/README.md)。來源與處理紀錄見 [`docs/DATA_SHARE.md`](../../../docs/DATA_SHARE.md)。
