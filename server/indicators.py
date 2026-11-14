"""Versioned drought-index and recorded-event computations on prepared inputs."""

import calendar
import math
import re
from datetime import date, datetime, timedelta
from statistics import NormalDist, fmean

from .science import analyze_series, month_label, month_number, valid_samples


SPI_SCALES = {"spi-3": 3, "spi-6": 6, "spi-12": 12}
EVENT_TYPES = {"recorded-flood": "flood", "recorded-drought": "drought"}
SPI_MINIMUM = 30
QUANTILE_FLOOR = 1e-12


def _log_shape_minus_psi(shape):
    """log(k) − digamma(k), with recurrence before the asymptotic expansion."""
    x = shape
    adjustment = 0.0
    while x < 8:
        adjustment += 1 / x
        x += 1
    z = 1 / (x * x)
    tail = 0.5 / x + z * (1 / 12 + z * (-1 / 120 + z * (1 / 252 - z / 240)))
    return math.log(shape / x) + adjustment + tail


def _gamma_model(observations):
    positive = [value for value in observations if value > 0]
    if len(positive) < 2:
        return None
    mean = fmean(positive)
    target = math.log(mean) - fmean(math.log(value) for value in positive)
    if target <= 1e-12:
        return None
    low, high = 0.0, max(1.0, 1 / target)
    for _ in range(66):
        mid = (low + high) / 2
        if _log_shape_minus_psi(mid) > target:
            low = mid
        else:
            high = mid
    shape = (low + high) / 2
    return {"shape": shape, "scale": mean / shape, "probability_zero": 1 - len(positive) / len(observations)}


def _gamma_probability(shape, x):
    """Regularized lower gamma ratio by series below the mode, continued fraction above."""
    if x <= 0:
        return 0.0
    if shape > 100_000:
        # At this shape the Wilson–Hilferty approximation avoids cancellation in lgamma.
        z = ((x / shape) ** (1 / 3) - (1 - 1 / (9 * shape))) * 3 * math.sqrt(shape)
        return NormalDist().cdf(z)
    prefix = math.exp(shape * math.log(x) - x - math.lgamma(shape))
    if x < shape + 1:
        term = total = 1 / shape
        for i in range(1, 10000):
            term *= x / (shape + i)
            total += term
            if abs(term) <= abs(total) * 1e-14:
                break
        return min(1.0, prefix * total)
    tiny = 1e-280
    b = x + 1 - shape
    c, d = 1 / tiny, 1 / b
    fraction = d
    for i in range(1, 10000):
        a = i * (shape - i)
        b += 2
        d = a * d + b
        c = b + a / c
        d = 1 / (d if abs(d) > tiny else tiny)
        c = c if abs(c) > tiny else tiny
        factor = c * d
        fraction *= factor
        if abs(factor - 1) <= 1e-14:
            break
    return max(0.0, 1 - prefix * fraction)


def _accumulated_rain(series, scale):
    rate = (series["unit"], series["temporal_support"]) == ("mm/day", "monthly_mean_rate")
    total = series["unit"] in ("mm", "mm/month") and series["temporal_support"] in ("monthly_total", "monthly_accumulation")
    if not (rate or total):
        raise ValueError("SPI requires a registered mean precipitation rate in mm/day or monthly totals in mm.")
    water = {}
    for time, value in valid_samples(series):
        index = month_number(time)
        if value is not None and value >= 0:
            year, month = divmod(index, 12)
            water[index] = value * calendar.monthrange(year, month + 1)[1] if rate else value
        else:
            water[index] = None
    indices = list(range(min(water), max(water) + 1)) if water else []
    accumulated = []
    for i in indices:
        window = [water.get(j) for j in range(i - scale + 1, i + 1)]
        accumulated.append(math.fsum(window) if None not in window else None)
    return indices, accumulated


