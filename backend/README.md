# Earth System Trend Detective — backend

Analysis backend and HTTP API for the research page (`web/app/research`). It reads the prepared NASA / NOAA
series in `web/public/data`, the offline catalogue in `backend/catalogue`, and answers one question per request:
*for this phenomenon, this one region and this period, what do the supported variables and standard indicators
show, and how strong is the evidence?*

Requirements and design: `docs/earth-system-trend-detective-spec.md`, `docs/earth-system-data-contracts.md`,
`docs/earth-system-acceptance.md`, `docs/implementation-architecture.md`. The response models are
`aqua_trend/contracts.py` (mirrored by `web/lib/research/types.ts`).

## Install

Python 3.11 or newer.

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -e ".[dev]"        # add ",llm" for the optional Anthropic SDK: ".[dev,llm]"
```

The prepared data must be present in `web/public/data` (see `web/public/data/README.md`). Nothing is downloaded,
regridded or re-aligned at query time; a missing or invalid release stops the server at start with
`data_release_invalid` and the name of the broken asset.

## Run

```bash
cd backend
.venv/bin/python -m aqua_trend            # serves http://127.0.0.1:8000
# or
scripts/dev_server.sh
# or, with uvicorn options of your own
.venv/bin/uvicorn aqua_trend.app:app --host 127.0.0.1 --port 8000
```

A research needs a **variable selector** (next section). Without one the catalogue endpoints work and
`POST /api/research` answers `503 selector_unavailable`; nothing is computed in its place.

The front-end reads the API base from `NEXT_PUBLIC_API_BASE` (default `http://localhost:8000`).

One-off run without the server: `scripts/run_research.py` (same engine, prints text / JSON / CSV).

## Configure

| Variable | Default | Meaning |
| --- | --- | --- |
| `AQUA_HOST`, `AQUA_PORT` | `127.0.0.1`, `8000` | Address of `python -m aqua_trend`. |
| `AQUA_LOG_LEVEL` | `info` | uvicorn log level. |
| `AQUA_CORS_ORIGINS` | `http://localhost:3000`, `:3001`, `:5000` and the `127.0.0.1` equivalents | Comma-separated origins allowed to call the API (`*` allows any). |
| `AQUA_SELECTOR` | `auto` | Selector provider: `auto`, `anthropic`, `claude_cli`, `catalogue_lexical` (see below). |
| `ANTHROPIC_API_KEY` | – | Key for `auto` / `anthropic`. Read from the environment only; never stored. |
| `AQUA_SELECTOR_MODEL` | provider default | Model id for `anthropic` / `claude_cli`. |
| `AQUA_SELECTOR_EFFORT` | `medium` | Effort for the Anthropic provider (`off` to omit). |
| `AQUA_SELECTOR_TIMEOUT_S` | `120` | Selector timeout in seconds. |
| `AQUA_SELECTOR_FALLBACKS` | on | `off` disables the Anthropic refusal fallback. |
| `AQUA_CLAUDE_CLI` | `claude` | Executable used by `claude_cli`. |
| `AQUA_JOB_WORKERS` | `2` | Background worker threads. |
| `AQUA_RESULT_CACHE` | on | `off` disables reuse of stored results for identical requests. |
| `AQUA_VAR_DIR` | `backend/var` | Runtime state: `results/`, `jobs/`, `families/`, `presets/`, `cache/research/`, `plans/`. Git-ignored. |
| `AQUA_PLAN_DIR` | `<var>/plans` | Saved selection plans. |
| `AQUA_DATA_DIR` | `web/public/data` | Prepared data release. |
| `AQUA_CATALOGUE_DIR` | `backend/catalogue` | Offline catalogue. |
| `AQUA_CACHE_DIR` | `backend/var/cache` | Derived binary caches of the prepared series. |

### Selector providers

The selector turns the phenomenon text into catalogue variables and approved indicator recipes. It never sets the
region or the period.

| `AQUA_SELECTOR` | What it does |
| --- | --- |
| `auto` (default) | Anthropic API when `ANTHROPIC_API_KEY` is set; otherwise **unavailable**. |
| `anthropic` | Anthropic API; needs `ANTHROPIC_API_KEY`. |
| `claude_cli` | Runs the local `claude` CLI in print mode (no tools). |
| `catalogue_lexical` | Deterministic matcher over the catalogue's phenomenon notes and concept names. **Not a language model**: every plan and result says `is_language_model: false` and carries the warning `selector_not_language_model`. It is used only when asked for by name — there is no silent fallback to it. |

