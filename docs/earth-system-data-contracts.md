# Aqua Trend 資料與 API 契約

本文件是 [系統技術規格](earth-system-trend-detective-spec.md) 的介面參考，供資料、後端與前端實作共同使用。以下 JSON 為欄位示意，不是已計算的科學結果。

## 1. 共同約定

- 所有資料資產使用穩定 ID 與不可變版本；資料更新建立新版本，不覆寫舊研究的來源意義。
- 空值使用 JSON `null`，零是有效數值。API 不輸出 `NaN`、`Infinity` 或以零填缺值。
- 月序列使用 `YYYY-MM`；使用者期間的起訖月份皆包含在範圍內。事件保留來源的時間精度：若有精確時間，使用帶時區的 ISO 8601；只有年／月／日的紀錄保留原精度，不能補出虛構的時分秒。另保存原資料日曆／聚合政策。
- 資料已完成上游空間與時間處理。讀取 Adapter 可以展開 `start + values` 成明確月份，但不能於研究查詢中下載原始資料、重新格網化或任意拼接產品。
- 未支援的日曆、單位、資料型態或解析度回傳明確狀態，不能默默當成一般 Gregorian 月資料。
- 所有時間區間均須註明用途：user request、preset resolution、comparison、actual support 或 baseline。

## 2. 資料發布 manifest

| 欄位 | 必要語意 |
| --- | --- |
| `dataset_version` | 此次已備資料快照 ID。 |
| `catalogue_version` | 物理概念、產品、說明、角色及來源目錄版本。 |
| `region_catalogue_version` | 前端選區 ID 與幾何版本。 |
| `series_index` | 區域／產品對應的已備序列位置與涵蓋摘要。 |
| `event_catalogues` | 已備事件資料集或待補狀態，以及各自涵蓋紀錄位置。 |
| `indicator_registry_version` | 既有科學指標定義與實作版本。 |
| `baselines` | 已登錄固定參考期與建立規則。 |
| `quality_policy_version` | 資料適用性與推論門檻版本。 |
| `asset_status` | 每項為 `ready / pending / invalid`，列缺少欄位與原因。 |

服務啟動／資料發布時驗證 manifest，問題精確定位到資產；個別事件資料待補不應讓有效月序列無法讀取。規格與程式介面可先完成，資料方之後按同一契約交付。

## 3. 區域

`region_id` 必須是既有前端區域目錄中的一個 ID。可包含流域、子流域、命名研究區、海域、冰蓋及既有網格區域；區域層級沿用現有資料。

必要欄位為 `id`、`name`、`type`、`geometry_ref`、`geometry_version`；可附 `centroid`、`bbox`、`area_km2`、海陸屬性及來源。`series_available` 或每產品可用性來自實際索引，不能從地圖可點選推定有序列。

搜尋地名只在此目錄中定位選項，最終輸出一個 ID。沒有序列的選項需提示；使用者仍選定時保留原 ID 並回報不足，不自動換鄰區或父區。事件的區域對應亦須由已備資料提供，查詢不重新建立地理邊界。

## 4. 物理變數概念與產品

### 4.1 VariableConcept

| 欄位 | 語意 |
| --- | --- |
| `variable_id` | AI 可選的穩定物理概念 ID，例如 `precip`。 |
| `label`、`description` | 給人及模型讀取的名稱、定義及離線科學說明。 |
| `quantity_definition` | 物理量、存量／通量／狀態、深度／高度、觀測或模型性質。 |
| `unit`、`temporal_support` | 單位與平均、累積或瞬時等時間語意。 |
| `data_kind` | 連續量、計數、指標、分類或靜態背景；決定可否估計時間趨勢。 |
| `scientific_refs` | 可引用來源 ID、標題、URL／DOI、適用敘述及離線整理版本。 |
| `phenomenon_context` | 與哪些現象及何種角色有已整理的關係，包含適用限制。 |
| `approved_product_ids` | 明確核可的產品清單及優先順序。 |
| `baseline_ref` | 固定參考期／季節基準定義。 |
| `display_semantics` | 單位、色彩、趨勢標籤及可用視覺通道。 |

角色為 `core_indicator / related_condition / response`，選擇理由需指向目錄敘述。指標本身可另外由第 7 節配方提供，不能因角色名稱就假定已存在觀測事件。

