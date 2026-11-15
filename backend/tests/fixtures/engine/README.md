# Engine test fixtures — TEST DATA ONLY

`engine_support.py` holds helpers for `tests/test_engine_*.py`, `tests/test_resolve_*.py` and
`tests/test_present_*.py`:

- `FakeSelector` — a scripted stand-in for `PhenomenonSelector` (no model, no network). Its plans are
  labelled `provider: "test_scripted"`, `is_language_model: false`.
- `make_plan` — builds a `SelectionPlan` from explicit variable / recipe ids.
- `FakePresetEngine` — a scripted preset engine implementing the `fill()` protocol of `aqua_trend.engine`.
- `build_engine_release` — the miniature TEST release of `tests/fixtures/store` with longer TEST series
  (arbitrary numbers, ids start with `t_`); nothing in it is a scientific product or result.

Tests marked `realdata` read the prepared series under `web/public/data` and assert structural facts
(which product, which status, which periods), not scientific conclusions.
