"""PresetEngine: fills a blank region / period with a searched, scored and fully recorded preset.

Spec §8 (candidates, interest score, manual adjustments, field sources), §7.3 (preset-search
family, completion, opening a preset), data contracts §8, §9.1, §9.3; acceptance P01–P09,
T09–T11, T16 and section 7.

Flow of one search (``search``)
1. the candidate list is DECLARED from data availability and the versioned policy
   (``candidates.declare_candidates``) — before any trend exists;
2. every analysed candidate is computed with the research engine's numbers
   (``batch.BatchAnalyser``);
3. every hypothesis of the batch forms ONE preset-search family, BY-adjusted together
   (``stats.EvidenceController``); hypotheses without a valid test stay listed with the reason;
4. candidates are scored (``scoring``), ordered by the registered tie-break, adjusted by the
   manual settings (``manual``) and stored as presets together with the full family, the plan
   snapshot and the search record (candidate list, exclusion reasons, policy, versions).

Only a search that completed all four steps is stored as ``complete`` and may fill a request.
A cancelled search stores a record that says so and publishes no preset and no correction.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import Counter, OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from .. import contracts as C
from ..engine import ENGINE_VERSION, ResearchEngine
from ..errors import AquaError
from ..resolve import period_bounds
from ..stats import STATS_POLICY_VERSION, EvidenceController
from ..storage import FAMILY_REF_PREFIX
from ..timeaxis import index_to_ym
from .batch import BatchAnalyser, CandidateResult, MetricFacts
from .candidates import KIND_FULL, KIND_MANUAL, KIND_USER, Candidate, CandidateSet, declare_candidates
from .manual import ManualSettings, load_settings
from .policy import PresetPolicy
from .scoring import ScoredCandidate, build_reasons, cap_list, evidence_summary, rank_key, score_candidate

PRESET_ENGINE_VERSION = "presets-1.0.0"
SEARCH_KIND = "preset_searches"
PLAN_KIND = "preset_plans"
FAMILY_POLICY_ID = "preset_search"
_MEMORY_SEARCHES = 8
_MEMORY_FAMILIES = 4

ProgressCallback = Callable[[str, int, int], None]


def _digest(payload: Any) -> str:
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _period_dict(period: Optional[C.Period]) -> Optional[dict[str, str]]:
    return {"start": period.start, "end": period.end} if period is not None else None


def preset_id_for(plan: C.SelectionPlan, region_id: str, period: C.Period) -> str:
    """Stable id of 'this plan in this region over this period' — the same across data versions."""
    return "ps-" + _digest([plan.content_hash, region_id, period.start, period.end])[:20]


class PresetFillResult:
    """What ``fill`` / ``open`` return; attribute-compatible with ``aqua_trend.engine.PresetFill``.

    ``family`` is the FULL preset-search family.  It is loaded on first access, so a caller
    that only needs the preset (request validation) does not read a large record.
    """

    def __init__(self, *, region_id: Optional[str], period: Optional[C.Period], preset: Optional[C.Preset],
                 status: str, missing: Optional[list[str]] = None, reason: str = "",
                 family: Optional[C.EvidenceFamily] = None,
                 family_loader: Optional[Callable[[], Optional[C.EvidenceFamily]]] = None,
                 plan: Optional[C.SelectionPlan] = None, stale: bool = False,
                 search_id: Optional[str] = None):
        self.region_id, self.period, self.preset = region_id, period, preset
        self.status, self.missing, self.reason = status, list(missing or []), reason
        self.plan, self.stale, self.search_id = plan, stale, search_id
        self._family, self._loader = family, family_loader

    @property
    def family(self) -> Optional[C.EvidenceFamily]:
        if self._family is None and self._loader is not None:
            self._family, self._loader = self._loader(), None
        return self._family


@dataclass
class SearchOutcome:
    """Result of one preset search (computed now, or served from the stored complete record)."""

    search_id: str
    record: dict[str, Any]
    presets: list[C.Preset]
    family_id: Optional[str]
    complete: bool
    from_cache: bool = False
    family: Optional[C.EvidenceFamily] = None
    #: in-memory only (not stored): the candidates and their scores of a search computed now
    candidates: Optional[CandidateSet] = None
    scored: list[ScoredCandidate] = field(default_factory=list)

    @property
    def no_match_reason(self) -> Optional[str]:
        return self.record.get("no_match_reason")


class PresetEngine:
    """Automatic presets with manual adjustments (spec §8). ``bind`` it to the research engine."""

    def __init__(self, store: Any, storage: Any = None, engine: Optional[ResearchEngine] = None):
        self.store = store
        self.storage = storage
        self._engine = engine
        self._lock = threading.RLock()
        self._searches: OrderedDict[str, SearchOutcome] = OrderedDict()
        self._families: OrderedDict[str, C.EvidenceFamily] = OrderedDict()

    # ------------------------------------------------------------------ wiring / versions

    def bind(self, engine: ResearchEngine) -> None:
        """Use the research engine's caches and selector (the same analysis code path)."""
        self._engine = engine

    @property
    def engine(self) -> ResearchEngine:
        if self._engine is None:
            self._engine = ResearchEngine(self.store, None, storage=self.storage)   # analysis only
        return self._engine

    def policy(self) -> PresetPolicy:
        return PresetPolicy.from_store(self.store)

    def search_key(self, plan: C.SelectionPlan, user_region_id: Optional[str],
                   user_period: Optional[C.Period]) -> str:
        """Key of everything that can change a search: plan, user constraints, data, policy, code."""
        v = self.store.versions
        return "pss-" + _digest({
            "selection_plan_content_hash": plan.content_hash,
            "variables": [[x.variable_id, x.role] for x in plan.variable_set],
            "indicator_recipe_ids": list(plan.indicator_recipe_ids),
            "user_region_id": user_region_id, "user_period": _period_dict(user_period),
            "snapshot_id": self.store.snapshot_id(),
            "policy_versions": [v["method_policy_version"], v["preset_policy_version"], v["quality_policy_version"]],
            "stats_policy_version": STATS_POLICY_VERSION, "engine_version": ENGINE_VERSION,
            "preset_engine_version": PRESET_ENGINE_VERSION,
        })[:32]

    def _versions(self) -> dict[str, Any]:
        return {"snapshot_id": self.store.snapshot_id(), "policy_snapshot_id": self.engine.policy_snapshot(),
                "engine_version": ENGINE_VERSION, "stats_policy_version": STATS_POLICY_VERSION,
                "preset_engine_version": PRESET_ENGINE_VERSION}

    # ------------------------------------------------------------------ search

    def search(self, plan: C.SelectionPlan, user_constraints: Any = None, *, cancel: Any = None,
               on_progress: Optional[ProgressCallback] = None, use_cache: bool = True) -> SearchOutcome:
        """Run (or reuse) the preset search for a plan and the user's structured constraints.

        ``user_constraints`` carries ``region_id`` / ``period`` the USER selected; they are never
        changed: a user region is the only candidate region, a user period the only candidate
        period.  ``cancel`` (callable or Event) stops the search with ``AquaError("cancelled")``;
        a search that did not finish is never stored or reported as complete (T10).
        """
        region_id = getattr(user_constraints, "region_id", None)
        period = getattr(user_constraints, "period", None)
        if region_id is not None:
            self.store.region(region_id)
        period_bounds(period)
        key = self.search_key(plan, region_id, period)
        with self._lock:
            if use_cache:
                cached = self._cached(key)
                if cached is not None:
                    return cached
            outcome = self._compute(key, plan, region_id, period, cancel, on_progress)
            self._remember(key, outcome)
            return outcome

    def _cached(self, key: str) -> Optional[SearchOutcome]:
        hit = self._searches.get(key)
        if hit is not None:
            self._searches.move_to_end(key)
            return hit
        if self.storage is None:
            return None
        try:
            record = self.storage.load_document(SEARCH_KIND, key)
            if not (isinstance(record, dict) and record.get("complete") is True
                    and record.get("search_id") == key and record.get("versions") == self._versions()):
                return None
            family_id = (record.get("family") or {}).get("family_id")
            if family_id and not self.storage.has_family(family_id):
                return None
            presets = [self.storage.load_preset(p["preset_id"], p["version"]) for p in record.get("presets") or []]
        except AquaError:
            return None                                       # an unreadable record is recomputed, never served
        outcome = SearchOutcome(search_id=key, record=record, presets=presets, family_id=family_id,
                                complete=True, from_cache=True)
        self._remember(key, outcome)
        return outcome

    def _remember(self, key: str, outcome: SearchOutcome) -> None:
        if not outcome.complete:
            return
        self._searches[key] = outcome
        while len(self._searches) > _MEMORY_SEARCHES:
            self._searches.popitem(last=False)
        if outcome.family is not None:
            self._keep_family(outcome.family)
            outcome.family = None                             # one shared copy, held by the family cache

    def _keep_family(self, family: C.EvidenceFamily) -> None:
        self._families[family.family_id] = family
        self._families.move_to_end(family.family_id)
        while len(self._families) > _MEMORY_FAMILIES:
            self._families.popitem(last=False)

    def family(self, family_id: Optional[str]) -> Optional[C.EvidenceFamily]:
        """The FULL stored family (memory cache, then storage); ``None`` when there is none."""
        if not family_id:
            return None
        family_id = family_id[len(FAMILY_REF_PREFIX):] if family_id.startswith(FAMILY_REF_PREFIX) else family_id
        with self._lock:
            hit = self._families.get(family_id)
            if hit is not None:
                self._families.move_to_end(family_id)
                return hit
        if self.storage is None:
            return None
        family = self.storage.load_family(family_id)
        with self._lock:
            self._keep_family(family)
        return family

    # ------------------------------------------------------------------ search: computation

    def _compute(self, key: str, plan: C.SelectionPlan, region_id: Optional[str], period: Optional[C.Period],
                 cancel: Any, on_progress: Optional[ProgressCallback]) -> SearchOutcome:
        engine, policy = self.engine, self.policy()
        started = time.perf_counter()
        timing: dict[str, float] = {}

        def check() -> None:
            hit = cancel.is_set() if hasattr(cancel, "is_set") else (bool(cancel()) if cancel is not None else False)
            if hit:
                raise AquaError("cancelled", "The preset search was cancelled before every declared candidate was "
                                             "analysed; no preset and no corrected label is published.")

        def report(stage: str, done: int, total: int) -> None:
            if on_progress is not None:
                on_progress(stage, done, total)

        manual = load_settings(self.store, engine.plan_phenomena(plan), region_id, period)
        base = self._record_base(key, plan, region_id, period, policy, manual)
        candset: Optional[CandidateSet] = None
        try:
            check()
            report("declaring_candidates", 0, 0)
            candset = declare_candidates(self.store, engine.resolver, plan, policy, region_id, period, manual.adds())
            timing["declare_candidates_s"] = time.perf_counter() - started
            mark = time.perf_counter()
            analyser = BatchAnalyser(engine, plan)
            results = analyser.analyse(candset.analysed, check=check,
                                       progress=lambda done, total: report("analysing_candidates", done, total))
            timing["analyse_s"] = time.perf_counter() - mark
            check()
        except AquaError as exc:
            if exc.code == "cancelled":
                self._store_record({**base, "complete": False, "status": "cancelled",
                                    "candidates": self._candidate_rows(candset, {}, {}) if candset else [],
                                    "family": None, "presets": [],
                                    "note": "cancelled before the declared candidate list was fully analysed: "
                                            "nothing in this record is a final result"})
            raise

        mark = time.perf_counter()
        report("correcting", 0, 0)
        records = [r for res in results for r in res.records()]
        family_policy = self._family_policy(key, plan, region_id, period, policy, manual, candset)
        family = EvidenceController(engine.method_policy).build_family(
            FAMILY_POLICY_ID, family_policy, records, complete=True) if records else None
        timing["family_s"] = time.perf_counter() - mark
        mark = time.perf_counter()

        scored = [score_candidate(plan, res, policy) for res in results]
        by_id = {h.hypothesis_id: h for h in family.hypotheses} if family is not None else {}
        presets, manual_log, disabled = self._rank(plan, scored, policy, manual, family, by_id, key,
                                                   region_id, period)
        summaries = {s.result.candidate.key: evidence_summary(s.result, by_id, True) for s in scored}
        record = {
            **base, "complete": True, "status": "complete",
            "regions": {"considered": candset.regions_considered, "excluded": candset.excluded_regions},
            "candidates": self._candidate_rows(candset, {s.result.candidate.key: s for s in scored}, summaries,
                                               disabled),
            "counts": {
                "regions_considered": len(candset.regions_considered),
                "regions_excluded": len(candset.excluded_regions),
                "candidates_declared": len(candset.candidates), "candidates_analysed": len(candset.analysed),
                "candidates_excluded": len(candset.excluded),
                "hypotheses": family.n_candidates if family else 0,
                "hypotheses_tested": family.n_tested if family else 0,
                "hypotheses_untested": family.n_untested if family else 0,
                "batch_groups": analyser.groups_fitted, "batch_rows": analyser.rows_fitted,
                "engine_rows": analyser.rows_delegated,
            },
            "manual": {"version": manual.version, "applied": manual_log, "not_applied": manual.not_applied},
            "family": None if family is None else {
                "family_id": family.family_id, "external_ref": FAMILY_REF_PREFIX + family.family_id,
                "scope": family.scope, "method": family.method, "alpha": family.alpha,
                "n_candidates": family.n_candidates, "n_tested": family.n_tested, "n_untested": family.n_untested,
                "complete": family.complete, "content_hash": family.content_hash},
            "presets": [{"preset_id": p.preset_id, "version": p.version, "rank": p.rank, "region_id": p.region_id,
                         "period": _period_dict(p.period), "score": p.score.total if p.score else None,
                         "pinned": p.pinned, "source": p.source} for p in presets],
            "no_match_reason": None if presets else self._no_match_reason(candset, region_id, period, disabled),
        }
        timing["score_and_rank_s"] = time.perf_counter() - mark
        mark = time.perf_counter()
        if self.storage is not None:
            if family is not None:
                self.storage.save_family(family)
            self.storage.save_document(PLAN_KIND, plan.selection_plan_id, plan.model_dump(mode="json"))
            for preset in presets:
                self.storage.save_preset(preset)
        timing["store_s"] = time.perf_counter() - mark
        timing["total_s"] = time.perf_counter() - started
        record["timing"] = {k: round(v, 3) for k, v in timing.items()}
        self._store_record(record)                            # written last: only a finished search is complete
        report("complete", len(candset.analysed), len(candset.analysed))
        return SearchOutcome(search_id=key, record=record, presets=presets,
                             family_id=family.family_id if family else None, complete=True, family=family,
                             candidates=candset, scored=scored)

    def _store_record(self, record: dict[str, Any]) -> None:
        if self.storage is not None:
            self.storage.save_document(SEARCH_KIND, record["search_id"], record)

    def _record_base(self, key: str, plan: C.SelectionPlan, region_id: Optional[str], period: Optional[C.Period],
                     policy: PresetPolicy, manual: ManualSettings) -> dict[str, Any]:
        return {
            "search_id": key, "created_at": _now(),
            "selection_plan": {"selection_plan_id": plan.selection_plan_id, "content_hash": plan.content_hash,
                               "phenomenon_query": plan.phenomenon_query,
                               "variable_ids": [v.variable_id for v in plan.variable_set],
                               "indicator_recipe_ids": list(plan.indicator_recipe_ids),
                               "selector": plan.selector.model_dump()},
            "user_constraints": {"region_id": region_id, "period": _period_dict(period)},
            "filled_fields": [name for name, value in (("region_id", region_id), ("period", period))
                              if value is None],
            "versions": self._versions(), "store_versions": dict(self.store.versions),
            "policy": policy.raw,
            "window_rule": {"lengths_years": list(policy.window_lengths_years), "step_years": policy.window_step_years,
                            "alignment": policy.raw.get("window_alignment"),
                            "full_common_period": policy.full_common_period,
                            "user_period_only": period is not None, "user_region_only": region_id is not None},
            "manual_presets_version": manual.version,
        }

    def _family_policy(self, key: str, plan: C.SelectionPlan, region_id: Optional[str], period: Optional[C.Period],
                       policy: PresetPolicy, manual: ManualSettings, candset: CandidateSet) -> dict[str, Any]:
        """The pre-declared candidate policy stored inside the family (data contract §9.3)."""
        listing = sorted([c.region_id, c.start, c.end, c.status] for c in candset.candidates)
        raw = policy.raw
        return {
            "id": FAMILY_POLICY_ID, "version": policy.version, "preset_engine_version": PRESET_ENGINE_VERSION,
            "description": (raw.get("search_family") or {}).get("definition"),
            "search_id": key, "candidates_ref": f"{SEARCH_KIND}/{key}",
            "selection_plan_content_hash": plan.content_hash,
            "user_constraints": {"region_id": region_id, "period": _period_dict(period)},
            "candidate_region_layers": list(policy.region_layers),
            "candidate_region_rule": raw.get("candidate_region_rule"),
            "candidate_period_rule": raw.get("candidate_period_rule"),
            "window_lengths_years": list(policy.window_lengths_years), "window_step_years": policy.window_step_years,
            "window_alignment": raw.get("window_alignment"), "also_test_full_common_period": policy.full_common_period,
            "min_variables_fraction": policy.min_variables_fraction,
            "manual_presets_version": manual.version,
            "manual_added_candidates": sorted(a.adjustment_id for a in manual.of("add")),
            "snapshot_id": self.store.snapshot_id(), "policy_snapshot_id": self.engine.policy_snapshot(),
            "n_regions_considered": len(candset.regions_considered),
            "n_regions_excluded": len(candset.excluded_regions),
            "n_candidates_declared": len(candset.candidates), "n_candidates_analysed": len(candset.analysed),
            "n_candidates_excluded": len(candset.excluded),
            "candidates_digest": _digest(listing),
        }

    @staticmethod
    def _candidate_rows(candset: Optional[CandidateSet], scored: dict[tuple, ScoredCandidate],
                        summaries: dict[tuple, dict[str, Any]], disabled: Optional[dict[tuple, list[str]]] = None,
                        ) -> list[dict[str, Any]]:
        """Complete candidate list of the search record: analysed, excluded and their reasons."""
        rows = []
        for cand in (candset.candidates if candset else []):
            row: dict[str, Any] = {"region_id": cand.region_id, "period": _period_dict(cand.period),
                                   "kind": cand.kind, "status": cand.status, "reason": cand.reason,
                                   "manual_adjustment_ids": list(cand.manual_adjustment_ids)}
            hit = scored.get(cand.key)
            if hit is not None:
                row["score"] = hit.score.total
                row["components"] = hit.score.components.model_dump()
                row["missing_components"] = list(hit.score.missing_components)
                row["evidence"] = summaries.get(cand.key)
            if disabled and cand.key in disabled:
                row["disabled_by"] = disabled[cand.key]
            rows.append(row)
        return rows

    # ------------------------------------------------------------------ ranking and manual adjustments

    def _rank(self, plan: C.SelectionPlan, scored: list[ScoredCandidate], policy: PresetPolicy,
              manual: ManualSettings, family: Optional[C.EvidenceFamily], by_id: dict[str, C.HypothesisRecord],
              key: str, region_id: Optional[str], period: Optional[C.Period],
              ) -> tuple[list[C.Preset], list[dict[str, Any]], dict[tuple, list[str]]]:
        """Order, apply manual settings, cap the list and build the presets (spec §8.2–§8.3)."""
        if family is None:
            return [], [], {}
        used: Counter[str] = Counter()
        disabled: dict[tuple, list[str]] = {}
        entries: list[tuple[tuple, ScoredCandidate, bool, list[Any]]] = []
        for s in scored:
            cand = s.result.candidate
            ident = preset_id_for(plan, cand.region_id, cand.period)
            hits = [a for a in manual.applicable if a.matches(cand.region_id, cand.start, cand.end, ident)]
            for a in hits:
                used[a.adjustment_id] += 1
            off = [a.adjustment_id for a in hits if a.action == "disable"]
            if off:
                disabled[cand.key] = off
                continue
            pinned = any(a.action == "pin" for a in hits)
            priorities = [a.priority for a in hits if a.action == "priority" and a.priority is not None]
            is_manual = pinned or bool(priorities) or any(a.action == "add" for a in hits)
            entries.append((rank_key(s, pinned, min(priorities) if priorities else None), s, is_manual, hits))
        entries.sort(key=lambda e: e[0])
        notes = {id(e[1]): e[3] for e in entries}
        pins = {id(e[1]): e[0][0] == 0 for e in entries}
        kept = cap_list([(e[1], e[2]) for e in entries], policy, region_is_recommended=region_id is None)
        labels = {v.variable_id: (self.store.concept(v.variable_id).get("label") or v.variable_id)
                  for v in plan.variable_set}
        presets = [self._preset(plan, s, family, by_id, labels, key, region_id, period, rank=i,
                                pinned=pins[id(s)], adjustments=notes[id(s)]) for i, s in enumerate(kept, start=1)]
        log = [{**a.describe(), "candidates_matched": used[a.adjustment_id]} for a in manual.applicable
               if used[a.adjustment_id]]
        manual.not_applied.extend(
            {**a.describe(), "why": "no analysed candidate matches it; a manual setting cannot make an invalid or "
                                    "undeclared candidate valid"}
            for a in manual.applicable if not used[a.adjustment_id])
        return presets, log, disabled

    def _preset(self, plan: C.SelectionPlan, scored: ScoredCandidate, family: C.EvidenceFamily,
                by_id: dict[str, C.HypothesisRecord], labels: dict[str, str], key: str,
                user_region_id: Optional[str], user_period: Optional[C.Period], *, rank: Optional[int],
                pinned: bool, adjustments: list[Any], supersedes: Optional[dict[str, Any]] = None) -> C.Preset:
        cand = scored.result.candidate
        v = self.store.versions
        added = any(a.action == "add" for a in adjustments) and cand.kind == KIND_MANUAL
        reasons = build_reasons(scored, family, by_id, labels, self._kind_text(cand))
        for a in adjustments:
            reasons.append(C.PresetReason(text=f"Manual setting '{a.action}' ({a.adjustment_id}): {a.reason}. It "
                                               "changes the list position only, never a number or a label.",
                                          evidence_ids=[f"manual:{a.adjustment_id}"]))
        version = "v-" + _digest([key, family.family_id, supersedes["version"] if supersedes else None])[:16]
        facts = [{**fact, "significance_label": self._label(by_id.get(fact["hypothesis_id"]), family.complete),
                  "p_adjusted": getattr(by_id.get(fact["hypothesis_id"]), "p_adjusted", None)}
                 for fact in scored.variable_facts]
        return C.Preset(
            preset_id=preset_id_for(plan, cand.region_id, cand.period), version=version,
            source="manual" if added else "automatic", selection_plan_id=plan.selection_plan_id,
            variable_ids=[x.variable_id for x in plan.variable_set],
            indicator_ids=list(plan.indicator_recipe_ids), region_id=cand.region_id, period=cand.period,
            score=scored.score, reasons=reasons, rank=rank, pinned=pinned,
            manual_note="; ".join(f"{a.action}: {a.reason}" for a in adjustments) or None,
            family_id=family.family_id, search_complete=bool(family.complete),
            dataset_version=v["dataset_version"], method_policy_version=v["method_policy_version"],
            preset_policy_version=v["preset_policy_version"],
            # ---- optional extras (the contract allows added fields)
            search_id=key, family_ref=FAMILY_REF_PREFIX + family.family_id,
            family_counts={"n_candidates": family.n_candidates, "n_tested": family.n_tested,
                           "n_untested": family.n_untested, "method": family.method, "alpha": family.alpha},
            selection_plan_content_hash=plan.content_hash, period_kind=cand.kind,
            search_constraints={"region_id": user_region_id, "period": _period_dict(user_period)},
            filled_fields=[name for name, value in (("region_id", user_region_id), ("period", user_period))
                           if value is None],
            evidence=evidence_summary(scored.result, by_id, family.complete),
            variable_facts=facts, manual_adjustment_ids=[a.adjustment_id for a in adjustments],
            supersedes=supersedes, **self._versions(),
        )

    @staticmethod
    def _label(record: Optional[C.HypothesisRecord], complete: bool) -> str:
        from .scoring import hypothesis_label
        return hypothesis_label(record, complete)

    @staticmethod
    def _kind_text(cand: Candidate) -> str:
        span = f"{index_to_ym(cand.start)}..{index_to_ym(cand.end)}"
        if cand.kind == KIND_FULL:
            return f"{span}, the full common data period of the selected variables in this region"
        if cand.kind == KIND_USER:
            return f"{span}, the period the user selected"
        if cand.kind == KIND_MANUAL:
            return f"{span}, a manually added candidate period"
        return f"{span}, a fixed {cand.kind.removeprefix('window_').removesuffix('y')}-year calendar window"

    @staticmethod
    def _no_match_reason(candset: CandidateSet, region_id: Optional[str], period: Optional[C.Period],
                         disabled: dict[tuple, list[str]]) -> str:
        """Why no preset exists, from the candidate record (P05)."""
        if disabled and len(disabled) == len(candset.analysed):
            ids = sorted({i for ids in disabled.values() for i in ids})
            return f"every qualifying candidate is disabled by manual setting(s) {', '.join(ids)}"
        if region_id is not None and not candset.regions_considered:
            why = candset.excluded_regions[0]["reason"] if candset.excluded_regions else "no prepared series"
            return f"region {region_id}: {why}"
        if not candset.candidates:
            if candset.excluded_regions:
                example = candset.excluded_regions[0]
                where = f"region {region_id}" if region_id else f"{len(candset.excluded_regions)} candidate region(s)"
                return f"no candidate period can be declared for {where}: {example['reason']}"
            return "no candidate region has a prepared series for a selected variable"
        example = candset.excluded[0].reason if candset.excluded else "no candidate qualified"
        target = f"the selected period {period.start}..{period.end}" if period is not None else "any candidate period"
        return (f"none of the {len(candset.candidates)} declared candidate(s) supports enough selected variables for "
                f"{target} (for example: {example})")

    # ------------------------------------------------------------------ fill (engine protocol)

    def fill(self, plan: C.SelectionPlan, user_constraints: Any, context: Any = None, *,
             cancel: Any = None) -> PresetFillResult:
        """Fill ONLY the blank fields of a request (spec §8.1; acceptance P01–P06).

        both blank -> one region + one period; region only -> a period for exactly that region;
        period only -> a region for exactly that period.  A user value is returned unchanged.
        No qualifying candidate -> ``no_matching_preset`` with the blank field(s) and the reason.
        """
        region_id = getattr(user_constraints, "region_id", None)
        period = getattr(user_constraints, "period", None)
        missing = [name for name, value in (("region_id", region_id), ("period", period)) if value is None]
        if not missing:
            return PresetFillResult(region_id=region_id, period=period, preset=None, status="not_needed",
                                    reason="both fields were selected by the user; no preset is applied")
        outcome = self.search(plan, user_constraints, cancel=cancel)
        if not outcome.presets:
            return PresetFillResult(region_id=region_id, period=period, preset=None, status="no_matching_preset",
                                    missing=missing, reason=outcome.no_match_reason or "no candidate qualified",
                                    search_id=outcome.search_id)
        top = outcome.presets[0]
        if (region_id is not None and top.region_id != region_id) or \
                (period is not None and (top.period.start, top.period.end) != (period.start, period.end)):
            raise AquaError("internal_error", "a preset candidate differs from a field the user selected")
        counts = outcome.record.get("counts") or {}
        reason = (f"{' and '.join(n.replace('region_id', 'region') for n in missing)} filled by preset "
                  f"{top.preset_id} (rank 1 of {len(outcome.presets)}; complete search of "
                  f"{counts.get('candidates_analysed')} candidate(s) in {counts.get('regions_considered')} "
                  f"region(s), {counts.get('hypotheses')} hypotheses in family {outcome.family_id}). "
                  + (top.reasons[0].text if top.reasons else ""))
        return PresetFillResult(region_id=top.region_id, period=top.period, preset=top, status="applied",
                                reason=reason, family=outcome.family, plan=plan, search_id=outcome.search_id,
                                family_loader=lambda: self.family(outcome.family_id))

    # ------------------------------------------------------------------ open

    def open(self, preset_ref: Any, user_constraints: Any = None) -> PresetFillResult:
        """The stored preset with its plan snapshot and its ORIGINAL search family (P09, T11).

        Cheap: nothing is recomputed and the family is loaded only when it is read.  A reference
        that conflicts with a field the user selected raises ``invalid_context`` — it never
        overrides the user's value.  When the data / catalogue / policy snapshot changed since
        the search, the stored family is NOT offered (``stale``): its correction belongs to
        other numbers (T16); ``open_for_run`` builds the new evidence.
        """
        preset = self._load_preset(preset_ref)
        self._check_conflict(preset, user_constraints)
        stale = self._stale(preset)
        reason = (preset.reasons[0].text if preset.reasons else "")
        if stale:
            reason = self._stale_text(preset) + " " + reason
        return PresetFillResult(
            region_id=preset.region_id, period=preset.period, preset=preset, status="opened", reason=reason,
            plan=self._plan_snapshot(preset.selection_plan_id), stale=stale,
            search_id=getattr(preset, "search_id", None),
            family_loader=None if stale else (lambda: self.family(preset.family_id)))

    def open_for_run(self, preset_ref: Any, user_constraints: Any = None, *, cancel: Any = None) -> PresetFillResult:
        """``open`` for an analysis run: a stale preset gets NEW evidence, the old stays as history (T16).

        The search is repeated for the same plan and the same original user constraints under the
        current versions.  When the candidate still qualifies, a new version of the preset is
        stored that names the version it supersedes; the old version and its family are kept
        untouched.  When it does not qualify any more, the stored preset is returned without a
        search family, with the reason.
        """
        opened = self.open(preset_ref, user_constraints)
        if not opened.stale:
            return opened
        old = opened.preset
        plan = self._plan_for(old.selection_plan_id, opened.plan)
        if plan is None:
            return opened                                      # the engine reports the missing plan
        constraints = getattr(old, "search_constraints", None) or {}
        user = C.UserConstraints(
            phenomenon_query=plan.phenomenon_query, region_id=constraints.get("region_id"),
            period=C.Period(**constraints["period"]) if constraints.get("period") else None)
        outcome = self.search(plan, user, cancel=cancel)
        family = self.family(outcome.family_id)
        supersedes = {"version": old.version, "family_id": old.family_id,
                      "snapshot_id": getattr(old, "snapshot_id", None),
                      "policy_snapshot_id": getattr(old, "policy_snapshot_id", None),
                      "dataset_version": old.dataset_version,
                      "reason": "the data / catalogue / policy snapshot changed after the original search; its "
                                "correction is kept as history and is not attached to numbers computed now"}
        rebuilt = self._rebuild(plan, old, outcome, family, supersedes) if family is not None else None
        if rebuilt is None:
            why = outcome.no_match_reason or "the candidate is not among the analysed candidates of the new search"
            opened.reason = (self._stale_text(old) + f" Under the current versions this region and period no longer "
                             f"qualify as a preset candidate ({why}); no preset-search correction is attached.")
            return opened
        return PresetFillResult(
            region_id=rebuilt.region_id, period=rebuilt.period, preset=rebuilt, status="opened", plan=plan,
            reason=self._stale_text(old) + f" New evidence was built: preset version {rebuilt.version}, family "
                                           f"{rebuilt.family_id}.",
            family=family, search_id=outcome.search_id)

    def _rebuild(self, plan: C.SelectionPlan, old: C.Preset, outcome: SearchOutcome, family: C.EvidenceFamily,
                 supersedes: dict[str, Any]) -> Optional[C.Preset]:
        """New version of ``old`` from the new search, when its candidate was analysed there."""
        row = next((c for c in outcome.record.get("candidates") or []
                    if c["region_id"] == old.region_id and c["period"] == _period_dict(old.period)
                    and c["status"] == "analysed" and not c.get("disabled_by")), None)
        if row is None:
            return None
        engine, policy = self.engine, self.policy()
        a, b = period_bounds(old.period)
        cand = Candidate(old.region_id, a, b, row["kind"],
                         decisions=engine.resolver.resolve_products(plan, old.region_id, old.period))
        analysis = engine.analyse_candidate(plan, old.region_id, old.period, cand.decisions)
        result = CandidateResult(candidate=cand, facts=[MetricFacts.from_outcome(m) for m in analysis.metrics()])
        by_id = {h.hypothesis_id: h for h in family.hypotheses}
        if any(f.hypothesis_id not in by_id for f in result.facts):
            return None                                        # not the hypotheses the new family compared
        scored = score_candidate(plan, result, policy)
        listed = next((p for p in outcome.presets if p.preset_id == old.preset_id), None)
        labels = {v.variable_id: (self.store.concept(v.variable_id).get("label") or v.variable_id)
                  for v in plan.variable_set}
        constraints = getattr(old, "search_constraints", None) or {}
        preset = self._preset(
            plan, scored, family, by_id, labels, outcome.search_id, constraints.get("region_id"),
            C.Period(**constraints["period"]) if constraints.get("period") else None,
            rank=listed.rank if listed else None, pinned=listed.pinned if listed else False, adjustments=[],
            supersedes=supersedes)
        if self.storage is not None:
            self.storage.save_preset(preset)
        return preset

    # ------------------------------------------------------------------ open: helpers

    def _load_preset(self, preset_ref: Any) -> C.Preset:
        ident = getattr(preset_ref, "id", None) or (preset_ref.get("id") if isinstance(preset_ref, dict) else None)
        version = getattr(preset_ref, "version", None) or \
            (preset_ref.get("version") if isinstance(preset_ref, dict) else None)
        if self.storage is None:
            raise AquaError("invalid_context", "Presets cannot be opened: no storage is configured.",
                            fields=["context.preset_ref"])
        try:
            return self.storage.load_preset(ident, version)
        except AquaError as exc:
            raise AquaError("invalid_context", f"The referenced preset {ident} (version {version}) cannot be "
                                               f"loaded: {exc.message}", fields=["context.preset_ref"]) from exc

    @staticmethod
    def _check_conflict(preset: C.Preset, user_constraints: Any) -> None:
        region_id = getattr(user_constraints, "region_id", None)
        period = getattr(user_constraints, "period", None)
        if region_id is not None and region_id != preset.region_id:
            raise AquaError("invalid_context",
                            f"The opened preset is for region {preset.region_id}, but the selected region is "
                            f"{region_id}. The selection is kept; clear the preset reference to analyse it.",
                            fields=["context.preset_ref", "region_id"])
        if period is not None and (period.start, period.end) != (preset.period.start, preset.period.end):
            raise AquaError("invalid_context",
                            f"The opened preset is for {preset.period.start}..{preset.period.end}, but the selected "
                            f"period is {period.start}..{period.end}. The selection is kept; clear the preset "
                            "reference to analyse it.", fields=["context.preset_ref", "period"])

    def _stale(self, preset: C.Preset) -> bool:
        """True when any version that can change a number differs from the preset's search."""
        now = self._versions()
        return any(getattr(preset, name, None) != value for name, value in now.items())

    @staticmethod
    def _stale_text(preset: C.Preset) -> str:
        return (f"Preset {preset.preset_id} version {preset.version} was searched under another data / catalogue / "
                f"policy snapshot; its search family {preset.family_id} is kept as history and is not attached to "
                "numbers computed now.")

    def _plan_snapshot(self, selection_plan_id: str) -> Optional[C.SelectionPlan]:
        """The plan stored with the search (the backend's own record, never a client claim)."""
        if self.storage is None:
            return None
        try:
            return C.SelectionPlan.model_validate(self.storage.load_document(PLAN_KIND, selection_plan_id))
        except (AquaError, ValueError):
            return None

    def _plan_for(self, selection_plan_id: str, snapshot: Optional[C.SelectionPlan]) -> Optional[C.SelectionPlan]:
        selector = getattr(self.engine, "selector", None)
        if selector is not None:
            try:
                return selector.load(selection_plan_id)
            except AquaError:
                pass
        return snapshot

    # ------------------------------------------------------------------ field sources (P07)

    @staticmethod
    def user_fields(result: C.ResearchResult) -> dict[str, Any]:
        """The fields of a finished research that the USER selected (spec §8.3 field-source rule).

        When the phenomenon changes, a new request keeps exactly these values; a field whose
        source was ``preset`` is left blank and recommended again for the new phenomenon.
        """
        region, period = result.resolved.region, result.resolved.period
        return {
            "region_id": region.id if region is not None and region.source == "user" else None,
            "period": {"start": period.start, "end": period.end}
            if period is not None and period.source == "user" else None,
        }
