# Method calibration — trend inference (acceptance T14)

Scope: the uncertainty of the linear trend reported by `aqua_trend.stats.fit_trend` (spec §7.2).
Everything in this document comes from **simulated series**; no prepared NASA series was fitted to
choose or tune anything described here. The numbers below are properties of the method under stated
assumptions, not results about the Earth system.

Reproduce: `cd backend && PYTHONPATH=. .venv/bin/python -m aqua_trend.stats.calibrate --reps 4000`
(seed 20260; about 30 minutes on 2 heavily shared cores, a few minutes on an idle machine). A reduced rerun
on an independent seed is the opt-in slow test `pytest -m slow tests/test_stats_calibration.py`
(a plain `pytest` run skips it).

Versions: `STATS_POLICY_VERSION = stats-1.1.0`, method policy `method-1.0.0`, shipped lag policy
`fixed_pw_sdof` (`aqua_trend/stats/policy.py: DEFAULT_LAG_POLICY_ID`). The statistics policy version is
part of every hypothesis id, so evidence computed with stats-1.0.0 cannot be attached to stats-1.1.0 numbers.

**Revision stats-1.1.0 (independent review).** Two changes to the prewhitening step, both described in §2,
and every table in this document was regenerated afterwards:

1. stats-1.0.0 dropped the first prewhitened score (`u_0 = h_0`). In a trend regression the first and last
   scores carry the largest leverage, so the variance was biased low; on one gappy test series the standard
   error was 14 % too small. The filter now covers the whole zero-padded series.
2. A negative prewhitening coefficient is no longer used (`rho` is limited to `[0, 0.97]`). A negative
   estimate divided the variance by `(1 - rho)^2 > 1`, i.e. narrowed the interval on the strength of a noisy
   coefficient; at 20 annual values this alone moved the white-noise false-positive rate from about 0.08 to
   about 0.06 in a side experiment.

The review also added the stress scenarios phi = 0.95 and 0.98, a 25-year annual length and Poisson annual
counts. The selection rule and the tolerance (§3) were not changed; the rule still selects `fixed_pw_sdof`.

## 1. What is estimated

After the fixed-baseline seasonal step, `a_t = alpha + beta * tau_t + eps_t` with `tau` in years on the true
calendar axis. `beta` is the OLS slope over the valid samples. Its variance is a Bartlett-kernel HAC estimate
of the slope scores `h_t = (tau_t - mean(tau)) e_t / Sxx` laid out on the complete calendar grid with
`h_t = 0` for missing months, so the product `h_t h_(t+j)` always pairs samples exactly `j` calendar steps
apart (the amplitude-modulated estimator of Datta & Du 2012). The variance carries the `n/(n-2)` factor;
the test statistic is referred to a Student t distribution.

Without prewhitening and on a complete series this is exactly the statsmodels HAC result
(`cov_type="HAC", use_correction=True, use_t=True`); the tests check the standard error to a relative
1e-9. With gaps there is no library reference: the tests use an independent loop implementation and an
identity that expresses the prewhitened long-run sum through the autocovariances of the scores.

## 2. Candidates

All candidates share the estimator above and differ in three switches.

| id | bandwidth | AR(1) prewhitening | t degrees of freedom |
| --- | --- | --- | --- |
| `fixed` | `L = floor(4 (T/100)^(2/9))` | no | `n - 2` |
| `nw94` | Newey–West (1994) automatic, Bartlett | no | `n - 2` |
| `fixed_pw` | fixed | yes | `n - 2` |
| `nw94_pw` | automatic | yes | `n - 2` |
| `fixed_pw_neff` | fixed | yes | `n (1-rho)/(1+rho) - 2` |
| `nw94_pw_neff` | automatic | yes | `n (1-rho)/(1+rho) - 2` |
| `fixed_pw_sdof` | fixed | yes | Satterthwaite-type (below) |
| `nw94_pw_sdof` | automatic | yes | Satterthwaite-type |

`T` is the calendar span (first to last valid step), `n` the number of valid samples.

* **Automatic bandwidth** (Newey & West 1994, Bartlett kernel): `L = floor(1.1447 ((s1/s0)^2)^(1/3) T^(1/3))`,
  `s0 = c_0 + 2 sum c_j`, `s1 = 2 sum j c_j` over the first `floor(4 (T/100)^(2/9))` autocovariances of the
  slope scores.
* **Prewhitening** (after Andrews & Monahan 1992, applied to the scalar slope score instead of the full
  moment vector): `u_t = h_t - rho h_(t-1)` for `t = 0..T` with `h_(-1) = h_T = 0`, HAC of `u`, divided by
  `(1-rho)^2`. Because the filter covers the whole zero-padded series, no score is dropped,
  `sum u = (1-rho) sum h` holds exactly, and `c_u(j) = (1+rho^2) c_h(j) - rho (c_h(j-1) + c_h(j+1))`.
  `rho` is the lag-1 regression coefficient of the scores, estimated **only from pairs observed exactly one
  step apart** and limited to `[0, 0.97]`. The filter is applied to the zero-filled grid, so lags remain
  calendar lags. The upper bound 0.97 is the value commonly attributed to Andrews & Monahan; it could not
  be checked against the primary text and is treated as a project constant. The lower bound 0 is a project
  choice (revision note above); ignoring true anti-persistence makes the test conservative.
* **`neff` degrees of freedom**: the effective-sample-size adjustment that is common for trend tests on
  autocorrelated climate series (e.g. Santer et al. 2000), here used only for the reference distribution.
