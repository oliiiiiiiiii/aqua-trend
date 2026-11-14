"""One hypothesis ledger for direct studies and the entire case search."""
from .science import METHOD_POLICY, adjust_by
from .store import digest

METHOD_VERSION = METHOD_POLICY["version"] + "-by-1"


def entries(analysis):
    for v in analysis["variables"]:
        yield v["variable_id"], "anomaly_trend", v, v["product"].get("selected_product_id")
    for indicator in analysis["indicators"]:
        recipe = indicator["recipe"]
        for metric in indicator.get("metrics", []):
            yield recipe["indicator_id"], metric["metric_id"], metric, indicator.get("evidence_source")


def ledger(analysis, versions, region, period):
    rows = []
    for concept, metric, item, source in entries(analysis):
        trend = item.get("trend") or {}
        identity = {"region_id": region, "candidate_period": period, "analysis_period": item.get("analysis_period"),
                    "concept_id": concept, "metric_id": metric, "source": source, "versions": versions,
                    "method_version": METHOD_VERSION, "baseline_ref": (item.get("baseline") or {}).get("baseline_id")}
        key = digest(identity)
        item["hypothesis_id"] = key
        p = trend.get("p_raw")
        rows.append({"hypothesis_id": key, **identity, "p_raw": p,
                     "reason": None if p is not None else (" ".join(trend.get("diagnostics", [])) or item.get("reason") or "Inference unavailable.")})
    for i in analysis["indicators"]:
        if not i.get("metrics"):
            identity = {"region_id": region, "candidate_period": period, "concept_id": i["recipe"]["indicator_id"],
                        "metric_id": "unavailable", "source": i.get("evidence_source"), "versions": versions}
            rows.append({"hypothesis_id": digest(identity), **identity, "p_raw": None, "reason": i.get("reason") or i["status"]})
    return rows


def family(scope, rows, candidates, policy_version):
    unique = {r["hypothesis_id"]: r for r in rows}
    members = [dict(r) for r in unique.values()]
    adjusted = adjust_by([r["p_raw"] for r in members])
    for row, p in zip(members, adjusted):
        row["p_adjusted"] = p
    family_id = scope + "-" + digest([scope, policy_version, members, candidates])[:24]
    return {"family_id": family_id, "scope": scope, "policy_version": policy_version,
            "method": "Benjamini–Yekutieli", "alpha": 0.05, "status": "complete",
            "candidate_count": len(candidates), "tested_count": sum(r["p_raw"] is not None for r in members),
            "candidate_policy": policy_version, "candidates": candidates, "members": members}


def attach(analysis, families):
    indices = [{r["hypothesis_id"]: r for r in f["members"]} for f in families]
    for _, _, item, _ in entries(analysis):
        trend = item.get("trend")
        if not trend:
            continue
        trend["p_adjusted"] = {}
        for f, index in zip(families, indices):
            match = index.get(item["hypothesis_id"])
            if match is None or match["p_raw"] != trend.get("p_raw"):
                continue
            key = f["family_id"]
            p = match["p_adjusted"]
            trend["p_adjusted"][key] = p
            trend["primary_family_id"] = key
            trend["significant"] = p < f["alpha"] if p is not None else None
