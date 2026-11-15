// Client for the analysis backend (docs/earth-system-data-contracts.md §9).
// There is deliberately NO mock or offline fallback here: when the backend cannot be reached the caller gets a
// typed, retryable error and shows it (spec §10: never pass demo numbers off as a real analysis).
import type {
  ApiErrorBody,
  CatalogueRegion,
  CatalogueSummary,
  EvidenceFamily,
  ResearchAccepted,
  ResearchJob,
  ResearchRequest,
} from "./types";
import { isTerminal } from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000").replace(/\/+$/, "");

/** Codes produced by this client (not by the backend). */
export const CLIENT_CODES = {
  unreachable: "backend_unreachable",
  badResponse: "bad_response",
} as const;

/** A failed API call: the backend's stable code when it sent one, otherwise a client code. */
export class ResearchApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly fields: string[];
  /** HTTP status, or 0 when no response arrived */
  readonly status: number;

  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.name = "ResearchApiError";
    this.code = body.code;
    this.retryable = body.retryable;
    this.fields = body.fields ?? [];
    this.status = status;
  }

  get unreachable(): boolean {
    return this.code === CLIENT_CODES.unreachable;
  }
}

export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

function isErrorBody(x: unknown): x is ApiErrorBody {
  return !!x && typeof x === "object" && typeof (x as ApiErrorBody).code === "string" && typeof (x as ApiErrorBody).message === "string";
}

/** Error body from a response: `{code, message, retryable, fields}`, also accepted under `detail` or `error`. */
function errorFrom(payload: unknown, status: number): ResearchApiError {
  const candidates = [payload, (payload as { detail?: unknown })?.detail, (payload as { error?: unknown })?.error];
  for (const c of candidates) {
    if (isErrorBody(c)) return new ResearchApiError({ ...c, retryable: !!c.retryable, fields: c.fields ?? [] }, status);
  }
  return new ResearchApiError(
    {
      code: CLIENT_CODES.badResponse,
      message: `The analysis service answered with HTTP ${status} and no readable error.`,
      retryable: status >= 500,
      fields: [],
    },
    status,
  );
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ResearchApiError(
      {
        code: CLIENT_CODES.unreachable,
        message: `The analysis service at ${API_BASE} cannot be reached. Nothing was computed.`,
        retryable: true,
        fields: [],
      },
      0,
    );
  }
  if (!res.ok) {
    let payload: unknown = null;
    try { payload = await res.json(); } catch { /* not JSON */ }
    throw errorFrom(payload, res.status);
  }
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  try {
    return (await res.json()) as T;
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ResearchApiError(
      { code: CLIENT_CODES.badResponse, message: "The analysis service sent a response that is not JSON.", retryable: true, fields: [] },
      res.status,
    );
  }
}

export const getCatalogue = (signal?: AbortSignal) => json<CatalogueSummary>("/api/catalogue", { signal });

export const getCatalogueRegion = (id: string, signal?: AbortSignal) =>
  json<CatalogueRegion>(`/api/catalogue/regions/${encodeURIComponent(id)}`, { signal });

export const createResearch = (body: ResearchRequest, signal?: AbortSignal) =>
  json<ResearchAccepted>("/api/research", { method: "POST", body: JSON.stringify(body), signal });

export const getResearch = (id: string, signal?: AbortSignal) =>
  json<ResearchJob>(`/api/research/${encodeURIComponent(id)}`, { signal });

export const cancelResearch = (id: string, signal?: AbortSignal) =>
  json<ResearchJob | Record<string, unknown>>(`/api/research/${encodeURIComponent(id)}`, { method: "DELETE", signal });

export interface FamilyPage extends EvidenceFamily {
  page?: { offset: number; limit: number; returned: number; total: number; next_offset: number | null };
}

/** One page of the full stored family (the backend pages large preset-search families). */
export const getFamily = (researchId: string, familyId: string, offset = 0, signal?: AbortSignal) =>
  json<FamilyPage>(
    `/api/research/${encodeURIComponent(researchId)}/families/${encodeURIComponent(familyId)}?offset=${offset}`,
    { signal },
  );

export const exportUrl = (id: string, format: "json" | "csv") =>
  `${API_BASE}/api/research/${encodeURIComponent(id)}/export?format=${format}`;

/** The export exactly as the backend wrote it (same snapshot as the page), as text. */
export async function fetchExport(id: string, format: "json" | "csv", signal?: AbortSignal): Promise<string> {
  const res = await request(`/api/research/${encodeURIComponent(id)}/export?format=${format}`, {
    signal,
    headers: { Accept: format === "json" ? "application/json" : "text/csv" },
  });
  return res.text();
}

/* ------------------------------------------------------------------ polling */

export interface PollOptions {
  signal: AbortSignal;
  /** called with every job snapshot, including the terminal one */
  onUpdate: (job: ResearchJob) => void;
  /** first delay in ms; grows by `factor` up to `maxDelay` */
  initialDelay?: number;
  factor?: number;
  maxDelay?: number;
  /** consecutive unreachable polls tolerated before giving up (the job id stays valid for a manual retry) */
  maxNetworkFailures?: number;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Poll one job with backoff until it reaches a terminal status. Resolves with the terminal job; rejects with
 * AbortError when `signal` aborts, or with a ResearchApiError. The caller owns "is this still the current job".
 */
export async function pollResearch(id: string, opts: PollOptions): Promise<ResearchJob> {
  const factor = opts.factor ?? 1.5;
  const maxDelay = opts.maxDelay ?? 3000;
  const maxFail = opts.maxNetworkFailures ?? 3;
  let delay = opts.initialDelay ?? 350;
  let failures = 0;
  for (;;) {
    let job: ResearchJob | null = null;
    try {
      job = await getResearch(id, opts.signal);
      failures = 0;
    } catch (e) {
      if (isAbort(e)) throw e;
      if (!(e instanceof ResearchApiError) || !e.unreachable || ++failures > maxFail) throw e;
    }
    if (job) {
      opts.onUpdate(job);
      if (isTerminal(job.status)) return job;
    }
    await sleep(delay, opts.signal);
    delay = Math.min(maxDelay, Math.round(delay * factor));
  }
}
