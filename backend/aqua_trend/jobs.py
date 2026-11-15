"""Background research jobs, cancellation, job persistence and the result cache.

Spec §10 (job stages, reproducibility, cache key), data contract §9 / §9.1 ("once a background
job exists, GET returns the job resource with failed / partial and the error code"), acceptance
section 8 (back-end parts), S07, P08, P09.

- One in-process ``JobManager`` runs ``ResearchEngine.run`` on a small thread pool.
- Every job pins the catalogue and policy snapshot it started with (spec §4).
- A cancelled job never publishes a result: the engine stops before corrected labels are
  attached, and whatever a worker returns after the cancel request is discarded.
- Final results are persisted by the engine through ``ResearchStorage``; the job record
  (request, status, error, stage history) is persisted beside them, so a finished, failed or
  cancelled research can still be read after a restart.
- Result cache: the engine's cache key covers the normalised request, the selection-plan content
  hash, the data/catalogue snapshot and every policy / engine version.  An identical request is
  served from the stored result as a NEW job that says so (``cache_hit`` / ``cached_from``).
  ``options.reselect`` bypasses both plan reuse and the cache.
"""
from __future__ import annotations

import logging
import os
import threading
import uuid
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from . import contracts as C
from .errors import AquaError

log = logging.getLogger("aqua_trend.jobs")

ENV_WORKERS = "AQUA_JOB_WORKERS"
ENV_RESULT_CACHE = "AQUA_RESULT_CACHE"
#: worker threads; the analysis host has two cores (operational setting, not an analysis policy)
DEFAULT_WORKERS = 2
#: finished jobs kept in memory; older ones are re-read from storage (operational setting)
JOBS_IN_MEMORY = 64
JOB_DOCUMENT_KIND = "jobs"
JOB_DOCUMENT_VERSION = "job-record-1"
RESEARCH_ID_PREFIX = "rs_"
FINAL_STATUSES = frozenset({"complete", "partial", "failed", "cancelled"})
RESULT_STATUSES = frozenset({"complete", "partial"})
_OFF = frozenset({"off", "none", "0", "false", "no"})

INTERNAL_ERROR_MESSAGE = ("The research stopped because of an unexpected server error. Your input is kept; "
                          "you can try again.")
CANCELLED_MESSAGE = ("The research was cancelled before its correction family was complete; no final "
                     "significance label was published.")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_research_id() -> str:
    return RESEARCH_ID_PREFIX + uuid.uuid4().hex


def workers_from_env(env: Optional[dict[str, str]] = None) -> int:
    """Worker count from ``AQUA_JOB_WORKERS`` (default 2); a bad value is a configuration error."""
    raw = (os.environ if env is None else env).get(ENV_WORKERS)
    if not raw:
        return DEFAULT_WORKERS
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{ENV_WORKERS}={raw!r} is not a whole number") from exc
    if value < 1:
        raise ValueError(f"{ENV_WORKERS} must be at least 1")
    return value


def cache_enabled_from_env(env: Optional[dict[str, str]] = None) -> bool:
    """``AQUA_RESULT_CACHE=off`` disables result reuse (default: on)."""
    raw = (os.environ if env is None else env).get(ENV_RESULT_CACHE)
    return raw is None or raw.strip().casefold() not in _OFF