* **Satterthwaite-type degrees of freedom**: `nu = [ (sum d_t^2)^2 / sum d_t^4 ] / [ 1 + 2 sum_(j=1..L) w_j^2 ]
  * (1-rho)/(1+rho)`, capped at `n - 2`, floored at 1, with `d_t = tau_t - mean(tau)` over valid samples and
  `w_j = 1 - j/(L+1)`. Reasoning: for independent normal errors the lag-0 term `sum d_t^2 e_t^2` has the
  first two moments of a scaled chi-square with `(sum d^2)^2 / sum d^4` degrees of freedom (about 5n/9 for
  a linear time regressor, because the end points carry the leverage); the kernel-weighted lag terms add
  variance in proportion to `sum w_j^2`; positive autocorrelation reduces the number of effectively
  independent terms. **This is a project approximation, not a published theorem.** It is accepted only
  because of the simulation results below.

Pairing a HAC variance with either non-classical degrees-of-freedom rule is an engineering choice
(spec §7.2: "project engineering policy, not a NASA rule and not a universal theorem").

**Process note.** The first calibration round had four candidates (`fixed`, `nw94`, and their prewhitened
versions with `rho` estimated on the zero-filled series). It showed (a) that zero-filling attenuates `rho`
under random gaps, which led to the valid-pairs estimate of `rho`, and (b) that every `n - 2` candidate
over-rejects, which led to the two degrees-of-freedom rules. The review then changed the prewhitening step
as described in the revision note. The method was therefore developed **in response to simulation results**.
The selection rule and tolerance in §3 were not changed, the final check runs on an independent seed (slow
test), and no real series was involved in any choice. During the review the shipped estimator was run on a
sample of the prepared series only to see how it behaves (finite output, gate reasons, how persistent the
residuals are); those runs changed no number and no rule except the decision to add the phi = 0.95 / 0.98
stress scenarios.

## 3. Rule and tolerance (fixed before any real series was fitted)

* **Design scenarios**: every registered monthly scenario with AR(1) coefficient ≤ 0.6.
  **Stress scenarios**: phi = 0.8, 0.9, 0.95 and 0.98 — reported, not used for selection.
* **Selection rule**: choose the candidate with the smallest worst-case `|FPR - alpha|` over the design
  scenarios. Candidates within two Monte-Carlo standard errors of the best (2 × 0.0034 at 4000 replicates)
  are tied; a tie goes to the simplest candidate in the order of the table in §2.
* **Tolerance**: empirical false-positive rate within `[0.5 alpha, 1.5 alpha] = [0.025, 0.075]` at
  `alpha = 0.05` (the band widely used as Bradley's 1978 "liberal" robustness criterion; the band was taken
  from secondary sources, the 1978 text itself was not consulted), and coverage of the 95 % interval of at
  least 0.925. Monte-Carlo standard error of one rate at 4000 replicates is about 0.0034.

## 4. Registered scenarios and assumptions

* Noise: Gaussian white noise, and stationary Gaussian AR(1) with phi ∈ {0.3, 0.6, 0.8, 0.9, 0.95, 0.98};
  unit innovation variance.
* Length: 120, 240, 320 months.
* Missing data: none; 10 % of months missing completely at random; one 11-month block at a random interior
  position (the length of the GRACE / GRACE-FO gap); both together. Missingness is independent of the values.
* Seasonality: none; or an annual harmonic (amplitude 3 innovation SD) removed with a **fixed-baseline**
  monthly climatology computed from the first 120 months, i.e. the product's own seasonal rule, including the
  noise that an estimated climatology leaves in the anomalies.
* False-positive rate: true slope 0, two-sided test at alpha = 0.05 on the raw p-value.
  Coverage: independent draws with a true slope of 0.5 innovation SD per decade.
* 4000 replicates per cell; the same draws for all candidates; 168 monthly cells.
* The applicability gate is switched off inside the study so that the estimator is also examined where the
  product refuses to infer; the column "gate pass" shows the share of replicates the production gate accepts
  (10-year records with gaps are refused by `min_valid_months = 120`).

Not covered, and therefore **not validated**: long-memory or non-stationary noise, AR coefficients above
0.98, heteroskedastic or heavy-tailed noise, missingness that depends on the value or the season, gap blocks
longer than 11 months, structural breaks, monthly count data, and annual counts that are autocorrelated,
zero-inflated or censored.

## 5. Results

Summary over all candidates (4000 replicates, seed 20260):

| candidate | design worst abs(FPR - alpha) | design FPR range | design min coverage | stress (phi>=0.8) max FPR | stress min coverage |
| --- | --- | --- | --- | --- | --- |
| `fixed` | 0.119 | 0.058–0.169 | 0.826 | 0.697 | 0.303 |
| `nw94` | 0.116 | 0.070–0.166 | 0.831 | 0.614 | 0.386 |
| `fixed_pw` | 0.052 | 0.056–0.102 | 0.894 | 0.311 | 0.687 |
| `nw94_pw` | 0.075 | 0.065–0.125 | 0.876 | 0.326 | 0.670 |
| `fixed_pw_neff` | 0.045 | 0.055–0.095 | 0.902 | 0.239 | 0.761 |
| `nw94_pw_neff` | 0.068 | 0.065–0.118 | 0.882 | 0.245 | 0.755 |
| `fixed_pw_sdof` | 0.019 | 0.038–0.069 | 0.929 | 0.085 | 0.911 |
| `nw94_pw_sdof` | 0.020 | 0.033–0.070 | 0.928 | 0.086 | 0.910 |

