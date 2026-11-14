"""PhenomenonSelector (spec §3.1, §10; architecture note §4).

select(query) -> SelectionPlan:
1. empty text -> ``empty_query``;
2. the same normalised query with the same catalogue / registry / provider / model / prompt
   versions reuses the saved plan (``reused=True``) unless ``reselect`` (P08);
3. otherwise the provider is asked once, its answer is validated against the current
   catalogue snapshot and only a valid answer is persisted (S01, S06);
4. when no provider is configured or it fails, a saved plan of the same catalogue and
   prompt versions made by the same kind of selector may be served, marked as reused;
   otherwise ``selector_unavailable`` (retryable). There is no keyword stand-in (S07).

The plan never contains a region or a period: place and date words in the text are only
listed in ``ignored_text_constraints`` (S05).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from ..contracts import SelectionPlan, SelectorInfo
from ..errors import AquaError
from .plans import PlanStore, content_hash, new_plan_id, normalize_query, plan_key, versions_key
from .prompt import PROMPT_VERSION, build_output_schema, build_system_prompt, build_user_prompt
from .providers import ModelProvider, ProviderOutputError, ProviderUnavailable, provider_from_env
from .snapshot import CatalogueSnapshot
from .validate import ValidatedSelection, validate_selection

REUSE_SAME_KEY = "same_query_and_versions"
REUSE_PROVIDER_DOWN = "selector_unavailable_saved_plan"


class PhenomenonSelector:
    """Maps a free-text phenomenon onto catalogue variables and approved indicator recipes."""

    def __init__(self, store: Any, provider: ModelProvider | None = None,
                 plan_dir: str | os.PathLike[str] | None = None) -> None:
        """``provider=None`` resolves the provider from the environment on every call."""
        self._store = store
        self._provider = provider
        self.plans = PlanStore(plan_dir)

    # ---- public API ----------------------------------------------------------
    def select(self, query: str, *, reselect: bool = False) -> SelectionPlan:
        """Return the selection plan for ``query`` (see module docstring)."""
        if not isinstance(query, str) or not query.strip():
            raise AquaError("empty_query", "Describe a phenomenon to analyse.", fields=["phenomenon_query"])
        snapshot = CatalogueSnapshot.from_store(self._store)
        normalized = normalize_query(query)
        shared_key = versions_key(normalized, snapshot.catalogue_version,
                                  snapshot.indicator_registry_version, PROMPT_VERSION)
        provider, unavailable = self._resolve_provider()
        if provider is None:
            return self._saved_or_unavailable(shared_key, True, reselect, unavailable)

        key = plan_key(normalized, snapshot.catalogue_version, snapshot.indicator_registry_version,
                       provider.name, provider.model, PROMPT_VERSION)
        if not reselect:
            saved = self.plans.latest_for_key(key)
            if saved is not None:
                return _as_reused(saved, REUSE_SAME_KEY)
        try:
            raw = provider.complete(build_system_prompt(snapshot), build_user_prompt(query),
                                    build_output_schema(snapshot))
        except ProviderUnavailable as exc:
            return self._saved_or_unavailable(shared_key, provider.is_language_model, reselect, str(exc))
        except ProviderOutputError as exc:
            raise AquaError("selector_invalid_output", str(exc)) from exc
        validated = validate_selection(raw, snapshot, query)   # raises; nothing is saved on failure
        plan = _build_plan(query, normalized, validated, snapshot, provider)
        self.plans.save(plan, key, shared_key)
        return plan

    def load(self, selection_plan_id: str) -> SelectionPlan:
        """Load a persisted plan for numeric replay; the model is not asked again."""
        return self.plans.load(selection_plan_id)

    # ---- internals -----------------------------------------------------------
    def _resolve_provider(self) -> tuple[ModelProvider | None, str]:
        if self._provider is not None:
            return self._provider, ""
        try:
            return provider_from_env(self._store), ""
        except AquaError as exc:
            if exc.code != "selector_unavailable" or not exc.retryable:
                raise   # a configuration mistake is reported as it is
            return None, exc.message

    def _saved_or_unavailable(self, shared_key: str, is_language_model: bool, reselect: bool,
                              reason: str) -> SelectionPlan:
        """Serve a saved plan of the same versions, or fail clearly (S07).

        An explicit re-selection asks for a NEW model answer, so it is never satisfied
        from a saved plan.
        """
        if not reselect:
            saved = self.plans.latest_for_versions(shared_key, is_language_model=is_language_model)
            if saved is not None:
                return _as_reused(saved, REUSE_PROVIDER_DOWN)
        raise AquaError(
            "selector_unavailable",
            f"The variable selector is not available: {reason} Your input is kept; try again later.",
            retryable=True)


def _as_reused(plan: SelectionPlan, reason: str) -> SelectionPlan:
    """Copy of a stored plan marked as reused; the stored record is not changed."""
    return plan.model_copy(update={"reused": True, "reuse_reason": reason})


def _build_plan(query: str, normalized: str, validated: ValidatedSelection,
                snapshot: CatalogueSnapshot, provider: ModelProvider) -> SelectionPlan:
    """Assemble the persisted record from validated content only."""
    selector = SelectorInfo(provider=provider.name, model=provider.model, prompt_version=PROMPT_VERSION,
                            is_language_model=bool(provider.is_language_model))
    fields: dict[str, Any] = {
        "phenomenon_query": query,
        "normalized_query": normalized,
        "phenomenon_label": validated.phenomenon_label,
        "status": validated.status,
        "variable_set": [v.model_dump(mode="json") for v in validated.variable_set],
        "indicator_recipe_ids": list(validated.indicator_recipe_ids),
        "unanswerable": list(validated.unanswerable),
        "ignored_text_constraints": list(validated.ignored_text_constraints),
        "catalogue_version": snapshot.catalogue_version,
        "indicator_registry_version": snapshot.indicator_registry_version,
        "selector": selector.model_dump(mode="json"),
        "validation_notes": list(validated.notes),
    }
    served = getattr(provider, "served_model", None)
    if served and served != provider.model:
        fields["served_model"] = served
    return SelectionPlan(
        selection_plan_id=new_plan_id(),
        content_hash=content_hash(fields),
        created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **fields,
    )
