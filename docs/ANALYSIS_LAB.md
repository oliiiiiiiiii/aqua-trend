# 分析工具（Analysis Lab）

> 更新日期：2026-11-15。
> 統計來自分支 `feat/analysis-lab`（commit 6448cd7：前九個工具；commit 80766e8：另外八個工具與多重檢定紀錄），已併入 `ui/ux-refresh` 的分析工作台；介面依 [`docs/ux-refresh.md`](ux-refresh.md) 重新設計。
> 程式：[`web/lib/detective/lab.ts`](../web/lib/detective/lab.ts)（統計）、[`web/components/detective/workbench/lab/`](../web/components/detective/workbench/lab/)（介面）、[`web/lib/detective/lab.test.ts`](../web/lib/detective/lab.test.ts) 與 [`web/components/detective/lab-ui.test.ts`](../web/components/detective/lab-ui.test.ts)（測試）。

## 1. 目的

挑戰頁要求「計算變化速率，並用 t 檢定、Mann–Kendall 或信賴區間檢驗顯著性」。工作台的統計面板回答「選取區間是否異常」；**Tests** 區（大圖下方）再提供 17 個單變數檢定（分成 Trend、Mean、Extremes、Cycles 四組，按 Analyse 才執行），對該變數的**殘差序列**（原始值 − 季節循環 − 長期趨勢，也就是 `Decomposition.residual`）在同一個選取範圍上做檢定。

## 2. 使用方式

1. 開啟分析工作台，例如 `/detective?e=2021%20Taiwan%20spring%20drought&t=2021-02..2021-05&r=b4-4040046370&v=precip,soil,tws,ndvi&tab=soil`。
2. **Tests** 區在大圖與圖例下方（統計面板在右側抽屜）。標題列顯示目前範圍（例如「Tests on Feb – May 2021 · 4 mo」），右側的 **Whole record** 勾選框改為對整段資料檢定（預設關閉；整段資料幾乎就是基準期，會出現基準期警告）。
3. **範圍＝工作台的選取區間**，與統計面板相同；工具列的 Before / Event / After 與 Window 已涵蓋事件、前後與全時段。
4. **選工具**：17 個檢定以圖示按鈕排列（24 px 線條圖示＋下方名稱），依 `LAB_GROUPS` 分成 Trend、Mean、Extremes、Cycles 四組：
   - Trend：Linear（OLS＋t）、Mann–Kendall（＋Sen）、Two-segment（分段迴歸）、Permutation（置換）、Bootstrap（區塊拔靴）
   - Mean：t test、Signed-rank（Wilcoxon）、Vs rest（Welch＋Mann–Whitney）、Spread（Brown–Forsythe）、Shape（Jarque–Bera）、By month（Kruskal–Wallis）
   - Extremes：Cumulative（CUSUM）、Streaks（最長同號連續＋runs test）、Beyond 2σ（二項檢定）、Break（Pettitt）
   - Cycles：Autocorrelation（ACF＋Ljung–Box）、Periodogram（Lomb–Scargle＋紅噪音）
   精確的檢定名稱在滑鼠提示與螢幕閱讀器描述（`aria-description`）中，也寫在選取列旁。按鈕是 radio，方向鍵可切換。月數不足的工具變淡並標示最少月數（「≥10」）。
