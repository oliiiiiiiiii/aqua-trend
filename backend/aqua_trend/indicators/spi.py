"""Standardized Precipitation Index (SPI) — pure functions.

Recipe: backend/catalogue/indicators.json ("spi3" / "spi6" / "spi12"), described in
docs/indicator-recipes.md.  Spec §7.4, data contract §7, acceptance E08 / E09.

Sources of the rule implemented here
- McKee, Doesken & Kleist (1993): k-month precipitation totals, fitted distribution per
  calendar month, equiprobability transform to the standard normal.
- WMO-No. 1090 (2012) SPI User Guide: definition, record length, zero is a valid value,
  a missing month is missing (never zero rain).
- Thom (1958) approximation of the gamma maximum-likelihood estimate and the mixed
  distribution H(x) = q + (1 - q) G(x) for zero totals, as used by Edwards & McKee (1997),
  NCL ``dim_spi_n`` and the ``climate-indices`` reference implementation.

Everything here works on plain numpy arrays: ``t`` is the integer month index
(``timeaxis.ym_to_index``), values are float64 with NaN = missing.  No parameter has a
default: every number comes from the recipe.  Nothing is ever filled or interpolated.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import stats as _st

from ..timeaxis import days_in_month

#: conversions an indicator recipe may approve (data contract §4.2: registered formulas only)
CONVERSIONS: dict[str, str] = {
    "rate_times_days_in_month": "monthly total [mm] = monthly mean rate [mm/day] x actual days of that month",
    "identity_monthly_total": "input already is a monthly total [mm]",
}


@dataclass(frozen=True)
class GammaFit:
    """Mixed gamma fit of one calendar month: H(x) = q + (1 - q) * G(x; alpha, beta)."""

    alpha: float            # gamma shape
    beta: float             # gamma scale (same unit as the totals)
    prob_zero: float        # q = zero totals / valid totals in the calibration sample
    n_valid: int
    n_zero: int
    n_positive: int
    ok: bool
    reason: str | None = None


@dataclass(frozen=True)
class SpiCalibration:
    """Fixed calibration of one SPI scale (12 calendar-month fits)."""

    scale: int
    start: int                       # month index, inclusive
    end: int                         # month index, inclusive
    fits: tuple[GammaFit, ...]       # 12 entries, January .. December
    samples_per_month: tuple[int, ...]
    min_samples: int
    min_positive: int
    ok: bool
    reason: str | None = None

    @property
    def failed_months(self) -> list[int]:
        """Calendar months (1..12) whose sample or fit does not meet the recipe."""
        return [m + 1 for m, f in enumerate(self.fits) if not f.ok]


def contiguous_axis(t: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Re-index onto a gap-free monthly axis; absent months become NaN (never zero).

    A k-month accumulation is a statement about k *calendar* months, so the running sum must
    run on true calendar positions (architecture §2).
    """
    t = np.asarray(t, dtype=np.int64)
    values = np.asarray(values, dtype=np.float64)
    if t.shape != values.shape or t.ndim != 1:
        raise ValueError("t and values must be 1-D arrays of the same length")
    if t.size == 0:
        return t, values
    if np.any(np.diff(t) <= 0):
        raise ValueError("month index must be strictly increasing")
    full_t = np.arange(t[0], t[-1] + 1, dtype=np.int64)
    full_v = np.full(full_t.shape, np.nan)
    full_v[t - t[0]] = values
    return full_t, full_v


