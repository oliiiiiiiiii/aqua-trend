import { open } from "node:fs/promises";
import { DailyError } from "./errors";

const DATA_HOST = "opendap.earthdata.nasa.gov";
const SEARCH_HOST = "cmr.earthdata.nasa.gov";
const TOKEN_BYTES = 16 * 1024;

export class NasaMissingGranule extends Error {}

export async function earthdataToken(): Promise<string> {
  let token = process.env.EDL_TOKEN?.trim();
  if (!token && process.env.EDL_TOKEN_FILE?.trim()) {
    let file;
    try {
      file = await open(process.env.EDL_TOKEN_FILE.trim(), "r");
      const info = await file.stat();
      if (!info.isFile() || info.size > TOKEN_BYTES) throw new Error("invalid credential file");
      token = (await file.readFile("utf8")).trim();
    } catch {
      throw notConfigured();
    } finally {
      await file?.close();
    }
  }
  if (!token || token.length > TOKEN_BYTES || /\s/.test(token)) throw notConfigured();
  return token;
}

function notConfigured(): DailyError {
  return new DailyError("not_configured", 503, "日資料來源尚未設定，請先設定伺服器的 Earthdata 存取權限。");
}

export async function nasaText(
  url: URL, token: string | null, signal: AbortSignal, maxBytes = 8 * 1024 * 1024,
): Promise<string> {
  if (url.protocol !== "https:" || url.port || url.username || url.password
    || (url.hostname !== DATA_HOST && url.hostname !== SEARCH_HOST)
    || (token !== null && url.hostname !== DATA_HOST)) {
    throw new DailyError("upstream", 502, "日資料來源設定無效。");
  }
  const response = await fetch(url, {
    cache: "no-store", redirect: "error", signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw new NasaMissingGranule();
    throw new DailyError("upstream", 502, response.status === 401 || response.status === 403
      ? "Earthdata 存取遭拒，請檢查伺服器憑證與資料產品授權。"
      : "NASA 日資料服務暫時無法使用，請稍後再試。");
  }
  if (!response.body) throw new DailyError("upstream", 502, "NASA 日資料回應不完整。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new DailyError("upstream", 502, "日資料回應過大，請縮小查詢範圍。");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return text;
}
