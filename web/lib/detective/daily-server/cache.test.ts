import assert from "node:assert/strict";
import { test } from "node:test";
import { DailyCache } from "./cache";
import { DailyError, publicDailyError } from "./errors";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("deduplicates concurrent identical work and serves the cached aggregate", async () => {
  const cache = new DailyCache<number[]>();
  const job = deferred<number[]>();
  let calls = 0;
  const load = async () => { calls++; return job.promise; };
  const first = cache.get("same", load);
  const second = cache.get("same", load);
  assert.equal(first, second);
  job.resolve([3, 4]);
  assert.deepEqual(await first, [3, 4]);
  assert.deepEqual(await cache.get("same", load), [3, 4]);
  assert.equal(calls, 1);
});

test("expires cache entries and evicts by least recent use within its byte limit", async () => {
  let now = 0;
  const cache = new DailyCache<string>({ maxBytes: 600, ttlMs: 100, now: () => now });
  const calls: string[] = [];
  const get = (key: string) => cache.get(key, async () => { calls.push(key); return key; });
  await get("a"); await get("b"); await get("a"); await get("c");
  assert.deepEqual(calls, ["a", "b", "c"]);
  await get("b");
  assert.deepEqual(calls, ["a", "b", "c", "b"]);
  now = 100;
  await get("b");
  assert.deepEqual(calls, ["a", "b", "c", "b", "b"]);
});

test("does not cache oversized results or upstream failures", async () => {
  const cache = new DailyCache<string>({ maxBytes: 270 });
  let calls = 0;
  const large = async () => { calls++; return "x".repeat(100); };
  await cache.get("large", large); await cache.get("large", large);
  assert.equal(calls, 2);
  await assert.rejects(cache.get("error", async () => { throw new Error("private upstream details"); }));
  assert.equal(await cache.get("error", async () => "recovered"), "recovered");
});

test("bounds distinct concurrent queries without queuing", async () => {
  const cache = new DailyCache<number>({ concurrency: 2 });
  const a = deferred<number>(), b = deferred<number>();
  const first = cache.get("a", () => a.promise), second = cache.get("b", () => b.promise);
  await assert.rejects(cache.get("c", async () => 3), (error) => error instanceof DailyError && error.code === "busy");
  a.resolve(1); b.resolve(2);
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.equal(await cache.get("c", async () => 3), 3);
});

test("aborts at timeout and keeps ignored cancellations occupying their slot", async () => {
  const cache = new DailyCache<number>({ concurrency: 1, timeoutMs: 15 });
  const work = deferred<number>();
  let signal: AbortSignal | undefined;
  const first = cache.get("a", async (abort) => { signal = abort; return work.promise; });
  await assert.rejects(first, (error) => error instanceof DailyError && error.code === "timeout");
  assert.equal(signal?.aborted, true);
  await assert.rejects(cache.get("b", async () => 2), (error) => error instanceof DailyError && error.code === "busy");
  await assert.rejects(cache.get("a", async () => 9), (error) => error instanceof DailyError && error.code === "timeout");
  work.resolve(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await cache.get("a", async () => 9), 9);
});

test("sanitizes unrecognized upstream errors", () => {
  const error = publicDailyError(new Error("Bearer super-secret; private-path"));
  assert.equal(error.status, 502);
  assert.equal(error.code, "upstream");
  assert.ok(!error.message.includes("secret"));
});