@dataclass
class _Job:
    """Mutable state of one job; every access goes through ``JobManager._lock``."""

    research_id: str
    request: C.ResearchRequest
    created_at: str
    snapshot_id: Optional[str] = None
    policy_snapshot_id: Optional[str] = None
    status: str = "queued"
    stage: str = C.STAGES[0]
    completed: int = 0
    total: int = 0
    stage_detail: Optional[str] = None
    stage_history: list[str] = field(default_factory=list)
    error: Optional[C.ApiError] = None
    result: Optional[C.ResearchResult] = None
    updated_at: str = ""
    cancel: threading.Event = field(default_factory=threading.Event)
    cancel_requested: bool = False
    cached_from: Optional[str] = None
    future: Optional[Future] = None

    def to_contract(self, include_result: bool = True) -> C.ResearchJob:
        """Snapshot of the job as ``contracts.ResearchJob`` (extra fields are optional additions)."""
        return C.ResearchJob(
            research_id=self.research_id, status=self.status, stage=self.stage,
            progress=C.JobProgress(completed=self.completed, total=self.total),
            stage_detail=self.stage_detail, error=self.error, request=self.request,
            result=self.result if include_result else None,
            created_at=self.created_at, updated_at=self.updated_at or self.created_at,
            stage_history=list(self.stage_history), cancel_requested=self.cancel_requested,
            cache_hit=self.cached_from is not None, cached_from=self.cached_from,
            result_available=self.result is not None,
            snapshot_id=self.snapshot_id, policy_snapshot_id=self.policy_snapshot_id)

    def record(self) -> dict[str, Any]:
        """Persisted job record (the result itself lives under ``results/``)."""
        return {
            "record_version": JOB_DOCUMENT_VERSION, "research_id": self.research_id,
            "request": self.request.model_dump(mode="json"), "status": self.status, "stage": self.stage,
            "progress": {"completed": self.completed, "total": self.total},
            "stage_detail": self.stage_detail, "stage_history": list(self.stage_history),
            "error": self.error.model_dump(mode="json") if self.error else None,
            "created_at": self.created_at, "updated_at": self.updated_at or self.created_at,
            "cancel_requested": self.cancel_requested, "cached_from": self.cached_from,
            "snapshot_id": self.snapshot_id, "policy_snapshot_id": self.policy_snapshot_id,
        }


