import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = process.env.AQUA_WEB_URL ?? "http://127.0.0.1:3000";
const output = process.env.AQUA_VISUAL_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(45000);
  await page.goto(root + "/explore?region=b3-4030015090");
  await page.getByLabel("What would you like to investigate?").fill("Drought");
  await page.getByRole("button", { name: "Start research", exact: true }).click();
  const download = page.getByRole("link", { name: "Export JSON" });
  await download.waitFor({ timeout: 120000 });
  const study = await (await page.request.get(new URL(await download.getAttribute("href"), root).href)).json();
  const id = study.identity.id;
  const selector = page.getByLabel("Visualized variable");
  await selector.selectOption("precip");
  const orbs = page.locator("#study-crystal-balls");
  const earth = page.locator("#study-trend-map");
  const slider = orbs.getByRole("slider", { name: "Timeline month" });
  await slider.focus();
  await slider.press("Home");
  const first = await slider.inputValue();
  const scenes = orbs.locator('[data-renderer="webgl"] canvas');
  await scenes.nth(2).waitFor();
  const startFrame = await scenes.nth(1).screenshot();
  await orbs.getByRole("button", { name: "Play timeline", exact: true }).click();
  await page.waitForFunction(start => {
    const range = document.querySelector('#study-crystal-balls input[type="range"]');
    return range && range.value !== start;
  }, first);
  await orbs.getByRole("button", { name: "Pause timeline", exact: true }).click();
  await slider.focus();
  await slider.press("End");
  assert.notEqual(await slider.inputValue(), first);
  assert.ok(!startFrame.equals(await scenes.nth(1).screenshot()), "The crystal's rendered contents should change across the fitted period");
  await orbs.getByRole("button", { name: "Monthly values", exact: true }).click();
  await orbs.getByRole("button", { name: "Fitted trend", exact: true }).click();
  if (output) {
    const bounds = await slider.boundingBox();
    await slider.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
    await orbs.screenshot({ path: join(output, "crystal-balls.png"), style: ".plane-cursor-layer {visibility: hidden !important}" });
  }

  async function checkGlobe(variableId) {
    await earth.scrollIntoViewIfNeeded();
    const response = await page.request.get(root + "/api/research/" + id + "/spatial?variable=" + variableId);
    assert.ok(response.ok(), "Spatial endpoint returned " + response.status());
    const map = await response.json();
    const variable = study.variables.find(item => item.variable_id === variableId);
    assert.equal(map.variable_id, variableId);
    assert.equal(map.product_id, variable.product.selected_product_id);
    assert.deepEqual(map.period, variable.analysis_period);
    assert.equal(map.selected.region_id, study.resolved.region_id);
    assert.equal(map.selected.slope_per_decade, variable.trend.slope_per_decade);
    const inspect = earth.getByLabel("Inspect a region");
    const peer = map.regions.find(row => row.region_id !== map.selected.region_id);
    assert.ok(peer, "Expected a second measured basin");
    await inspect.selectOption(peer.region_id);
    assert.equal(await inspect.inputValue(), peer.region_id);
    await earth.getByRole("application", { name: /^Earth trend map/ }).waitFor();
    await inspect.selectOption(map.selected.region_id);
    return map;
  }
  const mapped = await checkGlobe("precip");
  if (output) await earth.screenshot({ path: join(output, "trend-globe.png"), style: ".plane-cursor-layer {visibility: hidden !important}" });
  await selector.selectOption("soil_root");
  await checkGlobe("soil_root");
  await orbs.getByRole("slider", { name: "Timeline month" }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(root + "/explore?research=" + id);
  await slider.waitFor();
  await earth.scrollIntoViewIfNeeded();
  await earth.getByLabel("Inspect a region").waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ study_url: root + "/explore?research=" + id,
    mapped_regions: mapped.regions.length, period: mapped.period, product: mapped.product_id }));
} finally {
  await browser.close();
}
