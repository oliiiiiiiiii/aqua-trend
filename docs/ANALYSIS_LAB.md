# 分析工具（Analysis Lab）

> 更新日期：2026-11-15。
> 統計來自分支 `feat/analysis-lab`（commit 6448cd7：前九個工具；commit 80766e8：另外八個工具與多重檢定紀錄；commit ffa750c「Add classical machine-learning tools to the analysis lab」：七個傳統機器學習工具 `ml.ts`），已併入 `ui/ux-refresh` 的分析工作台；介面依 [`docs/ux-refresh.md`](ux-refresh.md) 重新設計。
> 程式：[`web/lib/detective/lab.ts`](../web/lib/detective/lab.ts)、[`web/lib/detective/ml.ts`](../web/lib/detective/ml.ts)（統計）、[`web/components/detective/workbench/lab/`](../web/components/detective/workbench/lab/)（介面）、[`web/lib/detective/lab.test.ts`](../web/lib/detective/lab.test.ts)、[`web/lib/detective/ml.test.ts`](../web/lib/detective/ml.test.ts) 與 [`web/components/detective/lab-ui.test.ts`](../web/components/detective/lab-ui.test.ts)（測試）。

## 1. 目的

挑戰頁要求「計算變化速率，並用 t 檢定、Mann–Kendall 或信賴區間檢驗顯著性」。工作台的統計面板回答「選取區間是否異常」；**Tests** 區（大圖下方）再提供 24 個單變數工具（17 個檢定加 7 個傳統機器學習工具，分成 Trend、Mean、Extremes、Cycles、Machine learning 五組，按 Analyse 才執行），對該變數的**殘差序列**（原始值 − 季節循環 − 長期趨勢，也就是 `Decomposition.residual`）在同一個選取範圍上做檢定。

## 2. 使用方式

1. 開啟分析工作台，例如 `/detective?e=2021%20Taiwan%20spring%20drought&t=2021-02..2021-05&r=b4-4040046370&v=precip,soil,tws,ndvi&tab=soil`。
2. **Tests** 區在大圖與圖例下方（統計面板在右側抽屜）。標題列顯示目前範圍（例如「Tests on Feb – May 2021 · 4 mo」），右側的 **Whole record** 勾選框改為對整段資料檢定（預設關閉；整段資料幾乎就是基準期，會出現基準期警告）。
3. **範圍＝工作台的選取區間**，與統計面板相同；工具列的 Before / Event / After 與 Window 已涵蓋事件、前後與全時段。
4. **選工具**：24 個工具以圖示按鈕排列（22 px 線條圖示＋下方名稱），依 `LAB_GROUPS` 分成五組，連成一個格子：1440 px 寬時每列 6 個、共 4 列（手機每列 5 個、5 列），沒有側邊留白、沒有列中分隔線：
   - Trend：Linear（OLS＋t）、Mann–Kendall（＋Sen）、Two-segment（分段迴歸）、Permutation（置換）、Bootstrap（區塊拔靴）
   - Mean：t test、Signed-rank（Wilcoxon）、Vs rest（Welch＋Mann–Whitney）、Spread（Brown–Forsythe）、Shape（Jarque–Bera）、By month（Kruskal–Wallis）
   - Extremes：Cumulative（CUSUM）、Streaks（最長同號連續＋runs test）、Beyond 2σ（二項檢定）、Break（Pettitt）
   - Cycles：Autocorrelation（ACF＋Ljung–Box）、Periodogram（Lomb–Scargle＋紅噪音）
   - Machine learning：Similar（最近鄰＋DTW）、States（高斯 HMM）、Forecast（AR 預測）、Rare（矩陣剖面）、Isolation（孤立森林）、Change pts（貝氏線上轉折偵測）、Smooth（高斯過程平滑）
   精確的檢定名稱在滑鼠提示與螢幕閱讀器描述（`aria-description`）中，也寫在選取列旁。按鈕是 radio，方向鍵可切換。步數不足的工具變淡並標示最少步數（「≥3」）。