Selected by the rule: **`fixed_pw_sdof`** (worst design deviation 0.019; `nw94_pw_sdof` at 0.020 is tied
within Monte-Carlo error and loses the tie as the more complex candidate).

Reading of the selected policy:

* **Design scenarios (72 cells): all inside the tolerance.** False-positive rate 0.038–0.069, coverage
  0.929–0.963.
* White noise and weak persistence (phi ≤ 0.3) are nominal to slightly liberal (0.044–0.069; worst at 120
  months).
* Strong persistence is **conservative**, not liberal, wherever the production gate accepts the series:
  phi = 0.8–0.95 gives a false-positive rate of 0.019–0.050 and coverage 0.945–0.980; phi = 0.98 gives
  0.018–0.069 and coverage 0.933–0.978 on the cells the gate accepts. The price is wide intervals: for
  persistent series the degrees of freedom become small, so the critical value is large.
  A true trend in a strongly persistent series is therefore hard to detect; power was not studied.
* Two cells exceed the tolerance: phi = 0.98, 120 months, 10 % random gaps, with the seasonal step (0.085
  and 0.080, coverage 0.911 and 0.913). The production gate refuses both (fewer than 120 valid months).
  The maximum over all 168 cells is 0.085.
* The mean residual lag-1 autocorrelation of the stress scenarios is 0.74–0.96. `fit_trend` adds the
  warning diagnostic `strong_persistence` when the residual lag-1 autocorrelation of a fitted series is
  ≥ 0.9 (`DIAGNOSTIC_DEFAULTS["persistence_warn_r1"]`): such a series is tested conservatively with low
  power, and a slow non-stationary drift or long memory — which was not simulated — cannot be told apart
  from a trend. The estimate is not changed.
* The plain rule-of-thumb Newey–West HAC with `n - 2` degrees of freedom (`fixed`) reaches a false-positive
  rate of 0.17 at phi = 0.6 and 0.70 at phi = 0.98. It must not be substituted for the shipped policy.

Full table for `fixed_pw_sdof`:

| phi | n | missing | seasonal | FPR | CI coverage | mean lag | mean residual r1 | gate pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 120 | none | no | 0.056 | 0.945 | 4.0 | -0.02 | 100% |
| 0 | 120 | none | yes | 0.066 | 0.936 | 4.0 | -0.01 | 100% |
| 0 | 120 | random10 | no | 0.060 | 0.947 | 4.0 | -0.02 | 0% |
| 0 | 120 | random10 | yes | 0.059 | 0.936 | 4.0 | -0.01 | 0% |
| 0 | 120 | block11 | no | 0.060 | 0.948 | 4.0 | -0.02 | 0% |
| 0 | 120 | block11 | yes | 0.067 | 0.929 | 4.0 | -0.01 | 0% |
| 0 | 120 | random10+block11 | no | 0.052 | 0.951 | 4.0 | -0.02 | 0% |
| 0 | 120 | random10+block11 | yes | 0.063 | 0.940 | 4.0 | -0.01 | 0% |
| 0 | 240 | none | no | 0.058 | 0.947 | 4.0 | -0.01 | 100% |
| 0 | 240 | none | yes | 0.054 | 0.946 | 4.0 | -0.01 | 100% |
| 0 | 240 | random10 | no | 0.054 | 0.952 | 4.0 | -0.01 | 100% |
| 0 | 240 | random10 | yes | 0.049 | 0.940 | 4.0 | -0.01 | 100% |
| 0 | 240 | block11 | no | 0.054 | 0.949 | 4.0 | -0.01 | 100% |
| 0 | 240 | block11 | yes | 0.056 | 0.940 | 4.0 | -0.01 | 100% |
| 0 | 240 | random10+block11 | no | 0.054 | 0.949 | 4.0 | -0.01 | 100% |
| 0 | 240 | random10+block11 | yes | 0.062 | 0.948 | 4.0 | -0.01 | 100% |
| 0 | 320 | none | no | 0.054 | 0.948 | 5.0 | -0.01 | 100% |
| 0 | 320 | none | yes | 0.053 | 0.941 | 5.0 | -0.01 | 100% |
| 0 | 320 | random10 | no | 0.053 | 0.948 | 5.0 | -0.01 | 100% |
| 0 | 320 | random10 | yes | 0.054 | 0.946 | 5.0 | -0.01 | 100% |
| 0 | 320 | block11 | no | 0.059 | 0.949 | 5.0 | -0.01 | 100% |
| 0 | 320 | block11 | yes | 0.054 | 0.953 | 5.0 | -0.01 | 100% |
| 0 | 320 | random10+block11 | no | 0.057 | 0.949 | 5.0 | -0.01 | 100% |
| 0 | 320 | random10+block11 | yes | 0.051 | 0.948 | 5.0 | -0.01 | 100% |
| 0.3 | 120 | none | no | 0.045 | 0.940 | 4.0 | 0.27 | 100% |
| 0.3 | 120 | none | yes | 0.069 | 0.938 | 4.0 | 0.28 | 100% |
| 0.3 | 120 | random10 | no | 0.049 | 0.939 | 4.0 | 0.27 | 0% |
| 0.3 | 120 | random10 | yes | 0.056 | 0.935 | 4.0 | 0.28 | 0% |
| 0.3 | 120 | block11 | no | 0.052 | 0.943 | 4.0 | 0.27 | 0% |
| 0.3 | 120 | block11 | yes | 0.066 | 0.937 | 4.0 | 0.28 | 0% |
| 0.3 | 120 | random10+block11 | no | 0.057 | 0.947 | 4.0 | 0.27 | 0% |
| 0.3 | 120 | random10+block11 | yes | 0.058 | 0.940 | 4.0 | 0.27 | 0% |
| 0.3 | 240 | none | no | 0.055 | 0.952 | 4.0 | 0.29 | 100% |
| 0.3 | 240 | none | yes | 0.054 | 0.951 | 4.0 | 0.29 | 100% |
| 0.3 | 240 | random10 | no | 0.044 | 0.946 | 4.0 | 0.29 | 100% |
| 0.3 | 240 | random10 | yes | 0.054 | 0.947 | 4.0 | 0.28 | 100% |
| 0.3 | 240 | block11 | no | 0.051 | 0.941 | 4.0 | 0.29 | 100% |
| 0.3 | 240 | block11 | yes | 0.054 | 0.938 | 4.0 | 0.29 | 100% |
| 0.3 | 240 | random10+block11 | no | 0.047 | 0.944 | 4.0 | 0.29 | 100% |
| 0.3 | 240 | random10+block11 | yes | 0.058 | 0.949 | 4.0 | 0.28 | 100% |
| 0.3 | 320 | none | no | 0.053 | 0.946 | 5.0 | 0.29 | 100% |
| 0.3 | 320 | none | yes | 0.053 | 0.954 | 5.0 | 0.29 | 100% |
| 0.3 | 320 | random10 | no | 0.051 | 0.945 | 5.0 | 0.29 | 100% |
| 0.3 | 320 | random10 | yes | 0.054 | 0.950 | 5.0 | 0.28 | 100% |
| 0.3 | 320 | block11 | no | 0.057 | 0.945 | 5.0 | 0.29 | 100% |
| 0.3 | 320 | block11 | yes | 0.053 | 0.950 | 5.0 | 0.29 | 100% |
| 0.3 | 320 | random10+block11 | no | 0.045 | 0.953 | 5.0 | 0.29 | 100% |
| 0.3 | 320 | random10+block11 | yes | 0.049 | 0.947 | 5.0 | 0.28 | 100% |
| 0.6 | 120 | none | no | 0.048 | 0.957 | 4.0 | 0.56 | 100% |
| 0.6 | 120 | none | yes | 0.051 | 0.952 | 4.0 | 0.57 | 100% |
| 0.6 | 120 | random10 | no | 0.045 | 0.957 | 4.0 | 0.56 | 0% |
| 0.6 | 120 | random10 | yes | 0.049 | 0.949 | 4.0 | 0.56 | 0% |
| 0.6 | 120 | block11 | no | 0.047 | 0.950 | 4.0 | 0.56 | 0% |
| 0.6 | 120 | block11 | yes | 0.051 | 0.947 | 4.0 | 0.57 | 0% |
| 0.6 | 120 | random10+block11 | no | 0.049 | 0.961 | 4.0 | 0.55 | 0% |
| 0.6 | 120 | random10+block11 | yes | 0.050 | 0.947 | 4.0 | 0.56 | 0% |
| 0.6 | 240 | none | no | 0.050 | 0.949 | 4.0 | 0.58 | 100% |
| 0.6 | 240 | none | yes | 0.050 | 0.951 | 4.0 | 0.58 | 100% |
| 0.6 | 240 | random10 | no | 0.045 | 0.959 | 4.0 | 0.58 | 100% |
| 0.6 | 240 | random10 | yes | 0.047 | 0.951 | 4.0 | 0.57 | 100% |
| 0.6 | 240 | block11 | no | 0.048 | 0.949 | 4.0 | 0.58 | 100% |
| 0.6 | 240 | block11 | yes | 0.048 | 0.954 | 4.0 | 0.58 | 100% |
| 0.6 | 240 | random10+block11 | no | 0.038 | 0.955 | 4.0 | 0.58 | 100% |
| 0.6 | 240 | random10+block11 | yes | 0.045 | 0.959 | 4.0 | 0.57 | 100% |
| 0.6 | 320 | none | no | 0.053 | 0.957 | 5.0 | 0.59 | 100% |
| 0.6 | 320 | none | yes | 0.046 | 0.957 | 5.0 | 0.58 | 100% |
| 0.6 | 320 | random10 | no | 0.043 | 0.958 | 5.0 | 0.58 | 100% |
| 0.6 | 320 | random10 | yes | 0.045 | 0.963 | 5.0 | 0.57 | 100% |
| 0.6 | 320 | block11 | no | 0.047 | 0.957 | 5.0 | 0.59 | 100% |
| 0.6 | 320 | block11 | yes | 0.045 | 0.950 | 5.0 | 0.58 | 100% |
| 0.6 | 320 | random10+block11 | no | 0.038 | 0.958 | 5.0 | 0.58 | 100% |
| 0.6 | 320 | random10+block11 | yes | 0.042 | 0.955 | 5.0 | 0.57 | 100% |
| 0.8 | 120 | none | no | 0.042 | 0.960 | 4.0 | 0.75 | 100% |
| 0.8 | 120 | none | yes | 0.036 | 0.956 | 4.0 | 0.76 | 100% |
| 0.8 | 120 | random10 | no | 0.030 | 0.961 | 4.0 | 0.75 | 0% |
| 0.8 | 120 | random10 | yes | 0.038 | 0.964 | 4.0 | 0.75 | 0% |
| 0.8 | 120 | block11 | no | 0.040 | 0.959 | 4.0 | 0.75 | 0% |
| 0.8 | 120 | block11 | yes | 0.041 | 0.959 | 4.0 | 0.76 | 0% |
| 0.8 | 120 | random10+block11 | no | 0.033 | 0.967 | 4.0 | 0.74 | 0% |
| 0.8 | 120 | random10+block11 | yes | 0.031 | 0.959 | 4.0 | 0.75 | 0% |
| 0.8 | 240 | none | no | 0.035 | 0.956 | 4.0 | 0.78 | 100% |
| 0.8 | 240 | none | yes | 0.041 | 0.956 | 4.0 | 0.78 | 100% |
| 0.8 | 240 | random10 | no | 0.036 | 0.959 | 4.0 | 0.78 | 100% |
| 0.8 | 240 | random10 | yes | 0.037 | 0.958 | 4.0 | 0.76 | 100% |
| 0.8 | 240 | block11 | no | 0.034 | 0.960 | 4.0 | 0.78 | 100% |
| 0.8 | 240 | block11 | yes | 0.044 | 0.963 | 4.0 | 0.78 | 100% |
| 0.8 | 240 | random10+block11 | no | 0.040 | 0.967 | 4.0 | 0.77 | 100% |
| 0.8 | 240 | random10+block11 | yes | 0.038 | 0.959 | 4.0 | 0.76 | 100% |
| 0.8 | 320 | none | no | 0.037 | 0.965 | 5.0 | 0.78 | 100% |
| 0.8 | 320 | none | yes | 0.035 | 0.959 | 5.0 | 0.78 | 100% |
| 0.8 | 320 | random10 | no | 0.026 | 0.966 | 5.0 | 0.78 | 100% |
| 0.8 | 320 | random10 | yes | 0.033 | 0.968 | 5.0 | 0.77 | 100% |
| 0.8 | 320 | block11 | no | 0.034 | 0.967 | 5.0 | 0.78 | 100% |
| 0.8 | 320 | block11 | yes | 0.034 | 0.963 | 5.0 | 0.78 | 100% |
| 0.8 | 320 | random10+block11 | no | 0.031 | 0.973 | 5.0 | 0.78 | 100% |
| 0.8 | 320 | random10+block11 | yes | 0.035 | 0.967 | 5.0 | 0.77 | 100% |
| 0.9 | 120 | none | no | 0.044 | 0.963 | 4.0 | 0.85 | 100% |
| 0.9 | 120 | none | yes | 0.035 | 0.959 | 4.0 | 0.85 | 100% |
| 0.9 | 120 | random10 | no | 0.036 | 0.965 | 4.0 | 0.84 | 0% |
| 0.9 | 120 | random10 | yes | 0.036 | 0.964 | 4.0 | 0.84 | 0% |
| 0.9 | 120 | block11 | no | 0.043 | 0.964 | 4.0 | 0.84 | 0% |
| 0.9 | 120 | block11 | yes | 0.034 | 0.964 | 4.0 | 0.85 | 0% |
| 0.9 | 120 | random10+block11 | no | 0.035 | 0.968 | 4.0 | 0.83 | 0% |
| 0.9 | 120 | random10+block11 | yes | 0.042 | 0.962 | 4.0 | 0.83 | 0% |
| 0.9 | 240 | none | no | 0.040 | 0.967 | 4.0 | 0.87 | 100% |
| 0.9 | 240 | none | yes | 0.039 | 0.961 | 4.0 | 0.87 | 100% |
| 0.9 | 240 | random10 | no | 0.028 | 0.968 | 4.0 | 0.87 | 100% |
| 0.9 | 240 | random10 | yes | 0.039 | 0.965 | 4.0 | 0.86 | 100% |
| 0.9 | 240 | block11 | no | 0.035 | 0.966 | 4.0 | 0.87 | 100% |
| 0.9 | 240 | block11 | yes | 0.036 | 0.964 | 4.0 | 0.87 | 100% |
| 0.9 | 240 | random10+block11 | no | 0.029 | 0.975 | 4.0 | 0.87 | 100% |
| 0.9 | 240 | random10+block11 | yes | 0.038 | 0.960 | 4.0 | 0.86 | 100% |
| 0.9 | 320 | none | no | 0.030 | 0.972 | 5.0 | 0.88 | 100% |
| 0.9 | 320 | none | yes | 0.031 | 0.969 | 5.0 | 0.88 | 100% |
| 0.9 | 320 | random10 | no | 0.023 | 0.975 | 5.0 | 0.88 | 100% |
| 0.9 | 320 | random10 | yes | 0.030 | 0.973 | 5.0 | 0.87 | 100% |
| 0.9 | 320 | block11 | no | 0.030 | 0.971 | 5.0 | 0.88 | 100% |
| 0.9 | 320 | block11 | yes | 0.029 | 0.971 | 5.0 | 0.88 | 100% |
| 0.9 | 320 | random10+block11 | no | 0.024 | 0.977 | 5.0 | 0.88 | 100% |
| 0.9 | 320 | random10+block11 | yes | 0.029 | 0.966 | 5.0 | 0.87 | 100% |
| 0.95 | 120 | none | no | 0.048 | 0.957 | 4.0 | 0.88 | 100% |
| 0.95 | 120 | none | yes | 0.037 | 0.964 | 4.0 | 0.89 | 100% |
| 0.95 | 120 | random10 | no | 0.034 | 0.962 | 4.0 | 0.88 | 0% |
| 0.95 | 120 | random10 | yes | 0.050 | 0.950 | 4.0 | 0.87 | 0% |
| 0.95 | 120 | block11 | no | 0.043 | 0.959 | 4.0 | 0.88 | 0% |
| 0.95 | 120 | block11 | yes | 0.039 | 0.960 | 4.0 | 0.89 | 0% |
| 0.95 | 120 | random10+block11 | no | 0.038 | 0.964 | 4.0 | 0.87 | 0% |
| 0.95 | 120 | random10+block11 | yes | 0.049 | 0.945 | 4.0 | 0.87 | 0% |
| 0.95 | 240 | none | no | 0.037 | 0.965 | 4.0 | 0.92 | 100% |
| 0.95 | 240 | none | yes | 0.035 | 0.955 | 4.0 | 0.92 | 100% |
| 0.95 | 240 | random10 | no | 0.032 | 0.969 | 4.0 | 0.92 | 100% |
| 0.95 | 240 | random10 | yes | 0.045 | 0.954 | 4.0 | 0.91 | 100% |
| 0.95 | 240 | block11 | no | 0.036 | 0.967 | 4.0 | 0.92 | 100% |
| 0.95 | 240 | block11 | yes | 0.033 | 0.963 | 4.0 | 0.92 | 100% |
| 0.95 | 240 | random10+block11 | no | 0.029 | 0.974 | 4.0 | 0.92 | 100% |
| 0.95 | 240 | random10+block11 | yes | 0.043 | 0.959 | 4.0 | 0.90 | 100% |
| 0.95 | 320 | none | no | 0.030 | 0.974 | 5.0 | 0.93 | 100% |
| 0.95 | 320 | none | yes | 0.028 | 0.974 | 5.0 | 0.93 | 100% |
| 0.95 | 320 | random10 | no | 0.025 | 0.979 | 5.0 | 0.93 | 100% |
| 0.95 | 320 | random10 | yes | 0.038 | 0.968 | 5.0 | 0.91 | 100% |
| 0.95 | 320 | block11 | no | 0.023 | 0.980 | 5.0 | 0.93 | 100% |
| 0.95 | 320 | block11 | yes | 0.028 | 0.977 | 5.0 | 0.93 | 100% |
| 0.95 | 320 | random10+block11 | no | 0.019 | 0.980 | 5.0 | 0.93 | 100% |
| 0.95 | 320 | random10+block11 | yes | 0.032 | 0.967 | 5.0 | 0.91 | 100% |
| 0.98 | 120 | none | no | 0.062 | 0.938 | 4.0 | 0.90 | 100% |
| 0.98 | 120 | none | yes | 0.054 | 0.951 | 4.0 | 0.91 | 100% |
| 0.98 | 120 | random10 | no | 0.052 | 0.943 | 4.0 | 0.90 | 0% |
| 0.98 | 120 | random10 | yes | 0.085 | 0.911 | 4.0 | 0.88 | 0% |
| 0.98 | 120 | block11 | no | 0.054 | 0.936 | 4.0 | 0.90 | 0% |
| 0.98 | 120 | block11 | yes | 0.057 | 0.943 | 4.0 | 0.90 | 0% |
| 0.98 | 120 | random10+block11 | no | 0.054 | 0.953 | 4.0 | 0.89 | 0% |
| 0.98 | 120 | random10+block11 | yes | 0.080 | 0.913 | 4.0 | 0.88 | 0% |
| 0.98 | 240 | none | no | 0.051 | 0.959 | 4.0 | 0.94 | 100% |
| 0.98 | 240 | none | yes | 0.044 | 0.950 | 4.0 | 0.94 | 100% |
| 0.98 | 240 | random10 | no | 0.037 | 0.965 | 4.0 | 0.94 | 100% |
| 0.98 | 240 | random10 | yes | 0.069 | 0.935 | 4.0 | 0.93 | 100% |
| 0.98 | 240 | block11 | no | 0.043 | 0.953 | 4.0 | 0.94 | 100% |
| 0.98 | 240 | block11 | yes | 0.040 | 0.960 | 4.0 | 0.94 | 100% |
| 0.98 | 240 | random10+block11 | no | 0.031 | 0.965 | 4.0 | 0.94 | 100% |
| 0.98 | 240 | random10+block11 | yes | 0.069 | 0.933 | 4.0 | 0.93 | 100% |
| 0.98 | 320 | none | no | 0.028 | 0.969 | 5.0 | 0.96 | 100% |
| 0.98 | 320 | none | yes | 0.031 | 0.968 | 5.0 | 0.95 | 100% |
| 0.98 | 320 | random10 | no | 0.021 | 0.978 | 5.0 | 0.95 | 100% |
| 0.98 | 320 | random10 | yes | 0.046 | 0.959 | 5.0 | 0.94 | 100% |
| 0.98 | 320 | block11 | no | 0.029 | 0.974 | 5.0 | 0.95 | 100% |
| 0.98 | 320 | block11 | yes | 0.029 | 0.968 | 5.0 | 0.95 | 100% |
| 0.98 | 320 | random10+block11 | no | 0.018 | 0.977 | 5.0 | 0.95 | 100% |
| 0.98 | 320 | random10+block11 | yes | 0.043 | 0.955 | 5.0 | 0.94 | 100% |

