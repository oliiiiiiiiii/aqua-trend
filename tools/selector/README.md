# tools/selector：本地 AI 選變數（工作線 D）

`POST /api/select-variables`（`web/app/api/select-variables/route.ts`）預設會把事件文字送到這裡的本地服務。服務對 17 個變數類別各問一題是／否，使用 `web/lib/detective/categories.ts` 的淺白定義，由本地開源的 System One 決策模型回答。本地模式不需要 API key；權重與 tokenizer 已備妥時可離線推論。明確選擇 `openai` 或 `systemone` 時，事件文字會送到設定的服務位址。

F 新增 `aod`、`ozone`、`vapor`、`so2`、`fire`。臭氧是整柱總量，火點是衛星偵測次數、不是燃燒面積；SO₂ 是年度大型點源排放，沒有月變化，前端不允許把它送進月度分析。變數推薦與資料可用性分開判斷，前端會排除區域沒有月資料的類別。更新後須重新啟動舊選變數服務；只回 12 類的舊服務會被判定為不完整並退回關鍵字備案。

- **選定模型：OneJev1.6-0.8B**（Q4_K_M GGUF，經 llama.cpp 在 CPU 上執行）。評估與理由見 [eval.md](eval.md)。
- **預先勾選規則：由模型決定。** 模型可用時，勾選 p ≥ 0.5 的類別，機率條顯示模型的 p。門檻沿用歷史 12 類設定；17 類尚未重跑模型或校準。評估時試過「關鍵字優先」但未採用，見 eval.md。
- **後端選擇：** 環境變數 `SELECTOR_BACKEND`，預設 `local`。也可以接線上 API，見下方「線上 API（選用）」。
- **備案：** 服務不存在、出錯或 5 秒內沒有回應 → route 回傳 `keyword-fallback`。模型關閉時實測約 0.03 秒回應。
- **部署：** 目前使用 Next.js standalone Node 服務，保留這個 POST route。純靜態網站沒有選變數 API；若另行製作靜態版本，前端呼叫失敗時會在瀏覽器呼叫 `keywordSelect()`。不要把 `output: "export"` 當成會自動略過 POST route 的部署方式。

```
瀏覽器 ──POST /api/select-variables/──▶ route.ts ──POST /select (5 s)──▶ serve.py :8770 ──/v1/systemone──▶ qev serve :8811 ──▶ llama-server（OneJev GGUF）
                                          └─ 失敗／逾時 → keywords.ts（keyword-fallback）
```

> 注意 `next.config.ts` 設了 `trailingSlash: true`：請 POST 到 `/api/select-variables/`（結尾有斜線）。不加斜線會收到 308 轉址。

## 線上 API（選用）

想用更強的模型時，不必改程式，設定環境變數即可（寫在 `web/.env.local`，此檔已被 gitignore；範例見 `web/.env.example`）。不綁定任何廠商，金鑰不可 commit。

| `SELECTOR_BACKEND` | 用途 | 需要的變數 |
|---|---|---|
| `local`（預設） | 本機 `serve.py` + OneJev，5 秒逾時 | `SELECTOR_URL`（預設 `http://127.0.0.1:8770`） |
| `openai` | 任何 OpenAI 相容的 `/chat/completions`：OpenAI、OpenRouter、Groq、Together、DeepSeek、自架 vLLM／Ollama… | `SELECTOR_OPENAI_BASE_URL`（預設 `https://api.openai.com/v1`）、`SELECTOR_OPENAI_MODEL`、`SELECTOR_API_KEY` |
| `systemone` | 任何 Jev 風格 `/v1/systemone` 端點（例如架在別台機器上的 OneJev／qev），每類別一題 `noul` | `SELECTOR_SYSTEMONE_URL`（完整網址）、選填 `SELECTOR_SYSTEMONE_MODEL`、`SELECTOR_API_KEY` |
| `keyword` | 不呼叫模型，只用關鍵字表 | — |