5. **Analyse**：選工具**不會**執行。按 **Analyse** 後先跑一條短進度條（600–1200 ms，依工具負擔與範圍長度；`prefers-reduced-motion` 時立即），再出現結果。機器學習工具與模擬類檢定一樣只在按下 Analyse 後才計算（高斯過程平滑在整段資料約 0.5 秒），所以拖曳選取時不會卡頓。Forecast 需要範圍開始前約 3 年連續資料，不足時按鈕停用並寫「Needs about 3 years of unbroken data before the range」。之後若改變選取區間（或變數）或換工具，結果變淡並顯示「Selection changed — Analyse again」／「Test changed — Analyse again」，圖上的疊線也移除。
6. **結果**：一行結論（● 顯著／○ 不顯著，α = 0.05；CUSUM 為描述性，以「–」標示並寫「Descriptive, no p value」）→ 2–4 個關鍵數字（估計值含單位與 95 % CI、檢定統計量、p）→ 需要時一張小圖（ACF、直方圖＋常態曲線、拔靴與置換分布、累積異常、逐月散點、週期圖；機器學習工具：相似期間與本範圍疊圖、HMM 每月狀態機率條、預測線＋95 % 帶、矩陣剖面曲線、孤立分數、轉折機率、GP 平滑＋95 % 帶）→ 收合的 **Details**（df、未修正 p、R²、τ、S、W⁺、效果量 d 等完整數字與方法說明）。機器學習工具的結果同一個文法：一行「找到了什麼」（例如「3 similar periods; closest is Mar – Jun 2002」、「Low state from Nov 2020, 7 months」；多數沒有 p 值，以「–」與「Descriptive, no p value」標示，只有 Forecast 有 p 並進入多重檢定紀錄）、2–4 個數字、小圖、一行誠實說明（相似：「Similar shape does not mean the same cause.」；狀態：「States are fitted to this series; they are not an official drought definition.」；預測：「Trained only on months before the range.」等），Details 收合。未修正自相關的 p 值旁標「uncorrected」，分段迴歸的 p 值標「optimistic」。範圍涵蓋 ≥ 80 % 基準期時顯示一行警告。斜率在範圍 ≥ 10 年時用「/decade」，否則用「/yr」。t test 的 Details 註明：這裡的 lag-1 r 由範圍內的月份估計，統計面板用基準期的 r，短範圍兩者 p 可能不同。
7. **圖上疊線與底色**：機器學習工具的結果可帶 `bands`（月份區段的底色）：Similar 把相似期間編號 1–3 標出、States 標出偏低／偏高狀態、Rare 標出最罕見片段與重複的一對、Isolation 標出被標記的月份；底色在**所有圖層**（Anomaly、Observed、Seasonal、Trend）都畫在序列後面，圖例列只在出現底色時多一個項目（例如「low state」「high state」「similar period」）。Forecast 與 Smooth 的預測線／平滑線與上下界、Change pts 的階梯線是線段，與其他工具相同只畫在 Anomaly 圖層。有擬合線的工具（Linear、Mann–Kendall、Two-segment、Permutation、Bootstrap、t test、Signed-rank、Vs rest、Streaks、Break）在分析後把線段畫在大圖的 **Anomaly** 圖層（結果過期時疊圖與底色一併移除）：細的墨色線加 2 px 底色光暈，Vs rest 的「其餘平均」為虛線；Break 另畫一條虛線直線並標「Break」。在其他圖層時，結果下方有「Show on anomaly」連結。
8. **多重檢定紀錄**：見 §3。
9. **URL**：選取的工具寫入 `test=<工具 id>`（例如 `&test=mk`；id 即 `LAB_TOOLS`），重新載入後只選取、不執行，需再按 Analyse。同一個工具在切換變數時保留。Whole record 與紀錄不寫入 URL。

## 3. 工具列表

