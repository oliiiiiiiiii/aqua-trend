# Earth System Trend Detective

NASA Space Apps Challenge 2026 —「Be An Earth System Trend Detective!」

專案目標是讓學生輸入一個地球事件（例如「2021 台灣大旱」），選定時間與子流域，推薦相關的 NASA 變數，扣除季節循環與長期趨勢後，把事件前後的異常畫在可互動的數線上，回答三個問題：

1. 這個事件在資料裡**看得到**嗎？
2. 它有**多不尋常**？（z 值、歷史名次）
3. 背後的**長期趨勢**是什麼、**顯不顯著**？

給高中、大學學生與有科學背景的大眾使用。全部分析在瀏覽器內完成，沒有 Python 後端，也不需要 NASA 帳號。

目前主線已整合 A 的統計函式、B 的圖表元件與 E 的類別／預設事件設定。圖表可在 [`/dev/detective-chart`](http://localhost:3000/dev/detective-chart) 以假資料試用；C 的 `/detective` 完整流程與 D 的 AI 選變數服務尚未整合，因此目前不能從事件輸入直接取得真實資料分析。

- 產品規格：[`SPEC.md`](SPEC.md)
- 分工與整合：[`docs/INTEGRATION.md`](docs/INTEGRATION.md)
- 介面約定：[`web/lib/detective/contracts.ts`](web/lib/detective/contracts.ts)
- 預設事件驗證：[`docs/presets-validation.md`](docs/presets-validation.md)

## 如何執行

需要 Node.js 20 以上。

```bash
cd web
npm i
npm run dev        # 圖表示範：http://localhost:3000/dev/detective-chart（假資料）
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
| `npm run build` | 產生靜態網站（`out/`） |
| `python3 -I tools/validate_presets.py` | 在 repo 根目錄重算三個預設事件的 z 值（需要 numpy）；台灣原訂事件窗未達門檻，因此目前結束碼為 1 |

## 預定使用流程（待 C／D 整合）

1. **輸入**事件文字、期間（`YYYY-MM..YYYY-MM`）與 basin4 子流域（地球上點選或搜尋）；或按一個預設事件。
2. **選變數**：本地開源模型對 12 個變數類別各投一票（「這個事件和〈淺白定義〉有關嗎？」），預先勾選，使用者再用 checkbox 修改。模型不可用時改用關鍵字表，畫面會標示。
3. **分析**：每個變數一個分頁，有結論卡、可縮放的數線（原始／季節／趨勢／殘差）、選取區間統計，以及長期趨勢面板。

預設事件（[`web/lib/detective/presets.ts`](web/lib/detective/presets.ts)）：

| 事件 | 期間 | 最明顯的訊號 |
| --- | --- | --- |
| 2021 台灣春季大旱 | 2021-02..2021-05 | 根區土壤水 z = −1.66、植被 z = −1.51；未達 \|z\| ≥ 2 |
| 2022 巴基斯坦洪水 | 2022-07..09 | 逕流與根區土壤水為 2000 年以來最高；降水 z = +6.3 |
| 2019–20 澳洲黑色夏季 | 2019-09..2020-01 | 植被 z = −2.7、根區土壤水 z = −2.3（2000 年以來最低） |

## 對應官方題目要求

| 官方要求 | 對應功能 | 實作位置 |
| --- | --- | --- |
| **選擇變數**（variable selection） | 已有 12 類別的淺白定義與預設資料層；AI 投票、checkbox 與切換產品待 C／D 整合 | `web/lib/detective/categories.ts`；規劃位置見 `docs/INTEGRATION.md` 工作線 C／D |
| **取得特定區域資料**（region） | 資料 bundle 有 1,313 個 basin4 子流域；偵探頁的地球點選、搜尋與序列載入待 C 整合 | `web/public/data/series/`（setup 下載）；規劃位置見工作線 C |
| **產生並視覺化時間序列**（time series） | 已有月序列數線，可縮放、拖曳選取、切換原始／季節／趨勢／殘差，並標記事件期間；開發頁以假資料示範 | `web/components/detective/SeriesChart.tsx`、`VariableTab.tsx` |
| **變化速率**（rate of change） | 長期趨勢面板：Sen's slope，以「原單位／十年」表示，附 95% 信賴區間；結論卡另顯示事件期間的平均異常 | `web/lib/detective/analysis.ts` 的 `trendStats`、`components/detective/TrendPanel.tsx` |
| **顯著性檢定**（significance testing） | Mann–Kendall 檢定（自相關修正）的 p 值與是否顯著；不顯著時估計還需要幾年資料；事件異常以 z 值與歷史同長度區間的百分位、名次呈現 | `analysis.ts` 的 `trendStats`、`intervalStats` |
| 示範案例 | 三個預設事件已有 Python／A 交叉驗證；巴基斯坦與澳洲通過 \|z\| ≥ 2，台灣保留原訂 2–5 月而未達門檻；一鍵開啟待 C 整合 | `web/lib/detective/presets.ts`、`docs/presets-validation.md` |
| 用 AI 找變數 | 規劃本地開源模型與關鍵字備案，尚未整合 | `docs/INTEGRATION.md` 工作線 D |

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

## 授權

[MIT](LICENSE)
