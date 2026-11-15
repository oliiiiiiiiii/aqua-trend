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

# Mirrors web/lib/detective/categories.ts. English text is lowercased at the start and has no final
# period so it can be inserted into the question template. Covered by the keyword contract test.
CATEGORIES: dict[str, dict[str, str]] = {
    "precip": {"zh": "從天上落下的雨和雪有多少", "en": "how much rain and snow falls from the sky"},
    "et": {"zh": "地面和植物把水送回空氣中的量", "en": "water that soil and plants send back into the air"},
    "soil": {"zh": "植物根部所在土層裡有多少水", "en": "how much water is in the soil where plant roots grow"},
    "tws": {"zh": "地表、土壤、地下水加起來的總水量變化", "en": "change in all water on land: surface, soil and groundwater"},
    "runoff": {"zh": "下雨後沒被吸收、流進河裡的水", "en": "rain that the ground does not soak up and flows to rivers"},
    "snow": {"zh": "地上的積雪融化後等於多少水", "en": "how much water the snow on the ground would melt into"},
    "tair": {"zh": "地面附近的空氣溫度", "en": "temperature of the air near the ground"},
    "vpd": {"zh": "空氣有多「渴」，越大越容易把水吸走", "en": "how thirsty the air is; higher pulls water out faster"},
    "energy": {"zh": "地面從陽光和天空淨得到的熱能", "en": "heat energy the ground gains from sunlight and the sky"},
    "wind": {"zh": "地面附近的風吹得多快", "en": "how fast the wind blows near the ground"},
    "ndvi": {"zh": "植物有多綠、多茂盛", "en": "how green and leafy the plants are"},
    "sst": {"zh": "海面的水有多溫暖", "en": "how warm the water at the sea surface is"},
    "aod": {"zh": "整柱空氣中的粒子削弱光線的程度", "en": "how strongly particles in the atmospheric column block light"},
    "ozone": {"zh": "從地面到高空整柱空氣中的臭氧總量", "en": "the total amount of ozone in the atmospheric column"},
    "vapor": {"zh": "整柱空氣中的水蒸氣凝結後有多少水", "en": "how much water all the water vapour in the atmospheric column would make if condensed"},
    "so2": {"zh": "區域內大型點源每年排放多少二氧化硫", "en": "how much sulfur dioxide large point sources emit each year"},
    "fire": {"zh": "衛星每月偵測到的植被火熱點次數", "en": "how many vegetation-fire detections satellites record each month"},
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
        values = {cid: scores[cid][1] for cid in CATEGORIES}
    else:
        answers = response["answers"]
        values = {cid: answers[cid]["noul"] for cid in CATEGORIES}
    if any(type(p) not in (int, float) or not 0.0 <= p <= 1.0 for p in values.values()):
        raise ValueError("invalid probability")
    return {cid: float(p) for cid, p in values.items()}


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
