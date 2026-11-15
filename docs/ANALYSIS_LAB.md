# 分析工具（Analysis Lab）

> 分支：`feat/analysis-lab`。更新日期：2026-11-15。
> 程式：[`web/lib/detective/lab.ts`](../web/lib/detective/lab.ts)（統計）、[`web/components/detective/LabPanel.tsx`](../web/components/detective/LabPanel.tsx)（介面）、[`web/lib/detective/lab.test.ts`](../web/lib/detective/lab.test.ts)（測試）。

## 1. 目的

挑戰頁要求「計算變化速率，並用 t 檢定、Mann–Kendall 或信賴區間檢驗顯著性」。原本 `/detective` 只在**全期間**做一次長期趨勢（`trendStats`），數線上拖曳選取只顯示平均異常、z、百分位。

這次在每個變數分頁加入一排**分析工具按鈕**：選一段時間，按一個圖示，就對該變數的**殘差序列**（原始值 − 季節循環 − 長期趨勢，也就是 `Decomposition.residual`）做對應的檢定。學生可以把它當成資料分析的遊樂場。

## 2. 使用方式

1. 開啟任一分析分頁，例如 `/detective/?e=…&t=2021-02..2021-05&r=b4-4040046370&v=precip,soil,tws,ndvi&pad=12&tab=soil`。
2. 在數線下方的「分析工具」面板選擇範圍：
   - **選取區間**：數線上按住 Shift 拖曳（或開啟「選取」）選出的範圍；選取後自動切換到此項。
   - **事件期間**：目前設定的事件 T。
   - **全時段**：整段資料。
3. 按一個工具圖示；再按一次可關閉。改變範圍時結果即時更新。
4. 若工具有擬合線（迴歸、MK、平均、轉折…），會疊在**殘差圖層**上；在其他圖層時面板會提供「切換到殘差」連結。

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

每個結果都附一句白話結論與「顯著／不顯著（α = 0.05）」標籤。月數不足時顯示「資料不足」與需要的月數。

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
- 新增 `chiSquareSf`（卡方右尾，正則化不完全 gamma 函數）於 [`web/lib/stats.ts`](../web/lib/stats.ts)，供 Ljung–Box 使用。

## 5. 程式結構

- `runLabTool(tool, d, start, end)`：唯一入口，回傳 `{ kind: "ok", stats, segments }` 或 `{ kind: "insufficient", n, need }`。`segments` 是要畫在殘差圖上的線段（月份索引、殘差單位）。
- 各檢定也可單獨呼叫：`olsTest`、`mkTest`、`meanTest`、`wilcoxonTest`、`compareTest`、`pettittTest`、`acfTest`、`normalityTest`、`bootstrapTest`。
- `VariableTab` 保存目前工具與範圍來源，計算結果後把 `segments` 傳給 `SeriesChart` 的新屬性 `overlay`（只在殘差圖層繪製）。
- `LabPanel` 只負責顯示：工具按鈕、範圍切換、結果表、ACF 圖與直方圖（純 SVG，無新相依套件）。

## 6. 測試

從 `web/` 執行：

```bash
npx tsx --test lib/detective/lab.test.ts
```

參考值來自 scipy 1.18（`linregress`、`ttest_1samp`、`wilcoxon`、`ttest_ind(equal_var=False)`、`mannwhitneyu`、`jarque_bera`、`chi2.sf`）。測試資料的 lag-1 相關 < 0，因此修正不啟動，結果必須和教科書檢定完全一致。另外測試：自相關修正會使 p 值變大、Ljung–Box 偵測 AR(1)、Pettitt 找到階梯位置、拔靴結果可重現、`runLabTool` 的資料不足與線段範圍。

目前 detective 全部 125 個測試通過，`tsc --noEmit` 無錯誤；已在本機 dev server 以台灣 2021 大旱預設事件手動檢查各工具與選取流程。

## 7. 已知限制與後續

- 「比較」中 Welch（已修正）與 Mann–Whitney（未修正）可能結論不同，例如台灣大旱 4 個月事件：Welch p = 0.12、U 檢定 p = 0.008。結論句以 Welch 為準。
- 工具選擇與範圍不寫入 URL，重新整理後會重設。
- 可考慮加入：季節 Mann–Kendall（逐月趨勢）、分段迴歸、置換檢定、對多個變數同時檢定時的多重比較修正。