| 按鈕 | 檢定 | 輸出 | 最少步數（月／週／日） |
| --- | --- | --- | --- |
| 迴歸 | OLS 線性迴歸＋t 檢定 | 斜率、95% CI、t、df、p、未修正 p、R² | 3 |
| MK | Mann–Kendall＋Sen 斜率 | Sen 斜率與 CI、S、Kendall τ、z、p、未修正 p | 3 |
| 平均 | 單樣本 t 檢定（平均異常 ≠ 0） | 平均、CI、標準差、t、p、效果量 d | 2 |
| 符號秩 | Wilcoxon 符號秩檢定（無母數） | 中位數、高於正常的比例、W⁺、z、p | 2 |
| 比較 | 範圍 vs 其餘所有月份：Welch t、Mann–Whitney U | 兩段平均、差值與 CI、兩個 p、P(這段 > 其餘) | 範圍 2、其餘 12 |
| 轉折 | Pettitt 單一轉折點檢定 | 轉折月份、前後平均、K、近似 p | 2 |
| 自相關 | ACF（lag 1–12）＋Ljung–Box | 自相關圖（含 ±1.96/√n 帶）、Q、p | 4 |
| 分布 | 直方圖＋Jarque–Bera 常態性 | 直方圖疊常態曲線、偏態、超額峰態、JB、p | 4 |
| 拔靴 | 移動區塊拔靴法（2000 次） | 平均與斜率的拔靴直方圖、百分位 95% CI、p | 3 |
| 分段 | 連續兩段直線（hinge）迴歸，轉折月份以最小平方搜尋 | 轉彎月份、前後斜率、R²（一條線 → 兩段）、F、p | 5 |
| 置換 | 置換檢定：逐月打亂 vs 整塊打亂（各 2000 次） | 真實斜率、兩種 p、整塊打亂的斜率直方圖 | 3 |
| 變異 | Brown–Forsythe（範圍 vs 其餘） | 兩段標準差、比值、t、p | 範圍 3、其餘 12 |
| 月份 | 依 1–12 月分組＋Kruskal–Wallis | 各月散點與平均、偏離最大的月份、H、p | 2（至少兩個曆月） |
| 累積 | 累積異常（CUSUM），描述性 | 累積曲線、整段累積、最大累積虧損／盈餘與起訖月份 | 1 |
| 連續 | 最長同號連續＋Wald–Wolfowitz runs test | 最長連續（月數、起訖）、獨立與持續性兩種模擬機率、runs z、p | 2 |
| 極端 | \|z\| > 2 的月份數，對基準期比例做精確二項檢定 | 高／低極端月份數、預期數、雙尾與「偏多」單尾 p | 1 |
| 週期 | Lomb–Scargle 週期圖＋AR(1) 紅噪音 95% 門檻 | 週期圖、前三高峰（週期、強度、是否超過門檻） | 4 |

每個結果先給一行結論（附 ● / ○ 符號與「α = 0.05」），再給 2–4 個關鍵數字，最後是收合的 Details。步數不足時工具按鈕停用並標示最少步數（例如「≥3」），結果區顯示「Not enough data · Needs ≥ 3 months (2 in range)」。

> 2026-11-15 更新：最少步數降到各統計量能定義的最小樣本（例如 t 檢定 2、迴歸與 Mann–Kendall 3、累積異常 1），讓 Days／Weeks 視窗下 7 天甚至 1 天的選取也能分析。樣本小時信賴區間很寬、p 值偏大，結果卡會顯示 n。需要範圍外資料的工具（比較、變異、極端、相似、預測、孤立林）仍受範圍外資料量限制；日資料只抓選取的日期，因此在日／週步數下多半不可用。表中按鈕名稱是原分支的中文名稱；新介面的英文標籤見 §2。

### 機器學習工具（非 LLM）

> 來自 commit ffa750c。下表按鈕名稱是原分支的中文名稱；新介面的英文標籤是 Similar、States、Forecast、Rare、Isolation、Change pts、Smooth。

全部是傳統、非監督式的方法：只用這一條序列本身擬合，不需要訓練資料、伺服器或 API key；有隨機性的地方都用固定種子，同一範圍每次結果相同。程式在 [`web/lib/detective/ml.ts`](../web/lib/detective/ml.ts)。每條序列只有約 300 個月，深度學習或拿隨機森林做預測都會過度擬合，所以選擇這個規模的方法。

