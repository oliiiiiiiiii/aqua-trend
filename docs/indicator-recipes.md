# Indicator recipes and recorded-event rules

Companion to `earth-system-trend-detective-spec.md` §7.4 and `earth-system-data-contracts.md` §6–§7.
Machine-readable source of truth: `backend/catalogue/indicators.json` and `backend/catalogue/events/index.json`.
Code: `backend/aqua_trend/indicators/`. Tests: `backend/tests/test_indicators_*.py`.

The registry executes only what is registered here. It never invents a formula, a threshold or an event, and it
returns a status instead of a number whenever a requirement is not met. Trends of the series it returns are fitted
by the shared trend engine, so indicators go through the same quality, inference and multiple-comparison rules as
every variable.

| Result kind | Where it comes from | Registered |
| --- | --- | --- |
| `derived_indicator` | A standard recipe applied to one prepared product | `spi3`, `spi6`, `spi12` |
| `recorded_event` | An approved event catalogue with coverage records | none delivered → `data_required` |

## 1. Standardized Precipitation Index — `spi3`, `spi6`, `spi12` (version 1.0.0)

### 1.1 What it is

The SPI (McKee, Doesken & Kleist 1993) expresses how unusual the precipitation total of the last *k* months is,
compared with the historical distribution of the same calendar months, on the scale of the standard normal
distribution. The WMO recommends it as the index national services should use to characterise meteorological
drought (WMO-No. 1090, 2012). The three scales are three separate indicators with separate metric ids.

### 1.2 Input and declared history requirement

| Item | Requirement |
| --- | --- |
| Variable | `precip`, one approved product, the region's prepared monthly series |
| Unit / time support | `mm/day`, `monthly_mean_rate`, Gregorian calendar. Anything else → `unsupported_resolution` |
| Calibration period | fixed **1991-01 … 2020-12** (30 years), `baseline_id: spi_calibration_1991_2020` |
| Samples | all **30** *k*-month totals of every calendar month must be valid |
| Fit | at least 10 non-zero totals per calendar month (project engineering policy, see 1.6) |
| Required data period | `spi3`: 1990-11 … 2020-12; `spi6`: 1990-08 … 2020-12; `spi12`: 1990-02 … 2020-12 |

The requirement is part of the recipe (`IndicatorRegistry.requirements(indicator_id)`), so the product decision
can be made **before** any result exists (data contract §4.2). `IndicatorRegistry.calibration_support()` answers
"can this product's series support the calibration?" from data availability alone.

With the prepared products: GPCP (1979–) and MERRA-2 (1980–) support the calibration; GPM IMERG monthly (1998–)
does not. A product that cannot support it gives the indicator the status `insufficient_baseline` — the
calibration is not shortened, not moved, and not re-fitted on the analysis period. The precipitation variable's
own trend is unaffected (acceptance D10). No shorter alternative baseline is registered; one could only be added
as a new, explicitly named catalogue version (data contract §5.2).

Basis for the 30-year requirement: WMO-No. 1090 states that "At least 30 years of continuous monthly
precipitation data are needed but longer-term records would be preferable", and the NCL `dim_spi_n` documentation
recommends at least 30 years of monthly data. Demanding all 30 samples of every calendar month is this project's
strict reading (spec §7.4: insufficient data must not lower the standard).

### 1.3 Computation

1. **Monthly total.** `P_m = r_m × d_m`, with `r_m` the monthly mean rate in mm/day and `d_m` the actual number of
   days of that month (February has 29 days in Gregorian leap years).
2. **Accumulation.** `X_t = P_t + P_(t−1) + … + P_(t−k+1)` over *k* consecutive calendar months. If any of them is
   missing, `X_t` is missing. A missing month is never zero precipitation. The first *k − 1* months of a record
   have no value.
3. **Calibration**, separately for each calendar month, on the totals `X_t` ending in 1991-01 … 2020-12:
   - `q = (number of zero totals) / (number of valid totals)`;
   - gamma shape `α` and scale `β` from the non-zero totals with Thom's (1958) approximation of the
     maximum-likelihood estimate: `A = ln(mean(x)) − mean(ln x)`, `α = (1 + sqrt(1 + 4A/3)) / (4A)`, `β = mean(x) / α`.
4. **Cumulative probability.** `H(x) = q + (1 − q) · G(x; α, β)`, where `G` is the gamma distribution function.
   A zero total therefore has `H = q`: zero is a valid value, handled by the mixed distribution.
5. **Index.** `SPI_t = Φ⁻¹(H(X_t))`, `Φ` being the standard normal distribution function, limited to
   [−3.09, 3.09].
6. The fixed parameters are applied to every month of the record, inside and outside the calibration period.

