import { setMonth } from "./research-month.mjs";
// Run against a local instance with the bundled prepared release.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const root = process.env.AQUA_WEB_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(30000);
  await page.goto(root);
  await page.getByRole("link", { name: "Start a study" }).click();
  await page.getByText("Drought", { exact: true }).first().waitFor({ state: "attached" });
  await page.locator("#phenomenon").fill("乾旱");
  await setMonth(page, "Start", "2005-01");
  await page.getByRole("button", { name: "Start research" }).click();
  await page.getByRole("alert").filter({ hasText: /both months/i }).waitFor();
  await page.getByRole("button", { name: "Clear period" }).click();
  await page.getByRole("button", { name: "Start research" }).click();
  const exportLink = page.getByRole("link", { name: "Export JSON" });
  await exportLink.waitFor({ timeout: 120000 });
  async function snapshot() {
    const path = await exportLink.getAttribute("href");
    const response = await page.request.get(new URL(path, root).href);
    assert.equal(response.status(), 200);
    return response.json();
  }
  const first = await snapshot();
  assert.equal(first.selection.phenomenon_id, "drought");
  assert.equal(first.resolved.region_source, "preset");
  assert.equal(first.resolved.period_source, "preset");
  assert.ok(first.indicators.some(r => r.kind === "recorded_event" && r.status === "data_required"));
  assert.ok(first.evidence_families.find(r => r.scope === "preset_search").candidate_count > 1);
  const chart = page.locator(".research-series").first();
  await chart.getByRole("button", { name: "Fixed seasonal pattern" }).click();
  await chart.getByRole("button", { name: "Anomalies and fit" }).click();
  await chart.getByText("View values in a table").click();
  await chart.getByRole("table").waitFor();
  await chart.locator("summary").filter({ hasText: /analysis period/i }).click();
  await setMonth(chart, "From", "2010-01");
  await setMonth(chart, "Through", "2020-12");
  const created = page.waitForResponse(r => r.url().endsWith("/api/research") && r.request().method() === "POST");
  await chart.getByRole("button", { name: "Apply range and rerun" }).click();
  const next = await (await created).json();
  await page.locator(`a[href*="${next.id}/export?format=json"]`).waitFor({ timeout: 90000 });
  const second = await snapshot();
  assert.notEqual(second.identity.id, first.identity.id);
  assert.equal(second.user_constraints.context.parent_research_id, first.identity.id);
  assert.deepEqual(second.resolved.period, { start: "2010-01", end: "2020-12" });
  assert.equal(second.resolved.period_source, "user");
  const csvUrl = await page.getByRole("link", { name: "Export CSV" }).getAttribute("href");
  const csv = await (await page.request.get(new URL(csvUrl, root).href)).text();
  assert.ok(csv.includes(second.selection.selection_plan_id));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(root + "/explore?research=" + first.identity.id);
  await exportLink.waitFor();
  assert.equal((await snapshot()).identity.id, first.identity.id);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByRole("button", { name: "Choose a region" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: /Taiwan/i }).first().focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await page.getByRole("button", { name: "Clear region" }).isVisible());
  assert.deepEqual(errors, []);
  console.log("PASS: bilingual study, validation, ranked preset, evidence, chart rerun, exports, history, mobile region selection.");
} finally {
  await browser.close();
}