| 按鈕 | 方法 | 回答的問題 | 輸出 | 最少步數（月／週／日） |
| --- | --- | --- | --- | --- |
| 相似 | 最近鄰搜尋（RMS 距離）＋ DTW | 過去哪段走勢最像這段？之後發生了什麼？ | 前 3 個不重疊的相似期間（數線上編號標出）、距離、形狀相關、之後 h 個月平均、DTW 排名 | 3 |
| 狀態 | 高斯隱藏馬可夫模型，2 或 3 個狀態以 BIC 選擇 | 什麼時候進入偏乾／偏濕狀態、持續多久？ | 各狀態平均、標準差、比例、平均持續時間；每月狀態機率；最長偏低／偏高期（數線底色） | 6 |
| 預測 | AR(p)，p = 1–6 以 AIC 選擇，只用範圍之前的資料訓練 | 從之前的資料看，這段是可預期的還是意外？ | 預測線與 95% 預測區間（數線與小圖）、區間外月數、平均誤差、整段誤差的 z 與 p | 1（且範圍前約 3 年資料） |
| 罕見 | 矩陣剖面（非標準化歐氏 RMS，排除區 = 片段長） | 這段裡哪 3／6／12 個月最獨特？哪兩段幾乎重複？ | 各長度的最罕見片段與最相似的一對、6 個月的矩陣剖面圖 | 3 |
| 孤立林 | Isolation Forest，200 棵樹、每棵抽 256 個月 | 哪些月份（含前幾個月的組合）最異常？ | 每月異常分數、全紀錄前 3% 的月份（數線標出） | 1（全紀錄 36） |
| 貝氏 | 貝氏線上轉折偵測（Adams & MacKay 2007），Normal–Gamma 先驗，平均 60 個月換一次 | 水準在哪些時間點改變？可以有多個 | 每月「新狀態開始」機率、轉折月份與機率、各段平均（數線階梯線） | 3 |
| 平滑 | 高斯過程迴歸，RBF 核，尺度 6–48 個月與訊號占比以邊際概似選擇 | 扣掉逐月雜訊後，哪些期間明確偏離正常？ | 平滑曲線與 95% 不確定帶（數線與小圖）、帶子整段在 0 以上／以下的期間 | 4 |

細節：

- **相似**：候選期間不能和這段重疊（起點相差 ≥ 範圍長度），雙方都有值的月份至少 70%；前 3 名彼此也不重疊。DTW 用 Sakoe–Chiba 帶寬 15%，只在雙方都沒有缺值時計算。「一般差距」是所有候選期間距離的中位數。
- **狀態**：Baum–Welch（縮放的前向後向演算法），缺值月份的發射機率設為 1；初始平均取分位數；標準差下限為整體的 5%，避免某狀態塌縮。狀態依平均排序，路徑用 Viterbi。3 個狀態只在至少 60 個有值月份時嘗試。
- **預測**：AIC 比較時所有 p 用同一組資料列；選定後重新擬合。預測時範圍前的缺值以模型平均補上。預測區間用 ψ 權重：第 h 步變異數 σ²Σψ²。整段檢定：所有有值月份的誤差加總，其變異數 σ²Σ_u(Σ_{h≥u}ψ_{h−u})²，雙尾常態 p（計入多重檢定紀錄）。
- **罕見**：用不標準化的距離，所以「罕見」同時考慮形狀與大小；候選片段在範圍內，比較對象是整段紀錄。沒有 p 值。
- **孤立林**：特徵＝當月異常、近 3 月平均、近 6 月平均、近 6 月標準差、與上月的差；需要該月與前 5 個月都有值。分數 `2^(−E[h]/c(ψ))`。
- **貝氏**：資料先以範圍內平均與標準差標準化。某月的轉折機率＝3 個月後的後驗中「目前狀態從該月開始」的機率；因為時間點本身有一兩個月的不確定，判斷時加總前後各 1 個月，超過 50% 且彼此相隔 ≥ 6 個月才列為轉折。
- **平滑**：資料先標準化；格點為尺度 {6, 12, 24, 48}（不超過範圍一半）× 訊號占比 {0.2, 0.5, 0.8}。最短 6 個月是刻意的：更短的尺度只會重描逐月雜訊（台灣例子中資料原本選了 3 個月）。

### 多重檢定紀錄

