"""Typed view of ``catalogue/policies/preset_policy.json`` (spec §8; every number lives in the policy file)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from ..errors import AquaError

COMPONENTS: tuple[str, ...] = ("relevance", "effect", "quality", "stability")
ROLES: tuple[str, ...] = ("core_indicator", "related_condition", "response")


@dataclass(frozen=True)
class PresetPolicy:
    """Validated preset policy. ``raw`` is the registered document (stored with every search)."""

    version: str
    region_layers: tuple[str, ...]
    window_lengths_years: tuple[int, ...]
    window_step_years: int
    full_common_period: bool
    min_variables_fraction: float
    weights: dict[str, float]
    role_weights: dict[str, float]
    descriptive_only_factor: float
    fallback_or_caveat_penalty: float
    missing_rule: str
    max_presets_returned: int
    max_presets_per_region: int
    tie_break: tuple[str, ...]
    raw: dict[str, Any]

    @classmethod
    def from_store(cls, store: Any) -> "PresetPolicy":
        return cls.from_dict(store.policy("preset_policy"))

    @classmethod
    def from_dict(cls, doc: Mapping[str, Any]) -> "PresetPolicy":
        """Read the registered policy; a missing or malformed number is a release error, never a default."""
        try:
            weights = {c: float(doc["weights"][c]) for c in COMPONENTS}
            roles = {r: float(doc["relevance"][r]) for r in ROLES}
            policy = cls(
                version=str(doc["version"]),
                region_layers=tuple(str(x) for x in doc["candidate_region_layers"]),
                window_lengths_years=tuple(sorted({int(x) for x in doc["window_lengths_years"]})),
                window_step_years=int(doc["window_step_years"]),
                full_common_period=bool(doc["also_test_full_common_period"]),
                min_variables_fraction=float(doc["min_variables_fraction"]),
                weights=weights, role_weights=roles,
                descriptive_only_factor=float(doc["quality"]["descriptive_only_factor"]),
                fallback_or_caveat_penalty=float(doc["quality"]["fallback_or_caveat_penalty"]),
                missing_rule=str(doc["missing_component_rule"]),
                max_presets_returned=int(doc["max_presets_returned"]),
                max_presets_per_region=int(doc["max_presets_per_region"]),
                tie_break=tuple(str(x) for x in doc["tie_break"]),
                raw=dict(doc),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise AquaError("data_release_invalid", f"preset_policy.json is incomplete or malformed: {exc!r}",
                            fields=["preset_policy"]) from exc
        problems = []
        if abs(sum(weights.values()) - 1.0) > 1e-9:
            problems.append("weights must sum to 1")
        if any(w < 0 for w in weights.values()) or any(not 0 <= w <= 1 for w in roles.values()):
            problems.append("weights and role weights must lie in [0, 1]")
        if policy.window_step_years < 1 or any(n < 1 for n in policy.window_lengths_years):
            problems.append("window lengths and step must be positive whole years")
        if not 0 < policy.min_variables_fraction <= 1:
            problems.append("min_variables_fraction must lie in (0, 1]")
        if not 0 <= policy.descriptive_only_factor <= 1 or not 0 <= policy.fallback_or_caveat_penalty <= 1:
            problems.append("quality factors must lie in [0, 1]")
        if policy.max_presets_returned < 1 or policy.max_presets_per_region < 1:
            problems.append("max_presets_returned and max_presets_per_region must be at least 1")
        if problems:
            raise AquaError("data_release_invalid", "preset_policy.json: " + "; ".join(problems),
                            fields=["preset_policy"])
        return policy
