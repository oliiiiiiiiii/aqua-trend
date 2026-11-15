import type { TimeRange } from "./contracts";

export const DAILY_MAX_MONTHS = 1;
export const DAILY_MAX_DAYS = 31;
export const DAILY_REQUEST_MAX_DAYS = 3;
export const DAILY_LAYER_IDS = [
  "et_gldas", "sm_root", "sm_total", "runoff", "swe",
  "tair", "rn", "swdown", "wind", "p_imerg",
] as const;
export type DailyLayerId = typeof DAILY_LAYER_IDS[number];

export interface DailyRange { start: string; end: string }
export interface DailyRequest extends DailyRange { region: string; layer: DailyLayerId }
export interface DailySeries extends DailyRequest {
  resolution: "daily";
  dates: string[];
  values: (number | null)[];
  unit: string;
  source: {
    provider: "earthdata";
    dataset: string;
    url: string;
    aggregation: string;
    spatialMethod: string;
  };
  retrievedAt: string;
}

export function supportsDaily(layer: string): layer is DailyLayerId {
  return (DAILY_LAYER_IDS as readonly string[]).includes(layer);
}

const DAY_MS = 86_400_000;
export function dayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp / DAY_MS : null;
}

export function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function dailyDates(range: DailyRange): string[] {
  const start = dayNumber(range.start), end = dayNumber(range.end);
  if (start === null || end === null || end < start || end - start + 1 > DAILY_MAX_DAYS) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => dayString(start + i));
}

/** Whole calendar months, including both endpoints. */
export function shortDailyRange(time: TimeRange): DailyRange | null {
  const parse = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
    ? Number(s.slice(0, 4)) * 12 + Number(s.slice(5)) - 1 : null;
  const start = parse(time.start), end = parse(time.end);
  if (start === null || end === null || end < start || end - start + 1 > DAILY_MAX_MONTHS) return null;
  const next = end + 1;
  const nextMonth = `${String(Math.floor(next / 12)).padStart(4, "0")}-${String(next % 12 + 1).padStart(2, "0")}-01`;
  const last = dayNumber(nextMonth);
  return last === null ? null : { start: `${time.start}-01`, end: dayString(last - 1) };
}