def _spi_calibration(series, scale, baseline):
    indices, totals = _accumulated_rain(series, scale)
    low, high = month_number(baseline["start"]), month_number(baseline["end"])
    groups = [[] for _ in range(12)]
    valid = []
    for index, value in zip(indices, totals):
        if low <= index <= high and value is not None:
            groups[index % 12].append(value)
            valid.append(index)
    minimum = max(SPI_MINIMUM, baseline["minimum_samples"])
    models = [_gamma_model(group) if len(group) >= minimum else None for group in groups]
    calibration = {**baseline, "minimum_samples": minimum, "counts": [len(group) for group in groups],
                   "actual_support": {"start": month_label(valid[0]) if valid else None,
                                      "end": month_label(valid[-1]) if valid else None, "n_valid": len(valid)},
                   "scale_months": scale, "month_parameters": models,
                   "distribution": "Gamma MLE with probability mass at zero",
                   "quantile_floor": QUANTILE_FLOOR}
    return indices, totals, calibration


def spi_calibration_supported(series, recipe):
    """Determine product eligibility from the prespecified calibration, before any trends."""
    if not series or series.get("calendar") not in ("gregorian", "standard", "proleptic_gregorian") or series.get("cadence") != "monthly":
        return False
    try:
        _, _, calibration = _spi_calibration(series, SPI_SCALES[recipe["indicator_id"]], recipe["calibration_reference"])
        return None not in calibration["month_parameters"]
    except (KeyError, ValueError, TypeError):
        return False


def _spi_history(series, scale, baseline):
    indices, totals, calibration = _spi_calibration(series, scale, baseline)
    models = calibration["month_parameters"]
    if None in models:
        return indices, None, calibration
    result = []
    for index, value in zip(indices, totals):
        if value is None:
            result.append(None)
            continue
        model = models[index % 12]
        q = model["probability_zero"]
        probability = q + (1 - q) * _gamma_probability(model["shape"], value / model["scale"])
        result.append(NormalDist().inv_cdf(max(QUANTILE_FLOOR, min(1 - QUANTILE_FLOOR, probability))))
    return indices, result, calibration


