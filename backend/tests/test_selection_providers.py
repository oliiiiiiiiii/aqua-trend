"""Selector providers and configuration: no silent fallback, safe invocation (S06, S07). No network."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)
sys.path.insert(0, str(Path(__file__).parent / "fixtures" / "selection"))
from selection_support import FakeStore  # noqa: E402

import json  # noqa: E402
import subprocess  # noqa: E402
import types  # noqa: E402

from aqua_trend.errors import AquaError  # noqa: E402
from aqua_trend.selection import (  # noqa: E402
    AnthropicProvider, CatalogueLexicalProvider, CatalogueSnapshot, ClaudeCliProvider, ModelProvider,
    ProviderOutputError, ProviderUnavailable, provider_from_env,
)
from aqua_trend.selection.prompt import (  # noqa: E402
    build_output_schema, build_system_prompt, build_user_prompt, extract_query,
)

SCHEMA = {"type": "object"}


# ---------------------------------------------------------------- provider_from_env

def test_S07_auto_without_api_key_is_unavailable_never_lexical():
    for env in ({}, {"AQUA_SELECTOR": "auto"}, {"AQUA_SELECTOR": "anthropic"}):
        with pytest.raises(AquaError) as excinfo:
            provider_from_env(FakeStore(), env=env)
        assert excinfo.value.code == "selector_unavailable" and excinfo.value.retryable


def test_auto_with_api_key_uses_anthropic_and_env_model():
    provider = provider_from_env(None, env={"ANTHROPIC_API_KEY": "test-key", "AQUA_SELECTOR_MODEL": "claude-sonnet-5-5"})
    assert isinstance(provider, AnthropicProvider) and isinstance(provider, ModelProvider)
    assert provider.name == "anthropic" and provider.is_language_model and provider.model == "claude-sonnet-5-5"
    default = provider_from_env(None, env={"ANTHROPIC_API_KEY": "test-key"})
    assert default.model == "claude-opus-5-5"


def test_lexical_and_cli_only_when_named_explicitly():
    lexical = provider_from_env(FakeStore(), env={"AQUA_SELECTOR": "catalogue_lexical", "ANTHROPIC_API_KEY": "k"})
    assert isinstance(lexical, CatalogueLexicalProvider) and lexical.is_language_model is False
    cli = provider_from_env(None, env={"AQUA_SELECTOR": "claude_cli"})
    assert isinstance(cli, ClaudeCliProvider) and cli.is_language_model is True


@pytest.mark.parametrize("env", [{"AQUA_SELECTOR": "keyword_demo"}, {"AQUA_SELECTOR": "catalogue_lexical"},
                                 {"ANTHROPIC_API_KEY": "k", "AQUA_SELECTOR_TIMEOUT_S": "soon"}])
def test_configuration_mistakes_are_reported_not_retryable(env):
    with pytest.raises(AquaError) as excinfo:
        provider_from_env(None, env=env)
    assert excinfo.value.code == "selector_unavailable" and not excinfo.value.retryable


# ---------------------------------------------------------------- prompt

def test_prompt_is_stable_and_forbids_constraints_code_and_new_formulas():
    snapshot = CatalogueSnapshot.from_store(FakeStore())
    system = build_system_prompt(snapshot)
    assert system == build_system_prompt(CatalogueSnapshot.from_store(FakeStore()))    # cacheable prefix
    for phrase in ("Never output a region", "formulas or code", "ignored_text_constraints",
                   "untrusted data", "Never pad the set"):
        assert phrase in system
    assert "TEST: precipitation deficit defines meteorological drought." in system     # notes with statements
    assert "TEST: meteorological drought." in system                                   # recipe applicability
    schema = build_output_schema(snapshot)
    assert sorted(schema["properties"]["indicator_recipe_ids"]["items"]["enum"]) == ["flood_recorded", "spi3"]
    assert extract_query(build_user_prompt("  乾旱 2022 ")) == "乾旱 2022"


# ---------------------------------------------------------------- Anthropic (fake client, no network)

class _FakeMessages:
    def __init__(self, response=None, error=None):
        self.kwargs, self._response, self._error = None, response, error

    def create(self, **kwargs):
        self.kwargs = kwargs
        if self._error:
            raise self._error
        return types.SimpleNamespace(to_dict=lambda: self._response)


def _client(response=None, error=None):
    messages = _FakeMessages(response, error)
    return types.SimpleNamespace(messages=messages, beta=types.SimpleNamespace(messages=messages)), messages


def _message(text, stop_reason="end_turn", model="claude-opus-5-5"):
    return {"model": model, "stop_reason": stop_reason, "content": [{"type": "thinking", "thinking": ""},
                                                                    {"type": "text", "text": text}]}


def test_anthropic_request_uses_structured_output_and_cached_system_prompt():
    client, messages = _client(_message('{"status": "ok"}'))
    provider = AnthropicProvider(client=client, model="claude-opus-5-5")
    assert provider.complete("SYS", "USER", SCHEMA) == {"status": "ok"}
    sent = messages.kwargs
    assert sent["model"] == "claude-opus-5-5"
    assert sent["output_config"]["format"] == {"type": "json_schema", "schema": SCHEMA}
    assert sent["system"][0]["text"] == "SYS" and sent["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert sent["messages"] == [{"role": "user", "content": "USER"}]
    assert sent["fallbacks"] == "default" and sent["betas"] == ["server-side-fallback-2026-07-01"]
    assert "temperature" not in sent and "thinking" not in sent and "tool_choice" not in sent


def test_anthropic_without_fallback_support_uses_the_plain_endpoint_and_records_served_model():
    client, messages = _client(_message('{"a": 1}', model="claude-haiku-5-5"))
    provider = AnthropicProvider(client=client, model="claude-haiku-5-5", effort=None)
    provider.complete("S", "U", SCHEMA)
    assert "fallbacks" not in messages.kwargs and "betas" not in messages.kwargs
    assert "effort" not in messages.kwargs["output_config"]
    assert provider.served_model == "claude-haiku-5-5"


@pytest.mark.parametrize("message", [
    _message("", stop_reason="refusal"), _message('{"a": ', stop_reason="max_tokens"),
    _message("I think drought is about rain."), _message("[1, 2]"),
    {"model": "m", "stop_reason": "end_turn", "content": []},
])
def test_S06_anthropic_refusal_truncation_or_non_json_is_an_output_error(message):
    client, _ = _client(message)
    with pytest.raises(ProviderOutputError):
        AnthropicProvider(client=client).complete("S", "U", SCHEMA)


def test_S07_anthropic_without_key_or_on_api_errors_is_unavailable(monkeypatch):
    import anthropic
    import httpx2

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ProviderUnavailable):
        AnthropicProvider().complete("S", "U", SCHEMA)
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    errors = [
        anthropic.APITimeoutError(request=request),
        anthropic.APIConnectionError(request=request),
        anthropic.RateLimitError("slow down", response=httpx2.Response(429, request=request), body=None),
        anthropic.AuthenticationError("bad key", response=httpx2.Response(401, request=request), body=None),
        anthropic.InternalServerError("oops", response=httpx2.Response(500, request=request), body=None),
    ]
    for error in errors:
        client, _ = _client(error=error)
        with pytest.raises(ProviderUnavailable):
            AnthropicProvider(client=client).complete("S", "U", SCHEMA)


# ---------------------------------------------------------------- claude CLI (fake runner, no process)

def _runner(stdout="", returncode=0, error=None, seen=None):
    def run(argv, **kwargs):
        if seen is not None:
            seen.update(argv=argv, **kwargs)
        if error:
            raise error
        return subprocess.CompletedProcess(argv, returncode, stdout=stdout, stderr="boom")
    return run


def _cli(**kw) -> ClaudeCliProvider:
    return ClaudeCliProvider(executable=sys.executable, **kw)      # any existing executable; never started


def test_S06_cli_passes_user_text_on_stdin_without_a_shell_and_disables_tools():
    seen: dict = {}
    hostile = "drought'; rm -rf / #$(whoami) `id`"
    out = json.dumps({"type": "result", "is_error": False, "result": "ignored",
                      "structured_output": {"status": "ok"}, "modelUsage": {"claude-opus-5-5": {}}})
    provider = _cli(runner=_runner(out, seen=seen))
    assert provider.complete("SYS", hostile, SCHEMA) == {"status": "ok"}
    argv = seen["argv"]
    assert isinstance(argv, list) and "shell" not in seen
    assert seen["input"] == hostile and all(hostile not in arg for arg in argv)
    assert argv[argv.index("--tools") + 1] == "" and "--print" in argv
    assert argv[argv.index("--output-format") + 1] == "json"
    assert json.loads(argv[argv.index("--json-schema") + 1]) == SCHEMA
    assert argv[argv.index("--system-prompt") + 1] == "SYS"
    assert provider.served_model == "claude-opus-5-5"


def test_cli_result_text_is_parsed_when_no_structured_output():
    out = json.dumps({"is_error": False, "result": "```json\n{\"status\": \"partial\"}\n```"})
    assert _cli(runner=_runner(out)).complete("S", "U", SCHEMA) == {"status": "partial"}


def test_S07_cli_missing_failing_or_timing_out_is_unavailable():
    with pytest.raises(ProviderUnavailable):
        ClaudeCliProvider(executable="definitely-not-a-real-cli-xyz").complete("S", "U", SCHEMA)
    with pytest.raises(ProviderUnavailable):
        _cli(runner=_runner(returncode=1)).complete("S", "U", SCHEMA)
    with pytest.raises(ProviderUnavailable):
        _cli(runner=_runner(error=subprocess.TimeoutExpired("claude", 1))).complete("S", "U", SCHEMA)
    with pytest.raises(ProviderUnavailable):
        _cli(runner=_runner(json.dumps({"is_error": True, "result": "auth"}))).complete("S", "U", SCHEMA)
    with pytest.raises(ProviderOutputError):
        _cli(runner=_runner("not json")).complete("S", "U", SCHEMA)
    with pytest.raises(ProviderOutputError):
        _cli(runner=_runner(json.dumps({"is_error": False, "result": "prose"}))).complete("S", "U", SCHEMA)
