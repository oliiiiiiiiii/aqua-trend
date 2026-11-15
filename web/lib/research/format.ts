// Display helpers for the research page. Formatting only: nothing here derives a statistic.
import type { ItemStatus, JobStage, JobStatus, Period, Role, SignificanceLabel } from "./types";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MINUS = "−";

const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isYm = (s: string | null | undefined): boolean => !!s && YM.test(s);

/** Same index as backend timeaxis.ym_to_index: year * 12 + (month - 1). */
export function ymIndex(ym: string): number {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}
export function indexYm(i: number): string {
  return `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** "2015-07" -> "Jul 2015"; "2015" stays "2015" */
export function timeLabel(t: string | null | undefined): string {
  if (!t) return "—";
  return isYm(t) ? `${MONTH_SHORT[Number(t.slice(5, 7)) - 1]} ${t.slice(0, 4)}` : t;
}

export function periodLabel(p: Period | { start?: string | null; end?: string | null } | null | undefined): string {
  if (!p || !p.start || !p.end) return "—";
  return `${timeLabel(p.start)} to ${timeLabel(p.end)}`;
}

/** fractional calendar year of the centre of a "YYYY-MM" month or a "YYYY" year */
export function timeX(t: string): number {
  return isYm(t) ? Number(t.slice(0, 4)) + (Number(t.slice(5, 7)) - 0.5) / 12 : Number(t.slice(0, 4)) + 0.5;
}

/** Fixed decimals with a true minus sign; "—" for null. */
export function fixed(x: number | null | undefined, decimals: number, sign = false): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const abs = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const isZero = Number(Math.abs(x).toFixed(decimals)) === 0;
  if (isZero) return abs;
  return (x < 0 ? MINUS : sign ? "+" : "") + abs;
}

/** decimals that show about `sig` significant digits of the largest magnitude in `xs` (0..6) */
export function decimalsFor(xs: (number | null | undefined)[], sig = 3): number {
  let m = 0;
  for (const x of xs) if (x != null && Number.isFinite(x)) m = Math.max(m, Math.abs(x));
  if (m === 0) return 1;
  return Math.min(6, Math.max(0, sig - 1 - Math.floor(Math.log10(m))));
}

/** A p-value is never printed as 0. */
export function pText(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "not available";
  if (p < 0.001) return "< 0.001";
  return p.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export const pct = (x: number | null | undefined, decimals = 0): string =>
  x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toLocaleString("en-US", { maximumFractionDigits: decimals })} %`;

export const ROLE_LABEL: Record<Role, string> = {
  core_indicator: "Phenomenon indicator",
  related_condition: "Related condition",
  response: "Possible response",
};
export const ROLE_HELP: Record<Role, string> = {
  core_indicator: "Variables the catalogue describes as the most direct measure of the phenomenon.",
  related_condition: "Conditions the catalogue links to the phenomenon.",
  response: "Variables that may respond when the phenomenon occurs.",
};
export const ROLE_ORDER: Role[] = ["core_indicator", "related_condition", "response"];

export const STAGE_LABEL: Record<JobStage, string> = {
  validating: "Checking the inputs",
  selecting_variables: "Selecting variables from the catalogue",
  resolving_defaults: "Filling open conditions from presets",
  resolving_products: "Choosing one data product per variable",
  analyzing: "Computing trends and indicators",
  correcting: "Correcting for multiple comparisons",
  explaining: "Writing the summary",
  complete: "Done",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  running: "Running",
  complete: "Complete",
  partial: "Partial result",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Status words for one data item. A status is a state of the data, never a number. */
export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  ok: "Analysed",
  data_required: "Data not delivered yet",
  insufficient_data: "Not enough data",
  insufficient_baseline: "Reference period not supported",
  not_applicable: "Not applicable",
  definition_required: "No approved standard definition",
  unsupported_resolution: "Resolution not supported",
  no_common_period: "No common period",
  no_series: "No prepared series for this region",
};
export const itemStatusLabel = (s: string): string => (ITEM_STATUS_LABEL as Record<string, string>)[s] ?? s.replace(/_/g, " ");

export interface SignificanceCopy {
  /** short text of the badge */
  label: string;
  /** one sentence under it */
  explain: string;
  /** glyph drawn next to the text (text carries the meaning; the glyph and colour only support it) */
  icon: string;
  /** CSS custom property used for the badge edge */
  tone: string;
}

/**
 * Wording of the main corrected label (spec §7.2: "undetermined" must not read as "not significant").
 * The label itself comes from the backend; this only maps it to words.
 */
export const SIGNIFICANCE: Record<SignificanceLabel, SignificanceCopy> = {
  significant: {
    label: "Significant after correction",
    explain: "The adjusted p-value is below the significance level of this comparison family.",
    icon: "●",
    tone: "--status-good",
  },
  not_significant: {
    label: "Not significant after correction",
    explain: "The test was valid and its adjusted p-value is not below the significance level. This is not evidence of no change.",
    icon: "○",
    tone: "--ink-3",
  },
  undetermined: {
    label: "Undetermined: no valid test",
    explain: "The data do not support a significance test here, so there is no confidence interval and no p-value. The slope is descriptive only. This is different from “not significant”.",
    icon: "?",
    tone: "--status-warning",
  },
  provisional: {
    label: "Provisional: correction not finished",
    explain: "The comparison family is not complete yet, so no final corrected label is published.",
    icon: "…",
    tone: "--status-serious",
  },
};

export const FAMILY_SCOPE_LABEL: Record<string, string> = {
  query: "Query family",
  preset_search: "Preset-search family",
};

/** "benjamini_yekutieli" -> "Benjamini–Yekutieli (BY) false discovery rate" */
export function methodLabel(m: string | null | undefined): string {
  if (!m) return "—";
  if (m === "benjamini_yekutieli") return "Benjamini–Yekutieli (BY) false discovery rate";
  return m.replace(/_/g, " ");
}

/**
 * NASA / non-NASA wording. Uses the backend's explicit flag when the product decision carries one; otherwise
 * falls back to the agency text it sent (an agency that starts with "NASA").
 */
export function agencyKind(agency: string | null | undefined, nasa?: boolean | null): string | null {
  if (typeof nasa === "boolean") return nasa ? "NASA product" : "Non-NASA product";
  if (!agency) return null;
  return /^\s*NASA\b/i.test(agency) ? "NASA product" : "Non-NASA product";
}

export const short = (id: string | null | undefined, n = 10): string => (!id ? "—" : id.length > n + 2 ? `${id.slice(0, n)}…` : id);
