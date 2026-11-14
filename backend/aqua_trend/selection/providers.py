"""Model providers for the phenomenon selector (spec §4 "replaceable provider interface").

A provider turns (system prompt, user prompt, JSON schema) into one parsed JSON object.
It does NOT validate catalogue ids; ``validate.py`` does that for every provider.

Providers
- ``AnthropicProvider``: Anthropic Messages API (official SDK when importable, raw HTTP otherwise).
- ``ClaudeCliProvider``: opt-in, shells out to the ``claude`` CLI in print mode.
- ``CatalogueLexicalProvider``: explicit, deterministic catalogue matcher. It is NOT a language
  model, says so (``is_language_model = False``) and is used only when it is asked for by name.

``provider_from_env`` never falls back silently from a model to the lexical matcher (S07).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import unicodedata
from typing import Any, Mapping, Protocol, runtime_checkable

from ..errors import AquaError
from .prompt import ROLES, extract_query
from .snapshot import CONCEPT_REF_PREFIX, CatalogueSnapshot, flat_aliases

ENV_SELECTOR = "AQUA_SELECTOR"
ENV_MODEL = "AQUA_SELECTOR_MODEL"
ENV_EFFORT = "AQUA_SELECTOR_EFFORT"
ENV_TIMEOUT = "AQUA_SELECTOR_TIMEOUT_S"
ENV_FALLBACKS = "AQUA_SELECTOR_FALLBACKS"
ENV_API_KEY = "ANTHROPIC_API_KEY"
ENV_CLI_PATH = "AQUA_CLAUDE_CLI"

SELECTOR_MODES: tuple[str, ...] = ("auto", "anthropic", "claude_cli", "catalogue_lexical")

#: operational defaults (not scientific policy); every one can be overridden from the environment
DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5"
DEFAULT_EFFORT = "medium"
DEFAULT_TIMEOUT_S = 120.0
DEFAULT_MAX_TOKENS = 16000
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_API_VERSION = "2023-06-01"
#: server-side refusal fallback (routes a safety-classifier decline to another model)
FALLBACK_BETA = "server-side-fallback-2026-07-01"
FALLBACK_MODELS: frozenset[str] = frozenset({
    "claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5",
})
_OFF = frozenset({"off", "none", "0", "false", ""})


class ProviderUnavailable(Exception):
    """The provider is not configured or could not be reached (retryable; S07)."""


class ProviderOutputError(Exception):
    """The provider answered, but not with one usable JSON object (S06)."""


@runtime_checkable
class ModelProvider(Protocol):
    """Anything that can answer the selector prompt with a JSON object."""

    name: str
    model: str | None
    is_language_model: bool

    def complete(self, system: str, user: str, schema: dict) -> dict:
        """Return the parsed JSON answer. Raise ProviderUnavailable / ProviderOutputError."""
        ...


def _parse_json_object(text: str, source: str) -> dict:
    """Parse one JSON object; tolerate a Markdown code fence around it."""
    body = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", body, flags=re.DOTALL)
    if fence:
        body = fence.group(1)
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ProviderOutputError(f"{source} did not return valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ProviderOutputError(f"{source} returned JSON that is not an object.")
    return parsed


def _timeout_from_env(env: Mapping[str, str]) -> float:
    raw = env.get(ENV_TIMEOUT)
    if not raw:
        return DEFAULT_TIMEOUT_S
    try:
        value = float(raw)
    except ValueError as exc:
        raise AquaError("selector_unavailable", f"{ENV_TIMEOUT}={raw!r} is not a number of seconds.",
                        retryable=False) from exc
    if value <= 0:
        raise AquaError("selector_unavailable", f"{ENV_TIMEOUT} must be positive.", retryable=False)
    return value


# --------------------------------------------------------------------------- Anthropic

class AnthropicProvider:
    """Anthropic Messages API with a JSON-schema constrained answer.

    The API key is read from the environment only. The request uses structured outputs
    (``output_config.format``), so the answer is one JSON object that matches the schema;
    the catalogue-heavy system prompt is marked cacheable.
    """

    name = "anthropic"
    is_language_model = True

    def __init__(self, *, api_key: str | None = None, model: str | None = None,
                 effort: str | None = DEFAULT_EFFORT, timeout_s: float = DEFAULT_TIMEOUT_S,
                 max_tokens: int = DEFAULT_MAX_TOKENS, refusal_fallbacks: bool = True,
                 client: Any = None) -> None:
        self._api_key = api_key if api_key is not None else os.environ.get(ENV_API_KEY)
        self.model: str | None = model or os.environ.get(ENV_MODEL) or DEFAULT_ANTHROPIC_MODEL
        self.effort = effort
        self.timeout_s = timeout_s
        self.max_tokens = max_tokens
        self.refusal_fallbacks = refusal_fallbacks
        self._client = client
        #: model that actually produced the last answer (differs after a refusal fallback)
        self.served_model: str | None = None

    def _request(self, system: str, user: str, schema: dict) -> tuple[dict[str, Any], list[str]]:
        """Request body and beta flags shared by the SDK and the raw HTTP path."""
        output_config: dict[str, Any] = {"format": {"type": "json_schema", "schema": schema}}
        if self.effort:
            output_config["effort"] = self.effort
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": user}],
            "output_config": output_config,
        }
        betas: list[str] = []
        if self.refusal_fallbacks and self.model in FALLBACK_MODELS:
            body["fallbacks"] = "default"
            betas.append(FALLBACK_BETA)
        return body, betas

    def complete(self, system: str, user: str, schema: dict) -> dict:
        if not self._api_key and self._client is None:
            raise ProviderUnavailable(f"{ENV_API_KEY} is not set; the Anthropic selector is not configured.")
        body, betas = self._request(system, user, schema)
        try:
            import anthropic  # noqa: F401
        except ImportError:
            message = self._complete_http(body, betas)
        else:
            message = self._complete_sdk(body, betas)
        return self._parse(message)

    def _complete_sdk(self, body: dict[str, Any], betas: list[str]) -> dict[str, Any]:
        import anthropic

        client = self._client or anthropic.Anthropic(api_key=self._api_key, timeout=self.timeout_s)
        try:
            if betas:
                response = client.beta.messages.create(betas=betas, **body)
            else:
                response = client.messages.create(**body)
        except anthropic.AuthenticationError as exc:
            raise ProviderUnavailable(f"Anthropic rejected the API key: {exc.message}") from exc
        except anthropic.PermissionDeniedError as exc:
            raise ProviderUnavailable(f"The API key may not use model {self.model}: {exc.message}") from exc
        except anthropic.NotFoundError as exc:
            raise ProviderUnavailable(f"Model {self.model!r} was not found: {exc.message}") from exc
        except anthropic.BadRequestError as exc:
            raise ProviderUnavailable(f"Anthropic rejected the selector request: {exc.message}") from exc
        except anthropic.RateLimitError as exc:
            raise ProviderUnavailable(f"Anthropic rate limit reached: {exc.message}") from exc
        except anthropic.APIStatusError as exc:
            raise ProviderUnavailable(f"Anthropic API error {exc.status_code}: {exc.message}") from exc
        except anthropic.APITimeoutError as exc:
            raise ProviderUnavailable(f"The Anthropic API did not answer within {self.timeout_s:g} s.") from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderUnavailable(f"Could not reach the Anthropic API: {exc}") from exc
        except anthropic.APIError as exc:   # any other SDK-reported failure of the call
            raise ProviderUnavailable(f"The Anthropic API call failed: {exc}") from exc
        return response.to_dict()

    def _complete_http(self, body: dict[str, Any], betas: list[str]) -> dict[str, Any]:
        """Raw HTTP path, used only when the ``anthropic`` package is not installed."""
        import httpx

        headers = {
            "x-api-key": self._api_key or "",
            "anthropic-version": ANTHROPIC_API_VERSION,
            "content-type": "application/json",
        }
        if betas:
            headers["anthropic-beta"] = ",".join(betas)
        try:
            response = httpx.post(ANTHROPIC_API_URL, headers=headers, json=body, timeout=self.timeout_s)
        except httpx.TimeoutException as exc:
            raise ProviderUnavailable(f"The Anthropic API did not answer within {self.timeout_s:g} s.") from exc
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(f"Could not reach the Anthropic API: {exc}") from exc
        if response.status_code != 200:
            raise ProviderUnavailable(f"Anthropic API error {response.status_code}: {response.text[:300]}")
        try:
            return response.json()
        except ValueError as exc:
            raise ProviderOutputError("The Anthropic API returned a non-JSON response.") from exc

    def _parse(self, message: Mapping[str, Any]) -> dict:
        """Check the stop reason before reading content, then parse the JSON text block."""
        self.served_model = message.get("model") or self.model
        stop_reason = message.get("stop_reason")
        if stop_reason == "refusal":
            details = message.get("stop_details") or {}
            raise ProviderOutputError(
                f"The model declined the selector request (category: {details.get('category')}).")
        if stop_reason == "max_tokens":
            raise ProviderOutputError("The model answer was cut off at the output token limit.")
        for block in message.get("content") or []:
            if block.get("type") == "text":
                return _parse_json_object(block.get("text") or "", "The model")
        raise ProviderOutputError("The model answer contained no text block.")


# --------------------------------------------------------------------------- Claude CLI

class ClaudeCliProvider:
    """Opt-in provider that runs the ``claude`` CLI in print mode with JSON output.

    The command is an argument vector (no shell); the user's text goes in on stdin, so it
    is never interpolated into a command line. All built-in tools are disabled.
    """

    name = "claude_cli"
    is_language_model = True

    def __init__(self, *, model: str | None = None, executable: str | None = None,
                 timeout_s: float = DEFAULT_TIMEOUT_S, runner: Any = None) -> None:
        self.model: str | None = model or os.environ.get(ENV_MODEL) or None
        self.executable = executable or os.environ.get(ENV_CLI_PATH) or "claude"
        self.timeout_s = timeout_s
        self._runner = runner or subprocess.run
        self.served_model: str | None = None

    def _argv(self, path: str, system: str, schema: dict) -> list[str]:
        argv = [
            path, "--print", "--output-format", "json", "--tools", "",
            "--system-prompt", system,
            "--json-schema", json.dumps(schema, ensure_ascii=False),
        ]
        if self.model:
            argv += ["--model", self.model]
        return argv

    def complete(self, system: str, user: str, schema: dict) -> dict:
        path = shutil.which(self.executable)
        if path is None:
            raise ProviderUnavailable(f"The '{self.executable}' CLI was not found on PATH.")
        try:
            done = self._runner(self._argv(path, system, schema), input=user, capture_output=True,
                                text=True, timeout=self.timeout_s, check=False)
        except subprocess.TimeoutExpired as exc:
            raise ProviderUnavailable(f"The claude CLI did not answer within {self.timeout_s:g} s.") from exc
        except OSError as exc:
            raise ProviderUnavailable(f"The claude CLI could not be started: {exc}") from exc
        if done.returncode != 0:
            detail = (done.stderr or done.stdout or "").strip()[:300]
            raise ProviderUnavailable(f"The claude CLI exited with status {done.returncode}: {detail}")
        return self._parse(done.stdout)

    def _parse(self, stdout: str) -> dict:
        envelope = _parse_json_object(stdout, "The claude CLI")
        if envelope.get("is_error"):
            raise ProviderUnavailable(f"The claude CLI reported an error: {str(envelope.get('result'))[:300]}")
        usage = envelope.get("modelUsage")
        if isinstance(usage, dict) and len(usage) == 1:
            self.served_model = next(iter(usage))
        structured = envelope.get("structured_output")
        if isinstance(structured, dict):
            return structured
        result = envelope.get("result")
        if not isinstance(result, str):
            raise ProviderOutputError("The claude CLI output has no result text.")
        return _parse_json_object(result, "The claude CLI")


# --------------------------------------------------------------------------- lexical matcher

_YEAR = re.compile(r"(?<!\d)(?:1[89]\d{2}|20\d{2})(?:-(?:0[1-9]|1[0-2]))?(?!\d)")
_CJK = re.compile(r"[㐀-鿿]")


def _norm(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def _mentions(text: str, term: str) -> bool:
    """True when ``term`` occurs in ``text`` (both normalised).

    ASCII terms must stand as whole words (a trailing plural s/es is allowed); other
    scripts, which have no word spaces, match as substrings.
    """
    if not term:
        return False
    if term not in text:
        return False
    if term.isascii():
        return re.search(rf"(?<![a-z0-9]){re.escape(term)}(?:e?s)?(?![a-z0-9])", text) is not None
    return term in text


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    return [str(v) for v in value if str(v).strip()]


class CatalogueLexicalProvider:
    """Deterministic matcher over catalogue wording. No model, no inference of meaning.

    Rule: a curated phenomenon note is selected when its label, Chinese label or one of its
    aliases appears in the text; its documented variable links, roles, statements, limits
    and indicator ids are copied. When no note matches, catalogue variables whose own label
    appears in the text are selected as the quantities the text names, and the answer is
    ``partial``. When nothing matches, the answer is ``unsupported_phenomenon`` with an
    empty variable set. Years and region-catalogue names found in the text are reported in
    ``ignored_text_constraints`` and never used.
    """

    name = "catalogue_lexical"
    model: str | None = None
    is_language_model = False

    def __init__(self, catalogue: Any) -> None:
        """``catalogue`` is a CatalogueSnapshot or a PreparedDataStore (re-read on each call)."""
        self._catalogue = catalogue

    def _snapshot(self) -> CatalogueSnapshot:
        if isinstance(self._catalogue, CatalogueSnapshot):
            return self._catalogue
        return CatalogueSnapshot.from_store(self._catalogue)

    def complete(self, system: str, user: str, schema: dict) -> dict:
        snapshot = self._snapshot()
        query = extract_query(user)
        text = _norm(query)
        use_zh = bool(_CJK.search(query))
        ignored = self._ignored_constraints(query, text, snapshot)
        notes = [n for n in snapshot.phenomena if self._note_matches(text, n)]
        named = [v for v, c in sorted(snapshot.concepts.items()) if self._concept_named(text, c)]
        if notes:
            answer = self._from_notes(notes, named, snapshot, use_zh)
        elif named:
            answer = self._from_named_concepts(named, snapshot, use_zh)
        else:
            answer = self._unsupported(query)
        answer["ignored_text_constraints"] = ignored
        return answer

    @staticmethod
    def _note_matches(text: str, note: Mapping[str, Any]) -> bool:
        terms = [note.get("label"), note.get("label_zh"), *flat_aliases(note.get("aliases"))]
        return any(_mentions(text, _norm(t)) for t in terms if isinstance(t, str))

    @staticmethod
    def _concept_named(text: str, concept: Mapping[str, Any]) -> bool:
        terms = [concept.get("label"), concept.get("label_zh")]
        return any(_mentions(text, _norm(t)) for t in terms if isinstance(t, str))

    @staticmethod
    def _ignored_constraints(query: str, text: str, snapshot: CatalogueSnapshot) -> list[str]:
        found = [m.group(0) for m in _YEAR.finditer(unicodedata.normalize("NFKC", query))]
        found += [name for name in snapshot.region_names if _mentions(text, _norm(name))]
        return list(dict.fromkeys(found))

    @staticmethod
    def _label(entry: Mapping[str, Any], use_zh: bool, default: str) -> str:
        zh, en = entry.get("label_zh"), entry.get("label")
        return str((zh if use_zh and zh else en) or zh or default)

    def _from_notes(self, notes: list[Mapping[str, Any]], named: list[str],
                    snapshot: CatalogueSnapshot, use_zh: bool) -> dict:
        """Copy the documented links of every matched note; report what the note cannot answer."""
        variables: dict[str, dict] = {}
        recipes: list[str] = []
        unanswerable: list[str] = []
        for note in notes:
            note_id = str(note.get("phenomenon_id"))
            for link in note.get("variable_links") or []:
                variable_id = link.get("variable_id")
                if variable_id not in snapshot.concepts or link.get("role") not in ROLES:
                    unanswerable.append(
                        f"Catalogue note '{note_id}' links '{variable_id}', which is not a usable "
                        "variable in the current catalogue.")
                    continue
                if variable_id in variables:
                    continue
                reason = str(link.get("statement") or "").strip()
                if link.get("limits"):
                    reason = f"{reason} Limits: {str(link['limits']).strip()}".strip()
                refs = [r for r in _as_list(link.get("ref_ids")) if r in snapshot.refs] + [note_id]
                variables[variable_id] = {
                    "variable_id": variable_id, "role": link["role"], "reason": reason, "catalogue_refs": refs,
                }
            for indicator_id in _as_list(note.get("indicator_ids")):
                if indicator_id in snapshot.recipes:
                    recipes.append(indicator_id)
                else:
                    unanswerable.append(
                        f"Catalogue note '{note_id}' names indicator '{indicator_id}', which is not registered.")
            unanswerable += _as_list(note.get("unanswerable_notes"))
        extra = [v for v in named if v not in variables]
        if extra:
            unanswerable.append(
                "The text also names catalogue variable(s) " + ", ".join(extra) + "; the catalogue "
                "matcher has no documented role for them in this phenomenon, so they were not added.")
        if not variables:
            status, recipes = "unsupported_phenomenon", []
        else:
            status = "partial" if unanswerable else "ok"
        label = " + ".join(self._label(n, use_zh, str(n.get("phenomenon_id"))) for n in notes)
        return {
            "phenomenon_label": label, "status": status, "variable_set": list(variables.values()),
            "indicator_recipe_ids": list(dict.fromkeys(recipes)),
            "unanswerable": list(dict.fromkeys(unanswerable)),
        }

    def _from_named_concepts(self, named: list[str], snapshot: CatalogueSnapshot, use_zh: bool) -> dict:
        """No note matched: select only the variables the text names, and say so."""
        variables = []
        for variable_id in named:
            concept = snapshot.concepts[variable_id]
            refs = [CONCEPT_REF_PREFIX + variable_id]
            refs += [r for r in _as_list(concept.get("scientific_refs")) if r in snapshot.refs]
            description = str(concept.get("description") or "").strip()
            variables.append({
                "variable_id": variable_id, "role": "core_indicator",
                "reason": f"The text names this catalogue variable directly. Catalogue description: {description}",
                "catalogue_refs": refs,
            })
        label = " + ".join(self._label(snapshot.concepts[v], use_zh, v) for v in named)
        return {
            "phenomenon_label": label, "status": "partial", "variable_set": variables,
            "indicator_recipe_ids": [],
            "unanswerable": [
                "No curated phenomenon note matches this text. Only the variables named in the text were "
                "selected; related conditions, responses and phenomenon indicators were not assessed, "
                "because the catalogue matcher compares wording and does not interpret meaning.",
            ],
        }

    @staticmethod
    def _unsupported(query: str) -> dict:
        return {
            "phenomenon_label": query.strip(), "status": "unsupported_phenomenon", "variable_set": [],
            "indicator_recipe_ids": [],
            "unanswerable": [
                "No catalogue phenomenon note or variable label matches this text. The catalogue matcher "
                "compares wording only; a language-model selector may still find a documented basis.",
            ],
        }


# --------------------------------------------------------------------------- configuration

def provider_from_env(store: Any = None, env: Mapping[str, str] | None = None) -> ModelProvider:
    """Build the provider named by ``AQUA_SELECTOR`` (architecture note §5).

    ``auto`` (default) means the Anthropic API when ``ANTHROPIC_API_KEY`` is set, and otherwise
    ``AquaError("selector_unavailable")``. The lexical matcher is returned ONLY for
    ``AQUA_SELECTOR=catalogue_lexical``; there is no silent fallback to it.
    """
    env = os.environ if env is None else env
    mode = (env.get(ENV_SELECTOR) or "auto").strip().casefold()
    if mode not in SELECTOR_MODES:
        raise AquaError("selector_unavailable",
                        f"{ENV_SELECTOR}={mode!r} is not one of {', '.join(SELECTOR_MODES)}.", retryable=False)
    timeout_s = _timeout_from_env(env)
    model = env.get(ENV_MODEL) or None
    if mode in ("auto", "anthropic"):
        api_key = env.get(ENV_API_KEY)
        if not api_key:
            raise AquaError("selector_unavailable",
                            f"No selector model is configured: set {ENV_API_KEY} (or choose another "
                            f"{ENV_SELECTOR} mode explicitly).")
        effort_raw = env.get(ENV_EFFORT)
        effort = DEFAULT_EFFORT if effort_raw is None else (None if effort_raw.casefold() in _OFF else effort_raw)
        fallbacks = (env.get(ENV_FALLBACKS) or "default").casefold() not in _OFF
        return AnthropicProvider(api_key=api_key, model=model or DEFAULT_ANTHROPIC_MODEL, effort=effort,
                                 timeout_s=timeout_s, refusal_fallbacks=fallbacks)
    if mode == "claude_cli":
        return ClaudeCliProvider(model=model, executable=env.get(ENV_CLI_PATH), timeout_s=timeout_s)
    if store is None:
        raise AquaError("selector_unavailable",
                        "The catalogue matcher needs the prepared data store.", retryable=False)
    return CatalogueLexicalProvider(store)
