# Preset policy and preset search

How the Earth System Trend Detective fills a blank region and / or period (spec §8, §7.3; data contracts §8,
§9.1, §9.3; acceptance P01–P09, T09–T11, T16 and section 7).

- Code: `backend/aqua_trend/presets/` (`candidates.py`, `batch.py`, `scoring.py`, `manual.py`, `policy.py`,
  `service.py`).
- Numbers: `backend/catalogue/policies/preset_policy.json` (`preset-1.1.0`) — every weight, window length, cap
  and rule below is read from that file through `store.policy("preset_policy")`. The weights are product
  defaults, not scientific constants.
- Manual settings: `backend/catalogue/manual_presets.json`.
- Admin batch: `backend/scripts/build_presets.py`.

A preset is an **exploration suggestion**. Its interest score is not evidence, a role is not a causal claim,
and the search never changes a field the user filled in.

## 1. The four input combinations

| User filled | Preset engine | Result |
|---|---|---|
| nothing | searches candidate regions × candidate periods | one region + one period (`resolved.*.source = "preset"`) |
| region only | searches the candidate periods of **exactly that region id** | one period; the region is returned unchanged |
| period only | searches the candidate regions for **exactly that period** | one region; the period is returned unchanged |
| region and period | is not called | `preset_status = "not_needed"` |

No candidate qualifies → `preset_status = "no_matching_preset"`, `preset_missing` names the blank field(s) and
`preset_reason` states why (taken from the candidate record). The engine never moves to a parent or a
neighbouring region and never stretches, shortens or shifts a period to make a preset fit.

## 2. Candidates — declared before anything is computed

`candidates.declare_candidates` reads **data availability only** (which approved products have a prepared
series, which months hold a value, whether the fixed baseline / calibration is supported). It reads no slope,
p-value or index value, so the list cannot depend on a result.

**Candidate regions** (`candidate_region_layers`): every catalogue region of the layers `basin3`, `named`,
`ice`, `lme`, `sea` that has a prepared series of an approved product of at least one selected variable.
`basin4` sub-basins are reachable by user selection but are not searched automatically; `hex` cells have no
series at all. A region the user selected is the **only** candidate region, whatever its layer.

**Candidate periods** per region:

1. the *common period*: the intersection of the valid data of every selected variable whose approved product
   supports a trend on its record (`PlanResolver.common_period`);
2. `also_test_full_common_period: true` → that full common period;
3. fixed calendar windows of `window_lengths_years` = 10, 20 and 30 years, January of the start year to
   December of the end year, lying inside the complete calendar years of the common period. The newest window
   of each length ends in the last complete common year; older ones are stepped backwards by
   `window_step_years` = 5.

A period the user selected is the **only** candidate period (exactly those months).

**Validity** (`min_variables_fraction` = 0.5): a (region, period) is analysed only when at least half of the
selected variables have an approved product that supports a trend for exactly that region and period. Other
candidates are `excluded` before any computation and stay in the record with the reason. A region with no
usable series or no common period is listed under `regions.excluded` with the reason.

**What is stored** (`var/preset_searches/<search_id>.json`): the policy document, the window rule, the user
constraints, every candidate with `status` (`analysed` / `excluded`), `reason`, score, components and evidence
counts, the excluded regions, the manual settings applied and not applied, versions, counts and timings. The
list is reproducible: `declare_candidates` on the same data and policy returns the same list in the same
order (tested on the real data).

## 3. Search — the engine's numbers

Every analysed candidate gets the numbers of `ResearchEngine.analyse_candidate` (the code path of a normal
research). `batch.BatchAnalyser` fits all regions of one (variable or indicator metric, product, period) in
one `stats.fit_trend_batch` call — the function the engine itself calls for a single series. Product
decisions, fixed-baseline anomalies, indicator series and hypothesis components come from the engine and the
resolver; every non-ordinary case (no series, unsupported baseline, blocked recipe, recorded events, an index
whose overlap lag cannot be reached) is delegated to the engine's own method, so statuses and reasons are
never re-implemented.

Equality is enforced twice: the first row of every group is also computed by the engine and must match
(otherwise the search stops with `internal_error` and nothing is published), and the tests compare whole
candidates — hypothesis ids, statuses, slopes, raw p-values, coverage, half slopes, hypothesis records — with
`analyse_candidate` on the TEST release and on the real data, including multi-region groups with SPI recipes.

**Cache.** A search is keyed by the selection-plan content hash (with its variable / indicator set), the user
constraints, `store.snapshot_id()` (data, geometry, catalogue, policies, manual settings), the policy
versions and the engine / statistics / preset-engine versions. Only a **complete** search is stored as
complete and reused; a stored record whose versions differ from the running ones is recomputed.

