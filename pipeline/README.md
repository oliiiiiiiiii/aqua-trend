# pipeline/：資料管線（工作線 F）

原始資料 → 0.5° 區域平均 → `data/interim/layers/<層>.npz` → `web/public/data/series/*.json`（series-2）。
每一步可重跑；更新一層不會動到其他層。

## 環境

```bash
python3 -m venv .venv && .venv/bin/pip install numpy netCDF4 h5py pyhdf
```

讀檔一律單執行緒（netCDF-C／HDF4 平行會 segfault）；下載可以平行。用 `python -I` 執行。

## 1. 取得原始資料（`data/share/<資料夾>/`，gitignore）

- **分享站**（不需帳號）：http://meow1.csie.ntu.edu.tw:3266/，資料夾名稱與 `data/share/` 相同。
- **NASA Earthdata**（需要 token）：

  ```bash
  echo "<token>" > .edl.token        # https://urs.earthdata.nasa.gov → Generate Token；已 gitignore
  .venv/bin/python -I pipeline/fetch_earthdata.py --list
  .venv/bin/python -I pipeline/fetch_earthdata.py m2aer m2slv m2lnd imerg gldas lst ceres --workers 5
  ```

  已完成的檔案會跳過；每個資料夾寫 `_manifest.json`。只抓需要的變數（見 `PRODUCTS`），新增變數就改清單重跑。

## 2. 產生中間檔

| 腳本 | 資料層 |
|---|---|
| `earthdata_layers.py` | `aod`、`to3_m2`、`tqv`、`lst_night`、`rn_ceres`、MERRA-2 陸面 6 層；`*_check` 只用來和既有層比對 |
| `share_firms.py` | `fire_count` |
| `share_mod10cm.py` | `snow_cover` |
| `share_so2.py` | `so2_emis` |

```bash
.venv/bin/python -I pipeline/earthdata_layers.py aod to3_m2 tqv
```

共用：`regions.py`（遮罩 `data/masks/regions_0p5.npz`、重網格化、面積加權平均、≥30% 覆蓋規則、`save_layer`）、`share_common.py`（點資料計數）。

## 3. 合併、manifest

```bash
.venv/bin/python -I pipeline/merge_series.py aod fire_count            # 新層
.venv/bin/python -I pipeline/merge_series.py --only-existing p_m2land  # 延長既有層，只更新原本有該層的區域
python3 -I pipeline/build_manifest.py data-YYYY-MM-DD                  # 驗證所有序列並寫 catalog/manifest.json
```

新增類別時，同步改 `web/lib/detective/contracts.ts` 的 `CategoryId`（PR 標 `[contract change]`），並在 `docs/DATA_SHARE.md` 的「處理紀錄」補一行。

## 驗證（2026-11-15）

用本管線從原始檔重算既有層，與舊管線（hub.py）結果比對，全部區域的相關係數中位數：IMERG ≥ 0.999、GLDAS 5 層 1.0000、MERRA-2 陸面 6 層 1.0000、MODIS LST 1.0000。
