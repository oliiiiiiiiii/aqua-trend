// POST /api/select-variables — 工作線 D。
// 呼叫本地選變數服務（tools/selector/serve.py，背後是本地 System One 決策模型），
// 5 秒內沒有回應或服務不存在 → 關鍵字備案（keywords.ts），source 標為 "keyword-fallback"。
//
// 模型可用時：p 一律是模型的機率（畫面上的機率條）。預先勾選則是「關鍵字優先」：
// 關鍵字表有命中 → 勾關鍵字表的類別；沒有命中 → 勾 p ≥ 門檻的類別。
// 依據：tools/selector/eval.md。10 個測試事件上，模型單獨 F1 0.48、關鍵字表 0.86、
// 關鍵字優先 0.91；本地 0.8B 模型對已知災害名詞不如關鍵字表準，但能補上表外的說法。
// 靜態部署沒有這個 route；前端收到錯誤時直接在瀏覽器呼叫 keywordSelect()。

import type { CategoryId, CategoryVote, SelectRequest, SelectResponse } from "@/lib/detective/contracts";
import {
  ALL_CATEGORIES, SELECT_THRESHOLD, keywordCategories, keywordSelect, suggestedTime,
} from "@/lib/detective/keywords";

/** 本地選變數服務位址；設成空字串可完全停用模型。 */
const SELECTOR_URL = process.env.SELECTOR_URL ?? "http://127.0.0.1:8770";
const MODEL_TIMEOUT_MS = 5000;
const MAX_EVENT_CHARS = 500;

interface SelectorReply {
  votes: { category: string; p: number }[];
  threshold?: number;
}

function isCategory(c: string): c is CategoryId {
  return (ALL_CATEGORIES as readonly string[]).includes(c);
}

/** 向本地模型要 12 類別的機率；任何錯誤、逾時或格式不符都丟出例外。 */
async function modelVotes(event: string): Promise<CategoryVote[]> {
  if (!SELECTOR_URL) throw new Error("selector disabled");
  const res = await fetch(`${SELECTOR_URL}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`selector HTTP ${res.status}`);
  const data = (await res.json()) as SelectorReply;
  const threshold = typeof data.threshold === "number" ? data.threshold : SELECT_THRESHOLD;
  const p = new Map<CategoryId, number>();
  for (const v of data.votes ?? []) {
    if (isCategory(v.category) && typeof v.p === "number" && v.p >= 0 && v.p <= 1) p.set(v.category, v.p);
  }
  if (p.size !== ALL_CATEGORIES.length) throw new Error("selector returned incomplete votes");
  const keywordHits = new Set(keywordCategories(event));
  return ALL_CATEGORIES.map((category) => {
    const prob = p.get(category)!;
    const selected = keywordHits.size ? keywordHits.has(category) : prob >= threshold;
    return { category, p: prob, selected };
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: Partial<SelectRequest>;
  try {
    body = (await request.json()) as Partial<SelectRequest>;
  } catch {
    return Response.json({ error: "body must be JSON {\"event\": string}" }, { status: 400 });
  }
  const event = typeof body?.event === "string" ? body.event.trim() : "";
  if (!event || event.length > MAX_EVENT_CHARS) {
    return Response.json({ error: `event must be a non-empty string of at most ${MAX_EVENT_CHARS} characters` }, { status: 400 });
  }

  let response: SelectResponse;
  try {
    response = { votes: await modelVotes(event), suggestedTime: suggestedTime(event), source: "local-model" };
  } catch {
    response = keywordSelect(event);
  }
  return Response.json(response);
}
