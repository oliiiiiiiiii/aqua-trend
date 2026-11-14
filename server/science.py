"""Fixed-reference seasonal adjustment and calendar-aware trend inference."""

import math
import re
from statistics import fmean, stdev

METHOD_POLICY = {
    "version": "ols-calendar-hac-ar1-v2",
    "monthly_min_valid": 120,
    "monthly_min_span": 120,
    "annual_min_valid": 20,
    "min_coverage": 0.80,
    "monthly_max_gap": 12,
    "annual_max_gap": 2,
    "monthly_hac_lag": 12,
    "annual_hac_lag": 3,
    "min_nonzero_event_years": 5,
    "residual_autocorrelation_limit": 0.85,
    "quadratic_explained_residual_limit": 0.50,
    "confidence_level": 0.95,
    "lag_policy": "Fixed Bartlett bandwidth in calendar months (12) or years (3).",
    "uncertainty_policy": "Use the larger standard error from calendar-lag HAC and a stationary AR(1) residual covariance sensitivity model.",
}

_MONTH = re.compile(r"([0-9]{4})-(0[1-9]|1[0-2])\Z")


def month_number(time):
    match = _MONTH.fullmatch(time) if isinstance(time, str) else None
    if not match or match[1] == "0000":
        raise ValueError("Expected a Gregorian month in YYYY-MM format.")
    return 12 * int(match[1]) + int(match[2]) - 1


def month_label(number):
    year, month = divmod(number, 12)
    return f"{year:04d}-{month + 1:02d}"


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def valid_samples(series):
    times, values = series["times"], series["values"]
    flags = series.get("quality_flags")
    if len(times) != len(values) or (flags is not None and len(flags) != len(times)):
        raise ValueError("Prepared times, values and sample quality flags must align.")
    if times != sorted(set(times)):
        raise ValueError("Prepared timestamps must be unique and ordered.")
    for i, (time, value) in enumerate(zip(times, values)):
        yield time, value if _finite(value) and (flags is None or flags[i] in (None, "", "ok", "good", "valid")) else None


def adjust_by(p_values):
    """Benjamini–Yekutieli adjusted p-values in input order; nulls are untested."""
    valid = []
    adjusted = [None] * len(p_values)
    for i, p in enumerate(p_values):
        if p is None:
            continue
        if not _finite(p) or not 0 <= p <= 1:
            raise ValueError("A p-value must be finite and between zero and one.")
        valid.append((p, i))
    valid.sort()
    n = len(valid)
    multiplier = n * math.fsum(1 / k for k in range(1, n + 1))
    upper = 1.0
    for rank in range(n, 0, -1):
        p, i = valid[rank - 1]
        upper = min(upper, p * multiplier / rank)
        adjusted[i] = upper
    return adjusted


def _fit(indices, values):
    if len(indices) < 2:
        return None
    mean_x, mean_y = fmean(indices), fmean(values)
    centered = [i - mean_x for i in indices]
    sum_xx = math.fsum(x * x for x in centered)
    slope = math.fsum(x * (y - mean_y) for x, y in zip(centered, values)) / sum_xx
    return slope, mean_x, mean_y, sum_xx


def _split_slopes(indices, values, start, end, frequency):
    split = (start + end) // 2
    pivot = next((i for i, index in enumerate(indices) if index > split), len(indices))
    halves = [(indices[:pivot], values[:pivot]), (indices[pivot:], values[pivot:])]
    return [f[0] * frequency if (f := _fit(x, y)) else None for x, y in halves]


def _residual_diagnostics(indices, residual, mean_x, sum_xx, ss):
    centered = [x - mean_x for x in indices]
    # Orthogonalize the quadratic term against the intercept and linear trend.
    x2_mean = sum_xx / len(indices)
    x3 = math.fsum(x ** 3 for x in centered) / sum_xx
    quadratic = [x * x - x2_mean - x3 * x for x in centered]
    variance = math.fsum(q * q for q in quadratic)
    if variance > 0:
        gain = math.fsum(q * e for q, e in zip(quadratic, residual)) ** 2 / (variance * ss)
        if gain > METHOD_POLICY["quadratic_explained_residual_limit"]:
            return "Strong curvature makes a single linear rate unreliable for inference."
    return None


