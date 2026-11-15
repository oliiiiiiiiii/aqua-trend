# Earth System Trend Detective

NASA Space Apps Challenge 2026 —「Be An Earth System Trend Detective!」

專案目標是讓學生輸入一個地球事件（例如「2021 台灣大旱」），選定時間與子流域，推薦相關的 NASA 變數，扣除季節循環與長期趨勢後，把事件前後的異常畫在可互動的數線上，回答三個問題：

1. 這個事件在資料裡**看得到**嗎？
2. 它有**多不尋常**？（z 值、歷史名次）
3. 背後的**長期趨勢**是什麼、**顯不顯著**？

給高中、大學學生與有科學背景的大眾使用。月資料統計在瀏覽器內完成，不需要 NASA 帳號。網站後端是 Next.js／Node.js，負責選變數 API 與選用的日資料查詢；啟用日資料時，由部署者提供 Earthdata token，網站使用者不必登入 NASA。本地模型可另行啟動 Python 選變數服務，沒有模型時自動使用關鍵字備案。

目前主線已整合 A、B、C、D、E、F。啟動後從 `/detective/` 輸入事件或選擇預設事件，即可分析資料 bundle 中的真實月序列。事件、期間、子流域、變數、產品與目前分頁會保留在 URL，可重新整理或分享。`/dev/detective-chart` 仍是使用假資料的圖表開發頁。