### 4.2 Product

產品至少有 `product_id`、`variable_id`、機構、產品名、版本、來源引用、單位、物理定義、原生解析度、已備解析度、時間支援、品質限制及序列涵蓋。

備選等價性由離線目錄審定，不由模型猜測。單位可換算仍不足以證明定義相同，例如不同土層深度不能直接替代。必要的科學單位換算須是已核可規則並記錄公式；資料讀取不能任意改變物理意義。

產品決策結果必須包含：

| 欄位 | 語意 |
| --- | --- |
| `selected_product_id` | 此概念整段分析採用的一個產品。 |
| `priority_rank` | 在核可順序中的順位。 |
| `fallback`、`fallback_reason` | 是否切換、主產品及更高順位產品不適用的原因。 |
| `available_period` | 該產品在此區域的資料邊界。 |
| `coverage`、`quality_flags` | 此次條件的實際有效涵蓋與品質。 |
| `status` | 適用、缺資料、基準不足或其他明確狀態。 |

同一研究的同一物理概念維持單一產品。下游配方若需要較長基準，需在產品決策前宣告要求；不可等得到不滿意的結果後再換來源。

## 5. 已備時間序列與固定基準

### 5.1 PreparedSeries

```json
{
  "region_id": "named-taiwan-main-island",
  "variable_id": "precip",
  "product_id": "p_imerg",
  "dataset_version": "example-release",
  "cadence": "monthly",
  "calendar": "gregorian",
  "unit": "mm/day",
  "temporal_support": "monthly_mean_rate",
  "times": ["2020-01", "2020-02", "2020-03"],
  "values": [null, null, null],
  "quality_flags": ["example_only", "example_only", "example_only"]
}
```

正式序列需另外提供實際空間涵蓋、必要的來源／轉換說明及基準參照。若既有 series-2 使用 `start` 加 `values`，Adapter 可保留原值展開時間軸。`values`、時間及品質旗標長度必須一致且時間有序，重複時間須在資料發布時解決。

### 5.2 Baseline

固定基準需包含 `baseline_id`、`version`、`start`、`end`、`rule`、`minimum_samples`、每季節位置的有效樣本數、實際資料支援及科學／方法來源。基準參數可事先計算，也可由相同快照計算後快取；對同一版本必須一致。

`seasonal_reference` 與 SPI 等指標的 `calibration_reference` 可以有不同科學要求，必須分別命名與公開。它們都不能隨查詢期間變動。任何較短替代基準須在離線版本中明確登錄，不能在查詢時悄悄降低配方要求。

## 6. 實際事件與涵蓋

### 6.1 RecordedEvent

| 欄位 | 語意 |
| --- | --- |
| `event_id` | 資料集內穩定 ID；用於去重。 |
| `phenomenon_id`、`definition_ref` | 事件類型及資料集採用的事件定義。 |
| `region_ids` | 已準備好的既有區域對應；同一事件在單區分析中只計一次。 |
| `start`、`end` | 起訖與時間精度；尚未結束可 `end: null` 並標記。 |
| `time_precision`、`time_bounds` | 各端點的年／月／日／時間精度及不確定區間；粗精度紀錄的持續時間使用區間或明確不足狀態。 |
| `metrics` | 嚴重度等量值，各自帶單位及定義；沒有嚴重度仍可保留頻率用途。 |
| `source_ref`、`source_version` | 紀錄資料集來源與版本。 |
| `quality_flags`、`censoring` | 不確定起訖、左／右截尾、資料缺口、登錄品質等。 |

每個現象、區域與分析期間優先採用一份事先核可的事件目錄，依完整性及定義相容的優先序選擇，維持整段來源一致。多來源整合只有在上游已準備好 `canonical_event_id`、跨目錄映射及去重／涵蓋政策時，才能作為一份版本化整合目錄使用；不能直接把重複報導串接計次。

### 6.2 EventCoverage

事件資料集另提供區域、現象、起訖、完整性、已知缺口及登錄／偵測政策版本。完整性至少區分 `complete / partial / unknown`。

- 只有在 `complete` 的區域與期間內，無事件才可記零。
- `partial / unknown` 的空白不是零；頻率趨勢需標示不適用或採已核可的觀測／暴露模型。
- 個案窗口不等於完整歷史目錄。
- 同一事件跨分析邊界的計次、持續時間及年度歸屬依已登錄規則處理，保留截尾資訊。

