// Download and unpack the website data bundle pinned in web/data.lock.json.
// Data is NOT in git. It is published as a GitHub Release asset by workstream F
// (see docs/INTEGRATION.md). Never point this at the temporary team data share.
//
//   node scripts/setup-data.mjs                 download + unpack (overwrites web/public/data, web/data)
//   node scripts/setup-data.mjs --if-missing    skip when data is already present
//   node scripts/setup-data.mjs --file <tgz>    use a local bundle instead of downloading
//
// The repo is private, so downloading needs either the `gh` CLI (logged in) or GITHUB_TOKEN.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB, "..");
const lock = JSON.parse(fs.readFileSync(path.join(WEB, "data.lock.json"), "utf8"));
const MARKER = path.join(WEB, "public", "data", ".bundle");
const args = process.argv.slice(2);
const log = (...a) => console.log("[setup-data]", ...a);

if (args.includes("--if-missing") && fs.existsSync(MARKER) && fs.readFileSync(MARKER, "utf8").trim() === lock.sha256) {
  log(`data ${lock.tag} already present - skipping`);
  process.exit(0);
}

const fileArg = args.indexOf("--file");
let bundle = fileArg >= 0 ? path.resolve(args[fileArg + 1]) : null;

if (!bundle) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terratrend-data-"));
  bundle = path.join(tmp, lock.asset);
  const hasGh = spawnSync("gh", ["--version"], { stdio: "ignore" }).status === 0;
  if (hasGh) {
    log(`downloading ${lock.asset} (${lock.tag}) with gh ...`);
    execFileSync("gh", ["release", "download", lock.tag, "-R", lock.repo, "-p", lock.asset, "-D", tmp, "--clobber"], { stdio: "inherit" });
  } else if (process.env.GITHUB_TOKEN) {
    log(`downloading ${lock.asset} (${lock.tag}) with GITHUB_TOKEN ...`);
    const h = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" };
    const rel = await fetch(`https://api.github.com/repos/${lock.repo}/releases/tags/${lock.tag}`, { headers: h });
    if (!rel.ok) throw new Error(`release ${lock.tag} not found (${rel.status})`);
    const asset = (await rel.json()).assets.find((a) => a.name === lock.asset);
    if (!asset) throw new Error(`asset ${lock.asset} missing from release ${lock.tag}`);
    const res = await fetch(asset.url, { headers: { ...h, Accept: "application/octet-stream" } });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    fs.writeFileSync(bundle, Buffer.from(await res.arrayBuffer()));
  } else {
    console.error(
      "[setup-data] Cannot download: the repo is private.\n" +
        "  Install and log in to the GitHub CLI (`gh auth login`), or set GITHUB_TOKEN,\n" +
        "  or download the asset manually and run: npm run setup -- --file <path-to-tar.gz>",
    );
    process.exit(1);
  }
}

const sha = crypto.createHash("sha256").update(fs.readFileSync(bundle)).digest("hex");
if (sha !== lock.sha256) {
  console.error(`[setup-data] checksum mismatch: expected ${lock.sha256}, got ${sha}`);
  process.exit(1);
}

log("unpacking ...");
for (const d of [path.join(WEB, "public", "data"), path.join(WEB, "data")]) fs.rmSync(d, { recursive: true, force: true });
execFileSync("tar", ["-xzf", bundle, "-C", REPO_ROOT], { stdio: "inherit" });
fs.writeFileSync(MARKER, lock.sha256 + "\n");
log(`done: ${lock.tag} -> web/public/data, web/data`);