5. **Analyse**：選工具**不會**執行。按 **Analyse** 後先跑一條短進度條（600–1200 ms，依工具負擔與範圍長度；`prefers-reduced-motion` 時立即），再出現結果。之後若改變選取區間（或變數）或換工具，結果變淡並顯示「Selection changed — Analyse again」／「Test changed — Analyse again」，圖上的疊線也移除。
6. **結果**：一行結論（● 顯著／○ 不顯著，α = 0.05；CUSUM 為描述性，以「–」標示並寫「Descriptive, no p value」）→ 2–4 個關鍵數字（估計值含單位與 95 % CI、檢定統計量、p）→ 需要時一張小圖（ACF、直方圖＋常態曲線、拔靴與置換分布、累積異常、逐月散點、週期圖）→ 收合的 **Details**（df、未修正 p、R²、τ、S、W⁺、效果量 d 等完整數字與方法說明）。未修正自相關的 p 值旁標「uncorrected」，分段迴歸的 p 值標「optimistic」。範圍涵蓋 ≥ 80 % 基準期時顯示一行警告。斜率在範圍 ≥ 10 年時用「/decade」，否則用「/yr」。t test 的 Details 註明：這裡的 lag-1 r 由範圍內的月份估計，統計面板用基準期的 r，短範圍兩者 p 可能不同。
7. **圖上疊線**：有擬合線的工具（Linear、Mann–Kendall、Two-segment、Permutation、Bootstrap、t test、Signed-rank、Vs rest、Streaks、Break）在分析後把線段畫在大圖的 **Anomaly** 圖層：細的墨色線加 2 px 底色光暈，Vs rest 的「其餘平均」為虛線；Break 另畫一條虛線直線並標「Break」。在其他圖層時，結果下方有「Show on anomaly」連結。
8. **多重檢定紀錄**：見 §3。
9. **URL**：選取的工具寫入 `test=<工具 id>`（例如 `&test=mk`；id 即 `LAB_TOOLS`），重新載入後只選取、不執行，需再按 Analyse。同一個工具在切換變數時保留。Whole record 與紀錄不寫入 URL。

## 3. 工具列表

| 按鈕 | 檢定 | 輸出 | 最少月數 |
| --- | --- | --- | --- |
| 迴歸 | OLS 線性迴歸＋t 檢定 | 斜率、95% CI、t、df、p、未修正 p、R² | 10 |
| MK | Mann–Kendall＋Sen 斜率 | Sen 斜率與 CI、S、Kendall τ、z、p、未修正 p | 10 |
| 平均 | 單樣本 t 檢定（平均異常 ≠ 0） | 平均、CI、標準差、t、p、效果量 d | 3 |
| 符號秩 | Wilcoxon 符號秩檢定（無母數） | 中位數、高於正常的比例、W⁺、z、p | 10 |
| 比較 | 範圍 vs 其餘所有月份：Welch t、Mann–Whitney U | 兩段平均、差值與 CI、兩個 p、P(這段 > 其餘) | 範圍 3、其餘 12 |
| 轉折 | Pettitt 單一轉折點檢定 | 轉折月份、前後平均、K、近似 p | 10 |
| 自相關 | ACF（lag 1–12）＋Ljung–Box | 自相關圖（含 ±1.96/√n 帶）、Q、p | 24 |
| 分布 | 直方圖＋Jarque–Bera 常態性 | 直方圖疊常態曲線、偏態、超額峰態、JB、p | 20 |
| 拔靴 | 移動區塊拔靴法（2000 次） | 平均與斜率的拔靴直方圖、百分位 95% CI、p | 12 |
| 分段 | 連續兩段直線（hinge）迴歸，轉折月份以最小平方搜尋 | 轉彎月份、前後斜率、R²（一條線 → 兩段）、F、p | 24 |
| 置換 | 置換檢定：逐月打亂 vs 整塊打亂（各 2000 次） | 真實斜率、兩種 p、整塊打亂的斜率直方圖 | 12 |
| 變異 | Brown–Forsythe（範圍 vs 其餘） | 兩段標準差、比值、t、p | 範圍 10、其餘 12 |
| 月份 | 依 1–12 月分組＋Kruskal–Wallis | 各月散點與平均、偏離最大的月份、H、p | 24 |
| 累積 | 累積異常（CUSUM），描述性 | 累積曲線、整段累積、最大累積虧損／盈餘與起訖月份 | 3 |
| 連續 | 最長同號連續＋Wald–Wolfowitz runs test | 最長連續（月數、起訖）、獨立與持續性兩種模擬機率、runs z、p | 12 |
| 極端 | \|z\| > 2 的月份數，對基準期比例做精確二項檢定 | 高／低極端月份數、預期數、雙尾與「偏多」單尾 p | 12 |
| 週期 | Lomb–Scargle 週期圖＋AR(1) 紅噪音 95% 門檻 | 週期圖、前三高峰（週期、強度、是否超過門檻） | 48 |

