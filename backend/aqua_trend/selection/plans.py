"""Persistence of selection plans (spec §10, data contracts §8, acceptance P08).

A plan is written once and never modified. Layout under the plan directory:

    plans/<selection_plan_id>.json      the SelectionPlan
    by_key/<key>.json                   plan ids for one exact reuse key (newest last)
    by_versions/<key>.json              plan ids for one query + catalogue/prompt versions,
                                        whatever the provider (used only when the provider is down)

The reuse key hashes the normalised query, catalogue version, indicator registry version,
provider name, model and PROMPT_VERSION: a change in any of them yields a new plan.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
import unicodedata
import uuid
from pathlib import Path
from typing import Any

from ..contracts import SelectionPlan
from ..errors import AquaError

ENV_PLAN_DIR = "AQUA_PLAN_DIR"
DEFAULT_PLAN_DIR = Path(__file__).resolve().parents[2] / "var" / "plans"
PLAN_ID_PREFIX = "sp_"
_PLAN_ID = re.compile(r"^sp_[0-9a-f]{32}$")
#: fields that identify one stored copy rather than its content
_NOT_HASHED = frozenset({"selection_plan_id", "content_hash", "created_at", "reused", "reuse_reason"})


def normalize_query(query: str) -> str:
    """Unicode NFKC, trim, collapse whitespace, casefold."""
    return " ".join(unicodedata.normalize("NFKC", query).split()).casefold()


def _digest(payload: Any) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def plan_key(normalized_query: str, catalogue_version: str, indicator_registry_version: str,
             provider: str, model: str | None, prompt_version: str) -> str:
    """Exact reuse key of a plan."""
    return _digest(["plan-key", normalized_query, catalogue_version, indicator_registry_version,
                    provider, model, prompt_version])


def versions_key(normalized_query: str, catalogue_version: str, indicator_registry_version: str,
                 prompt_version: str) -> str:
    """Key shared by every provider for the same query and catalogue / prompt versions."""
    return _digest(["versions-key", normalized_query, catalogue_version, indicator_registry_version,
                    prompt_version])


def content_hash(plan_fields: dict[str, Any]) -> str:
    """SHA-256 of the plan content, without the id, timestamp and reuse marker."""
    return _digest({k: v for k, v in plan_fields.items() if k not in _NOT_HASHED})


def new_plan_id() -> str:
    return PLAN_ID_PREFIX + uuid.uuid4().hex


class PlanStore:
    """Directory-backed store of immutable SelectionPlan records."""

    def __init__(self, plan_dir: str | os.PathLike[str] | None = None) -> None:
        self.root = Path(plan_dir or os.environ.get(ENV_PLAN_DIR) or DEFAULT_PLAN_DIR)
        self._lock = threading.Lock()

    # ---- writing -----------------------------------------------------------
    def save(self, plan: SelectionPlan, key: str, shared_key: str) -> None:
        """Persist a validated plan and index it. Refuses to overwrite an existing id."""
        path = self._plan_path(plan.selection_plan_id)
        with self._lock:
            if path.exists():
                raise AquaError("internal_error", f"Selection plan {plan.selection_plan_id} already exists.")
            self._write(path, plan.model_dump(mode="json", exclude={"reused"}))
            self._append(self.root / "by_key" / f"{key}.json", plan.selection_plan_id)
            self._append(self.root / "by_versions" / f"{shared_key}.json", plan.selection_plan_id)

    # ---- reading -----------------------------------------------------------
    def load(self, selection_plan_id: str) -> SelectionPlan:
        """Load one plan and verify its content hash."""
        if not isinstance(selection_plan_id, str) or not _PLAN_ID.match(selection_plan_id):
            raise AquaError("not_found", "Unknown selection plan id.", fields=["selection_plan_id"])
        path = self._plan_path(selection_plan_id)
        if not path.is_file():
            raise AquaError("not_found", f"Selection plan {selection_plan_id} does not exist.",
                            fields=["selection_plan_id"])
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            plan = SelectionPlan.model_validate(data)
        except (ValueError, OSError) as exc:
            raise AquaError("internal_error", f"Selection plan {selection_plan_id} is unreadable: {exc}") from exc
        if content_hash(data) != plan.content_hash or plan.selection_plan_id != selection_plan_id:
            raise AquaError("internal_error",
                            f"Selection plan {selection_plan_id} does not match its content hash.")
        return plan

    def latest_for_key(self, key: str) -> SelectionPlan | None:
        """Newest plan stored under an exact reuse key."""
        return self._latest(self.root / "by_key" / f"{key}.json", None)

    def latest_for_versions(self, shared_key: str, *, is_language_model: bool) -> SelectionPlan | None:
        """Newest plan for the same query + versions made by the same KIND of selector."""
        return self._latest(self.root / "by_versions" / f"{shared_key}.json", is_language_model)

    # ---- internals ---------------------------------------------------------
    def _plan_path(self, selection_plan_id: str) -> Path:
        return self.root / "plans" / f"{selection_plan_id}.json"

    def _latest(self, index_path: Path, is_language_model: bool | None) -> SelectionPlan | None:
        for plan_id in reversed(self._read_index(index_path)):
            try:
                plan = self.load(plan_id)
            except AquaError:
                continue  # a damaged record is never served
            if is_language_model is None or plan.selector.is_language_model == is_language_model:
                return plan
        return None

    @staticmethod
    def _read_index(index_path: Path) -> list[str]:
        if not index_path.is_file():
            return []
        try:
            ids = json.loads(index_path.read_text(encoding="utf-8")).get("plan_ids", [])
        except (ValueError, OSError, AttributeError):
            return []
        return [i for i in ids if isinstance(i, str)]

    def _append(self, index_path: Path, plan_id: str) -> None:
        self._write(index_path, {"plan_ids": [*self._read_index(index_path), plan_id]})

    @staticmethod
    def _write(path: Path, payload: dict[str, Any]) -> None:
        """Atomic write: a reader never sees a half-written file."""
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=1, sort_keys=True)
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
