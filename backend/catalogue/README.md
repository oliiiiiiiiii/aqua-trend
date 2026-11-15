# Offline catalogue (`backend/catalogue/`)

Versioned JSON assets that fix the scientific meaning of everything the backend analyses
(spec §5, §6.1, §7.1; `docs/earth-system-data-contracts.md` §2–§5, §8; `docs/implementation-architecture.md` §3).
They are read by `aqua_trend.store.PreparedDataStore`, which validates them at `open()` and never repairs or
defaults scientific content. Nothing here is looked up, downloaded or generated at query time.

| File | Owner | Content |
| --- | --- | --- |
| `manifest.json` | store | Declared catalogue version, the data release it was registered against, version rules, declared asset status (events: pending). |
| `concepts.json` | store | `{version, concepts[]}` — the physical variable concepts the selector may choose, with approved product order. |
| `products.json` | store | `{version, products[]}` — one product per series-2 layer (`product_id` = layer id). |
| `baselines.json` | store | `{version, selection_rule, baselines[]}` — one fixed seasonal reference period per approved product. |
| `refs.json` | store | `{version, refs[]}` — references that were checked to exist. |
| `phenomena.json` | store | `{version, roles, phenomena[]}` — curated context notes for the selector. |
| `manual_presets.json` | store / preset | `{version, adjustments[]}` — manual preset adjustments (empty). |
| `indicators.json` | indicators | `{version, recipes[]}` — standard indicator recipes (SPI-3/6/12) and their calibration baselines. |
| `events/` | indicators | `index.json` registry of recorded-event catalogues + delivery format (`events/README.md`). Nothing delivered yet. |
| `policies/*.json` | architecture | `method_policy`, `preset_policy`, `quality_policy` — every numeric threshold and weight. |

Prepared data itself (regions, geometry, monthly series) stays in `web/public/data` (export-2 / series-2).

## Rules that the validator enforces

`PreparedDataStore.open()` (and `tests/test_store_catalogue.py`) reject a catalogue in which

- an approved product is missing, belongs to another concept, or differs from its concept in `unit`,
  `temporal_support` or `definition_class` — *same category is not the same physical quantity* (spec §6.1);
- an approved product has no baseline, the baseline is registered for another product, lies outside the
  product record, does not cover complete calendar years, or asks for fewer valid years per calendar month than
  `quality_policy.baseline.min_samples_per_calendar_month_fraction`;
- a period other than a 30-year normal such as 1991-01..2020-12 is labelled `wmo_standard_normal`;
- `relative_change` is set for a °C, anomaly or index quantity, or lacks `denominator` / `condition`;
- a reference id, variable id, role or (once `indicators.json` is delivered) indicator id does not resolve;
- a required field is missing. Problems are reported per asset as `missing_fields` / `problems` in
  `store.manifest["asset_status"]`; a required asset that is invalid makes `open()` raise
  `AquaError("data_release_invalid")`, while pending assets (events, indicator registry) never block series.

A product whose cadence, calendar or unit is not supported, or whose unit differs from the prepared layer, is
kept in the catalogue but gets status `unsupported_resolution`; its series is never served as if it were an
ordinary Gregorian monthly series.

## `concepts.json`

One entry per physical concept (`variable_id` is what the selector outputs):

`variable_id, label, label_zh, description, quantity_definition{quantity, nature (stock|flux|state|index),
depth_or_height, observed_or_modelled, definition_class}, unit, temporal_support, data_kind, scientific_refs[],
approved_product_ids[] (first = primary), product_order_reason, baseline_ref{product_id: baseline_id},
relative_change (null | {denominator, condition, definition, caution}), relative_change_note,
display_semantics{color, increase_reads, decimals, orb_channel|null}`.

- The concept ids and product order are the table in the architecture note §3. The order is decided by
  observation basis, record length and known defects (`product_order_reason`) — never by which product shows the
  larger or more significant trend. A whole analysis uses one product; products are never spliced.
- `p_m2land` is registered under `precip` but is **not** approved (other `definition_class`; same model as
  `p_m2`, shorter record, never available without it).
