// Time geometry shared by the evidence charts. Months are "YYYY-MM"; x is a fractional calendar year.

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
export const MONTH_INITIAL = MONTH_NAMES.map((m) => m[0]);

export interface TimeAxis {
  firstYear: number;
  firstMonth: number;
  n: number;
  /** x (fractional year) of the centre of month i */
  monthX: (i: number) => number;
  /** nearest month index to fractional year t, clamped */
  indexAt: (t: number) => number;
  /** month index of (year, calendar month 0-11), clamped into range */
  indexOf: (year: number, month: number) => number;
  domain: [number, number];
  yearOf: (i: number) => number;
  monthOf: (i: number) => number;
}

export function timeAxis(months: string[]): TimeAxis {
  const firstYear = Number(months[0].slice(0, 4));
  const firstMonth = Number(months[0].slice(5, 7)) - 1;
  const n = months.length;
  const pos = (i: number) => firstMonth + i;
  const yearOf = (i: number) => firstYear + Math.floor(pos(i) / 12);
  const monthOf = (i: number) => pos(i) % 12;
  const monthX = (i: number) => firstYear + (pos(i) + 0.5) / 12;
  return {
    firstYear, firstMonth, n, monthX, yearOf, monthOf,
    indexAt: (t) => Math.min(n - 1, Math.max(0, Math.round((t - firstYear) * 12 - firstMonth - 0.5))),
    indexOf: (year, month) => Math.min(n - 1, Math.max(0, (year - firstYear) * 12 + month - firstMonth)),
    domain: [firstYear + firstMonth / 12, firstYear + (pos(n - 1) + 1) / 12],
  };
}

/** "Jul 2015" */
export const monthLabel = (ym: string) => `${MONTH_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const monthLong = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Runs of consecutive missing (non-finite) months as [startIndex, endIndex] inclusive. */
export function missingRuns(values: ArrayLike<number>): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    const miss = i < values.length && !Number.isFinite(values[i]);
    if (miss && start < 0) start = i;
    if (!miss && start >= 0) { runs.push([start, i - 1]); start = -1; }
  }
  return runs;
}

/** Nice-ish minus sign for display */
export const MINUS = "−";
export function signed(x: number, decimals: number): string {
  if (!Number.isFinite(x)) return "—";
  const s = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const zero = Number(Math.abs(x).toFixed(decimals)) === 0;
  return zero ? s : (x < 0 ? MINUS : "+") + s;
}
export function plain(x: number, decimals: number): string {
  if (!Number.isFinite(x)) return "—";
  const s = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (x < 0 && Number(Math.abs(x).toFixed(decimals)) !== 0 ? MINUS : "") + s;
}
