// The analysis view window: how much is SHOWN around the event (UI/UX refresh).
//
//   { unit: "week",  n: 1–5  }   daily view: [event start − n weeks, event end + n weeks] (layers with daily data)
//   { unit: "month", n: 1–12 }   monthly view: event ± n months
//   { unit: "year",  n: 1–10 }   monthly view: event ± 12·n months
//   "all"                        the whole record
//
// It never changes the baseline: the months left out of the baseline are `padMonths` (URL `pad`), set separately.
// URL form (key `win`): "2w", "8m", "3y", "all". Junk decodes to null, never guessed.
// Pure functions, no DOM: run under `npx tsx --test`.
import type { TimeRange, YearMonth } from "./contracts";

export type WindowUnit = "week" | "month" | "year";
export type ViewWindow = { unit: WindowUnit; n: number } | "all";

export const WINDOW_LIMITS: Record<WindowUnit, { min: number; max: number }> = {
  week: { min: 1, max: 5 },
  month: { min: 1, max: 12 },
  year: { min: 1, max: 10 },
};
export const WINDOW_UNITS: WindowUnit[] = ["week", "month", "year"];
export const DEFAULT_WINDOW: ViewWindow = { unit: "month", n: 12 };

const LETTER: Record<WindowUnit, string> = { week: "w", month: "m", year: "y" };
const FROM_LETTER: Record<string, WindowUnit> = { w: "week", m: "month", y: "year" };

export const isAll = (w: ViewWindow): w is "all" => w === "all";
export const sameWindow = (a: ViewWindow, b: ViewWindow) =>
  a === "all" || b === "all" ? a === b : a.unit === b.unit && a.n === b.n;

export function clampWindow(w: ViewWindow): ViewWindow {
  if (w === "all") return w;
  const { min, max } = WINDOW_LIMITS[w.unit];
  const n = Number.isFinite(w.n) ? Math.round(w.n) : min;
  return { unit: w.unit, n: Math.max(min, Math.min(max, n)) };
}

/** "8m", "3y", "2w", "all" */
export function encodeWindow(w: ViewWindow): string {
  const c = clampWindow(w);
  return c === "all" ? "all" : `${c.n}${LETTER[c.unit]}`;
}

/** URL value -> window; out-of-range numbers clamp, anything else is null */
export function decodeWindow(raw: string | null | undefined): ViewWindow | null {
  const s = raw?.trim().toLowerCase();
  if (!s) return null;
  if (s === "all") return "all";
  const m = /^(\d{1,3})([wmy])$/.exec(s);
  if (!m) return null;
  return clampWindow({ unit: FROM_LETTER[m[2]], n: Number(m[1]) });
}

const DAYS_PER_MONTH = 365.25 / 12;

/**
 * Months shown either side of the event in the monthly chart. Weeks round up to whole months (at least 1), so the
 * monthly chart that sits behind a daily view (or replaces it for a variable without daily data) covers the same days.
 */
export function windowMonths(w: ViewWindow): number | "all" {
  if (w === "all") return "all";
  const c = clampWindow(w) as Exclude<ViewWindow, "all">;
  if (c.unit === "month") return c.n;
  if (c.unit === "year") return c.n * 12;
  return Math.max(1, Math.ceil((c.n * 7) / DAYS_PER_MONTH));
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
 * Convert a window to another unit, keeping roughly the same reach, clamped to that unit's range
 * (12 months -> 1 year, 2 years -> 12 months, 8 months -> 5 weeks).
 */
export function convertWindow(w: ViewWindow, unit: WindowUnit): Exclude<ViewWindow, "all"> {
  const days = w === "all" ? 10 * 365.25 : reachDays(clampWindow(w) as Exclude<ViewWindow, "all">);
  const per = unit === "week" ? 7 : unit === "month" ? DAYS_PER_MONTH : 365.25;
  return clampWindow({ unit, n: Math.round(days / per) }) as Exclude<ViewWindow, "all">;
}
function reachDays(w: Exclude<ViewWindow, "all">): number {
  return w.n * (w.unit === "week" ? 7 : w.unit === "month" ? DAYS_PER_MONTH : 365.25);
}

/** The legacy `pad` (months either side, 3–60) as a window: up to 12 months stay months, longer become years. */
export function windowFromPad(pad: number): Exclude<ViewWindow, "all"> {
  return (pad <= 12 ? clampWindow({ unit: "month", n: pad }) : clampWindow({ unit: "year", n: Math.round(pad / 12) })) as Exclude<ViewWindow, "all">;
}

const UNIT_WORD: Record<WindowUnit, [string, string]> = { week: ["week", "weeks"], month: ["month", "months"], year: ["year", "years"] };
/** "± 8 months", "± 1 week", "All" */
export function windowLabel(w: ViewWindow): string {
  if (w === "all") return "All";
  const c = clampWindow(w) as Exclude<ViewWindow, "all">;
  return `± ${c.n} ${UNIT_WORD[c.unit][c.n === 1 ? 0 : 1]}`;
}

/* ------------------------------------------------------------------ days (the weeks view) */

const DAY_MS = 86_400_000;
const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const firstDay = (m: YearMonth) => `${m}-01`;
function lastDay(m: YearMonth): string {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  return dayStr(Date.UTC(y, mo, 1) / DAY_MS - 1);
}

/** Inclusive weeks window: [event start day − 7n, event end day + 7n] (UTC, "YYYY-MM-DD"). */
export function dailySpan(event: TimeRange, weeks: number): { start: string; end: string; days: number } {
  const n = Math.max(WINDOW_LIMITS.week.min, Math.min(WINDOW_LIMITS.week.max, Math.round(weeks)));
  const days = eventDays(event);
  const s = dayNum(days.start) - 7 * n;
  const e = dayNum(days.end) + 7 * n;
  return { start: dayStr(s), end: dayStr(e), days: e - s + 1 };
}

/** Exact event days when supplied; legacy month ranges expand to their first/last days. */
export function eventDays(event: TimeRange): { start: string; end: string } {
  return {
    start: event.start.length === 10 ? event.start : firstDay(event.start),
    end: event.end.length === 10 ? event.end : lastDay(event.end),
  };
}
