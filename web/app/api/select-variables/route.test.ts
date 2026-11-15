// Run from web/: npx tsx --test app/api/select-variables/*.test.ts
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ALL_CATEGORIES, keywordSelect } from "@/lib/detective/keywords";
import { POST } from "./route";

const event = "2021 台灣春季大旱";
const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const votes = () => ALL_CATEGORIES.map((category) => ({ category, p: 0.1 }));
const request = (body: unknown) => new Request("http://localhost/api/select-variables/", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});

describe("POST /api/select-variables", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) if (key.startsWith("SELECTOR_")) delete process.env[key];
    globalThis.fetch = async () => { throw new Error("unexpected network request"); };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (key.startsWith("SELECTOR_")) delete process.env[key];
    for (const [key, value] of Object.entries(savedEnv)) if (key.startsWith("SELECTOR_")) process.env[key] = value;
  });

  it("uses keyword mode without a network request", async () => {
    process.env.SELECTOR_BACKEND = "keyword";
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("must not fetch"); };
    const response = await POST(request({ event: `  ${event}  ` }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), keywordSelect(event));
    assert.equal(calls, 0);
  });

  it("returns all model votes in contract order, using the supplied threshold instead of keywords", async () => {
    process.env.SELECTOR_URL = " http://selector.invalid/ ";
    const modelVotes = votes();
    modelVotes[0].p = 0.69;
    modelVotes[11].p = 0.7;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "http://selector.invalid/select");
      assert.equal(init?.method, "POST");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(String(init?.body)), { event });
      return Response.json({ votes: modelVotes.toReversed(), threshold: 0.7, backend: "onejev" });
    };
    const response = await POST(request({ event }));
    assert.deepEqual(await response.json(), {
      votes: modelVotes.map((vote) => ({ ...vote, selected: vote.p >= 0.7 })),
      suggestedTime: { start: "2021-01", end: "2021-12" }, source: "local-model",
    });
  });

  it("defaults the threshold to 0.5, including a probability exactly on the boundary", async () => {
    const modelVotes = votes();
    modelVotes[0].p = 0.5;
    globalThis.fetch = async () => Response.json({ votes: modelVotes });
    const result = await (await POST(request({ event }))).json();
    assert.equal(result.source, "local-model");
    assert.deepEqual(result.votes.filter((v: { selected: boolean }) => v.selected), [
      { category: "precip", p: 0.5, selected: true },
    ]);
  });

  const badReplies: [string, () => unknown][] = [
    ["null response", () => null],
    ["non-array votes", () => ({ votes: {} })],
    ["missing category", () => ({ votes: votes().slice(1) })],
    ["extra vote", () => ({ votes: [...votes(), { category: "precip", p: 0.9 }] })],
    ["duplicate category", () => ({ votes: votes().map((v, i) => i === 1 ? { ...v, category: "precip" } : v) })],
    ["unknown category", () => ({ votes: votes().map((v, i) => i === 1 ? { ...v, category: "unknown" } : v) })],
    ["null vote", () => ({ votes: [null, ...votes().slice(1)] })],
    ...[null, true, "0.8", -0.1, 1.1].map((p): [string, () => unknown] => [
      `invalid probability ${JSON.stringify(p)}`, () => ({ votes: [{ category: "precip", p }, ...votes().slice(1)] }),
    ]),
    ...[null, "0.5", -1, 2].map((threshold): [string, () => unknown] => [
      `invalid threshold ${JSON.stringify(threshold)}`, () => ({ votes: votes(), threshold }),
    ]),
  ];
  for (const [label, reply] of badReplies) {
    it(`falls back for ${label}`, async () => {
      globalThis.fetch = async () => Response.json(reply());
      assert.deepEqual(await (await POST(request({ event }))).json(), keywordSelect(event));
    });
  }

  for (const [label, response] of [
    ["unavailable service", () => new Response("unavailable", { status: 503 })],
    ["invalid JSON", () => new Response("{incomplete")],
  ] as const) {
    it(`falls back for ${label}`, async () => {
      globalThis.fetch = async () => response();
      assert.deepEqual(await (await POST(request({ event }))).json(), keywordSelect(event));
    });
  }

  it("falls back within one second when the local service is closed", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    process.env.SELECTOR_URL = `http://127.0.0.1:${address.port}`;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    globalThis.fetch = realFetch;
    const start = performance.now();
    const response = await POST(request({ event }));
    assert.deepEqual(await response.json(), keywordSelect(event));
    assert.ok(performance.now() - start < 1000, "closed service fallback exceeded one second");
  });

  it("aborts a hanging local request at the five-second limit", async () => {
    let aborted = false;
    globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const guard = setTimeout(() => reject(new Error("signal did not abort")), 5500);
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        clearTimeout(guard);
        reject(init.signal?.reason);
      }, { once: true });
    });
    const start = performance.now();
    const response = await POST(request({ event }));
    assert.deepEqual(await response.json(), keywordSelect(event));
    assert.equal(aborted, true);
    assert.ok(performance.now() - start < 5500);
  });

  for (const backend of ["openai", "systemone"]) {
    it(`returns online-model for ${backend} and falls back on errors`, async () => {
      process.env.SELECTOR_BACKEND = backend;
      process.env.SELECTOR_OPENAI_MODEL = "test-model";
      process.env.SELECTOR_SYSTEMONE_URL = "http://model.invalid/v1/systemone";
      const probabilities = Object.fromEntries(ALL_CATEGORIES.map((c, i) => [c, i === 11 ? 0.5 : 0.1]));
      globalThis.fetch = async () => Response.json(backend === "openai"
        ? { choices: [{ message: { content: JSON.stringify(probabilities) } }] }
        : { answers: Object.fromEntries(Object.entries(probabilities).map(([c, p]) => [c, { noul: p }])) });
      const result = await (await POST(request({ event }))).json();
      assert.equal(result.source, "online-model");
      assert.equal(result.votes.length, 12);
      assert.deepEqual(result.votes.filter((v: { selected: boolean }) => v.selected), [{ category: "sst", p: 0.5, selected: true }]);
      globalThis.fetch = async () => { throw new Error("offline"); };
      assert.deepEqual(await (await POST(request({ event }))).json(), keywordSelect(event));
    });
  }

  for (const body of [null, [], true, 42, "drought", {}, { event: 42 }, { event: "  " }, { event: "a".repeat(501) }]) {
    it(`rejects invalid request ${JSON.stringify(body).slice(0, 45)}`, async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error("must not fetch"); };
      const response = await POST(request(body));
      assert.equal(response.status, 400);
      assert.equal(calls, 0);
    });
  }

  it("rejects malformed JSON and accepts exactly 500 characters", async () => {
    process.env.SELECTOR_BACKEND = "keyword";
    assert.equal((await POST(new Request("http://localhost", { method: "POST", body: "{" }))).status, 400);
    assert.equal((await POST(request({ event: "a".repeat(500) }))).status, 200);
  });

  it("does not fetch when the local URL is disabled or the backend is unknown", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("must not fetch"); };
    process.env.SELECTOR_URL = " ";
    assert.deepEqual(await (await POST(request({ event }))).json(), keywordSelect(event));
    process.env.SELECTOR_BACKEND = "unknown";
    assert.deepEqual(await (await POST(request({ event }))).json(), keywordSelect(event));
    assert.equal(calls, 0);
  });
});
