// Pure helpers of the daily view: day lists longer than one month, ≤ 3-day request pieces, load-time estimate, the
// normal of each day (trend + seasonal cycle) and the daily anomaly. No DOM: run under `npx tsx --test`.
import type { Decomposition } from "@/lib/detective/contracts";
import { DAILY_REQUEST_MAX_DAYS, dayNumber, dayString } from "@/lib/detective/daily";

/** spans up to this many days load by themselves (after a short debounce) */
export const AUTO_MAX_DAYS = 62;
/** for longer spans only the selection's own days load by themselves, when there are at most this many */
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
 * The part of `range` that loads without a click: all of it up to AUTO_MAX_DAYS; otherwise the focus days (the
 * selection's own days, clipped to the range) when they are at most EVENT_AUTO_MAX_DAYS; otherwise nothing.
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
const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const daysInMonth = (k: number) => new Date(Date.UTC(Math.floor(k / 12), (k % 12) + 1, 0)).getUTCDate();

/** months of context either side of the days asked for when the mid-month levels are solved (the coupling decays ~6× per month) */
const NORMAL_CONTEXT_MONTHS = 8;
const NORMAL_ITERATIONS = 40;

/** weights of the previous / next month's node in the mean of a month of `days` days under mid-month interpolation (≈ 1/8 each) */
function sideWeights(days: number): { prev: number; next: number } {
  let prev = 0, next = 0;
  for (let dom = 1; dom <= days; dom++) {
    const pos = (dom - 0.5) / days;
    if (pos < 0.5) prev += 0.5 - pos; else next += pos - 0.5;
  }
  return { prev: prev / days, next: next / days };
}

/**
 * The normal of each day: the long-term trend plus the seasonal cycle of the monthly decomposition, carried to days.
 *
 * A day's normal lies on straight lines between mid-month levels, so the seasonal cycle and the trend move smoothly
 * through the month instead of jumping on the 1st. The levels are not the monthly normals themselves but are solved so
 * that the mean of the daily normal over every month equals that month's normal (trend + seasonal) exactly: a month of
 * daily anomalies then averages to the anomaly the monthly statistics would give for the same values. (Plain
 * interpolation of the monthly normals would flatten every peak and trough of the cycle.) Where every monthly normal
 * is ≥ 0 the daily normal is not allowed below 0 (a dry month next to a very wet one).
 *
 * Beyond the ends of the record the model is continued for the neighbouring nodes only (the linear trend extended,
 * the same calendar month's seasonal value). Days whose month is outside the monthly record are null.
 */
export function dailyNormal(d: Decomposition | null, dates: string[]): (number | null)[] {
  const n = d?.months.length ?? 0;
  if (!d || n === 0) return dates.map(() => null);
  const k0 = monthIndex(d.months[0]);
  const slope = n > 1 ? d.trend[1] - d.trend[0] : 0;
  const monthly = (k: number): number | null => {
    const i = k - k0;
    let v: number | null = null;
    if (i >= 0 && i < n) v = d.trend[i] + d.seasonal[i];
    else {
      const j = i < 0 ? i + 12 : i - 12; // the same calendar month, one year inside the record
      if (j >= 0 && j < n) v = d.trend[j] + slope * (i - j) + d.seasonal[j];
    }
    return v !== null && Number.isFinite(v) ? v : null;
  };

  const wanted = dates.map(monthIndex).filter((k) => k >= k0 && k < k0 + n && monthly(k) !== null);
  if (!wanted.length) return dates.map(() => null);
  // a contiguous run of months around the days asked for
  let first = Math.min(...wanted), last = Math.max(...wanted);
  for (let i = 0; i < NORMAL_CONTEXT_MONTHS && monthly(first - 1) !== null; i++) first--;
  for (let i = 0; i < NORMAL_CONTEXT_MONTHS && monthly(last + 1) !== null; i++) last++;
  const target: number[] = [];
  for (let k = first; k <= last; k++) {
    const v = monthly(k);
    if (v === null) return dates.map(() => null); // a hole in the model: no normal rather than a guessed one
    target.push(v);
  }
  const weights = target.map((_, i) => sideWeights(daysInMonth(first + i)));

  // mid-month levels whose interpolated monthly means reproduce the monthly normals (Jacobi; the system is diagonally dominant)
  let node = target.slice();
  const at = (c: number[], i: number) => c[Math.max(0, Math.min(c.length - 1, i))]; // flat beyond the context
  for (let it = 0; it < NORMAL_ITERATIONS; it++) {
    node = node.map((c, i) => {
      const w = weights[i];
      const mean = c * (1 - w.prev - w.next) + at(node, i - 1) * w.prev + at(node, i + 1) * w.next;
      return c + (target[i] - mean);
    });
  }
  const floor = target.every((v) => v >= 0) ? 0 : -Infinity;

  return dates.map((day) => {
    const k = monthIndex(day);
    if (k < k0 || k >= k0 + n || k < first || k > last) return null;
    const i = k - first;
    const pos = (Number(day.slice(8, 10)) - 0.5) / daysInMonth(k); // 0 … 1 through the month, 0.5 = its middle
    const other = at(node, pos < 0.5 ? i - 1 : i + 1);
    const w = Math.abs(pos - 0.5);
    return Math.max(floor, node[i] * (1 - w) + other * w);
  });
}

export interface DailyLevel {
  /** what the daily product reads above (+) or below (−) the monthly series, in the series' unit */
  offset: number;
  /** observed days the offset was estimated from */
  days: number;
  /** whole calendar months among them; 0 = provisional (no month is fully loaded yet, every usable day counts) */
  months: number;
}

/**
 * The constant difference in level between the daily product and the monthly series.
 *
 * Daily and monthly values come from the same product family but are averaged over the basin differently (native
 * grid and polygon mask against the 0.5° resampling), which leaves a level difference that is far from negligible
 * (tens of mm for root-zone soil moisture). The monthly normal therefore cannot be subtracted from daily values
 * as it is. For every observed day the monthly series says what the level should be: that day's normal plus its
 * month's anomaly; the offset is the mean of (daily value − that).
 *
 * It is taken over the months that are wholly loaded and observed. For such a month it is exactly "mean of the
 * month's daily values − the month's monthly value" (the daily normal keeps monthly means), so the month's daily
 * anomalies average to its monthly anomaly. Until a whole month is in (loading, or a short span), every usable day
 * counts and the result is provisional. null when no loaded day lies in a month that has a monthly value.
 */
export function dailyLevel(d: Decomposition | null, dates: string[], values: (number | null)[], normal: (number | null)[]): DailyLevel | null {
  if (!d) return null;
  const at = new Map(d.months.map((m, i) => [m, i]));
  const byMonth = new Map<string, { sum: number; days: number }>();
  dates.forEach((day, i) => {
    const ym = day.slice(0, 7);
    const v = values[i], nrm = normal[i], k = at.get(ym);
    const anomaly = k === undefined ? null : d.residual[k];
    if (v == null || nrm == null || anomaly == null || !Number.isFinite(v) || !Number.isFinite(nrm) || !Number.isFinite(anomaly)) return;
    const m = byMonth.get(ym) ?? { sum: 0, days: 0 };
    m.sum += v - nrm - anomaly;
    m.days++;
    byMonth.set(ym, m);
  });
  const all = [...byMonth.entries()];
  const whole = all.filter(([ym, m]) => m.days === daysInMonth(monthIndex(ym)));
  const used = whole.length ? whole : all;
  const days = used.reduce((n, [, m]) => n + m.days, 0);
  return days ? { offset: used.reduce((t, [, m]) => t + m.sum, 0) / days, days, months: whole.length } : null;
}

/** The daily normal at the daily product's own level (see dailyLevel); all null without a level. */
export function levelledNormal(normal: (number | null)[], level: DailyLevel | null): (number | null)[] {
  return normal.map((v) => (v == null || !level ? null : v + level.offset));
}

/**
 * Daily anomaly: the day's value minus its normal (seasonal cycle and long-term trend removed). Pass the levelled
 * normal, so that a month of daily anomalies averages to that month's monthly anomaly. null stays null.
 */
export function dailyAnomaly(values: (number | null)[], normal: (number | null)[]): (number | null)[] {
  return values.map((v, i) => {
    const nrm = normal[i];
    return v == null || nrm == null || !Number.isFinite(v) || !Number.isFinite(nrm) ? null : v - nrm;
  });
}

export interface DailySelectionSummary {
  /** calendar days of the selection inside the loaded span */
  days: number;
  /** of those, days with an observed value */
  observed: number;
  /** mean of the observed values; null without any */
  meanValue: number | null;
  /** days with an anomaly (observed and with a normal) */
  n: number;
  /** mean daily anomaly of the selection; null without any */
  meanAnomaly: number | null;
}

/** What the selected days say: their mean value and mean anomaly, over the days loaded so far. */
export function selectionSummary(
  dates: string[], values: (number | null)[], anomaly: (number | null)[], selection: DayRange,
): DailySelectionSummary {
  let days = 0, observed = 0, sumV = 0, n = 0, sumA = 0;
  dates.forEach((day, i) => {
    if (day < selection.start || day > selection.end) return;
    days++;
    const v = values[i], a = anomaly[i];
    if (v != null && Number.isFinite(v)) { observed++; sumV += v; }
    if (a != null && Number.isFinite(a)) { n++; sumA += a; }
  });
  return { days, observed, meanValue: observed ? sumV / observed : null, n, meanAnomaly: n ? sumA / n : null };
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