- `et` is the MERRA-2 grid-cell total evaporation (`et_m2`, including open water). The land-only products
  `et_m2land` and `et_gldas` are registered under `et` for inspection but are **not** approved (other
  `definition_class`): land-only evapotranspiration is a different quantity wherever a region contains open
  water, so they are never used as a fallback and have no registered seasonal baseline.
- Air temperature (`tair`), model skin temperature (`tsurf`) and clear-sky daytime satellite skin temperature
  (`lst_day`) are three concepts; so are the three soil-water storages by depth and the MERRA-2 degree of
  saturation; `vpd` and `pet`; `net_radiation` and `sw_down`.
- `relative_change` is registered only for quantities that are non-negative by definition and rarely close to
  zero (precipitation, soil water storage, downward shortwave, wind speed). Everything else carries
  `relative_change_note` with the reason. The original-unit slope is always the primary result.
- `display_semantics.orb_channel` names the existing crystal-ball channel of the old front-end
  (`precip, et, runoff, soil_top, root_zone, tws, swe, tair`) or `null` when no channel has that physical meaning.

## `products.json`

`product_id, variable_id, agency, product_name, version, source_refs[], unit, physical_definition,
definition_class, native_resolution, prepared_resolution, temporal_support, cadence, calendar,
quality_limits[], caveat, caveat_zh, label_zh, nasa, family, start, end`.

- `unit`, `start`, `end`, `nasa`, `family`, `caveat_zh` mirror `web/public/data/catalog/variables.json`;
  the store serves the bounds of the delivered data, so `start`/`end` here are "as registered".
- `caveat` is the English form of the existing front-end caveat and must be shown wherever the product is used:
  GLDAS-2.1 ET / PET trend drift, MODIS Terra orbit drift after 2020, GRACE ~300 km resolution and earthquake
  jumps, GPCP and OISST are NOAA (not NASA) products.
- `version` says "not recorded in the export-2 hand-off" where the upstream export does not name the release
  (GRACE mascon release, MODIS collection). Do not replace it with a guess; ask the data owner.
- Statements marked "team finding W6 / W11" come from the upstream data team, not from an external reference.

## `baselines.json`

`baseline_id, version, kind ("seasonal_reference"), product_id, start, end, designation, rule, season_positions,
minimum_samples, samples_per_position, refs[], applies_to[]`.

The periods are fixed here and never follow the query period (spec §7.1). Selection rule (also in the file):

1. Record covers 1991-01..2020-12 → that period, `wmo_standard_normal` (`p_gpcp`, `p_m2`, `et_m2`, `sst`).
2. Otherwise 2001-01..2020-12, `registered_reference_mean` — the longest block of complete calendar years
   ending in 2020 that all products starting around 2000 cover (IMERG, MERRA-2 land, GLDAS, MODIS).
3. GRACE/GRACE-FO (`tws`): 2003-01..2022-12. With 2003–2020 the mission gaps leave 14–16 of 18 years per
   calendar month (below 80%); 2003–2022 gives 16–18 of 20 in all 1,664 regions of export-2.
4. `minimum_samples` = ceil(0.8 × years). A region below it is `insufficient_baseline`
   (e.g. NDVI at high latitudes, SST under sea ice); the period is not shortened at query time.

Periods were chosen from record coverage and missing-month counts only; no trend was inspected. The valid
samples per calendar month of a region come from `PreparedDataStore.baseline_support(region_id, product_id)`.
SPI calibration baselines (`calibration_reference`) belong to their recipe in `indicators.json`.

## `refs.json`

`ref_id, kind, title, authors, year, source, doi?, url, applies_to, curated_version, verified, verified_on,
verification`.

Only references that exist. `verified: true` means the DOI was resolved through Crossref / DataCite or the page
was fetched and read on `verified_on`; `verification` says which. Add a new entry with `verified: false`, check
it, then flip it — `tests/test_store_catalogue.py` fails while an unverified entry is shipped. `applies_to`
states what the reference supports; do not cite it for more than that.

## `phenomena.json`

`phenomenon_id, label, label_zh, aliases{zh[], en[]}, description, variable_links[{variable_id, role, statement,
limits, ref_ids[]}], indicator_ids[], unanswerable_notes[]`.

