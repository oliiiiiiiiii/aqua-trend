# 團隊資料分享站（暫時）

> **http://meow1.csie.ntu.edu.tw:3266/**：Python `http.server` 的目錄清單，沒有帳密，暫時使用。
> 清單盤點日期：2026-11-15。只盤點了檔名，還沒有人逐一打開檔案驗證。

## 給 agent 的使用規則

1. **先讀本文件，再去讀分享站**。要看最新清單時，直接抓目錄頁（HTML `<a href>` 清單），例如 `curl -s http://meow1.csie.ntu.edu.tw:3266/grace/`。
2. 下載的檔案放 `data/share/<資料夾>/`（已被 `.gitignore` 忽略的位置，或自行加進 `.gitignore`）。**原始檔不可 commit**。
3. 大檔先看大小（`curl -sI` 的 `Content-Length`）。例如 `oisst/sst.mon.mean.nc` 約 2.2 GB，只在真的需要時才下載。
4. 用 Python 讀取時，用 `python -I`，並把下載目錄與腳本目錄分開。
5. 前端只吃處理過的 `web/public/data/series/*.json`（series-2 格式，見 `web/public/data/README.md`）。分享站是**產生這些 JSON 的原始資料來源**，前端不能直接連到分享站。
6. 發現清單和本文件不一致時，更新本文件。

## 盤點結果

### 有檔案，可以直接用

| 資料夾 | 內容 | 格式 | 時間 | 和子流域（basin4）的關係 |
| --- | --- | --- | --- | --- |
| `grace/` | GRACE/GRACE-FO JPL mascon 陸地總儲水 | 1 個 `.nc`（46 MB） | 2002-04 – 2026-09，月 | 可用遮罩平均 → `tws` |
| `gpcp/` | GPCP 月降水 | 1 個 `.nc`（20 MB） | 1979 –，月 | 可用遮罩平均 → `p_gpcp` |
| `oisst/` | NOAA OISST 海表溫度 | 1 個 `.nc`（**2.2 GB**） | 1982 –，月 | 只有海洋，子流域通常沒有 |
| `so2/` | OMI SO₂ L4（MSAQSO2L4） | 1 個 `.nc`（1.8 MB） | 2005 – 2025 | **新變數**，可用遮罩平均（火山、污染事件） |
| `firms/` | MODIS FIRMS 野火熱點，各國 | 26 個 `.zip`，每年一個 | 2000 – 2025 | **新變數**：點資料 → 每月每子流域火點數。適合澳洲野火預設事件 |
| `mod10cm/` | MODIS MOD10CM 月積雪覆蓋率 | 315 個 `.hdf` | 2000-03 – 2026-10，月 | **新變數**，可用遮罩平均 |
| `hydrobasins/` | HydroBASINS lev03、lev04 shapefile（`unz/` 是解壓後的檔案） | `.zip`、`.shp` | — | basin3／basin4 邊界的來源 |
| `nasassh/` | NASA-SSH 網格海面高度 | 1,776 個 `.nc`（每 7 天一個） | 1992-10 – 2026-11 | 海洋，不適用子流域 |
| `nsidc/`、`nsidc_tif/` | NSIDC 海冰範圍（csv）與濃度（tif） | 24 個 `.csv`、222 個 `.tif` | 1979 –，月 | 極區，不適用子流域 |
| `mls/`、`mls_t/`、`mls_o3/` | Aura MLS 平流層水氣、溫度、臭氧（緯向平均） | 每年一個 `.nc`／`.npz` | 2004 – 2025 | 緯度 × 氣壓層，不適用子流域 |
| `ozone/` | 南極臭氧洞面積與最低值 | 96 個 `.txt` | 1979 – 2026 | 全球單一序列 |
| `noaa_gml/` | 全球 CH₄ | 3 個 `.txt` | — | 全球單一序列 |
| `nasassh_gmsl/` | 全球平均海平面 | 1 個 `.txt` | — | 全球單一序列 |
| `indices/` | Niño 3.4、PDO、DMI 氣候指數 | 3 個文字檔 | — | 全球單一序列；可用來標註聖嬰年 |
| `eq/` | 地震目錄：GCMT、USGS（全球 M4.5+、台灣 M3+、日本 M4+、美國加州與中部 M2.5+） | `.ndk`、`.csv` | 1973 – 2026 | 點資料，和水文無直接關係 |
| `eop/` | 地球自轉參數 | 2 個 `.txt` | 1962 – | 全球序列 |
| `gwm/` | 湖泊／水庫水位指數（10 天一筆） | `.json`、`.xlsx`、`.gz` | — | 點資料（湖泊），需要對應到子流域 |
| `psmsl/` | PSMSL 潮位站月資料 | `.zip` | — | 點資料（海岸） |
| `aeronet/` | AERONET 站點位置清單 | 1 個 `.txt` | — | 只有站點清單，沒有觀測值 |