- 線上後端逾時預設且最多 5 秒（`SELECTOR_ONLINE_TIMEOUT_MS`，可設為 1–5000 毫秒）；失敗、逾時或回傳格式不符都退回關鍵字表。
- 回應的 `source` 為 `online-model`，前端要標示「線上模型」。
- `openai` 後端會送出 `response_format: { type: "json_object" }`，服務必須接受此參數。回應可為純 JSON 或單一 ```` ```json ```` 區塊，必須包含完整 17 類別與 0–1 的數值；不會把 `null`、字串或布林值轉成機率。
- 程式在 `web/app/api/select-variables/online.ts`。四種後端有離線自動測試，涵蓋請求、回應格式、錯誤與逾時；實際關閉本地連接埠的測試檢查 1 秒內備案。尚未用真實線上模型跑 eval，也未驗證上述每一家服務的相容性。
- 歷史 12 類 OneJev 評估在 10 個事件上的平均 F1 為 0.48；0.91 是已放棄的「關鍵字優先」規則。兩者都不能代表目前 17 類流程的分數；新增類別沒有人工標註或模型實測。歷史模型最慢一次超過 5 秒，屆時會退回關鍵字表。這份小樣本評估不是獨立測試集，詳見 [eval.md](eval.md)。

## 檔案

| 檔案 | 作用 |
|---|---|
| `selector.py` | 類別定義、問法、三種後端的請求與回應格式（只用標準函式庫） |
| `serve.py` | route 呼叫的本地 HTTP 服務（127.0.0.1:8770）：`POST /select`、`GET /health`，快取最近 256 個事件 |
| `start-onejev.sh` | 一次啟動 OneJev 模型伺服器與 `serve.py` |
| `phocinae_serve.py` | 只供評估用：繞過 `phocinae-server` 0.1.8 丟掉題目文字的問題（見 eval.md） |
| `eval.py` | 跑 10 個測試事件、彙整 AUC／F1／延遲 |
| `check-keywords.mts` | 關鍵字表與時間解析的快速檢查（`npx tsx tools/selector/check-keywords.mts`） |
| `check-contract.mts` | 比對 Python 與前端的類別順序、中英文定義 |
| `test_selector.py` | 三個 Python adapter 的離線契約測試與歷史評分相容性檢查 |
| `dump-keywords.mts` | 把歷史 10 個事件跑過目前關鍵字表，另存 `results/keywords-categories17.json`；不覆寫原始結果 |
| `results/` | 各模型、各問法的原始機率 |

## 安裝（一次）

需要 [uv](https://docs.astral.sh/uv/)、llama.cpp 的 `llama-server`（Arch：`pacman -S llama.cpp`，macOS：`brew install llama.cpp`）。

```sh
cd tools/selector
uv venv -p 3.12 .venv
# OneJev 的執行環境 qev：官方安裝方式是 pip install "qev @ git+https://github.com/OmniJev/OneJev.git"
VIRTUAL_ENV=.venv uv pip install "qev @ git+https://github.com/OmniJev/OneJev.git"
```

`.venv/` 與 `models/` 已列入 `.gitignore`。

**模型權重不進 repo**，以環境變數 `ONEJEV_GGUF` 指定路徑：

- 這台開發機已經有一份：`~/code/ActivityWatch-Decision/poc/models/OneJev1.6-0.8B.Q4_K_M.gguf`。
  這份是從 `mradermacher/OneJev1.6-0.8B-GGUF` 下載，並修補過 metadata 的檔案（原檔宣告了沒有匯出的 MTP 層，新版 llama.cpp 會拒絕載入，詳見該 repo 的 `poc/watch.py`）。
- 其他機器：依 `ActivityWatch-Decision/poc/watch.py` 的 `model_files()` 下載並修補，或直接用 `qev serve --gguf mradermacher/OneJev1.6-0.8B-GGUF:Q4_K_M`（官方 README 的 llama.cpp 用法）。
- tokenizer 從 Hugging Face 的 `OmniJev/OneJev1.6-0.8B` 取得。第一次要連網下載，之後 `start-onejev.sh` 預設用 `HF_HUB_OFFLINE=1` 讀本機快取。

## 執行

```sh
ONEJEV_GGUF=~/code/ActivityWatch-Decision/poc/models/OneJev1.6-0.8B.Q4_K_M.gguf tools/selector/start-onejev.sh
# 另一個終端機
cd web && npm run dev
curl -s localhost:3000/api/select-variables/ -H 'content-type: application/json' -d '{"event":"2022 Pakistan floods"}'
```

環境變數：

| 變數 | 預設值 | 說明 |
|---|---|---|
| `ONEJEV_GGUF` | （必填） | OneJev GGUF 檔路徑 |
| `ONEJEV_PORT` / `SELECTOR_PORT` | 8811 / 8770 | 模型伺服器／選變數服務的連接埠，預設都綁 127.0.0.1 |
| `SELECTOR_HOST` | `127.0.0.1` | 選變數服務的綁定位址；容器要連到主機服務時可改為 `0.0.0.0`，需限制在可信任網路，服務沒有驗證機制；模型仍只綁 loopback |
| `ONEJEV_PARALLEL` | 4 | llama-server 平行槽數；歷史 12 題分給 4 槽，延遲約 5 s → 2.9 s，17 題尚未量測 |
| `SELECTOR_URL`（Next 端） | `http://127.0.0.1:8770` | route 呼叫的服務位址；設成空字串會完全停用模型 |

