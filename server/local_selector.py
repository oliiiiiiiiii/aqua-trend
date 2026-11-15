"""Constrained Ollama classification of free text against the prepared catalogue."""
import json
import re
from urllib.request import urlopen

from .catalogue_data.definitions import CONCEPTS, PHENOMENA


DEFAULT_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_MODEL = "qwen3:1.7b"
PROMPT_VERSION = "local-catalogue-3"
UNAVAILABLE = "Unavailable"
# Contrast classes stop closely related, unmeasured quantities from being counted as observations.
UNMEASURED = ("River discharge", "Water level in a well", "Sea level")

INSTRUCTIONS = (
    "You interpret a user's search in a regional Earth science database. Extract ONLY phenomena and quantities "
    "actually requested, in English or Chinese. Give the smallest exact set of matching catalogue labels, in order "
    "of mention. Ignore place and time. Do not infer other conditions or causal links. Return Unavailable for "
    'unmatched topics and non-Earth questions. The bare word "drain" in this Earth science search means natural '
    "runoff. A household drain, blocked pipes, repair questions, drainage engineering, battery discharge, or "
    "brain drain is Unavailable. Dry soil means a soil water quantity, not evapotranspiration (a flowing vapor flux). "
    "Near-surface air temperature (氣溫, 近地面空氣溫度) differs from land surface temperature (地表本身溫度). "
    "River discharge (streamflow at a gauge) has no measurement here. Land warming and ocean warming are long-term; "
    "heatwaves are short episodes of unusually hot days. Words in an unrelated context do not match. If comparing "
    "two measurements, list just those two. Each phenomenon already includes its relevant measurements."
)

EXAMPLES = (
    ("Amount of snowpack water before spring", ["Snow water equivalent"]),
    ("河水溢出淹沒了附近農地", ["Flooding"]),
    ("Did wind speed and sunlight increase together?", ["Near-surface wind speed", "Downward shortwave radiation"]),
    ("Are there more sunspots than before?", [UNAVAILABLE]),
    ("Drainage", ["Runoff"]),
    ("氣溫在夏天變高了嗎？", ["Near-surface air temperature"]),
    ("River gauge measurements of streamflow at the outlet", ["River discharge"]),
    ("淋浴間的水管堵住，應該如何清理？", [UNAVAILABLE]),
    ("Water is leaking under my dishwasher.", [UNAVAILABLE]),
    ("Long-lived precipitation deficits are drying out farms.", ["Drought"]),
    ("Quantify sunshine and annual earnings.", ["Downward shortwave radiation", UNAVAILABLE]),
    ("暴露在乾旱的陸地變多了嗎？", ["Drought"]),
    ("How much water is left in the roots of crops?", ["Root-zone soil water"]),
    ("Persistent spells of unusually warm water at sea", ["Marine heatwaves"]),
    ("調查降雨量、海表溫度和陸地蒸散量", ["Precipitation", "Sea surface temperature", "Land evapotranspiration"]),
)


def model_digest(chat_url, model):
    """Read the weight manifest without loading a model into memory."""
    tags_url = chat_url.rsplit("/", 1)[0] + "/tags"
    names = {model, model + ":latest"}
    try:
        with urlopen(tags_url, timeout=1) as response:
            inventory = json.loads(response.read(1024 * 1024))
        for entry in inventory["models"]:
            if isinstance(entry, dict) and entry.get("name") in names:
                digest = entry.get("digest")
                if isinstance(digest, str) and re.fullmatch(r"[a-fA-F0-9]{64}", digest):
                    return digest.lower()
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def request_body(model, query, plans):
    quantities = "\n".join(f"- {row[0]}: {row[1]} ({', '.join(a for a in row[5] if not a.isascii())})"
                           for row in CONCEPTS.values())
    phenomena = "\n".join(f"- {row['label']}: {', '.join(row['aliases'][:3])}" for row in PHENOMENA.values())
    guide = (f"{INSTRUCTIONS}\nCatalogue of measured quantities:\n{quantities}\nCatalogue of phenomena:\n{phenomena}"
             "\nUnmeasured quantities (select their label when specifically requested): "
             "River discharge (streamflow in a channel), Water level in a well, Sea level.")
    labels = [plan["phenomenon"] for plan in plans.values()] + [*UNMEASURED, UNAVAILABLE]
    schema = {
        "type": "object", "required": ["matches"], "additionalProperties": False,
        "properties": {"matches": {"type": "array", "minItems": 1, "maxItems": len(labels),
                                   "items": {"type": "string", "enum": labels}}},
    }
    messages = [{"role": "system", "content": guide}]
    for example, matches in EXAMPLES:
        messages.append({"role": "user", "content": example})
        messages.append({"role": "assistant", "content": json.dumps({"matches": matches}, separators=(",", ":"))})
    messages.append({"role": "user", "content": query})
    return {"model": model, "messages": messages, "stream": False, "think": False, "format": schema,
            "keep_alive": "10m", "options": {"temperature": 0, "num_predict": 512, "num_ctx": 4096}}


def expand(answer, plans):
    """Recover all labels, roles, recipes and caveats from the reviewed plan records."""
    if not isinstance(answer, dict) or set(answer) != {"matches"}:
        raise ValueError("Unexpected selector fields.")
    matches = answer["matches"]
    by_label = {plan["phenomenon"]: key for key, plan in plans.items()}
    unmatched = {UNAVAILABLE, *UNMEASURED}
    if (not isinstance(matches, list) or not 1 <= len(matches) <= len(by_label) + len(unmatched)
            or any(not isinstance(label, str) or label not in by_label and label not in unmatched for label in matches)):
        raise ValueError("Unknown or invalid measurement list.")
    keys = list(dict.fromkeys(by_label[label] for label in matches if label in by_label))
    if not keys:
        return {"phenomenon": "Unsupported phenomenon", "phenomenon_id": "unsupported", "status": "unsupported",
                "variable_set": [], "indicator_recipe_ids": [], "limitation_refs": []}

    # Event recipes and contextual roles belong to a single phenomenon per study.
    primary = next((key for key in keys if key in PHENOMENA), keys[0])
    reviewed = plans[primary]
    variables = reviewed["variable_set"].copy()
    seen = {row["variable_id"] for row in variables}
    labels = [reviewed["phenomenon"]]
    limits = reviewed["limitation_refs"].copy()
    if unmatched.intersection(matches):
        limits.append("missing-observation")
    for key in keys:
        if key == primary:
            continue
        if key in PHENOMENA:
            limits.append(f"separate-study:{key}")
            continue
        extra = plans[key]
        row = extra["variable_set"][0]
        if row["variable_id"] not in seen:
            variables.append(row)
            seen.add(row["variable_id"])
            labels.append(extra["phenomenon"])
    label = " and ".join(labels)
    if len(label) > 100:
        label = f"{labels[0]} and {len(labels) - 1} other measurements"
    return {**reviewed, "phenomenon": label, "variable_set": variables, "limitation_refs": limits,
            "status": "partial" if limits != reviewed["limitation_refs"] else reviewed["status"]}
