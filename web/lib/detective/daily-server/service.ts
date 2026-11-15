import type { DailyRequest, DailySeries } from "../daily";
import { DailyCache } from "./cache";
import { gldasSeries } from "./gldas";
import { imergSeries } from "./imerg";
import { earthdataToken } from "./nasa-http";
import { basinGeometry } from "./regions";

const cache = new DailyCache<DailySeries>();

export async function dailySeries(request: DailyRequest): Promise<DailySeries> {
  const token = await earthdataToken();
  return cache.get([request.region, request.layer, request.start, request.end].join("|"), async (signal) => {
    const geometry = await basinGeometry(request.region);
    return request.layer === "p_imerg"
      ? imergSeries(request, geometry, token, signal)
      : gldasSeries({ ...request, layer: request.layer }, geometry, token, signal);
  });
}
