// POST /api/select-variables — 工作線 D。
// 依 SELECTOR_BACKEND 選模型（預設 local）：
//   local     本地選變數服務（tools/selector/serve.py，背後是本地 System One 決策模型），5 秒逾時
//   openai    任何 OpenAI 相容 API（online.ts）
//   systemone 任何遠端 Jev 風格 /v1/systemone API（online.ts）
//   keyword   不用模型，只用關鍵字表
// 模型失敗、逾時或不存在 → 關鍵字備案（keywords.ts），source 標為 "keyword-fallback"。
// 模型可用時：p 是模型的機率，預先勾選 p ≥ 門檻的類別（由模型決定）。
// 靜態部署沒有這個 route；前端收到錯誤時直接在瀏覽器呼叫 keywordSelect()。

import type { CategoryId, CategoryVote, SelectResponse } from "@/lib/detective/contracts";
import { ALL_CATEGORIES, SELECT_THRESHOLD, keywordSelect, suggestedTime } from "@/lib/detective/keywords";
import { onlineProbabilities } from "./online";

const MODEL_TIMEOUT_MS = 5000;
const MAX_EVENT_CHARS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCategory(c: unknown): c is CategoryId {
  return typeof c === "string" && (ALL_CATEGORIES as readonly string[]).includes(c);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** 向本地模型要 12 類別的機率；任何錯誤、逾時或格式不符都丟出例外。 */
async function localProbabilities(event: string): Promise<{ p: Map<CategoryId, number>; threshold: number }> {
  const url = (process.env.SELECTOR_URL ?? "http://127.0.0.1:8770").trim().replace(/\/+$/, "");
  if (!url) throw new Error("selector disabled");
  const res = await fetch(`${url}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`selector HTTP ${res.status}`);
  const data: unknown = await res.json();
  if (!isRecord(data) || !Array.isArray(data.votes) || data.votes.length !== ALL_CATEGORIES.length) {
    throw new Error("selector returned incomplete votes");
  }
  const threshold = data.threshold === undefined ? SELECT_THRESHOLD : data.threshold;
  if (!isProbability(threshold)) throw new Error("selector returned invalid threshold");
  const p = new Map<CategoryId, number>();
  for (const v of data.votes) {
    if (!isRecord(v) || !isCategory(v.category) || !isProbability(v.p) || p.has(v.category)) {
      throw new Error("selector returned invalid vote");
    }
    p.set(v.category, v.p);
  }
  return { p, threshold };
}

function toVotes(p: Map<CategoryId, number>, threshold: number): CategoryVote[] {
  return ALL_CATEGORIES.map((category) => {
    const prob = p.get(category)!;
    return { category, p: prob, selected: prob >= threshold };
  });
}

async function modelResponse(event: string): Promise<SelectResponse> {
  const backend = process.env.SELECTOR_BACKEND?.trim() || "local";
  switch (backend) {
    case "local": {
      const { p, threshold } = await localProbabilities(event);
      return { votes: toVotes(p, threshold), suggestedTime: suggestedTime(event), source: "local-model" };
    }
    case "openai":
    case "systemone": {
      const p = await onlineProbabilities(backend, event);
      return { votes: toVotes(p, SELECT_THRESHOLD), suggestedTime: suggestedTime(event), source: "online-model" };
    }
    default:
      throw new Error("model disabled");
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body must be JSON {\"event\": string}" }, { status: 400 });
  }
  const event = isRecord(body) && typeof body.event === "string" ? body.event.trim() : "";
  if (!event || event.length > MAX_EVENT_CHARS) {
    return Response.json({ error: `event must be a non-empty string of at most ${MAX_EVENT_CHARS} characters` }, { status: 400 });
  }

  let response: SelectResponse;
  try {
    response = await modelResponse(event);
  } catch {
    response = keywordSelect(event);
  }
  return Response.json(response);
}
