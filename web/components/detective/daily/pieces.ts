// Session cache of fetched daily pieces (≤ 3 days each), shared by the daily view (useDailyRange) and the earlier-
// years baseline (useYearsBaseline), so a piece is never fetched twice in a session. Bounded; oldest out first.
import type { DailySeries } from "@/lib/detective/daily";
import type { DayRange } from "./plan";

export const pieces = new Map<string, DailySeries>();
/** about 6,000 days: a 20-year baseline of a month and a half fits */
const MAX_PIECES = 2000;

export function remember(key: string, s: DailySeries) {
  pieces.delete(key);
  pieces.set(key, s);
  while (pieces.size > MAX_PIECES) pieces.delete(pieces.keys().next().value!);
}

export const pieceKey = (region: string, layer: string, r: DayRange) => `${region}|${layer}|${r.start}|${r.end}`;
