# tools/selector：本地 AI 選變數（工作線 D）

`POST /api/select-variables`（`web/app/api/select-variables/route.ts`）會把事件文字送到這裡的本地服務。服務對 12 個變數類別各問一題是／否，問題用 SPEC §4 的淺白定義，由本地開源的 System One 決策模型回答。不需要 API key，也不會連到外部網路。

- **選定模型：OneJev1.6-0.8B**（Q4_K_M GGUF，經 llama.cpp 在 CPU 上執行）。評估與理由見 [eval.md](eval.md)。
- **預先勾選規則：關鍵字優先。** 模型可用時，關鍵字表（`web/lib/detective/keywords.ts`）有命中就勾關鍵字表的類別，沒有命中才勾模型 p ≥ 0.5 的類別。機率條一律顯示模型的 p。
- **備案：** 服務不存在、出錯或 5 秒內沒有回應 → route 回傳 `keyword-fallback`。模型關閉時實測約 0.03 秒回應。
- **靜態部署：** `next build`（`output: "export"`）會略過這個 route，前端呼叫失敗時直接在瀏覽器呼叫 `keywordSelect()`。

```
瀏覽器 ──POST /api/select-variables/──▶ route.ts ──POST /select (5 s)──▶ serve.py :8770 ──/v1/systemone──▶ qev serve :8811 ──▶ llama-server（OneJev GGUF）
                                          └─ 失敗／逾時 → keywords.ts（keyword-fallback）
```

> 注意 `next.config.ts` 設了 `trailingSlash: true`：請 POST 到 `/api/select-variables/`（結尾有斜線）。不加斜線會收到 308 轉址。

## 檔案

| 檔案 | 作用 |
|---|---|
| `selector.py` | 類別定義、問法、三種後端的請求與回應格式（只用標準函式庫） |
| `serve.py` | route 呼叫的本地 HTTP 服務（127.0.0.1:8770）：`POST /select`、`GET /health`，快取最近 256 個事件 |
| `start-onejev.sh` | 一次啟動 OneJev 模型伺服器與 `serve.py` |
| `phocinae_serve.py` | 只供評估用：繞過 `phocinae-server` 0.1.8 丟掉題目文字的問題（見 eval.md） |
| `eval.py` | 跑 10 個測試事件、彙整 AUC／F1／延遲 |
| `check-keywords.mts` | 關鍵字表與時間解析的快速檢查（`node tools/selector/check-keywords.mts`） |
| `dump-keywords.mts` | 把 10 個測試事件跑過關鍵字表，寫出 `results/keywords.json` |
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
| `ONEJEV_PORT` / `SELECTOR_PORT` | 8811 / 8770 | 模型伺服器／選變數服務的連接埠，都只綁 127.0.0.1 |
| `ONEJEV_PARALLEL` | 4 | llama-server 平行槽數（12 題分給 4 槽，延遲約 5 s → 2.9 s） |
| `SELECTOR_URL`（Next 端） | `http://127.0.0.1:8770` | route 呼叫的服務位址；設成空字串會完全停用模型 |

效能（Ryzen 5 7640U，CPU）：載入約 10 秒；每個事件中位數 2.9 秒。第一次請求或機器忙碌時可能超過 5 秒，這時會退回關鍵字表。同一事件第二次會命中快取（< 0.1 秒）。

## 重跑評估

三個候選都裝在同一個 venv（torch 用 CPU 版）：

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
node dump-keywords.mts
```

所有下載的程式都用 `python -I`（隔離模式）執行，不會從目前目錄載入模組；jev-style 會從自己的模型 repo 下載 runtime 檔案。

## 候選模型的官方來源

| 模型 | 官方安裝／用法 | 備註 |
|---|---|---|
| OneJev1.6-0.8B | [OmniJev/OneJev](https://github.com/OmniJev/OneJev)：`pip install git+https://github.com/OmniJev/OneJev.git`，再 `qev serve --gguf …` | Apache-2.0；本機副本在 `ActivityWatch-Decision/vendor/OneJev` |
| Jev-Style-0.8B-Decision-v3 | [PyPI jev-style](https://pypi.org/project/jev-style/)：`pip install "jev-style[torch]"`，再 `jev-style serve --backend torch --device cpu` | Apache-2.0；CPU fp32 每事件 7–10 s |
| Phocinae-Largha-150M-v1 | [HF 模型卡](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1)：`pip install phocinae-server`，再 `PHOC_MODEL_DIR=… python -m phocinae.main` | Apache-2.0；0.1.8 的 HTTP schema 會丟掉 `instructions`（見 eval.md） |
