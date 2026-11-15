"""File-backed runtime storage for results, evidence families, presets and the result cache.

Spec §10 (reproducibility: every final result keeps its plan, versions, families and search
context), data contract §9.3 ("large lists may be kept in an external record that the result
can locate and verify").

Layout under the var directory (``backend/var``; override with ``AQUA_VAR_DIR``):

    results/<research_id>.json            contracts.ResearchResult
    families/<family_id>.json             contracts.EvidenceFamily with the FULL hypothesis list
    presets/<preset_id>/<version>.json    contracts.Preset
    cache/research/<cache_key>.json       {"research_id": ...}   (cache index)

Every write is atomic (temporary file + ``os.replace``), so a reader never sees a half-written
record.  Ids are validated before they are used in a path.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any, Iterable, Optional

from . import contracts as C
from .errors import AquaError

ENV_VAR_DIR = "AQUA_VAR_DIR"
DEFAULT_VAR_DIR = Path(__file__).resolve().parents[1] / "var"
#: hypotheses embedded in a result before the list is truncated to a sample + ``external_ref``
#: (a storage/transport size limit, not an analysis policy; the stored family is always complete)
EMBED_HYPOTHESES_MAX = 200
FAMILY_REF_PREFIX = "family:"

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+=\-]{0,199}$")


def _check_id(value: Any, what: str) -> str:
    if not isinstance(value, str) or not _SAFE_ID.match(value) or ".." in value:
        raise AquaError("not_found", f"Unknown {what}.", fields=[what])
    return value


class ResearchStorage:
    """Directory-backed store used by the engine, the preset engine and the API."""

    def __init__(self, var_dir: str | os.PathLike[str] | None = None) -> None:
        self.root = Path(var_dir or os.environ.get(ENV_VAR_DIR) or DEFAULT_VAR_DIR)
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ low level

    def _write(self, path: Path, payload: Any) -> None:
        """Atomic JSON write; NaN / Infinity can never reach the file."""
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(C.json_safe(payload), handle, ensure_ascii=False, allow_nan=False)
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

    @staticmethod
    def _read(path: Path, what: str) -> Any:
        if not path.is_file():
            raise AquaError("not_found", f"{what} does not exist.", fields=[what])
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise AquaError("internal_error", f"{what} is unreadable: {exc}") from exc

    # ------------------------------------------------------------------ results

    def result_path(self, research_id: str) -> Path:
        return self.root / "results" / f"{_check_id(research_id, 'research_id')}.json"

    def save_result(self, result: C.ResearchResult) -> Path:
        """Persist a result snapshot under its research id (overwrites the same id)."""
        path = self.result_path(result.identity.research_id)
        with self._lock:
            self._write(path, result.model_dump(mode="json"))
        return path

    def load_result(self, research_id: str) -> C.ResearchResult:
        data = self._read(self.result_path(research_id), f"research {research_id}")
        return C.ResearchResult.model_validate(data)

    def has_result(self, research_id: str) -> bool:
        try:
            return self.result_path(research_id).is_file()
        except AquaError:
            return False

    # ------------------------------------------------------------------ evidence families

    def family_path(self, family_id: str) -> Path:
        return self.root / "families" / f"{_check_id(family_id, 'family_id')}.json"

    def save_family(self, family: C.EvidenceFamily) -> str:
        """Persist the FULL family and return its locator (``family:<family_id>``).

        A family id is the hash of its content, so writing the same id twice is idempotent;
        a truncated copy is refused — the stored record must be the complete comparison list.
        """
        if family.hypotheses_truncated:
            raise AquaError("internal_error", f"Family {family.family_id} is truncated and cannot be stored as the "
                                              "full record.")
        path = self.family_path(family.family_id)
        with self._lock:
            if not path.is_file():
                self._write(path, family.model_dump(mode="json"))
        return FAMILY_REF_PREFIX + family.family_id

    def load_family(self, family_id_or_ref: str) -> C.EvidenceFamily:
        """Load the full family by id or by its ``family:<id>`` locator and verify what it claims to be."""
        family_id = family_id_or_ref[len(FAMILY_REF_PREFIX):] \
            if isinstance(family_id_or_ref, str) and family_id_or_ref.startswith(FAMILY_REF_PREFIX) else family_id_or_ref
        family = C.EvidenceFamily.model_validate(self._read(self.family_path(family_id), f"family {family_id}"))
        if family.family_id != family_id or family.hypotheses_truncated \
                or len(family.hypotheses) != family.n_candidates:
            raise AquaError("internal_error", f"Stored family {family_id} is not a complete record of itself.")
        return family

    def has_family(self, family_id: str) -> bool:
        try:
            return self.family_path(family_id).is_file()
        except AquaError:
            return False

    def embed_family(self, family: C.EvidenceFamily, keep_ids: Iterable[str] = (),
                     limit: int = EMBED_HYPOTHESES_MAX) -> C.EvidenceFamily:
        """Copy of ``family`` for embedding in a result.

        A family of at most ``limit`` hypotheses is embedded whole.  A larger one is stored in
        full, and the copy keeps the hypotheses named in ``keep_ids`` (the ones this result
        refers to) plus the head of the list, with ``hypotheses_truncated`` and ``external_ref``.
        Counts, ids and the content hash always describe the complete family.
        """
        ref = self.save_family(family)
        if len(family.hypotheses) <= limit:
            return family.model_copy(update={"external_ref": ref})
        keep = set(keep_ids)
        kept = [h for h in family.hypotheses if h.hypothesis_id in keep]
        rest = [h for h in family.hypotheses if h.hypothesis_id not in keep][:max(limit - len(kept), 0)]
        return family.model_copy(update={"hypotheses": kept + rest, "hypotheses_truncated": True,
                                         "external_ref": ref})

    # ------------------------------------------------------------------ presets

    def _preset_dir(self, preset_id: str) -> Path:
        return self.root / "presets" / _check_id(preset_id, "preset_id")

    def save_preset(self, preset: C.Preset) -> Path:
        """Persist one preset version; an existing version is never modified (a change is a new version)."""
        path = self._preset_dir(preset.preset_id) / f"{_check_id(preset.version, 'preset_version')}.json"
        payload = preset.model_dump(mode="json")
        with self._lock:
            if path.is_file():
                if C.json_safe(json.loads(path.read_text(encoding="utf-8"))) != C.json_safe(payload):
                    raise AquaError("internal_error", f"Preset {preset.preset_id} version {preset.version} already "
                                                      "exists with other content; create a new version.")
                return path
            self._write(path, payload)
        return path

    def preset_versions(self, preset_id: str) -> list[str]:
        """Stored versions of one preset, oldest first (by file time, then name)."""
        directory = self._preset_dir(preset_id)
        if not directory.is_dir():
            return []
        files = sorted(directory.glob("*.json"), key=lambda p: (p.stat().st_mtime_ns, p.name))
        return [p.stem for p in files]

    def load_preset(self, preset_id: str, version: Optional[str] = None) -> C.Preset:
        """Load one preset version (the newest stored version when ``version`` is None)."""
        if version is None:
            versions = self.preset_versions(preset_id)
            if not versions:
                raise AquaError("not_found", f"Preset {preset_id} does not exist.", fields=["preset_ref"])
            version = versions[-1]
        path = self._preset_dir(preset_id) / f"{_check_id(version, 'preset_version')}.json"
        preset = C.Preset.model_validate(self._read(path, f"preset {preset_id} version {version}"))
        if preset.preset_id != preset_id or preset.version != version:
            raise AquaError("internal_error", f"Stored preset {preset_id}@{version} does not match its file name.")
        return preset

    def list_presets(self) -> list[C.Preset]:
        """Newest version of every stored preset, ordered by preset id."""
        root = self.root / "presets"
        if not root.is_dir():
            return []
        out = []
        for directory in sorted(p for p in root.iterdir() if p.is_dir()):
            try:
                out.append(self.load_preset(directory.name))
            except AquaError:
                continue                                    # a damaged record is never served
        return out

    # ------------------------------------------------------------------ cache index

    def _cache_path(self, cache_key: str) -> Path:
        return self.root / "cache" / "research" / f"{_check_id(cache_key, 'cache_key')}.json"

    def cache_put(self, cache_key: str, research_id: str) -> None:
        """Index a stored result under the key of everything that can change its numbers."""
        with self._lock:
            self._write(self._cache_path(cache_key), {"cache_key": cache_key, "research_id": research_id})

    def cache_get(self, cache_key: str) -> Optional[str]:
        """Research id stored under ``cache_key`` when that result still exists, else ``None``."""
        try:
            entry = self._read(self._cache_path(cache_key), "cache entry")
        except AquaError:
            return None
        research_id = entry.get("research_id") if isinstance(entry, dict) else None
        return research_id if isinstance(research_id, str) and self.has_result(research_id) else None

    # ------------------------------------------------------------------ generic documents

    def save_document(self, kind: str, key: str, payload: Any) -> Path:
        """Atomic write of an auxiliary JSON document under ``<kind>/<key>.json`` (e.g. preset search logs)."""
        path = self.root / _check_id(kind, "kind") / f"{_check_id(key, 'key')}.json"
        with self._lock:
            self._write(path, payload)
        return path

    def load_document(self, kind: str, key: str) -> Any:
        return self._read(self.root / _check_id(kind, "kind") / f"{_check_id(key, 'key')}.json", f"{kind} {key}")