class JobManager:
    """In-process background jobs for one ``ResearchEngine`` (spec §10)."""

    def __init__(self, engine: Any, storage: Any = None, *, max_workers: Optional[int] = None,
                 use_cache: Optional[bool] = None) -> None:
        self.engine = engine
        self.storage = storage if storage is not None else getattr(engine, "storage", None)
        self.max_workers = max_workers if max_workers is not None else workers_from_env()
        self.use_cache = cache_enabled_from_env() if use_cache is None else use_cache
        self._pool = ThreadPoolExecutor(max_workers=self.max_workers, thread_name_prefix="aqua-job")
        self._jobs: OrderedDict[str, _Job] = OrderedDict()
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ public API

    def submit(self, request: C.ResearchRequest) -> C.ResearchJob:
        """Create a queued job for an already validated request and return it immediately."""
        job = _Job(research_id=new_research_id(), request=request.model_copy(deep=True), created_at=now_iso(),
                   snapshot_id=self.engine.catalogue_snapshot(), policy_snapshot_id=self.engine.policy_snapshot())
        job.updated_at = job.created_at
        with self._lock:
            self._jobs[job.research_id] = job
            job.future = self._pool.submit(self._run, job)
            return job.to_contract()

    def get(self, research_id: str, include_result: bool = True) -> C.ResearchJob:
        """The job resource; a finished research of an earlier process is read from storage."""
        with self._lock:
            job = self._jobs.get(research_id)
            if job is not None:
                return job.to_contract(include_result)
        stored = self._load_stored(research_id)
        with self._lock:
            job = self._jobs.setdefault(research_id, stored)
            self._evict()
            return job.to_contract(include_result)

    def cancel(self, research_id: str) -> C.ResearchJob:
        """Cancel a queued or running job; a finished job is returned unchanged.

        The job is ``cancelled`` from this moment: the engine is told to stop, and anything the
        worker still returns is discarded, so an incomplete correction family never yields a
        final label (data contract §9, DELETE).
        """
        seen = self.get(research_id)                                # not_found for unknown ids
        with self._lock:
            job = self._jobs.get(research_id)
            if job is None:                                         # finished long ago and already evicted
                return seen
            if job.status in FINAL_STATUSES:
                return job.to_contract()
            job.cancel.set()
            job.cancel_requested = True
            if job.future is not None:
                job.future.cancel()                                 # only succeeds while still queued
            self._close(job, "cancelled", error=C.ApiError(code="cancelled", message=CANCELLED_MESSAGE,
                                                           retryable=True))
            return job.to_contract()

    def active_count(self) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if j.status not in FINAL_STATUSES)

    def wait(self, research_id: str, timeout: Optional[float] = None) -> C.ResearchJob:
        """Block until the worker of a job has returned (tests and scripts; the API polls instead)."""
        with self._lock:
            job = self._jobs.get(research_id)
            future = job.future if job is not None else None
        if future is not None and not future.cancelled():
            try:
                future.result(timeout=timeout)
            except Exception:                                       # the worker never raises; a timeout may
                pass
        return self.get(research_id)

    def shutdown(self, wait: bool = False) -> None:
        """Stop accepting work and ask every unfinished job to stop."""
        with self._lock:
            for job in self._jobs.values():
                if job.status not in FINAL_STATUSES:
                    job.cancel.set()
        self._pool.shutdown(wait=wait, cancel_futures=True)

    # ------------------------------------------------------------------ worker

    def _on_stage(self, job: _Job, stage: str, completed: int, total: int, detail: Optional[str]) -> None:
        with self._lock:
            if job.status in FINAL_STATUSES:
                return
            job.status = "running"
            job.stage, job.completed, job.total, job.stage_detail = stage, int(completed), int(total), detail
            if not job.stage_history or job.stage_history[-1] != stage:
                job.stage_history.append(stage)
            job.updated_at = now_iso()

    def _run(self, job: _Job) -> None:
        """Worker body: never raises; every outcome becomes job state."""
        with self._lock:
            if job.status in FINAL_STATUSES:
                return
            job.status, job.updated_at = "running", now_iso()
        use_cache = self.use_cache and self.storage is not None and not job.request.options.reselect
        try:
            result = self.engine.run(
                job.request, job.snapshot_id, job.policy_snapshot_id,
                on_stage=lambda stage, completed, total, detail=None: self._on_stage(job, stage, completed, total,
                                                                                    detail),
                cancel=job.cancel, research_id=job.research_id, use_cache=use_cache)
        except AquaError as exc:
            status = "cancelled" if exc.code == "cancelled" else "failed"
            with self._lock:
                self._close(job, status, error=exc.to_api())
            return
        except Exception:                                           # noqa: BLE001 - reported, never leaked
            log.exception("research %s failed unexpectedly", job.research_id)
            with self._lock:
                self._close(job, "failed", error=C.ApiError(code="internal_error", message=INTERNAL_ERROR_MESSAGE,
                                                            retryable=True))
            return
        self._publish(job, result)

    def _publish(self, job: _Job, result: C.ResearchResult) -> None:
        """Attach a finished result — unless the job was cancelled in the meantime."""
        cached_from = getattr(result.identity, "cached_from", None)
        try:
            if cached_from and self.storage is not None and not self.storage.has_result(job.research_id):
                self.storage.save_result(result)                   # the copy survives a restart under its own id
        except Exception:                                           # noqa: BLE001
            log.exception("could not persist the cached copy of research %s", job.research_id)
        with self._lock:
            if job.status in FINAL_STATUSES:                        # cancelled while the worker was finishing
                return
            job.result, job.cached_from = result, cached_from
            detail = f"served from the result cache (research {cached_from})" if cached_from \
                else result.identity.status
            job.stage, job.completed, job.total, job.stage_detail = C.STAGES[-1], 1, 1, detail
            if not job.stage_history or job.stage_history[-1] != C.STAGES[-1]:
                job.stage_history.append(C.STAGES[-1])
            status = result.identity.status if result.identity.status in RESULT_STATUSES else "partial"
            self._close(job, status)

    def _close(self, job: _Job, status: str, error: Optional[C.ApiError] = None) -> None:
        """Set a final status, persist the job record and trim the in-memory table (lock held)."""
        job.status, job.error, job.updated_at = status, error, now_iso()
        if status not in RESULT_STATUSES:
            job.result = None
        if self.storage is not None:
            try:
                self.storage.save_document(JOB_DOCUMENT_KIND, job.research_id, job.record())
            except Exception:                                       # noqa: BLE001
                log.exception("could not persist the job record of research %s", job.research_id)
        self._evict()

    def _evict(self) -> None:
        """Keep at most ``JOBS_IN_MEMORY`` finished jobs in memory (lock held)."""
        finished = [rid for rid, j in self._jobs.items() if j.status in FINAL_STATUSES]
        for rid in finished[:max(len(finished) - JOBS_IN_MEMORY, 0)]:
            del self._jobs[rid]

    # ------------------------------------------------------------------ storage

    def _load_stored(self, research_id: str) -> _Job:
        """Rebuild a finished job from its persisted record and / or result; ``not_found`` otherwise."""
        missing = AquaError("not_found", f"Research {research_id!r} does not exist.", fields=["research_id"])
        if self.storage is None:
            raise missing
        record = self._stored_record(research_id)
        result = self._stored_result(research_id)
        if record is None and result is None:
            raise missing
        if record is None:
            return self._job_from_result(result)
        job = _Job(research_id=research_id, request=C.ResearchRequest.model_validate(record["request"]),
                   created_at=record["created_at"], snapshot_id=record.get("snapshot_id"),
                   policy_snapshot_id=record.get("policy_snapshot_id"), status=record["status"],
                   stage=record.get("stage") or C.STAGES[0],
                   completed=int((record.get("progress") or {}).get("completed", 0)),
                   total=int((record.get("progress") or {}).get("total", 0)),
                   stage_detail=record.get("stage_detail"), stage_history=list(record.get("stage_history") or []),
                   error=C.ApiError.model_validate(record["error"]) if record.get("error") else None,
                   updated_at=record.get("updated_at") or record["created_at"],
                   cancel_requested=bool(record.get("cancel_requested")), cached_from=record.get("cached_from"))
        if job.status in RESULT_STATUSES:
            if result is None:                                      # the record promises a result that is gone
                job.status = "failed"
                job.error = C.ApiError(code="not_found", retryable=True,
                                       message="The stored result of this research is no longer available; "
                                               "run the research again.")
            else:
                job.result = result
        elif job.status not in FINAL_STATUSES:                      # a record is only written for final states
            raise missing
        return job

    def _stored_record(self, research_id: str) -> Optional[dict[str, Any]]:
        try:
            record = self.storage.load_document(JOB_DOCUMENT_KIND, research_id)
        except AquaError as exc:
            if exc.code == "not_found":
                return None
            raise
        return record if isinstance(record, dict) and record.get("research_id") == research_id else None

    def _stored_result(self, research_id: str) -> Optional[C.ResearchResult]:
        try:
            return self.storage.load_result(research_id)
        except AquaError as exc:
            if exc.code == "not_found":
                return None
            raise

    @staticmethod
    def _job_from_result(result: C.ResearchResult) -> _Job:
        """Job view of a result stored without a job record (e.g. written by ``scripts/run_research.py``)."""
        identity, user = result.identity, result.user_constraints
        request = C.ResearchRequest(
            phenomenon_query=user.phenomenon_query, region_id=user.region_id, period=user.period,
            context=C.RequestContext(parent_research_id=identity.parent_research_id,
                                     preset_ref=identity.preset_ref))
        status = identity.status if identity.status in RESULT_STATUSES else "partial"
        return _Job(research_id=identity.research_id, request=request, created_at=identity.created_at,
                    snapshot_id=getattr(identity, "snapshot_id", None),
                    policy_snapshot_id=getattr(identity, "policy_snapshot_id", None),
                    status=status, stage=C.STAGES[-1], completed=1, total=1, stage_detail=status,
                    stage_history=[C.STAGES[-1]], result=result, updated_at=identity.created_at,
                    cached_from=getattr(identity, "cached_from", None))