The bound in step 5 is the numerical convention of the `climate-indices` reference implementation (it keeps the
index finite when a total outside the calibration sample has probability 0 or 1); it is not part of McKee et al.
(1993).

Thom's estimator is an approximation of the maximum-likelihood shape. Its error is negligible for shapes above 1
(below 1 %) and grows for very skewed samples (about 3 % at shape 0.6, 9 % at shape 0.3). On the prepared series
the smallest fitted shapes are about 0.6 (arid basins, SPI-3); there the index differs from an exact
maximum-likelihood fit by at most 0.03 SPI units, which is why the standard estimator is kept unchanged.

Negative or non-finite input values are physically invalid; they are treated as missing (never as zero) and the
result says how many there were.

### 1.4 Drought event rule

WMO-No. 1090, summarising McKee et al. (1993): "A drought event occurs any time the SPI is continuously negative
and reaches an intensity of -1.0 or less. The event ends when the SPI becomes positive. … The positive sum of
the SPI for all the months within a drought event can be termed the drought's 'magnitude'."

Implemented precisely as:

- An event is a maximal run of consecutive calendar months with `SPI < 0` whose minimum is `≤ −1.0`.
- It begins with the first month of the run (months before −1.0 is reached belong to it) and ends with the last
  month before the SPI is no longer negative. A month with SPI exactly 0 closes the run.
- duration = months in the run; severity (magnitude) = sum of |SPI| over the run; peak = minimum SPI.

Events are identified on the **full history** of the product. The analysis period is applied afterwards and only
adds flags, so a query window can never cut one event into two:

| Flag | Meaning |
| --- | --- |
| `left` | the event began before the analysis period (or the record starts inside the run) |
| `right` | the event continues after the analysis period |
| `gap` | the run is bounded by missing SPI months; its true beginning or end is unknown. Runs are not joined across a gap, and the observed part must reach −1.0 by itself |
| `ongoing` | the run reaches the last valid month of the record (`end` is null) |

A boundary-crossing event is listed once with its full start, end, duration and severity, plus the number of its
months inside the analysis period.

### 1.5 Metrics

| `metric_id` | Cadence | Meaning | Missing when |
| --- | --- | --- | --- |
| `<id>.index` | monthly | the SPI series itself | accumulation missing |
| `<id>.drought_event_starts_per_year` | annual, count | events whose first month falls in the calendar year; an event counts once, in its start year | year incomplete, or an event in it has an unknown beginning (gap / start of record) |
| `<id>.drought_months_per_year` | annual, count | months of the year that lie inside an event (an event crossing New Year contributes to both years) | year incomplete |
| `<id>.drought_severity_per_year` | annual | sum of |SPI| over those months | year incomplete |

A calendar year needs all 12 SPI months; otherwise every annual metric of that year is `null`, never zero. A
complete year without an event is a true zero. Only calendar years lying completely inside the analysis period
enter an annual trend. Annual metrics are **not** de-seasonalised again (the index is already standardised per
calendar month); the monthly index is marked `none_standardised`. Each metric is its own hypothesis in the
correction family (acceptance T15).

### 1.6 What the SPI can and cannot represent

It can represent: a *derived meteorological-drought* indicator — precipitation deficit of the region-mean series of
one product, relative to the fixed 1991–2020 distribution.

It cannot represent:

- every kind of drought. Evapotranspiration, temperature, soil moisture, snow, groundwater, streamflow and water
  management are not in it (the NCAR Climate Data Guide lists "does not account for evapotranspiration" as a key
  limitation). Agricultural, hydrological and socio-economic droughts and their impacts are not measured.
- observed events. SPI events are computed by rule from one product; they are labelled `derived_indicator` and are
  never merged with recorded events.
- floods. The recipe is not applicable to flood occurrence.
- dry climates well. Where many totals are zero (arid locations, dry seasons) the short-scale SPI is not normally
  distributed (Wu et al. 2007). The recipe refuses the gamma fit when a calendar month has fewer than 10 non-zero
  calibration totals. The value 10 is a project engineering policy; the cited standards prescribe no number.
- causes. A trend in an annual metric describes the selected period, product and region.

### 1.6a Limitations stated with each result

Besides the fixed limits above, every `ok` result carries the limitations that follow from *its own series* under
the fixed recipe. They are statements of fact derived from the recipe's parameters; no additional threshold is
involved.

