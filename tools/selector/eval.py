"""Run the 10 test events through a running System One server and score the votes.

    .venv/bin/python -I eval.py --backend onejev --upstream http://127.0.0.1:8811 --prompt en
    .venv/bin/python -I eval.py --summary results/*.json     # threshold sweep + F1 over saved runs

Each run writes results/<backend>-<prompt>.json. The keyword baseline is computed by
check-keywords.mts / web/lib/detective/keywords.ts and copied into eval.md by hand.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir; add it back explicitly
from selector import CATEGORIES, PROMPTS, ask  # noqa: E402

# (id, event text as a student would type it, human judgment of relevant categories)
EVENTS = [
    ("drought-tw", "2021 台灣春季大旱", {"precip", "soil", "tws", "ndvi"}),
    ("flood-pk", "2022 Pakistan floods", {"precip", "runoff", "soil", "tws"}),
    ("heat-eu", "2003 European heatwave", {"tair", "vpd", "energy", "soil"}),
    ("fire-au", "2019–20 澳洲黑色夏季野火", {"precip", "soil", "tair", "vpd", "ndvi"}),
    ("blizzard-tx", "2021 年 2 月德州暴風雪", {"tair", "snow", "precip"}),
    ("typhoon-ph", "2013 typhoon season in the Philippines", {"precip", "wind", "runoff", "sst"}),
    ("enso", "2015–16 El Niño", {"sst", "precip", "tair"}),
    ("lake-mead", "Lake Mead fell to a record low water level in 2022", {"precip", "tws", "runoff", "snow"}),
    ("corn-belt", "2012 US Corn Belt crop failure", {"precip", "soil", "tair", "vpd", "ndvi"}),
    ("yangtze", "2022 長江流域夏季乾旱與熱浪", {"precip", "soil", "tws", "tair", "vpd", "runoff"}),
]


def f1(selected: set[str], truth: set[str]) -> float:
    tp = len(selected & truth)
    return 0.0 if tp == 0 else 2 * tp / (len(selected) + len(truth))


def auc(rows: list[dict]) -> float:
    pos = [r["p"][c] for r in rows for c in CATEGORIES if c in r["truth"]]
    neg = [r["p"][c] for r in rows for c in CATEGORIES if c not in r["truth"]]
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def run(args: argparse.Namespace) -> None:
    rows = []
    for eid, text, truth in EVENTS:
        probs, secs = ask(args.backend, args.upstream, text, args.prompt, timeout=120)
        rows.append({"id": eid, "event": text, "truth": sorted(truth), "p": probs, "seconds": round(secs, 2)})
        top = ", ".join(f"{c} {p:.2f}" for c, p in sorted(probs.items(), key=lambda x: -x[1])[:6])
        print(f"{eid:12s} {secs:5.1f}s  {top}", flush=True)
    out = Path(__file__).resolve().parent / "results" / f"{args.backend}-{args.prompt}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"backend": args.backend, "prompt": args.prompt, "rows": rows},
                              ensure_ascii=False, indent=1) + "\n")
    print("wrote", out)


def summary(paths: list[str]) -> None:
    for path in paths:
        data = json.loads(Path(path).read_text())
        rows = [{**r, "truth": set(r["truth"])} for r in data["rows"]]
        secs = [r["seconds"] for r in rows]
        best = max((statistics.mean(f1({c for c, p in r["p"].items() if p >= t}, r["truth"]) for r in rows), t)
                   for t in [x / 20 for x in range(4, 19)])
        at50 = statistics.mean(f1({c for c, p in r["p"].items() if p >= 0.5}, r["truth"]) for r in rows)
        print(f"{data['backend']:10s} {data['prompt']}  AUC {auc(rows):.3f}  F1@0.50 {at50:.3f}  "
              f"best F1 {best[0]:.3f} @ {best[1]:.2f}  latency median {statistics.median(secs):.1f}s max {max(secs):.1f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backend", choices=("onejev", "jev-style", "phocinae"))
    ap.add_argument("--upstream")
    ap.add_argument("--prompt", choices=tuple(PROMPTS), default="en")
    ap.add_argument("--summary", nargs="+")
    a = ap.parse_args()
    summary(a.summary) if a.summary else run(a)