When the provider is not configured or cannot be reached, a saved plan made by a language model for the same
normalised text and the same catalogue / prompt versions is reused (marked `reused`). Otherwise the request
fails with `selector_unavailable` and the input is kept. A plan made by the lexical matcher is never served in
place of a model.

Offline development:

```bash
AQUA_SELECTOR=catalogue_lexical scripts/dev_server.sh
```

## Test

```bash
cd backend
.venv/bin/pytest -q                       # default run (excludes tests marked slow)
.venv/bin/pytest -q tests/test_api_research.py tests/test_api_catalogue.py tests/test_jobs_manager.py
.venv/bin/pytest -q -m slow               # simulation / calibration studies
```

Tests marked `realdata` read `web/public/data` and are skipped when it is absent. The API tests inject the
selector explicitly (the lexical matcher or a scripted test provider) and write only to temporary directories.

## API reference

All bodies are JSON (UTF-8). A missing value is `null`; `NaN` and `Infinity` never appear. Zero is a number, not
a gap. Responses above 1 KB are gzip-compressed when the client accepts it.

The examples below are excerpts of a real run of this code on dataset
`export-2.2026-11-14.2d8143913d72` with `AQUA_SELECTOR=catalogue_lexical`; long values are cut with `…`.
They show the shape of the answers. They are not a scientific statement about any region.

### Errors

Every error has the same body and a stable `code`:

```json
{"code":"invalid_period","message":"A period needs both a start and an end month; complete it or clear the whole selection.","retryable":false,"fields":["period.end"]}
```

| HTTP | `code` | When |
| --- | --- | --- |
| 422 | `empty_query` | `phenomenon_query` missing or blank. |
| 422 | `invalid_period` | Only one end given, not `YYYY-MM`, or start after end. `{"start": null, "end": null}` means "no period". |
| 422 | `unknown_region` | `region_id` is not an id of the region catalogue. |
| 422 | `invalid_context` | Unknown `parent_research_id` / `preset_ref`, or a preset that conflicts with a field the user set. The user's field is never overridden. |
| 422 | `invalid_request` | Body is not a JSON object, a field has the wrong type, bad query parameter. |
| 404 | `not_found` | Unknown research, family, region detail or address. |
| 409 | `result_not_ready` | Export or family of a research that is still running (retryable) or ended without a result. |
| 502 | `selector_invalid_output` | The model named variables or recipes that are not in the catalogue (reported by the job). |
| 503 | `selector_unavailable` | No selector configured / reachable and no saved plan. Retryable; a configuration mistake such as an unknown `AQUA_SELECTOR` value is not. |
| 503 | `data_release_invalid` | The loaded release does not match the snapshot a job was created for. |
| 500 | `internal_error` | Unexpected error. Retryable. No stack trace is sent; details are in the server log. |

A valid region without prepared data is **not** an error: the research runs and its items carry `no_series`.
Errors found after the job exists (for example the model becomes unreachable) are reported by
`GET /api/research/{id}` with `status: "failed"` and the same error body under `error`.

### `GET /api/health`

```json
{"status":"ok","api_version":"api-1.0.0","engine_version":"engine-1.0.0",
 "snapshot_id":"snap-02990682104c7c10","policy_snapshot_id":"pol-8408fe0ac718c62c",
 "versions":{"dataset_version":"export-2.2026-11-14.2d8143913d72","catalogue_version":"catalogue-1.0.0+a8ece74f9a","region_catalogue_version":"regions-fc4c1a8ab868","indicator_registry_version":"indicators-1.0.0","quality_policy_version":"quality-1.0.0","method_policy_version":"method-1.1.0","preset_policy_version":"preset-1.1.0", "…":"…"},
 "selector":{"mode":"catalogue_lexical","prompt_version":"selector-prompt-2","provider":"catalogue_lexical","model":null,"is_language_model":false,"available":true,"reason":null},
 "presets":{"engine_available":false},
 "jobs":{"active":0,"workers":2,"result_cache":true}}
```

`selector.available` means "configured and startable"; the model is not called to find out.

### `GET /api/catalogue`

About 200 KB. Top-level keys:

| Key | Content |
| --- | --- |
| `versions`, `snapshot_id`, `policy_snapshot_id`, `api_version` | Every version that identifies the loaded release and policies. |
| `concepts[]` | `variable_id`, `label`, `label_zh`, `description`, `unit`, `quantity_definition`, `temporal_support`, `data_kind`, `approved_product_ids` (priority order), `product_order_reason`, `baseline_ref`, `relative_change`, `display_semantics`, `refs[]`, and `products[]`: every registered product of the concept with `agency`, `product_name`, `version`, `start`, `end`, `approved`, `priority_rank`, `is_primary`, `caveat`, `quality_limits`, `baseline_id`, `regions_with_series`, `status`, `refs[]`. A registered product with `approved: false` is never used as a fallback. |
| `phenomena[]`, `phenomena_note` | Curated notes (`phenomenon_id`, `label`, `label_zh`, `aliases`, `description`, `variable_links`, `indicator_ids`, `unanswerable_notes`) for input hints. **Not a whitelist**: any text may be submitted. |
| `indicators[]` | Recipe summaries: id, version, kind, labels, `phenomenon_applicability`, `standard_refs`, `required_variables`, `baseline_requirements`, `interpretation`, `requirements`. |
| `event_catalogues[]` | Recorded-event catalogues with `status` (`ready` / `pending`) and what is missing. |
| `baselines[]` | Fixed reference periods (`baseline_id`, `product_id`, `start`, `end`, `rule`, `minimum_samples`). |
| `regions` | Counts only (list: next endpoint). |
| `asset_status`, `product_status`, `dataset` | Delivery state of every asset (`ready` / `pending` / `invalid`, missing fields, reason). |
| `policies` | `method_policy`, `preset_policy`, `quality_policy` as loaded — read-only display. |
| `selector` | Same object as in `/api/health`. |
| `presets`, `job_stages` | Whether a preset engine is loaded; the ordered job stages. |

```json
"regions": {"total":7641,"with_series":1706,"by_type":{"basin3":{"total":292,"with_series":268},"basin4":{"total":1342,"with_series":1313},"ice":{"total":2,"with_series":2},"lme":{"total":66,"with_series":66},"sea":{"total":15,"with_series":15},"named":{"total":42,"with_series":42},"hex":{"total":5882,"with_series":0}},"list_url":"/api/catalogue/regions","region_catalogue_version":"regions-fc4c1a8ab868"}
```

### `GET /api/catalogue/regions`

Every region, compact: `{region_catalogue_version, dataset_version, count, fields, regions[]}` with
`id, name, name_zh, type, centroid, bbox, area_km2, surface, series_available, n_products` per region.

```
HTTP/1.1 200 OK
etag: "regions-592ae6e36a18114e6bfe"
cache-control: public, no-cache
content-encoding: gzip
```

The ETag is keyed on `region_catalogue_version` + `dataset_version`. Send it back as `If-None-Match` to get
`304 Not Modified` with no body.

### `GET /api/catalogue/regions/{region_id}`

The full region record plus `products[]` (availability and actual period of every registered product for exactly
this region), `analysable_variable_ids` and a `note` when the region has no prepared series.

```json
{"product_id":"p_imerg","variable_id":"precip","approved":true,"priority_rank":1,"unit":"mm/day","cadence":"monthly",
 "status":"ok","status_reason":null,
 "record_period":{"start":"1998-01","end":"2025-09"},"valid_period":{"start":"1998-01","end":"2025-09"},
 "n_valid":333,"n_expected":333,
 "baseline":{"baseline_id":"clim.p_imerg.2001-2020","version":"1","samples_per_position":[20,20,20,20,20,20,20,20,20,20,20,20],"minimum_samples":16,"ok":true,"actual_support":{"start":"2001-01","end":"2020-12"}}}
```

Unknown id: `404 not_found`.

### `POST /api/research`

Request (`contracts.ResearchRequest`). `region_id` and `period` carry only what the user picked with the
selectors; both may be `null`. Fields other than these are ignored — a client cannot supply numbers, sources or
correction results.

```json
{"phenomenon_query":"乾旱",
 "region_id":"named-taiwan-main-island",
 "period":{"start":"2001-01","end":"2020-12"},
 "context":{"parent_research_id":null,"preset_ref":null},
 "options":{"reselect":false}}
```

