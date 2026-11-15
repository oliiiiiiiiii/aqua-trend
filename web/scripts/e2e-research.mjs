// End-to-end check of the /research page against a RUNNING backend (acceptance §8; P01–P04, S05, D01, D02).
//
//   1. build the site:      npm run build                       (static export in ./out)
//   2. start the backend:   cd ../backend && AQUA_SELECTOR=catalogue_lexical .venv/bin/python -m aqua_trend
//   3. run:                 node scripts/e2e-research.mjs
//
// Environment
//   E2E_API_BASE     where the backend really listens            (default http://localhost:8000)
//   E2E_BAKED_API    NEXT_PUBLIC_API_BASE the site was built with (default http://localhost:8000)
//                    When the two differ, the script forwards the page's API calls to E2E_API_BASE.
//   E2E_PORT         port of the built-in static server for ./out (default 3000; must be allowed by the
//                    backend's CORS list: localhost / 127.0.0.1 on 3000, 3001 or 5000 unless AQUA_CORS_ORIGINS is set)
//   E2E_SITE_URL     use an already running site instead of the built-in server
//   E2E_ONLY         comma-separated scenario names to run (default: all)
//   E2E_TIMEOUT_MS   how long one analysis may take               (default 300000)
//   PLAYWRIGHT_BROWSERS_PATH  where `npx playwright install firefox` put the browser
//
// Browser: Playwright's own Firefox build. The system /usr/bin/firefox cannot be driven by playwright-core
// (it lacks Playwright's remote protocol), so install the bundled build once:  npx playwright-core install firefox
//
// The script never fakes the backend's numbers. It only (a) forwards, (b) delays or (c) blocks real requests to
// reproduce slow / unreachable conditions. Screenshots go to ./test-results (git-ignored).
import { firefox } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../out");
const SHOTS = path.resolve(here, "../test-results");
const API = (process.env.E2E_API_BASE ?? "http://localhost:8000").replace(/\/+$/, "");
const BAKED = (process.env.E2E_BAKED_API ?? "http://localhost:8000").replace(/\/+$/, "");
const PORT = Number(process.env.E2E_PORT ?? 3000);
const RUN_TIMEOUT = Number(process.env.E2E_TIMEOUT_MS ?? 300000);
const ONLY = process.env.E2E_ONLY ? new Set(process.env.E2E_ONLY.split(",").map((s) => s.trim())) : null;

const QUERY = "drought in Europe 2022"; // place and date words that must NOT become conditions (S05)
const REGION = { search: "Sahel", id: "named-sahel" };
const PERIOD = { start: "2001-01", end: "2020-12" };

