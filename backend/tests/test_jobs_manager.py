"""JobManager with a scripted TEST engine: progress, cancellation, failures, persistence (spec §10).

No prepared data is read; ``FakeEngine`` only reports stages and returns a minimal, empty
``ResearchResult`` (TEST object, no numbers).
"""
from __future__ import annotations

import threading

import pytest

from aqua_trend import contracts as C
from aqua_trend.errors import AquaError
from aqua_trend.jobs import (
    JOBS_IN_MEMORY, JobManager, cache_enabled_from_env, new_research_id, workers_from_env,
)
from aqua_trend.storage import ResearchStorage

REQUEST = C.ResearchRequest(phenomenon_query="TEST phenomenon", region_id="test-region",
                            period=C.Period(start="2001-01", end="2020-12"))


def empty_result(research_id: str, request: C.ResearchRequest, status: str = "complete", **identity) -> C.ResearchResult:
    """A TEST result without any variable or number."""
    return C.ResearchResult(
        identity=C.Identity(
            research_id=research_id, created_at="2000-01-01T00:00:00Z", status=status, dataset_version="TEST",
            catalogue_version="TEST", region_catalogue_version="TEST", indicator_registry_version="TEST",
            method_policy_version="TEST", preset_policy_version="TEST", quality_policy_version="TEST",
            engine_version="TEST", **identity),
        user_constraints=C.UserConstraints(phenomenon_query=request.phenomenon_query, region_id=request.region_id,
                                           period=request.period))


class FakeEngine:
    """TEST engine: walks the stages, optionally waits at a gate, then returns / raises as scripted."""

    def __init__(self, storage=None, outcome=None, gate_stage=None, status="complete"):
        self.storage, self.outcome, self.gate_stage, self.status = storage, outcome, gate_stage, status
        self.entered, self.release = threading.Event(), threading.Event()
        self.calls: list[dict] = []

    def catalogue_snapshot(self) -> str:
        return "snap-TEST"

    def policy_snapshot(self) -> str:
        return "pol-TEST"

    def run(self, request, catalogue_snapshot=None, policy_snapshot=None, *, on_stage=None, cancel=None,
            research_id=None, use_cache=False):
        self.calls.append({"snapshot": catalogue_snapshot, "policy": policy_snapshot, "use_cache": use_cache,
                           "research_id": research_id})
        for stage in C.STAGES[:-1]:
            if cancel.is_set():
                raise AquaError("cancelled", "TEST cancelled")
            on_stage(stage, 0, 0, None)
            if stage == self.gate_stage:
                self.entered.set()
                assert self.release.wait(30)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        result = self.outcome(research_id, request) if callable(self.outcome) \
            else empty_result(research_id, request, self.status)
        if self.storage is not None and not getattr(result.identity, "cached_from", None):
            self.storage.save_result(result)
        on_stage("complete", 1, 1, result.identity.status)
        return result


@pytest.fixture()
def storage(tmp_path):
    return ResearchStorage(tmp_path)


def manager(engine, storage, **kw) -> JobManager:
    return JobManager(engine, storage, max_workers=kw.pop("max_workers", 2), **kw)


def test_submit_returns_a_queued_job_and_finishes_with_every_stage(storage):
    engine = FakeEngine(storage, gate_stage="analyzing")
    jobs = manager(engine, storage)
    created = jobs.submit(REQUEST)
    assert created.status == "queued" and created.stage == "validating" and created.result is None
    assert created.research_id.startswith("rs_") and created.request == REQUEST
    assert engine.entered.wait(30)
    running = jobs.get(created.research_id)
    assert running.status == "running" and running.stage == "analyzing" and running.result is None
    assert running.stage_history == list(C.STAGES[:5]) and jobs.active_count() == 1
    engine.release.set()
    done = jobs.wait(created.research_id, timeout=30)
    assert done.status == "complete" and done.stage == "complete" and done.stage_history == list(C.STAGES)
    assert done.progress.completed == 1 and done.progress.total == 1 and done.error is None
    assert done.result.identity.research_id == created.research_id and jobs.active_count() == 0
    assert engine.calls == [{"snapshot": "snap-TEST", "policy": "pol-TEST", "use_cache": True,
                             "research_id": created.research_id}]   # the job pinned its snapshots
    assert (done.snapshot_id, done.policy_snapshot_id) == ("snap-TEST", "pol-TEST")
    jobs.shutdown()


