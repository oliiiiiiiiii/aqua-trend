// Run from repo root: npx tsx tools/selector/check-contract.mts (also requires python3).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CATEGORY_ORDER, CATEGORIES } from "../../web/lib/detective/categories.ts";

const result = spawnSync("python3", ["-I", "-c",
  "import json,sys; sys.path.insert(0,sys.argv[1]); import selector; print(json.dumps(selector.CATEGORIES,ensure_ascii=False))",
  fileURLToPath(new URL(".", import.meta.url)),
], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr || result.error?.message);
const definitions: Record<string, { zh: string; en: string }> = JSON.parse(result.stdout);
assert.deepEqual(Object.keys(definitions), [...CATEGORY_ORDER]);
for (const category of CATEGORY_ORDER) {
  const canonical = CATEGORIES[category].definition;
  assert.equal(definitions[category].zh, canonical.zh, `${category}: Chinese definition drift`);
  const en = canonical.en.replace(/\.$/, "");
  assert.equal(definitions[category].en, en.charAt(0).toLowerCase() + en.slice(1), `${category}: English definition drift`);
}
console.log(`Selector contract: ${CATEGORY_ORDER.length} categories and bilingual definitions match.`);
