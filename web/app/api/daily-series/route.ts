import { publicDailyError } from "@/lib/detective/daily-server/errors";
import { dailySeries } from "@/lib/detective/daily-server/service";
import { parseDailyRequest } from "@/lib/detective/daily-server/validation";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const query = parseDailyRequest(new URL(request.url));
    return Response.json(await dailySeries(query), { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const error = publicDailyError(cause);
    return Response.json({ error: error.message, code: error.code }, {
      status: error.status,
      headers: { "Cache-Control": "no-store", ...(error.code === "busy" ? { "Retry-After": "3" } : {}) },
    });
  }
}
