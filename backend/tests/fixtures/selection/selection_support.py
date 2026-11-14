"""TEST helpers for the selector: a fake PreparedDataStore and scripted providers."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any


FIXTURE = Path(__file__).with_name("catalogue_fixture.json")


class FakeStore:
    """Implements only the PreparedDataStore members the selector reads. TEST data."""

    def __init__(self) -> None:
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.versions: dict[str, str] = data["versions"]
        self._data = data

    def concepts(self) -> dict[str, dict]:
        return copy.deepcopy(self._data["concepts"])

    def refs(self) -> dict[str, dict]:
        return copy.deepcopy(self._data["refs"])

    def phenomena(self) -> list[dict]:
        return copy.deepcopy(self._data["phenomena"])

    def indicator_recipes(self) -> dict[str, dict]:
        return copy.deepcopy(self._data["recipes"])

    def regions(self) -> dict[str, dict]:
        return copy.deepcopy(self._data["regions"])


class ScriptedProvider:
    """Stands in for a language model: returns queued answers or raises queued errors."""

    is_language_model = True

    def __init__(self, *answers: Any, name: str = "scripted", model: str | None = "scripted-model-1") -> None:
        self.name = name
        self.model = model
        self._answers = list(answers)
        self.calls: list[tuple[str, str, dict]] = []

    def push(self, answer: Any) -> None:
        self._answers.append(answer)

    def complete(self, system: str, user: str, schema: dict) -> dict:
        self.calls.append((system, user, schema))
        if not self._answers:
            raise AssertionError("ScriptedProvider was called more often than scripted")
        answer = self._answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return copy.deepcopy(answer)


def drought_answer() -> dict:
    """A legal model answer for the TEST catalogue."""
    return {
        "phenomenon_label": "Drought",
        "status": "ok",
        "variable_set": [
            {"variable_id": "precip", "role": "core_indicator",
             "reason": "Precipitation deficit defines meteorological drought.",
             "catalogue_refs": ["test_ref_drought", "drought"]},
            {"variable_id": "soil_moisture_root", "role": "related_condition",
             "reason": "Root-zone soil moisture reflects agricultural drought.",
             "catalogue_refs": ["test_ref_soil"]},
        ],
        "indicator_recipe_ids": ["spi3"],
        "unanswerable": [],
        "ignored_text_constraints": [],
    }