- `context.parent_research_id`: adjust an existing research. Its saved selection plan is replayed when the
  phenomenon text is unchanged; the model is not asked again. Old correction families are not carried over to
  new hypotheses.
- `context.preset_ref: {id, version}`: open a stored preset. It fills only blank fields and keeps its search
  family.
- `options.reselect: true`: ask the selector for a new plan and skip the result cache.

Response `202 Accepted` with `Location: /api/research/{id}`:

```json
{"research_id":"rs_cd7d98f7c23544dda782ce5a83a72b02","status":"queued","stage":"validating",
 "progress":{"completed":0,"total":0},"stage_detail":null,"error":null,
 "request":{"phenomenon_query":"乾旱","region_id":"named-taiwan-main-island","period":{"start":"2001-01","end":"2020-12"},"context":{"parent_research_id":null,"preset_ref":null},"options":{"reselect":false}},
 "result":null,"created_at":"2026-11-14T18:28:52Z","updated_at":"2026-11-14T18:28:52Z",
 "stage_history":[],"cancel_requested":false,"cache_hit":false,"cached_from":null,"result_available":false,
 "snapshot_id":"snap-02990682104c7c10","policy_snapshot_id":"pol-8408fe0ac718c62c"}
```

Checked before a job is created: the request shape, the region id, the period, the context references, and
whether a selection plan can be made at all (`503 selector_unavailable`).

### `GET /api/research/{research_id}`

`contracts.ResearchJob`. `?include_result=false` leaves the result out (useful while polling; a result is about
0.5 MB).

```json
{"research_id":"rs_cd7d98f7c23544dda782ce5a83a72b02","status":"partial","stage":"complete",
 "progress":{"completed":1,"total":1},"stage_detail":"partial","error":null,
 "request":{"…":"as sent"},"result":null,
 "stage_history":["validating","selecting_variables","resolving_defaults","resolving_products","analyzing","correcting","explaining","complete"],
 "cancel_requested":false,"cache_hit":false,"cached_from":null,"result_available":true,
 "snapshot_id":"snap-02990682104c7c10","policy_snapshot_id":"pol-8408fe0ac718c62c"}
```

- `status`: `queued`, `running`, then `complete`, `partial`, `failed` or `cancelled`. `partial` means some item
  could not be answered (for example an event catalogue that has not been delivered); the other items are valid.
- `stage`, `progress`, `stage_detail`: where the job is; during `analyzing`, `progress` counts variables and
  indicators.
- `result` (`contracts.ResearchResult`) is attached only when the job has finished. No provisional labels are
  published while a job runs.
- The job keeps the user's `request` in every state, and survives a server restart once it has finished.

One variable trend of that result (precipitation, product `p_gpcp`):

```json
{"hypothesis_id":"hyp-named_taiwan_main_island-anomaly_linear_trend-6babba275b7c0677","metric_id":"anomaly_linear_trend","unit":"mm/day",
 "slope_per_year":-0.06485529262660805,"slope_per_decade":-0.6485529262660805,
 "ci95_per_decade":{"lo":-1.5282322267242834,"hi":0.23112637419212223},"ci_level":0.95,"interval_scope":"pointwise",
 "p_raw":0.1439653443357816,"p_adjusted":{"fam-q-3dcf07815b75584d":0.7970557499796701},"primary_family_id":"fam-q-3dcf07815b75584d",
 "significant":false,"significance_label":"not_significant","inference_status":"ok",
 "method":{"estimator":"ols","covariance":"hac_bartlett_calendar_lag","lag":4,"lag_policy":"fixed_pw_sdof","seasonal_adjustment":"fixed_baseline_monthly_anomaly","policy_version":"method-1.1.0","…":"…"},
 "n_valid":240,"n_expected":240,"coverage":1.0,"diagnostics":["…"]}
```

When inference is not applicable, `ci95_per_decade`, `p_raw` and `significant` are `null` and
`significance_label` is `undetermined`. That is not the same as "not significant".

A flood request on the same region (`"phenomenon_query":"洪水"`) ends as `partial`; its indicators are

```
recorded.flood   recorded_event     data_required        event catalogue not delivered — recorded_flood_events: pending … an undelivered catalogue is not an empty catalogue, so no zero counts are reported.
derived.flood    derived_indicator  definition_required  No approved standard recipe derives flood occurrence from the prepared data. … Monthly precipitation or its anomaly must not be labelled flood frequency. …
```