歷史 12 類效能（Ryzen 5 7640U，CPU）：載入約 10 秒；每個事件中位數 2.9 秒。17 類尚未量測；超過 5 秒時會退回關鍵字表。同一事件第二次可命中快取。

## 重跑評估

不啟動模型的整合測試（從 repo 根目錄）：

```sh
cd web
npx tsx --test app/api/select-variables/*.test.ts lib/detective/keywords.test.ts
cd ..
npx tsx tools/selector/check-contract.mts
python3 -I -m unittest discover -s tools/selector -p 'test_*.py'
```

以下是重新執行模型評估的步驟，需要另備權重；本次整合只跑上面的離線測試，沒有重跑模型。`eval.py` 的人工標註仍只涵蓋原始 12 類，分數會明列 `scored categories 12`，不把新增類別誤當成負例。未來的模型回應另存 `*-categories17.json`，不覆寫歷史結果；完整 17 類評估仍需新增人工標註。三個候選都裝在同一個 venv（torch 用 CPU 版）：

```sh
VIRTUAL_ENV=.venv uv pip install --index-url https://download.pytorch.org/whl/cpu \
  --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match \
  torch "jev-style[torch]==0.6.3" "phocinae-server==0.1.8" "qev @ git+https://github.com/OmniJev/OneJev.git"

# OneJev（:8811）
HF_HUB_OFFLINE=1 .venv/bin/python -I -m qev.cli serve --gguf "$ONEJEV_GGUF" --tokenizer OmniJev/OneJev1.6-0.8B \
  --max-branch-tokens 2048 --parallel 4 --host 127.0.0.1 --port 8811
# jev-style（:8812；第一次下載約 1.5 GB 到 models/hf）
HF_HOME=$PWD/models/hf .venv/bin/python -I -m jev_style serve --release 0.8b-v3 --backend torch --device cpu \
  --dtype float32 --host 127.0.0.1 --port 8812
# Phocinae（:8813；權重 289 MB，sha256 與 repo 的 SHA256SUMS 相符）
.venv/bin/hf download Phocinae/Phocinae-Largha-150M-v1 model.safetensors encoder/config.json rl_agent_config.json \
  tokenizer/tokenizer.json tokenizer/tokenizer_config.json config.json SHA256SUMS --local-dir models/largha
PHOC_MODEL_DIR=$PWD/models/largha .venv/bin/python -I phocinae_serve.py --port 8813

for p in en zh en-unusual; do .venv/bin/python -I eval.py --backend onejev --upstream http://127.0.0.1:8811 --prompt $p; done
.venv/bin/python -I eval.py --summary results/*.json
npx tsx dump-keywords.mts
```

所有下載的程式都用 `python -I`（隔離模式）執行，不會從目前目錄載入模組；jev-style 會從自己的模型 repo 下載 runtime 檔案。

## 候選模型的官方來源

| 模型 | 官方安裝／用法 | 備註 |
|---|---|---|
| OneJev1.6-0.8B | [OmniJev/OneJev](https://github.com/OmniJev/OneJev)：`pip install git+https://github.com/OmniJev/OneJev.git`，再 `qev serve --gguf …` | Apache-2.0；本機副本在 `ActivityWatch-Decision/vendor/OneJev` |
| Jev-Style-0.8B-Decision-v3 | [PyPI jev-style](https://pypi.org/project/jev-style/)：`pip install "jev-style[torch]"`，再 `jev-style serve --backend torch --device cpu` | Apache-2.0；CPU fp32 每事件 7–10 s |
| Phocinae-Largha-150M-v1 | [HF 模型卡](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1)：`pip install phocinae-server`，再 `PHOC_MODEL_DIR=… python -m phocinae.main` | Apache-2.0；0.1.8 的 HTTP schema 會丟掉 `instructions`（見 eval.md） |
