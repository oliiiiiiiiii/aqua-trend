// 把 eval.py 的 10 個事件跑過關鍵字備案，寫到 results/keywords.json：node tools/selector/dump-keywords.mts
import { writeFileSync, readFileSync } from "node:fs";
import { keywordVotes, matchedRules } from "../../web/lib/detective/keywords.ts";
const events: { id: string; event: string }[] = JSON.parse(readFileSync(new URL("./results/onejev-en.json", import.meta.url), "utf8")).rows;
const rows = events.map((r) => ({ id: r.id, event: r.event, rules: matchedRules(r.event),
  selected: keywordVotes(r.event).filter((v) => v.selected).map((v) => v.category) }));
writeFileSync(new URL("./results/keywords.json", import.meta.url), JSON.stringify(rows, null, 1) + "\n");
for (const r of rows) console.log(r.id.padEnd(12), r.rules.join(","), "=>", r.selected.join(","));
