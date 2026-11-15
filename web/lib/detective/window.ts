// The analysis view window: how much is SHOWN around the event (UI/UX refresh).
//
//   { unit: "day",   n: 1–14 }   daily view: [selection start − n days, selection end + n days] (layers with daily data)
//   { unit: "week",  n: 1–5  }   daily view: [selection start − n weeks, selection end + n weeks]
//   { unit: "month", n: 1–12 }   monthly view: event ± n months
//   { unit: "year",  n: 1–10 }   monthly view: event ± 12·n months
//   "all"                        the whole record
//
// It never changes the baseline: the months left out of the baseline are `padMonths` (URL `pad`), set separately.
// The daily views follow the workbench's interactive selection (which starts on the event), not the event itself.
// URL form (key `win`): "3d", "2w", "8m", "3y", "all". Junk decodes to null, never guessed.
// Pure functions, no DOM: run under `npx tsx --test`.
import type { TimeRange, YearMonth } from "./contracts";

export type WindowUnit = "day" | "week" | "month" | "year";
/** the units whose view is the daily chart */
export type DailyUnit = "day" | "week";
export type ViewWindow = { unit: WindowUnit; n: number } | "all";

export const WINDOW_LIMITS: Record<WindowUnit, { min: number; max: number }> = {
  day: { min: 1, max: 14 },
  week: { min: 1, max: 5 },
  month: { min: 1, max: 12 },
  year: { min: 1, max: 10 },
};
export const WINDOW_UNITS: WindowUnit[] = ["day", "week", "month", "year"];
export const DEFAULT_WINDOW: ViewWindow = { unit: "month", n: 12 };

const LETTER: Record<WindowUnit, string> = { day: "d", week: "w", month: "m", year: "y" };
const FROM_LETTER: Record<string, WindowUnit> = { d: "day", w: "week", m: "month", y: "year" };

export const isAll = (w: ViewWindow): w is "all" => w === "all";
/** A days or weeks window: the chart shows daily data around the selection. */
export const isDailyWindow = (w: ViewWindow): w is { unit: DailyUnit; n: number } => w !== "all" && (w.unit === "day" || w.unit === "week");
export const sameWindow = (a: ViewWindow, b: ViewWindow) =>
  a === "all" || b === "all" ? a === b : a.unit === b.unit && a.n === b.n;

export function clampWindow(w: ViewWindow): ViewWindow {
  if (w === "all") return w;
  const { min, max } = WINDOW_LIMITS[w.unit];
  const n = Number.isFinite(w.n) ? Math.round(w.n) : min;
  return { unit: w.unit, n: Math.max(min, Math.min(max, n)) };
}

/** "8m", "3y", "2w", "3d", "all" */
export function encodeWindow(w: ViewWindow): string {
  const c = clampWindow(w);
  return c === "all" ? "all" : `${c.n}${LETTER[c.unit]}`;
}

/** URL value -> window; out-of-range numbers clamp, anything else is null */
export function decodeWindow(raw: string | null | undefined): ViewWindow | null {
  const s = raw?.trim().toLowerCase();
  if (!s) return null;
  if (s === "all") return "all";
  const m = /^(\d{1,3})([dwmy])$/.exec(s);
  if (!m) return null;
  return clampWindow({ unit: FROM_LETTER[m[2]], n: Number(m[1]) });
}

const DAYS_PER_MONTH = 365.25 / 12;

/**
 * Months shown either side of the event in the monthly chart. Days and weeks round up to whole months (at least 1), so
 * the monthly chart that sits behind a daily view (or replaces it for a variable without daily data) covers the same days.
 */
export function windowMonths(w: ViewWindow): number | "all" {
  if (w === "all") return "all";
  const c = clampWindow(w) as Exclude<ViewWindow, "all">;
  if (c.unit === "month") return c.n;
  if (c.unit === "year") return c.n * 12;
  return Math.max(1, Math.ceil((c.n * (c.unit === "week" ? 7 : 1)) / DAYS_PER_MONTH));
}

/**
 * The month view (inclusive absolute month indices, as ymIndex) for an event span. "all" needs the record span
 * (union of the records shown); without it "all" falls back to the default ±12 months.
 */