同一個範圍按 Analyse 跑過兩個以上有 p 值的工具後，結果下方會出現一行可展開的紀錄：「n tests on this range · k with p < 0.05 · x expected by chance」。展開後每個工具一列：符號＋狀態文字（● holds after Holm＝經 Holm 逐步修正後仍顯著；◐ significant before correction only＝單看顯著但修正後不顯著；○ not significant）。不以顏色區分。換範圍（或換變數、換產品）時紀錄重設。每個工具計入紀錄的 p 值見 `primaryP()`（比較取 Welch、拔靴取斜率、連續取「依持續性」模擬、自相關取 Ljung–Box；預測取整段誤差檢定；累積、週期與其他機器學習工具沒有單一 p 值，不計入）。


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

統計（`web/lib/detective/lab.ts` 與 `ml.ts`，來自 `feat/analysis-lab`，未修改統計）：

- `runLabTool(tool, d, start, end)`：唯一入口，回傳 `{ kind: "ok", stats, segments, bands? }` 或 `{ kind: "insufficient", n, need, note? }`。`segments` 是要畫在殘差圖上的線段（月份索引、殘差單位）；`bands` 是月份區段的底色（`tone`：cool／warm／focus／ink，`label`）；`note` 是機器學習工具資料夠月數但仍無法執行的原因（中文，新介面改用 `COPY.lab.ml.note` 的英文）。機器學習工具由 `runLabTool` 轉給 `ml.ts` 的 `runMlTool`。
- 各檢定也可單獨呼叫：`olsTest`、`mkTest`、`meanTest`、`wilcoxonTest`、`compareTest`、`pettittTest`、`acfTest`、`normalityTest`、`bootstrapTest`、`piecewiseTest`、`permutationTest`、`varianceTest`、`monthlyTest`、`cusumTest`、`runsTest`、`extremesTest`、`spectrumTest`；機器學習工具在 `ml.ts`：`analogSearch`、`hmmRegimes`、`arForecast`、`matrixProfile`、`isolationForest`、`bocpd`、`gpSmooth`。
- `LAB_GROUPS` 定義分組與順序；`LAB_MIN_N` 最少月數；`BASELINE_SENSITIVE`、`baselineShare` 供基準期警告；`primaryP()` 與 `holm()` 供多重檢定紀錄。

介面（`web/components/detective/workbench/lab/`，所有文字在 `workbench/copy.ts` 的 `COPY.lab`，英文）：

- `tests.ts`（純函式）：群組（`GROUPS`、`testsIn`、`groupOf`，依 `LAB_GROUPS`）、`availability()`（每個工具是否有足夠月數；Vs rest 與 Spread 另需範圍外 ≥ 12 個月；Forecast 另需範圍前約 3 年連續資料）、`pickInGroup()`、`slopeScale()`（/decade 或 /yr）、`overlayFor()`（線段、Pettitt 轉折月、底色 `bands` 與圖例項目，並把中文標籤換成英文）、`testLog()`（`primaryP` ＋ `holm` → holds / uncorrected-only / not-significant）、`analyseMs()`（進度條長度）、`staleReason()`（結果是否過期）。
- `icons.ts`：每個工具的 24 × 24 線條圖示路徑。
- `format.ts`（純函式）：`resultView(stats, ctx)` 把一個工具的統計轉成結論、關鍵數字、Details 列、方法說明、要畫的圖與（機器學習工具的）一行說明 `caveat`。
- `useLabRun.ts`：`useLabAnalysis(lane, sel, test, whole)` 回傳目前範圍的可用性、`analyse()`（進度條後執行 `runLabTool`）、最後一次結果（`LabRun`，含疊線、基準期警告、多重檢定紀錄）與過期原因。紀錄以「產品＋範圍」為鍵，範圍改變即重設。
- `TestsPanel.tsx`：範圍標題、Whole record、分組圖示按鈕、Analyse 與進度條、過期提示、結果；`LabControl`（`test`、`whole`、`onTest`、`onWhole`）由 `AnalysisView` 保存，所有變數共用。
- `ResultCard.tsx`（結論、數字、圖、說明、Details、紀錄）、`figures.tsx`（純 SVG、只用色彩 token）、`overlay.tsx`（`LabOverlayMarks` 線段與轉折線、`LabBandMarks` 底色、`BandLegend` 圖例項目）。
- 掛載點：`AnalysisView.tsx` 保存 `test`（URL）與 Whole record 並傳入 `lab`；`Lanes.tsx` 的 `ExpandedLane` 呼叫 `useLabAnalysis`，在圖例下方放 `<TestsPanel>`、把結果的 `overlay` 傳給 `LaneChart`；`LaneChart.tsx` 在所有圖層畫 `LabBandMarks`、在 Anomaly 圖層畫 `LabOverlayMarks`，`Lanes.tsx` 的圖例列在有底色時加上 `BandLegend`；`web/lib/detective/url.ts` 的 `test` 參數（`TEST_IDS` 與 `LAB_TOOLS` 相同）。

