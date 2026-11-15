import { DailyError } from "./errors";

let active = 0;
const waiting: (() => void)[] = [];

export async function nasaSlot<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  if (active >= 3) {
    if (waiting.length >= 6) throw new DailyError("busy", 429, "日資料查詢忙碌中，請稍後再試。");
    await new Promise<void>((resolve, reject) => {
      const start = () => { signal.removeEventListener("abort", abort); resolve(); };
      const abort = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
      };
      waiting.push(start);
      signal.addEventListener("abort", abort, { once: true });
    });
  } else active++;
  try {
    signal.throwIfAborted();
    return await run();
  } finally {
    const next = waiting.shift();
    if (next) next(); else active--;
  }
}

export async function mapSamples<T, R>(values: T[], signal: AbortSignal, fn: (value: T, signal: AbortSignal) => Promise<R>): Promise<R[]> {
  const cancel = new AbortController();
  const combined = AbortSignal.any([signal, cancel.signal]);
  const result = new Array<R>(values.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(3, values.length) }, async () => {
    try {
      while (index < values.length) {
        combined.throwIfAborted();
        const current = index++;
        result[current] = await fn(values[current], combined);
      }
    } catch (error) { cancel.abort(error); throw error; }
  });
  const outcomes = await Promise.allSettled(workers);
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return result;
}
