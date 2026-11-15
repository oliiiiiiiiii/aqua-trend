# Earth System Trend Detective

NASA Space Apps Challenge 2026 —「Be An Earth System Trend Detective!」

輸入一個地球事件（例如「2021 台灣大旱」），選定時間與子流域，網站會推薦相關的 NASA 變數，扣除季節循環與長期趨勢後，把事件前後的異常畫在可互動的數線上，回答三個問題：

1. 這個事件在資料裡**看得到**嗎？
2. 它有**多不尋常**？（z 值、歷史名次）
3. 背後的**長期趨勢**是什麼、**顯不顯著**？

給高中、大學學生與有科學背景的大眾使用。全部分析在瀏覽器內完成，沒有 Python 後端，也不需要 NASA 帳號。

- 產品規格：[`SPEC.md`](SPEC.md)
- 分工與整合：[`docs/INTEGRATION.md`](docs/INTEGRATION.md)
- 介面約定：[`web/lib/detective/contracts.ts`](web/lib/detective/contracts.ts)
- 預設事件驗證：[`docs/presets-validation.md`](docs/presets-validation.md)

## 如何執行

需要 Node.js 20 以上。

```bash
cd web
npm i
npm run dev        # 開啟 http://localhost:3000/detective
```

網站資料（月時間序列、目錄、區域邊界）**不在 git 裡**，而是放在 GitHub Release 的附件。`npm run dev` 第一次執行時會自動呼叫 `npm run setup`，依 [`web/data.lock.json`](web/data.lock.json) 下載並驗證 sha256，解壓到 `web/public/data` 與 `web/data`。

repo 是私有的，下載需要下列其中一種：

- 已登入的 GitHub CLI：`gh auth login`
- 環境變數 `GITHUB_TOKEN`（有讀取此 repo 權限的 token）
- 手動下載 Release 附件後：`npm run setup -- --file <檔案路徑>`

其他指令：

| 指令 | 用途 |
| --- | --- |
| `npm run setup` | 重新下載網站資料 |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run build` | 產生靜態網站（`out/`） |
| `python3 -I tools/validate_presets.py` | 在 repo 根目錄執行，用 Python 重算三個預設事件的 z 值（需要 numpy） |

## 使用流程

1. **輸入**事件文字、期間（`YYYY-MM..YYYY-MM`）與 basin4 子流域（地球上點選或搜尋）；或按一個預設事件。
2. **選變數**：本地開源模型對 12 個變數類別各投一票（「這個事件和〈淺白定義〉有關嗎？」），預先勾選，使用者再用 checkbox 修改。模型不可用時改用關鍵字表，畫面會標示。
3. **分析**：每個變數一個分頁，有結論卡、可縮放的數線（原始／季節／趨勢／殘差）、選取區間統計，以及長期趨勢面板。

預設事件（[`web/lib/detective/presets.ts`](web/lib/detective/presets.ts)）：

| 事件 | 期間 | 最明顯的訊號 |
| --- | --- | --- |
| 2021 台灣春季大旱 | 2021-04..05 | 植被 z = −3.0、根區土壤水 z = −2.6 |
| 2022 巴基斯坦洪水 | 2022-07..09 | 逕流與根區土壤水為 2000 年以來最高；降水 z = +6.3 |
| 2019–20 澳洲黑色夏季 | 2019-09..2020-01 | 植被 z = −2.7、根區土壤水 z = −2.3（2000 年以來最低） |

## 對應官方題目要求

| 官方要求 | 對應功能 | 實作位置 |
| --- | --- | --- |
| **選擇變數**（variable selection） | 12 個類別，每類一句淺白定義與預設 NASA 資料層，可切換同類其他產品；AI 投票預先勾選，使用者用 checkbox 修改 | `web/lib/detective/categories.ts`、`app/api/select-variables`、`components/detective/VariablePicker.tsx` |
| **取得特定區域資料**（region） | 1,313 個 HydroBASINS level-4 子流域，地球點選或文字搜尋；序列是子流域內的面積平均 | `components/detective/InputPanel.tsx`、`web/lib/detective/series.ts` |
| **產生並視覺化時間序列**（time series） | 月序列數線，可縮放、拖曳選取；圖層切換原始／季節循環／趨勢／殘差；事件期間著色 | `components/detective/SeriesChart.tsx`、`VariableTab.tsx` |
| **變化速率**（rate of change） | 長期趨勢面板：Sen's slope，以「原單位／十年」表示，附 95% 信賴區間；結論卡另顯示事件期間的平均異常 | `web/lib/detective/analysis.ts` 的 `trendStats`、`components/detective/TrendPanel.tsx` |
| **顯著性檢定**（significance testing） | Mann–Kendall 檢定（自相關修正）的 p 值與是否顯著；不顯著時估計還需要幾年資料；事件異常以 z 值與歷史同長度區間的百分位、名次呈現 | `analysis.ts` 的 `trendStats`、`intervalStats` |
| 示範案例 | 三個預設事件，每個都經過驗證，至少一個變數 \|z\| ≥ 2 | `presets.ts`、`docs/presets-validation.md` |
| 用 AI 找變數 | 本地開源決策模型，不需要 API key；失敗時退回關鍵字表 | `tools/selector/`、`web/lib/detective/keywords.ts` |

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
