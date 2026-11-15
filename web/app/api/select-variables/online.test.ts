import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { ALL_CATEGORIES } from "@/lib/detective/keywords";
import { onlineProbabilities } from "./online";

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const probabilities = () => Object.fromEntries(ALL_CATEGORIES.map((c, i) => [c, i / 11]));
const openaiReply = (content: unknown) => ({ choices: [{ message: { content } }] });

describe("online selector adapters", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) if (key.startsWith("SELECTOR_")) delete process.env[key];
    process.env.SELECTOR_OPENAI_MODEL = "test-model";
    process.env.SELECTOR_SYSTEMONE_URL = "http://model.invalid/v1/systemone";
    globalThis.fetch = async () => { throw new Error("unexpected network request"); };
  });
  afterEach(() => {
    mock.restoreAll();
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (key.startsWith("SELECTOR_")) delete process.env[key];
    for (const [key, value] of Object.entries(savedEnv)) if (key.startsWith("SELECTOR_")) process.env[key] = value;
  });

  it("sends the OpenAI-compatible request and accepts numeric JSON, including 0 and 1", async () => {
    process.env.SELECTOR_OPENAI_BASE_URL = "http://model.invalid/v1///";
    process.env.SELECTOR_API_KEY = " test-token ";
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "http://model.invalid/v1/chat/completions");
      assert.equal(init?.method, "POST");
      assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "test-model");
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.equal(body.messages[1].role, "user");
      assert.ok(body.messages[1].content.endsWith("2021 drought"));
      for (const category of ALL_CATEGORIES) assert.ok(body.messages[0].content.includes(`- ${category}:`));
      return Response.json(openaiReply(JSON.stringify(probabilities())));
    };
    assert.deepEqual(Object.fromEntries(await onlineProbabilities("openai", "2021 drought")), probabilities());
  });

  it("accepts a single fenced JSON object", async () => {
    globalThis.fetch = async () => Response.json(openaiReply(`\n\u0060\u0060\u0060json\n${JSON.stringify(probabilities())}\n\u0060\u0060\u0060\n`));
    assert.equal((await onlineProbabilities("openai", "drought")).size, 12);
  });

  it("sends twelve System One noul questions and parses its answer objects", async () => {
    process.env.SELECTOR_SYSTEMONE_MODEL = "test-system-one";
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "http://model.invalid/v1/systemone");
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "test-system-one");
      assert.deepEqual(Object.keys(body.questions), [...ALL_CATEGORIES]);
      assert.ok(body.state.event.endsWith("洪水"));
      for (const category of ALL_CATEGORIES) {
        assert.equal(body.questions[category].type, "noul");
        assert.match(body.questions[category].instructions, /^Is this event related to .+\?$/);
      }
      return Response.json({ answers: Object.fromEntries(Object.entries(probabilities()).map(([c, p]) => [c, { noul: p }])) });
    };
    assert.deepEqual(Object.fromEntries(await onlineProbabilities("systemone", "洪水")), probabilities());
  });

  for (const backend of ["openai", "systemone"] as const) {
    for (const value of [null, true, false, "", "0.9", -0.1, 1.1]) {
      it(`rejects ${backend} probability ${JSON.stringify(value)} instead of coercing it`, async () => {
        const values = { ...probabilities(), precip: value };
        globalThis.fetch = async () => Response.json(backend === "openai"
          ? openaiReply(JSON.stringify(values))
          : { answers: Object.fromEntries(Object.entries(values).map(([c, p]) => [c, { noul: p }])) });
        await assert.rejects(onlineProbabilities(backend, "drought"), /bad probability/);
      });
    }
    it(`rejects ${backend} missing/extra categories and invalid response shapes`, async () => {
      const missing = probabilities();
      delete missing.precip;
      for (const values of [null, [], missing, { ...probabilities(), extra: 0.5 }]) {
        globalThis.fetch = async () => Response.json(backend === "openai"
          ? openaiReply(JSON.stringify(values)) : { answers: values });
        await assert.rejects(onlineProbabilities(backend, "drought"));
      }
      globalThis.fetch = async () => Response.json(null);
      await assert.rejects(onlineProbabilities(backend, "drought"));
    });
    it(`rejects ${backend} HTTP failures and malformed JSON`, async () => {
      globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
      await assert.rejects(onlineProbabilities(backend, "drought"), /HTTP 401/);
      globalThis.fetch = async () => new Response("not JSON");
      await assert.rejects(onlineProbabilities(backend, "drought"));
    });
  }

  it("rejects empty/non-text completions and prose surrounding JSON", async () => {
    for (const content of [null, [], "", "no answer", `Here: ${JSON.stringify(probabilities())}`]) {
      globalThis.fetch = async () => Response.json(openaiReply(content));
      await assert.rejects(onlineProbabilities("openai", "drought"));
    }
  });

  it("rejects missing online configuration before fetching", async () => {
    delete process.env.SELECTOR_OPENAI_MODEL;
    delete process.env.SELECTOR_SYSTEMONE_URL;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("must not fetch"); };
    await assert.rejects(onlineProbabilities("openai", "drought"), /MODEL not set/);
    await assert.rejects(onlineProbabilities("systemone", "drought"), /URL not set/);
    assert.equal(calls, 0);
  });

  it("caps every configured timeout at five seconds and rejects invalid settings safely", async () => {
    const used: number[] = [];
    mock.method(AbortSignal, "timeout", (milliseconds: number) => {
      used.push(milliseconds);
      return new AbortController().signal;
    });
    globalThis.fetch = async () => Response.json(openaiReply(JSON.stringify(probabilities())));
    for (const setting of [undefined, "10000", "Infinity", "NaN", "-1", "0", "250", "0.5"]) {
      if (setting === undefined) delete process.env.SELECTOR_ONLINE_TIMEOUT_MS;
      else process.env.SELECTOR_ONLINE_TIMEOUT_MS = setting;
      await onlineProbabilities("openai", "drought");
    }
    assert.deepEqual(used, [5000, 5000, 5000, 5000, 5000, 5000, 250, 1]);
  });

  it("aborts a hanging online response at the configured deadline", async () => {
    process.env.SELECTOR_ONLINE_TIMEOUT_MS = "20";
    let aborted = false;
    globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const guard = setTimeout(() => reject(new Error("signal did not abort")), 1000);
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        clearTimeout(guard);
        reject(init.signal?.reason);
      }, { once: true });
    });
    await assert.rejects(onlineProbabilities("openai", "drought"), { name: "TimeoutError" });
    assert.equal(aborted, true);
  });
});