export function monthView(w: ViewWindow, event: { s: number; e: number }, record?: { s: number; e: number } | null): { s: number; e: number } {
  const m = windowMonths(w);
  if (m === "all") {
    const pad = windowMonths(DEFAULT_WINDOW) as number;
    const s = event.s - pad, e = event.e + pad;
    return record ? { s: Math.min(s, record.s), e: Math.max(e, record.e) } : { s, e };
  }
  return { s: event.s - m, e: event.e + m };
}

/**
 * The months the workbench works in. Month and year windows are the event ± n as before. A days or weeks window also
 * reaches around the selection, so a selection made away from the event stays selected (and is what the daily chart
 * shows) instead of being pulled back to the event.
 */
export function workbenchView(
  w: ViewWindow, event: { s: number; e: number }, selection: { s: number; e: number }, record?: { s: number; e: number } | null,
): { s: number; e: number } {
  const v = monthView(w, event, record);
  if (!isDailyWindow(w)) return v;
  const m = windowMonths(w) as number;
  return { s: Math.min(v.s, selection.s - m), e: Math.max(v.e, selection.e + m) };
}

/**
 * Convert a window to another unit, keeping roughly the same reach, clamped to that unit's range
 * (12 months -> 1 year, 2 years -> 12 months, 8 months -> 5 weeks, 2 weeks -> 14 days).
 */
export function convertWindow(w: ViewWindow, unit: WindowUnit): Exclude<ViewWindow, "all"> {
  const days = w === "all" ? 10 * 365.25 : reachDays(clampWindow(w) as Exclude<ViewWindow, "all">);
  const per = unit === "day" ? 1 : unit === "week" ? 7 : unit === "month" ? DAYS_PER_MONTH : 365.25;
  return clampWindow({ unit, n: Math.round(days / per) }) as Exclude<ViewWindow, "all">;
}
function reachDays(w: Exclude<ViewWindow, "all">): number {
  return w.n * (w.unit === "day" ? 1 : w.unit === "week" ? 7 : w.unit === "month" ? DAYS_PER_MONTH : 365.25);
}

/** The legacy `pad` (months either side, 3–60) as a window: up to 12 months stay months, longer become years. */
export function windowFromPad(pad: number): Exclude<ViewWindow, "all"> {
  return (pad <= 12 ? clampWindow({ unit: "month", n: pad }) : clampWindow({ unit: "year", n: Math.round(pad / 12) })) as Exclude<ViewWindow, "all">;
}

const UNIT_WORD: Record<WindowUnit, [string, string]> = { day: ["day", "days"], week: ["week", "weeks"], month: ["month", "months"], year: ["year", "years"] };
/** "± 8 months", "± 1 week", "All" */
export function windowLabel(w: ViewWindow): string {
  if (w === "all") return "All";
  const c = clampWindow(w) as Exclude<ViewWindow, "all">;
  return `± ${c.n} ${UNIT_WORD[c.unit][c.n === 1 ? 0 : 1]}`;
}

/* ------------------------------------------------------------------ days (the days and weeks views) */

const DAY_MS = 86_400_000;
const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const firstDay = (m: YearMonth) => `${m}-01`;
function lastDay(m: YearMonth): string {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  return dayStr(Date.UTC(y, mo, 1) / DAY_MS - 1);
}

/**
 * Inclusive day range of a days or weeks window around a month range (the workbench selection):
 * [first day of the range − reach, last day of the range + reach], reach = n days or 7n days (UTC, "YYYY-MM-DD").
 */
export function dailySpan(range: TimeRange, n: number, unit: DailyUnit = "week"): { start: string; end: string; days: number } {
  const lim = WINDOW_LIMITS[unit];
  const reach = Math.max(lim.min, Math.min(lim.max, Math.round(n))) * (unit === "week" ? 7 : 1);
  const s = dayNum(firstDay(range.start)) - reach;
  const e = dayNum(lastDay(range.end)) + reach;
  return { start: dayStr(s), end: dayStr(e), days: e - s + 1 };
}

/** The days of a month range (first of the start month … last of the end month): the event, or the selection. */
export function eventDays(range: TimeRange): { start: string; end: string } {
  return { start: firstDay(range.start), end: lastDay(range.end) };
}