def _lag_one(indices, residual):
    neighbors = [(residual[i], residual[i - 1]) for i in range(1, len(indices)) if indices[i] == indices[i - 1] + 1]
    denominator = math.sqrt(math.fsum(a * a for a, _ in neighbors) * math.fsum(b * b for _, b in neighbors))
    return math.fsum(a * b for a, b in neighbors) / denominator if denominator else None


def _ar1_slope_variance(indices, mean_x, sum_xx, rho, marginal_variance):
    # Evaluate w' V w without forming V. Across a gap d the correlation is rho**d.
    carried = 0.0
    previous = indices[0]
    total = 0.0
    for index in indices:
        weight = (index - mean_x) / sum_xx
        carried *= rho ** (index - previous)
        total += weight * weight + 2 * weight * carried
        carried += weight
        previous = index
    return total * marginal_variance


def _trend(indices, values, bounds, cadence, kind, baseline_scale, unit, limitations):
    monthly = cadence == "monthly"
    frequency = 12 if monthly else 1
    n = len(values)
    start, end = bounds if bounds else (0, -1)
    expected = max(0, end - start + 1)
    coverage = n / expected if expected else 0.0
    lag = METHOD_POLICY["monthly_hac_lag" if monthly else "annual_hac_lag"]
    diagnostics = list(limitations)
    trend = {
        "slope_per_year": None, "slope_per_decade": None, "unit": unit,
        "slope_unit": f"{unit}/year", "ci_95": None, "ci_unit": f"{unit}/year",
        "interval_scope": "pointwise", "confidence_level": 0.95,
        "p_raw": None, "p_adjusted": {}, "primary_family_id": None, "significant": None,
        "method": "OLS with calendar-lag Newey–West and AR(1) sensitivity covariance, normal reference",
        "uncertainty_policy": METHOD_POLICY["uncertainty_policy"],
        "interval_interpretation": "Approximate pointwise 95% interval for the linear rate. Coverage depends on the residual structure and sample support.",
        "method_policy_version": METHOD_POLICY["version"], "lag": lag,
        "lag_policy": METHOD_POLICY["lag_policy"], "n_valid": n, "n_expected": expected,
        "coverage": coverage, "diagnostics": diagnostics, "baseline_scale": baseline_scale,
        "split_slopes_per_year": [None, None], "standard_error_per_year": None,
        "hac_se_per_year": None, "ar1_se_per_year": None, "lag_one_residual_correlation": None,
    }
    fit = _fit(indices, values)
    if fit is None:
        diagnostics.append("At least two valid observations are required to fit a slope.")
        return trend, None
    slope, mean_x, mean_y, sum_xx = fit
    trend.update(slope_per_year=slope * frequency, slope_per_decade=slope * frequency * 10,
                 split_slopes_per_year=_split_slopes(indices, values, start, end, frequency))
    if n < METHOD_POLICY["monthly_min_valid" if monthly else "annual_min_valid"]:
        diagnostics.append("Inference requires at least 120 valid months." if monthly else "Inference requires at least 20 valid years.")
    if monthly and indices[-1] - indices[0] + 1 < METHOD_POLICY["monthly_min_span"]:
        diagnostics.append("The observed span is shorter than ten years.")
    if coverage < METHOD_POLICY["min_coverage"]:
        diagnostics.append("Coverage is below 80% of the analysis period.")
    gaps = [indices[0] - start, end - indices[-1]] + [b - a - 1 for a, b in zip(indices, indices[1:])]
    if max(gaps) > METHOD_POLICY["monthly_max_gap" if monthly else "annual_max_gap"]:
        diagnostics.append("Missing observations form a gap longer than the registered limit.")
    if kind == "count" and sum(y > 0 for y in values) < METHOD_POLICY["min_nonzero_event_years"]:
        diagnostics.append("Fewer than five years have events. Counts are too sparse for linear inference.")
    residual = [(y - mean_y) - slope * (i - mean_x) for i, y in zip(indices, values)]
    ss = math.fsum(e * e for e in residual)
    tolerance = n * (max(abs(y) for y in values) * 1e-13) ** 2
    if max(values) == min(values):
        diagnostics.append("The fitted series is constant.")
    elif ss <= tolerance:
        diagnostics.append("Residual variation is too small to estimate uncertainty.")
    if diagnostics:
        return trend, fit
    reason = _residual_diagnostics(indices, residual, mean_x, sum_xx, ss)
    if reason:
        diagnostics.append(reason)
    rho = _lag_one(indices, residual)
    trend["lag_one_residual_correlation"] = rho
    if rho is None:
        diagnostics.append("Insufficient consecutive observations to assess residual persistence.")
    elif abs(rho) > METHOD_POLICY["residual_autocorrelation_limit"]:
        diagnostics.append("Strong residual persistence exceeds the registered HAC applicability limit.")
    if diagnostics:
        return trend, fit

    # With a centered intercept, this is the slope row of the sandwich "bread".
    # Missing months contribute no score; neighboring rows retain their actual date lag.
    score = {i: (i - mean_x) * e / sum_xx for i, e in zip(indices, residual)}
    variance = math.fsum(s * s for s in score.values())
    for distance in range(1, lag + 1):
        weight = 1 - distance / (lag + 1)
        variance += 2 * weight * math.fsum(s * score.get(i - distance, 0.0) for i, s in score.items())
    if variance <= 0:
        diagnostics.append("The calendar-lag covariance did not yield a positive variance.")
        return trend, fit
    hac_se = frequency * math.sqrt(variance * n / (n - 2))
    ar1_se = frequency * math.sqrt(_ar1_slope_variance(indices, mean_x, sum_xx, rho, ss / (n - 2)))
    se = max(hac_se, ar1_se)
    rate = slope * frequency
    delta = 1.959963984540054 * se
    trend.update(standard_error_per_year=se, hac_se_per_year=hac_se, ar1_se_per_year=ar1_se, ci_95=[rate - delta, rate + delta],
                 p_raw=math.erfc(abs(rate) / (se * math.sqrt(2))))
    return trend, fit


