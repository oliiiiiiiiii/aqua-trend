export type DailyErrorCode =
  | "invalid_request" | "unknown_region" | "not_configured"
  | "busy" | "timeout" | "upstream";

export class DailyError extends Error {
  constructor(
    readonly code: DailyErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DailyError";
  }
}

export function publicDailyError(error: unknown): DailyError {
  return error instanceof DailyError ? error : new DailyError(
    "upstream", 502, "日資料來源暫時無法使用，請稍後再試。",
  );
}