目前缺少事件資料檔案時，提供 `data_pending` 資產狀態與結果 `data_required`；程式不得製造空目錄並把它當完整的零事件資料。

## 7. 標準指標配方

每份配方至少包含：

| 欄位 | 語意 |
| --- | --- |
| `indicator_id`、`version` | 已核可指標與實作版本。 |
| `phenomenon_applicability` | 指標對應的現象範圍及限制。 |
| `standard_refs` | 科學標準、原始文獻或權威計算文件。 |
| `required_variables` | 物理量、單位、最低時間／空間支援。 |
| `baseline_requirements` | 固定校準期、樣本與擬合要求。 |
| `computation` | 明確算法、核可轉換、參數及數值驗證資料。 |
| `event_rule` | 門檻、連續性、事件切分、結束及截尾規則，若適用。 |
| `aggregation` | 頻率、持續時間、嚴重度的年度或其他聚合與完整性要求。 |
| `interpretation` | 指標能／不能代表什麼，與實際事件紀錄的差別。 |

推算結果標記 `derived_indicator`，引用輸入產品與配方；實際事件統計標記 `recorded_event`，引用事件資料集。兩者的年度序列可進同一 TrendEngine，但使用符合資料型態的季節／推論政策。

任意現象若沒有適用的配方，仍可分析有依據的環境變數，現象指標部分回傳 `not_applicable` 或 `definition_required`。缺配方不能由 AI 現場補公式。

## 8. 選擇計畫、條件與 preset

`SelectionPlan` 保存 `selection_plan_id`、內容 hash、`phenomenon`、`variable_set`、`indicator_recipe_ids`、選取理由／目錄引用、目錄及模型／prompt 版本。`variable_set` 每項為合法 `variable_id` 加角色。計畫不包含由自然語言抽出的區域或期間。計畫一旦執行即固定，數值重播引用該計畫。

`UserConstraints` 只包含使用者透過選擇器指定的 `region_id` 與 `period`。`period` 若提供需包含合法的起訖；只填一端屬 `invalid_period`，由介面提示完成或清除整段選擇。

`ResolvedPlan` 另外保存實際區域、期間與各欄位來源。Preset 記錄至少有 ID、來源 `automatic / manual`、適用變數／指標、區域、期間、分數分項、推薦理由、資料／方法版本、候選集合與校正家族。

手動指定設定至少支援新增候選、釘選／優先度、停用及理由；可用版本化設定檔實作。設定修改建立新 preset 版本，所有研究仍通過相同有效性檢查。

## 9. API

| 方法與路徑 | 用途 |
| --- | --- |
| `GET /api/catalogue` | 概念目錄、可選區域、基準／配方索引、資料可用性與版本。 |
| `POST /api/research` | 驗證結構化條件並建立背景研究，回傳工作 ID。 |
| `GET /api/research/{id}` | 目前狀態、進度及可用結果。 |
| `DELETE /api/research/{id}` | 取消工作；未完成家族不產生最終校正結論。 |
| `GET /api/research/{id}/export?format=json\|csv` | 匯出同一結果快照及必要來源／方法資訊。 |

Preset 的批次建立及人工設定走離線／管理流程；一般使用者只觸發符合當次條件的查詢與必要背景工作。

### 9.1 建立研究

```json
{
  "phenomenon_query": "乾旱",
  "region_id": null,
  "period": null,
  "context": {
    "parent_research_id": null,
    "preset_ref": null
  }
}
```

完整期間格式為 `{"start":"2005-01","end":"2024-12"}`。區域為一個既有 ID。兩者皆可空，但文字模型不能填寫這兩個 request 欄位。

`region_id` 與 `period` 只承載使用者自行選定的條件；顯示中的 preset 值不因此變成 user 值。`context` 由下列規則承接來源：

