"""Synthetic regression fixtures only. Reference numbers were checked with SciPy 1.18.1/NumPy 2.5.4."""
import json
import math
import random
import unittest

from server.indicators import (
    analyze_indicator, event_coverage_status, spi_calibration_supported,
    _accumulated_rain, _dry_spells, _gamma_model, _gamma_probability,
)
from server.science import adjust_by, analyze_series, month_label, month_number


def monthly(times, values):
    return {"times": times, "values": values, "cadence": "monthly", "calendar": "gregorian",
            "unit": "mm/day", "temporal_support": "monthly_mean_rate", "product_id": "test-precip",
            "variable_id": "precip", "dataset_version": "test-science"}


def months(year, n):
    return [month_label(12 * year + i) for i in range(n)]


def period(low, high):
    return {"start": low, "end": high}


BASE = {**period("1980-01", "1989-12"), "minimum_samples": 10, "version": "test", "baseline_id": "test-season"}
WINDOW = period("1990-01", "2009-12")
SPI_BASE = {**period("1991-01", "2020-12"), "minimum_samples": 30, "version": "test", "baseline_id": "test-calibration"}


def noisy_months(year=1980, n=360, seed=971, rho=0.4, slope=0.252, missing=()):
    rng = random.Random(seed)
    residual = 0
    values = []
    for i in range(n):
        residual = rho * residual + rng.gauss(0, 1)
        value = slope * i / 12 + 4 * math.sin(i * 2 * math.pi / 12) + residual
        values.append(None if i in missing else value)
    return monthly(months(year, n), values)


def indicator(indicator_id, series, events=None, window=WINDOW):
    recipe = {"indicator_id": indicator_id, "version": "test", "calibration_reference": SPI_BASE}
    return analyze_indicator(recipe, {"precip": series} if series else {}, events, "region", window, requested_period=window)


def as_years(metric):
    h = metric["full_history"]
    return dict(zip(h["times"], h["values"]))