**Cancel.** A research run hands its cancel signal to the search. A cancelled search stores a record with
`complete: false, status: "cancelled"`, publishes no preset, no family and no corrected label, and is never
served from the cache.

## 4. The preset-search family

One search = one family (`scope: "preset_search"`): **every hypothesis of every analysed candidate** — regions
× periods × (variable anomaly trends + every metric of every selected indicator recipe + recorded-event
metrics). Tested hypotheses are Benjamini–Yekutieli-adjusted together (`method_policy.fdr`); hypotheses
without a valid p-value stay listed with `tested: false` and the reason, and do not enter the denominator.
Excluded candidates are in the search record with their reasons.

The family is stored in full (`var/families/<family_id>.json`). Presets and results carry `family_id`, the
locator `family:<family_id>`, `n_candidates` / `n_tested` / `n_untested`, method, alpha, the policy (candidate
rule, window rule, user constraints, digest of the candidate list) and `complete`. Only a completed batch is
labelled final.

Opening a preset (`context.preset_ref`) loads its **original** family; for the hypothesis ids it contains it
stays the primary evidence, and the smaller per-request family does not replace it (T11). When the data,
geometry, catalogue, recipe, baseline, policy or code version changed since the search, the old correction is
not attached to numbers computed now: the search is repeated under the current versions, a new preset version
naming the one it `supersedes` is stored, and the old version and family remain on disk as history (T16). A
preset record that was not produced by a stored search (no family, no recorded search conditions) is opened
as it is, without any preset-search correction.

## 5. Interest score

Four components in [0, 1], combined by a fixed weighted mean (`weights`: relevance 0.30, effect 0.30,
quality 0.25, stability 0.15). "Analysable" = the variable's product supports the trend for the candidate and
a slope can be described.

| Component | Definition |
|---|---|
| relevance | role-weighted share of the selected variables that are analysable (`core_indicator` 1.0, `related_condition` 0.6, `response` 0.6) |
| effect | role-weighted mean over analysable variables of `x / (1 + x)`, where `x = abs(slope per decade) / sd` and `sd` is the standard deviation of the fixed-baseline anomalies inside the baseline period — dimensionless |
| quality | mean over analysable variables of coverage inside the window × (1 when inference is applicable, else `descriptive_only_factor` 0.5), minus `fallback_or_caveat_penalty` 0.2 (not below 0) for a fallback product or a registered caveat |
| stability | share of analysable variables whose first-half and second-half descriptive slopes have the sign of the full-window slope (variables without both half slopes or with a zero slope are left out) |

Rules:

- **Zero variance**: a variable without a positive baseline sd has no effect value; nothing is divided by
  zero. No variable with an effect value → the component is missing.
- **Missing component** (`missing_component_rule`): scores 0, is listed in `score.missing_components`, and the
  weights are not renormalised — a missing component is never full marks.
- **No count bonus**: every component is a mean or a share over the selected variables, so selecting more
  variables does not raise the score.
- **Significance is not an input.** Each candidate carries an evidence label from the family:
  `has_significant`, `none_significant` (tested, none significant) or `undetermined_only` (no trend supports
  inference; descriptive slopes only). The last two are different states and are never merged; candidates in
  any of the three states can rank.
- **Reasons** are assembled from computed numbers and carry `evidence_ids` (hypothesis ids, or
  `manual:<adjustment_id>`): the score formula with its components, the evidence counts in the family, the
  number of analysable variables with the kind of period, and the strongest standardised slopes with product,
  unit, coverage and raw / adjusted p-value or "undetermined". No free text is generated.

**Order and ids** (`tie_break`): pinned first, then manual priority ascending, score descending, `region_id`,
`period.start`, `period.end`. `preset_id` is a hash of (plan content hash, region, period) and is the same
across data versions; `version` is a hash of (search id, family id, superseded version). The same data,
policy and plan give the same presets, order and ids (P08).

**List size**: `max_presets_returned` = 12 automatic presets, at most `max_presets_per_region` = 2 per region
when the region is being recommended. The caps shorten the returned list only; nothing leaves the family.

A property to know when reading rankings: the effect is a slope per decade in baseline standard deviations,
and a short window can hold a steeper slope than a long one, so 10-year windows are frequent near the top.
Their evidence labels say whether such a slope is significant over the whole search (in the measured
searches of section 8 the top-ranked candidates are `none_significant`). The weights must not be tuned on
rankings; a change is a new `preset_policy` version and therefore a new search and new preset versions.