Context for the selector, **not** a whitelist: any phenomenon text is accepted, and an unlisted phenomenon is
judged against `concepts.json`. Roles (`core_indicator | related_condition | response`) describe curated
relevance, not causality shown by the data. Each link needs a statement that its references support and the
limits of the prepared variable. Phenomena that the data cannot address (dust / air quality, sea level, sea
ice) have no links and say so; event phenomena (flood, heatwave, marine heatwave, tropical cyclone, wildfire)
state that frequency / duration / severity need an event catalogue or daily data that is not delivered. Monthly
precipitation is never a flood count.

## `manual_presets.json`

```jsonc
{
  "version": "manual-presets-1.0.1",          // bump on every change; a change creates a new preset version
  "adjustments": [
    {
      "adjustment_id": "2026-11-example",      // unique, stable
      "action": "add | pin | priority | disable",
      "reason": "why a person made this change",   // required
      "author": "who",                          // optional
      "created": "YYYY-MM-DD",                  // optional
      // target — what the adjustment applies to
      "phenomenon_id": "drought",               // a phenomena.json id, or null for any phenomenon
      "region_id": "b3-…",                      // an existing region id
      "period": {"start": "YYYY-MM", "end": "YYYY-MM"},   // required for add; optional filter otherwise
      "preset_id": null,                        // pin / priority / disable may address an automatic preset by id
      "priority": 10                            // only for action "priority": smaller = shown earlier
    }
  ]
}
```

(The block above documents the shape; it is not an adjustment.) The store validates `version`,
`adjustment_id` (unique), `action` and `reason`; the preset engine applies the adjustments. A manual adjustment
can add, pin, reorder or disable a candidate — it cannot change a number, make an invalid analysis valid, turn
"not significant" into "significant", or override a condition the user filled in (spec §8.3).

## `manifest.json` and versions

`manifest.json` holds what is *declared*; `store.manifest` is the effective manifest after validation:
`dataset_version, catalogue_version, region_catalogue_version, indicator_registry_version,
quality_policy_version, versions{…}, series_index{…}, event_catalogues[], baselines[], product_status{…},
asset_status{asset: {status: ready|pending|invalid, missing_fields[], problems[], notes[], reason}}`.

| Version | How it is formed |
| --- | --- |
| `dataset_version` | `<export version>.<generated>.<hash>` over `catalog/variables.json`, `catalog/series_index.json` and the content (sha256 of every file) of `series/` — a changed value is a new version even when no file size changes. The content digest is memoised under the (name, size, mtime) fingerprint in `backend/var/cache/series-digest.json`. A data update therefore yields a new version and a new matrix cache directory (`backend/var/cache/<dataset_version>/`). |
| `catalogue_version` | declared `catalogue_version` + content hash of `concepts / products / refs / baselines / phenomena`. |
| `region_catalogue_version` | hash of `catalog/regions.json` and of every `geo/<layer>.geojson`. |
| `indicator_registry_version` | `version` of `indicators.json` (`not_delivered` while absent). |
| `quality_policy_version` (+ method, preset) | `version` of the policy file. |
| `event_catalogue_version`, `manual_presets_version` | `version` of `events/index.json` / `manual_presets.json` (`not_delivered` while absent). |
| `catalogue_content_digest` | content hash of `policies/*.json`, `indicators.json`, `manual_presets.json` and `events/**/*.json`. Their version strings are only declared; the digest makes an edit without a bump change `snapshot_id()`. Hypothesis ids still use the declared versions, so bump them. |
| `snapshot_id()` | hash of all of the above. |

### Bumping versions

1. Edit the file and bump its own `version` (`concepts-1.0.1`, …) — semantic: patch = wording, minor = added
   entries, major = changed meaning of an existing id.
2. Bump `manifest.json` → `catalogue_version` whenever any of the five catalogue files changed. (The content hash
   changes the effective version even if you forget; the declared version is what people read.)
3. A changed baseline period or rule gets a **new `baseline_id`** (the id carries the years) and a new
   `version`; never edit a baseline in place — old results refer to the old id.
4. After a data update: run the tests, review `baselines.json` coverage and product caveats against the new
   record, then set `dataset.registered_against_dataset_version` to the new `store.versions["dataset_version"]`.
   Until then `asset_status["data.series_index"].notes` reports the mismatch.
5. Run `backend/.venv/bin/pytest tests/test_store_catalogue.py tests/test_store_realdata.py`.
