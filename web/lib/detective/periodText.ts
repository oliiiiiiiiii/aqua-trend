// A typed period for the When field: exact days, relative phrases, or anything suggestedTime reads (months, years,
// decades). Returns days ("YYYY-MM-DD") when the text names days or a relative span, else months ("YYYY-MM"); the
// input page stores days as exactTime and months as the period. Pure: no DOM, runs under `npx tsx --test`.
//
//   days      2021-03-05 · 2021/3/5 · 5 Mar 2021 · Mar 5, 2021 · 2021年3月5日
//             ranges of those joined by "to", "–", "..", "至", "到"; 5–12 Mar 2021 · Mar 5–12 2021 · 2021年3月5日到12日
//   relative  today · yesterday · last 7 days · past 3 weeks · last 2 months · this month · last month · this year ·
//             last year · 最近 7 天 · 過去 3 週 · 上個月 · 今年 · 去年 (finished days only: up to yesterday, UTC)
//   months    Feb–May 2021 · 2021-02..2021-05 · 2021 年 2 月到 5 月 · 2021 · 2019–20 · 1990s (lib/detective/keywords)
import type { TimeRange } from "./contracts";
import { dayNumber, dayString } from "./daily";
import { suggestedTime } from "./keywords";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const Y = "((?:19|20)\\d{2})";
const D = "(3[01]|[12]\\d|0?[1-9])";
const M = "(1[0-2]|0?[1-9])";
const SEP = "\\s*(?:\\.\\.|-|–|—|~|～|to|through|until|thru|至|到)\\s*";

const day = (y: number | string, m: number | string, d: number | string): string | null => {
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return dayNumber(s) === null ? null : s;
};
const mon = (s: string) => MONTHS[s.slice(0, 3).toLowerCase()];
const pair = (a: string | null, b: string | null): TimeRange | null => (a && b && a <= b ? { start: a, end: b } : null);

/** One exact day written any common way; null otherwise. */
export function parseDay(text: string): string | null {
  const t = text.normalize("NFKC").trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(new RegExp(`^${Y}\\s*[-/.]\\s*${M}\\s*[-/.]\\s*${D}$`)))) return day(m[1], m[2], m[3]);
  if ((m = t.match(new RegExp(`^${Y}\\s*年\\s*${M}\\s*月\\s*${D}\\s*[日號号]?$`)))) return day(m[1], m[2], m[3]);
  if ((m = t.match(new RegExp(`^${D}\\s+${MON},?\\s+${Y}$`, "i")))) return day(m[3], mon(m[2]), m[1]);
  if ((m = t.match(new RegExp(`^${MON}\\s+${D}(?:st|nd|rd|th)?,?\\s+${Y}$`, "i")))) return day(m[3], mon(m[1]), m[2]);
  return null;
}

const REVERSED: TimeRange = { start: "", end: "" };

/** Inclusive day ranges and single days; null when the text names no exact day; REVERSED for an end before the start. */
function parseDays(t: string): TimeRange | null {
  let m: RegExpMatchArray | null;
  // 5–12 Mar 2021
  if ((m = t.match(new RegExp(`^${D}${SEP}${D}\\s+${MON},?\\s+${Y}$`, "i")))) return pair(day(m[4], mon(m[3]), m[1]), day(m[4], mon(m[3]), m[2]));
  // 28 Feb – 6 Mar 2021
  if ((m = t.match(new RegExp(`^${D}\\s+${MON}${SEP}${D}\\s+${MON},?\\s+${Y}$`, "i")))) {
    const y2 = Number(m[5]), y1 = y2 - Number(mon(m[2]) > mon(m[4]));
    return pair(day(y1, mon(m[2]), m[1]), day(y2, mon(m[4]), m[3]));
  }
  // Mar 5–12, 2021
  if ((m = t.match(new RegExp(`^${MON}\\s+${D}${SEP}${D},?\\s+${Y}$`, "i")))) return pair(day(m[4], mon(m[1]), m[2]), day(m[4], mon(m[1]), m[3]));
  // 2021年3月5日到12日 / 到4月2日
  if ((m = t.match(new RegExp(`^${Y}\\s*年\\s*${M}\\s*月\\s*${D}\\s*[日號号]?${SEP}(?:${M}\\s*月\\s*)?${D}\\s*[日號号]?$`)))) {
    return pair(day(m[1], m[2], m[3]), day(m[1], m[4] ?? m[2], m[5]));
  }
  // two full days: 2021-03-05 to 2021-03-12, 5 Mar 2021 – 2 Apr 2021, ...
  const parts = t.split(new RegExp(`\\s*(?:\\.\\.|–|—|~|～|\\bto\\b|\\bthrough\\b|\\buntil\\b|\\bthru\\b|至|到|\\s-\\s)\\s*`, "i"));
  if (parts.length === 2) {
    const a = parseDay(parts[0]), b = parseDay(parts[1]);
    if (a && b) return pair(a, b) ?? REVERSED; // two exact days the wrong way round: not a month guess
  }
  const one = parseDay(t);
  return one ? { start: one, end: one } : null;
}

