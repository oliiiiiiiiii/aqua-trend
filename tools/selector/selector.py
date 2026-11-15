"""Ask a local System One decision model one yes/no (`noul`) question per variable category.

Shared by serve.py (the HTTP service the Next route calls) and eval.py. Standard library only, so it
runs under `python -I` with any of the candidate venvs.

Three backends, all speaking a `POST /v1/systemone` dialect:
  onejev     OneJev1.6-0.8B GGUF through `qev serve --gguf` (TypeSafe shape: questions is a dict)
  jev-style  Jev-Style-0.8B-Decision-v3 through `jev-style serve` (TypeSafe shape)
  phocinae   Phocinae-Largha-150M-v1 through `python -m phocinae.main` (questions is a list;
             P(true) comes from the `option_scores` extension, [p_false, p_true])
"""
from __future__ import annotations

import json
import time
import urllib.request

# Same order and wording as SPEC.md section 4. "zh" is the plain-language definition from the spec
# (owned by workstream E); "en" is our English rendering of it.
CATEGORIES: dict[str, dict[str, str]] = {
    "precip": {"zh": "從天上落下的雨和雪有多少", "en": "how much rain and snow falls from the sky"},
    "et": {"zh": "地面和植物把水送回空氣中的量", "en": "how much water the ground and plants send back into the air (evapotranspiration)"},
    "soil": {"zh": "植物根部所在土層裡有多少水", "en": "how much water is in the soil layer where plant roots live"},
    "tws": {"zh": "地表、土壤、地下水加起來的總水量變化", "en": "the change in total water stored on land: surface water, soil water and groundwater"},
    "runoff": {"zh": "下雨後沒被吸收、流進河裡的水", "en": "rain water that is not absorbed and flows into rivers (runoff)"},
    "snow": {"zh": "積雪融化後等於多少水", "en": "how much water the snowpack holds (snow water equivalent)"},
    "tair": {"zh": "地面附近的空氣溫度", "en": "the air temperature near the ground"},
    "vpd": {"zh": "空氣有多「渴」，越大越容易把水吸走", "en": "how thirsty the air is (vapor pressure deficit); the higher it is, the faster it pulls water out of soil and plants"},
    "energy": {"zh": "地表吸收的淨輻射能量", "en": "the net radiation energy absorbed by the land surface"},
    "wind": {"zh": "近地面風速", "en": "the wind speed near the ground"},
    "ndvi": {"zh": "植物有多綠、多茂盛", "en": "how green and lush the vegetation is"},
    "sst": {"zh": "海表溫度", "en": "the sea surface temperature"},
}

# Question wording, one noul question per category. "zh" is SPEC section 3's literal question
# 「事件與〈淺白定義〉有關嗎？」; the others are English renderings. eval.md compares them.
PROMPTS = {
    "en": "Is this event related to {d}?",
    "zh": "這個事件與「{d}」有關嗎？",
    "en-affects": "This event strongly affects {d}.",
    "en-unusual": "During or before this event, {d} would be clearly unusual, so this variable helps show the event in satellite data.",
}
DEFINITION_LANG = {"en": "en", "zh": "zh", "en-affects": "en", "en-unusual": "en"}
DEFAULT_PROMPT = "en"

BACKENDS = ("onejev", "jev-style", "phocinae")


def questions(prompt: str = DEFAULT_PROMPT) -> dict[str, str]:
    template = PROMPTS[prompt]
    return {cid: template.format(d=c[DEFINITION_LANG[prompt]]) for cid, c in CATEGORIES.items()}


def state_text(event: str) -> str:
    return f"A student wants to study this Earth event with NASA satellite data: {event.strip()}"


def request_body(backend: str, event: str, prompt: str = DEFAULT_PROMPT) -> dict:
    qs = questions(prompt)
    if backend == "phocinae":
        return {"model": "Phocinae-Largha-150M-v1", "state": state_text(event),
                "questions": [{"id": cid, "type": "noul", "instructions": text} for cid, text in qs.items()]}
    return {"state": {"event": state_text(event)},
            "questions": {cid: {"type": "noul", "instructions": text} for cid, text in qs.items()}}


def parse_probabilities(backend: str, response: dict) -> dict[str, float]:
    if backend == "phocinae":
        scores = response["option_scores"]
        return {cid: float(scores[cid][1]) for cid in CATEGORIES}
    answers = response["answers"]
    return {cid: float(answers[cid]["noul"]) for cid in CATEGORIES}


def ask(backend: str, upstream: str, event: str, prompt: str = DEFAULT_PROMPT, timeout: float = 30) -> tuple[dict[str, float], float]:
    """Return ({category: P(yes)}, seconds). Raises on any transport or format error."""
    if backend not in BACKENDS:
        raise ValueError(f"unknown backend {backend!r}")
    body = json.dumps(request_body(backend, event, prompt)).encode()
    req = urllib.request.Request(upstream.rstrip("/") + "/v1/systemone", data=body,
                                 headers={"Content-Type": "application/json"})
    started = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        response = json.loads(r.read())
    probs = parse_probabilities(backend, response)
    if any(not 0.0 <= p <= 1.0 for p in probs.values()):
        raise ValueError("probability out of range")
    return probs, time.monotonic() - started