每個結果先給一行結論（附 ● / ○ 符號與「α = 0.05」），再給 2–4 個關鍵數字，最後是收合的 Details。月數不足時工具按鈕停用並標示最少月數（例如「≥10」），結果區顯示「Not enough data · Needs ≥ 10 months (4 in range)」。表中按鈕名稱是原分支的中文名稱；新介面的英文標籤見 §2。

### 多重檢定紀錄

同一個範圍按 Analyse 跑過兩個以上有 p 值的工具後，結果下方會出現一行可展開的紀錄：「n tests on this range · k with p < 0.05 · x expected by chance」。展開後每個工具一列：符號＋狀態文字（● holds after Holm＝經 Holm 逐步修正後仍顯著；◐ significant before correction only＝單看顯著但修正後不顯著；○ not significant）。不以顏色區分。換範圍（或換變數、換產品）時紀錄重設。每個工具計入紀錄的 p 值見 `primaryP()`（比較取 Welch、拔靴取斜率、連續取「依持續性」模擬、自相關取 Ljung–Box；累積與週期沒有單一 p 值，不計入）。


## 4. 統計細節

- **缺值**：只用有值的月份，x 為實際月份索引；不補值、不跨缺口相連。
- **自相關修正**：與 `trendStats` 一致。lag-1 相關只用「剛好相鄰一個月」的成對資料；`nEff = n(1−ρ)/(1+ρ)`，ρ < 0 視為 0。
  - 迴歸：標準誤乘 `√((n−2)/(nEff−2))`，自由度改為 `nEff − 2`。
  - MK：Var(S) 乘 `n/nEff`；Sen 信賴區間用等效放大的 z 分位數。
  - 平均 t 檢定、符號秩：標準誤或變異數用 `nEff`。
  - Welch t：兩段各自的 `nEff`，Welch–Satterthwaite 自由度。
  - **未修正**：Mann–Whitney U、Pettitt（介面上註明 p 值偏樂觀）。
