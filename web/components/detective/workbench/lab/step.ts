// The time step the Tests area works in: months (the monthly workbench), or days and weeks (the daily view, where the
// lab's tools run on the daily or weekly anomaly; lib/detective/fine.ts). The tools themselves count index steps, so
// only the words change: labCopy(step) is COPY.lab with "month" read as "day" or "week" throughout.
import { createContext, useContext } from "react";
import { formatRange, formatYm } from "@/lib/detective/url";
import { COPY } from "../copy";

export type LabStep = "month" | "week" | "day";

/** How the Tests area names points of the tested series. Indices are into d.months (for days and weeks: the points). */
export interface LabAxis {
  step: LabStep;
  /** "Mar 2021", "4 Mar 2021", "1–7 Mar 2021" */
  label: (i: number) => string;
  /** "Mar – Jun 2021", "4 – 17 Mar 2021" */
  span: (a: number, b: number) => string;
  /** "4 mo", "14 days", "3 weeks" */
  count: (n: number) => string;
}

const WORDS: Record<Exclude<LabStep, "month">, { one: string; many: string; abbr: string; adj: string }> = {
  day: { one: "day", many: "days", abbr: "d", adj: "daily" },
  week: { one: "week", many: "weeks", abbr: "wk", adj: "weekly" },
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Month wording of the lab's copy turned into day or week wording. */
export function unitize(text: string, step: LabStep): string {
  if (step === "month") return text;
  const w = WORDS[step];
  return text
    // the two places that speak of years of context, in index steps
    .replace(/about 3 years of unbroken data/g, `about 30 ${w.many} of unbroken data`)
    .replace(/about one per 5 years/g, `about one per 60 ${w.many}`)
    .replace(/(\d)-month\b/g, `$1-${w.one}`)
    .replace(/\bmonths\b/g, w.many).replace(/\bMonths\b/g, cap(w.many))
    .replace(/\bmonthly\b/g, w.adj).replace(/\bMonthly\b/g, cap(w.adj))
    .replace(/\bmonth\b/g, w.one).replace(/\bMonth\b/g, cap(w.one))
    .replace(/\bmo\b/g, w.abbr);
}

type Lab = typeof COPY.lab;

function mapDeep<T>(v: T, f: (s: string) => string): T {
  if (typeof v === "string") return f(v) as T;
  if (typeof v === "function") {
    const fn = v as unknown as (...a: unknown[]) => unknown;
    return ((...a: unknown[]) => { const r = fn(...a); return typeof r === "string" ? f(r) : r; }) as T;
  }
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapDeep(x, f)])) as T;
  return v;
}

const cache = new Map<LabStep, Lab>();
/** COPY.lab in the words of `step`. */
export function labCopy(step: LabStep = "month"): Lab {
  const known = cache.get(step);
  if (known) return known;
  let c: Lab = COPY.lab;
  if (step !== "month") {
    const words = mapDeep(COPY.lab, (s) => unitize(s, step));
    const per = step === "day" ? 7 : 1;
    // the copy is typed by its English literals; the day / week words are the same shape
    c = {
      ...words,
      perYear: (unit: string) => `${unit}/wk`,
      // the calendar-month test keeps its own words: it is listed, greyed out, on days and weeks
      monthlyOnly: COPY.lab.monthlyOnly,
      test: { ...words.test, monthly: COPY.lab.test.monthly },
      testTitle: { ...words.testTitle, monthly: COPY.lab.testTitle.monthly },
      fig: {
        ...words.fig,
        lag: `lag (${WORDS[step].abbr})`,
        period: (m: number) => (step === "day" && m < 14 ? `${Math.round(m * 10) / 10} d` : `${Math.round((m / per) * 10) / 10} wk`),
      },
    } as unknown as Lab;
  }
  cache.set(step, c);
  return c;
}

/** Slopes per decade or year (months), per week (days and weeks). `k` converts per-step values. */
export function slopeFor(step: LabStep, n: number): { k: number; per: "decade" | "year" } {
  if (step === "day") return { k: 7, per: "year" };   // labCopy("day").perYear reads "/wk"
  if (step === "week") return { k: 1, per: "year" };
  return n >= 120 ? { k: 120, per: "decade" } : { k: 12, per: "year" };
}

export const LabStepContext = createContext<LabStep>("month");
export const useLabCopy = (): Lab => labCopy(useContext(LabStepContext));

/* ------------------------------------------------------------------ axes */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dParts = (iso: string) => ({ y: iso.slice(0, 4), m: MON[Number(iso.slice(5, 7)) - 1], d: String(Number(iso.slice(8, 10))) });

/** "4 Mar 2021"; a range "4 – 17 Mar 2021", "28 Feb – 6 Mar 2021", "28 Dec 2020 – 3 Jan 2021" */
export function formatDays(start: string, end: string = start): string {
  const a = dParts(start), b = dParts(end);
  if (start === end) return `${a.d} ${a.m} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
  return `${a.d} – ${b.d} ${b.m} ${b.y}`;
}

export function monthAxis(months: readonly string[]): LabAxis {
  return {
    step: "month",
    label: (i) => (months[i] ? formatYm(months[i]) : "—"),
    span: (a, b) => (months[a] && months[b] ? formatRange({ start: months[a], end: months[b] }) : "—"),
    count: (n) => `${n} mo`,
  };
}

/** The points of a day or week series (first and last day of each). */
export function pointAxis(step: "day" | "week", start: readonly string[], end: readonly string[]): LabAxis {
  return {
    step,
    label: (i) => (start[i] ? formatDays(start[i], end[i]) : "—"),
    span: (a, b) => (start[a] && end[b] ? formatDays(start[a], end[b]) : "—"),
    count: (n) => `${n} ${WORDS[step][n === 1 ? "one" : "many"]}`,
  };
}