## 6. Annual series (supplementary; partly outside tolerance)

Annual indicator metrics have 20–45 values. A supplementary grid of complete years gives, for the shipped
policy (Gaussian AR(1) years, and independent Poisson counts whose true-trend draws have a linearly
increasing mean):

| noise | n (years) | FPR | CI coverage | mean lag |
| --- | --- | --- | --- | --- |
| AR(1) phi = 0 | 20 | 0.068 | 0.938 | 2.0 |
| AR(1) phi = 0 | 25 | 0.064 | 0.937 | 2.0 |
| AR(1) phi = 0 | 30 | 0.062 | 0.933 | 3.0 |
| AR(1) phi = 0 | 40 | 0.061 | 0.939 | 3.0 |
| AR(1) phi = 0.3 | 20 | 0.083 | 0.904 | 2.0 |
| AR(1) phi = 0.3 | 25 | 0.084 | 0.914 | 2.0 |
| AR(1) phi = 0.3 | 30 | 0.083 | 0.925 | 3.0 |
| AR(1) phi = 0.3 | 40 | 0.075 | 0.928 | 3.0 |
| AR(1) phi = 0.6 | 20 | 0.114 | 0.876 | 2.0 |
| AR(1) phi = 0.6 | 25 | 0.111 | 0.889 | 2.0 |
| AR(1) phi = 0.6 | 30 | 0.084 | 0.909 | 3.0 |
| AR(1) phi = 0.6 | 40 | 0.074 | 0.927 | 3.0 |
| Poisson counts, mean 1 | 20 | 0.061 | 0.939 | 2.0 |
| Poisson counts, mean 1 | 25 | 0.069 | 0.940 | 2.0 |
| Poisson counts, mean 1 | 30 | 0.062 | 0.940 | 3.0 |
| Poisson counts, mean 1 | 40 | 0.059 | 0.931 | 3.0 |
| Poisson counts, mean 4 | 20 | 0.069 | 0.938 | 2.0 |
| Poisson counts, mean 4 | 25 | 0.066 | 0.938 | 2.0 |
| Poisson counts, mean 4 | 30 | 0.066 | 0.939 | 3.0 |
| Poisson counts, mean 4 | 40 | 0.060 | 0.939 | 3.0 |