- **拔靴法**：區塊長度 `⌈n^⅓⌉`，平均直接重抽；斜率重抽擬合殘差的區塊再加回擬合線。亂數有固定種子，同一範圍每次結果相同。p 值為「以估計值置中後，離 0 至少一樣遠的比例」。
- **基準期警告**：殘差是用基準期擬合趨勢與季節後得到的，所以在基準期上殘差的平均與斜率**在計算上就接近 0**。當範圍涵蓋 ≥ 80% 的基準期月份時，迴歸、MK、平均、符號秩、拔靴會顯示警告，建議改選子區間。
- **斜率單位**：範圍 ≥ 10 年時用「／十年」，否則用「／年」。
- **分段迴歸**：模型 `y = a + b·x + c·max(0, x − k)`，k 在去掉前後各 max(6, 10%) 個月後逐一試；F 檢定（2, n − 4 自由度）比較兩段與一條線，F 乘 `nEff/n`、分母自由度改 `nEff − 4`。因為 k 是搜尋出來的，p 值仍偏樂觀（Davies 問題），介面上註明。
- **置換檢定**：統計量為 OLS 斜率，雙尾。「整塊打亂」把資料切成 `max(2, ⌈n^⅓⌉)` 個月的區塊、打亂區塊順序，保留短期持續性；介面同時列出逐月打亂的 p，示範忽略自相關會高估顯著性。
- **變異比較**：Brown–Forsythe＝對「離各組中位數的絕對距離」做兩組比較；這裡用 Welch t（兩組各自 `nEff`）。
- **逐月分解**：Kruskal–Wallis H 含同分修正，df = 有資料的月份數 − 1，p 用卡方分布。未修正自相關（同月份的值相隔 12 個月，影響較小）。
- **累積異常**：殘差逐月相加（缺值不加）。最大累積虧損＝累積曲線從高點到之後低點的最大落差；盈餘反之。沒有 p 值。
- **連續性**：最長連續只計相鄰有值的月份（缺值會中斷）。模擬兩種虛無模型各 2000 次（固定種子）：每月獨立的常態值，以及以「整段殘差的 lag-1 相關」為係數的 AR(1)；機率＝模擬中同號連續至少一樣長的比例。Runs test 用常態近似、不修正自相關。
- **極端月份**：用 `Decomposition.z`；預期比例為基準期中 |z| > 2 的實際比例（若為 0 則用常態的 4.55%）。精確二項檢定，雙尾 p 為機率不大於觀察值者之和（同 scipy `binomtest`）。不修正自相關。
- **週期圖**：Lomb–Scargle（可處理缺值），功率除以變異數（白噪音平均約 1）。紅噪音背景 `(1 − ρ²)/(1 + ρ² − 2ρ cos 2πf)`，在 [0, ½] 上平均為 1，乘 `χ²₂(0.95)/2 = 2.996` 作為 95% 門檻。頻率從 1/資料長度到 0.5 次／月；高峰依功率排序。同時看很多頻率，單一越線高峰要謹慎解讀。
- 新增於 [`web/lib/stats.ts`](../web/lib/stats.ts)：`chiSquareSf`（卡方右尾，供 Ljung–Box、Kruskal–Wallis）、`fSf`（F 分布右尾，供分段迴歸）、`binomialTest`（精確二項檢定，供極端月份）。


## 5. 程式結構

統計（`web/lib/detective/lab.ts`，來自 `feat/analysis-lab`，未修改）：

- `runLabTool(tool, d, start, end)`：唯一入口，回傳 `{ kind: "ok", stats, segments }` 或 `{ kind: "insufficient", n, need }`。`segments` 是要畫在殘差圖上的線段（月份索引、殘差單位）。
- 各檢定也可單獨呼叫：`olsTest`、`mkTest`、`meanTest`、`wilcoxonTest`、`compareTest`、`pettittTest`、`acfTest`、`normalityTest`、`bootstrapTest`、`piecewiseTest`、`permutationTest`、`varianceTest`、`monthlyTest`、`cusumTest`、`runsTest`、`extremesTest`、`spectrumTest`。
- `LAB_GROUPS` 定義分組與順序；`LAB_MIN_N` 最少月數；`BASELINE_SENSITIVE`、`baselineShare` 供基準期警告；`primaryP()` 與 `holm()` 供多重檢定紀錄。

介面（`web/components/detective/workbench/lab/`，所有文字在 `workbench/copy.ts` 的 `COPY.lab`，英文）：

