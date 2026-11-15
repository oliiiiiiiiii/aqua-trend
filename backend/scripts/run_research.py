#!/usr/bin/env python
"""Run one research from the command line (spec §4: the same engine as the API).

Examples (from ``backend/``)::

    AQUA_SELECTOR=catalogue_lexical .venv/bin/python scripts/run_research.py "drought" \
        --region named-taiwan-main-island --start 2005-01 --end 2024-12
    AQUA_SELECTOR=catalogue_lexical .venv/bin/python scripts/run_research.py "淹水" \
        --region named-taiwan-main-island --start 2005-01 --end 2024-12 --format csv --out flood.csv

The selector is taken from the environment (``AQUA_SELECTOR``, ``ANTHROPIC_API_KEY``); there is
no silent fallback: without a configured selector and without a saved plan the command fails
with ``selector_unavailable``.  ``--no-save`` keeps the run out of ``backend/var``.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.engine import ResearchEngine  # noqa: E402
from aqua_trend.errors import AquaError  # noqa: E402
from aqua_trend.present import ResultPresenter  # noqa: E402
from aqua_trend.selection import PhenomenonSelector  # noqa: E402
from aqua_trend.storage import ResearchStorage  # noqa: E402
from aqua_trend.store import PreparedDataStore  # noqa: E402


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one Earth System Trend Detective research.")
    parser.add_argument("query", help="phenomenon in natural language (it never sets the region or the period)")
    parser.add_argument("--region", help="one region id of the region catalogue (optional)")
    parser.add_argument("--start", help="period start, YYYY-MM (needs --end)")
    parser.add_argument("--end", help="period end, YYYY-MM (needs --start)")
    parser.add_argument("--parent", help="parent research id (re-analysis with the saved plan)")
    parser.add_argument("--preset", help="preset reference ID@VERSION to open")
    parser.add_argument("--reselect", action="store_true", help="ask the selector again and create a new plan")
    parser.add_argument("--format", choices=("text", "json", "csv"), default="text")
    parser.add_argument("--out", help="write the output to this file instead of stdout")
    parser.add_argument("--no-save", action="store_true", help="do not store the result under backend/var")
    parser.add_argument("--var-dir", help="runtime directory (default backend/var or AQUA_VAR_DIR)")
    parser.add_argument("--with-presets", action="store_true",
                        help="use aqua_trend.presets to fill a blank region / period (when that package exists)")
    parser.add_argument("--quiet", action="store_true", help="no stage progress on stderr")
    return parser.parse_args(argv)


def build_request(args: argparse.Namespace) -> C.ResearchRequest:
    if bool(args.start) != bool(args.end):
        raise AquaError("invalid_period", "Give both --start and --end, or neither.", fields=["period"])
    preset_ref = None
    if args.preset:
        preset_id, _, version = args.preset.partition("@")
        if not version:
            raise AquaError("invalid_context", "--preset needs ID@VERSION.", fields=["context.preset_ref"])
        preset_ref = C.PresetRef(id=preset_id, version=version)
    return C.ResearchRequest(
        phenomenon_query=args.query, region_id=args.region,
        period=C.Period(start=args.start, end=args.end) if args.start else None,
        context=C.RequestContext(parent_research_id=args.parent, preset_ref=preset_ref),
        options=C.RequestOptions(reselect=args.reselect))


def text_report(result: C.ResearchResult) -> str:
    """Compact human-readable view: conditions, one line per item, then the summary statements."""
    lines = [f"research {result.identity.research_id}  status={result.identity.status}  "
             f"cache_key={result.identity.cache_key}"]
    region, period = result.resolved.region, result.resolved.period
    lines.append(f"region: {region.id if region else None} [{region.source if region else '-'}]   "
                 f"period: {(period.start + '..' + period.end) if period else None} "
                 f"[{period.source if period else '-'}]   preset: {result.resolved.preset_status}")
    if result.selection is not None:
        plan = result.selection
        lines.append(f"plan {plan.selection_plan_id} ({plan.selector.provider}, language model: "
                     f"{plan.selector.is_language_model}, status {plan.status}, reused {plan.reused})")
    lines.append("")
    for v in result.variables:
        lines.append(f"  variable {v.variable_id:<22} {v.status:<22} product={v.product.selected_product_id} "
                     f"rank={v.product.priority_rank} {_trend_text(v.trend)}")
    for ind in result.indicators:
        lines.append(f"  {ind.kind} {ind.indicator_id}: {ind.status}"
                     + (f" — {ind.status_reason}" if ind.status_reason else ""))
        for m in ind.metrics:
            lines.append(f"      {m.metric_id:<40} {m.status:<20} {_trend_text(m.trend)}")
    for family in result.evidence_families:
        lines.append(f"  family {family.family_id} [{family.scope}] candidates={family.n_candidates} "
                     f"tested={family.n_tested} complete={family.complete}")
    lines.append("")
    if result.summary is not None:
        lines.append(f"summary ({result.summary.status}):")
        lines += [f"  - {s.text}" for s in result.summary.statements]
    lines.append("")
    lines += [f"  ! [{w.code}] {w.message}" for w in result.warnings]
    return "\n".join(lines) + "\n"


def _trend_text(trend: C.TrendResult | None) -> str:
    if trend is None or trend.slope_per_decade is None:
        return "no trend"
    text = f"{trend.slope_per_decade:+.4g} {trend.unit}/decade"
    if trend.ci95_per_decade is not None:
        text += f" CI[{trend.ci95_per_decade.lo:+.4g}, {trend.ci95_per_decade.hi:+.4g}] p_raw={trend.p_raw:.4g}"
        adjusted = trend.p_adjusted.get(trend.primary_family_id or "")
        if adjusted is not None:
            text += f" p_adj={adjusted:.4g}"
    return f"{text} -> {trend.significance_label}"


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        store = PreparedDataStore.open()
        storage = None if args.no_save else ResearchStorage(args.var_dir)
        selector = PhenomenonSelector(store)
        preset_engine = None
        if args.with_presets:
            from aqua_trend.presets import PresetEngine          # provided by the preset work package
            preset_engine = PresetEngine(store, storage=storage)
        engine = ResearchEngine(store, selector, preset_engine=preset_engine, storage=storage)
        if preset_engine is not None and hasattr(preset_engine, "bind"):
            preset_engine.bind(engine)

        def on_stage(stage: str, completed: int, total: int, detail: str | None) -> None:
            if not args.quiet:
                print(f"[{stage}] {completed}/{total} {detail or ''}".rstrip(), file=sys.stderr)

        result = engine.run(build_request(args), engine.catalogue_snapshot(), engine.policy_snapshot(),
                            on_stage=on_stage)
    except AquaError as exc:
        print(json.dumps(exc.to_api().model_dump(), ensure_ascii=False), file=sys.stderr)
        return 2
    presenter = ResultPresenter()
    if args.format == "json":
        output = json.dumps(json.loads(presenter.export_json(result)), ensure_ascii=False, indent=1) + "\n"
    elif args.format == "csv":
        output = presenter.export_csv(result)
    else:
        output = text_report(result)
    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