## 6. 測試

從 `web/` 執行：

```bash
npx tsx --test lib/detective/lab.test.ts lib/detective/ml.test.ts
```

機器學習工具的測試（`ml.test.ts`，來自 ffa750c）在合成資料裡埋入已知結構，檢查方法能找回來：相似搜尋找到埋入的重複形狀、HMM 還原乾濕區塊（> 95% 月份正確）、AR 估回係數且把埋入的跳升判為意外、矩陣剖面找到埋入的怪片段、孤立森林標出埋入的極端月份、BOCPD 在埋入位置 ±2 個月內找到轉折、GP 平滑誤差小並標出明確偏高的期間。

參考值來自 scipy 1.18（`linregress`、`ttest_1samp`、`wilcoxon`、`ttest_ind(equal_var=False)`、`mannwhitneyu`、`jarque_bera`、`kruskal`、`chi2.sf`、`f.sf`、`binomtest`）。測試資料的 lag-1 相關 < 0，因此修正不啟動，結果必須和教科書檢定完全一致。另外測試：自相關修正會使 p 值變大、Ljung–Box 偵測 AR(1)、Pettitt 找到階梯位置、拔靴結果可重現、`runLabTool` 的資料不足與線段範圍；累積虧損位置、最長連續與「持續性使連續較不罕見」、極端月份計數、變異變大、週期圖在有缺值時找到 40 個月週期、分段迴歸找到轉折與兩段斜率、整塊打亂比逐月打亂保守、Holm 修正。

目前 `npx tsx --test lib/detective/*.test.ts components/detective/*.test.ts app/api/select-variables/*.test.ts` 共 300 個測試通過，`tsc --noEmit` 無錯誤；已在本機 dev server 以台灣 2021 大旱預設事件截圖檢查各群組、亮暗主題與 390 px 手機版面。

介面的純函式測試：

```bash
npx tsx --test components/detective/lab-ui.test.ts lib/detective/url.test.ts
```

涵蓋：分組（五組、7 個機器學習工具）與 `LAB_GROUPS` 一致、英文標籤、可用性與原因（含 Forecast 的訓練月數）、/decade 與 /yr、疊線（分段兩段、Pettitt 轉折月）、每個工具都有英文結論與 1–4 個數字（機器學習工具另有一行說明、底色與圖例、不含中文）、uncorrected／optimistic 標記、CUSUM 無 p 值、多重檢定紀錄（排除描述性工具、Holm 三種狀態）、進度條長度與 reduced motion、過期判斷、每個工具都有圖示、URL `test` 參數。

## 7. 已知限制與後續

- 「Vs rest」中 Welch（已修正）與 Mann–Whitney（未修正）可能結論不同，例如台灣大旱 4 個月事件：Welch p = 0.12、U 檢定 p = 0.008。結論句以 Welch 為準，並註明「Mann–Whitney disagrees.」。
- 只有 4 個月的事件，t test 用範圍內 4 個值估 lag-1 相關，有效樣本常降到下限 3，p 值會比統計面板（用基準期的 AR(1)）保守得多；兩者回答的問題不同。
- `runLabTool` 回傳的 `what` 是中文字串，新介面不使用。
- 機器學習工具多半沒有 p 值，是「找線索」的工具；相似期間不代表原因相同，HMM 的狀態也不是官方乾旱定義，介面上都有註明。高斯過程平滑最慢（全時段約 0.5 秒），只在按 Analyse 後計算。
- 多重檢定紀錄只涵蓋同一個變數、同一個範圍；跨變數的多重比較未處理。
- 可考慮加入：季節 Mann–Kendall（逐月趨勢）、跨變數的相關與延遲相關。