| Statement | When | Why it matters |
| --- | --- | --- |
| Zero-total floor | a calendar month's calibration sample contains zero totals (`q > 0`) | A zero total maps to `Φ⁻¹(q)`, the lowest value the index can take in that calendar month. The note lists the months, the share of zeros and the floor, and names the months in which the floor lies above the event threshold (−1.0: no event can qualify from them) or is not negative (a rainless total closes a drought run). In arid basins of the prepared data `q` reaches 0.63, i.e. a rainless 3-month period gets SPI ≈ +0.3. |
| Values at the bound | any index month equals −3.09 or 3.09 | Such a value means "at least this extreme"; severity sums containing it are truncated. The note gives the counts and how many lie outside the calibration period. Many bounded months outside 1991–2020 mean that the product's precipitation there is outside the calibrated distribution — a change in climate or a change in the product (the index cannot tell which). Example in the prepared data: MERRA-2 SPI-12 of one Mekong-region basin is at −3.09 for 84 months in the 1980s. |
| Serial dependence (monthly index metric) | scale > 1 | Consecutive values share *k − 1* of their *k* months, so the monthly index is autocorrelated by construction; the trend engine's inference has to account for it. |
| Negative input | any negative value in the series | Treated as missing. |

The calibration record (`BaselineInfo`, kind `calibration_reference`) additionally carries the fitted parameters
per calendar month and `fit_check`: the mean and standard deviation of the index inside the calibration period
(ideal 0 and 1). It is an audit value, not a gate: the cited standards define no goodness-of-fit threshold, so
none is applied.

Statuses of a derived indicator: `ok`; `no_series`; `unsupported_resolution`; `insufficient_baseline`;
`insufficient_data` when the index is calibrated but no valid month and no whole calendar year lies inside the
analysis period (the full history is still returned). Each metric has its own status.

### 1.7 Numerical validation

- Against the independent `climate-indices` package (3.2.0, gamma distribution, monthly, calibration 1991–2020)
  on a synthetic test series with dry-season zeros: SPI-3/6/12 agree within 1e-6
  (`tests/fixtures/indicators/spi_reference_climate_indices.json`, test data only).
