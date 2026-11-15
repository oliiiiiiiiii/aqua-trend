// UI strings of the Days and Weeks statistics (daily/FineStats) and the daily chart's selection. English, few words.
import type { FineStep } from "@/lib/detective/fine";

const W = { day: ["day", "days"], week: ["week", "weeks"] } as const;
export const unitWord = (step: FineStep, n: number) => W[step][n === 1 ? 0 : 1];
const ORD = (n: number) => { const t = n % 100; return t >= 11 && t <= 13 ? `${n}th` : `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`; };

export const COPY = {
  heading: (step: FineStep) => (step === "day" ? "Statistics for the selected days" : "Statistics for the selected weeks"),
  selection: (range: string, n: number, step: FineStep) => `${range} · ${n} ${unitWord(step, n)}`,
  verdict: {
    significant: { low: "Unusually low", high: "Unusually high" },
    mixed: "Tests disagree",
    notSignificant: "Within normal variability",
    insufficient: "Not enough data",
    vsWindow: (step: FineStep) => `Compared with the other loaded ${unitWord(step, 2)}.`,
    vsYears: (k: number) => `Compared with the same days in ${k} earlier ${k === 1 ? "year" : "years"}.`,
    notCause: "Timing match, not proof of cause.",
  },
  difference: "Difference",
  differenceSub: (mean: string, ref: string) => `mean anomaly ${mean} vs ${ref}`,
  ci: (lo: string, hi: string) => `95 % CI ${lo} … ${hi}`,
  standardised: "Standardised",
  sigmaSub: (sigma: string, rho: string) => `σ ${sigma} · lag-1 r ${rho}`,
  significance: "Significance",
  windows: (k: number, n: number) => `${k} of ${n} windows as extreme`,
  noWindows: (min: number) => `Fewer than ${min} baseline windows`,
  rank: "Rank among years",
  rankValue: (pos: number, of: number, dir: "low" | "high") =>
    `${pos === 1 ? (dir === "low" ? "Lowest" : "Highest") : `${ORD(pos)} ${dir === "low" ? "lowest" : "highest"}`} of ${of}`,
  rankSub: "the same days, every year",
  noRank: "n/a",
  noRankWhy: "Needs earlier years, and every selected point observed",
  peak: (label: string, z: string) => `Peak ${label} ${z}`,
  beyond2: (k: number, n: number, step: FineStep) => `${k} of ${n} ${unitWord(step, n)} beyond 2σ`,
  n: (n: number, of: number) => `n = ${n}${of > n ? ` (${of - n} missing)` : ""}`,
  baseline: {
    heading: "Compare with",
    window: (step: FineStep) => (step === "day" ? "Surrounding days" : "Surrounding weeks"),
    windowTitle: "The loaded points either side of the selection. Instant; says whether the selection differs from the weeks around it.",
    years: "Same days, past years",
    yearsTitle: "The selected days ± a margin in earlier years, fetched from NASA. Says whether the selection is unusual for this time of year.",
    howMany: "Years",
    possible: (n: number) => `${n} available`,
    build: (days: number, eta: string) => `Load ${days} days · about ${eta}`,
    buildHint: "Fetched once, then kept for this session.",
    progress: (done: number, total: number) => `${done} of ${total} days`,
    left: (eta: string) => `about ${eta} left`,
    stop: "Stop",
    resume: "Resume",
    retry: "Retry",
    failed: "Earlier years did not load.",
    pending: "Until they are in, the statistics use the surrounding points.",
    none: "No earlier years in the record for these days.",
  },
  method: {
    window: (step: FineStep) => `Baseline: the loaded ${unitWord(step, 2)} outside the selection. Difference = selection mean − baseline mean; AR(1) z test with σ and lag-1 r pooled over the selection and the baseline (each about its own mean), the baseline mean's uncertainty included; empirical test against every same-length window in the baseline (needs 20).`,
    years: (step: FineStep) => `Baseline: the same calendar ${unitWord(step, 2)} ± a margin in earlier years, with the same normal (monthly trend + seasonal cycle) and one level offset for all years. Difference = selection mean − baseline mean; AR(1) z test; empirical test against every same-length window of those years; rank among the years.`,
  },
  reset: "Reset to the month selection",
  chartSelect: "Drag to select days; drag the selection to move it or its edges to resize. Arrows move it, Shift + arrows resize.",
  chartSelectWeeks: "Drag to select weeks; drag the selection to move it or its edges to resize. Arrows move it, Shift + arrows resize.",
} as const;