def _dry_spells(indices, values):
    """Identify episodes over full history before selecting onset years or a viewing window."""
    events, unresolved = [], []
    j = 0
    while j < len(values):
        if values[j] is None or values[j] >= 0:
            j += 1
            continue
        first = j
        while j < len(values) and values[j] is not None and values[j] < 0:
            j += 1
        last = j - 1
        left = first == 0 or values[first - 1] is None
        right = j == len(values) or values[j] is None
        episode = values[first:j]
        if min(episode) > -1:
            # A gap may hide the qualifying threshold of an otherwise mild segment.
            if right or left:
                unresolved.append(indices[first] // 12)
            continue
        censoring = [side for side, applies in (("left", left), ("right", right)) if applies]
        events.append({"start": month_label(indices[first]),
                       "end": month_label(indices[last]), "time_precision": "month", "censoring": censoring,
                       "duration": None if censoring else len(episode),
                       "severity": None if censoring else -math.fsum(episode)})
    return events, set(unresolved)


def _annual_metric(metric_id, label, unit, year_values, period, requested_period, count=False):
    years = sorted(year_values)
    series = {"cadence": "annual", "calendar": "gregorian", "data_kind": "count" if count else "continuous",
              "unit": unit, "times": [str(year) for year in years], "values": [year_values[y] for y in years]}
    return {"metric_id": metric_id, "label": label,
            **analyze_series(series, None, period, requested_period=requested_period)}


def _summarize_years(years, events, complete, unknown, period, requested_period, duration_unit, severity_unit=None):
    starts = {y: [] for y in years}
    for event in events:
        if event["onset_year"] in starts:
            starts[event["onset_year"]].append(event)
    frequency, duration, severity = {}, {}, {}
    for year, incidents in starts.items():
        eligible = year in complete and year not in unknown
        frequency[year] = len(incidents) if eligible else None
        duration[year] = (fmean(e["duration"] for e in incidents)
                          if eligible and incidents and all(e["duration"] is not None for e in incidents) else None)
        severity[year] = (fmean(e["severity"] for e in incidents)
                          if eligible and incidents and all(e["severity"] is not None for e in incidents) else None)
    metrics = [
        _annual_metric("frequency", "Annual event starts", "events", frequency, period, requested_period, count=True),
        _annual_metric("duration", "Mean duration of events starting each year", duration_unit, duration, period, requested_period),
    ]
    if severity_unit:
        metrics.append(_annual_metric("severity", "Mean severity of events starting each year", severity_unit,
                                      severity, period, requested_period))
    return metrics


def _date_range(value):
    if not isinstance(value, str):
        raise ValueError("Missing event timestamp.")
    if re.fullmatch(r"[0-9]{4}", value):
        year = int(value)
        return date(year, 1, 1), date(year, 12, 31)
    if re.fullmatch(r"[0-9]{4}-[0-9]{2}", value):
        year, month = map(int, value.split("-"))
        return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    if len(value) == 10:
        day = date.fromisoformat(value)
    else:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if timestamp.utcoffset() is None:
            raise ValueError("Precise event times require a timezone.")
        day = timestamp.date()
    return day, day


def _endpoint(event, field):
    bounds = (event.get("time_bounds") or {}).get(field)
    if bounds:
        if isinstance(bounds, dict):
            earliest = bounds.get("earliest") or bounds.get("start")
            latest = bounds.get("latest") or bounds.get("end")
        else:
            earliest, latest = bounds
        low, high = _date_range(earliest)[0], _date_range(latest)[1]
        if low > high:
            raise ValueError("Event endpoint bounds are reversed.")
        return low, high
    return _date_range(event[field])


def _complete_ranges(coverage):
    """Union explicit complete coverage; subtract partial/unknown intervals and gaps."""
    positive, gaps = [], []
    for row in coverage:
        interval = (_date_range(row["start"])[0].toordinal(), _date_range(row["end"])[1].toordinal())
        (positive if row["completeness"] == "complete" else gaps).append(interval)
        for gap in row.get("gaps", []):
            gaps.append((_date_range(gap["start"])[0].toordinal(), _date_range(gap["end"])[1].toordinal()))
    merged = []
    for low, high in sorted(positive):
        if merged and low <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(high, merged[-1][1]))
        else:
            merged.append((low, high))
    for low, high in gaps:
        cut = []
        for a, b in merged:
            if a > high or b < low:
                cut.append((a, b))
            else:
                if a < low:
                    cut.append((a, low - 1))
                if b > high:
                    cut.append((high + 1, b))
        merged = cut
    return merged


def _contained(ranges, start, end):
    return any(a <= start.toordinal() and b >= end.toordinal() for a, b in ranges)


def event_coverage_status(coverage, period):
    """Classify this prefiltered source's coverage of the inclusive selector window."""
    if not coverage:
        return "uncovered"
    try:
        if period is None:
            start = min(_date_range(row["start"])[0] for row in coverage)
            end = max(_date_range(row["end"])[1] for row in coverage)
        else:
            start, end = _date_range(period["start"])[0], _date_range(period["end"])[1]
        complete = _complete_ranges(coverage)
        if _contained(complete, start, end):
            return "complete"
        if any(a <= end.toordinal() and b >= start.toordinal() for a, b in complete):
            return "partial"
        overlaps = [row["completeness"] for row in coverage
                    if _date_range(row["start"])[0] <= end and _date_range(row["end"])[1] >= start]
        if "partial" in overlaps:
            return "partial"
        if "unknown" in overlaps:
            return "unknown"
        return "uncovered"
    except (KeyError, TypeError, ValueError):
        return "unknown"


