"""Strict validation of a provider's answer against the CURRENT catalogue snapshot.

Rules implemented (spec §3.1; acceptance S01, S03, S04, S05, S06):
- every ``variable_id`` and indicator recipe id exists in the snapshot (S01);
- roles are one of the three registered roles and every reason is non-empty and
  carries at least one ``catalogue_refs`` id that resolves in the snapshot AND documents
  that very variable (its concept, a curated note that links it, a recipe that needs it).
  Valid ids that document something else are removed and recorded. When a cited note
  documents a role for the variable, the returned role must be that role (S04);
- ``ignored_text_constraints`` entries that do not occur in the user's text are removed
  and recorded: the list reports words that were seen and not applied (S05);
- keys that try to set a region, period, product, significance or quality conclusion
  are stripped and recorded: the model can never set structured fields (S05);
- keys that carry code, formulas, thresholds or event definitions make the whole
  answer invalid; nothing is persisted (S06);
- ``unsupported_phenomenon`` has an empty variable set and no recipes, and an empty
  variable set is always ``unsupported_phenomenon`` (S03).

Any violation raises ``AquaError("selector_invalid_output")``. The function is pure.
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Any, Mapping

from ..contracts import SelectedVariable
from ..errors import AquaError
from .prompt import ROLES, STATUSES
from .snapshot import CatalogueSnapshot

TOP_LEVEL_KEYS: frozenset[str] = frozenset({
    "phenomenon_label", "status", "variable_set", "indicator_recipe_ids",
    "unanswerable", "ignored_text_constraints",
})
VARIABLE_KEYS: frozenset[str] = frozenset({"variable_id", "role", "reason", "catalogue_refs"})

#: keys that would execute or define new science at query time -> the answer is rejected (S06)
FORBIDDEN_KEYS: frozenset[str] = frozenset({
    "code", "script", "python", "program", "sql", "command", "exec", "eval",
    "formula", "formulas", "equation", "expression", "computation", "algorithm",
    "threshold", "thresholds", "event_rule", "event_definition", "definition",
    "new_indicator", "new_indicators", "indicator_definition", "recipe", "recipes",
})


@dataclass(frozen=True)
class ValidatedSelection:
    """A provider answer that passed every catalogue check."""

    phenomenon_label: str
    status: str
    variable_set: tuple[SelectedVariable, ...]
    indicator_recipe_ids: tuple[str, ...]
    unanswerable: tuple[str, ...]
    ignored_text_constraints: tuple[str, ...]
    #: what validation removed or changed, e.g. "stripped key 'region'" (kept with the plan)
    notes: tuple[str, ...] = field(default_factory=tuple)


def _invalid(message: str, fields: list[str] | None = None) -> AquaError:
    return AquaError("selector_invalid_output", message, fields=fields)


def _strip_keys(obj: Mapping[str, Any], allowed: frozenset[str], where: str, notes: list[str]) -> dict[str, Any]:
    """Reject forbidden keys, strip and record every other unknown key."""
    clean: dict[str, Any] = {}
    for key, value in obj.items():
        name = str(key)
        if name in allowed:
            clean[name] = value
        elif name.casefold() in FORBIDDEN_KEYS:
            raise _invalid(
                f"The selector returned '{name}' in {where}. Code, formulas, thresholds and event "
                "definitions are never accepted from a model.", fields=[name])
        else:
            notes.append(f"stripped key '{name}' from {where}: not part of a selection plan")
    return clean


def _string_list(value: Any, name: str) -> list[str]:
    """A list of non-empty strings without duplicates (order kept)."""
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise _invalid(f"'{name}' must be a list of strings.", fields=[name])
    out: list[str] = []
    for item in value:
        text = item.strip()
        if text and text not in out:
            out.append(text)
    return out


def _variable(item: Any, index: int, snapshot: CatalogueSnapshot, context_ids: frozenset[str],
              notes: list[str]) -> SelectedVariable:
    """Validate one variable_set entry (S01, S04)."""
    where = f"variable_set[{index}]"
    if not isinstance(item, Mapping):
        raise _invalid(f"{where} is not an object.", fields=["variable_set"])
    clean = _strip_keys(item, VARIABLE_KEYS, where, notes)
    variable_id = clean.get("variable_id")
    if not isinstance(variable_id, str) or variable_id not in snapshot.concepts:
        raise _invalid(
            f"{where}: variable_id {variable_id!r} is not in catalogue {snapshot.catalogue_version}.",
            fields=["variable_set"])
    role = clean.get("role")
    if role not in ROLES:
        raise _invalid(f"{where}: role {role!r} is not one of {', '.join(ROLES)}.", fields=["variable_set"])
    reason = clean.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise _invalid(f"{where}: the reason for '{variable_id}' is empty.", fields=["variable_set"])
    refs = _string_list(clean.get("catalogue_refs"), f"{where}.catalogue_refs")
    unknown = [r for r in refs if r not in context_ids]
    if unknown:
        raise _invalid(
            f"{where}: catalogue_refs {unknown} do not resolve to a reference or catalogue note.",
            fields=["variable_set"])
    traceable = snapshot.traceable_refs(variable_id)
    unrelated = [r for r in refs if r not in traceable]
    refs = [r for r in refs if r in traceable]
    if unrelated:
        notes.append(f"removed catalogue_refs {unrelated} from '{variable_id}': they do not document this variable")
    if not refs:
        raise _invalid(
            f"{where}: '{variable_id}' has no catalogue reference that documents it, so its reason "
            "cannot be traced to the offline catalogue.", fields=["variable_set"])
    _check_documented_role(where, variable_id, role, refs, snapshot)
    return SelectedVariable(variable_id=variable_id, role=role, reason=reason.strip(), catalogue_refs=refs)


def _check_documented_role(where: str, variable_id: str, role: str, refs: list[str],
                           snapshot: CatalogueSnapshot) -> None:
    """A role taken from a cited curated note must be the role that note documents (S04)."""
    documented = set()
    for ref in refs:
        note = snapshot.note(ref)
        if note is not None:
            documented.add(snapshot.documented_roles(note).get(variable_id))
    documented.discard(None)
    if documented and role not in documented:
        raise _invalid(
            f"{where}: role {role!r} for '{variable_id}' contradicts the cited catalogue note(s), "
            f"which document {sorted(documented)}.", fields=["variable_set"])


def _variables(value: Any, snapshot: CatalogueSnapshot, notes: list[str]) -> list[SelectedVariable]:
    if not isinstance(value, list):
        raise _invalid("'variable_set' must be a list.", fields=["variable_set"])
    context_ids = snapshot.valid_context_ids()
    out: dict[str, SelectedVariable] = {}
    for index, item in enumerate(value):
        variable = _variable(item, index, snapshot, context_ids, notes)
        if variable.variable_id in out:
            notes.append(f"removed duplicate variable '{variable.variable_id}' (first entry kept)")
            continue
        out[variable.variable_id] = variable
    return list(out.values())


def _recipes(value: Any, snapshot: CatalogueSnapshot) -> list[str]:
    recipe_ids = _string_list(value, "indicator_recipe_ids")
    unknown = [r for r in recipe_ids if r not in snapshot.recipes]
    if unknown:
        raise _invalid(
            f"indicator recipe ids {unknown} are not in indicator registry "
            f"{snapshot.indicator_registry_version}.", fields=["indicator_recipe_ids"])
    return recipe_ids


def _reconcile_status(status: str, variables: list[SelectedVariable], recipe_ids: list[str],
                      unanswerable: list[str], notes: list[str]) -> str:
    """Make status and content agree without ever adding variables (S03)."""
    if status == "unsupported_phenomenon":
        if variables or recipe_ids:
            raise _invalid(
                "The selector marked the phenomenon unsupported but still returned variables or "
                "indicators; the answer is contradictory.", fields=["status"])
        return status
    if not variables:
        notes.append(f"status '{status}' with an empty variable set recorded as unsupported_phenomenon")
        if recipe_ids:
            raise _invalid("Indicator recipes were returned without any variable.", fields=["indicator_recipe_ids"])
        return "unsupported_phenomenon"
    if status == "partial" and not unanswerable:
        raise _invalid("A partial selection must state what cannot be answered.", fields=["unanswerable"])
    if status == "ok" and unanswerable:
        notes.append("status 'ok' with unanswerable aspects recorded as partial")
        return "partial"
    return status


def _seen_in_query(items: list[str], query: str | None, notes: list[str]) -> list[str]:
    """Keep only the constraint words that really occur in the user's text (S05)."""
    if query is None:
        return items
    text = _fold(query)
    kept = [item for item in items if _fold(item) in text]
    dropped = [item for item in items if item not in kept]
    if dropped:
        notes.append(f"removed ignored_text_constraints {dropped}: not found in the query text")
    return kept


