import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../web"));
const lock = JSON.parse(fs.readFileSync(path.join(web, "data.lock.json"), "utf8"));
const marker = path.join(web, "public/data/.bundle");
const fail = (reason) => {
  console.error(
    `[container-data] ${reason}\n` +
    "Prepare the pinned bundle on the host before building the image:\n" +
    "  cd web && npm ci && npm run setup\n" +
    "Or use a downloaded bundle: npm run setup -- --file /path/to/bundle.tar.gz\n" +
    "Then run docker compose up --build from the repository root.\n" +
    "GitHub credentials are only used on the host; the image does not download private data.",
  );
  process.exit(1);
};

if (!fs.existsSync(marker)) fail("Missing web/public/data/.bundle.");
if (fs.readFileSync(marker, "utf8").trim() !== lock.sha256) {
  fail(`The local data bundle does not match web/data.lock.json (${lock.tag}).`);
}

const variables = ["precip", "et", "p_minus_et", "runoff", "soil_top", "root_zone", "tws", "swe", "tair"];
const layers = ["basin3", "basin4", "hex", "lme", "sea", "ice", "named"];
const required = [
  "data/meta.json",
  "public/data/catalog/regions.json",
  "public/data/catalog/countries.json",
  ...variables.flatMap((variable) => [`data/series/${variable}.i16`, `data/trends/${variable}.json`]),
  ...layers.map((layer) => `public/data/geo/${layer}.geojson`),
];
const missing = required.filter((file) => {
  try {
    const stat = fs.statSync(path.join(web, file));
    return !stat.isFile() || stat.size === 0;
  } catch {
    return true;
  }
});
if (missing.length) fail(`Incomplete data bundle; missing or empty: ${missing.map((file) => `web/${file}`).join(", ")}.`);

console.log(`[container-data] ${lock.tag}: matching bundle marker and all preprocessing inputs present.`);
