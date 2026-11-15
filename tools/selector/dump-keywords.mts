// 把歷史 10 個事件跑過目前關鍵字備案；新檔保留舊 12 類評估結果，不代表 17 類準確度。
import { writeFileSync, readFileSync } from "node:fs";
import { ALL_CATEGORIES, keywordVotes, matchedRules } from "../../web/lib/detective/keywords.ts";
const events: { id: string; event: string }[] = JSON.parse(readFileSync(new URL("./results/onejev-en.json", import.meta.url), "utf8")).rows;
const rows = events.map((r) => ({ id: r.id, event: r.event, rules: matchedRules(r.event),
  selected: keywordVotes(r.event).filter((v) => v.selected).map((v) => v.category) }));
writeFileSync(new URL(`./results/keywords-categories${ALL_CATEGORIES.length}.json`, import.meta.url), JSON.stringify(rows, null, 1) + "\n");
for (const r of rows) console.log(r.id.padEnd(12), r.rules.join(","), "=>", r.selected.join(","));
