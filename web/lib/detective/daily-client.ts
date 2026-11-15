import { DAILY_REQUEST_MAX_DAYS, dailyDates, dayNumber, dayString, type DailyRange, type DailyRequest, type DailySeries } from "./daily";

export interface DailyProgress {
  series: DailySeries;
  completedDays: number;
}

export class DailyLoadError extends Error {
  constructor(readonly code: "unavailable" | "failed" | "timeout") {
    super(code);
    this.name = "DailyLoadError";
  }
}

export const dailyRequestKey = (request: DailyRequest): string =>
  `${request.region}|${request.layer}|${request.start}|${request.end}`;

/** Today's UTC observations are still incomplete, even when local time is a later date. */
export function completedDailyRange(range: DailyRange, now = Date.now()): DailyRange | null {
  const start = dayNumber(range.start), requestedEnd = dayNumber(range.end);
  if (start === null || requestedEnd === null || requestedEnd < start || !Number.isFinite(now)) return null;
  const end = Math.min(requestedEnd, Math.floor(now / 86_400_000) - 1);
  return end < start ? null : { start: range.start, end: dayString(end) };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Sparse source dates become calendar gaps, including leap days. */
export function normalizeDailySeries(value: unknown, request: DailyRequest): DailySeries {
  const invalid = () => { throw new DailyLoadError("failed"); };
  if (!record(value) || value.resolution !== "daily"
    || value.region !== request.region || value.layer !== request.layer
    || value.start !== request.start || value.end !== request.end
    || !Array.isArray(value.dates) || !Array.isArray(value.values)
    || value.dates.length !== value.values.length
    || typeof value.unit !== "string" || typeof value.retrievedAt !== "string"
    || !Number.isFinite(Date.parse(value.retrievedAt)) || !record(value.source)) return invalid();
  const source = value.source;
  if (![source.provider, source.dataset, source.url, source.aggregation, source.spatialMethod]
    .every((field) => typeof field === "string" && field.length > 0)) return invalid();
  try { if (new URL(source.url as string).protocol !== "https:") return invalid(); } catch { return invalid(); }

  const dates = dailyDates(request);
  if (!dates.length) return invalid();
  const expected = new Set(dates);
  const values = new Map<string, number | null>();
  for (let i = 0; i < value.dates.length; i++) {
    const date = value.dates[i], observation = value.values[i];
    if (typeof date !== "string" || !expected.has(date) || values.has(date)
      || (observation !== null && (typeof observation !== "number" || !Number.isFinite(observation)))) return invalid();
    values.set(date, observation as number | null);
  }
  return { ...value, ...request, dates, values: dates.map((date) => values.get(date) ?? null) } as DailySeries;
}

async function requestChunk(request: DailyRequest, signal: AbortSignal): Promise<DailySeries> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 65_000);
  const query = new URLSearchParams({ ...request });
  const url = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/daily-series/?${query}`;
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new DailyLoadError(response.status === 503 ? "unavailable" : "failed");
    const value: unknown = await response.json();
    controller.signal.throwIfAborted();
    return normalizeDailySeries(value, request);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (timedOut) throw new DailyLoadError("timeout");
    throw error instanceof DailyLoadError ? error : new DailyLoadError("failed");
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  }
}

/** Sequential chunks let monthly analysis stay usable while daily observations arrive. */
export async function requestDailySeries(
  request: DailyRequest,
  signal: AbortSignal,
  onProgress: (progress: DailyProgress) => void = () => {},
): Promise<DailySeries> {
  const dates = dailyDates(request);
  if (!dates.length) throw new DailyLoadError("failed");
  const values: (number | null)[] = dates.map(() => null);
  let merged: DailySeries | null = null;
  for (let start = 0; start < dates.length; start += DAILY_REQUEST_MAX_DAYS) {
    signal.throwIfAborted();
    const end = Math.min(dates.length, start + DAILY_REQUEST_MAX_DAYS);
    const chunk = await requestChunk({ ...request, start: dates[start], end: dates[end - 1] }, signal);
    signal.throwIfAborted();
    if (merged && (chunk.unit !== merged.unit || chunk.source.dataset !== merged.source.dataset
      || chunk.source.provider !== merged.source.provider)) throw new DailyLoadError("failed");
    values.splice(start, chunk.values.length, ...chunk.values);
    const retrievedAt: string = merged && Date.parse(merged.retrievedAt) > Date.parse(chunk.retrievedAt) ? merged.retrievedAt : chunk.retrievedAt;
    merged = { ...chunk, ...request, dates, values: values.slice(), retrievedAt };
    onProgress({ series: merged, completedDays: end });
  }
  signal.throwIfAborted();
  return merged!;
}