- Against an independent scipy derivation using the exact gamma maximum-likelihood fit: agreement within 0.03
  (Thom's estimator is an approximation of that fit).
- Properties: calibration-period SPI has mean ≈ 0 and standard deviation ≈ 1; leap-year February; missing month
  propagation; zero totals; fixed calibration unaffected by the analysis window and by data after 2020.
- On the prepared series of one region (`realdata` test): IMERG → `insufficient_baseline`; GPCP and MERRA-2 → `ok`.
- Independent review (2026-11-15): the fixture was regenerated with `climate-indices` 3.2.0 and is identical; a
  separately written loop implementation agrees with the code to 3e-12 on the prepared GPCP and MERRA-2 series
  of every fifth region; event detection and annual aggregation agree with an independent state-machine oracle on
  random test series with gaps (`tests/test_indicators_review.py`) and on 150 real series.
- All 1 664 regions with prepared series were run for all three scales and products: IMERG is always
  `insufficient_baseline`; GPCP is always `ok`; MERRA-2 is `ok` except SPI-3 in 21 arid basins where a calendar
  month has fewer than 10 non-zero calibration totals. Inside the calibration period 0.16 % of the months are at
  the value bound (0.2 % expected for a standard normal variable); outside it the share is higher (see 1.6a).

`climate-indices`, when a record does not cover the requested calibration period, falls back to the available
period. This recipe deliberately does not: it returns `insufficient_baseline`.

## 2. Phenomena without a derived recipe

`indicators.json → no_derived_recipe` records the phenomena for which a derived indicator was considered and
rejected. `IndicatorRegistry.derived_availability(phenomenon_id)` returns the status and reason.

**Flood: `definition_required`.** The prepared data are monthly region means. Flood occurrence depends on
sub-monthly rainfall intensity, antecedent conditions, river routing and local exposure, which they do not
resolve, and no approved standard derives flood frequency from them. Monthly precipitation or its anomaly is
therefore never labelled flood frequency (acceptance E10). Flood frequency needs a recorded-event catalogue (§3),
or a new recipe registered through the development process with data of sufficient resolution.

Any other phenomenon without a recipe gets `definition_required` with a generic reason. Its related environmental
variables can still be analysed.

## 3. Recorded events (`recorded_event`)

No event catalogue has been delivered. `IndicatorRegistry.compute_recorded()` returns `data_required` with no
events, no time axis and no zero counts (acceptance E04). Delivery formats and candidate sources are described in
`backend/catalogue/events/README.md`.

Once a catalogue is delivered, the fixed rules (`events/index.json → aggregation_rule`,
version `recorded-aggregation-1.0.0`) are:

| Topic | Rule |
| --- | --- |
| Catalogue | One approved catalogue per phenomenon, region and analysis: the `ready` catalogue of highest priority that has a delivery for the region. Catalogues are never concatenated. |
| De-duplication | By `event_id` within the catalogue. By `canonical_event_id` only when the catalogue declares an upstream-prepared integration. |
| Region | An event counts once for each region in its delivered `region_ids`. |
| Year attribution | The calendar year of the event's start, once — also for long events and events crossing the analysis period. Events that began before the period are listed with `left` and not counted again. |
| Time precision | Kept as delivered. A year- or month-precision record is an interval; no day or time is invented. If the precision leaves the start year open, the candidate years are `null`. |
| Duration | Inclusive calendar days, exact only when both ends are known to the day; otherwise `[min, max]` bounds and a `null` annual sum. Events without an end are `ongoing` and have no duration. |
| Zero | A year without events is 0 only if it lies wholly inside coverage declared `complete` and no known gap touches it. `partial`, `unknown`, absent coverage, gaps and boundary years are `null`; the metric is then `not_applicable`. |
| Severity | Sum of the catalogue's registered `severity_metric`; `not_applicable` if none is registered or if the catalogue declares an annual aggregation other than `sum` (nothing is summed silently), `null` for a year in which an event lacks the value. |
| Uncounted records | Events that start outside the coverage years, or in a year without declared complete coverage, stay listed; the result says how many were not counted. |

Metrics: `recorded.<phenomenon_id>.event_starts_per_year`, `.event_days_per_year`, `.severity_per_year`. They are
annual and not de-seasonalised.

What recorded-event statistics cannot represent: a catalogue reflects its detection and registration policy.
More records are not by themselves more natural events (spec §7.4); this limitation is attached to every result.

## 4. Sources

Checked on 2026-11-15. A URL is given only where the document was retrieved from it during this work.

- McKee, T.B., N.J. Doesken and J. Kleist, 1993: The relationship of drought frequency and duration to time
  scales. *Proceedings of the Eighth Conference on Applied Climatology*, Anaheim, California, 17–22 January 1993.
  American Meteorological Society, Boston, 179–184. (Cited as given in the reference list of WMO-No. 1090.)
- World Meteorological Organization, 2012: *Standardized Precipitation Index User Guide* (M. Svoboda, M. Hayes and
  D. Wood). WMO-No. 1090, Geneva.
  <https://www.droughtmanagement.info/literature/WMO_standardized_precipitation_index_user_guide_en_2012.pdf>
  — source of the quoted event criterion, the classification table and the record-length statements.
- NCAR Command Language, `dim_spi_n` function documentation.
  <https://www.ncl.ucar.edu/Document/Functions/Built-in/dim_spi_n.shtml> — two-parameter gamma fit with Thom
  (1958) estimates; leading *k − 1* values missing; at least 30 years recommended.
- Edwards, D.C. and T.B. McKee, 1997: Characteristics of 20th century drought in the United States at multiple
  time scales. Climatology Report 97-2, Department of Atmospheric Science, Colorado State University, Fort
  Collins. (Cited as given in WMO-No. 1090.)
- Thom, H.C.S., 1958: A note on the gamma distribution. *Monthly Weather Review*, 86(4), 117–122.
  doi:10.1175/1520-0493(1958)086<0117:ANOTGD>2.0.CO;2
- Guttman, N.B., 1999: Accepting the Standardized Precipitation Index: a calculation algorithm. *Journal of the
  American Water Resources Association*, 35(2), 311–322. doi:10.1111/j.1752-1688.1999.tb03592.x
- Wu, H., M.D. Svoboda, M.J. Hayes, D.A. Wilhite and F. Wen, 2007: Appropriate application of the Standardized
  Precipitation Index in arid locations and dry seasons. *International Journal of Climatology*, 27(1), 65–79.
  doi:10.1002/joc.1371
- Keyantash, J. and NCAR Staff (Eds): The Climate Data Guide: Standardized Precipitation Index (SPI).
  <https://climatedataguide.ucar.edu/climate-data/standardized-precipitation-index-spi>
- `climate-indices` Python package (J. Adams), version 3.2.0, <https://github.com/monocongo/climate_indices> —
  independent implementation used for the numerical validation; its source was read for the estimator and the
  value bounds.

The McKee (1993), Edwards & McKee (1997), Thom (1958), Guttman (1999) and Wu et al. (2007) texts were not
retrieved in full here. The entries of McKee (1993) and Edwards & McKee (1997) are taken from the reference list
of the WMO guide (re-read in review); those of Thom (1958), Guttman (1999) and Wu et al. (2007) were confirmed
against their Crossref DOI records (title, authors, journal, volume, issue, pages). The event criterion attributed to McKee et al.
is quoted from the WMO guide, the estimator formula was confirmed against the `climate-indices` source, and the
statement attributed to Wu et al. (2007) summarises that paper's stated finding without a fresh full-text check —
the catalogue owner should confirm it when the reference list is curated.