False-positive rate by candidate on the same grid:

| noise | n (years) | `fixed` | `nw94` | `fixed_pw` | `nw94_pw` | `fixed_pw_neff` | `nw94_pw_neff` | `fixed_pw_sdof` | `nw94_pw_sdof` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AR(1) phi = 0 | 20 | 0.120 | 0.212 | 0.119 | 0.215 | 0.117 | 0.212 | 0.068 | 0.037 |
| AR(1) phi = 0 | 25 | 0.102 | 0.186 | 0.100 | 0.186 | 0.099 | 0.185 | 0.064 | 0.045 |
| AR(1) phi = 0 | 30 | 0.116 | 0.200 | 0.113 | 0.199 | 0.112 | 0.197 | 0.062 | 0.040 |
| AR(1) phi = 0 | 40 | 0.096 | 0.170 | 0.093 | 0.170 | 0.093 | 0.169 | 0.061 | 0.046 |
| AR(1) phi = 0.3 | 20 | 0.167 | 0.223 | 0.151 | 0.215 | 0.141 | 0.208 | 0.083 | 0.062 |
| AR(1) phi = 0.3 | 25 | 0.154 | 0.203 | 0.133 | 0.192 | 0.127 | 0.180 | 0.084 | 0.076 |
| AR(1) phi = 0.3 | 30 | 0.165 | 0.227 | 0.148 | 0.223 | 0.143 | 0.215 | 0.083 | 0.067 |
| AR(1) phi = 0.3 | 40 | 0.144 | 0.197 | 0.124 | 0.194 | 0.119 | 0.185 | 0.075 | 0.064 |
| AR(1) phi = 0.6 | 20 | 0.275 | 0.302 | 0.209 | 0.246 | 0.187 | 0.222 | 0.114 | 0.099 |
| AR(1) phi = 0.6 | 25 | 0.271 | 0.287 | 0.195 | 0.215 | 0.173 | 0.195 | 0.111 | 0.105 |
| AR(1) phi = 0.6 | 30 | 0.258 | 0.292 | 0.190 | 0.241 | 0.169 | 0.218 | 0.084 | 0.078 |
| AR(1) phi = 0.6 | 40 | 0.223 | 0.242 | 0.157 | 0.192 | 0.145 | 0.173 | 0.074 | 0.067 |
| Poisson counts, mean 1 | 20 | 0.115 | 0.206 | 0.110 | 0.205 | 0.108 | 0.203 | 0.061 | 0.039 |
| Poisson counts, mean 1 | 25 | 0.108 | 0.185 | 0.104 | 0.183 | 0.102 | 0.181 | 0.069 | 0.046 |
| Poisson counts, mean 1 | 30 | 0.110 | 0.205 | 0.107 | 0.205 | 0.106 | 0.203 | 0.062 | 0.038 |
| Poisson counts, mean 1 | 40 | 0.099 | 0.183 | 0.095 | 0.183 | 0.095 | 0.183 | 0.059 | 0.044 |
| Poisson counts, mean 4 | 20 | 0.123 | 0.210 | 0.118 | 0.210 | 0.117 | 0.208 | 0.069 | 0.040 |
| Poisson counts, mean 4 | 25 | 0.102 | 0.178 | 0.097 | 0.177 | 0.096 | 0.176 | 0.066 | 0.045 |
| Poisson counts, mean 4 | 30 | 0.120 | 0.208 | 0.116 | 0.209 | 0.115 | 0.208 | 0.066 | 0.047 |
| Poisson counts, mean 4 | 40 | 0.104 | 0.174 | 0.100 | 0.176 | 0.099 | 0.175 | 0.060 | 0.051 |