def _fold(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def validate_selection(raw: Any, snapshot: CatalogueSnapshot, query: str | None = None) -> ValidatedSelection:
    """Validate a provider answer; raise ``AquaError("selector_invalid_output")`` on any violation.

    ``query`` is the user's text; when given, ``ignored_text_constraints`` is checked against it.
    """
    if not isinstance(raw, Mapping):
        raise _invalid("The selector did not return a JSON object.")
    notes: list[str] = []
    clean = _strip_keys(raw, TOP_LEVEL_KEYS, "the selection", notes)

    label = clean.get("phenomenon_label")
    if not isinstance(label, str) or not label.strip():
        raise _invalid("'phenomenon_label' is missing or empty.", fields=["phenomenon_label"])
    status = clean.get("status")
    if status not in STATUSES:
        raise _invalid(f"status {status!r} is not one of {', '.join(STATUSES)}.", fields=["status"])

    variables = _variables(clean.get("variable_set", []), snapshot, notes)
    recipe_ids = _recipes(clean.get("indicator_recipe_ids"), snapshot)
    unanswerable = _string_list(clean.get("unanswerable"), "unanswerable")
    ignored = _string_list(clean.get("ignored_text_constraints"), "ignored_text_constraints")
    ignored = _seen_in_query(ignored, query, notes)
    status = _reconcile_status(status, variables, recipe_ids, unanswerable, notes)

    return ValidatedSelection(
        phenomenon_label=label.strip(),
        status=status,
        variable_set=tuple(variables),
        indicator_recipe_ids=tuple(recipe_ids),
        unanswerable=tuple(unanswerable),
        ignored_text_constraints=tuple(ignored),
        notes=tuple(notes),
    )