def test_partial_result_is_a_partial_job_not_a_failure(storage):
    jobs = manager(FakeEngine(storage, status="partial"), storage)
    done = jobs.wait(jobs.submit(REQUEST).research_id, timeout=30)
    assert done.status == "partial" and done.error is None and done.result is not None
    jobs.shutdown()


@pytest.mark.parametrize("error, code, retryable", [
    (AquaError("selector_unavailable", "TEST model down"), "selector_unavailable", True),
    (AquaError("invalid_context", "TEST conflict", fields=["context.preset_ref"]), "invalid_context", False),
    (RuntimeError("TEST secret path /srv/key"), "internal_error", True),
])
def test_errors_become_job_state_and_keep_the_request(storage, error, code, retryable):
    jobs = manager(FakeEngine(storage, outcome=error), storage)
    done = jobs.wait(jobs.submit(REQUEST).research_id, timeout=30)
    assert done.status == "failed" and done.result is None and done.request == REQUEST
    assert done.error.code == code and done.error.retryable is retryable
    assert "secret" not in done.error.message and done.stage == C.STAGES[-2]
    assert not storage.has_result(done.research_id)
    jobs.shutdown()


def test_reselect_and_switch_disable_the_cache_lookup(storage):
    engine = FakeEngine(storage)
    jobs = manager(engine, storage)
    again = REQUEST.model_copy(update={"options": C.RequestOptions(reselect=True)})
    jobs.wait(jobs.submit(again).research_id, timeout=30)
    assert engine.calls[-1]["use_cache"] is False
    jobs.shutdown()
    off = manager(engine, storage, use_cache=False)
    off.wait(off.submit(REQUEST).research_id, timeout=30)
    assert engine.calls[-1]["use_cache"] is False
    off.shutdown()


def test_cached_copy_is_marked_and_persisted_under_its_own_id(storage):
    def cached(research_id, request):
        return empty_result(research_id, request, cached_from="rs_original")

    jobs = manager(FakeEngine(storage, outcome=cached), storage)
    done = jobs.wait(jobs.submit(REQUEST).research_id, timeout=30)
    assert done.cache_hit is True and done.cached_from == "rs_original"
    assert "rs_original" in done.stage_detail and "cache" in done.stage_detail
    assert storage.load_result(done.research_id).identity.cached_from == "rs_original"
    jobs.shutdown()


def test_cancel_running_job_discards_whatever_the_worker_returns(storage):
    engine = FakeEngine(storage, gate_stage="analyzing")

    def ignores_cancel(research_id, request):                      # TEST: a worker that finishes anyway
        return empty_result(research_id, request)

    engine.outcome = ignores_cancel
    jobs = manager(engine, storage)
    created = jobs.submit(REQUEST)
    assert engine.entered.wait(30)
    cancelled = jobs.cancel(created.research_id)
    assert cancelled.status == "cancelled" and cancelled.cancel_requested and cancelled.result is None
    assert cancelled.error.code == "cancelled" and cancelled.request == REQUEST
    engine.release.set()
    after = jobs.wait(created.research_id, timeout=30)
    assert after.status == "cancelled" and after.result is None and after.stage == "analyzing"
    assert "complete" not in after.stage_history                   # late stage reports are ignored
    assert jobs.cancel(created.research_id).status == "cancelled"  # idempotent
    jobs.shutdown()


def test_cancel_queued_job_never_runs_it(storage):
    engine = FakeEngine(storage, gate_stage="validating")
    jobs = manager(engine, storage, max_workers=1)
    first = jobs.submit(REQUEST)
    assert engine.entered.wait(30)
    queued = jobs.submit(REQUEST)
    assert jobs.cancel(queued.research_id).status == "cancelled"
    engine.release.set()
    assert jobs.wait(first.research_id, timeout=30).status == "complete"
    assert jobs.wait(queued.research_id, timeout=30).status == "cancelled"
    assert [c["research_id"] for c in engine.calls] == [first.research_id]
    jobs.shutdown()