- 全新查詢兩個引用為空。開啟既有 preset 時傳入 `preset_ref: {id, version}`，後端載入該案例、計畫快照及搜尋家族，補空白項並保留來源。
- 在既有結果上調整條件時傳入 `parent_research_id`。前端只送真正的 user 條件；若更改現象或範圍而不再是原案例，清除綁定的 `preset_ref`，但保留父研究歷史。使用者明確沿用某欄位後，該欄位可作 user 條件送出。
- 指定 preset 與已填條件衝突時回傳 `invalid_context`，不得覆蓋 user 欄位。一般重新推薦依主規格第 8 節執行。
- 引用的計畫、版本、欄位來源與檢定家族由後端載入核實；不接受前端自行提供的校正數字或來源聲明。歷史引用不代表舊證據自動適用於已改變的假設。

建立成功回傳 `202` 及工作 ID、狀態、階段、完成數／總數。輸入錯誤為 `400` 或 `422`，模型／服務未設定或不可用可為 `503`。合法區域缺資料是研究結果狀態，不作未知區域或伺服器錯誤。

若已建立背景工作後才發生錯誤，`GET` 仍回傳該工作資源與 `failed / partial` 及錯誤代碼；不把工作中某個資料項不足變成整個 API 無法使用。

### 9.2 最終研究結果

| 區塊 | 必要內容 |
| --- | --- |
| `identity` | 研究 ID、建立時間、結果狀態、資料與方法版本。 |
| `user_constraints` | 原始結構化選擇及現象文字。 |
| `selection` | 現象、變數角色與理由、標準指標、模型／目錄版本。 |
| `resolved` | 單一區域、實際期間、user／preset 來源、preset 理由。 |
| `comparison` | 主要比較期間、適用變數、不可比較原因與實際樣本支援。 |
| `baselines` | 各序列／配方固定參考期、規則、有效樣本與版本。 |
| `variables` | 每個概念的產品決策、原始完整歷史、季節型態、距平、趨勢、品質與限制。 |
| `indicators` | 觀測或推算來源、標準定義、指標／事件結果、趨勢或缺資料原因。 |
| `evidence_families` | query／preset-search 家族、完整範圍、候選與已測數、方法、完成狀態。 |
| `summary` | 可查證的數值敘述及 evidence ID；不能增加未計算的事實或因果。 |
| `warnings` | 資料／基準／方法不足、選擇脈絡與部分結果說明。 |

每份序列結果保存 `requested_period`、`analysis_period`、`actual_support`、`full_history`，並明確標示作圖視窗與擬合區間。

每個有效趨勢至少回傳 `slope_per_year`、`slope_per_decade`、單位、CI、`interval_scope`、`p_raw`、各 scope 的 `p_adjusted`、`primary_family_id`、`significant`、方法／lag 政策、有效樣本數、涵蓋與診斷。推論不可用時 CI、p、significant 為 `null`，不可把它等同「不顯著」。

資料／指標狀態使用 `ok / data_required / insufficient_data / insufficient_baseline / not_applicable / definition_required / unsupported_resolution / no_common_period` 等明確代碼，附人可讀原因。工作狀態與各資料項狀態分開。

### 9.3 校正家族

家族保存 `family_id`、scope、預先宣告的候選政策、實際比較清單、有效 `hypothesis_id` 與 p 值、未檢定原因、校正方法、門檻及完成狀態。可用外部紀錄引用保存大清單，結果內需可定位並驗證版本。

`hypothesis_id` 至少包含區域 ID／幾何版本、分析期間、`metric_id`、變數／指標 ID、產品或事件目錄 ID、資料／涵蓋版本、基準 ID／版本、配方／聚合版本與方法政策版本。頻率、持續時間與嚴重度是不同 metric，不能因使用同一配方而去重成一個檢定。

從 preset 開啟或匯出時攜帶原搜尋家族；新查詢家族不得覆蓋它。只有完整假設及輸入快照匹配時，才能將既有搜尋校正附到重播的數值。資料、邊界、配方或方法版本改變時建立新證據；舊結果保留為歷史，不能把舊校正套到新數值。CI 是否 pointwise 與顯著性校正 scope 分開表示。

### 9.4 匯出與錯誤

JSON 匯出完整結果快照；CSV 採可辨識變數、產品、時間、原始／距平值及來源的格式，附能重現研究的計畫／方法資訊。畫面、CSV 與 JSON 的數值與範圍必須一致。

錯誤回傳穩定代碼、人可讀訊息、可否重試及相關欄位，保留使用者條件。Selector 的非法變數／配方 ID 不得穿透到引擎。摘要產生失敗時，有效數值結果仍可呈現並標示文字解釋暫不可用。