def _duration_days(event, start, end):
    if start[0] != start[1] or end[0] != end[1]:
        return None
    if len(event["start"]) == len(event["end"]) == 10:
        return (end[0] - start[0]).days + 1
    if ("T" in event["start"]) and ("T" in event["end"]):
        a = datetime.fromisoformat(event["start"].replace("Z", "+00:00"))
        b = datetime.fromisoformat(event["end"].replace("Z", "+00:00"))
        return (b - a).total_seconds() / timedelta(days=1).total_seconds()
    return None


def _event_flags(event):
    flags = event.get("censoring") or []
    if isinstance(flags, dict):
        return [key for key, active in flags.items() if active]
    if isinstance(flags, str):
        return [] if flags == "none" else [flags]
    return list(flags)


def _events_in_window(events, period):
    if not period:
        return []
    low, high = _date_range(period["start"])[0], _date_range(period["end"])[1]
    selected = []
    for event in events:
        first = _endpoint(event, "start")
        last = _endpoint(event, "end") if event.get("end") else None
        if first[0] > high or (last and last[1] < low):
            continue
        selected.append({**event, "overlaps_start_boundary": first[0] < low,
                         "overlaps_end_boundary": last is None or last[1] > high})
    return selected


def _recorded(result, catalogue, phenomenon, region, period, requested_period):
    if catalogue:
        result["event_source"] = {k: v for k, v in catalogue.items() if k not in ("events", "coverage")}
    if not catalogue or catalogue.get("status") != "ready":
        result.update(status="data_required", reason="A prepared event catalogue and its coverage are required.")
        return result
    coverage = [row for row in catalogue.get("coverage", [])
                if row["region_id"] == region and row["phenomenon_id"] == phenomenon]
    result["coverage"] = coverage
    if not coverage or not isinstance(catalogue.get("events"), list):
        result.update(status="data_required", reason="Event records and documented coverage are required for this region.")
        return result
    ranges = _complete_ranges(coverage)
    years = range(min(_date_range(row["start"])[0].year for row in coverage),
                  max(_date_range(row["end"])[1].year for row in coverage) + 1)
    complete = {year for year in years if _contained(ranges, date(year, 1, 1), date(year, 12, 31))}
    unknown, seen, events = set(), set(), []
    severity_definition = result["recipe"].get("severity_metric") or catalogue.get("severity_metric")
    samples = [row for row in catalogue["events"] if region in row["region_ids"] and row["phenomenon_id"] == phenomenon]
    # An optional single, explicitly defined severity quantity may come from the selected catalogue.
    definitions = {(severity["unit"], severity["definition_ref"])
                   for row in samples if (severity := (row.get("metrics") or {}).get("severity"))
                   and isinstance(severity, dict) and severity.get("unit") and severity.get("definition_ref")}
    if not severity_definition and len(definitions) == 1:
        unit, ref = next(iter(definitions))
        severity_definition = {"key": "severity", "unit": unit, "definition_ref": ref}
    for row in samples:
        event_id = row.get("canonical_event_id") or row["event_id"]
        if event_id in seen:
            continue
        seen.add(event_id)
        start = _endpoint(row, "start")
        end = _endpoint(row, "end") if row.get("end") else None
        if end and end[1] < start[0]:
            raise ValueError("An event ends before its possible onset.")
        flags = _event_flags(row)
        if end is None and "right" not in flags:
            flags.append("right")
        if end and not _contained(ranges, start[0], end[1]):
            flags.append("coverage_gap")
        year = start[0].year if start[0].year == start[1].year else None
        uncertain_start = year is None or any(key in flags for key in ("left", "left_censored", "unknown_start"))
        if uncertain_start:
            unknown.update(range(start[0].year, start[1].year + 1))
        duration = _duration_days(row, start, end) if end and not flags else None
        measurement = (row.get("metrics") or {}).get(severity_definition.get("key", "severity")) if severity_definition else None
        severity = None
        if (isinstance(measurement, dict) and not flags and measurement.get("unit") == severity_definition["unit"]
                and measurement.get("definition_ref") == severity_definition.get("definition_ref")
                and isinstance(measurement.get("value"), (float, int)) and math.isfinite(measurement["value"])):
            severity = measurement["value"]
        events.append({**row, "onset_year": year, "duration": duration, "severity": severity, "censoring": flags})
    result["events"] = _events_in_window(events, period)
    if severity_definition:
        result["severity_metric"] = severity_definition
    result["metrics"] = _summarize_years(years, events, complete, unknown, period, requested_period, "days",
                                         severity_definition["unit"] if severity_definition else None)
    return _result_status(result)


