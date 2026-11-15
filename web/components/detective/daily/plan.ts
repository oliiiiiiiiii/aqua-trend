// Pure helpers of the daily view: day lists longer than one month, ≤ 3-day request pieces, load-time estimate and
// the monthly normal of each day. No DOM: run under `npx tsx --test`.
import type { Decomposition } from "@/lib/detective/contracts";
import { DAILY_REQUEST_MAX_DAYS, dayNumber, dayString } from "@/lib/detective/daily";

/** spans up to this many days load by themselves (after a short debounce) */
export const AUTO_MAX_DAYS = 62;
/** for longer spans only the event's own days load by themselves, when there are at most this many */
export const EVENT_AUTO_MAX_DAYS = 31;
export const AUTO_DELAY_MS = 400;
/** ≈ 1 minute per month of days (observed 30–130 s per month, cache-dependent) */
export const SECONDS_PER_DAY = 60 / 31;

export interface DayRange { start: string; end: string }

/** every day of an inclusive range (no 31-day cap, unlike lib/detective/daily.dailyDates) */
export function daysOf(r: DayRange): string[] {
  const a = dayNumber(r.start), b = dayNumber(r.end);
  if (a === null || b === null || b < a) return [];
  return Array.from({ length: b - a + 1 }, (_, i) => dayString(a + i));
}

/** consecutive pieces of at most `max` days covering the range */
export function splitRange(r: DayRange, max = DAILY_REQUEST_MAX_DAYS): DayRange[] {
  const days = daysOf(r);
  const out: DayRange[] = [];
  for (let i = 0; i < days.length; i += max) out.push({ start: days[i], end: days[Math.min(days.length, i + max) - 1] });
  return out;
}

export const estimateSeconds = (days: number) => Math.max(0, days) * SECONDS_PER_DAY;
export const needsConfirm = (days: number) => days > AUTO_MAX_DAYS;

/**
 * The part of `range` that loads without a click: all of it up to AUTO_MAX_DAYS; otherwise the event's own days
 * (clipped to the range) when they are at most EVENT_AUTO_MAX_DAYS; otherwise nothing.
 */
export function autoRange(range: DayRange, event: DayRange | null): DayRange | null {
  const days = daysOf(range).length;
  if (!days) return null;
  if (!needsConfirm(days)) return range;
  if (!event) return null;
  const a = Math.max(dayNumber(range.start)!, dayNumber(event.start) ?? Infinity);
  const b = Math.min(dayNumber(range.end)!, dayNumber(event.end) ?? -Infinity);
  if (!(b >= a) || b - a + 1 > EVENT_AUTO_MAX_DAYS) return null;
  return { start: dayString(a), end: dayString(b) };
}

export interface Piece extends DayRange { auto: boolean }

/**
 * ≤ 3-day pieces covering `range` in order. Pieces never straddle the edges of `auto`, so the automatic part can load
 * on its own and the rest later; `auto` marks the pieces inside it.
 */
export function planPieces(range: DayRange, auto: DayRange | null): Piece[] {
  if (!auto || (auto.start === range.start && auto.end === range.end)) return splitRange(range).map((p) => ({ ...p, auto: !!auto }));
  const s = dayNumber(auto.start)!, e = dayNumber(auto.end)!;
  const out: Piece[] = [];
  const add = (a: number, b: number, isAuto: boolean) => {
    if (b >= a) for (const p of splitRange({ start: dayString(a), end: dayString(b) })) out.push({ ...p, auto: isAuto });
  };
  add(dayNumber(range.start)!, s - 1, false);
  add(s, e, true);
  add(e + 1, dayNumber(range.end)!, false);
  return out;
}
/**
 * The monthly normal (trend + seasonal) of the month each day falls in, from the monthly decomposition.
 * null for days outside the monthly record. A reference step only: no daily anomaly model is implied.
 */
export function monthlyNormalByDay(d: Decomposition | null, dates: string[]): (number | null)[] {
  if (!d) return dates.map(() => null);
  const at = new Map(d.months.map((m, i) => [m, i]));
  return dates.map((day) => {
    const i = at.get(day.slice(0, 7));
    if (i === undefined) return null;
    const v = d.trend[i] + d.seasonal[i];
    return Number.isFinite(v) ? v : null;
  });
}

/** "W/m2" and "W/m²" are the same unit; the normal is only drawn when the daily and monthly units agree */
export const sameUnit = (a: string, b: string) => {
  const n = (s: string) => s.replace(/²/g, "2").replace(/\s+/g, "").toLowerCase();
  return n(a) === n(b);
};

/** inclusive [first, last] index runs where `pick(i)` holds */
export function runs(n: number, pick: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && pick(i);
    if (on && s < 0) s = i;
    if (!on && s >= 0) { out.push([s, i - 1]); s = -1; }
  }
  return out;
}