def _reference(indices, values, baseline):
    groups = [[] for _ in range(12)]
    counts = [0] * 12
    valid = []
    if baseline:
        low, high = month_number(baseline["start"]), month_number(baseline["end"])
        for index, value in zip(indices, values):
            if low <= index <= high and value is not None:
                groups[index % 12].append(value)
                valid.append(index)
        counts = [len(group) for group in groups]
    minimum = max(1, baseline.get("minimum_samples", 1)) if baseline else 1
    pattern = [fmean(group) if len(group) >= minimum else None for group in groups]
    metadata = {**(baseline or {}), "counts": counts, "actual_support": {
        "start": month_label(valid[0]) if valid else None,
        "end": month_label(valid[-1]) if valid else None,
        "n_valid": len(valid),
    }}
    scale_values = [y - ref for group, ref in zip(groups, pattern) if ref is not None for y in group]
    scale = stdev(scale_values) if len(scale_values) > 1 and None not in pattern else None
    return metadata, pattern, scale


def _bounds(period, annual):
    if period is None:
        return None
    start, end = month_number(period["start"]), month_number(period["end"])
    if end < start:
        raise ValueError("The end of an analysis period must follow its start.")
    return ((start + 11) // 12, (end - 11) // 12) if annual else (start, end)


def _raw_support(indices, values, times, bounds):
    if not bounds:
        return [], {"start": None, "end": None, "n_valid": 0, "n_expected": 0, "coverage": 0.0}
    start, end = bounds
    selected = [j for j, i in enumerate(indices) if start <= i <= end and values[j] is not None]
    expected = max(0, end - start + 1)
    return selected, {
        "start": times[selected[0]] if selected else None, "end": times[selected[-1]] if selected else None,
        "n_valid": len(selected), "n_expected": expected, "coverage": len(selected) / expected if expected else 0.0,
    }


def analyze_series(series, baseline, period, *, requested_period=None):
    """Use all prepared history for the fixed reference, fitting only the selected window.

    Annual inputs use YYYY and require a complete calendar year inside the query.
    SPI already expresses month-specific standardization and supplies its own reference.
    """
    cadence = series.get("cadence")
    unit = series.get("unit", "")
    unsupported = cadence not in ("annual", "monthly") or series.get("calendar") not in ("gregorian", "proleptic_gregorian", "standard")
    annual = cadence == "annual"
    time_label = str if annual else month_label
    points = {}
    if not unsupported:
        for time, value in valid_samples(series):
            if annual:
                if not re.fullmatch(r"[0-9]{4}", time) or time == "0000":
                    raise ValueError("Expected an annual timestamp in YYYY format.")
                index = int(time)
            else:
                index = month_number(time)
            points[index] = value
    indices = list(range(min(points), max(points) + 1)) if points else []
    values = [points.get(i) for i in indices]
    times = [time_label(i) for i in indices]
    pattern, reference, scale = [], baseline or {}, None
    anomalies = values[:]
    insufficient_reference = False
    if not annual and not unsupported and not series.get("standardized_index"):
        reference, pattern, scale = _reference(indices, values, baseline)
        insufficient_reference = None in pattern
        anomalies = [y - pattern[i % 12] if y is not None and pattern[i % 12] is not None else None
                     for i, y in zip(indices, values)]
    elif series.get("standardized_index"):
        scale = 1.0
    bounds = _bounds(period, annual)
    selected, support = _raw_support(indices, values, times, bounds)
    requested_support = support if requested_period == period else _raw_support(
        indices, values, times, _bounds(requested_period, annual))[1]
    fit_positions = [j for j in selected if anomalies[j] is not None and not insufficient_reference]
    limitations = list(series.get("inference_limitations", []))
    trend, fit = _trend([indices[j] for j in fit_positions], [anomalies[j] for j in fit_positions],
                        bounds, cadence, series.get("data_kind"), scale, unit, limitations)
    status, reason = "ok", ""
    if unsupported:
        status, reason = "unsupported_resolution", "The prepared cadence or calendar does not support this analysis."
    elif not points or not any(y is not None for y in values):
        status, reason = "insufficient_data", "This series has no valid observations."
    elif not period:
        status, reason = "no_common_period", "The selected variables have no common analysis period."
    elif insufficient_reference:
        status, reason = "insufficient_baseline", "The fixed reference lacks the required observations for one or more calendar months."
    elif not selected:
        status, reason = "insufficient_data", "No valid observations cover the analysis period."
    elif fit is None or trend["p_raw"] is None:
        status, reason = "insufficient_data", " ".join(trend["diagnostics"])
    elif len(selected) < trend["n_expected"]:
        reason = "The fit uses available observations at their original calendar positions."
    fitted = [None] * len(times)
    if fit:
        slope, center, intercept, _ = fit
        for j in fit_positions:
            fitted[j] = intercept + slope * (indices[j] - center)
    return {
        "status": status, "reason": reason, "unit": unit, "cadence": cadence,
        "requested_period": requested_period, "analysis_period": period, "actual_support": support,
        "requested_support": requested_support if requested_period else None,
        "full_history": {"times": times, "values": values, "anomalies": anomalies, "fitted": fitted},
        "baseline": reference, "seasonal_pattern": pattern, "trend": trend,
    }
