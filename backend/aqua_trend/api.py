"""HTTP API of the Earth System Trend Detective (spec §10; data contract §9).

Routes
    GET    /api/health
    GET    /api/catalogue                              concepts, phenomena notes, recipes, baselines, policies, status
    GET    /api/catalogue/regions                      compact list of every region (gzip, ETag)
    GET    /api/catalogue/regions/{region_id}          one region with per-product availability
    POST   /api/research                               validate + create a background job -> 202
    GET    /api/research/{research_id}                 job status, progress and the result when available
    DELETE /api/research/{research_id}                 cancel
    GET    /api/research/{research_id}/export          ?format=json|csv
    GET    /api/research/{research_id}/families/{id}   full stored evidence family, paged

Rules implemented here
- Every body goes through ``contracts.json_safe`` and is serialised with ``allow_nan=False``.
- Every error has the stable body ``{code, message, retryable, fields}`` (data contract §9.4);
  unexpected exceptions become ``internal_error`` without a stack trace.
- ``region_id`` and ``period`` are taken only from the structured request fields; a period with
  one end is ``invalid_period``; a valid region without data is a result state, not an error.
- The selector is never replaced silently: when no provider is configured and no saved plan of
  the same versions exists, ``POST /api/research`` answers 503 ``selector_unavailable`` and
  creates nothing (acceptance S07).
"""
from __future__ import annotations

import hashlib
import inspect
import json
import logging
import os
import shutil
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

import numpy as np
from fastapi import Body, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import contracts as C
from .engine import ENGINE_VERSION, ResearchEngine
from .errors import AquaError
from .indicators import IndicatorRegistry
from .jobs import INTERNAL_ERROR_MESSAGE, JobManager
from .selection import PROMPT_VERSION, CatalogueSnapshot, PhenomenonSelector, normalize_query, provider_from_env
from .selection.plans import ENV_PLAN_DIR, versions_key
from .selection.providers import ENV_SELECTOR
from .storage import ResearchStorage
from .store import PreparedDataStore
from .timeaxis import index_to_ym, is_ym, ym_to_index

log = logging.getLogger("aqua_trend.api")

API_VERSION = "api-1.0.0"
ENV_CORS = "AQUA_CORS_ORIGINS"
DEFAULT_CORS_ORIGINS: tuple[str, ...] = tuple(
    f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (3000, 3001, 5000))
#: transport limits (response size), not analysis policy
GZIP_MINIMUM_BYTES = 1024
FAMILY_PAGE_DEFAULT = 500
FAMILY_PAGE_MAX = 5000
EXPORT_FORMATS = ("json", "csv")
REGION_LIST_FIELDS = ("id", "name", "name_zh", "type", "centroid", "bbox", "area_km2", "surface",
                      "series_available", "n_products")
PHENOMENA_NOTE = ("Curated context notes used as input hints. They are not a whitelist: any phenomenon text may "
                  "be submitted, and the selector answers 'unsupported' when the catalogue has no documented basis.")


# --------------------------------------------------------------------------- wiring

def build_preset_engine(store: Any, storage: Any, engine: Any = None) -> Any:
    """The PresetEngine when ``aqua_trend.presets`` provides one, else ``None``.

    Without it a request with a blank region or period ends as ``no_matching_preset`` (a result
    state); nothing is invented in its place.  The constructor is called with whichever of
    ``store`` / ``storage`` / ``engine`` it declares, so this is the only line to touch when
    its signature settles.
    """
    try:
        from .presets import PresetEngine  # type: ignore[attr-defined]
    except ImportError:
        return None
    offered = {"store": store, "storage": storage, "engine": engine}
    parameters = inspect.signature(PresetEngine).parameters
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in parameters.values()):
        return PresetEngine(**offered)
    return PresetEngine(**{name: value for name, value in offered.items() if name in parameters})


def build_engine(store: Any, selector: Any, storage: Any, preset_engine: Any = None) -> ResearchEngine:
    """The one place where the research engine is assembled (API, tests and scripts)."""
    engine = ResearchEngine(store, selector, storage=storage)
    if preset_engine is None:
        preset_engine = build_preset_engine(store, storage, engine)
    engine.preset_engine = preset_engine
    bind = getattr(preset_engine, "bind", None)
    if callable(bind):
        bind(engine)
    return engine


