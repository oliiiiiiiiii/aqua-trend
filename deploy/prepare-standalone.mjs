import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const standalone = path.join(web, ".next/standalone");
const publicDir = path.join(web, "public");
const bundleMarker = path.join(publicDir, "data/.bundle");

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  throw new Error("Missing .next/standalone/server.js; build with output: 'standalone' first.");
}

// Standalone tracing omits these served assets; the bundle marker is host setup metadata.
fs.rmSync(path.join(standalone, "public"), { recursive: true, force: true });
fs.cpSync(publicDir, path.join(standalone, "public"), {
  recursive: true,
  filter: (source) => source !== bundleMarker,
});
fs.cpSync(path.join(web, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
console.log("[standalone] Copied public assets and Next.js static files; omitted data/.bundle.");