Reading:

* **Independent years — Gaussian or Poisson counts — are inside the tolerance** at every length from 20
  to 40 years: false-positive rate 0.059–0.069, coverage 0.931–0.940.
* **Years that are correlated with each other are over-rejected when the series is short**: phi = 0.3 gives
  0.075–0.084; phi = 0.6 gives 0.111–0.114 at 20–25 years, 0.084 at 30 and 0.074 at 40, with coverage down
  to 0.876. This is **outside the tolerance**. The lag-1 coefficient of 20–30 values is too noisy and too
  biased towards zero for any of the candidates to repair this; `nw94_pw_sdof` is only slightly better at phi = 0.6
  (0.067–0.105).
* The rule in §3 is defined on the monthly design scenarios and was not changed after seeing this table.

Consequences:

* every inference on fewer than 100 valid samples (in practice: every annual inference) carries the warning
  diagnostic `small_sample_inference` (`DIAGNOSTIC_DEFAULTS["small_sample_warn_n"]`), whose text states the
  condition above;
* autocorrelated, zero-inflated or censored annual counts were not simulated; the `sparse_counts` gate only
  removes the most degenerate case;
* open decision for the policy owner (§8).

## 7. Run-time behaviour that follows from this study

| Situation | Behaviour |
| --- | --- |
| Applicability gate fails (span, valid samples, coverage, gap length, gap concentration, constant series, sparse counts, non-finite values, zero residuals) | descriptive slope only; CI / p = null; `inference_status: not_applicable`; blocking diagnostic with the reason |
| Missing steps before the first or after the last valid sample of the analysis period | not a gap: they lower coverage and shorten the supported span (both gated), and the fit equals that of the trimmed window; `longest_gap` counts runs between valid samples only |
| Residual lag-1 autocorrelation ≥ 0.9 | inference reported (conservative in the study), warning `strong_persistence` |
| Inference on fewer than 100 valid samples (annual series) | inference reported, warning `small_sample_inference` |
| Curvature / half-period slope sign change / influential outliers / gaps | informational or warning diagnostics; the estimate is never altered |