class TrendTests(unittest.TestCase):
    def test_known_slope_fixed_reference_history_and_refit(self):
        times = months(1980, 360)
        values = [7 * math.cos(i * math.pi / 6) + max(0, i - 119) / 6 for i in range(360)]
        series = monthly(times, values)
        first = analyze_series(series, BASE, WINDOW, requested_period=WINDOW)
        second = analyze_series(series, BASE, period("1997-04", "1998-12"))
        self.assertEqual(first["baseline"], second["baseline"])
        self.assertEqual(first["seasonal_pattern"], second["seasonal_pattern"])
        self.assertEqual(first["baseline"]["counts"], [10] * 12)
        self.assertEqual(first["full_history"]["times"], times)
        for raw, ref, anomaly in zip(values, first["seasonal_pattern"] * 30, first["full_history"]["anomalies"]):
            self.assertAlmostEqual(raw, ref + anomaly)
        self.assertAlmostEqual(first["trend"]["slope_per_year"], 2)
        self.assertAlmostEqual(first["trend"]["slope_per_decade"], 20)
        self.assertEqual(first["trend"]["ci_unit"], "mm/day/year")
        self.assertIsNone(first["trend"]["p_raw"])  # Exact line: no independent residual uncertainty.
        self.assertEqual(first["full_history"]["fitted"][:120], [None] * 120)
        self.assertEqual(first["requested_period"], WINDOW)
        unavailable = analyze_series(series, BASE, None, requested_period=WINDOW)
        self.assertEqual(unavailable["status"], "no_common_period")
        self.assertEqual(unavailable["full_history"]["values"], values)
        self.assertEqual(unavailable["actual_support"]["n_valid"], 0)
        self.assertEqual(unavailable["requested_support"]["n_valid"], 240)
        self.assertIsNone(unavailable["trend"]["slope_per_decade"])

    def test_hac_reference_uses_calendar_lag_across_gaps(self):
        s = noisy_months(missing={132, 135, 150, 252})
        # Deliberately omit one timestamp entirely. The engine must reconstitute that month.
        del s["times"][132]
        del s["values"][132]
        result = analyze_series(s, BASE, WINDOW)
        t = result["trend"]
        self.assertEqual(t["n_valid"], 236)
        self.assertEqual(t["n_expected"], 240)
        self.assertIsNone(result["full_history"]["values"][132])
        self.assertIsNone(result["full_history"]["fitted"][132])
        self.assertEqual(result["full_history"]["times"][132], "1991-01")
        # NumPy lstsq + independent X'u score matrix on a complete grid with absent scores = 0.
        self.assertAlmostEqual(t["slope_per_year"], 0.26073427403324345, places=12)
        self.assertAlmostEqual(t["hac_se_per_year"], 0.016610904380288578, places=12)
        # The independently evaluated AR(1) matrix has V[i,j] = sigma²*rho**abs(month[i]-month[j]).
        self.assertAlmostEqual(t["ar1_se_per_year"], 0.018155927511201674, places=12)
        self.assertEqual(t["standard_error_per_year"], max(t["ar1_se_per_year"], t["hac_se_per_year"]))
        self.assertAlmostEqual(math.log(t["p_raw"]), math.log(9.112299213690788e-47), places=10)
        self.assertAlmostEqual(t["ci_95"][0], 0.22514931000536823, places=12)
        self.assertEqual(t["interval_scope"], "pointwise")
        self.assertIsNone(t["significant"])

    def test_constant_short_curvature_concentrated_missing_and_bad_quality(self):
        constant = monthly(months(1980, 360), [5] * 360)
        self.assertEqual(analyze_series(constant, BASE, WINDOW)["trend"]["slope_per_year"], 0)
        cases = [
            (constant, WINDOW, "constant"),
            (noisy_months(), period("1990-01", "1991-12"), "120 valid"),
            (noisy_months(missing=set(range(146, 161))), WINDOW, "gap"),
            (monthly(months(1980, 360), [(i - 239) ** 2 if i >= 120 else 0 for i in range(360)]), WINDOW, "curvature"),
        ]
        for series, window, reason in cases:
            with self.subTest(reason=reason):
                output = analyze_series(series, BASE, window)
                self.assertIsNotNone(output["trend"]["slope_per_year"])
                self.assertIsNone(output["trend"]["p_raw"])
                self.assertIsNone(output["trend"]["ci_95"])
                self.assertIn(reason, output["reason"])
                json.dumps(output, allow_nan=False)
        s = noisy_months()
        s["quality_flags"] = ["ok"] * 360
        s["quality_flags"][0] = "invalid"
        out = analyze_series(s, BASE, WINDOW)
        self.assertEqual(out["status"], "insufficient_baseline")
        self.assertEqual(out["baseline"]["counts"][0], 9)
        self.assertIsNone(out["trend"]["slope_per_year"])
        self.assertEqual(out["actual_support"]["n_valid"], 240)
        self.assertIsNone(out["full_history"]["values"][0])

    def test_snapshot_and_invalid_inputs(self):
        series = monthly(["2020-01", "2020-03"], [0, 4])
        nofit = analyze_series(series, BASE, WINDOW)
        self.assertEqual(nofit["full_history"]["values"], [0, None, 4])
        self.assertEqual(analyze_series({**series, "calendar": "360_day"}, BASE, WINDOW)["status"], "unsupported_resolution")
        for times, values in [(["1999-01", "1999-01"], [2, 3]), (["2020-01"], [])]:
            with self.assertRaises(ValueError):
                analyze_series(monthly(times, values), BASE, WINDOW)
        with self.assertRaises(ValueError):
            month_number("2024-13")
        with self.assertRaises(ValueError):
            analyze_series(series, BASE, period("2022-01", "2020-03"))

    def test_by_matches_scipy_and_retains_untested(self):
        raw = [0.002, 0.23, None, 0.04, 0.036, 0.99, 0.013]
        expected = [0.0294, 0.6762, None, 0.147, 0.147, 1.0, 0.09555]
        for adjusted, reference in zip(adjust_by(raw), expected):
            if reference is None:
                self.assertIsNone(adjusted)
            else:
                self.assertAlmostEqual(adjusted, reference)
        self.assertEqual(raw[0], .002)
        self.assertEqual(adjust_by([None, None]), [None, None])
        with self.assertRaises(ValueError):
            adjust_by([math.nan])

    def test_registered_calibration_scenarios(self):
        # Fixed 200 replicates/scenario. These broad tolerances detect major calibration failures.
        # Monthly sinusoid + Gaussian AR(1), independent 10-year reference, 30-year fits.
        # Missing scenario removes two adjacent dates per 17 months, retaining calendar time.
        designs = [(0, False, 0), (0.4, False, 0), (0.4, True, 0), (0.4, True, 0.18)]
        for first_seed, (rho, gaps, slope) in [(seed, design) for seed in (43100, 60907) for design in designs]:
            with self.subTest(first_seed=first_seed, rho=rho, gaps=gaps, slope=slope):
                coverage = tested = false_positives = 0
                missing = {i for i in range(120, 480) if gaps and i % 17 in (1, 2)}
                for seed in range(first_seed, first_seed + 200):
                    s = noisy_months(1960, 480, seed, rho, slope, missing)
                    ref = {**BASE, **period("1960-01", "1969-12")}
                    t = analyze_series(s, ref, period("1970-01", "1999-12"))["trend"]
                    if t["p_raw"] is not None:
                        tested += 1
                        coverage += t["ci_95"][0] <= slope <= t["ci_95"][1]
                        false_positives += slope == 0 and t["p_raw"] < 0.05
                self.assertGreaterEqual(tested, 190)
                self.assertGreaterEqual(coverage / tested, 0.91)
                self.assertLessEqual(coverage / tested, 0.99)
                self.assertLessEqual(false_positives / tested, 0.09)


