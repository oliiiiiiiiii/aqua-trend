import { setMonth, getMonth } from "./research-month.mjs";
// Run against a local web instance; only research requests are replaced with deterministic responses.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const root = process.env.AQUA_WEB_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function queued(id, request) {
  return { id, request, status: "queued", stage: "selecting" };
}

function complete(id, request) {
  return {
    id, request, status: "complete", stage: "complete",
    result: {
      identity: { id, status: "complete", created_at: "2026-01-01T00:00:00Z" },
      user_constraints: request,
      selection: { phenomenon: request.phenomenon_query, variable_set: [] },
      resolved: { region_id: request.region_id, period: request.period },
      comparison: {}, variables: [], indicators: [], evidence_families: [], summary: [], warnings: [],
    },
  };
}

async function json(route, body) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function flushUI(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function scenario(name, handler, run) {
  const context = await browser.newContext({ viewport: { width: 800, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route(/\/api\/research(?:\/[^?]*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const entry = { method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() };
    requests.push(entry);
    try {
      await handler(route, entry);
    } catch (error) {
      errors.push(error.message);
      await route.abort().catch(() => {});
    }
  });
  try {
    await page.goto(root + "/explore?region=named-taiwan-main-island");
    await page.locator("#phenomenon").waitFor();
    await run(page, requests);
    assert.deepEqual(errors, [], `${name}: browser and route errors`);
    console.log(`PASS: ${name}`);
  } finally {
    await context.close();
  }
}

try {
  const oldPoll = deferred();
  const releaseOld = deferred();
  const oldFulfilled = deferred();
  const oldDeleted = deferred();
  let firstRequest;
  let secondRequest;
  await scenario("a late result cannot overwrite an edited phenomenon or the newer study", async (route, request) => {
    if (request.method === "POST") {
      if (!firstRequest) {
        firstRequest = request.body;
        return json(route, queued("race-old", firstRequest));
      }
      assert.equal(secondRequest, undefined, "Only two studies should be created");
      secondRequest = request.body;
      return json(route, queued("race-new", secondRequest));
    }
    if (request.method === "DELETE" && request.path === "/api/research/race-old") {
      await json(route, { id: "race-old", status: "cancelled", stage: "cancelled" });
      oldDeleted.resolve();
      return;
    }
    if (request.method === "GET" && request.path === "/api/research/race-old") {
      oldPoll.resolve();
      await releaseOld.promise;
      await json(route, complete("race-old", firstRequest));
      oldFulfilled.resolve();
      return;
    }
    assert.equal(request.path, "/api/research/race-new");
    assert.equal(request.method, "GET");
    await json(route, complete("race-new", secondRequest));
  }, async (page) => {
    await page.locator("#phenomenon").fill("Original drought study");
    await page.getByRole("button", { name: "Start research", exact: true }).click();
    await within(oldPoll.promise, "the original study poll");
    await page.locator("#phenomenon").fill("Updated seasonal snow study");
    await within(oldDeleted.promise, "obsolete study cancellation");
    assert.equal(await page.locator(".study-results").count(), 0);
    await page.getByRole("button", { name: "Start research", exact: true }).click();
    await page.getByRole("heading", { name: "Updated seasonal snow study", exact: true }).waitFor();
    releaseOld.resolve();
    await within(oldFulfilled.promise, "the late original response");
    await flushUI(page);
    assert.equal(await page.locator("#phenomenon").inputValue(), "Updated seasonal snow study");
    assert.equal(await page.locator("#results-heading").textContent(), "Updated seasonal snow study");
    assert.match(await page.getByRole("link", { name: "Export JSON" }).getAttribute("href"), /race-new/);
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem("aqua-trend-research-history-v1") ?? "[]"));
    assert.deepEqual(history.map((row) => row.id), ["race-new"]);
  });

  const creationSeen = deferred();
  const releaseCreation = deferred();
  const orphanDeleted = deferred();
  await scenario("cancelling before creation returns cancels the late job without polling it", async (route, request) => {
    if (request.method === "POST") {
      creationSeen.resolve();
      await releaseCreation.promise;
      return json(route, queued("cancel-before-created", request.body));
    }
    assert.equal(request.method, "DELETE", "A cancelled creation must never be polled");
    assert.equal(request.path, "/api/research/cancel-before-created");
    await json(route, { id: "cancel-before-created", status: "cancelled", stage: "cancelled" });
    orphanDeleted.resolve();
  }, async (page, requests) => {
    await page.locator("#phenomenon").fill("Drought to cancel");
    await setMonth(page, "Start", "2005-01");
    await setMonth(page, "End", "2015-12");
    await page.getByRole("button", { name: "Start research", exact: true }).click();
    await within(creationSeen.promise, "creation to begin");
    await page.getByRole("button", { name: "Cancel study", exact: true }).click();
    await page.getByText("Study cancelled. Your input is ready for another run.", { exact: true }).waitFor();
    releaseCreation.resolve();
    await within(orphanDeleted.promise, "cancellation of the late-created study");
    await flushUI(page);
    assert.equal(await page.locator("#phenomenon").inputValue(), "Drought to cancel");
    assert.equal(await getMonth(page, "Start"), "2005-01");
    assert.equal(await getMonth(page, "End"), "2015-12");
    assert.equal(await page.getByRole("button", { name: "Clear region", exact: true }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "Start research", exact: true }).isEnabled(), true);
    assert.equal(await page.locator(".study-results").count(), 0);
    assert.deepEqual(requests.map((request) => request.method), ["POST", "DELETE"]);
  });

  const retryRequests = [];
  await scenario("a retryable selector failure preserves all fields and retries the same request", async (route, request) => {
    if (request.method === "POST") {
      retryRequests.push(request.body);
      assert.ok(retryRequests.length <= 2, "Retry should create exactly one replacement study");
      return json(route, queued(`selector-${retryRequests.length}`, request.body));
    }
    assert.equal(request.method, "GET");
    if (request.path === "/api/research/selector-1") {
      return json(route, {
        id: "selector-1", request: retryRequests[0], status: "failed", stage: "failed",
        error: { code: "selector_unavailable", message: "The selector is temporarily unavailable.", retryable: true, field: "phenomenon_query" },
      });
    }
    assert.equal(request.path, "/api/research/selector-2");
    return json(route, complete("selector-2", retryRequests[1]));
  }, async (page) => {
    await page.locator("#phenomenon").fill("自訂乾旱與積雪研究");
    await setMonth(page, "Start", "2007-02");
    await setMonth(page, "End", "2017-11");
    await page.getByRole("button", { name: "Start research", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "The selector is temporarily unavailable." }).waitFor();
    assert.equal(await page.locator("#phenomenon").inputValue(), "自訂乾旱與積雪研究");
    assert.equal(await getMonth(page, "Start"), "2007-02");
    assert.equal(await getMonth(page, "End"), "2017-11");
    assert.equal(await page.getByRole("button", { name: "Clear region", exact: true }).isVisible(), true);
    assert.deepEqual(retryRequests[0], {
      phenomenon_query: "自訂乾旱與積雪研究", region_id: "named-taiwan-main-island",
      period: { start: "2007-02", end: "2017-11" },
      context: { parent_research_id: null, preset_ref: null },
    });
    await page.getByRole("button", { name: "Retry study", exact: true }).click();
    await page.getByRole("heading", { name: "自訂乾旱與積雪研究", exact: true }).waitFor();
    assert.deepEqual(retryRequests[1], retryRequests[0]);
    assert.equal(await page.getByRole("alert").filter({ hasText: "The selector is temporarily unavailable." }).count(), 0);
    assert.match(await page.getByRole("link", { name: "Export JSON" }).getAttribute("href"), /selector-2/);
  });
} finally {
  await browser.close();
}
