# Earth System Trend Detective — implementation architecture

Companion to the three spec documents in this folder. The spec says *what*; this file fixes *where code lives and
how modules talk*, so work packages can proceed in parallel. If this file and the spec disagree, the spec wins —
fix this file.

## 1. Layout

```
backend/
  pyproject.toml                 Python ≥ 3.11; venv at backend/.venv (numpy, scipy, fastapi, pydantic, pytest, statsmodels[test only])
  aqua_trend/
    contracts.py                 pydantic models = API + result contract (single source of truth)
    errors.py                    AquaError + stable codes
    timeaxis.py                  month index helpers (shared, tiny)
    store/                       PreparedDataStore, series-2 adapter, manifest validation, catalogue loading
    selection/                   PhenomenonSelector, model providers, selection-plan persistence
    stats/                       TrendEngine (seasonal, OLS, HAC, diagnostics), BY-FDR, EvidenceController
    indicators/                  IndicatorRegistry, SPI recipe, event rules, recorded-event aggregation
    resolve.py                   PlanResolver (products, periods, comparison)
    presets/                     PresetEngine (candidates, scoring, manual adjustments, search families)
    engine.py                    ResearchEngine.run(request, catalogue_snapshot, policy_snapshot)
    present.py                   ResultPresenter (summary statements, JSON / CSV export)
    jobs.py, api.py              background jobs, result cache, FastAPI app
  catalogue/                     offline, versioned assets (JSON) — see §3
  tests/                         pytest; fixtures in tests/fixtures are clearly labelled TEST data
  var/                           runtime state (git-ignored): plans, results, families, presets, caches
web/
  app/research/                  the new research page (primary entry)
  components/research/           inputs, conditions, variable cards, charts, indicators, evidence, export
  lib/research/                  types.ts (mirror of contracts.py), api.ts (client)
```

Prepared data lives in `web/public/data` (export-2 / series-2, see its README). The backend reads it through an
adapter; it never downloads, regrids or re-aligns anything at query time.

## 2. Conventions

- Internal numeric arrays are `numpy.float64` with `NaN` for missing. At the API boundary missing is `null`; run
  `contracts.json_safe` before serialising. Never fill gaps with zero or interpolation.
- Time index: `timeaxis.ym_to_index("YYYY-MM") = year * 12 + (month - 1)`; `index_to_ym` inverts it. Annual series
  use the integer year. A series always carries its true calendar positions — dropping missing months must never
  compress calendar distance.
- All numeric policy (thresholds, weights, alpha, windows) is read from `backend/catalogue/policies/*.json`. No
  magic numbers in analysis code or in the front-end.
- No demo numbers. When data is not delivered the answer is a status (`data_required`, `no_series`, …), never a
  synthetic value. Test fixtures live only under `backend/tests/` and say so.
- Every public function that can fail for a user-visible reason raises `AquaError(code, message)`.
- UI text is English (as in the existing site); catalogue entries carry `label` (English) and `label_zh`.

## 3. Offline catalogue (`backend/catalogue/`)

| File | Content |
| --- | --- |
| `manifest.json` | `dataset_version`, `catalogue_version`, `region_catalogue_version`, `indicator_registry_version`, `quality_policy_version`, `series_index`, `event_catalogues`, `baselines`, `asset_status` (`ready / pending / invalid` + missing fields + reason per asset) |
| `concepts.json` | `{version, concepts: [VariableConcept]}` |
| `products.json` | `{version, products: [Product]}` — `product_id` equals the series-2 layer id |
| `refs.json` | `{version, refs: [ScientificRef]}` — only references that were checked to exist |
| `baselines.json` | `{version, baselines: [Baseline]}` — fixed seasonal reference per product, calibration reference per recipe |
| `phenomena.json` | curated phenomenon notes: `{version, phenomena: [{phenomenon_id, label, label_zh, aliases, description, variable_links: [{variable_id, role, statement, limits, ref_ids}], indicator_ids, unanswerable_notes}]}` — offline scientific context read by the selector; it is *context*, not a whitelist of accepted inputs |
| `indicators.json` | `{version, recipes: [IndicatorRecipe]}` (data contract §7) |
| `events/index.json` | `{version, catalogues: [{catalogue_id, phenomenon_id, status: ready|pending, ...}]}`; event files + coverage records sit beside it when delivered |
| `manual_presets.json` | versioned manual adjustments: add / pin / priority / disable + reason |
| `policies/*.json` | `method_policy`, `preset_policy`, `quality_policy` |

