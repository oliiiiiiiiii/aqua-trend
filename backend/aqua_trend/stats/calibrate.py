"""Calibration study of the trend inference (acceptance T14, spec §7.2).

Simulated series only — nothing here touches the prepared NASA data, and no
number produced here is shipped as a result.  The study answers two questions
for each candidate lag policy in ``stats.policy.LAG_POLICIES``:

* false-positive rate of the two-sided slope test at the policy alpha when the
  true trend is zero;
* coverage of the pointwise CI when a true linear trend is present.

Registered scenarios (all combinations)
    noise       white, AR(1) with phi in {0.3, 0.6, 0.8, 0.9, 0.95, 0.98}; unit innovation
                variance, stationary start
    length      n in {120, 240, 320} months
    missing     none | 10 % of months at random | one 11-month block (GRACE /
                GRACE-FO-like) at a random interior position | both
    seasonality none | a fixed annual harmonic removed with a FIXED-baseline monthly
                climatology (first 120 months), exactly as the product does

Selection rule (declared before any real series was fitted; see
docs/method-calibration.md §3) is implemented in ``select_policy``.

Run:  python -m aqua_trend.stats.calibrate --reps 4000 --json out.json --markdown out.md
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional

import numpy as np

from .policy import LAG_POLICIES
from .trend import fit_trend_batch

PHIS: tuple[float, ...] = (0.0, 0.3, 0.6, 0.8, 0.9, 0.95, 0.98)
LENGTHS: tuple[int, ...] = (120, 240, 320)
MISSING: tuple[str, ...] = ("none", "random10", "block11", "random10+block11")
SEASONAL: tuple[bool, ...] = (False, True)

RANDOM_MISSING_SHARE = 0.10
BLOCK_MONTHS = 11
BASELINE_MONTHS = 120
SEASONAL_AMPLITUDE = 3.0            # in innovation standard deviations
TRUE_TREND_PER_DECADE = 0.5         # in innovation standard deviations per decade (coverage runs)
T0 = 2000 * 12                      # arbitrary January start; only the month phase matters

#: scenarios the lag policy is selected on and must pass; phi >= 0.8 are reported stress cases
#: (0.95 and 0.98 were added by the review: about a fifth of the prepared soil-moisture and
#: terrestrial-water-storage anomaly series have a residual lag-1 autocorrelation of 0.9 or more)
DESIGN_MAX_PHI = 0.6
#: Bradley's (1978) liberal robustness criterion: empirical rate within [0.5, 1.5] * alpha
TOLERANCE_FACTORS = (0.5, 1.5)
#: bound stated in docs/method-calibration.md for EVERY registered monthly scenario with the shipped
#: policy, including the 10-year records with gaps that the production gate refuses
DOCUMENTED_MAX_FPR = 0.09
#: candidates in order of increasing complexity (ties go to the earlier one)
SIMPLICITY_ORDER = tuple(LAG_POLICIES)


@dataclass(frozen=True)
class Scenario:
    phi: float
    n: int
    missing: str
    seasonal: bool

    @property
    def design(self) -> bool:
        return self.phi <= DESIGN_MAX_PHI

    @property
    def key(self) -> str:
        return f"phi={self.phi:g}|n={self.n}|missing={self.missing}|seasonal={int(self.seasonal)}"


def scenarios(phis: Iterable[float] = PHIS, lengths: Iterable[int] = LENGTHS,
              missing: Iterable[str] = MISSING, seasonal: Iterable[bool] = SEASONAL) -> list[Scenario]:
    return [Scenario(p, n, m, s) for p in phis for n in lengths for m in missing for s in seasonal]


# --------------------------------------------------------------------------- simulation

def ar1_noise(rng: np.random.Generator, reps: int, n: int, phi: float) -> np.ndarray:
    """Stationary AR(1) rows with unit innovation variance (phi = 0: white noise)."""
    eps = rng.standard_normal((reps, n))
    if phi == 0.0:
        return eps
    x = np.empty_like(eps)
    x[:, 0] = eps[:, 0] / math.sqrt(1.0 - phi * phi)
    for k in range(1, n):
        x[:, k] = phi * x[:, k - 1] + eps[:, k]
    return x


def missing_mask(rng: np.random.Generator, reps: int, n: int, pattern: str) -> np.ndarray:
    """True = missing.  The first and last month are kept so the window length is n."""
    miss = np.zeros((reps, n), dtype=bool)
    if "random10" in pattern:
        miss |= rng.random((reps, n)) < RANDOM_MISSING_SHARE
    if "block11" in pattern:
        start = rng.integers(1, n - BLOCK_MONTHS - 1, size=reps)
        cols = np.arange(n)[None, :]
        miss |= (cols >= start[:, None]) & (cols < start[:, None] + BLOCK_MONTHS)
    miss[:, 0] = False
    miss[:, -1] = False
    return miss


def fixed_baseline_anomalies(t: np.ndarray, Y: np.ndarray) -> np.ndarray:
    """Row-wise y - c[month], c = monthly mean over the fixed first BASELINE_MONTHS months.

    Same rule as ``seasonal.climatology`` / ``seasonal.anomalies`` (vectorised over
    replicates); the baseline-sufficiency gate is not exercised by the calibration.
    """
    month = t % 12
    base = np.arange(t.size) < BASELINE_MONTHS
    out = np.empty_like(Y)
    for m in range(12):
        sel = month == m
        with np.errstate(invalid="ignore"):
            cyc = np.nanmean(np.where(base[sel][None, :], Y[:, sel], np.nan), axis=1)
        out[:, sel] = Y[:, sel] - cyc[:, None]
    return out


def simulate(sc: Scenario, reps: int, rng: np.random.Generator, trend_per_decade: float = 0.0
             ) -> tuple[np.ndarray, np.ndarray]:
    """(t, Y[reps, n]) for one scenario; NaN = missing."""
    t = T0 + np.arange(sc.n)
    Y = ar1_noise(rng, reps, sc.n, sc.phi)
    Y = Y + trend_per_decade / 120.0 * np.arange(sc.n)[None, :]
    if sc.seasonal:
        Y = Y + SEASONAL_AMPLITUDE * np.sin(2.0 * np.pi * (t % 12) / 12.0)[None, :]
    Y[missing_mask(rng, reps, sc.n, sc.missing)] = np.nan
    if sc.seasonal:
        Y = fixed_baseline_anomalies(t, Y)
    return t, Y


# --------------------------------------------------------------------------- evaluation

def evaluate(sc: Scenario, policy: Mapping[str, Any], reps: int, seed: int) -> dict[str, Any]:
    """False-positive rate and CI coverage of every candidate on the same simulated draws.

    The applicability gate is switched off so that the estimator is also probed where the
    product would refuse (e.g. n = 120 with gaps); ``gate_pass_share`` reports how many
    replicates the production gate would have accepted.
    """
    alpha = float(policy["alpha"])
    seq = np.random.SeedSequence([seed, int(round(sc.phi * 100)), sc.n, MISSING.index(sc.missing), int(sc.seasonal)])
    rng_null, rng_trend = (np.random.default_rng(s) for s in seq.spawn(2))
    t, y_null = simulate(sc, reps, rng_null)
    _, y_trend = simulate(sc, reps, rng_trend, TRUE_TREND_PER_DECADE)
    gated = fit_trend_batch(t, y_null, cadence="monthly", policy=policy)
    out: dict[str, Any] = {**asdict(sc), "design": sc.design, "reps": reps,
                           "gate_pass_share": float(gated.inference_ok.mean()), "candidates": {}}
    for pid in LAG_POLICIES:
        null = fit_trend_batch(t, y_null, cadence="monthly", policy=policy, lag_policy=pid, enforce_gate=False)
        alt = fit_trend_batch(t, y_trend, cadence="monthly", policy=policy, lag_policy=pid, enforce_gate=False)
        ok0, ok1 = null.inference_ok, alt.inference_ok
        covered = (alt.ci_lo_per_decade[ok1] <= TRUE_TREND_PER_DECADE) & (TRUE_TREND_PER_DECADE <= alt.ci_hi_per_decade[ok1])
        out["candidates"][pid] = {
            "fpr": float((null.p_raw[ok0] < alpha).mean()),
            "coverage": float(covered.mean()),
            "mean_lag": float(null.lag[ok0].mean()),
            "mean_resid_r1": float(np.nanmean(null.resid_autocorr_lag1[ok0])),
            "n_fits": int(ok0.sum()),
        }
    return out


def run(policy: Mapping[str, Any], reps: int, seed: int = 20260,
        scens: Optional[list[Scenario]] = None, verbose: bool = False) -> list[dict[str, Any]]:
    rows = []
    for sc in scens or scenarios():
        rows.append(evaluate(sc, policy, reps, seed))
        if verbose:
            print(sc.key, {k: round(v["fpr"], 3) for k, v in rows[-1]["candidates"].items()}, flush=True)
    return rows


ANNUAL_LENGTHS: tuple[int, ...] = (20, 25, 30, 40)
ANNUAL_PHIS: tuple[float, ...] = (0.0, 0.3, 0.6)
#: means of the independent Poisson annual counts (events or event-months per year)
ANNUAL_POISSON_MEANS: tuple[float, ...] = (1.0, 4.0)
#: bound stated in docs/method-calibration.md for the annual supplementary grid
DOCUMENTED_MAX_ANNUAL_FPR = 0.12


def _annual_cell(years: np.ndarray, y0: np.ndarray, y1: np.ndarray, policy: Mapping[str, Any],
                 data_kind: str) -> dict[str, Any]:
    """False-positive rate (y0: no trend) and CI coverage (y1: true trend) of every candidate."""
    alpha = float(policy["alpha"])
    out: dict[str, Any] = {}
    for pid in LAG_POLICIES:
        kw = dict(cadence="annual", policy=policy, lag_policy=pid, enforce_gate=False, data_kind=data_kind)
        null, alt = fit_trend_batch(years, y0, **kw), fit_trend_batch(years, y1, **kw)
        ok0, ok1 = null.inference_ok, alt.inference_ok
        cov = (alt.ci_lo_per_decade[ok1] <= TRUE_TREND_PER_DECADE) & (TRUE_TREND_PER_DECADE <= alt.ci_hi_per_decade[ok1])
        out[pid] = {"fpr": float((null.p_raw[ok0] < alpha).mean()), "coverage": float(cov.mean()),
                    "mean_lag": float(null.lag[ok0].mean()), "n_fits": int(ok0.sum())}
    return out


def run_annual(policy: Mapping[str, Any], reps: int, seed: int = 20260) -> list[dict[str, Any]]:
    """Supplementary grid for annual series (complete years, no trend / true trend).

    ``noise = "ar1"``      Gaussian AR(1) years, phi in ANNUAL_PHIS.
    ``noise = "poisson"``  independent Poisson counts with mean in ANNUAL_POISSON_MEANS (the true-trend
                           draws have a linearly increasing mean, so their variance grows with it).
    Counts that are autocorrelated, zero-inflated or censored are NOT simulated.  Replicates on
    which no inference is possible (e.g. an all-zero count series) are left out of the rates;
    ``n_fits`` records how many were used.
    """
    rows = []
    for n in ANNUAL_LENGTHS:
        years = 1980 + np.arange(n)
        drift = TRUE_TREND_PER_DECADE / 10.0 * np.arange(n)[None, :]
        for phi in ANNUAL_PHIS:
            seq = np.random.SeedSequence([seed, 7, int(round(phi * 100)), n])
            rng0, rng1 = (np.random.default_rng(s) for s in seq.spawn(2))
            cands = _annual_cell(years, ar1_noise(rng0, reps, n, phi), ar1_noise(rng1, reps, n, phi) + drift,
                                 policy, "continuous")
            rows.append({"noise": "ar1", "phi": phi, "mean": None, "n": n, "reps": reps, "candidates": cands})
        for lam in ANNUAL_POISSON_MEANS:
            seq = np.random.SeedSequence([seed, 8, int(round(lam * 100)), n])
            rng0, rng1 = (np.random.default_rng(s) for s in seq.spawn(2))
            y0 = rng0.poisson(lam, (reps, n)).astype(np.float64)
            y1 = rng1.poisson(lam + drift, (reps, n)).astype(np.float64)
            rows.append({"noise": "poisson", "phi": 0.0, "mean": lam, "n": n, "reps": reps,
                         "candidates": _annual_cell(years, y0, y1, policy, "count")})
    rows.sort(key=lambda r: (r["noise"], r["phi"], r["mean"] or 0.0, r["n"]))
    return rows


def _annual_label(r: Mapping[str, Any]) -> str:
    return f"AR(1) phi = {r['phi']:g}" if r["noise"] == "ar1" else f"Poisson counts, mean {r['mean']:g}"


def markdown_annual(rows: list[dict[str, Any]], pid: str) -> str:
    head = "| noise | n (years) | FPR | CI coverage | mean lag |\n| --- | --- | --- | --- | --- |\n"
    return head + "\n".join(
        f"| {_annual_label(r)} | {r['n']} | {r['candidates'][pid]['fpr']:.3f} | "
        f"{r['candidates'][pid]['coverage']:.3f} | {r['candidates'][pid]['mean_lag']:.1f} |" for r in rows) + "\n"


def markdown_annual_candidates(rows: list[dict[str, Any]]) -> str:
    """False-positive rate of every candidate on the annual grid."""
    head = "| noise | n (years) | " + " | ".join(f"`{p}`" for p in LAG_POLICIES) + " |\n"
    head += "| --- | --- | " + " | ".join("---" for _ in LAG_POLICIES) + " |\n"
    return head + "\n".join(
        f"| {_annual_label(r)} | {r['n']} | " + " | ".join(f"{r['candidates'][p]['fpr']:.3f}" for p in LAG_POLICIES) + " |"
        for r in rows) + "\n"


def tolerance(alpha: float) -> tuple[float, float]:
    return TOLERANCE_FACTORS[0] * alpha, TOLERANCE_FACTORS[1] * alpha


def summarise(rows: list[dict[str, Any]], alpha: float) -> dict[str, dict[str, float]]:
    """Per candidate: worst |FPR - alpha| and extreme FPR / coverage over design and stress scenarios."""
    out: dict[str, dict[str, float]] = {}
    for pid in LAG_POLICIES:
        d = [r["candidates"][pid] for r in rows if r["design"]]
        s = [r["candidates"][pid] for r in rows if not r["design"]]
        out[pid] = {
            "design_worst_abs_dev": max(abs(c["fpr"] - alpha) for c in d) if d else float("nan"),
            "design_max_fpr": max(c["fpr"] for c in d) if d else float("nan"),
            "design_min_fpr": min(c["fpr"] for c in d) if d else float("nan"),
            "design_min_coverage": min(c["coverage"] for c in d) if d else float("nan"),
            "stress_max_fpr": max(c["fpr"] for c in s) if s else float("nan"),
            "stress_min_coverage": min(c["coverage"] for c in s) if s else float("nan"),
        }
    return out


def select_policy(rows: list[dict[str, Any]], alpha: float, reps: int) -> str:
    """Pre-declared rule: smallest worst-case |FPR - alpha| over the design scenarios.

    Candidates within two Monte-Carlo standard errors of the best one count as tied;
    a tie goes to the simplest candidate (``SIMPLICITY_ORDER``).
    """
    summ = summarise(rows, alpha)
    mc_se = math.sqrt(alpha * (1.0 - alpha) / reps)
    best = min(s["design_worst_abs_dev"] for s in summ.values())
    tied = [pid for pid in SIMPLICITY_ORDER if summ[pid]["design_worst_abs_dev"] <= best + 2.0 * mc_se]
    return tied[0]


# --------------------------------------------------------------------------- reporting

def markdown_table(rows: list[dict[str, Any]], pid: str) -> str:
    head = ("| phi | n | missing | seasonal | FPR | CI coverage | mean lag | mean residual r1 | gate pass |\n"
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n")
    lines = []
    for r in rows:
        c = r["candidates"][pid]
        lines.append(
            f"| {r['phi']:g} | {r['n']} | {r['missing']} | {'yes' if r['seasonal'] else 'no'} | "
            f"{c['fpr']:.3f} | {c['coverage']:.3f} | {c['mean_lag']:.1f} | {c['mean_resid_r1']:.2f} | "
            f"{r['gate_pass_share']:.0%} |")
    return head + "\n".join(lines) + "\n"


def markdown_summary(rows: list[dict[str, Any]], alpha: float) -> str:
    summ = summarise(rows, alpha)
    head = ("| candidate | design worst abs(FPR - alpha) | design FPR range | design min coverage | "
            "stress (phi>=0.8) max FPR | stress min coverage |\n| --- | --- | --- | --- | --- | --- |\n")
    return head + "\n".join(
        f"| `{pid}` | {s['design_worst_abs_dev']:.3f} | {s['design_min_fpr']:.3f}–{s['design_max_fpr']:.3f} | "
        f"{s['design_min_coverage']:.3f} | {s['stress_max_fpr']:.3f} | {s['stress_min_coverage']:.3f} |"
        for pid, s in summ.items()) + "\n"


def _default_policy() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[2] / "catalogue" / "policies" / "method_policy.json"
    return json.loads(path.read_text())


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--reps", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=20260)
    ap.add_argument("--phis", type=float, nargs="*", default=list(PHIS))
    ap.add_argument("--json", type=Path)
    ap.add_argument("--markdown", type=Path)
    args = ap.parse_args(argv)
    policy = _default_policy()
    alpha = float(policy["alpha"])
    rows = run(policy, args.reps, args.seed, scenarios(phis=args.phis), verbose=True)
    chosen = select_policy(rows, alpha, args.reps)
    annual = run_annual(policy, args.reps, args.seed)
    text = (f"reps = {args.reps}, seed = {args.seed}, alpha = {alpha}, selected = `{chosen}`\n\n"
            + markdown_summary(rows, alpha) + "\n" + markdown_table(rows, chosen)
            + "\nAnnual supplementary grid\n\n" + markdown_annual(annual, chosen)
            + "\nAnnual grid, false-positive rate by candidate\n\n" + markdown_annual_candidates(annual))
    print(text)
    if args.json:
        args.json.write_text(json.dumps({"reps": args.reps, "seed": args.seed, "selected": chosen, "rows": rows, "annual": annual}, indent=1))
    if args.markdown:
        args.markdown.write_text(text)


if __name__ == "__main__":
    main()
