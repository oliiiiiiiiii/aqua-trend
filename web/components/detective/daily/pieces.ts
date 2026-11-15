// Session cache of fetched daily pieces (≤ 3 days each), shared by the daily view (useDailyRange) and the earlier-
// years baseline (useYearsBaseline), so a piece is never fetched twice in a session. Bounded; oldest out first.
// `days` indexes the same values by day for the daily view, whose pieces follow the selection.
import type { DailySeries } from "@/lib/detective/daily";
import type { DayRange } from "./plan";

export const pieces = new Map<string, DailySeries>();
/** about 6,000 days: a 20-year baseline of a month and a half fits */
const MAX_PIECES = 2000;

export function remember(key: string, s: DailySeries) {
  pieces.delete(key);
  pieces.set(key, s);
  while (pieces.size > MAX_PIECES) pieces.delete(pieces.keys().next().value!);
  rememberDays(s);
}

/**
 * The same values by day (region|layer|day), so a selection that moves over days fetched before (in any piece
 * layout) reuses them. Bounded; oldest out first.
 */
export const days = new Map<string, { value: number | null; unit: string; source: DailySeries["source"] }>();
const MAX_DAYS = 20_000;
export const dayKey = (region: string, layer: string, day: string) => `${region}|${layer}|${day}`;
export function rememberDays(s: DailySeries) {
  s.dates.forEach((d, i) => {
    const k = dayKey(s.region, s.layer, d);
    days.delete(k);
    days.set(k, { value: s.values[i] ?? null, unit: s.unit, source: s.source });
  });
  while (days.size > MAX_DAYS) days.delete(days.keys().next().value!);
}

export const pieceKey = (region: string, layer: string, r: DayRange) => `${region}|${layer}|${r.start}|${r.end}`;
