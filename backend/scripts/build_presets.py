#!/usr/bin/env python
"""Offline / admin batch: build and store the presets of a list of phenomenon texts (spec §8).

For every text the configured selector produces (or reuses) a selection plan, the preset search
runs over the declared candidate list and the presets, the FULL preset-search family and the
search record are stored under ``backend/var`` — exactly what a request with a blank region /
period would compute, so the first such request is served from the stored search.

Examples (from ``backend/``)::

    AQUA_SELECTOR=catalogue_lexical .venv/bin/python scripts/build_presets.py drought "marine heatwave"
    AQUA_SELECTOR=catalogue_lexical .venv/bin/python scripts/build_presets.py --queries-file queries.txt --top 5
    AQUA_SELECTOR=catalogue_lexical .venv/bin/python scripts/build_presets.py drought \
        --region named-taiwan-main-island            # the periods recommended for one user region

The selector is taken from the environment (``AQUA_SELECTOR``, ``ANTHROPIC_API_KEY``); there is
no silent fallback.  ``catalogue_lexical`` is the deterministic catalogue matcher and is
labelled ``is_language_model: false`` in every plan it produces.

The printed ranking is an exploration order (interest score), not evidence: the evidence label
of every row comes from the preset-search family and significance is not a ranking input.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aqua_trend import contracts as C  # noqa: E402
from aqua_trend.engine import ResearchEngine  # noqa: E402
from aqua_trend.errors import AquaError  # noqa: E402
from aqua_trend.presets import PresetEngine, SearchOutcome  # noqa: E402
from aqua_trend.selection import PhenomenonSelector  # noqa: E402
from aqua_trend.storage import ResearchStorage  # noqa: E402
from aqua_trend.store import PreparedDataStore  # noqa: E402


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build and store presets for phenomenon texts.")
    parser.add_argument("queries", nargs="*", help="phenomenon texts (they never set a region or a period)")
    parser.add_argument("--queries-file", help="UTF-8 file with one phenomenon text per line ('#' starts a comment)")
    parser.add_argument("--region", help="search periods for exactly this region id (as if the user selected it)")
    parser.add_argument("--start", help="search regions for exactly this period: start YYYY-MM (needs --end)")
    parser.add_argument("--end", help="period end YYYY-MM (needs --start)")
    parser.add_argument("--top", type=int, help="print only the first N presets of each ranking")
    parser.add_argument("--force", action="store_true", help="search again even when a complete search is stored")
    parser.add_argument("--var-dir", help="runtime directory (default backend/var or AQUA_VAR_DIR)")
    parser.add_argument("--json", action="store_true", help="print one JSON document instead of the text ranking")
    parser.add_argument("--quiet", action="store_true", help="no progress on stderr")
    return parser.parse_args(argv)


def read_queries(args: argparse.Namespace) -> list[str]:
    """Texts from the command line and the optional file, in order, without duplicates."""
    queries = list(args.queries)
    if args.queries_file:
        for line in Path(args.queries_file).read_text(encoding="utf-8").splitlines():
            text = line.split("#", 1)[0].strip()
            if text:
                queries.append(text)
    queries = list(dict.fromkeys(queries))
    if not queries:
        raise AquaError("empty_query", "Give at least one phenomenon text (argument or --queries-file).",
                        fields=["phenomenon_query"])
    return queries


def user_period(args: argparse.Namespace) -> Optional[C.Period]:
    if bool(args.start) != bool(args.end):
        raise AquaError("invalid_period", "--start and --end must be given together.", fields=["period"])
    return C.Period(start=args.start, end=args.end) if args.start else None


def _component(value: Optional[float]) -> str:
    return " n/a" if value is None else f"{value:4.2f}"


def ranking_lines(store: Any, outcome: SearchOutcome, top: Optional[int]) -> list[str]:
    """The stored ranking as text; every number is read from the stored presets."""
    lines = []
    for preset in outcome.presets[:top]:
        score = preset.score
        comp = score.components
        marks = "".join([" [pinned]" if preset.pinned else "", " [manual]" if preset.source == "manual" else ""])
        lines.append(
            f"  {preset.rank:>2}. {preset.region_id}  {preset.period.start}..{preset.period.end}  "
            f"score {score.total:.3f} (relevance {_component(comp.relevance)}, effect {_component(comp.effect)}, "
            f"quality {_component(comp.quality)}, stability {_component(comp.stability)})  "
            f"evidence: {preset.evidence['label']}{marks}")
        lines.append(f"      {store.region(preset.region_id)['name']} — preset {preset.preset_id}@{preset.version}")
        if score.missing_components:
            lines.append(f"      missing component(s) scored 0: {', '.join(score.missing_components)}")
    return lines


def report(store: Any, query: str, plan: C.SelectionPlan, outcome: SearchOutcome, seconds: float,
           top: Optional[int]) -> list[str]:
    record = outcome.record
    counts = record.get("counts") or {}
    family = record.get("family") or {}
    selector = plan.selector
    lines = [
        f"== {query!r}",
        f"  plan {plan.selection_plan_id} ({plan.status}; selector {selector.provider}, "
        f"is_language_model={str(selector.is_language_model).lower()})",
        f"  variables: {', '.join(v.variable_id for v in plan.variable_set) or '-'}"
        f"   indicator recipes: {', '.join(plan.indicator_recipe_ids) or '-'}",
        f"  search {outcome.search_id}: "
        + ("served from the stored complete search" if outcome.from_cache else f"computed in {seconds:.1f} s"),
        f"  candidates: {counts.get('candidates_declared')} declared in {counts.get('regions_considered')} region(s), "
        f"{counts.get('candidates_analysed')} analysed, {counts.get('candidates_excluded')} excluded; "
        f"{counts.get('regions_excluded')} region(s) excluded",
    ]
    if family:
        lines.append(f"  family {family['family_id']}: {family['n_candidates']} hypotheses, {family['n_tested']} tested, "
                     f"{family['n_untested']} without a valid test; {family['method']} at alpha {family['alpha']}")
    if not outcome.presets:
        lines.append(f"  no preset: {outcome.no_match_reason}")
    lines += ranking_lines(store, outcome, top)
    for skipped in (record.get("manual") or {}).get("not_applied") or []:
        lines.append(f"  manual setting {skipped.get('adjustment_id')} not applied: {skipped.get('why')}")
    return lines


def as_json(query: str, plan: C.SelectionPlan, outcome: SearchOutcome, top: Optional[int]) -> dict[str, Any]:
    record = outcome.record
    return {"phenomenon_query": query, "selection_plan_id": plan.selection_plan_id, "plan_status": plan.status,
            "search_id": outcome.search_id, "from_cache": outcome.from_cache, "counts": record.get("counts"),
            "family": record.get("family"), "timing": record.get("timing"),
            "no_match_reason": outcome.no_match_reason,
            "presets": [p.model_dump(mode="json") for p in outcome.presets[:top]]}


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    try:
        queries = read_queries(args)
        period = user_period(args)
        store = PreparedDataStore.open()
        storage = ResearchStorage(args.var_dir)
        selector = PhenomenonSelector(store)
        presets = PresetEngine(store, storage=storage)
        presets.bind(ResearchEngine(store, selector, preset_engine=presets, storage=storage))
    except AquaError as exc:
        print(json.dumps(exc.to_api().model_dump(), ensure_ascii=False), file=sys.stderr)
        return 2

    def progress(stage: str, done: int, total: int) -> None:
        if not args.quiet and total:
            print(f"\r[{stage}] {done}/{total}   ", end="", file=sys.stderr, flush=True)

    documents: list[dict[str, Any]] = []
    failed = 0
    for query in queries:
        try:
            plan = selector.select(query)
            if plan.status == "unsupported_phenomenon" or not (plan.variable_set or plan.indicator_recipe_ids):
                message = "the catalogue has no documented basis for this phenomenon; no preset is built"
                documents.append({"phenomenon_query": query, "plan_status": plan.status, "presets": [],
                                  "no_match_reason": message})
                if not args.json:
                    print(f"== {query!r}\n  {message}")
                continue
            started = time.perf_counter()
            outcome = presets.search(plan, C.UserConstraints(phenomenon_query=query, region_id=args.region,
                                                             period=period),
                                     use_cache=not args.force, on_progress=progress)
            seconds = time.perf_counter() - started
            if not args.quiet:
                print("\r" + " " * 60 + "\r", end="", file=sys.stderr, flush=True)
        except AquaError as exc:
            failed += 1
            print(f"== {query!r}\n  failed: " + json.dumps(exc.to_api().model_dump(), ensure_ascii=False),
                  file=sys.stderr)
            continue
        documents.append(as_json(query, plan, outcome, args.top))
        if not args.json:
            print("\n".join(report(store, query, plan, outcome, seconds, args.top)))
    if args.json:
        print(json.dumps(C.json_safe(documents), ensure_ascii=False, indent=1))
    return 2 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
