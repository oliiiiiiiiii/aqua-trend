"""Immutable view of the offline catalogue used for one selection.

The selector, the prompt builder, the validator and the lexical matcher all read the
SAME snapshot, so the ids a model may return are exactly the ids that are validated
(acceptance S01). Nothing here reads the network or prepared series.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

#: prefix of the context id that points at a concept's own catalogue description
CONCEPT_REF_PREFIX = "concept:"
#: prefix of the context id that points at an indicator recipe's applicability text
RECIPE_REF_PREFIX = "recipe:"


@dataclass(frozen=True)
class CatalogueSnapshot:
    """Catalogue content relevant to variable selection (architecture note §3)."""

    catalogue_version: str
    indicator_registry_version: str
    concepts: Mapping[str, Mapping[str, Any]]
    refs: Mapping[str, Mapping[str, Any]]
    phenomena: tuple[Mapping[str, Any], ...]
    recipes: Mapping[str, Mapping[str, Any]]
    #: region display names (used only to RECOGNISE place words that must be ignored, S05)
    region_names: tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def from_store(cls, store: Any) -> "CatalogueSnapshot":
        """Read the selection-relevant catalogue through the PreparedDataStore interface."""
        versions = dict(store.versions)
        return cls(
            catalogue_version=str(versions["catalogue_version"]),
            indicator_registry_version=str(versions["indicator_registry_version"]),
            concepts=dict(store.concepts()),
            refs=dict(store.refs()),
            phenomena=tuple(_normalise_note(n) for n in _entries(store.phenomena())),
            recipes=_keyed(store.indicator_recipes(), "indicator_id"),
            region_names=_region_names(store),
        )

    @property
    def phenomenon_ids(self) -> frozenset[str]:
        return frozenset(str(p["phenomenon_id"]) for p in self.phenomena if p.get("phenomenon_id"))

    def traceable_refs(self, variable_id: str) -> frozenset[str]:
        """Context ids that document THIS variable (S04: a reason must point back to the catalogue).

        - ``concept:<variable_id>`` and the concept's own ``scientific_refs``;
        - every curated note that links the variable: its ``phenomenon_id``, the link's
          ``ref_ids`` and the note-level ``ref_ids``;
        - ``recipe:<indicator_id>`` of every recipe that requires the variable.
        A reference that exists in the catalogue but documents something else is not
        a trace for this variable.
        """
        ids: set[str] = {CONCEPT_REF_PREFIX + variable_id}
        concept = self.concepts.get(variable_id) or {}
        ids |= {str(r) for r in concept.get("scientific_refs") or [] if r in self.refs}
        for note in self.phenomena:
            if variable_id not in self.documented_roles(note):
                continue
            ids.add(str(note.get("phenomenon_id")))
            ids |= {str(r) for r in note.get("ref_ids") or [] if r in self.refs}
            for link in note.get("variable_links") or []:
                if link.get("variable_id") == variable_id:
                    ids |= {str(r) for r in link.get("ref_ids") or [] if r in self.refs}
        for indicator_id, recipe in self.recipes.items():
            if variable_id in recipe_variable_ids(recipe):
                ids.add(RECIPE_REF_PREFIX + indicator_id)
        return frozenset(ids)

    @staticmethod
    def documented_roles(note: Mapping[str, Any]) -> dict[str, str]:
        """``{variable_id: role}`` as written in one curated phenomenon note."""
        return {
            str(link.get("variable_id")): str(link.get("role"))
            for link in note.get("variable_links") or []
            if isinstance(link, Mapping) and link.get("variable_id")
        }

    def note(self, phenomenon_id: str) -> Mapping[str, Any] | None:
        for note in self.phenomena:
            if note.get("phenomenon_id") == phenomenon_id:
                return note
        return None

    def valid_context_ids(self) -> frozenset[str]:
        """Every id a ``catalogue_refs`` entry may resolve to (S04).

        Reference ids, curated phenomenon note ids, and ``concept:<variable_id>`` /
        ``recipe:<indicator_id>`` for the catalogue's own description of a concept / recipe.
        """
        ids = set(self.refs) | set(self.phenomenon_ids)
        ids |= {CONCEPT_REF_PREFIX + v for v in self.concepts}
        ids |= {RECIPE_REF_PREFIX + r for r in self.recipes}
        return frozenset(ids)


def recipe_variable_ids(recipe: Mapping[str, Any]) -> frozenset[str]:
    """Variable ids a recipe needs; ``required_variables`` holds ids or ``{variable_id: ...}`` objects."""
    out: set[str] = set()
    for item in recipe.get("required_variables") or []:
        if isinstance(item, str):
            out.add(item)
        elif isinstance(item, Mapping) and isinstance(item.get("variable_id"), str):
            out.add(item["variable_id"])
    return frozenset(out)


def flat_aliases(value: Any) -> list[str]:
    """Aliases as one flat list.

    The catalogue stores ``aliases`` per language (``{"zh": [...], "en": [...]}``); a plain
    list or a single string is accepted too. Language keys are never treated as aliases.
    """
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, Mapping):
        return [alias for group in value.values() for alias in flat_aliases(group)]
    return [v for v in value if isinstance(v, str) and v.strip()]


def _entries(value: Any) -> list[Mapping[str, Any]]:
    """Catalogue entries given as a list or as an id-keyed mapping."""
    if isinstance(value, Mapping):
        return [v for v in value.values() if isinstance(v, Mapping)]
    return [v for v in value or [] if isinstance(v, Mapping)]


def _keyed(value: Any, id_key: str) -> dict[str, Mapping[str, Any]]:
    """Id-keyed mapping from either an id-keyed mapping or a list of entries carrying ``id_key``."""
    if isinstance(value, Mapping):
        return dict(value)
    return {str(v[id_key]): v for v in _entries(value) if v.get(id_key)}


def _normalise_note(note: Mapping[str, Any]) -> dict[str, Any]:
    """Copy of a curated note with ``aliases`` flattened (content is otherwise untouched)."""
    out = dict(note)
    out["aliases"] = flat_aliases(note.get("aliases"))
    return out


def _region_names(store: Any) -> tuple[str, ...]:
    """Region names from the region catalogue, when the store exposes one."""
    regions = getattr(store, "regions", None)
    if regions is None:
        return ()
    try:
        entries = regions()
    except Exception:  # the region catalogue is optional for selection
        return ()
    names: set[str] = set()
    for entry in entries.values():
        candidates = [entry.get("name"), entry.get("name_zh")]
        for country in entry.get("countries") or []:   # member countries of a basin / cell, when listed
            if isinstance(country, Mapping):
                candidates += [country.get("zh"), country.get("en"), country.get("name")]
        names |= {c.strip() for c in candidates if isinstance(c, str) and c.strip()}
    return tuple(sorted(names))
