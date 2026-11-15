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
| `so2/` | MSAQSO2L4 v2 多衛星 SO₂ **點源年排放目錄**（780 個污染源／火山，kt/yr） | 1 個 `.nc`（1.8 MB） | 2005 – 2025，**年** | 不是網格：依點位加總成每區年排放 → `so2_emis`（年值重複 12 個月） |
| `firms/` | MODIS FIRMS 野火熱點，各國 | 26 個 `.zip`，每年一個 | 2000 – 2025 | **新變數**：點資料 → 每月每子流域火點數。適合澳洲野火預設事件 |
| `mod10cm/` | MODIS MOD10CM 月積雪覆蓋率 | 315 個 `.hdf` | 2000-03 – 2026-10，月；缺 2000-08、2001-06、2002-03、2003-12、2016-02、2022-10；A2001182／A2001184 重複（同為 2001-07） | 已處理 → `snow_cover` |
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

### 實測結果（2026-11-15，工作線 F）

**Giovanni 可用，但管線改用直接下載。** 測試請求（GLDAS Noah 2.1 `Evap_tavg`，台灣經緯度框 120–122E、21.9–25.3N，2020 全年）約 1 分鐘回傳 CSV：

```
https://harmony.earthdata.nasa.gov/<collection concept id>/ogc-api-coverages/1.0.0/collections/parameter_vars/coverage/rangeset
  ?variable=<ShortName>_<版本點換底線>_<變數>     # 例：GLDAS_NOAH025_M_2_1_Evap_tavg
  &subset=lat(21.9:25.3)&subset=lon(120:122)&subset=time("2020-01-01T00:00:00Z":"2020-12-31T23:59:59Z")
  &format=text/csv&average=area
```

- 回傳的是非同步 job（JSON）；輪詢 `https://harmony.earthdata.nasa.gov/jobs/<jobID>`，完成後 `links[rel=data]` 是 CSV。
- 限制：只接受**經緯度框**，不能用 HydroBASINS 多邊形；1,313 個 basin4 要逐一送 job，而且每個框會混入框內的其他流域。MERRA-2 在 Harmony 上沒有 Giovanni 區域平均服務。
- 因此管線改成**直接下載全球格網，再用我們自己的遮罩（`data/masks/regions_0p5.npz`）平均**：區域定義和既有 series-2 完全一致，一次處理全部區域。Giovanni 只建議拿來對單一區域做交叉檢查。

### 直接下載（`pipeline/fetch_earthdata.py`）

- 認證：Earthdata Login **token**（Bearer），從 `$EDL_TOKEN` 或 repo 根目錄的 `.edl.token`（已 gitignore）讀取，不用帳號密碼、不用 `~/.netrc`。token 在 https://urs.earthdata.nasa.gov/ → Generate Token 產生，有效 60 天；GES DISC、LP DAAC 要先在帳號內核准 EULA／application。
- 下載位置 `data/share/<資料夾>/`，和分享站同樣的資料夾名稱，方便之後上傳到分享站。每個資料夾有 `_manifest.json`（產品、版本、變數、期間、下載時間、錯誤）。
- 可重跑：已完成的檔案會跳過。`python3 -I pipeline/fetch_earthdata.py --list` 列出所有產品。
- 為了節省空間（全量約 255 GB），只取需要的變數：

| 資料夾 | 產品 | 方式 | 內容 |
| --- | --- | --- | --- |
| `gesdisc/gldas/` | GLDAS_NOAH025_M 2.1 | 原檔 | 2000-01 起，全部變數 |
| `gesdisc/gldas_1deg/` | GLDAS_NOAH10_M 2.1 | 原檔 | 2000-01 起 |
| `gesdisc/imerg/` | GPM_3IMERGM V07 | OPeNDAP 子集 | 只有 `precipitation`（mm/hr），1998-01 起 |
| `gesdisc/m2aer/` | M2TMNXAER | OPeNDAP 子集 | TOTEXTTAU、TOTANGSTR、DUEXTTAU、BCEXTTAU、OCEXTTAU，1980 起 |
| `gesdisc/m2flx/` | M2TMNXFLX | OPeNDAP 子集 | PRECTOTCORR、PRECTOT、EVAP |
| `gesdisc/m2int/` | M2TMNXINT | OPeNDAP 子集 | UFLXQV、VFLXQV（水氣通量） |
| `gesdisc/m2lnd/` | M2TMNXLND | OPeNDAP 子集 | PRECTOTLAND、EVLAND、GWET*、RUNOFF、BASEFLOW、SWLAND、LWLAND、TSURF、SNOMAS、TWLAND |
| `gesdisc/m2slv/` | M2TMNXSLV | OPeNDAP 子集 | TO3（臭氧柱）、TQV（可降水量）、T2M |
| `modis/ndvi/` | MOD13C2 061 | 下載 HDF → 只留 NDVI | 0.05° 以 5×5 平均成 0.25°，附有效像素比例 |
| `modis/lst/` | MOD11C3 061 | 下載 HDF → 只留 LST 日／夜 | 同上，單位 K |
| `ceres/` | CERES EBAF Ed4.2.1 | 原檔（單一 nc） | 2000-03 起 |

