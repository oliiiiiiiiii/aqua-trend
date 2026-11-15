import { DailyError } from "./errors";

interface Entry<T> { value: T; bytes: number; expires: number }
interface CacheOptions {
  maxBytes?: number;
  maxEntries?: number;
  ttlMs?: number;
  concurrency?: number;
  timeoutMs?: number;
  now?: () => number;
}

/** Only aggregates are retained. Active requests have no unbounded waiting queue. */
export class DailyCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly pending = new Map<string, Promise<T>>();
  private bytes = 0;
  private active = 0;
  private readonly options: Required<CacheOptions>;

  constructor(options: CacheOptions = {}) {
    this.options = {
      maxBytes: 32 * 1024 * 1024, maxEntries: 2048, ttlMs: 86_400_000,
      concurrency: 2, timeoutMs: 45_000, now: Date.now, ...options,
    };
  }

  get(key: string, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      if (cached.expires > this.options.now()) {
        this.entries.delete(key);
        this.entries.set(key, cached);
        return Promise.resolve(cached.value);
      }
      this.remove(key);
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.active >= this.options.concurrency) {
      return Promise.reject(new DailyError("busy", 429, "日資料查詢忙碌中，請稍後再試。"));
    }

    this.active++;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new DailyError("timeout", 504, "日資料查詢逾時，請縮短日期範圍後重試。");
        reject(error);
        controller.abort(error);
      }, this.options.timeoutMs);
    });
    const work = Promise.resolve().then(() => load(controller.signal));
    let workDone = false, responseDone = false;
    const removePending = () => {
      if (workDone && responseDone) this.pending.delete(key);
    };
    const response = Promise.race([work, timeout]).then((value) => {
      try {
        if (!controller.signal.aborted) this.put(key, value);
        return value;
      } finally { responseDone = true; removePending(); }
    }, (error) => {
      responseDone = true;
      removePending();
      throw error;
    });
    this.pending.set(key, response);
    const settled = () => {
      clearTimeout(timer);
      this.active--;
      workDone = true;
      removePending();
    };
    // A provider that ignores cancellation keeps its slot until it actually stops.
    // Otherwise repeated timeouts could create unlimited background requests.
    void work.then(settled, settled);
    return response;
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  private put(key: string, value: T): void {
    const now = this.options.now();
    for (const [entryKey, entry] of this.entries) if (entry.expires <= now) this.remove(entryKey);
    const bytes = Buffer.byteLength(JSON.stringify(value)) + Buffer.byteLength(key) + 256;
    if (bytes > this.options.maxBytes) return;
    this.remove(key);
    while (this.entries.size && (
      this.bytes + bytes > this.options.maxBytes || this.entries.size >= this.options.maxEntries
    )) this.remove(this.entries.keys().next().value!);
    this.entries.set(key, { value, bytes, expires: now + this.options.ttlMs });
    this.bytes += bytes;
  }
}