/* ------------------------------------------------------------------ tiny static server for ./out */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain", ".geojson": "application/json" };
function serveOut() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(OUT, p);
    if (!file.startsWith(OUT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

/* ------------------------------------------------------------------ bookkeeping */
const results = [];
const note = (name, status, detail = "") => { results.push({ name, status, detail }); console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ""}`); };
class Skip extends Error {}
function check(cond, message) { if (!cond) throw new Error(message); }

async function main() {
  // the backend must really be there: this script has no stand-in for it
  let health;
  try {
    health = await (await fetch(`${API}/api/health`)).json();
  } catch (e) {
    console.error(`Backend not reachable at ${API} (${e.message}). Start it first; nothing was tested.`);
    process.exit(2);
  }
  console.log(`backend ${API}: ${health.api_version}, selector ${health.selector?.provider} (language model: ${health.selector?.is_language_model}), preset engine: ${health.presets?.engine_available}`);
  if (!fs.existsSync(path.join(OUT, "research", "index.html")) && !process.env.E2E_SITE_URL) {
    console.error("./out/research/index.html is missing. Run `npm run build` first.");
    process.exit(2);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = process.env.E2E_SITE_URL ? null : await serveOut();
  const SITE = (process.env.E2E_SITE_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");

  const browser = await firefox.launch({ headless: true });
  const consoleErrors = [];

  /** network conditions applied to the page's API calls */
  const net = { down: false, delay: /** @type {null | ((req: import("playwright-core").Request) => number)} */ (null) };
  const posts = []; // bodies of POST /api/research, in order
  const accepted = []; // research ids returned by POST, in order

  async function newPage(viewport) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await page.route(`${BAKED}/**`, async (route) => {
      const req = route.request();
      if (net.down) return route.abort("connectionrefused");
      const wait = net.delay ? net.delay(req) : 0;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const isCreate = req.method() === "POST" && new URL(req.url()).pathname === "/api/research";
      if (isCreate) posts.push(JSON.parse(req.postData() ?? "null"));
      try {
        if (API === BAKED && !isCreate) return await route.continue();
        const response = await route.fetch({ url: req.url().replace(BAKED, API) });
        if (isCreate && response.status() === 202) accepted.push((await response.json()).research_id);
        await route.fulfill({ response });
      } catch { /* the page navigated away or aborted the request */ }
    });
    return page;
  }

  const form = (page) => page.getByTestId("research-form");
  async function fillForm(page, { q, region, from, to }) {
    if (q !== undefined) await form(page).locator('input[name="q"]').fill(q);
    if (region === null) { if (await page.getByTestId("clear-region").count()) await page.getByTestId("clear-region").click(); }
    else if (region) {
      const search = form(page).getByRole("combobox");
      await search.fill(region.search);
      await page.locator(`[role="option"]`).first().waitFor();
      await search.press("Enter");
      await page.locator(`[data-testid="chosen-region"][data-region="${region.id}"]`).waitFor();
    }
    if (from !== undefined) await form(page).locator('input[name="from"]').fill(from);
    if (to !== undefined) await form(page).locator('input[name="to"]').fill(to);
  }
  /** press Start and wait for a result that belongs to a NEW research id */
  async function runAndWait(page, previousId = null) {
    await page.getByTestId("start").click();
    await page.waitForFunction(
      (prev) => {
        const r = document.querySelector('[data-testid="result"]');
        const err = document.querySelector('[data-testid="run-error"]');
        const p = document.querySelector('[data-testid="progress"]');
        const ended = p && ["complete", "partial", "failed", "cancelled"].includes(p.getAttribute("data-status"));
        return !!err || (ended && (!r || r.getAttribute("data-research-id") !== prev));
      },
      previousId,
      { timeout: RUN_TIMEOUT },
    );
    return readState(page);
  }
  const readState = (page) => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const attr = (s, a) => q(s)?.getAttribute(a) ?? null;
    return {
      status: attr('[data-testid="progress"]', "data-status"),
      errorCode: attr('[data-testid="run-error"]', "data-code"),
      researchId: attr('[data-testid="result"]', "data-research-id"),
      regionSource: attr('[data-testid="resolved-region"]', "data-source"),
      regionId: attr('[data-testid="resolved-region"]', "data-region"),
      periodSource: attr('[data-testid="resolved-period"]', "data-source"),
      periodStart: attr('[data-testid="resolved-period"]', "data-start"),
      periodEnd: attr('[data-testid="resolved-period"]', "data-end"),
      variables: [...document.querySelectorAll('[data-testid="variable-card"]')].map((c) => ({
        id: c.getAttribute("data-variable"),
        status: c.getAttribute("data-status"),
        slope: c.querySelector('[data-testid="slope-decade"]')?.textContent?.trim() ?? null,
        ci: c.querySelector('[data-testid="ci"]')?.textContent?.trim() ?? null,
        label: c.querySelector('[data-testid="significance"]')?.getAttribute("data-label") ?? null,
        labelText: c.querySelector('[data-testid="significance"]')?.textContent?.trim() ?? null,
      })),
      indicators: [...document.querySelectorAll('[data-testid="indicator-card"]')].map((c) => ({
        id: c.getAttribute("data-indicator"), kind: c.getAttribute("data-kind"), status: c.getAttribute("data-status"),
      })),
      text: document.body.innerText,
      url: location.href,
    };
  });
  const shot = async (page, name, fullPage = true) => {
    const file = path.join(SHOTS, name);
    const rel = (f) => path.relative(path.resolve(here, ".."), f);
    if (!fullPage) { await page.screenshot({ path: file }); return rel(file); }
    // Firefox refuses images taller than 32767 px; a long result page is saved as consecutive parts
    const TILE = 16000;
    const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    if (size.h <= TILE) { await page.screenshot({ path: file, fullPage: true }); return rel(file); }
    const parts = [];
    for (let y = 0, i = 1; y < size.h; y += TILE, i++) {
      const part = file.replace(/\.png$/, `-part${i}.png`);
      await page.screenshot({ path: part, fullPage: true, clip: { x: 0, y, width: size.w, height: Math.min(TILE, size.h - y) } });
      parts.push(rel(part));
    }
    return parts.join(", ");
  };
  async function scenario(name, fn) {
    if (ONLY && !ONLY.has(name)) return;
    try {
      const detail = await fn();
      note(name, "PASS", detail ?? "");
    } catch (e) {
      if (e instanceof Skip) note(name, "SKIP", e.message);
      else note(name, "FAIL", String(e.message ?? e).split("\n")[0]);
    }
  }

  const desktop = await newPage({ width: 1440, height: 900 });
  await desktop.goto(`${SITE}/research/`);
  await form(desktop).waitFor();
  let last = null; // state of the latest finished result on the desktop page

  /* ---------------------------------------------------------------- 1. both fields (P04, S05, D01) */
  await scenario("both-fields", async () => {
    await fillForm(desktop, { q: QUERY, region: REGION, from: PERIOD.start, to: PERIOD.end });
    check(await desktop.getByTestId("selector-note").isVisible(), "the note that place and time come from the selectors is not visible");
    const n = posts.length;
    const s = await runAndWait(desktop);
    check(!s.errorCode, `run error ${s.errorCode}`);
    check(["complete", "partial"].includes(s.status), `job ended as ${s.status}`);
    const body = posts[n];
    check(body.region_id === REGION.id, `request region_id is ${body.region_id}`);
    check(body.period?.start === PERIOD.start && body.period?.end === PERIOD.end, "request period differs from the selector");
    check(s.regionSource === "user" && s.regionId === REGION.id, `resolved region ${s.regionId} (${s.regionSource})`);
    check(s.periodSource === "user" && s.periodStart === PERIOD.start && s.periodEnd === PERIOD.end, `resolved period ${s.periodStart}..${s.periodEnd} (${s.periodSource})`);
    check(s.variables.length > 0, "no variable card");
    check(s.variables.some((v) => v.slope), "no slope shown");
    check(s.variables.every((v) => v.status !== "ok" || v.label), "an analysed variable has no significance label");
    check(/roles describe why a variable was chosen/i.test(s.text), "the roles-are-not-causal statement is missing");
    check(/pointwise/i.test(s.text), "the confidence interval is not labelled pointwise");
    // undetermined must never be worded as "not significant"
    for (const v of s.variables.filter((x) => x.label === "undetermined")) check(!/not significant/i.test(v.labelText), `${v.id}: undetermined is worded as not significant`);
    last = s;
    const file = await shot(desktop, "research-desktop-both.png");
    return `${s.status}; ${s.variables.length} variables (${s.variables.filter((v) => v.status === "ok").length} analysed), ${s.indicators.length} indicators; ${file}`;
  });

  /* ---------------------------------------------------------------- 1b. indicators and export of the same run */
  await scenario("indicators-and-export", async () => {
    check(last?.researchId, "needs the result of both-fields");
    const kinds = new Set(last.indicators.map((i) => i.kind));
    check(last.indicators.length > 0, "no indicator card");
    check(/Derived indicator|Recorded events/.test(last.text), "indicator kind tags are missing");
    const pending = last.indicators.filter((i) => i.status === "data_required");
    if (pending.length) check(/nothing is assumed to be zero/i.test(last.text), "a data_required indicator does not say that nothing is assumed to be zero");
    const json = await (await fetch(`${API}/api/research/${last.researchId}/export?format=json`)).json();
    const exported = json.result ?? json;
    check((exported.identity?.research_id ?? json.research_id) === last.researchId, "JSON export is for another research");
    const csv = await (await fetch(`${API}/api/research/${last.researchId}/export?format=csv`)).text();
    check(csv.length > 100, "CSV export is empty");
    // the page shows the same slope the export carries (same snapshot)
    const shown = last.variables.find((v) => v.slope);
    const ev = (exported.variables ?? []).find((v) => v.variable_id === shown.id);
    const num = Number(shown.slope.replace("−", "-").replace(/,/g, "").match(/[+-]?\d+(\.\d+)?/)[0]);
    const want = ev.trend.slope_per_decade;
    check(Math.abs(num - want) <= Math.max(1e-6, Math.abs(want) * 0.006), `${shown.id}: page ${num} vs export ${want}`);
    const [dl] = await Promise.all([desktop.waitForEvent("download", { timeout: 30000 }), desktop.getByTestId("export-csv").click()]);
    return `kinds: ${[...kinds].join(", ")}; data_required: ${pending.map((i) => i.id).join(", ") || "none"}; slope of ${shown.id} matches the JSON export; CSV download ${dl.suggestedFilename()}`;
  });

  /* ---------------------------------------------------------------- 2. keyboard brush on a chart, then apply (acceptance §8) */
  await scenario("apply-brushed-period", async () => {
    check(last?.researchId, "needs the result of both-fields");
    const before = last;
    const card = desktop.locator('[data-testid="variable-card"][data-status="ok"]').first();
    const chart = card.getByRole("slider").first();
    await chart.scrollIntoViewIfNeeded();
    // pointer: drag across the middle of the plot
    const hit = card.getByTestId("plot-hit").first();
    const box = await hit.boundingBox();
    await desktop.mouse.move(box.x + box.width * 0.62, box.y + box.height / 2);
    await desktop.mouse.down();
    await desktop.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2, { steps: 6 });
    await desktop.mouse.move(box.x + box.width * 0.86, box.y + box.height / 2, { steps: 6 });
    await desktop.mouse.up();
    await desktop.getByTestId("brush-summary").waitFor();
    const from = await desktop.locator('input[name="brush-from"]').inputValue();
    const to = await desktop.locator('input[name="brush-to"]').inputValue();
    check(/^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to) && from < to, `brush fields ${from}..${to}`);
    // selecting alone must not change any number
    const mid = await readState(desktop);
    check(mid.researchId === before.researchId && mid.periodStart === before.periodStart, "selecting a range changed the result");
    check(JSON.stringify(mid.variables.map((v) => v.slope)) === JSON.stringify(before.variables.map((v) => v.slope)), "selecting a range changed a slope");
    await shot(desktop, "research-desktop-brush.png", false);
    const n = posts.length;
    await desktop.getByTestId("apply-period").click();
    await desktop.waitForFunction((prev) => {
      const r = document.querySelector('[data-testid="result"]');
      return !!document.querySelector('[data-testid="run-error"]') || (r && r.getAttribute("data-research-id") !== prev);
    }, before.researchId, { timeout: RUN_TIMEOUT });
    const s = await readState(desktop);
    check(!s.errorCode, `run error ${s.errorCode}`);
    const body = posts[n];
    check(body.period.start === from && body.period.end === to, "the new request does not carry the brushed period");
    check(body.context.parent_research_id === before.researchId, "parent_research_id is not the previous research");
    check(body.context.preset_ref == null, "preset_ref was not cleared");
    check(body.region_id === REGION.id, "the user's region was not kept");
    check(s.researchId !== before.researchId, "no new research was created");
    check(s.periodSource === "user" && s.periodStart === from && s.periodEnd === to, `analysis period is ${s.periodStart}..${s.periodEnd} (${s.periodSource})`);
    const a = before.variables.find((v) => v.slope), b = s.variables.find((v) => v.id === a.id);
    check(await form(desktop).locator('input[name="from"]').inputValue() === from, "the period selector does not show the applied period");
    last = s;
    return `brushed ${from}..${to}; new research ${s.researchId}; ${a.id} slope "${a.slope}" -> "${b?.slope ?? "none"}", CI "${a.ci}" -> "${b?.ci ?? "none"}"`;
  });

  await scenario("keyboard-selection", async () => {
    check(last?.researchId, "needs a result");
    const chart = desktop.locator('[data-testid="variable-card"][data-status="ok"]').first().getByRole("slider").first();
    await chart.focus();
    await chart.press("Home");
    for (let i = 0; i < 3; i++) await chart.press("Shift+ArrowRight");
    await chart.press("[");
    for (let i = 0; i < 12; i++) await chart.press("Shift+ArrowRight");
    await chart.press("]");
    await desktop.getByTestId("brush-summary").waitFor();
    const from = await desktop.locator('input[name="brush-from"]').inputValue();
    const to = await desktop.locator('input[name="brush-to"]').inputValue();
    check(from < to, `keyboard selection ${from}..${to}`);
    const value = await chart.getAttribute("aria-valuetext");
    await chart.press("Escape");
    check(await desktop.getByTestId("brush-summary").count() === 0, "Escape did not clear the selection");
    // the table alternative holds the same series
    const table = desktop.locator('[data-testid="variable-card"][data-status="ok"]').first().locator("details", { hasText: "Data table" }).first();
    await table.locator("summary").click();
    check(await table.locator("tbody tr").count() > 12, "the data table has no rows");
    await table.locator("summary").click();
    return `selected ${from}..${to} with the keyboard; cursor read-out "${value}"`;
  });

  /* ---------------------------------------------------------------- 3. region only (P02) */
  await scenario("region-only", async () => {
    await fillForm(desktop, { q: "drought", region: REGION, from: "", to: "" });
    const n = posts.length;
    const s = await runAndWait(desktop, last?.researchId ?? null);
    check(!s.errorCode, `run error ${s.errorCode}`);
    const body = posts[n];
    check(body.region_id === REGION.id && body.period === null, `request was region ${body.region_id}, period ${JSON.stringify(body.period)}`);
    check(s.regionSource === "user" && s.regionId === REGION.id, "the user's region changed");
    last = s.researchId ? s : last;
    const file = await shot(desktop, "research-desktop-region-only.png");
    if (s.periodSource === "preset") return `period suggested by a preset: ${s.periodStart}..${s.periodEnd}; ${file}`;
    check(/No preset matches the conditions you set/.test(s.text), "no preset period and no no_matching_preset explanation");
    return `no_matching_preset shown, region kept (preset engine available: ${health.presets?.engine_available}); ${file}`;
  });

  /* ---------------------------------------------------------------- 4. nothing filled (P01) */
  await scenario("nothing-filled", async () => {
    await fillForm(desktop, { q: "drought", region: null, from: "", to: "" });
    check(await desktop.getByTestId("no-region").isVisible(), "the form does not say that no region is chosen");
    const n = posts.length;
    const s = await runAndWait(desktop, last?.researchId ?? null);
    check(!s.errorCode, `run error ${s.errorCode}`);
    const body = posts[n];
    check(body.region_id === null && body.period === null, "the request carries a region or period the user did not choose");
    last = s.researchId ? s : last;
    const file = await shot(desktop, "research-desktop-nothing.png");
    if (s.regionSource === "preset" && s.periodSource === "preset") {
      check(await desktop.getByTestId("preset").count() > 0, "preset reasons are not shown");
      check(await desktop.getByTestId("no-region").isVisible(), "a preset region leaked into the user's region selector");
      return `preset filled region ${s.regionId} and period ${s.periodStart}..${s.periodEnd}; ${file}`;
    }
    check(/No preset matches the conditions you set/.test(s.text), "blanks were not filled and no_matching_preset is not explained");
    return `no_matching_preset shown (preset engine available: ${health.presets?.engine_available}); ${file}`;
  });

  /* ---------------------------------------------------------------- 5. invalid period keeps the input */
  await scenario("invalid-period", async () => {
    await fillForm(desktop, { q: "drought", region: REGION, from: "2005-01", to: "" });
    const n = posts.length;
    await desktop.getByTestId("start").click();
    await desktop.getByTestId("period-error").waitFor();
    const message = (await desktop.getByTestId("period-error").innerText()).trim();
    check(posts.length === n, "a request was sent with half a period");
    check(await form(desktop).locator('input[name="from"]').inputValue() === "2005-01", "the typed month was lost");
    check(await form(desktop).locator('input[name="q"]').inputValue() === "drought", "the phenomenon text was lost");
    await fillForm(desktop, { from: "2010-01", to: "2005-01" });
    await desktop.getByTestId("start").click();
    await desktop.getByTestId("period-error").waitFor();
    check(posts.length === n, "a request was sent with start after end");
    await shot(desktop, "research-desktop-invalid-period.png", false);
    await desktop.getByTestId("clear-period").click();
    check(await desktop.getByTestId("period-error").count() === 0, "clearing the period did not clear the error");
    return `"${message}"`;
  });

  /* ---------------------------------------------------------------- 6. stale responses are dropped */
  await scenario("stale-response", async () => {
    // A is slow to be accepted; B is started while A is still pending. A must never reach the page.
    await fillForm(desktop, { q: "drought", region: REGION, from: PERIOD.start, to: PERIOD.end });
    const n = accepted.length, m = posts.length;
    let slowed = false;
    net.delay = (req) => {
      if (!slowed && req.method() === "POST" && new URL(req.url()).pathname === "/api/research") { slowed = true; return 4000; }
      return 0;
    };
    await desktop.getByTestId("start").click(); // A
    await fillForm(desktop, { q: "warming", from: "2003-01", to: "2022-12" });
    await desktop.getByTestId("start").click(); // B
    await desktop.waitForFunction((prev) => {
      const r = document.querySelector('[data-testid="result"]');
      return !!document.querySelector('[data-testid="run-error"]') || (r && r.getAttribute("data-research-id") !== prev);
    }, last?.researchId ?? null, { timeout: RUN_TIMEOUT });
    await desktop.waitForTimeout(6000); // long enough for A's late acceptance and any of its polls
    net.delay = null;
    const s = await readState(desktop);
    check(!s.errorCode, `run error ${s.errorCode}`);
    check(posts.length === m + 2, `expected 2 requests, saw ${posts.length - m}`);
    const ids = accepted.slice(n);
    const bBody = posts.find((p, i) => i >= m && p.phenomenon_query === "warming");
    check(bBody, "request B was not sent");
    check(s.periodStart === "2003-01" && s.periodEnd === "2022-12", `the page shows period ${s.periodStart}..${s.periodEnd}, not B's`);
    check(/warming/i.test(await desktop.getByTestId("selector-info").innerText()), "the page does not show B's phenomenon");
    check(await form(desktop).locator('input[name="q"]').inputValue() === "warming", "the form was overwritten by the older request");
    const aJob = ids.length === 2 ? await (await fetch(`${API}/api/research/${ids.find((id) => id !== s.researchId)}`)).json() : null;
    last = s;
    return `page shows research ${s.researchId} (B); the superseded request ended on the backend as "${aJob?.status ?? "unknown"}"`;
  });

  /* ---------------------------------------------------------------- 7. cancel */
  await scenario("cancel", async () => {
    await fillForm(desktop, { q: "drought", region: null, from: "", to: "" });
    net.delay = (req) => (req.method() === "GET" && /\/api\/research\/rs_/.test(req.url()) ? 600 : 0); // keep it running long enough to press Cancel
    await desktop.getByTestId("start").click();
    try {
      await desktop.getByTestId("cancel").click({ timeout: 15000 });
    } catch {
      net.delay = null;
      throw new Skip("the analysis finished before Cancel could be pressed");
    }
    net.delay = null;
    await desktop.waitForFunction(() => {
      const p = document.querySelector('[data-testid="progress"]');
      return p && ["complete", "partial", "failed", "cancelled"].includes(p.getAttribute("data-status"));
    }, null, { timeout: RUN_TIMEOUT });
    const s = await readState(desktop);
    if (s.status !== "cancelled") throw new Skip(`the job ended as ${s.status} before the cancellation took effect`);
    check(/Cancelled\. No final corrected result/.test(s.text), "the cancelled state is not explained");
    check(await form(desktop).locator('input[name="q"]').inputValue() === "drought", "inputs were lost on cancel");
    await shot(desktop, "research-desktop-cancelled.png", false);
    return "cancelled state shown, inputs kept";
  });

  /* ---------------------------------------------------------------- 8. backend down: retryable error, inputs kept, no fake data */
  await scenario("backend-down", async () => {
    await fillForm(desktop, { q: "drought", region: REGION, from: PERIOD.start, to: PERIOD.end });
    net.down = true;
    await desktop.getByTestId("start").click();
    await desktop.locator('[data-testid="run-error"][data-code="backend_unreachable"]').waitFor({ timeout: 30000 });
    const s = await readState(desktop);
    check(s.variables.length === 0 && !s.researchId, "numbers are shown although the backend is unreachable");
    check(await form(desktop).locator('input[name="q"]').inputValue() === "drought", "the phenomenon text was lost");
    check(await form(desktop).locator('input[name="from"]').inputValue() === PERIOD.start, "the period was lost");
    check(await desktop.locator(`[data-testid="chosen-region"][data-region="${REGION.id}"]`).count() === 1, "the region was lost");
    const file = await shot(desktop, "research-desktop-backend-down.png", false);
    net.down = false;
    await desktop.getByTestId("retry").click();
    await desktop.waitForFunction(() => !!document.querySelector('[data-testid="result"]') || !!document.querySelector('[data-testid="run-error"]'), null, { timeout: RUN_TIMEOUT });
    const after = await readState(desktop);
    check(!after.errorCode && after.regionId === REGION.id, `retry ended with ${after.errorCode ?? after.status}`);
    last = after;
    return `error shown with inputs kept; retry produced research ${after.researchId}; ${file}`;
  });

  /* ---------------------------------------------------------------- 9. region with a boundary but no series (D02) */
  await scenario("region-without-series", async () => {
    const list = await (await fetch(`${API}/api/catalogue/regions`)).json();
    const target = list.regions.find((r) => r.series_available === false && r.type !== "hex") ?? list.regions.find((r) => r.series_available === false);
    if (!target) throw new Skip("every catalogue region has a prepared series");
    await fillForm(desktop, { q: "drought", region: { search: target.id, id: target.id }, from: PERIOD.start, to: PERIOD.end });
    await desktop.locator('[data-testid="region-availability"][data-state="no_series"]').waitFor({ timeout: 20000 });
    const s = await runAndWait(desktop, last?.researchId ?? null);
    check(!s.errorCode, `run error ${s.errorCode}`);
    check(s.regionId === target.id && s.regionSource === "user", `the region became ${s.regionId}`);
    check(s.variables.length > 0, "variables are hidden instead of shown with a reason");
    check(s.variables.every((v) => v.status !== "ok" && !v.slope), "a variable shows numbers for a region without series");
    const file = await shot(desktop, "research-desktop-no-series.png");
    last = s.researchId ? s : last;
    return `${target.id}: ${s.variables.length} variables kept visible as ${[...new Set(s.variables.map((v) => v.status))].join(", ")}; ${file}`;
  });

  /* ---------------------------------------------------------------- 10. mobile: reload by id, results before the globe */
  await scenario("mobile-layout", async () => {
    check(last?.researchId, "needs a result");
    const target = (await readState(desktop)).url;
    const mobile = await newPage({ width: 390, height: 844 });
    await mobile.goto(target);
    await mobile.getByTestId("result").waitFor({ timeout: RUN_TIMEOUT });
    const order = await mobile.evaluate(() => {
      const top = (s) => document.querySelector(s).getBoundingClientRect().top + window.scrollY;
      return { form: top('[data-testid="research-form"]'), conditions: top('[data-testid="conditions"]'), result: top('[data-testid="result"]'), globe: top("#research-globe"), overflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    check(order.form < order.conditions && order.conditions < order.globe && order.result < order.globe, `order on mobile: ${JSON.stringify(order)}`);
    check(order.overflow <= 1, `the page scrolls sideways by ${order.overflow}px`);
    const id = await mobile.getByTestId("result").getAttribute("data-research-id");
    check(id === last.researchId, "the link reopened a different research");
    const file = await shot(mobile, "research-mobile.png");
    await mobile.context().close();
    return `link ${target.replace(SITE, "")} reopened the same research; conditions and results come before the globe; ${file}`;
  });

  /* ---------------------------------------------------------------- 11. navigation and the labelled old demo */
  await scenario("navigation", async () => {
    const page = await newPage({ width: 1280, height: 800 });
    await page.goto(`${SITE}/`);
    const first = await page.locator('nav[aria-label="Main"] a').first().innerText();
    check(first.trim() === "Research", `first nav item is "${first}"`);
    check(await page.locator('main a[href^="/research"]').first().isVisible(), "the home page has no Research call to action");
    await page.goto(`${SITE}/explore/`);
    await page.getByText("Earlier GLDAS demo, kept for reference.").waitFor();
    check(/synthetic examples/.test(await page.locator("aside").first().innerText()), "the demo banner does not say the leads are synthetic");
    const file = await shot(page, "explore-banner.png", false);
    await page.context().close();
    return file;
  });

  await desktop.context().close();
  await browser.close();
  server?.close();

  const relevant = consoleErrors.filter((e) => !/WebGL|webgl|NS_ERROR_CONNECTION_REFUSED|NetworkError|Failed to load resource|Cross-Origin Request Blocked/i.test(e));
  console.log(`\nconsole errors: ${consoleErrors.length} (${relevant.length} not related to WebGL or the deliberately blocked requests)`);
  for (const e of relevant.slice(0, 10)) console.log(`  ${e.slice(0, 300)}`);
  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`\n${results.filter((r) => r.status === "PASS").length} passed, ${failed.length} failed, ${results.filter((r) => r.status === "SKIP").length} skipped`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