### 資料夾存在，但目前是空的

| 資料夾 | 應該是什麼 | 影響 |
| --- | --- | --- |
| `gesdisc/gldas/` | GLDAS（蒸散、土壤水、逕流、積雪、氣溫…） | MVP 的主要變數都在這裡 |
| `gesdisc/imerg/` | GPM IMERG 降水 | 預設降水層 `p_imerg` |
| `gesdisc/m2aer/` | MERRA-2 氣膠（**含 AOD**） | 補上後，野火事件可以看 AOD |
| `gesdisc/m2flx/`、`m2int/`、`m2lnd/` | MERRA-2 通量、垂直積分、陸面 | `et_m2`、`p_m2`、`sm_m2` 等 |
| `modis/lst/`、`modis/ndvi/` | MODIS 地表溫度、植被指數 | `lst_day`、`ndvi` |
| `ceres/` | CERES 輻射 | 能量類別 |
| `oaflux/` | OAFlux 海面通量 | 海洋，不適用子流域 |
| `obdaac/chl/` | 海洋葉綠素 | 海洋，不適用子流域 |

**團隊正在補這些資料，可能在你工作期間陸續出現。** 每次開始處理前重新抓清單，自己判斷哪些可以處理了。

還沒補上時，**繼續使用 repo 裡已經算好的 `web/public/data/series/*.json`**，它們已經包含 GLDAS、IMERG、MERRA-2、MODIS 的子流域序列（2026-11-14 產生）；或試 Giovanni（下一節）。

## Giovanni（NASA 線上對齊工具）

[Giovanni](https://giovanni.gsfc.nasa.gov/) 是 NASA GES DISC 的線上分析工具，可以對指定範圍產生「區域平均時間序列」，並處理不同產品的格網對齊。它涵蓋的產品大多正好是上面空著的資料夾：GLDAS、IMERG、MERRA-2（含 AOD）、MODIS、OMI 等。

- **用途**：分享站沒有的資料，或要快速取得某個子流域的月序列時使用。
- **限制，需要實測確認**：需要 Earthdata 帳號；區域通常用經緯度框或內建形狀，不一定能直接用 HydroBASINS 多邊形；大量子流域逐一查詢可能很慢。
- **建議做法**：先只對三個預設事件的子流域試，用經緯度框或上傳形狀，比對結果和現有 series-2 的差異。可行再擴大範圍。
- **試不通就算了**：繼續用現有 series-2 和分享站，把原因寫在下方「處理紀錄」。
- Earthdata 帳密不可 commit，用 `~/.netrc` 或環境變數。

## 處理紀錄

| 日期 | 資料層 | 來源 | 期間 | 子流域數 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 2026-11-14 | 現有 26 層 | GES DISC 等（舊管線） | 各層不同 | basin4 1,313 | 見 `web/public/data/README.md` |

## 和現有 series-2 的關係

- 現有 26 個資料層（`web/public/data/catalog/variables.json`）原本就是從同一批 NASA 產品算出來的。分享站上有的產品（GRACE、GPCP、OISST）不需要重算，除非要更新期間。
- 分享站**新增**、適合子流域的變數：`so2`、`fire_count`（FIRMS）、`snow_cover`（MOD10CM）；等 `m2aer` 有檔案後再加 `aod`。加進來時要：
  1. 用 `data/masks/regions_0p5.npz`（或 HydroBASINS lev04 多邊形）算每個 basin4 的月序列，寫進 `series/<id>.json` 的 `layers`。
  2. 在 `variables.json` 新增資料層，在 `contracts.ts` 的 `CategoryId` 新增類別（PR 標 `[contract change]`）。
  3. 更新 `catalog/series_index.json`。
- 不適用子流域的資料（指數、CH₄、GMSL、臭氧洞、MLS、海冰、海洋網格）MVP 不用。以後要用的話，可以考慮用 Giovanni 對齊到同一區域；試不通就放棄。