- `tests.ts`（純函式）：群組（`GROUPS`、`testsIn`、`groupOf`，依 `LAB_GROUPS`）、`availability()`（每個工具是否有足夠月數；Vs rest 與 Spread 另需範圍外 ≥ 12 個月）、`pickInGroup()`、`slopeScale()`（/decade 或 /yr）、`overlayFor()`（線段與 Pettitt 轉折月）、`testLog()`（`primaryP` ＋ `holm` → holds / uncorrected-only / not-significant）、`analyseMs()`（進度條長度）、`staleReason()`（結果是否過期）。
- `icons.ts`：每個工具的 24 × 24 線條圖示路徑。
- `format.ts`（純函式）：`resultView(stats, ctx)` 把一個工具的統計轉成結論、關鍵數字、Details 列、方法說明與要畫的圖。
- `useLabRun.ts`：`useLabAnalysis(lane, sel, test, whole)` 回傳目前範圍的可用性、`analyse()`（進度條後執行 `runLabTool`）、最後一次結果（`LabRun`，含疊線、基準期警告、多重檢定紀錄）與過期原因。紀錄以「產品＋範圍」為鍵，範圍改變即重設。
- `TestsPanel.tsx`：範圍標題、Whole record、分組圖示按鈕、Analyse 與進度條、過期提示、結果；`LabControl`（`test`、`whole`、`onTest`、`onWhole`）由 `AnalysisView` 保存，所有變數共用。
- `ResultCard.tsx`（結論、數字、圖、Details、紀錄）、`figures.tsx`（純 SVG、只用色彩 token）、`overlay.tsx`（圖上的線段與轉折線）。
- 掛載點：`AnalysisView.tsx` 保存 `test`（URL）與 Whole record 並傳入 `lab`；`Lanes.tsx` 的 `ExpandedLane` 呼叫 `useLabAnalysis`，在圖例下方放 `<TestsPanel>`、把結果的 `overlay` 傳給 `LaneChart`；`LaneChart.tsx` 在 Anomaly 圖層畫 `LabOverlayMarks`；`web/lib/detective/url.ts` 的 `test` 參數（`TEST_IDS` 與 `LAB_TOOLS` 相同）。

## 6. 測試

從 `web/` 執行：

```bash
npx tsx --test lib/detective/lab.test.ts
```

參考值來自 scipy 1.18（`linregress`、`ttest_1samp`、`wilcoxon`、`ttest_ind(equal_var=False)`、`mannwhitneyu`、`jarque_bera`、`kruskal`、`chi2.sf`、`f.sf`、`binomtest`）。測試資料的 lag-1 相關 < 0，因此修正不啟動，結果必須和教科書檢定完全一致。另外測試：自相關修正會使 p 值變大、Ljung–Box 偵測 AR(1)、Pettitt 找到階梯位置、拔靴結果可重現、`runLabTool` 的資料不足與線段範圍；累積虧損位置、最長連續與「持續性使連續較不罕見」、極端月份計數、變異變大、週期圖在有缺值時找到 40 個月週期、分段迴歸找到轉折與兩段斜率、整塊打亂比逐月打亂保守、Holm 修正。

目前 `npx tsx --test lib/detective/*.test.ts components/detective/*.test.ts app/api/select-variables/*.test.ts` 共 279 個測試通過，`tsc --noEmit` 無錯誤；已在本機 dev server 以台灣 2021 大旱預設事件截圖檢查各群組、亮暗主題與 390 px 手機版面。

介面的純函式測試：

```bash
npx tsx --test components/detective/lab-ui.test.ts lib/detective/url.test.ts
```

涵蓋：分組與 `LAB_GROUPS` 一致、英文標籤、可用性與原因、/decade 與 /yr、疊線（分段兩段、Pettitt 轉折月）、每個工具都有英文結論與 1–4 個數字、uncorrected／optimistic 標記、CUSUM 無 p 值、多重檢定紀錄（排除描述性工具、Holm 三種狀態）、進度條長度與 reduced motion、過期判斷、每個工具都有圖示、URL `test` 參數。

## 7. 已知限制與後續

- 「Vs rest」中 Welch（已修正）與 Mann–Whitney（未修正）可能結論不同，例如台灣大旱 4 個月事件：Welch p = 0.12、U 檢定 p = 0.008。結論句以 Welch 為準，並註明「Mann–Whitney disagrees.」。
- 只有 4 個月的事件，t test 用範圍內 4 個值估 lag-1 相關，有效樣本常降到下限 3，p 值會比統計面板（用基準期的 AR(1)）保守得多；兩者回答的問題不同。
- `runLabTool` 回傳的 `what` 是中文字串，新介面不使用。
- 多重檢定紀錄只涵蓋同一個變數、同一個範圍；跨變數的多重比較未處理。
- 可考慮加入：季節 Mann–Kendall（逐月趨勢）、跨變數的相關與延遲相關。