/** last finished UTC day */
const yesterday = (now: number) => Math.floor(now / 86_400_000) - 1;

/** Relative phrases, ending yesterday (UTC): today's data is not complete. */
function parseRelative(t: string, now: number): TimeRange | null {
  const y = yesterday(now);
  const end = dayString(y);
  const lower = t.toLowerCase();
  if (/^(today|yesterday|今天|今日|昨天|昨日)$/.test(lower)) return { start: end, end };
  let m = lower.match(/^(?:last|past|previous|the last|the past)\s+(\d{1,3})\s+(day|week|month|year)s?$/);
  const zh = t.match(/^(?:最近|過去|过去|近)\s*(\d{1,3})\s*(天|日|週|周|星期|個月|个月|月|年)$/);
  const n = m ? Number(m[1]) : zh ? Number(zh[1]) : 0;
  const unit = m ? m[2] : zh ? ({ 天: "day", 日: "day", 週: "week", 周: "week", 星期: "week", 個月: "month", 个月: "month", 月: "month", 年: "year" } as Record<string, string>)[zh[2]] : null;
  if (n > 0 && unit) {
    const days = unit === "day" ? n : unit === "week" ? 7 * n : 0;
    if (days) return { start: dayString(y - days + 1), end };
    const e = new Date(y * 86_400_000);
    const back = unit === "month" ? n : 12 * n;
    const s = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - back, e.getUTCDate() + 1));
    return { start: s.toISOString().slice(0, 10), end };
  }
  const d = new Date(y * 86_400_000), yr = d.getUTCFullYear(), mo = d.getUTCMonth();
  const monthOf = (k: number) => {
    const a = new Date(Date.UTC(yr, mo + k, 1)), b = new Date(Date.UTC(yr, mo + k + 1, 0));
    return { start: a.toISOString().slice(0, 10), end: b.toISOString().slice(0, 10) };
  };
  if (/^(this month|本月|這個月|这个月)$/.test(lower)) return { start: monthOf(0).start, end };
  if (/^(last month|previous month|上個月|上个月|上月)$/.test(lower)) return monthOf(-1);
  if (/^(this year|今年)$/.test(lower)) return { start: `${yr}-01-01`, end };
  if (/^(last year|previous year|去年)$/.test(lower)) return { start: `${yr - 1}-01-01`, end: `${yr - 1}-12-31` };
  if (/^(this week|本週|本周|這週|这周)$/.test(lower)) return { start: dayString(y - 6), end };
  if (/^(last week|上週|上周)$/.test(lower)) return { start: dayString(y - 13), end: dayString(y - 7) };
  return null;
}

/**
 * The period a typed text names: exact days first, then relative phrases, then months / years (suggestedTime, which
 * also finds a period inside a longer sentence). null when nothing is recognised.
 */
export function parsePeriod(text: string, now = Date.now()): TimeRange | null {
  const t = text.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!t) return null;
  const days = parseDays(t);
  if (days) return days === REVERSED ? null : days;
  return parseRelative(t, now) ?? suggestedTime(t);
}