VariableConcept: `variable_id, label, label_zh, description, quantity_definition{quantity, nature(stock|flux|state|index), depth_or_height, observed_or_modelled}, unit, temporal_support, data_kind, scientific_refs[ref_id], approved_product_ids[ordered, 1st = primary], baseline_ref{product_id: baseline_id}, relative_change(null | {denominator, condition}), display_semantics{color, increase_reads, decimals, orb_channel|null}`.

Fixed concept ids (products in approved priority order; a product is a fallback only for the *same* physical
quantity — same category is not enough):

| `variable_id` | approved products (series-2 layers) |
| --- | --- |
| `precip` | `p_imerg`, `p_gpcp`, `p_m2` |
| `et` | `et_m2`, `et_m2land`, `et_gldas` |
| `pet` | `pet_gldas` |
| `soil_moisture_root` | `sm_root` |
| `soil_moisture_column` | `sm_total` |
| `soil_moisture_top` | `g1_soil_top` |
| `soil_wetness_root` | `sm_m2` |
| `tws_anomaly` | `tws` |
| `runoff` | `runoff`, `ro_m2` |
| `swe` | `swe` |
| `tair` | `tair` |
| `tsurf` | `tsurf_m2` |
| `lst_day` | `lst_day` |
| `vpd` | `vpd` |
| `net_radiation` | `rn`, `rn_m2` |
| `sw_down` | `swdown` |
| `wind` | `wind` |
| `ndvi` | `ndvi` |
| `sst` | `sst` |

`p_m2land` is land-only precipitation from the same model as `p_m2`; it stays a registered product of `precip`
but is not in the approved fallback order unless the catalogue owner documents why it is equivalent.

## 4. Module interfaces

