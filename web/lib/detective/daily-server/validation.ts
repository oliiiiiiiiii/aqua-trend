import { DAILY_REQUEST_MAX_DAYS, dayNumber, supportsDaily, type DailyRequest } from "../daily";
import { DailyError } from "./errors";

const FIELDS = new Set(["region", "layer", "start", "end"]);

export function parseDailyRequest(url: URL, now = Date.now()): DailyRequest {
  const params = url.searchParams;
  for (const key of params.keys()) {
    if (!FIELDS.has(key) || params.getAll(key).length !== 1) {
      throw invalid("日資料查詢僅接受 region、layer、start、end，且各限一個值。");
    }
  }
  const region = params.get("region") ?? "";
  const layer = params.get("layer") ?? "";
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";
  if (!/^b4-\d{10}$/.test(region)) throw invalid("請選擇有效流域。");
  if (!supportsDaily(layer)) throw invalid("此變數尚不提供日資料。");
  const first = dayNumber(start), last = dayNumber(end);
  if (first === null || last === null || last < first) throw invalid("請提供有效且依序排列的日期（YYYY-MM-DD）。");
  if (last - first + 1 > DAILY_REQUEST_MAX_DAYS) {
    throw invalid(`每次日資料請求最多 ${DAILY_REQUEST_MAX_DAYS} 天。`);
  }
  if (last >= Math.floor(now / 86_400_000)) throw invalid("日資料僅提供已結束的 UTC 日期。");
  return { region, layer, start, end };
}

function invalid(message: string): DailyError {
  return new DailyError("invalid_request", 400, message);
}
