// 線上選變數後端（選用，SELECTOR_BACKEND 設成 openai 或 systemone 時才用）。不綁定任何廠商：
//   openai    任何 OpenAI 相容的 /chat/completions（OpenAI、OpenRouter、Groq、Together、vLLM、Ollama…）
//   systemone 任何 Jev 風格的 /v1/systemone 端點（state + noul 問題 → 機率），例如遠端架的 OneJev
// 兩者都回 12 類別各一個 0–1 機率，與本地模型同一形式；任何錯誤、逾時或格式不符都丟例外，
// 由 route.ts 退回關鍵字備案。金鑰只從環境變數讀，不可 commit。

import type { CategoryId } from "@/lib/detective/contracts";
import { ALL_CATEGORIES } from "@/lib/detective/keywords";

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

/** 類別淺白定義（同 tools/selector/selector.py 的英文版）。 */
const DEFINITIONS: Record<CategoryId, string> = {
  precip: "how much rain and snow falls from the sky",
  et: "how much water the ground and plants send back into the air (evapotranspiration)",
  soil: "how much water is in the soil layer where plant roots live",
  tws: "the change in total water stored on land: surface water, soil water and groundwater",
  runoff: "rain water that is not absorbed and flows into rivers (runoff)",
  snow: "how much water the snowpack holds (snow water equivalent)",
  tair: "the air temperature near the ground",
  vpd: "how thirsty the air is (vapor pressure deficit); the higher it is, the faster it pulls water out of soil and plants",
  energy: "the net radiation energy absorbed by the land surface",
  wind: "the wind speed near the ground",
  ndvi: "how green and lush the vegetation is",
  sst: "the sea surface temperature",
};

const STATE = (event: string) => `A student wants to study this Earth event with NASA satellite data: ${event}`;

function authHeaders(): Record<string, string> {
  const apiKey = env("SELECTOR_API_KEY");
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs()),
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
  const system = [
    "You help students investigate Earth events with NASA monthly, sub-basin-averaged data.",
    "For each category, give the probability (0 to 1) that the described event plausibly leaves a visible monthly anomaly in it.",
    "Be selective: unrelated categories get low probabilities. The event may be written in Chinese or English.",
    `Reply with only a JSON object whose keys are exactly: ${ALL_CATEGORIES.join(", ")}; values are numbers from 0 to 1.`,
    "",
    "Categories:",
    ...ALL_CATEGORIES.map((c) => `- ${c}: ${DEFINITIONS[c]}`),
  ].join("\n");
  const data = await postJson(`${base}/chat/completions`, {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
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
    ALL_CATEGORIES.map((c) => [c, { type: "noul", instructions: `Is this event related to ${DEFINITIONS[c]}?` }]),
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