class IndicatorTests(unittest.TestCase):
    def test_absent_calibration_unsupported_inputs_and_pending_events(self):
        s = monthly(["2020-01", "2020-02"], [0, None])
        self.assertEqual(indicator("spi-3", s)["status"], "insufficient_baseline")
        self.assertEqual(indicator("spi-3", {**s, "calendar": "360_day"})["status"], "unsupported_resolution")
        self.assertEqual(indicator("spi-3", {**s, "unit": "kg"})["status"], "not_applicable")
        self.assertEqual(indicator("spi-6", None)["status"], "data_required")
        self.assertEqual(indicator("unknown", s)["status"], "definition_required")
        pending = indicator("recorded-flood", s, {"status": "pending", "catalogue_id": "test-flood"})
        self.assertEqual((pending["status"], pending["metrics"], pending["events"]), ("data_required", [], []))
        self.assertEqual(pending["event_source"]["catalogue_id"], "test-flood")

    def test_rain_accumulation_gregorian_missing_and_zero(self):
        s = monthly(["2020-01", "2020-02", "2020-04", "2020-05"], [0, 1, 1, -1])
        _, one = _accumulated_rain(s, 1)
        _, two = _accumulated_rain(s, 2)
        self.assertEqual(one, [0, 29, None, 30, None])
        self.assertEqual(two, [None, 29, None, None, None])
        s.update(times=["2019-01", "2019-02"], values=[1, 1])
        self.assertEqual(_accumulated_rain(s, 2)[1][-1], 59)
        s.update(unit="mm", temporal_support="monthly_total", values=[5, 5])
        self.assertEqual(_accumulated_rain(s, 2)[1][-1], 10)

    def test_spi_reference_values_and_fixed_fit(self):
        rng = random.Random(202611)
        times = months(1989, 34 * 12)
        values = [(0 if month_number(t) % 47 == 0 else rng.gammavariate(1.9, 1.3)) *
                  (1 + .15 * math.sin((month_number(t) % 12) * math.pi / 6)) for t in times]
        s = monthly(times, values)
        for scale, expected in [(3, -1.4591501975565633), (6, -1.229474920925449), (12, -2.302673609801808)]:
            with self.subTest(scale=scale):
                i = indicator(f"spi-{scale}", s, window=period("2000-01", "2022-12"))
                other = indicator(f"spi-{scale}", s, window=period("2015-04", "2018-06"))
                self.assertEqual(i["status"], "ok")
                self.assertEqual(i["calibration_reference"]["counts"], [30] * 12)
                self.assertTrue(spi_calibration_supported(s, i["recipe"]))
                self.assertEqual(i["calibration_reference"], other["calibration_reference"])
                h = i["metrics"][0]["full_history"]
                self.assertEqual(h["values"], other["metrics"][0]["full_history"]["values"])
                self.assertAlmostEqual(h["values"][h["times"].index("2021-07")], expected, places=8)
                self.assertEqual(h["values"], h["anomalies"])
                self.assertEqual(i["kind"], "derived_indicator")
                self.assertEqual([m["metric_id"] for m in i["metrics"]], ["index", "frequency", "duration", "severity"])
                self.assertEqual(i["metrics"][1]["seasonal_pattern"], [])
                self.assertEqual(i["input_product"]["product_id"], "test-precip")
        model = _gamma_model([0, 1.2, 2.3, 1.5, 7.9, 10.2, 11.5, 9.8, 6.1, 14.6, 3])
        self.assertAlmostEqual(model["probability_zero"], 1 / 11)
        self.assertAlmostEqual(_gamma_probability(model["shape"], 9 / model["scale"]), 0.737864885220467, places=9)

    def test_spi_continuous_negative_episode_and_censoring(self):
        values = [-1.5, 0, -.3, -1, -.2, 0.2, -.4, -1.1, None, -1.4, .2, -1.5]
        i = month_number("2019-10")
        events, unknown = _dry_spells(list(range(i, i + len(values))), values)
        self.assertEqual(events[0]["censoring"], ["left"])
        self.assertEqual(events[1]["start"], "2019-12")
        self.assertEqual(events[1]["end"], "2020-02")
        self.assertEqual(events[1]["duration"], 3)
        self.assertAlmostEqual(events[1]["severity"], 1.5)
        self.assertEqual([e["censoring"] for e in events[2:]], [["right"], ["left"], ["right"]])
        self.assertTrue(all(e["duration"] is None for e in events if e["censoring"]))

    def test_recorded_coverage_de_duplication_coarse_dates_and_queries(self):
        def row(event_id, start, end, **extra):
            return {"event_id": event_id, "phenomenon_id": "flood", "region_ids": ["region"],
                    "start": start, "end": end, "source_ref": "inventory", "source_version": "test",
                    "metrics": {"severity": {"value": 7.5, "unit": "m", "definition_ref": "depth"}}, **extra}
        def coverage(start, end, completeness, **extra):
            return {"start": start, "end": end, "region_id": "region", "phenomenon_id": "flood",
                    "completeness": completeness, **extra}
        cat = {"status": "ready", "catalogue_id": "inventory", "version": "test", "coverage_version": "test",
               "coverage": [coverage("1990", "2013", "complete"), coverage("2003", "2003", "partial"),
                            coverage("2006-03-07", "2006-03-07", "unknown")],
               "events": [row("one", "1999-12-30", "2000-01-02", canonical_event_id="A"),
                          row("duplicate", "1999-12-30", "2000-01-02", canonical_event_id="A"),
                          row("two", "2001", "2001"), row("three", "2002-07", "2002-11"),
                          row("uncertain-onset", "2008", "2009", time_bounds={"start": ["2008-12", "2009-02"]}),
                          row("ongoing", "2010-01-01", None)]}
        full = indicator("recorded-flood", None, cat, period("1990-01", "2013-12"))
        self.assertEqual(full["kind"], "recorded_event")
        self.assertEqual(full["status"], "ok")
        counts, duration, severity = [as_years(m) for m in full["metrics"]]
        self.assertEqual([counts[str(y)] for y in range(1999, 2004)], [1, 0, 1, 1, None])
        self.assertEqual(duration["1999"], 4)
        self.assertIsNone(duration["2000"])  # Fully covered no-event year only supplies a zero count.
        self.assertEqual(severity["1999"], 7.5)
        self.assertIsNone(duration["2001"])
        self.assertIsNone(duration["2002"])
        self.assertIsNone(counts["2006"])
        self.assertIsNone(counts["2008"])
        self.assertIsNone(counts["2009"])
        self.assertEqual(counts["2010"], 1)
        self.assertIsNone(duration["2010"])
        self.assertEqual(len(full["events"]), 5)
        self.assertIn("right", full["events"][-1]["censoring"])
        narrower = indicator("recorded-flood", None, cat, period("2000-01", "2001-06"))
        self.assertEqual(narrower["events"][0]["start"], "1999-12-30")
        self.assertTrue(narrower["events"][0]["overlaps_start_boundary"])
        self.assertEqual(narrower["events"][1]["start"], "2001")
        self.assertEqual(narrower["metrics"][0]["actual_support"]["n_expected"], 1)
        self.assertEqual(narrower["metrics"][0]["actual_support"]["start"], "2000")
        self.assertEqual(as_years(narrower["metrics"][0]), counts)
        self.assertIsNone(narrower["metrics"][0]["trend"]["significant"])

    def test_incomplete_day_and_sparse_annual_counts(self):
        cov = {"region_id": "region", "phenomenon_id": "drought", "completeness": "complete",
               "start": "1980", "end": "2020", "gaps": [period("2004-02-29", "2004-02-29")]}
        row = {"region_ids": ["region"], "phenomenon_id": "drought", "event_id": "one",
               "start": "2000-01-01T18:00:00+01:00", "end": "2000-01-02T18:00:00+01:00"}
        cat = {"status": "ready", "coverage": [cov], "events": [row]}
        out = indicator("recorded-drought", None, cat)
        count, duration = out["metrics"]
        self.assertIsNone(as_years(count)["2004"])
        self.assertIn("sparse", count["reason"])
        self.assertIsNone(count["trend"]["p_raw"])
        self.assertEqual(as_years(duration)["2000"], 1)
        cat["events"] = []
        cov["completeness"] = "partial"
        partial = indicator("recorded-drought", None, cat)
        self.assertEqual(partial["status"], "insufficient_data")
        self.assertTrue(all(v is None for v in partial["metrics"][0]["full_history"]["values"]))

    def test_source_selection_uses_the_scientific_eligibility_rules(self):
        rows = [{**period("2000-01", "2000-06"), "completeness": "complete"},
                {**period("2000-07", "2000-12"), "completeness": "complete",
                 "gaps": [period("2000-12", "2000-12")]}]
        self.assertEqual(event_coverage_status(rows, period("2000-02", "2000-10")), "complete")
        self.assertEqual(event_coverage_status(rows, None), "partial")
        self.assertEqual(event_coverage_status(rows, period("2000-12", "2001-01")), "uncovered")
        self.assertEqual(event_coverage_status([{**rows[0], "completeness": "unknown"}], None), "unknown")
        self.assertFalse(spi_calibration_supported(monthly(months(2010, 120), [1] * 120),
                                                   {"indicator_id": "spi-3", "calibration_reference": SPI_BASE}))
