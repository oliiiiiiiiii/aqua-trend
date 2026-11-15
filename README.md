# Earth System Trend Detective

NASA Space Apps Challenge 2026 —「Be An Earth System Trend Detective!」

專案目標是讓學生輸入一個地球事件（例如「2021 台灣大旱」），選定時間與子流域，推薦相關的 NASA 變數，扣除季節循環與長期趨勢後，把事件前後的異常畫在可互動的數線上，回答三個問題：

1. 這個事件在資料裡**看得到**嗎？
2. 它有**多不尋常**？（z 值、歷史名次）
3. 背後的**長期趨勢**是什麼、**顯不顯著**？

給高中、大學學生與有科學背景的大眾使用。統計分析在瀏覽器內完成，不需要 NASA 帳號。網站後端是 Next.js／Node.js，負責選變數 API；本地模型可另行啟動 Python 選變數服務，沒有模型時自動使用關鍵字備案。

目前主線已整合 A、B、C、D、E、F。從 [`/detective`](http://localhost:3000/detective/) 輸入事件或選擇預設事件，即可分析資料 bundle 中的真實月序列。事件、期間、子流域、變數、產品與目前分頁會保留在 URL，可重新整理或分享。`/dev/detective-chart` 仍是使用假資料的圖表開發頁。

- 產品規格：[`SPEC.md`](SPEC.md)
- 分工與整合：[`docs/INTEGRATION.md`](docs/INTEGRATION.md)
- 介面約定：[`web/lib/detective/contracts.ts`](web/lib/detective/contracts.ts)
- 預設事件驗證：[`docs/presets-validation.md`](docs/presets-validation.md)

## 如何執行

建議使用 Node.js 24，與容器建置版本一致。

```bash
cd web
npm i
npm run dev        # http://localhost:3000/detective/
```

網站資料（月時間序列、目錄、區域邊界）**不在 git 裡**，而是放在 GitHub Release 的附件。`npm run dev` 第一次執行時會自動呼叫 `npm run setup`，依 [`web/data.lock.json`](web/data.lock.json) 下載並驗證 sha256，解壓到 `web/public/data` 與 `web/data`。

repo 是私有的，下載需要下列其中一種：

- 已登入的 GitHub CLI：`gh auth login`
- 環境變數 `GITHUB_TOKEN`（有讀取此 repo 權限的 token）
- 手動下載 Release 附件後：`npm run setup -- --file <檔案路徑>`

容器部署：先依上面方式取得資料，再回到 repo 根目錄執行 `docker compose up --build -d`，預設開啟 http://localhost:8080 。設定與更新方式見 [`deploy/README.md`](deploy/README.md)。

其他指令：

| 指令 | 用途 |
| --- | --- |
| `npm run setup` | 重新下載網站資料 |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run build` | 建置 Next.js 網站與 API（含 standalone 伺服器） |
| `npm run start` | 啟動已建置的 Next.js 正式伺服器 |
| `python3 -I tools/validate_presets.py` | 在 repo 根目錄重算三個預設事件的 z 值（需要 numpy）；台灣原訂事件窗未達門檻，因此目前結束碼為 1 |

## 使用流程

1. **輸入**事件文字、期間（`YYYY-MM..YYYY-MM`）與 basin4 子流域（地球上點選或搜尋）；或按一個預設事件。
2. **選變數**：本地開源模型對 17 個變數類別各投一票（「這個事件和〈淺白定義〉有關嗎？」），預先勾選，使用者再用 checkbox 修改。模型不可用時改用關鍵字表，畫面會標示；沒有可分析月資料的類別不能勾選。
3. **分析**：每個變數一個分頁，有結論卡、可縮放的數線（原始／季節／趨勢／殘差）、選取區間統計，以及長期趨勢面板。

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
