# Run Earth System Trend Detective

From the repository root, use Python 3.11+ and Node.js 22+.

```sh
npm ci --prefix web
python3 -m server.dev
```

Open [the explorer](http://localhost:3000/explore). Enter **drought**, **flood**, **乾旱** or **淹水** to use an offline curated selection plan. Region and period can both be left blank. To run just the API, use `python3 -m server.api`. For a production build, run `npm run build --prefix web`, then `python3 -m server.dev --production` to serve both processes. The Next.js server proxies `/api` to `http://127.0.0.1:8765`. Set `AQUA_RESEARCH_API_URL` **before building** to use a different address. The API and development launcher bind to loopback by default.

## Selection and data

Free-text English and Chinese queries use a local **Qwen3 1.7B** selector through Ollama. Thinking is disabled. The selector reads prepared catalogue descriptions and returns a constrained selection. The research engine resolves the chosen variables and registered recipes, then computes the trends from the prepared series. Region and time come only from the form.

### One-time local model setup

On a Mac with Homebrew, install Ollama and download the model once:

```sh
brew install ollama
```

With `ollama serve` running in one terminal, run `ollama pull qwen3:1.7b` in another. The model download is approximately 1.4 GB. Subsequent runs read the weights locally. Launch the project as above: it reuses an existing Ollama service or starts its own on loopback when the executable is present. The standalone `server.api` command expects your Ollama service to be running. The default model endpoint is `http://127.0.0.1:11434/api/chat`; use `AQUA_LOCAL_SELECTOR_URL` and `AQUA_LOCAL_SELECTOR_MODEL` to select a different local Ollama installation or tag.

Exact prepared topics and previously frozen study plans can be used without a fresh inference. Send `"reselect": true` through the research API to force new inference. An unavailable model or an unsupported phenomenon is surfaced in the study. To opt into a different provider, explicitly set `AQUA_SELECTOR_URL` (Chat Completions endpoint) and `AQUA_SELECTOR_MODEL`, plus `AQUA_SELECTOR_API_KEY` only when required.

The included export contains 1,706 regional files and 26 product layers. After physical and spatial eligibility checks, 1,665 regions have at least one usable monthly series. The files come from the repository's existing release at `5f22f142`. The on-screen map also includes regions without monthly series. The API reads `web/public/data` by default. Set `AQUA_DATA_ROOT` to use a different compatible prepared release. Monthly data can support an environmental trend even when a particular indicator, its fixed reference, or a recorded-event catalogue is unavailable.

Job snapshots, versioned case searches and selection plans are stored in a local SQLite database at `.aqua-trend/jobs.sqlite`. Set `AQUA_STATE_DB` to change it. Run one API process per database. The server marks jobs interrupted by a restart as retryable, and retains previously published studies.

## Preset policy

`server/policies/presets.json` declares the automatic search regions, fixed windows, and interest weights. Each automatic region also gets a candidate for the shared available span. When the user supplies a region or period, that field constrains the entire search. Every evaluated candidate is recorded, including exclusions and results below the significance threshold. Case ranks use weighted means across concepts and indicators; unavailable scale or stability contributes zero to that component. Reference scales are per-variable, so a temperature change is never directly ranked against a precipitation rate.

To publish recommended cases before people start exploring, keep the API running and run `python3 -m server.build_presets`. It evaluates all registered phenomenon plans through the same research pipeline. Pass one or more phenomenon names to run a subset. Unconstrained interactive queries also generate and cache a case on demand.

To pin a case, add an entry to `overrides`, change the policy version and restart the API. Use `AQUA_PRESET_POLICY` to select a separate policy file. A manual case still needs usable measurements. The policy content hash participates in the search version.

```json
{
  "phenomenon_id": "drought",
  "region_id": "named-taiwan-main-island",
  "period": {"start": "2005-01", "end": "2024-12"},
  "priority": 1,
  "pinned": true,
  "manual_reason": "Selected for a regional case study."
}
```

Set `disabled` to `true` on an override to exclude a candidate. Versioned JSON exports carry the entire comparison ledger. CSV includes the exact observation dates, values, estimates, uncertainty and identifiers from the same snapshot.

## Verification

```sh
python3 -m unittest discover -s server/tests
npm run typecheck --prefix web
npm run build --prefix web
```

With the model installed and Ollama running, run `python3 -m server.check_local_selector` to exercise free-text selection through the research API. Each case starts a fresh selection in a temporary database. The check verifies the selected catalogue entries, structured region and dates, research results, JSON exports and explicit errors for unsupported questions.

The browser regression test runs against an already-started server. It covers a Chinese phenomenon in the English UI, default resolution, changing the fitted window from a chart, exports, reopening a study and keyboard selection at mobile width. Set `CHROME_PATH` to an installed Chrome executable if Playwright's Chromium is unavailable.

```sh
AQUA_WEB_URL=http://127.0.0.1:3000 node web/scripts/check-research.mjs
AQUA_WEB_URL=http://127.0.0.1:3000 node web/scripts/check-research-races.mjs
```

## Acceptance record

| Specification cases | Evidence on this branch | Outcome |
| --- | --- | --- |
| P01–P09, single region, manual presets, replay | Integration tests cover all four constraint combinations, exclusions, pinning, cancellation, preserved provenance, frozen plans, and version changes. | Passed with the included release. |
| S01–S07 | Catalogue tests exercise English and Chinese aliases, invalid model output and provider failures. Six fresh Qwen3 1.7B studies cover natural drainage, drying conditions, a Chinese temperature question with embedded dates and geography, multiple measurements, and two unsupported topics. | All six local cases passed. Supported cases produced trends and reproducible JSON exports. Unsupported cases returned an explicit error. |
| D01–D10 | The adapter checks the release index, region IDs, asset fingerprints, spatial support, approved alternatives and full product histories. | Passed. 39,670 eligible region–product series, with 63,805 missing monthly values retained. |
| T01–T16 | Numeric tests cover seasonal references, known slopes, gaps, covariance, BY, the complete search family, non-significant evidence, distinct metrics and reproducible evidence versions. | Passed. For four held-out simulation settings with 200 replicates each, nominal 95% pointwise intervals covered 94.5–95.5%. |
| E01–E12 | SPI scale and gamma-fit reference checks, source selection, event fixtures, partial coverage, deduplication, censoring and coarse dates. | Passed on prepared precipitation and controlled event records. Real recorded drought and flood rates remain pending data. |
| Browser workflow | Live API and browser checks cover study launch, validation, chart-driven rerun, snapshot reopen, exports, mobile keyboard selection and overflow. Separate response-interception tests exercise stale results, cancellation and retry. | Passed on desktop and mobile viewports. |

The interval calculation uses the larger of calendar-lag Newey–West and lag-one autoregression sensitivity standard errors. The held-out checks use seasonal Gaussian series with and without serial dependence, calendar gaps and a linear trend. They measure performance under those specified cases. The displayed limit is a pointwise interval for each estimate.

To supply observed events, put the versioned prepared source at `events/drought.json` or `events/flood.json` beneath the data root. Each file declares its registered catalogue ID (`prepared-drought` or `prepared-flood`), version, definition reference, source reference, coverage version, and separate `coverage` and `events` arrays. See the [event input contract](earth-system-data-contracts.md) and the event loader tests in `server/tests/test_catalogue.py`. Restart the API to load the new snapshot.