## 6. Manual adjustments

`backend/catalogue/manual_presets.json` (schema in `backend/catalogue/README.md`):

```jsonc
{
  "version": "manual-presets-1.0.1",            // bump on every change
  "adjustments": [
    {"adjustment_id": "2026-11-a", "action": "add",      "reason": "…", "phenomenon_id": "drought",
     "region_id": "named-taiwan-main-island", "period": {"start": "2003-01", "end": "2022-12"}},
    {"adjustment_id": "2026-11-b", "action": "pin",      "reason": "…", "region_id": "b3-…"},
    {"adjustment_id": "2026-11-c", "action": "priority", "reason": "…", "preset_id": "ps-…", "priority": 10},
    {"adjustment_id": "2026-11-d", "action": "disable",  "reason": "…", "region_id": "b3-…",
     "period": {"start": "2011-01", "end": "2020-12"}}
  ]
}
```

- `add` needs `region_id` and `period`; `pin` / `priority` / `disable` address candidates by `region_id`,
  `period` and / or `preset_id` (every filter stated must match). `phenomenon_id` limits an entry to plans
  that refer to that phenomenon. `reason` is required.
- An added candidate passes the same validity rule, is analysed by the same code and enters the same family.
  A manual setting cannot change a number, a validity status or a significance label, and cannot make an
  invalid candidate valid; an entry that matches no analysed candidate is listed under `manual.not_applied`.
- A manual setting never overrides a field the user filled: an entry naming another region or period than
  the user's is not applied to that request and is listed with the reason (P06).
- A disabled candidate is not returned as a preset but stays in the family.
- The file is part of `store.snapshot_id()`: a change gives a new search and new preset versions; the old
  versions stay on disk.

## 7. Field sources (P07, P09)

`resolved.region.source` / `resolved.period.source` are `"user"` or `"preset"`. When the phenomenon text
changes, the client keeps the fields whose source is `user` and leaves the others blank so that they are
recommended again (`PresetEngine.user_fields(result)` returns exactly the user-selected values). A
`preset_ref` that conflicts with a user field is rejected with `invalid_context`; the user's value stays.

## 8. Measured search sizes and timings

Real data `export-2.2026-11-14.2d8143913d72`, policy `preset-1.1.0`, 2 shared cores (load average ≈ 19–24
during the measurement, so the times are upper bounds for this machine). Plans from the explicit catalogue
matcher (`AQUA_SELECTOR=catalogue_lexical`, `is_language_model: false`), both fields blank,
`scripts/build_presets.py drought "marine heatwave" flood`.

Automatic layers: 417 catalogue regions (292 basin3, 42 named, 2 ice, 66 lme, 15 sea), 393 of them with a
prepared series.

| Plan | Variables + recipes | Regions considered / excluded | Candidates declared / analysed / excluded | Hypotheses (tested / untested) | Family file | Time |
|---|---|---|---|---|---|---|
| drought | 9 + SPI-3/6/12 | 389 / 28 | 1945 / 1546 / 399 | 37 104 (17 324 / 19 780) | 31 MB | 37–50 s |
| flood | 4 | 389 / 28 | 2723 / 2219 / 504 | 15 533 (7 941 / 7 592) | 14 MB | 8.3 s |
| marine heatwave | 4 | 387 / 32 | 3235 / 2247 / 988 | 8 988 (6 622 / 2 366) | 7 MB | 6.6 s |
| TEST plan of `tests/test_presets_realdata.py` | 3 | — | — | — | — | ≈ 6 s |

Drought, by stage (five runs): declare candidates 17–28 s, analyse 14–19 s, family 1.3–3.1 s, score and rank
0.2–0.9 s, store 2.4–3.9 s. The budget of the specification (well under a minute) is met with a wide margin by
plans without SPI recipes and only narrowly by the drought plan on this loaded machine. A search limited to one user region takes well under a second. A both-blank request served
from the stored search (new process, including the research itself) takes about 3 s; loading the 31 MB family
takes 0.7 s.

Where the drought time goes (cProfile): about 40 % is the SPI computation — 3 501 calibration checks by the
product resolver (389 regions × 3 approved precipitation products × 3 recipes) and 939 index computations by
the engine. The calibration check runs the complete SPI transform although it needs the calibration only;
`timeaxis.days_in_month` is called 2.25 million times; and `ResearchStorage._write` streams JSON through
`json.dump`. These are outside the preset package and are listed as change requests in the work-package
report; none of them changes a number.

Run `backend/scripts/build_presets.py` after a data or policy release so that the first blank request of a
phenomenon is answered from the stored search.
