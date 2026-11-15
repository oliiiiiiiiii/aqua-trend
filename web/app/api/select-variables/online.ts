// 線上選變數後端（選用，SELECTOR_BACKEND 設成 openai 或 systemone 時才用）。不綁定任何廠商：
//   openai    任何 OpenAI 相容的 /chat/completions（OpenAI、OpenRouter、Groq、Together、vLLM、Ollama…）
//   systemone 任何 Jev 風格的 /v1/systemone 端點（state + noul 問題 → 機率），例如遠端架的 OneJev
// 兩者都回完整類別各一個 0–1 機率，與本地模型同一形式；任何錯誤、逾時或格式不符都丟例外，
// 由 route.ts 退回關鍵字備案。金鑰只從環境變數讀，不可 commit。
//
// 驗證方式（SELECTOR_AUTH）：
//   bearer（預設）  有設 SELECTOR_API_KEY 就送 Authorization: Bearer <金鑰>
//   google-adc     用 Google Application Default Credentials 取得短效 access token（例如 Vertex AI 的
//                  Gemini OpenAI 相容端點）。token 由 google-auth-library 快取並自動更新；取 token 的時間
//                  也算在同一個逾時內。此模式不會送出 SELECTOR_API_KEY。

import type { CategoryId } from "@/lib/detective/contracts";
import { ALL_CATEGORIES } from "@/lib/detective/keywords";
import { CATEGORIES } from "@/lib/detective/categories";

export type OnlineBackend = "openai" | "systemone";

const env = (k: string) => process.env[k]?.trim() || undefined;
const MAX_TIMEOUT_MS = 5000;

function timeoutMs(): number {
  const configured = Number(env("SELECTOR_ONLINE_TIMEOUT_MS"));
  return Number.isFinite(configured) && configured > 0
    ? Math.max(1, Math.min(Math.floor(configured), MAX_TIMEOUT_MS))
    : MAX_TIMEOUT_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function definition(category: CategoryId): string {
  const text = CATEGORIES[category].definition.en.replace(/\.$/, "");
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const STATE = (event: string) => `A student wants to study this Earth event with NASA satellite data: ${event}`;

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
let googleAuth: Promise<{ getAccessToken(): Promise<string | null | undefined> }> | undefined;

/** 可在測試中替換；正式環境用 ADC（GOOGLE_APPLICATION_CREDENTIALS、gcloud ADC 或雲端中繼資料）。 */
export const googleTokenSource = {
  async get(): Promise<string> {
    // 專案 ID 取自 Vertex 端點網址；先給定可避免函式庫另外呼叫 Resource Manager 查專案
    // （會多花數秒，且服務帳戶需要額外權限）。
    const projectId = env("SELECTOR_OPENAI_BASE_URL")?.match(/\/projects\/([^/]+)\//)?.[1];
    googleAuth ??= import("google-auth-library").then(({ GoogleAuth }) =>
      new GoogleAuth({ scopes: GOOGLE_SCOPE, ...(projectId ? { projectId } : {}) }));
    let token: string | null | undefined;
    try {
      token = await (await googleAuth).getAccessToken();
    } catch {
      googleAuth = undefined; // 下次重新建立，例如憑證檔稍後才掛上
      throw new Error("google ADC token unavailable");
    }
    if (!token) throw new Error("google ADC returned no token");
    return token;
  },
};

function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

async function authHeaders(signal: AbortSignal): Promise<Record<string, string>> {
  const mode = env("SELECTOR_AUTH") ?? "bearer";
  let token: string | undefined;
  if (mode === "google-adc") token = await withDeadline(googleTokenSource.get(), signal);
  else if (mode === "bearer") token = env("SELECTOR_API_KEY");
  else throw new Error("unknown SELECTOR_AUTH");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function toProbabilities(values: unknown, answerObjects = false): Map<CategoryId, number> {
  if (!isRecord(values) || Object.keys(values).length !== ALL_CATEGORIES.length) {
    throw new Error("online selector returned incomplete categories");
  }
  const p = new Map<CategoryId, number>();
  for (const c of ALL_CATEGORIES) {
    const answer = values[c];
    const v = answerObjects && isRecord(answer) ? answer.noul : answerObjects ? undefined : answer;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`bad probability for ${c}`);
    p.set(c, v);
  }
  return p;
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const signal = AbortSignal.timeout(timeoutMs());
  const res = await fetch(url, {
    method: "POST",
    headers: await authHeaders(signal),
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`online selector HTTP ${res.status}`);
  return res.json();
}

/** OpenAI 相容 chat completions：要求模型只回一個 JSON 物件 {類別: 機率}。 */
async function openaiProbabilities(event: string): Promise<Map<CategoryId, number>> {
  const base = (env("SELECTOR_OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = env("SELECTOR_OPENAI_MODEL");
  if (!model) throw new Error("SELECTOR_OPENAI_MODEL not set");
  // 選填：思考量（OpenAI 相容的 reasoning_effort，例如 Gemini 3.5 Flash 用 minimal 才能在 5 秒內回應）。
  const reasoningEffort = env("SELECTOR_OPENAI_REASONING_EFFORT");
  const system = [
    "You help students investigate Earth events with NASA monthly, sub-basin-averaged data.",
    "For each category, give the probability (0 to 1) that the described event plausibly leaves a visible monthly anomaly in it.",
    "Respect the temporal resolution in each definition: annual SO2 point-source emissions are not evidence for monthly weather or air-quality changes.",
    "Be selective: unrelated categories get low probabilities. The event may be written in Chinese or English.",
    `Reply with only a JSON object whose keys are exactly: ${ALL_CATEGORIES.join(", ")}; values are numbers from 0 to 1.`,
    "",
    "Categories:",
    ...ALL_CATEGORIES.map((c) => `- ${c}: ${definition(c)}`),
  ].join("\n");
  const data = await postJson(`${base}/chat/completions`, {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: STATE(event) },
    ],
  });
  const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
  const message = isRecord(choice) ? choice.message : undefined;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content !== "string") throw new Error("online selector returned no text");
  const text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return toProbabilities(JSON.parse(fenced ? fenced[1] : text));
}

/** Jev 風格 /v1/systemone：每類別一個 noul 問題（與 tools/selector/selector.py 的 onejev 格式相同）。 */
async function systemoneProbabilities(event: string): Promise<Map<CategoryId, number>> {
  const url = env("SELECTOR_SYSTEMONE_URL");
  if (!url) throw new Error("SELECTOR_SYSTEMONE_URL not set");
  const model = env("SELECTOR_SYSTEMONE_MODEL");
  const questions = Object.fromEntries(
    ALL_CATEGORIES.map((c) => [c, { type: "noul", instructions: `Is this event related to ${definition(c)}?` }]),
  );
  const data = await postJson(url, {
    ...(model ? { model } : {}),
    state: { event: STATE(event) },
    questions,
  });
  return toProbabilities(isRecord(data) ? data.answers : undefined, true);
}

export function onlineProbabilities(backend: OnlineBackend, event: string): Promise<Map<CategoryId, number>> {
  return backend === "openai" ? openaiProbabilities(event) : systemoneProbabilities(event);
}