def test_cancel_finished_job_is_a_no_op_and_unknown_id_is_not_found(storage):
    jobs = manager(FakeEngine(storage), storage)
    done = jobs.wait(jobs.submit(REQUEST).research_id, timeout=30)
    same = jobs.cancel(done.research_id)
    assert same.status == "complete" and same.result is not None and same.cancel_requested is False
    for call in (jobs.get, jobs.cancel):
        with pytest.raises(AquaError) as excinfo:
            call("rs_unknown")
        assert excinfo.value.code == "not_found" and excinfo.value.http_status == 404
    with pytest.raises(AquaError) as excinfo:
        jobs.get("../../etc/passwd")
    assert excinfo.value.code == "not_found"
    jobs.shutdown()


def test_final_jobs_are_read_back_after_a_restart(storage):
    jobs = manager(FakeEngine(storage), storage)
    done = jobs.wait(jobs.submit(REQUEST).research_id, timeout=30)
    failing = manager(FakeEngine(storage, outcome=AquaError("selector_unavailable", "TEST down")), storage)
    failed = failing.wait(failing.submit(REQUEST).research_id, timeout=30)
    gated = FakeEngine(storage, gate_stage="analyzing")
    cancelling = manager(gated, storage)
    cancelled = cancelling.submit(REQUEST)
    assert gated.entered.wait(30)
    cancelling.cancel(cancelled.research_id)
    gated.release.set()
    for m in (jobs, failing, cancelling):
        m.shutdown(wait=True)

    restarted = manager(FakeEngine(storage), storage)              # a new process on the same directory
    again = restarted.get(done.research_id)
    assert again.status == "complete" and again.result == done.result and again.request == REQUEST
    assert again.stage_history == list(C.STAGES) and again.created_at == done.created_at
    assert restarted.get(done.research_id, include_result=False).result is None
    lost = restarted.get(failed.research_id)
    assert lost.status == "failed" and lost.error == failed.error and lost.result is None and lost.request == REQUEST
    stopped = restarted.get(cancelled.research_id)
    assert stopped.status == "cancelled" and stopped.result is None and stopped.cancel_requested is True
    restarted.shutdown()


def test_result_stored_without_a_job_record_is_served_as_a_finished_job(storage):
    """E.g. a result written by scripts/run_research.py."""
    research_id = new_research_id()
    storage.save_result(empty_result(research_id, REQUEST, "partial", parent_research_id="rs_parent"))
    jobs = manager(FakeEngine(storage), storage)
    job = jobs.get(research_id)
    assert job.status == "partial" and job.stage == "complete" and job.result.identity.research_id == research_id
    assert job.request.phenomenon_query == REQUEST.phenomenon_query and job.request.period == REQUEST.period
    assert job.request.context.parent_research_id == "rs_parent"
    jobs.shutdown()


def test_finished_jobs_are_evicted_from_memory_but_stay_readable(storage):
    jobs = manager(FakeEngine(storage), storage)
    ids = [jobs.submit(REQUEST).research_id for _ in range(JOBS_IN_MEMORY + 5)]
    for research_id in ids:
        jobs.wait(research_id, timeout=30)
    assert len(jobs._jobs) <= JOBS_IN_MEMORY
    assert jobs.get(ids[0]).status == "complete" and jobs.get(ids[0]).result is not None
    jobs.shutdown()


def test_without_storage_jobs_live_in_memory_only():
    jobs = JobManager(FakeEngine(None), None, max_workers=1)
    done = jobs.wait(jobs.submit(REQUEST).research_id, timeout=30)
    assert done.status == "complete" and jobs.engine.calls[-1]["use_cache"] is False
    with pytest.raises(AquaError):
        jobs.get("rs_unknown")
    jobs.shutdown()


def test_environment_settings():
    assert workers_from_env({}) == 2 and workers_from_env({"AQUA_JOB_WORKERS": "3"}) == 3
    for bad in ("0", "-1", "two"):
        with pytest.raises(ValueError):
            workers_from_env({"AQUA_JOB_WORKERS": bad})
    assert cache_enabled_from_env({}) is True and cache_enabled_from_env({"AQUA_RESULT_CACHE": "on"}) is True
    assert cache_enabled_from_env({"AQUA_RESULT_CACHE": "off"}) is False
    assert cache_enabled_from_env({"AQUA_RESULT_CACHE": "0"}) is False
