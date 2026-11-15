# 選變數評估：10 個測試事件

日期：2026-11-15。機器：Ryzen 5 7640U 筆電，13 GiB RAM，只有 CPU（無 GPU）。
重跑方式見 [README.md](README.md#重跑評估)。原始機率在 `results/*.json`。

## 方法

- 每個事件對 12 個類別各問一題 `noul`（是／否）：「Is this event related to 〈淺白定義〉?」（`selector.py` 的 `en` 問法）。
  state 為 `A student wants to study this Earth event with NASA satellite data: 〈事件〉`。
- 人工判斷：我們認為衛星資料中應該看得到異常、值得預先勾選的類別。這是一個人的判斷，不是標準答案。
- 分數：每個事件用預先勾選集合對人工判斷算 F1，再取平均。另算 AUC（所有事件與類別的機率能否把「有關」排在「無關」之前，0.5 = 隨機）。
- 參考線：全部 12 類都勾，平均 F1 = **0.51**。

### 偏差說明

**關鍵字表是對照這 10 個事件寫的。** 下面的「關鍵字表 v1」是第一次跑評估時的版本，當時已經看過事件清單，但還沒看過結果。之後依結果加了 `lake-level` 規則，又加了「大水」，所以目前的表（v2）在這 10 個事件上 F1 = 0.91，這個數字偏高。模型完全沒有針對這些事件調整過。

## 結果

粗體 = 符合人工判斷，~~刪除線~~ = 人工判斷中沒有的類別。每個模型的門檻取自 `serve.py`。

| 事件 | 人工判斷 | OneJev 0.8B（p ≥ 0.5） | jev-style 0.8B（p ≥ 0.3） | Phocinae 150M（p ≥ 0.5） | 關鍵字表 v1 | route（關鍵字優先，v1 表） |
|---|---|---|---|---|---|---|
| 2021 台灣春季大旱 | precip, soil, tws, ndvi | **precip**, ~~et~~, **soil**, **tws**, ~~runoff~~, ~~tair~~, ~~vpd~~, ~~energy~~ | ~~et~~, **tws**, ~~vpd~~, ~~energy~~ | ~~tair~~, ~~wind~~, **ndvi** | **precip**, **soil**, **tws**, **ndvi** | **precip**, **soil**, **tws**, **ndvi** |
| 2022 Pakistan floods | precip, soil, tws, runoff | **precip**, **tws**, **runoff** | **runoff** | **soil**, ~~tair~~, ~~wind~~, ~~ndvi~~ | **precip**, **soil**, **tws**, **runoff** | **precip**, **soil**, **tws**, **runoff** |
| 2003 European heatwave | soil, tair, vpd, energy | ~~et~~, ~~tws~~, **tair**, **vpd**, **energy**, ~~sst~~ | **tair**, **energy** | **soil**, **tair**, **energy**, ~~wind~~, ~~ndvi~~, ~~sst~~ | **soil**, **tair**, **vpd**, **energy** | **soil**, **tair**, **vpd**, **energy** |
| 2019–20 澳洲黑色夏季野火 | precip, soil, tair, vpd, ndvi | ~~et~~, ~~energy~~ | ~~energy~~ | **precip**, **soil**, **tair**, ~~wind~~, **ndvi** | **precip**, **soil**, **tair**, **vpd**, ~~wind~~, **ndvi** | **precip**, **soil**, **tair**, **vpd**, ~~wind~~, **ndvi** |
| 2021 年 2 月德州暴風雪 | precip, snow, tair | **precip**, ~~et~~, ~~tws~~, ~~runoff~~, ~~energy~~ | **precip**, ~~energy~~, ~~wind~~ | **tair**, ~~wind~~, ~~ndvi~~ | **precip**, **snow**, **tair**, ~~wind~~ | **precip**, **snow**, **tair**, ~~wind~~ |
| 2013 typhoon season in the Philippines | precip, runoff, wind, sst | **precip** | — | ~~ndvi~~ | **precip**, **runoff**, **wind**, **sst** | **precip**, **runoff**, **wind**, **sst** |
| 2015–16 El Niño | precip, tair, sst | **precip**, ~~et~~, ~~tws~~, ~~runoff~~, **tair**, ~~vpd~~, ~~energy~~, **sst** | **sst** | **precip**, ~~soil~~, **tair**, ~~energy~~, ~~wind~~, ~~ndvi~~ | **precip**, **tair**, **sst** | **precip**, **tair**, **sst** |
| Lake Mead fell to a record low water level in 2022 | precip, tws, runoff, snow | **precip**, **tws**, **runoff** | **tws** | ~~tair~~, ~~ndvi~~ | **precip**, ~~tair~~（無命中，預設值） | **precip**, **tws**, **runoff**（模型） |
| 2012 US Corn Belt crop failure | precip, soil, tair, vpd, ndvi | **soil**, ~~energy~~ | — | **soil**, ~~wind~~, **ndvi** | **precip**, **soil**, **ndvi** | **precip**, **soil**, **ndvi** |
| 2022 長江流域夏季乾旱與熱浪 | precip, soil, tws, runoff, tair, vpd | ~~et~~, **tws**, **tair**, **vpd**, ~~energy~~, ~~sst~~ | **vpd**, ~~energy~~ | **precip**, **soil**, **tair**, ~~energy~~, ~~wind~~, ~~ndvi~~ | **precip**, **soil**, **tws**, **tair**, **vpd**, ~~energy~~, ~~ndvi~~ | **precip**, **soil**, **tws**, **tair**, **vpd**, ~~energy~~, ~~ndvi~~ |
| **平均 F1** | | 0.48 | 0.28 | 0.37 | 0.86 | **0.91** |

### 各模型與問法

`eval.py --summary results/*.json` 的輸出。「最佳 F1」是在 0.20–0.90 間掃描門檻後最好的結果。最佳門檻落在 0.20 時，幾乎等於全部勾選（參考線 0.51）。

| 模型 | 問法 | AUC | F1 @ 0.5 | 最佳 F1（門檻） | 延遲中位數／最大 |
|---|---|---|---|---|---|
| OneJev1.6-0.8B Q4_K_M（llama.cpp） | en | 0.68 | 0.48 | 0.57（0.20） | 2.9 s／5.2 s |
| | zh（SPEC 原句） | **0.69** | 0.38 | 0.54（0.20） | 2.9 s／6.2 s |
| | en-unusual | 0.62 | 0.51 | 0.52（0.35） | 3.3 s／5.0 s |
| | en-affects | 0.61 | 0.55 | 0.55（0.50） | 2.7 s／5.3 s |
| Jev-Style-0.8B-Decision-v3（torch, CPU, fp32） | en | **0.73** | 0.08 | 0.36（0.20） | 7.4 s／10.0 s |
| | zh | 0.64 | 0.00 | 0.24（0.25） | 7.4 s／8.8 s |
| | en-unusual | 0.61 | 0.04 | 0.49（0.20） | 8.4 s／9.1 s |
| Phocinae-Largha-150M-v1（torch, CPU） | en | 0.60 | 0.37 | 0.52（0.30） | 0.6 s／0.8 s |
| | zh | 0.43 | 0.28 | 0.51（0.35） | 0.3 s／0.3 s |
| | en-unusual | 0.60 | 0.52 | 0.52（0.50） | 0.4 s／0.5 s |

我們也試過每個類別減掉該類別在其他事件上的平均 logit（leave-one-out，修正 OneJev 對 `energy`、`tws`、`et` 普遍偏高的問題）。AUC 只提高到 0.70–0.72，F1 最多 0.67，仍明顯低於關鍵字表，所以沒有採用。

### 觀察

- **三個模型都無法單獨勝任。** 最好的 AUC 是 0.73，只比隨機好一些。OneJev 對每個事件都偏好 `energy`、`tws`、`et`；jev-style 的機率整體偏低（p ≥ 0.5 幾乎都不勾）；Phocinae 每類都接近 0.5。
- **Phocinae 的官方 HTTP 伺服器會丟掉題目文字。** `phocinae-server` 0.1.8 的 `Question` schema 沒有 `instructions` 欄位，pydantic 會直接丟掉它，所以 12 題都用同一個預設問句，每類機率一模一樣（`results/broken/`）。我們改用它 README 介紹的程序內 `Engine`（`phocinae_serve.py`）重跑。題目有讀進去之後，結果仍接近平的。
- **jev-style 在這台 CPU 上太慢。** 7–10 秒，超過 5 秒逾時，實際上永遠會退回關鍵字表。
- **OneJev 是唯一同時在 5 秒內、又有一些鑑別力的。** 它在關鍵字表沒有涵蓋的說法上確實有用（見下節）。

### 表外說法的抽查

這些事件不在上面 10 個之中，事件文字裡也沒有關鍵字表的詞。以下列出 OneJev 機率 ≥ 0.5 的類別：

| 事件 | OneJev（p ≥ 0.5） | 關鍵字表 |
|---|---|---|
| The Aral Sea has been shrinking since the 1960s | tws 0.85, et 0.55 | 無命中 |
| 1998 長江大水 | runoff 0.90, precip 0.88, tws 0.82 | 無命中（之後加了「大水」） |
| Rhine river barges stranded in 2018 | runoff 0.63, tws 0.56 | runoff |
| Cape Town Day Zero 2018 | precip, et, tws, ndvi, energy, runoff, sst, vpd（8 類，太多） | 無命中 |
| 2010 Russian summer | energy, sst, et, runoff, precip, tws, vpd（沒有 tair，錯） | 無命中 |

## 決定

- **模型：OneJev1.6-0.8B（Q4_K_M GGUF，llama.cpp，CPU）**，問法 `en`，門檻 0.5。理由：
  1. 三個候選中，只有它在這台 CPU 筆電上通常能在 5 秒內回應（中位數 2.9 s）；
  2. 它的 AUC 和 jev-style 差不多，遠好於 Phocinae；
  3. 權重已經在本機（`ActivityWatch-Decision/poc/models`），不用額外下載 1.5 GB。
- **（後來的決定：不採用，改回由模型決定勾選，見 README。）原本提議的預先勾選規則：關鍵字優先。** 模型可用時，關鍵字表有命中就勾關鍵字表的類別，沒有命中才勾模型 p ≥ 0.5 的類別。機率條一律顯示模型的 p。在這 10 個事件上，這個規則的 F1 為 0.91：只有 Lake Mead 和 v1 表不同，模型把它從 0.33 提高到 0.86。這只是 1 個事件的差異，證據很薄，但方向合理：關鍵字表命中時很準，模型負責補上表外的說法。
- 模型不可用或逾時 5 秒 → `keyword-fallback`（與規格相同）。