def _result_status(result):
    # A descriptive metric can be available even when trend inference is unsuitable.
    if any(m["actual_support"]["n_valid"] for m in result["metrics"]):
        result.update(status="ok", reason="")
    else:
        result.update(status="insufficient_data", reason="No eligible observations cover this period.")
    return result


def analyze_indicator(recipe, series_by_variable, event_catalogue, region_id, period, *, requested_period=None):
    indicator_id = recipe["indicator_id"]
    result = {"indicator_id": indicator_id, "recipe": recipe, "kind": "derived_indicator",
              "requested_period": requested_period, "analysis_period": period,
              "metrics": [], "events": [], "status": "not_applicable", "reason": ""}
    if indicator_id in EVENT_TYPES:
        result["kind"] = "recorded_event"
        try:
            return _recorded(result, event_catalogue, EVENT_TYPES[indicator_id], region_id, period, requested_period)
        except (KeyError, TypeError, ValueError) as error:
            result.update(status="insufficient_data", reason=f"Invalid prepared event record or coverage: {error}")
            return result
    if indicator_id not in SPI_SCALES:
        result.update(status="definition_required", reason="This indicator has no registered computation.")
        return result
    series = series_by_variable.get("precip")
    if not series:
        result.update(status="data_required", reason="SPI requires a prepared precipitation series for this region.")
        return result
    result["input_product"] = {k: series.get(k) for k in (
        "product_id", "dataset_version", "source_ref", "source_version", "source_asset", "unit", "temporal_support")}
    if series.get("calendar") not in ("gregorian", "standard", "proleptic_gregorian") or series.get("cadence") != "monthly":
        result.update(status="unsupported_resolution", reason="SPI requires Gregorian monthly precipitation.")
        return result
    baseline = recipe.get("calibration_reference")
    if not baseline:
        result.update(status="insufficient_baseline", reason="The fixed SPI calibration reference is missing.")
        return result
    try:
        indices, spi, calibration = _spi_history(series, SPI_SCALES[indicator_id], baseline)
    except ValueError as error:
        result.update(status="not_applicable", reason=str(error))
        return result
    result["calibration_reference"] = calibration
    if spi is None:
        result.update(status="insufficient_baseline",
                      reason="SPI requires at least 30 complete accumulations and a fit to positive precipitation for every calendar month of the fixed reference.")
        return result
    spi_series = {"times": [month_label(i) for i in indices], "values": spi, "cadence": "monthly",
                  "calendar": "gregorian", "unit": recipe.get("unit", "standard deviations"), "standardized_index": True}
    monthly = analyze_series(spi_series, calibration, period, requested_period=requested_period)
    result["metrics"].append({"metric_id": "index", "label": indicator_id.upper(), **monthly})
    events, unknown = _dry_spells(indices, spi)
    for event in events:
        event["event_id"] = f"{indicator_id}:{event['start']}"
        event["onset_year"] = int(event["start"][:4])
        if "left" in event["censoring"]:
            unknown.add(event["onset_year"])
    result["events"] = _events_in_window(events, period)
    years = range(indices[0] // 12, indices[-1] // 12 + 1)
    valid = {i for i, value in zip(indices, spi) if value is not None}
    complete = {year for year in years if all(12 * year + i in valid for i in range(12))}
    result["metrics"].extend(_summarize_years(years, events, complete, unknown, period, requested_period,
                                             "months", "SPI-months"))
    return _result_status(result)
