import type { AnalysisApi, CategoryId, CategoryVote, LayerId, SelectRequest, SelectResponse } from "@/lib/detective/contracts";
import { decompose, intervalStats, trendStats } from "@/lib/detective/analysis";
import { keywordSelect } from "@/lib/detective/keywords";
import { CATEGORY_IDS, isCategory, isYearMonth, ymIndex } from "@/lib/detective/url";
import type { VariableMeta as ChartVariableMeta } from "./VariableTab";

export { default as VariableTab } from "./VariableTab";
export { CATEGORIES, type CategoryInfo } from "@/lib/detective/categories";
export { PRESET_EVENTS as PRESETS } from "@/lib/detective/presets";

export const analysis: AnalysisApi = { decompose, intervalStats, trendStats };

export interface VariableMeta extends ChartVariableMeta {
  layer: LayerId;
}

const SELECT_API = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/select-variables`;
// Allow the API's five-second timeout to return its own keyword fallback first.
const SELECT_TIMEOUT_MS = 8000;

export function cleanSelectResponse(raw: unknown): SelectResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<SelectResponse>;
  if (!Array.isArray(r.votes) || !["local-model", "online-model", "keyword-fallback"].includes(r.source ?? "")) return null;
  const byCat = new Map<CategoryId, CategoryVote>();
  for (const v of r.votes as Partial<CategoryVote>[]) {
    if (!v || typeof v.category !== "string" || !isCategory(v.category) || typeof v.p !== "number" || !Number.isFinite(v.p)) continue;
    const p = Math.max(0, Math.min(1, v.p));
    byCat.set(v.category, { category: v.category, p, selected: typeof v.selected === "boolean" ? v.selected : p >= 0.5 });
  }
  if (!byCat.size) return null;
  const t = r.suggestedTime;
  const suggestedTime = t && typeof t.start === "string" && typeof t.end === "string" && isYearMonth(t.start) && isYearMonth(t.end) && ymIndex(t.start) <= ymIndex(t.end) ? t : null;
  return {
    votes: CATEGORY_IDS.map((c) => byCat.get(c) ?? { category: c, p: 0, selected: false }),
    suggestedTime,
    source: r.source as SelectResponse["source"],
  };
}

/** Static exports and failed API requests use the same keyword selector as the server. */
export async function requestVotes(event: string, signal: AbortSignal): Promise<SelectResponse> {
  signal.throwIfAborted();
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal.addEventListener("abort", stop, { once: true });
  const timer = globalThis.setTimeout(stop, SELECT_TIMEOUT_MS);
  try {
    const res = await fetch(SELECT_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event } satisfies SelectRequest),
      signal: ctl.signal,
    });
    const data = res.ok ? cleanSelectResponse(await res.json()) : null;
    signal.throwIfAborted();
    if (data) return data;
  } catch {
    signal.throwIfAborted();
  } finally {
    globalThis.clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
  return keywordSelect(event);
}