- 產品規格：[`SPEC.md`](SPEC.md)
- 公開 repo 部署規格：[`SPEC.md` §7](SPEC.md#7-公開-repo-部署規格)
- 分工與整合：[`docs/INTEGRATION.md`](docs/INTEGRATION.md)
- 介面約定：[`web/lib/detective/contracts.ts`](web/lib/detective/contracts.ts)
- 預設事件驗證：[`docs/presets-validation.md`](docs/presets-validation.md)
- 批次問題 CSV 格式：[`docs/batch-questions.md`](docs/batch-questions.md)

## 公開 repo 部署（Docker）

原始碼與網站資料 Release 都已公開。以下流程可在另一台機器自行建置與啟動，不需要 GitHub 登入、SSH key、NASA 帳號或模型 API key。

先安裝 **Git、Node.js 24／npm、curl、tar、Docker 與 Docker Compose**，並啟動 Docker。以下指令適用 macOS、Linux 或 WSL。

### 1. 取得原始碼

```bash
git clone https://github.com/oliiiiiiiiii/aqua-trend.git &&
cd aqua-trend
```

正式發布時選定要部署的 commit，記錄其 SHA；後續資料版本由該 commit 的 [`web/data.lock.json`](web/data.lock.json) 決定。

### 2. 下載並校驗網站資料

資料（月序列、目錄、區域邊界與前處理輸入）放在公開 Release 附件，**不在 Git 內**。從 repo 根目錄執行：

```bash
cd web &&
npm ci &&
TERRATREND_DATA_URL="$(node -p "const d = require('./data.lock.json'); 'https://github.com/' + d.repo + '/releases/download/' + d.tag + '/' + d.asset")" &&
TERRATREND_DATA_FILE="$(mktemp "${TMPDIR:-/tmp}/terratrend-data.XXXXXX")" &&
curl --fail --location --retry 3 "$TERRATREND_DATA_URL" --output "$TERRATREND_DATA_FILE" &&
npm run setup -- --file "$TERRATREND_DATA_FILE" &&
rm -f "$TERRATREND_DATA_FILE" &&
cd ..
```

`setup --file` 先驗證 SHA-256，再解壓到 `web/public/data` 與 `web/data`。上面指令以 `&&` 串接，失敗時會停止；只有成功並回到 repo 根目錄後，才繼續下一步。失敗留下的暫存附件可供檢查，排除問題後再刪除。

**目前請使用上面的公開下載流程。** 現行 `npm run setup` 的自動下載仍走 `gh`／token 路徑，自動匿名下載列為 spec 的待實作項目。直接在尚未準備資料的 checkout 執行 Docker build，也會因缺資料而失敗。

已有 lockfile 對應附件時，可從 `web/` 執行 `npm run setup -- --file /absolute/path/to/archive.tar.gz`，省略下載。

### 3. 建置並啟動容器

在 repo 根目錄執行：

```bash
docker compose up --build -d
```

開啟 **[http://localhost:8080/detective/](http://localhost:8080/detective/)**。容器使用 Next.js／Node.js standalone，同時提供網站、靜態資料與選變數 API；預設直接使用關鍵字選變數，可在沒有模型服務時運作。

更換主機連接埠可使用 `PORT=8090 docker compose up --build -d`，之後開啟 `http://localhost:8090/detective/`。對外部署時，在目標主機或雲端平台設定網域、HTTPS 與路由至容器內的 8080 port。

### 4. 確認服務

```bash
docker compose ps
curl --fail http://localhost:8080/healthz/
curl --fail http://localhost:8080/data/catalog/variables.json -o /dev/null
curl --fail http://localhost:8080/api/select-variables/ \
  -H 'Content-Type: application/json' \
  -d '{"event":"2022 Pakistan floods"}'
```

預期容器為 `healthy`，健康檢查回傳 `ok`，目錄可讀取；預設 API 回傳 17 類投票與 `source: "keyword-fallback"`。若改過主機連接埠，檢查網址也要一起調整。遇到問題可執行 `docker compose logs --tail=100 web`。

### 更新、停止與搬移

更新原始碼後，若 `web/data.lock.json` 改變，先重新執行步驟 2 取得新資料，再於 repo 根目錄執行 `docker compose up --build -d`。停止服務使用：

```bash
docker compose down
```

搬到其他主機時，可以重做步驟 1–4，或先將映像發布到 registry，再讓目標主機拉取。資料 `.tar.gz` 是建置輸入；Docker 映像則包含可執行的網站、API 與資料。映像發布、跨 CPU 架構及模型環境變數的設定見 [`deploy/README.md`](deploy/README.md)。

目前已提供 Docker／Compose；自動匿名 setup、CI/CD、registry 映像發布與正式主機設定仍待完成。上述網址是本機服務，repo 公開不會自動產生正式網站網址。

## 本機開發

完成上方步驟 1–2 的原始碼與資料準備後，從 repo 根目錄執行：

```bash
cd web
npm run dev        # http://localhost:3000/detective/
```

`npm run dev` 會檢查已安裝的資料版本並產生地球資源。以下 npm 指令都在 `web/` 執行；Python 指令在 repo 根目錄執行：

| 指令 | 用途 |
| --- | --- |
| `npm run setup -- --file <檔案>` | 校驗並安裝預先下載的公開資料附件 |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run build` | 建置 Next.js 網站與 API（含 standalone 伺服器） |
| `npm run start` | 啟動已建置的 Next.js 正式伺服器 |
| `python3 -I tools/validate_presets.py` | 在 repo 根目錄重算三個預設事件的 z 值（需要 numpy）；台灣原訂事件窗未達門檻，因此目前結束碼為 1 |

## 使用流程

1. **輸入**事件文字、期間（`YYYY-MM..YYYY-MM`）與 basin4 子流域（地球上點選或搜尋）；或按一個預設事件。
2. **選變數**：本地開源模型對 17 個變數類別各投一票（「這個事件和〈淺白定義〉有關嗎？」），預先勾選，使用者再用 checkbox 修改。模型不可用時改用關鍵字表，畫面會標示；沒有可分析月資料的類別不能勾選。
3. **分析**：每個變數一個分頁，有結論卡、可縮放的數線（原始／季節／趨勢／殘差）、選取區間統計，以及長期趨勢面板。

### 批次問題（CSV）

`/batch` 可一次上傳多個問題：CSV 每列一個事件，只有 `question` 欄必填，期間、地點、變數留空時會從問題文字判讀或由選變數模型建議。每列的答案是事件期間各變數的距平檢定結果，可逐列開啟分析工作台，也可整批下載成 CSV。

```csv
question,time,region,variables,pad
2021 Taiwan spring drought,2021-02..2021-05,b4-4040046370,precip;soil;tws;ndvi,
2022 Pakistan floods,2022-07..2022-09,Indus,,
Heatwave in the Yangtze basin in August 2022,,,,
```

完整格式、欄位別名、略過列的原因與輸出欄位見 [`docs/batch-questions.md`](docs/batch-questions.md)；範例檔在 [`docs/examples/batch-questions.csv`](docs/examples/batch-questions.csv)。

### 短區間日資料

月資料 bundle 持續保留。在分析工作台把 Window 切到 **Days（± 1–14 天）或 Weeks（± 1–5 週）**，支援的產品會透過 `/api/daily-series/` 取得該流域的每日值；每次最多讀取 3 天，逐批顯示進度。範圍以**目前的互動選取區間**為中心（不是原始事件期間），≤ 62 天自動載入，更長則先載入選取區間本身。切換地點、產品或選取區間會中止舊請求，未啟用服務或 NASA 查詢失敗時仍保留月資料。

日視圖預設顯示**日距平**：每日值減去當日常態（月資料分解出的長期趨勢 + 季節循環，內插到每日且保持各月平均不變，並校正日／月產品之間的固定水準差），也可切回原始值。z 值、顯著性、歷史排名及長期趨勢仍以月資料計算。日資料採原生格網的流域遮罩平均，與月資料的 0.5° 重採樣方法不同，兩者不拼成同一條分析序列。不支援的產品（例如 GRACE 月資料）維持月尺度。

本機開發可將 Earthdata token 存入 repo 根目錄的 `.edl.token`，設定檔案權限為 `600`，再於 `web/.env.local` 加入：

```dotenv
EDL_TOKEN_FILE=../.edl.token
```

容器啟用方式見 [`deploy/README.md`](deploy/README.md#optional-daily-data)。token 僅供伺服器執行期使用，不進 Git、映像或前端。來源、門檻實測與限制見 [`docs/daily-data.md`](docs/daily-data.md)。

開發模式的選變數 API 預設連線至本地模型服務，服務未啟動時會使用關鍵字表；Compose 預設直接使用關鍵字表，可透過環境變數啟用模型。模型安裝、評估與選用線上端點見 [`tools/selector/README.md`](tools/selector/README.md)；Docker 連線與環境變數設定見 [`deploy/README.md`](deploy/README.md)。模型權重不包含在網站容器內。

預設事件（[`web/lib/detective/presets.ts`](web/lib/detective/presets.ts)）：

| 事件 | 期間 | 最明顯的訊號 |
| --- | --- | --- |
| 2021 台灣春季大旱 | 2021-02..2021-05 | 根區土壤水 z = −1.66、植被 z = −1.51；未達 \|z\| ≥ 2 |
| 2022 巴基斯坦洪水 | 2022-07..09 | 逕流與根區土壤水為 2000 年以來最高；降水 z = +6.3 |
| 2019–20 澳洲黑色夏季 | 2019-09..2020-01 | 植被 z = −2.7、根區土壤水 z = −2.3（2000 年以來最低） |

## 對應官方題目要求

| 官方要求 | 對應功能 | 實作位置 |
| --- | --- | --- |
| **選擇變數**（variable selection） | 17 類別的淺白定義、模型投票或關鍵字備案、checkbox 與同類產品切換 | `web/lib/detective/categories.ts`、`components/detective/VariablePicker.tsx`、`app/api/select-variables/route.ts` |
| **取得特定區域資料**（region） | 1,313 個 basin4 子流域，可用地球點選或文字搜尋；載入 bundle 中的月序列 | `web/components/detective/InputPanel.tsx`、`lib/detective/series.ts` |
| **產生並視覺化時間序列**（time series） | 真實月序列數線，可縮放、拖曳選取、切換原始／季節／趨勢／殘差，並標記事件期間 | `web/components/detective/SeriesChart.tsx`、`VariableTab.tsx` |
| **變化速率**（rate of change） | 長期趨勢面板：Sen's slope，以「原單位／十年」表示，附 95% 信賴區間；結論卡另顯示事件期間的平均異常 | `web/lib/detective/analysis.ts` 的 `trendStats`、`components/detective/TrendPanel.tsx` |
| **顯著性檢定**（significance testing） | Mann–Kendall 檢定（自相關修正）的 p 值與是否顯著；不顯著時估計還需要幾年資料；事件異常以 z 值與歷史同長度區間的百分位、名次呈現 | `analysis.ts` 的 `trendStats`、`intervalStats` |
| 示範案例 | 一鍵開啟三個預設事件，已有 Python／A 交叉驗證；巴基斯坦與澳洲通過 \|z\| ≥ 2，台灣保留原訂 2–5 月而未達門檻 | `web/lib/detective/presets.ts`、`docs/presets-validation.md` |
| 用 AI 找變數 | 本地 OneJev 模型服務、選用線上模型端點與關鍵字備案 | `web/app/api/select-variables/`、`tools/selector/` |

## 方法摘要

- **基準期**：全期間扣除事件前後 pad（預設 12 個月）。
- **分解**：只用基準期擬合線性趨勢與 12 個月季節循環；殘差 = 原始 − 趨勢 − 季節；`z = 殘差 / σ_基準`。
- **缺值**一律是 `null`，不補值、不當 0；某年缺超過 3 個月，該年不參與季節循環擬合。
- 詳細規則見 [`SPEC.md`](SPEC.md) §3 Step 2。

## 資料來源

| 資料 | 機構 |
| --- | --- |
| GPM IMERG 月降水 | NASA GES DISC |
| GRACE / GRACE-FO JPL mascon（陸地總儲水距平） | NASA JPL |
| GLDAS Noah 2.1（土壤水、逕流、蒸散、氣溫、VPD、輻射、風、積雪） | NASA GES DISC |
| MERRA-2 | NASA GMAO / GES DISC |
| MODIS NDVI、LST | NASA LP DAAC |
| GPCP v2.3、OISST | NOAA（非 NASA，畫面上會標明） |
| HydroBASINS（子流域邊界） | HydroSHEDS |

各資料層的產品、單位、期間與注意事項（caveat）見 `web/public/data/catalog/variables.json`與 `web/public/data/README.md`（兩者都在 setup 後才有）。資料管線與發布流程見 [`docs/DATA_SHARE.md`](docs/DATA_SHARE.md)。

目前鎖定 `data-v2`：34 個資料層，包含氣膠光學厚度、臭氧柱、可降水量、火點、積雪覆蓋、MODIS 夜間地表溫度與 CERES 輻射，並延長六個 MERRA-2 替代產品至 1980 年。SO₂ 點源排放是年資料，保留在 bundle 但不參與月尺度分析；其既有快照的缺測處理限制記在 caveat。管線重跑與依賴見 [`pipeline/README.md`](pipeline/README.md)。三個預設事件的日期、區域與預設變數皆維持原設定。

## 授權

[MIT](LICENSE)
