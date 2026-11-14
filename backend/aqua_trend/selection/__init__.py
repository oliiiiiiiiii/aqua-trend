"""PhenomenonSelector: natural-language phenomenon -> validated, persisted SelectionPlan.

Spec §3.1 / §10, data contracts §8, acceptance S01-S07 and P08.
"""
from .plans import PlanStore, normalize_query, plan_key
from .prompt import PROMPT_VERSION
from .providers import (
    AnthropicProvider,
    CatalogueLexicalProvider,
    ClaudeCliProvider,
    ModelProvider,
    ProviderOutputError,
    ProviderUnavailable,
    provider_from_env,
)
from .selector import PhenomenonSelector
from .snapshot import CatalogueSnapshot
from .validate import ValidatedSelection, validate_selection

__all__ = [
    "AnthropicProvider", "CatalogueLexicalProvider", "CatalogueSnapshot", "ClaudeCliProvider",
    "ModelProvider", "PROMPT_VERSION", "PhenomenonSelector", "PlanStore", "ProviderOutputError",
    "ProviderUnavailable", "ValidatedSelection", "normalize_query", "plan_key",
    "provider_from_env", "validate_selection",
]