def cors_origins_from_env(env: Optional[dict[str, str]] = None) -> list[str]:
    """``AQUA_CORS_ORIGINS``: comma-separated origins (``*`` allows any); default = local front-end ports."""
    raw = (os.environ if env is None else env).get(ENV_CORS)
    if not raw or not raw.strip():
        return list(DEFAULT_CORS_ORIGINS)
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


@dataclass
class AppContext:
    """Everything one app instance works with."""

    store: Any
    selector: Any
    storage: Any
    engine: ResearchEngine
    jobs: JobManager
    indicators: IndicatorRegistry
    _cache: dict[str, Any] = field(default_factory=dict)

    def cached(self, key: str, build: Any) -> Any:
        if key not in self._cache:
            self._cache[key] = build()
        return self._cache[key]


# --------------------------------------------------------------------------- responses

def json_response(payload: Any, status_code: int = 200, headers: Optional[dict[str, str]] = None) -> Response:
    """JSON body that can never contain NaN / Infinity (missing is ``null``)."""
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(mode="json")
    body = json.dumps(C.json_safe(payload), ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    return Response(content=body.encode("utf-8"), status_code=status_code,
                    media_type="application/json", headers=headers)


def error_response(code: str, message: str, status_code: int, *, retryable: bool = False,
                   fields: Optional[list[str]] = None) -> Response:
    """The stable error body of data contract §9.4."""
    return json_response(C.ApiError(code=code, message=message, retryable=retryable, fields=fields or []),
                         status_code)


def _not_ready(job: C.ResearchJob) -> AquaError:
    """Export / family of a research that has no result (still running, failed or cancelled)."""
    running = job.status in ("queued", "running")
    reason = "is still running" if running else f"ended as '{job.status}' without a result"
    exc = AquaError("result_not_ready", f"Research {job.research_id} {reason}; there is nothing to export.",
                    fields=["research_id"], retryable=running)
    exc.http_status = 409
    return exc


# --------------------------------------------------------------------------- selector status

def selector_status(selector: Any, store: Any) -> dict[str, Any]:
    """``{provider, is_language_model, available, ...}`` of the configured selector (never calls a model).

    ``available`` means "configured and startable"; a configured model can still be unreachable
    at call time, in which case the job fails with ``selector_unavailable``.
    """
    mode = (os.environ.get(ENV_SELECTOR) or "auto").strip().casefold()
    base = {"mode": mode, "prompt_version": PROMPT_VERSION}
    if not isinstance(selector, PhenomenonSelector):
        return {**base, "mode": "injected", "provider": type(selector).__name__, "model": None,
                "is_language_model": getattr(selector, "is_language_model", None), "available": True,
                "reason": None}
    provider = getattr(selector, "_provider", None)
    if provider is not None:
        base["mode"] = "injected"
    else:
        try:
            provider = provider_from_env(store)
        except AquaError as exc:
            return {**base, "provider": None, "model": None, "is_language_model": None, "available": False,
                    "reason": exc.message, "retryable": exc.retryable}
    available, reason = True, None
    executable = getattr(provider, "executable", None)
    if executable and shutil.which(executable) is None:
        available, reason = False, f"The '{executable}' CLI was not found on PATH."
    return {**base, "provider": provider.name, "model": getattr(provider, "model", None),
            "is_language_model": bool(provider.is_language_model), "available": available, "reason": reason}


def _has_saved_model_plan(selector: Any, store: Any, query: str) -> bool:
    """Is a saved language-model plan of the same catalogue / prompt versions available (S07)?"""
    plans = getattr(selector, "plans", None)
    if plans is None:
        return False
    snapshot = CatalogueSnapshot.from_store(store)
    key = versions_key(normalize_query(query), snapshot.catalogue_version, snapshot.indicator_registry_version,
                       PROMPT_VERSION)
    return plans.latest_for_versions(key, is_language_model=True) is not None


def check_selector(ctx: AppContext, request: C.ResearchRequest) -> None:
    """Refuse with 503 before any job exists when it is already known that no plan can be made."""
    if request.context.preset_ref is not None:
        return                                                      # the preset carries its saved plan
    if request.context.parent_research_id and not request.options.reselect:
        return                                                      # the job decides whether the parent plan applies
    status = selector_status(ctx.selector, ctx.store)
    if status["available"]:
        return
    if not request.options.reselect and _has_saved_model_plan(ctx.selector, ctx.store, request.phenomenon_query):
        return
    raise AquaError("selector_unavailable",
                    f"The variable selector is not available: {status['reason']} Your input is kept; nothing "
                    "was analysed and no stand-in selection was made. Try again later.",
                    retryable=status.get("retryable", True))


# --------------------------------------------------------------------------- request validation

def _period_from(raw: Any) -> Optional[C.Period]:
    """A complete ``{start, end}`` of YYYY-MM months, or ``None`` when the selection is cleared."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise AquaError("invalid_period", "A period is an object with a start and an end month (YYYY-MM).",
                        fields=["period"])
    start, end = raw.get("start"), raw.get("end")
    if start in (None, "") and end in (None, ""):
        return None
    missing = [f"period.{name}" for name, value in (("start", start), ("end", end)) if value in (None, "")]
    if missing:
        raise AquaError("invalid_period", "A period needs both a start and an end month; complete it or clear "
                                          "the whole selection.", fields=missing)
    bad = [f"period.{name}" for name, value in (("start", start), ("end", end)) if not is_ym(value)]
    if bad:
        raise AquaError("invalid_period", "Period months must be written YYYY-MM.", fields=bad)
    if ym_to_index(start) > ym_to_index(end):
        raise AquaError("invalid_period", "The period start is after its end.", fields=["period.start", "period.end"])
    return C.Period(start=start, end=end)


def _context_from(raw: Any) -> C.RequestContext:
    if raw is None:
        return C.RequestContext()
    if not isinstance(raw, dict):
        raise AquaError("invalid_context", "context must be an object.", fields=["context"])
    parent = raw.get("parent_research_id")
    if parent is not None and (not isinstance(parent, str) or not parent.strip()):
        raise AquaError("invalid_context", "context.parent_research_id must be a research id or null.",
                        fields=["context.parent_research_id"])
    ref = raw.get("preset_ref")
    preset_ref = None
    if ref is not None:
        if not isinstance(ref, dict) or not all(isinstance(ref.get(k), str) and ref.get(k) for k in ("id", "version")):
            raise AquaError("invalid_context", "context.preset_ref must be {id, version}.",
                            fields=["context.preset_ref"])
        preset_ref = C.PresetRef(id=ref["id"], version=ref["version"])
    return C.RequestContext(parent_research_id=parent, preset_ref=preset_ref)


def parse_research_request(body: Any, store: Any) -> C.ResearchRequest:
    """Validate the structured request (data contract §9.1); only known fields are kept.

    Numbers, sources or correction claims sent by a client are ignored: they are never part of
    the request the engine sees.
    """
    if not isinstance(body, dict):
        raise AquaError("invalid_request", "The request body must be a JSON object.", fields=["body"])
    query = body.get("phenomenon_query")
    if query is not None and not isinstance(query, str):
        raise AquaError("invalid_request", "phenomenon_query must be text.", fields=["phenomenon_query"])
    if query is None or not query.strip():
        raise AquaError("empty_query", "Describe a phenomenon to analyse.", fields=["phenomenon_query"])
    region_id = body.get("region_id")
    if region_id is not None:
        if not isinstance(region_id, str) or not region_id.strip():
            raise AquaError("unknown_region", "The region id is empty; select one region or leave it blank.",
                            fields=["region_id"])
        store.region(region_id)                                     # AquaError("unknown_region")
    options = body.get("options")
    if options is not None and not isinstance(options, dict):
        raise AquaError("invalid_request", "options must be an object.", fields=["options"])
    reselect = (options or {}).get("reselect", False)
    if not isinstance(reselect, bool):
        raise AquaError("invalid_request", "options.reselect must be true or false.", fields=["options.reselect"])
    return C.ResearchRequest(phenomenon_query=query, region_id=region_id, period=_period_from(body.get("period")),
                             context=_context_from(body.get("context")),
                             options=C.RequestOptions(reselect=reselect))


def check_context(ctx: AppContext, request: C.ResearchRequest) -> None:
    """References are loaded from the backend's own records; a conflict never overrides a user field."""
    context = request.context
    if context.parent_research_id:
        if ctx.storage is None or not ctx.storage.has_result(context.parent_research_id):
            raise AquaError("invalid_context", f"The parent research {context.parent_research_id} does not exist.",
                            fields=["context.parent_research_id"])
    ref = context.preset_ref
    if ref is None:
        return
    try:
        opener = getattr(ctx.engine.preset_engine, "open", None)
        preset = opener(ref).preset if callable(opener) else ctx.storage.load_preset(ref.id, ref.version)
    except AquaError as exc:
        if exc.code == "invalid_context":
            raise
        raise AquaError("invalid_context", f"The referenced preset {ref.id} (version {ref.version}) cannot be "
                                           f"loaded: {exc.message}", fields=["context.preset_ref"]) from exc
    if request.region_id is not None and request.region_id != preset.region_id:
        raise AquaError("invalid_context",
                        f"The opened preset is for region {preset.region_id}, but the selected region is "
                        f"{request.region_id}. The selection is kept; clear the preset reference to analyse it.",
                        fields=["context.preset_ref", "region_id"])
    if request.period is not None and (request.period.start, request.period.end) != \
            (preset.period.start, preset.period.end):
        raise AquaError("invalid_context",
                        f"The opened preset is for {preset.period.start}..{preset.period.end}, but the selected "
                        f"period is {request.period.start}..{request.period.end}. The selection is kept; clear "
                        "the preset reference to analyse it.", fields=["context.preset_ref", "period"])


# --------------------------------------------------------------------------- catalogue payloads

def _pick(source: dict, keys: Iterable[str]) -> dict[str, Any]:
    return {k: source.get(k) for k in keys}


def _ref(store: Any, ref_id: str) -> dict[str, Any]:
    ref = store.refs().get(ref_id)
    if ref is None:
        return {"ref_id": ref_id, "title": None, "missing": True}
    return _pick(ref, ("ref_id", "title", "authors", "year", "source", "url", "doi", "applies_to",
                       "curated_version"))


def _product(store: Any, product: dict, baseline_ref: dict[str, str], per_product: dict[str, int]) -> dict[str, Any]:
    out = _pick(product, ("product_id", "agency", "product_name", "version", "unit", "physical_definition",
                          "definition_class", "native_resolution", "prepared_resolution", "temporal_support",
                          "cadence", "calendar", "quality_limits", "caveat", "caveat_zh", "nasa", "family",
                          "start", "end", "approved", "priority_rank", "status", "status_reason"))
    out["is_primary"] = bool(product.get("approved")) and product.get("priority_rank") == 1
    out["baseline_id"] = baseline_ref.get(product["product_id"])
    out["regions_with_series"] = per_product.get(product["product_id"], 0)
    out["refs"] = [_ref(store, r) for r in product.get("source_refs") or []]
    return out


def _concept(store: Any, concept: dict, per_product: dict[str, int]) -> dict[str, Any]:
    variable_id = concept["variable_id"]
    baseline_ref = concept.get("baseline_ref") or {}
    order = {pid: i for i, pid in enumerate(concept.get("approved_product_ids") or [])}
    products = [p for p in store.products().values() if p.get("variable_id") == variable_id]
    products.sort(key=lambda p: (order.get(p["product_id"], len(order)), p["product_id"]))
    out = _pick(concept, ("variable_id", "label", "label_zh", "description", "unit", "quantity_definition",
                          "temporal_support", "data_kind", "approved_product_ids", "product_order_reason",
                          "baseline_ref", "relative_change", "display_semantics"))
    out["products"] = [_product(store, p, baseline_ref, per_product) for p in products]
    out["refs"] = [_ref(store, r) for r in concept.get("scientific_refs") or []]
    return out


def _phenomenon(note: dict) -> dict[str, Any]:
    out = _pick(note, ("phenomenon_id", "label", "label_zh", "aliases", "description", "indicator_ids",
                       "unanswerable_notes"))
    out["variable_links"] = [_pick(link, ("variable_id", "role", "statement", "limits", "ref_ids"))
                             for link in note.get("variable_links") or []]
    return out


def _recipe(ctx: AppContext, recipe: dict) -> dict[str, Any]:
    out = _pick(recipe, ("indicator_id", "version", "family", "kind", "label", "label_zh",
                         "phenomenon_applicability", "standard_refs", "required_variables",
                         "baseline_requirements", "interpretation"))
    try:
        out["requirements"] = ctx.indicators.requirements(recipe["indicator_id"])
    except AquaError as exc:
        out["requirements"] = None
        out["requirements_problem"] = exc.message
    return out


def _static_catalogue(ctx: AppContext) -> dict[str, Any]:
    """Everything of ``GET /api/catalogue`` that is fixed for the loaded release."""
    store, manifest = ctx.store, ctx.store.manifest
    per_product = manifest["series_index"].get("regions_per_product", {})
    by_type: dict[str, dict[str, int]] = {}
    for region in store.regions().values():
        entry = by_type.setdefault(region["type"], {"total": 0, "with_series": 0})
        entry["total"] += 1
        entry["with_series"] += 1 if region["series_available"] else 0
    return {
        "api_version": API_VERSION,
        "versions": {**store.versions, "engine_version": ENGINE_VERSION, "prompt_version": PROMPT_VERSION},
        "snapshot_id": ctx.engine.catalogue_snapshot(),
        "policy_snapshot_id": ctx.engine.policy_snapshot(),
        "concepts": [_concept(store, c, per_product) for c in store.concepts().values()],
        "phenomena": [_phenomenon(p) for p in store.phenomena()],
        "phenomena_note": PHENOMENA_NOTE,
        "indicators": [_recipe(ctx, r) for r in store.indicator_recipes().values()],
        "event_catalogues": store.event_catalogues(),
        "baselines": manifest["baselines"],
        "regions": {
            "total": manifest["series_index"]["regions_total"],
            "with_series": manifest["series_index"]["regions_with_series"],
            "by_type": by_type,
            "list_url": "/api/catalogue/regions",
            "region_catalogue_version": store.versions["region_catalogue_version"],
        },
        "dataset": manifest.get("dataset", {}),
        "asset_status": manifest["asset_status"],
        "product_status": manifest.get("product_status", {}),
        "policies": {name: store.policy(name) for name in ("method_policy", "preset_policy", "quality_policy")},
        "presets": {"engine_available": ctx.engine.preset_engine is not None},
        "job_stages": list(C.STAGES),
    }


def _region_list(ctx: AppContext) -> tuple[bytes, str]:
    """Serialised region list and its ETag (keyed on region catalogue + dataset version)."""
    store = ctx.store
    versions = _pick(store.versions, ("region_catalogue_version", "dataset_version"))
    regions = [_pick(r, REGION_LIST_FIELDS) for r in store.regions().values()]
    payload = {**versions, "count": len(regions), "fields": list(REGION_LIST_FIELDS), "regions": regions}
    body = json.dumps(C.json_safe(payload), ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    digest = hashlib.sha256("|".join(versions.values()).encode()).hexdigest()[:20]
    return body, f'"regions-{digest}"'


def _etag_matches(header: Optional[str], etag: str) -> bool:
    if not header:
        return False
    candidates = [item.strip() for item in header.split(",")]
    return "*" in candidates or any(c.removeprefix("W/") == etag for c in candidates)


def _product_availability(store: Any, region_id: str, product: dict) -> dict[str, Any]:
    """Availability and actual period of one product in one region; nothing is substituted."""
    product_id = product["product_id"]
    status, reason = store.series_status(region_id, product_id)
    out: dict[str, Any] = {
        **_pick(product, ("product_id", "variable_id", "approved", "priority_rank", "unit", "cadence")),
        "status": status, "status_reason": reason, "record_period": None, "valid_period": None,
        "n_valid": 0, "n_expected": 0, "baseline": None,
    }
    if status != "ok":
        return out
    series = store.series(region_id, product_id)
    valid = np.isfinite(series.values)
    when = series.t[valid]
    out["record_period"] = {"start": index_to_ym(int(series.t[0])), "end": index_to_ym(int(series.t[-1]))}
    out["n_valid"], out["n_expected"] = int(valid.sum()), int(series.t.size)
    if when.size:
        out["valid_period"] = {"start": index_to_ym(int(when[0])), "end": index_to_ym(int(when[-1]))}
    out["baseline"] = store.baseline_support(region_id, product_id)
    return out


def region_detail(store: Any, region_id: str) -> dict[str, Any]:
    """One region with the availability of every registered product (``unknown_region`` -> 404)."""
    try:
        region = store.region(region_id)
    except AquaError as exc:
        raise AquaError("not_found", exc.message, fields=["region_id"]) from exc
    listed = set(store.available_products(region_id))
    products = [_product_availability(store, region_id, p) for p in store.products().values()
                if p["product_id"] in listed or p.get("status") != "ok"]
    variables = sorted({p["variable_id"] for p in products if p["status"] == "ok" and p.get("approved")})
    note = None
    if not region["series_available"]:
        note = ("This region has a boundary but no prepared series. A research on it returns 'no_series' item "
                "states; no parent basin or neighbouring region is substituted.")
    return {**region, **_pick(store.versions, ("region_catalogue_version", "dataset_version")),
            "products": products, "analysable_variable_ids": variables, "note": note}


# --------------------------------------------------------------------------- app factory

def create_app(store: Any = None, selector: Any = None, *, storage: Any = None, engine: Any = None,
               preset_engine: Any = None, cors_origins: Optional[list[str]] = None,
               max_workers: Optional[int] = None, use_cache: Optional[bool] = None) -> FastAPI:
    """Build the FastAPI app.

    ``store=None`` opens the prepared release (strict); ``selector=None`` builds a
    ``PhenomenonSelector`` that resolves its provider from ``AQUA_SELECTOR`` on every call —
    there is no default stand-in.  Tests inject a store, a selector and a temporary storage.
    """
    store = store if store is not None else PreparedDataStore.open()
    storage = storage if storage is not None else ResearchStorage()
    if selector is None:                                            # plans live beside results unless AQUA_PLAN_DIR is set
        selector = PhenomenonSelector(store, plan_dir=os.environ.get(ENV_PLAN_DIR) or storage.root / "plans")
    engine = engine if engine is not None else build_engine(store, selector, storage, preset_engine)
    jobs = JobManager(engine, storage, max_workers=max_workers, use_cache=use_cache)
    ctx = AppContext(store=store, selector=selector, storage=storage, engine=engine, jobs=jobs,
                     indicators=engine.indicators)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        jobs.shutdown(wait=False)

    app = FastAPI(title="Earth System Trend Detective API", version=API_VERSION, lifespan=lifespan)
    app.state.ctx = ctx

    @app.middleware("http")
    async def no_stack_trace(request: Request, call_next: Any) -> Response:
        """Innermost guard, so an unexpected error still gets the stable body (and CORS headers)."""
        try:
            return await call_next(request)
        except Exception as exc:                                    # noqa: BLE001 - reported, never leaked
            log.error("unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
            return error_response("internal_error", INTERNAL_ERROR_MESSAGE, 500, retryable=True)

    app.add_middleware(GZipMiddleware, minimum_size=GZIP_MINIMUM_BYTES)
    origins = cors_origins if cors_origins is not None else cors_origins_from_env()
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
                       allow_headers=["*"], expose_headers=["ETag", "Content-Disposition"])
    _add_error_handlers(app)
    _add_catalogue_routes(app, ctx)
    _add_research_routes(app, ctx)
    return app


def _add_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AquaError)
    async def aqua_error(_: Request, exc: AquaError) -> Response:
        return json_response(exc.to_api(), exc.http_status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> Response:
        fields = [".".join(str(part) for part in err.get("loc", ())[1:]) or "body" for err in exc.errors()]
        return error_response("invalid_request", "The request could not be read; check the listed fields.",
                              422, fields=sorted(set(fields)))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> Response:
        if exc.status_code == 404:
            return error_response("not_found", "This address does not exist.", 404)
        if exc.status_code >= 500:
            return error_response("internal_error", INTERNAL_ERROR_MESSAGE, exc.status_code, retryable=True)
        return error_response("invalid_request", str(exc.detail), exc.status_code)

    @app.exception_handler(Exception)
    async def unexpected(_: Request, exc: Exception) -> Response:
        log.error("unhandled error", exc_info=exc)
        return error_response("internal_error", INTERNAL_ERROR_MESSAGE, 500, retryable=True)


def _add_catalogue_routes(app: FastAPI, ctx: AppContext) -> None:
    @app.get("/api/health")
    def health() -> Response:
        return json_response({
            "status": "ok", "api_version": API_VERSION, "engine_version": ENGINE_VERSION,
            "snapshot_id": ctx.engine.catalogue_snapshot(), "policy_snapshot_id": ctx.engine.policy_snapshot(),
            "versions": ctx.store.versions, "selector": selector_status(ctx.selector, ctx.store),
            "presets": {"engine_available": ctx.engine.preset_engine is not None},
            "jobs": {"active": ctx.jobs.active_count(), "workers": ctx.jobs.max_workers,
                     "result_cache": ctx.jobs.use_cache},
        })

    @app.get("/api/catalogue")
    def catalogue() -> Response:
        static = ctx.cached("catalogue", lambda: _static_catalogue(ctx))
        return json_response({**static, "selector": selector_status(ctx.selector, ctx.store)})

    @app.get("/api/catalogue/regions")
    def regions(request: Request) -> Response:
        body, etag = ctx.cached("regions", lambda: _region_list(ctx))
        headers = {"ETag": etag, "Cache-Control": "public, no-cache"}
        if _etag_matches(request.headers.get("if-none-match"), etag):
            return Response(status_code=304, headers=headers)
        return Response(content=body, media_type="application/json", headers=headers)

    @app.get("/api/catalogue/regions/{region_id}")
    def region(region_id: str) -> Response:
        return json_response(region_detail(ctx.store, region_id))


def _add_research_routes(app: FastAPI, ctx: AppContext) -> None:
    def result_of(research_id: str) -> C.ResearchResult:
        job = ctx.jobs.get(research_id)
        if job.result is None:
            raise _not_ready(job)
        return job.result

    @app.post("/api/research", status_code=202)
    def create_research(body: Any = Body(default=None)) -> Response:
        request = parse_research_request(body, ctx.store)
        check_context(ctx, request)
        check_selector(ctx, request)
        job = ctx.jobs.submit(request)
        return json_response(job, 202, headers={"Location": f"/api/research/{job.research_id}"})

    @app.get("/api/research/{research_id}")
    def get_research(research_id: str, include_result: bool = True) -> Response:
        return json_response(ctx.jobs.get(research_id, include_result=include_result))

    @app.delete("/api/research/{research_id}")
    def cancel_research(research_id: str) -> Response:
        return json_response(ctx.jobs.cancel(research_id))

    @app.get("/api/research/{research_id}/export")
    def export_research(research_id: str, format: str = "json") -> Response:  # noqa: A002 - contract name
        if format not in EXPORT_FORMATS:
            raise AquaError("invalid_request", f"format must be one of {', '.join(EXPORT_FORMATS)}.",
                            fields=["format"])
        result = result_of(research_id)
        presenter = ctx.engine.presenter
        text = presenter.export_json(result) if format == "json" else presenter.export_csv(result)
        media = "application/json" if format == "json" else "text/csv; charset=utf-8"
        name = f"aqua-trend-{result.identity.research_id}.{format}"
        return Response(content=text.encode("utf-8"), media_type=media,
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.get("/api/research/{research_id}/families/{family_id}")
    def family(research_id: str, family_id: str, offset: int = 0, limit: int = FAMILY_PAGE_DEFAULT) -> Response:
        if offset < 0 or not 1 <= limit <= FAMILY_PAGE_MAX:
            raise AquaError("invalid_request", f"offset must be >= 0 and limit between 1 and {FAMILY_PAGE_MAX}.",
                            fields=["offset", "limit"])
        result = result_of(research_id)
        if not any(f.family_id == family_id for f in result.evidence_families):
            raise AquaError("not_found", f"Research {research_id} has no evidence family {family_id}.",
                            fields=["family_id"])
        full = ctx.storage.load_family(family_id)                   # verified complete record
        page = full.hypotheses[offset:offset + limit]
        document = full.model_dump(mode="json", exclude={"hypotheses"})
        end = offset + len(page)
        return json_response({
            **document, "hypotheses": [h.model_dump(mode="json") for h in page], "hypotheses_truncated": False,
            "page": {"offset": offset, "limit": limit, "returned": len(page), "total": len(full.hypotheses),
                     "next_offset": end if end < len(full.hypotheses) else None},
        })