Diagnostic thresholds other than the two derived above (`quadratic_rss_gain_warn = 0.10`,
`outlier_robust_z = 5`, `outlier_slope_change_se = 1`) are engineering defaults without a calibration
behind them. All can be overridden from `method_policy.json` under `"diagnostics"`.

The raw p-values feed Benjamini–Yekutieli (2001) adjustment. BY controls the false discovery rate under
arbitrary dependence **given valid p-values**; it does not repair a liberal single test (spec §7.3). The
interval stays pointwise and is not adjusted for selection.

## 8. Open points for the policy owner

1. **Annual inference.** Spec §7.2 says that a method that has not passed its applicability validation
   must return a descriptive result only. Annual inference passes for independent years and fails for
   short, year-to-year persistent series (§6), and the two cannot be told apart reliably from 20–30 values.
   Options: (a) keep `annual_inference.min_valid_years = 20` and rely on the warning — the current
   behaviour; (b) raise it to 40, the shortest of the simulated lengths (20, 25, 30, 40) at which every
   annual cell is inside the tolerance band, two of them at its upper edge (this removes inference from most annual metrics of products that start around 2000);
   (c) commission an annual method with its own pre-declared rule.
2. `monthly_inference.max_gap_share_in_one_block` is implemented as "the longest gap holds more than this
   share of the months missing between the first and last valid sample **and** is longer than 12 months".
   Without the second condition a single missing month (100 % of the missing months) would block inference.
   The 12-month guard is a default in `stats/policy.py` (`GATE_DEFAULTS`); it should be moved into the
   policy file.
3. With the two rules together, a gap block of 13–18 months passes only when other missing months make up
   at least half of the total; such a block is longer than the calibrated 11-month block.

## References

* Newey, W. K. & West, K. D. (1987). A simple, positive semi-definite, heteroskedasticity and autocorrelation
  consistent covariance matrix. *Econometrica* 55(3), 703–708.
* Newey, W. K. & West, K. D. (1994). Automatic lag selection in covariance matrix estimation.
  *Review of Economic Studies* 61(4), 631–653.
* Andrews, D. W. K. & Monahan, J. C. (1992). An improved heteroskedasticity and autocorrelation consistent
  covariance matrix estimator. *Econometrica* 60(4), 953–966.
* Datta, D. D. & Du, W. (2012). Nonparametric HAC estimation for time series data with missing observations.
  Board of Governors of the Federal Reserve System, International Finance Discussion Papers 1060.
  https://www.federalreserve.gov/pubs/ifdp/2012/1060/ifdp1060.htm
* Santer, B. D. et al. (2000). Statistical significance of trends and trend differences in layer-average
  atmospheric temperature time series. *Journal of Geophysical Research* 105(D6), 7337–7356.
  doi:10.1029/1999JD901105
* Benjamini, Y. & Yekutieli, D. (2001). The control of the false discovery rate in multiple testing under
  dependency. *Annals of Statistics* 29(4), 1165–1188.
* Bradley, J. V. (1978). Robustness? *British Journal of Mathematical and Statistical Psychology* 31, 144–152.
* Reference implementations used in the tests: statsmodels `cov_hac`
  (https://www.statsmodels.org/stable/generated/statsmodels.stats.sandwich_covariance.cov_hac.html) and SciPy
  `false_discovery_control`
  (https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.false_discovery_control.html).