def monthly_totals(t: np.ndarray, values: np.ndarray, conversion: str) -> np.ndarray:
    """Monthly precipitation totals in mm (acceptance E08).

    ``rate_times_days_in_month``: a monthly mean rate in mm/day is multiplied by the actual
    number of days of that calendar month (28/29/30/31, Gregorian leap years).  Missing stays
    missing.  Negative or non-finite precipitation is physically invalid and is treated as
    missing.
    """
    if conversion not in CONVERSIONS:
        raise ValueError(f"conversion {conversion!r} is not an approved rule")
    values = np.asarray(values, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        out = np.where(np.isfinite(values) & (values >= 0), values, np.nan)
    if conversion == "rate_times_days_in_month":
        days = np.array([days_in_month(int(i)) for i in np.asarray(t)], dtype=np.float64)
        out = out * days
    return out


def accumulate(totals: np.ndarray, scale: int) -> np.ndarray:
    """k-month running total ending at each month, on a contiguous monthly axis.

    Any missing month inside the k-month window makes the accumulation missing; the first
    ``scale - 1`` positions are missing (same convention as NCL ``dim_spi_n``).
    """
    if scale < 1:
        raise ValueError("scale must be >= 1")
    totals = np.asarray(totals, dtype=np.float64)
    out = np.full(totals.shape, np.nan)
    if totals.size < scale:
        return out
    windows = np.lib.stride_tricks.sliding_window_view(totals, scale)
    out[scale - 1:] = windows.sum(axis=1)      # plain sum: NaN propagates
    return out


def fit_gamma(sample: np.ndarray, *, min_samples: int, min_positive: int) -> GammaFit:
    """Fit the mixed gamma distribution of one calendar month.

    q = (zero totals) / (valid totals).  The two-parameter gamma is fitted to the positive
    totals with Thom's (1958) approximation of the maximum-likelihood estimate:

        A = ln(mean(x)) - mean(ln(x)),  alpha = (1 + sqrt(1 + 4A/3)) / (4A),  beta = mean(x) / alpha.

    The fit is refused (``ok=False``) when the sample is smaller than the recipe requires or
    when the positive totals cannot determine a gamma shape.
    """
    x = np.asarray(sample, dtype=np.float64)
    x = x[np.isfinite(x)]
    n_valid = int(x.size)
    pos = x[x > 0]
    n_pos = int(pos.size)
    n_zero = n_valid - n_pos
    q = n_zero / n_valid if n_valid else float("nan")

    def refuse(reason: str) -> GammaFit:
        return GammaFit(float("nan"), float("nan"), q, n_valid, n_zero, n_pos, False, reason)

    if n_valid < min_samples:
        return refuse(f"{n_valid} valid totals in the calibration period, {min_samples} required")
    if n_pos < min_positive:
        return refuse(f"{n_pos} non-zero totals in the calibration period, {min_positive} required for the gamma fit")
    mean = float(pos.mean())
    a = float(np.log(mean) - np.log(pos).mean())
    if not np.isfinite(a) or a <= 0:
        return refuse("non-zero totals are constant: the gamma shape is not identifiable")
    alpha = (1.0 + np.sqrt(1.0 + 4.0 * a / 3.0)) / (4.0 * a)
    return GammaFit(float(alpha), float(mean / alpha), q, n_valid, n_zero, n_pos, True)


def calibrate(
    t: np.ndarray,
    accumulated: np.ndarray,
    *,
    scale: int,
    cal_start: int,
    cal_end: int,
    min_samples: int,
    min_positive: int,
) -> SpiCalibration:
    """Fit the 12 calendar-month distributions on the FIXED calibration period.

    Only accumulations whose end month lies inside [cal_start, cal_end] are used.  The period
    is a recipe constant: it never depends on the analysis window (E09), and it is never
    shortened to what the product happens to cover — an unsupported period yields
    ``ok=False`` (-> ``insufficient_baseline``).
    """
    t = np.asarray(t, dtype=np.int64)
    acc = np.asarray(accumulated, dtype=np.float64)
    inside = (t >= cal_start) & (t <= cal_end)
    fits: list[GammaFit] = []
    for month in range(12):
        sample = acc[inside & (t % 12 == month)]
        fits.append(fit_gamma(sample, min_samples=min_samples, min_positive=min_positive))
    counts = tuple(f.n_valid for f in fits)
    bad = [m + 1 for m, f in enumerate(fits) if not f.ok]
    reason = None
    if bad:
        first = fits[bad[0] - 1]
        reason = (
            f"calibration requirement not met for calendar month(s) {bad}: "
            f"e.g. month {bad[0]}: {first.reason}"
        )
    return SpiCalibration(scale, int(cal_start), int(cal_end), tuple(fits), counts,
                          int(min_samples), int(min_positive), not bad, reason)


def transform(
    t: np.ndarray,
    accumulated: np.ndarray,
    calibration: SpiCalibration,
    *,
    bounds: tuple[float, float],
) -> np.ndarray:
    """Equiprobability transform to the standard normal: SPI = Phi^-1(H(x)).

    H(x) = q + (1 - q) * G(x) with G the fitted gamma CDF; a zero total has H = q.  The result
    is limited to the recipe's ``bounds`` so that probabilities of exactly 0 or 1 outside the
    calibration sample stay finite.  Months of a calendar month without a valid fit, and
    missing accumulations, stay NaN.
    """
    t = np.asarray(t, dtype=np.int64)
    acc = np.asarray(accumulated, dtype=np.float64)
    out = np.full(acc.shape, np.nan)
    lo, hi = bounds
    for month, fit in enumerate(calibration.fits):
        if not fit.ok:
            continue
        sel = (t % 12 == month) & np.isfinite(acc)
        if not sel.any():
            continue
        g = _st.gamma.cdf(acc[sel], a=fit.alpha, scale=fit.beta)
        h = fit.prob_zero + (1.0 - fit.prob_zero) * g
        with np.errstate(divide="ignore"):
            z = _st.norm.ppf(h)
        out[sel] = np.clip(z, lo, hi)
    return out


def zero_total_index(fit: GammaFit, bounds: tuple[float, float]) -> float | None:
    """SPI that a zero total receives in this calendar month: Phi^-1(q), within ``bounds``.

    With the mixed distribution a zero total has H = q, so Phi^-1(q) is the LOWEST value the
    index can take in a calendar month whose calibration sample contains zero totals.  Returns
    None when the fit is not usable or no zero total was observed (q = 0, no such floor).
    """
    if not fit.ok or fit.n_zero == 0:
        return None
    lo, hi = bounds
    return float(np.clip(_st.norm.ppf(fit.prob_zero), lo, hi))


@dataclass(frozen=True)
class SpiSeries:
    """Result of one SPI scale on the contiguous monthly axis of the input."""

    t: np.ndarray
    totals: np.ndarray        # monthly totals, mm
    accumulated: np.ndarray   # k-month totals, mm
    spi: np.ndarray           # NaN where missing / not calibrated
    calibration: SpiCalibration


def compute_spi(
    t: np.ndarray,
    values: np.ndarray,
    *,
    scale: int,
    conversion: str,
    cal_start: int,
    cal_end: int,
    min_samples: int,
    min_positive: int,
    bounds: tuple[float, float],
) -> SpiSeries:
    """Full recipe: unit conversion -> k-month totals -> fixed calibration -> SPI.

    When the calibration does not meet the recipe, ``spi`` is all NaN and
    ``calibration.ok`` is False; nothing is estimated from a shorter period.
    """
    full_t, full_v = contiguous_axis(t, values)
    totals = monthly_totals(full_t, full_v, conversion)
    acc = accumulate(totals, scale)
    cal = calibrate(full_t, acc, scale=scale, cal_start=cal_start, cal_end=cal_end,
                    min_samples=min_samples, min_positive=min_positive)
    spi = transform(full_t, acc, cal, bounds=bounds) if cal.ok else np.full(acc.shape, np.nan)
    return SpiSeries(full_t, totals, acc, spi, cal)
