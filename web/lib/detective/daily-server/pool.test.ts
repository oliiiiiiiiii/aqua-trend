import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSamples, nasaSlot } from "./pool";

test("simultaneous query workers share a global maximum of three NASA requests", async () => {
  let active = 0, peak = 0;
  const signal = new AbortController().signal;
  const work = async (value: number, abort: AbortSignal) => nasaSlot(abort, async () => {
    active++; peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    active--;
    return value * 2;
  });
  const outputs = await Promise.all([mapSamples([1, 2, 3, 4], signal, work), mapSamples([5, 6, 7, 8], signal, work)]);
  assert.deepEqual(outputs, [[2, 4, 6, 8], [10, 12, 14, 16]]);
  assert.equal(peak, 3);
  assert.equal(active, 0);
});

test("a failed sample aborts siblings and waits for their cleanup before returning", async () => {
  let stopped = 0;
  const signal = new AbortController().signal;
  await assert.rejects(mapSamples([0, 1, 2, 3], signal, async (value, abort) => {
    if (value === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      throw new Error("sample failed");
    }
    return new Promise<number>((_resolve, reject) => abort.addEventListener("abort", () => {
      stopped++; reject(abort.reason);
    }, { once: true }));
  }), /sample failed/);
  assert.equal(stopped, 2);
});