```python
# ---- store ---------------------------------------------------------------
class PreparedSeries:            # dataclass
    region_id: str; variable_id: str; product_id: str; dataset_version: str
    cadence: str                 # "monthly"
    calendar: str                # "gregorian"
    unit: str; temporal_support: str
    t: np.ndarray                # int month index, strictly increasing, contiguous calendar axis
    values: np.ndarray           # float64, NaN = missing
    quality_flags: list[str | None] | None

class PreparedDataStore:
    @classmethod
    def open(cls, catalogue_dir=None, data_dir=None, cache_dir=None) -> "PreparedDataStore"
    versions: dict[str, str]     # dataset_version, catalogue_version, region_catalogue_version,
                                 # indicator_registry_version, quality_policy_version
    manifest: dict               # incl. asset_status
    def snapshot_id(self) -> str                     # hash of all versions
    def policy(self, name: str) -> dict              # "method_policy" | "preset_policy" | "quality_policy"
    def concepts(self) -> dict[str, dict]; def concept(self, variable_id) -> dict
    def products(self) -> dict[str, dict]; def product(self, product_id) -> dict
    def refs(self) -> dict[str, dict]
    def phenomena(self) -> list[dict]
    def baseline(self, baseline_id) -> dict
    def indicator_recipes(self) -> dict[str, dict]
    def regions(self) -> dict[str, dict]             # id, name, name_zh, type, geometry_ref, geometry_version, centroid, bbox, area_km2, surface, series_available
    def region(self, region_id) -> dict              # raises AquaError("unknown_region")
    def available_products(self, region_id) -> list[str]
    def series(self, region_id, product_id) -> PreparedSeries | None   # None = no prepared series (never substitutes a parent/neighbour)
    def product_matrix(self, product_id) -> tuple[list[str], np.ndarray, np.ndarray]   # region_ids, t, values[R, T] (cached binary)
    def event_catalogues(self) -> list[dict]
    def events(self, catalogue_id, region_id) -> list[dict] | None      # None = not delivered
    def event_coverage(self, catalogue_id, region_id) -> dict | None

# ---- stats ---------------------------------------------------------------
def climatology(t, y, base_start, base_end, min_samples) -> Climatology   # .cycle[12], .counts[12], .ok, .reason
def anomalies(t, y, cycle) -> np.ndarray                                  # y - cycle[month]; trend kept
def fit_trend(t, y, *, cadence, policy, data_kind="continuous") -> TrendFit
    # TrendFit: slope_per_year, slope_per_decade, intercept, ci95_per_decade | None, p_raw | None,
    #           inference_status, inference_reason, lag, lag_policy, covariance, n_valid, n_expected,
    #           coverage, longest_gap, diagnostics[list[Diagnostic]], fitted(t) helper
def fit_trend_batch(t, Y, *, cadence, policy) -> BatchTrendFit           # vectorised over rows, same numbers as fit_trend
def half_slopes(t, y) -> tuple[float | None, float | None]               # descriptive stability check
def by_adjust(p: np.ndarray) -> np.ndarray                               # Benjamini–Yekutieli adjusted p
def hypothesis_id(components: dict) -> str                               # stable hash of the canonical components
class EvidenceController:                                                # builds EvidenceFamily records
    def build_family(self, scope, candidate_policy, records: list[HypothesisRecord], *, complete: bool) -> EvidenceFamily

# ---- indicators ------------------------------------------------------------
class IndicatorRegistry:
    def __init__(self, store): ...
    def recipe(self, indicator_id) -> dict           # raises AquaError for unknown ids
    def requirements(self, indicator_id) -> dict     # {variable_id, min_history_months, calibration: {start, end}, cadence, unit_support}
    def compute(self, indicator_id, *, series: PreparedSeries | None, region_id, analysis_period, product_decision) -> IndicatorComputation
        # IndicatorComputation: status, status_reason, monthly index series, derived events (full history first,
        # then clipped with censoring flags), annual metric series (frequency / duration / severity as applicable)
    def compute_recorded(self, phenomenon_id, *, region_id, analysis_period) -> IndicatorComputation   # recorded_event; data_required when the catalogue is pending

# ---- selection -------------------------------------------------------------
class PhenomenonSelector:
    def __init__(self, store, provider=None, plan_dir=None): ...
    def select(self, query: str, *, reselect: bool = False) -> SelectionPlan
        # reuses the persisted plan for the same normalised query + catalogue/model/prompt versions unless reselect
        # raises AquaError("selector_unavailable" | "selector_invalid_output" | "empty_query")
    def load(self, selection_plan_id) -> SelectionPlan

# ---- resolver / presets / engine (second wave) -------------------------------
class PlanResolver:  resolve_products(...), common_period(...)
class PresetEngine:  search(plan, user_constraints) -> (presets, family); open(preset_ref)
class ResearchEngine:
    def run(self, request, catalogue_snapshot, policy_snapshot, *, on_stage=None, cancel=None) -> ResearchResult
```

## 5. Decisions already taken

- **Selector providers.** `AQUA_SELECTOR=auto|anthropic|claude_cli|catalogue_lexical`. `auto` uses the Anthropic API
  when `ANTHROPIC_API_KEY` is set and otherwise fails with `selector_unavailable` (503) unless a saved plan of the
  same versions exists. `catalogue_lexical` is an explicit, deterministic catalogue matcher for offline operation;
  it is labelled `is_language_model: false` in every plan and result and is never used silently.
- **Missing data in HAC.** Calendar-lag Bartlett HAC with zeroed scores for missing months (amplitude-modulated
  estimator); inference is refused (descriptive only, CI/p = null) when the policy's applicability checks fail.
- **Summary.** Deterministic template statements built from computed numbers, each with evidence ids. A failure
  here never hides numeric results.
- **Flood and other event phenomena.** No event catalogue has been delivered: recorded-event results are
  `data_required`; monthly precipitation is never relabelled as flood frequency.
- **Front-end.** Stays a static export; talks to the backend at `NEXT_PUBLIC_API_BASE` (default
  `http://localhost:8000`). The old `/explore` page is kept and labelled as the earlier GLDAS demo.
