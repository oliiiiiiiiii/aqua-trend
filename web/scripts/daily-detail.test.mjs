// Uses the running development server and mocked daily responses, never NASA credentials.
// DAILY_TEST_URL=http://localhost:4319 node scripts/daily-detail.test.mjs
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.DAILY_TEST_URL ?? "http://localhost:4319";
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const cacheDir = path.join(os.homedir(), ".cache", "ms-playwright");
const linuxChrome = existsSync(cacheDir) ? readdirSync(cacheDir).filter((entry) => /^chromium-\d+$/.test(entry)).sort().pop() : null;
const executablePath = process.env.CHROME_PATH ?? (existsSync(macChrome) ? macChrome : linuxChrome ? path.join(cacheDir, linuxChrome, "chrome-linux64", "chrome") : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
const query = (period = "2024-02..2024-02", tab = "soil") => `${base}/detective/?${new URLSearchParams({ e: "Daily detail test fixture", r: "b4-4040046370", t: period, v: "soil,tair,tws", tab })}`;
const observed = [];

function fixture(url, allNull = false) {
  const params = new URL(url).searchParams;
  const request = Object.fromEntries(["region", "layer", "start", "end"].map((key) => [key, params.get(key)]));
  const dates = [];
  for (let day = Date.parse(`${request.start}T00:00:00Z`); day <= Date.parse(`${request.end}T00:00:00Z`); day += 86_400_000) dates.push(new Date(day).toISOString().slice(0, 10));
  return {
    ...request, resolution: "daily", dates, values: dates.map((date) => allNull || date.endsWith("02") ? null : Number(date.slice(-2))),
    unit: "test-unit", source: { provider: "earthdata", dataset: `Browser test fixture ${request.layer}`, url: "https://example.org/daily-fixture", aggregation: "Test daily mean", spatialMethod: "Test basin mean" },
    retrievedAt: "2026-11-15T00:00:00Z",
  };
}

async function openPage(handler, { width = 1280, theme = "terrarium", failMonthly = false, period, tab } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript((value) => localStorage.setItem("terratrend-theme", value), theme);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route("**/api/daily-series/**", handler);
  if (failMonthly) await page.route("**/data/series/b4-4040046370.json", (route) => route.fulfill({ status: 500, json: { error: "Test monthly failure" } }));
  await page.goto(query(period, tab));
  await page.getByRole("tab", { name: /Soil moisture/ }).waitFor();
  return { context, page, errors, panel: page.getByRole("region", { name: "每日原始值", exact: true }) };
}

try {
  let calls = 0, failSecond = true;
  const partial = await openPage(async (route) => {
    calls++;
    await route.fulfill(failSecond && calls === 2
      ? { status: 503, json: { error: { code: "unconfigured", message: "Private authentication detail" } } }
      : { json: fixture(route.request().url()) });
  }, { width: 375, failMonthly: true });
  await partial.panel.getByRole("button", { name: "重試每日資料" }).waitFor();
  assert.match(await partial.panel.innerText(), /已取得 3 \/ 29 天/);
  assert.doesNotMatch(await partial.panel.innerText(), /Private authentication/);
  await partial.page.getByText("This variable could not be analysed", { exact: true }).waitFor();
  const summary = partial.panel.locator("summary");
  await summary.focus(); await partial.page.keyboard.press("Enter");
  assert.equal(await partial.panel.locator("details[open]").count(), 1);
  assert.equal(await partial.panel.getByRole("row", { name: "2024-02-02 缺值", exact: true }).count(), 1);
  assert.equal(await partial.panel.getByRole("row", { name: "2024-02-04 尚未載入", exact: true }).count(), 1);
  const chart = partial.panel.getByRole("group", { name: /^每日原始值折線圖/ });
  await chart.focus(); await partial.page.keyboard.press("End");
  assert.match(await chart.locator('[aria-live="polite"]').innerText(), /2024-02-29：尚未載入/);
  assert.ok(await chart.evaluate((element) => getComputedStyle(element).outlineStyle !== "none"));
  assert.equal(await partial.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await partial.panel.screenshot({ path: "/tmp/terratrend-daily-partial-mobile.png" });
  failSecond = false;
  await partial.panel.getByRole("button", { name: "重試每日資料" }).click();
  await partial.panel.getByText(/已取得的 29 天中/).waitFor();
  assert.equal(calls, 12);
  assert.match(await partial.panel.innerText(), /28 天有值，缺值 1 天/);
  assert.doesNotMatch(await partial.panel.innerText(), /尚未載入|Private authentication/);
  assert.deepEqual(partial.errors, []);
  observed.push("Mobile partial failure preserves three days; monthly failure does not block daily; table opens with Enter; chart keyboard navigation/focus work; retry completes all 29 leap-month days; no horizontal overflow.");
  await partial.context.close();

  let longCalls = 0;
  const long = await openPage((route) => { longCalls++; return route.fulfill({ json: fixture(route.request().url()) }); }, { period: "2024-01..2024-02" });
  await long.page.getByText(/事件期間縮至 1 個月以內/).waitFor();
  await long.page.waitForTimeout(650);
  assert.equal(longCalls, 0);
  await long.page.getByRole("tab", { name: /Terrestrial water storage/ }).click();
  await long.page.getByText(/尚未提供每日明細，以下使用月資料/).waitFor();
  await long.page.evaluate((url) => history.replaceState(null, "", url), query("2024-02..2024-02", "tws"));
  await long.page.waitForTimeout(650);
  assert.equal(longCalls, 0);
  assert.deepEqual(long.errors, []);
  observed.push("Long periods and unsupported products issue no daily requests.");
  await long.context.close();

  let futureCalls = 0;
  const future = await openPage((route) => { futureCalls++; return route.fulfill({ json: fixture(route.request().url()) }); }, { period: "2099-02..2099-02" });
  await future.panel.getByText(/尚無已結束的 UTC 日期/).waitFor();
  await future.page.waitForTimeout(650);
  assert.equal(futureCalls, 0);
  assert.deepEqual(future.errors, []);
  observed.push("A future month sends no daily requests and explains that no UTC day has completed.");
  await future.context.close();

  const empty = await openPage((route) => route.fulfill({ json: fixture(route.request().url(), true) }), { width: 375, theme: "night" });
  await empty.panel.getByText(/此期間沒有每日觀測值/).waitFor();
  assert.match(await empty.panel.innerText(), /0 天有值，缺值 29 天/);
  assert.equal(await empty.panel.getByRole("group", { name: /^每日原始值折線圖/ }).count(), 0);
  await empty.panel.locator("summary").click();
  assert.equal(await empty.panel.locator("tbody tr").count(), 29);
  assert.equal(await empty.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await empty.panel.screenshot({ path: "/tmp/terratrend-daily-empty-night-mobile.png" });
  assert.deepEqual(empty.errors, []);
  observed.push("All-null daily data shows no observations, never a zero line; dark mobile table displays all 29 days without overflow.");
  await empty.context.close();

  let release;
  const staleRequests = [];
  const stale = await openPage(async (route) => {
    const url = route.request().url();
    staleRequests.push(url);
    if (new URL(url).searchParams.get("layer") === "sm_root") {
      await new Promise((resolve) => { release = resolve; });
      await route.fulfill({ status: 503, json: { error: { code: "unconfigured", message: "Old request failure" } } }).catch(() => {});
    } else await route.fulfill({ json: fixture(url) });
  });
  while (!release) await stale.page.waitForTimeout(25);
  await stale.page.getByRole("tab", { name: /Air temperature/ }).click();
  await stale.panel.getByText(/已取得的 29 天中/).waitFor();
  release();
  await stale.page.waitForTimeout(100);
  assert.match(await stale.panel.innerText(), /Browser test fixture tair/);
  assert.equal(await stale.panel.getByRole("button", { name: "重試每日資料" }).count(), 0);
  assert.equal(staleRequests.filter((url) => new URL(url).searchParams.get("layer") === "sm_root").length, 1);
  await stale.panel.screenshot({ path: "/tmp/terratrend-daily-complete-desktop.png" });
  assert.deepEqual(stale.errors, []);
  observed.push("Switching tabs aborts the prior sequence; its late failure cannot replace the current product; complete desktop chart renders.");
  await stale.context.close();
  for (const result of observed) console.log(`PASS: ${result}`);
} finally {
  await browser.close();
}