- 不下載：OMI OMTO3d（臭氧、UV 氣膠指數；日資料 8,000 多個檔，2026-11-15 決定先不做，臭氧改用 MERRA-2 TO3）。
- 還沒下載：`obdaac/chl/`（MODIS-Aqua 葉綠素 9 km 月資料，約 4.5 GB，海洋，MVP 不用；`fetch_earthdata.py chl` 可下載）、`oaflux/`（WHOI，非 NASA，不需帳號）。
- OPeNDAP 子集網址格式：`https://opendap.earthdata.nasa.gov/collections/<collection id>/granules/<GranuleUR，冒號要編碼>.dap.nc4?dap4.ce=/VAR1;/VAR2;/lat;/lon;/time`，回傳壓縮的 netCDF-4。
- 讀 HDF4／netCDF 時不要多執行緒平行（會 segfault）；下載可以平行。

## 處理紀錄

| 日期 | 資料層 | 來源 | 期間 | 子流域數 | 備註 |
| --- | --- | --- | --- | --- | --- |
| 2026-11-14 | 現有 26 層 | GES DISC 等（舊管線） | 各層不同 | basin4 1,313 | 見 `web/public/data/README.md` |
| 2026-11-15 | `aod` | Earthdata：MERRA-2 M2TMNXAER TOTEXTTAU（`fetch_earthdata.py m2aer` → `earthdata_layers.py aod`） | 1980-01 – 2026-09 | 全部區域 1,664／basin4 有格點者皆有 | 新類別 `aod` |
| 2026-11-15 | `to3_m2`、`tqv` | Earthdata：MERRA-2 M2TMNXSLV TO3、TQV | 1980-01 – 2026-09 | 1,664 | 新類別 `ozone`、`vapor` |
| 2026-11-15 | `p_m2land`、`et_m2land`、`sm_m2`、`ro_m2`、`rn_m2`、`tsurf_m2`（延長） | Earthdata：MERRA-2 M2TMNXLND | **1980-01** – 2026-09（原本 2000 起） | 1,566（與原本相同） | 2000 後與舊值比對：r 中位數 1.0000、偏差中位數 0.00%；`merge_series.py --only-existing` |
| 2026-11-15 | `rn_ceres` | Earthdata：CERES EBAF Ed4.2.1 sfc_net_tot_all_mon | 2000-03 – 2026-07 | 1,664（含海洋區域） | 類別 `energy`；與 GLDAS `rn`／MERRA-2 `rn_m2` r 中位數 0.98，偏差中位數約 7–8% |
| 2026-11-15 | `lst_night` | Earthdata：MODIS Terra MOD11C3 LST_Night | 2000-02 – 2026-10 | 1,600 | 類別 `tair`；同流程重算 `lst_day` 與既有值 r 中位數 1.0000 |
| 2026-11-15 | GLDAS 5 層（只驗證，不替換） | Earthdata：GLDAS_NOAH025_M 2.1 | 2000-01 – 2026-07 | 1,572 | `et_gldas`、`sm_root`、`runoff`、`swe`、`tair` 重算與既有值 r 中位數 1.0000、偏差 0.00%；既有層已到最新月份，不需延長 |
| 2026-11-15 | `ndvi`（只驗證，不替換） | Earthdata：MODIS MOD13C2 NDVI | 2000-02 – 2026-10 | 1,553 | r 中位數 0.997、偏差中位數 0.5%；高緯度少數流域差異大（推測舊管線用了 pixel reliability 篩選，新管線沒下載該欄位）。既有層已到最新月份，維持舊值 |
| 2026-11-15 | `p_imerg`（只驗證，不替換） | Earthdata：GPM IMERG V07 | 1998-01 – 2025-09 | — | 與既有 `p_imerg` r ≥ 0.999，確認新管線與舊管線一致 |
| 2026-11-15 | `fire_count` | 分享站 `firms/`（`share_firms.py`） | 2000-11 – 2025-12 | 1,664 | 新類別 `fire`；只計 Terra、植被火；無偵測＝0，區域沒有格點＝null |
| 2026-11-15 | `snow_cover` | 分享站 `mod10cm/`（`share_mod10cm.py`） | 2000-03 – 2026-10 | 1,589 | 類別 `snow`；缺 6 個月 |
| 2026-11-15 | `so2_emis` | 分享站 `so2/`（`share_so2.py`） | 2005 – 2025（年值） | 441 | 新類別 `so2`；點源年排放，不是濃度 |

## 和現有 series-2 的關係

- 現有 26 個資料層（`web/public/data/catalog/variables.json`）原本就是從同一批 NASA 產品算出來的。分享站上有的產品（GRACE、GPCP、OISST）不需要重算，除非要更新期間。
- 分享站**新增**、適合子流域的變數：`so2`、`fire_count`（FIRMS）、`snow_cover`（MOD10CM）；等 `m2aer` 有檔案後再加 `aod`。加進來時要：
  1. 用 `data/masks/regions_0p5.npz`（或 HydroBASINS lev04 多邊形）算每個 basin4 的月序列，寫進 `series/<id>.json` 的 `layers`。
  2. 在 `variables.json` 新增資料層，在 `contracts.ts` 的 `CategoryId` 新增類別（PR 標 `[contract change]`）。
  3. 更新 `catalog/series_index.json`。
- 不適用子流域的資料（指數、CH₄、GMSL、臭氧洞、MLS、海冰、海洋網格）MVP 不用。以後要用的話，可以考慮用 Giovanni 對齊到同一區域；試不通就放棄。
