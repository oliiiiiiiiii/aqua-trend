// Headless screenshot helper for visual checks (WebGL enabled through SwiftShader).
//
//   node scripts/shot.mjs <url-or-path> <out.png> [options]
//     --w 1440 --h 900        viewport
//     --wait 2500             ms to wait after load (3D scenes need ~2500+)
//     --full                  full-page screenshot
//     --theme night           set <html data-theme> before the page scripts run
//     --reduced-motion        emulate prefers-reduced-motion: reduce
//     --click "x,y"           click at viewport coords (repeatable; applied in order with drags)
//     --drag "x1,y1,x2,y2"    pointer drag (repeatable)
//     --wheel "x,y,deltaY"    mouse wheel at a point (repeatable)
//     --press "Tab"           keyboard key (repeatable)
//     --selector "css"        screenshot just this element
//     --eval "js expression"  evaluate in the page and print the JSON result
//   Console errors and failed requests are always printed.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const [target, out] = args;
if (!target || !out) { console.error("usage: node scripts/shot.mjs <url> <out.png> [options]"); process.exit(1); }
const opt = { w: 1440, h: 900, wait: 2500, full: false, theme: null, reduced: false, selector: null, evals: [], actions: [] };
for (let i = 2; i < args.length; i++) {
  const a = args[i], v = () => args[++i];
  if (a === "--w") opt.w = +v();
  else if (a === "--h") opt.h = +v();
  else if (a === "--wait") opt.wait = +v();
  else if (a === "--full") opt.full = true;
  else if (a === "--theme") opt.theme = v();
  else if (a === "--reduced-motion") opt.reduced = true;
  else if (a === "--selector") opt.selector = v();
  else if (a === "--eval") opt.evals.push(v());
  else if (["--click", "--drag", "--wheel", "--press"].includes(a)) opt.actions.push([a.slice(2), v()]);
  else { console.error("unknown option", a); process.exit(1); }
}
const cacheDir = path.join(os.homedir(), ".cache", "ms-playwright");
const chromeDir = process.env.CHROME_PATH ? null : fs.readdirSync(cacheDir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const executablePath = process.env.CHROME_PATH ?? path.join(cacheDir, chromeDir, "chrome-linux64", "chrome");
const url = /^https?:/.test(target) ? target : `http://localhost:${process.env.PORT ?? 3000}${target.startsWith("/") ? "" : "/"}${target}`;

const browser = await chromium.launch({
  executablePath,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const ctx = await browser.newContext({
  viewport: { width: opt.w, height: opt.h },
  deviceScaleFactor: 1,
  reducedMotion: opt.reduced ? "reduce" : "no-preference",
});
const page = await ctx.newPage();
if (opt.theme) {
  await page.addInitScript((t) => {
    try { localStorage.setItem("terratrend-theme", t); } catch {}
    const set = () => { if (document.documentElement) document.documentElement.dataset.theme = t; };
    set(); document.addEventListener("DOMContentLoaded", set);
  }, opt.theme);
}
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 500)); });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 500)));
page.on("requestfailed", (r) => console.log("[requestfailed]", r.url()));
page.on("response", (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}]`, r.url()); });

await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(opt.wait);
for (const [kind, raw] of opt.actions) {
  const n = raw.split(",").map(Number);
  if (kind === "click") await page.mouse.click(n[0], n[1]);
  if (kind === "drag") { await page.mouse.move(n[0], n[1]); await page.mouse.down(); await page.mouse.move(n[2], n[3], { steps: 12 }); await page.mouse.up(); }
  if (kind === "wheel") { await page.mouse.move(n[0], n[1]); await page.mouse.wheel(0, n[2]); }
  if (kind === "press") await page.keyboard.press(raw);
  await page.waitForTimeout(700);
}
for (const js of opt.evals) console.log("[eval]", JSON.stringify(await page.evaluate(js)));
if (opt.selector) await page.locator(opt.selector).first().screenshot({ path: out });
else await page.screenshot({ path: out, fullPage: opt.full });
console.log("saved", out);
await browser.close();
