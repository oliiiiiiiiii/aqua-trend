# Recorded-event catalogues (`backend/catalogue/events/`)

Interface reference: `docs/earth-system-data-contracts.md` §6, spec §7.4.
Aggregation code: `backend/aqua_trend/indicators/recorded.py`.

## Current state: nothing delivered

`index.json` lists delivery slots only. Every catalogue is `pending`, so every recorded-event result is
`data_required`. There are no event files here, and the code never treats an absent file as an empty catalogue
("zero events"). Do not add example or synthetic events to this directory — test events live in
`backend/tests/fixtures/indicators/` and are labelled as test data.

## What a delivery consists of

For a catalogue `<catalogue_id>`:

```
events/
  index.json                      registry entry switched to "ready" (see below)
  <catalogue_id>/events.json      {"catalogue_id", "version", "events": [RecordedEvent, ...]}
  <catalogue_id>/coverage.json    {"catalogue_id", "version", "coverage": [EventCoverage, ...]}
```

### Registry entry (`index.json` → `catalogues[]`)

| Field | Meaning |
| --- | --- |
| `catalogue_id` | Stable id; part of every hypothesis id built from this catalogue. |
| `phenomenon_id` | Phenomenon the catalogue records (one per entry). |
| `status` | `pending` until events **and** coverage are delivered and validated, then `ready`. |
| `priority` | Approved order when several catalogues exist for a phenomenon (1 = first). Exactly one catalogue is used per phenomenon / region / analysis; catalogues are never concatenated. |
| `version` | Immutable version of the delivered files. A changed delivery gets a new version. |
| `source_ref` | `{ref_id, title, url or doi, applies_to, curated_version}` of the source dataset (must be a checked, existing reference). |
| `definition_ref` | The event definition the dataset applies (inclusion criteria, thresholds), as text or reference id. |
| `canonical_ids` | `true` only for an integrated catalogue whose cross-source mapping and de-duplication policy were prepared upstream; then every event needs `canonical_event_id`. Otherwise `false`. |
| `severity_metric` | `null`, or `{name, unit, definition, annual_aggregation: "sum"}` naming the one entry of `metrics` that may be summed per year. `sum` is the only implemented aggregation (`index.json` → `aggregation_rule.severity_annual_aggregations`); any other value gives `not_applicable` for the severity metric rather than a silent sum. |
| `events_file`, `coverage_file` | Paths relative to this directory. |
| `missing`, `reason` | For `pending` entries: what has not been delivered. |

### RecordedEvent

```json
{
  "event_id": "<stable id inside the catalogue>",
  "canonical_event_id": "<only in integrated catalogues>",
  "phenomenon_id": "flood",
  "definition_ref": "<event definition used by the dataset>",
  "region_ids": ["<existing region id>", "..."],
  "start": "2015-06",
  "end": "2015-07",
  "time_precision": {"start": "month", "end": "month"},
  "time_bounds": {"start": {"earliest": "2015-06-10", "latest": "2015-06-20"}},
  "metrics": {"<name>": {"value": 0, "unit": "<unit>", "definition": "<what it measures>"}},
  "source_ref": "<ref id>",
  "source_version": "<dataset version>",
  "quality_flags": [],
  "censoring": []
}
```

(The values above only illustrate the shape; they are not an event.)

- `region_ids` is the prepared mapping to the existing region catalogue. It is delivered, not rebuilt at query
  time. An event counts once for each region it lists.
- `start` / `end` keep the source precision and must match `time_precision`:
  `year` → `YYYY`, `month` → `YYYY-MM`, `day` → `YYYY-MM-DD`, `time` → ISO 8601 with time zone.
  Never pad a coarse date with a made-up day or time. `end: null` means the event had not ended
  (`time_precision.end: null`, flag `ongoing`).
- `time_bounds` (optional, per end point) narrows the uncertainty interval with day-precision
  `earliest` / `latest`. Without it the interval is the whole stated year or month.
- `metrics` may be empty: an event without a severity value still counts for frequency.
- `censoring` uses `left`, `right`, `gap`, `ongoing`; `quality_flags` are free dataset flags
  (uncertain dates, registration quality, …).

### EventCoverage

```json
{
  "catalogue_id": "<catalogue_id>",
  "region_id": "<existing region id>",
  "phenomenon_id": "flood",
  "start": "1985-01",
  "end": "2023-12",
  "completeness": "complete | partial | unknown",
  "known_gaps": [{"start": "1999-03", "end": "1999-08", "reason": "<why>"}],
  "policy_version": "<detection / registration policy version>",
  "coverage_version": "<version of this coverage statement>"
}
```

Several records per region are allowed when completeness changes over time.

## How the records are used (fixed rules, `index.json` → `aggregation_rule`)

- **Zero only under declared completeness.** A calendar year without events is `0` only if the whole year lies
  inside a `complete` coverage record and no known gap touches it. `partial`, `unknown`, missing coverage,
  gaps and boundary years give `null`; the frequency metric is then `not_applicable`.
- **One count per event.** An event is attributed to the calendar year of its start, once — also when it is
  long, crosses New Year or crosses the analysis period. Events that began before the analysis period are
  listed with `left` censoring and are not counted again.
- **Coarse time stays coarse.** Year- or month-precision records get duration *bounds*; the annual duration sum
  of such a year is `null`. If the precision leaves the start year open, those years are `null`.
- **No cross-catalogue counting.** One approved catalogue is used. `canonical_event_id` de-duplication applies
  only to an integrated catalogue delivered as such.
- A catalogue's detection or registration policy can change over time. More records do not by themselves mean
  more natural events; this limitation is attached to every recorded-event result.

## Candidate sources (suggestions only — none is present in this repository)

These are existing datasets the team could evaluate and deliver later. Licence, event definition, region
mapping and — above all — a defensible coverage/completeness statement per region have to be checked by the
data owner before a catalogue can become `ready`.

| Candidate | Maintainer | Notes for evaluation |
| --- | --- | --- |
| EM-DAT, the Emergency Events Database (<https://www.emdat.be/>) | CRED, UCLouvain | Global disaster records from 1900 at country level. Entry criteria are impact-based (e.g. 10 or more deaths, 100 or more people affected, a declared emergency or a call for international assistance), so small events are absent by definition and reporting has changed over time. Open access for non-commercial use under its terms of use. |
| Dartmouth Flood Observatory, Global Active Archive of Large Flood Events | DFO, University of Colorado | Global catalogue of large flood events compiled from news, governmental and remote-sensing sources. Reporting-based: completeness varies by region and period. (Location of the current archive to be confirmed by the data owner.) |
| NOAA Storm Events Database (<https://www.ncei.noaa.gov/stormevents/>) | NOAA NCEI | United States only. Recorded event types and reporting procedures changed over the decades, which must be reflected in the coverage records. |

Country-level or point records need an upstream mapping to the region catalogue (`region_ids`) before delivery.
