"""web/public/data/results/*.json（engine-0.3）→ results/index.json：Demo 區域清單與摘要"""
import glob, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "web", "public", "data", "results")
items = []
for f in sorted(glob.glob(os.path.join(D, "*.json"))):
    if f.endswith("index.json"): continue
    r = json.load(open(f))
    tg = {t["key"]: t for t in r["targets"]}
    rec = sorted([t for t in r["tests"] if t.get("recommended")], key=lambda t: -abs(t.get("r_best", t.get("r", 0)) or 0))
    def line(t):
        lag = t.get("best_lag")
        when = "空間趨勢關係" if t["kind"] == "space" else ("同一個月" if lag == 0 else (f"候選先變 {lag} 個月" if lag > 0 else f"水文先變 {-lag} 個月"))
        return dict(target=t["target"], target_name=tg[t["target"]]["name"], candidate=t["candidate"], candidate_name=t["candidate_zh"],
                    product=t["product"], kind=t["kind"], r=round(t.get("r_best", t.get("r")), 3), lag_months=lag, lag_text=when,
                    p_by=t["p_by"], domain=t["domain"], data_caveat=t.get("data_caveat"))
    items.append(dict(
        id=r["region"]["id"], name=r["region"]["name"], file=f"results/{os.path.basename(f)}", status=r["status"], version=r["policy"]["version"],
        targets=[dict(key=k, name=t["name"], layer=t.get("layer"), product=t.get("product"), unit=t.get("unit"), period=t.get("period"),
                      slope_per_decade=(t.get("ols") or {}).get("slope_per_decade"), pct_per_decade=t.get("pct_per_decade"),
                      p_by=(t.get("ols") or {}).get("p_by"), significant=t.get("significant"), note=t.get("note")) for k, t in tg.items()],
        validation=[dict(target=v["target"], against=v["layer"], name=v["name"], product=v["product"], verdict=v["verdict"],
                         dependency=v["dependency"], pct_per_decade=v["pct_per_decade"],
                         r_anomaly=None if v["r_anomaly"] is None else round(v["r_anomaly"], 3)) for v in r["validation"]],
        n_tests=r["family"]["size"], n_recommended=r["family"]["n_recommended"],
        top_cross_domain=[line(t) for t in rec if not t["domain"].startswith("水文")][:6],
        top_hydrology=[line(t) for t in rec if t["domain"].startswith("水文")][:4],
        products=r["catalog"]["products"], completeness=r["completeness"]))
json.dump(dict(generated="2026-11-14", engine="engine-0.3", note="Demo 區域的預先分析結果；每個 file 是完整結果（spec 7.7 欄位）", regions=items),
          open(os.path.join(D, "index.json"), "w"), ensure_ascii=False, indent=1)
print(len(items), "regions")