### Result cache

An identical request (same normalised text, region, period and context, same selection-plan content hash, same
data / catalogue snapshot, same policy and engine versions) is answered from the stored result. It is a new job
with its own id that says where the numbers come from:

```json
{"research_id":"rs_8779885a2e264fb690ebea71d3263e53","status":"partial","stage":"complete",
 "stage_detail":"served from the result cache (research rs_cd7d98f7c23544dda782ce5a83a72b02)",
 "cache_hit":true,"cached_from":"rs_cd7d98f7c23544dda782ce5a83a72b02","result_available":true, "…":"…"}
```

`result.identity.cached_from` carries the same id. `options.reselect` and `AQUA_RESULT_CACHE=off` bypass it.

### `DELETE /api/research/{research_id}`

Cancels a queued or running job and returns the job (`200`). It is `cancelled` from that moment, with
`error.code: "cancelled"` and no result: the engine stops before corrected labels are attached, and anything a
worker still returns is discarded. Deleting a finished job changes nothing and returns it as it is.

### `GET /api/research/{research_id}/export?format=json|csv`

The same result snapshot as a download (`Content-Disposition: attachment; filename="aqua-trend-<id>.json|csv"`).

- `json` (default): exactly `result` of the job.
- `csv`: `# ` metadata lines (request, plan, versions, baselines, per-item product, trend and family), one header
  row, then one row per series value. Numbers are written exactly as in the JSON; a missing value is an empty
  cell.

```
# format: aqua-trend-csv-1
# research_id: rs_cd7d98f7c23544dda782ce5a83a72b02
# status: partial
# request: {"period": {"end": "2020-12", "start": "2001-01"}, "phenomenon_query": "乾旱", "region_id": "named-taiwan-main-island"}
…
research_id,item_kind,item_id,metric_id,product_id,region_id,cadence,time,raw,seasonal,anomaly,fit,unit,inside_analysis_period
rs_cd7d98f7c23544dda782ce5a83a72b02,variable,precip,anomaly_linear_trend,p_gpcp,named-taiwan-main-island,monthly,1979-01,2.076,2.2281,-0.1520999999999999,,mm/day,false
```

### `GET /api/research/{research_id}/families/{family_id}?offset=0&limit=500`

The complete stored evidence family of a result, so a truncated list inside a result can be verified.
`limit` is 1–5000. The family must belong to that research (`404` otherwise).

```json
{"family_id":"fam-q-3dcf07815b75584d","scope":"query",
 "candidate_policy":{"id":"query_family","version":"engine-1.0.0","region_id":"named-taiwan-main-island","analysis_period":{"start":"2001-01","end":"2020-12"},"…":"…"},
 "method":"benjamini_yekutieli","alpha":0.05,"n_candidates":24,"n_tested":11,"n_untested":13,"complete":true,
 "content_hash":"3dcf07815b75584dbc2f2d812b159eb75df241eca4e0ca674045dce9b0b97eee",
 "hypotheses":[{"hypothesis_id":"hyp-named_taiwan_main_island-anomaly_linear_trend-6babba275b7c0677","components":{"…":"…"},"p_raw":0.1439653443357816,"p_adjusted":0.7970557499796701,"significant":false,"tested":true,"…":"…"}],
 "hypotheses_truncated":false,
 "page":{"offset":0,"limit":1,"returned":1,"total":24,"next_offset":1}}
```

## Code map

| File | Role |
| --- | --- |
| `aqua_trend/api.py` | `create_app(store=None, selector=None, *, storage=None, …)`, routes, request validation, error bodies, `build_engine` (the one place the engine and the optional preset engine are wired). |
| `aqua_trend/jobs.py` | `JobManager`: thread pool, stage / progress updates, cancellation, job records, result cache use. |
| `aqua_trend/app.py` | Module-level `app` for `uvicorn aqua_trend.app:app`. |
| `aqua_trend/__main__.py` | `python -m aqua_trend`. |
| `aqua_trend/engine.py`, `resolve.py`, `present.py`, `storage.py` | Research engine, product / period resolution, summary and exports, file storage. |
| `aqua_trend/store`, `selection`, `stats`, `indicators` | Prepared data and catalogue, selector, statistics, indicator recipes. |
