# Preset test fixtures — TEST DATA ONLY

`presets_support.py` builds a miniature TEST release for `tests/test_presets_*.py`:

- ids start with `t_` / `reg-` / `hex-`; every value is an arbitrary, deterministic test number
  (a line + a fixed 12-month pattern + seeded pseudo-random noise). Nothing in it is a scientific
  product, an observation or a result.
- 34 years of monthly TEST series (1988-01 .. 2021-12) so that the registered 10 / 20 / 30-year
  candidate windows of `preset_policy.json` exist; the fixed TEST baseline is 1991-01 .. 2020-12.
- regions: `reg-a` (named; strong TEST trend), `reg-c` (named; fallback precipitation product only),
  `reg-f` (lme; noise only), `reg-g` (sea; constant soil series = zero baseline variance),
  `reg-e` (basin3; record starts 2005, so the fixed baseline is not supported), `reg-b` (basin4 with
  series: reachable by user selection, not searched automatically), `reg-n` (named, boundary only),
  `hex-t1` (hex, no series).
- policies are copied from `backend/catalogue/policies` (the real, registered policy files).

`FakeSelector` / `make_plan` come from `tests/fixtures/engine/engine_support.py` (scripted TEST plans,
`is_language_model: false`).
