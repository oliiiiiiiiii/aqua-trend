// Pure helpers of the analysis workbench: month windows, the shared selection, verdict wording.
// No DOM, so they run under `npx tsx --test`.
import type { TimeRange } from "@/lib/detective/contracts";
import type { IntervalDetail } from "@/lib/detective/intervalDetail";
import { relationToEvent } from "@/lib/detective/intervalDetail";
import { formatRange, ymFromIndex, ymIndex } from "@/lib/detective/url";
import { num, pValue } from "../format";
import { COPY } from "./copy";

/** Inclusive range of absolute month indices (ymIndex). */
export interface Span { s: number; e: number }

export const toSpan = (r: TimeRange): Span => ({ s: ymIndex(r.start), e: ymIndex(r.end) });
export const toRange = (x: Span): TimeRange => ({ start: ymFromIndex(x.s), end: ymFromIndex(x.e) });
export const sameSpan = (a: Span | null | undefined, b: Span | null | undefined) => !!a && !!b && a.s === b.s && a.e === b.e;
export const spanLength = (x: Span) => x.e - x.s + 1;

/** Keep a selection inside the visible window; a selection that falls wholly outside returns to the event. */
export function clampSpan(sel: Span, view: Span, event: Span): Span {
  const s = Math.max(sel.s, view.s), e = Math.min(sel.e, view.e);
  if (s > e) return { s: Math.max(event.s, view.s), e: Math.min(event.e, view.e) };
  return { s, e };
}

/** Before · Event · After presets for a window; null when the window has no room on that side. */
export function presetSpans(view: Span, event: Span): { before: Span | null; event: Span; after: Span | null } {
  return {
    before: event.s - 1 >= view.s ? { s: view.s, e: event.s - 1 } : null,
    event: { s: Math.max(event.s, view.s), e: Math.min(event.e, view.e) },
    after: event.e + 1 <= view.e ? { s: event.e + 1, e: view.e } : null,
  };
}

/** Move by `d` months keeping the length, inside the window. */
export function shiftSpan(sel: Span, d: number, view: Span): Span {
  const len = sel.e - sel.s;
  const s = Math.max(view.s, Math.min(view.e - len, sel.s + d));
  return { s, e: s + len };
}

/** Move the end by `d` months; at least one month, inside the window. */
export function resizeSpan(sel: Span, d: number, view: Span): Span {
  return { s: sel.s, e: Math.max(sel.s, Math.min(view.e, sel.e + d)) };
}

/** "Nov 2020 – Jan 2021 · 3 mo · ends just before" */
export function selectionLabel(sel: Span, event: Span): { range: string; length: string; relation: string } {
  const r = relationToEvent(toRange(sel), toRange(event));
  const relation = r.kind === "same" ? COPY.relation.same
    : r.kind === "overlaps" ? COPY.relation.overlaps
    : r.kind === "before" ? COPY.relation.before(r.gapMonths)
    : COPY.relation.after(r.gapMonths);
  return { range: formatRange(toRange(sel)), length: COPY.toolbar.months(spanLength(sel)), relation };
}

export type Mark = "●" | "◐" | "○" | "–";

export interface VerdictView {
  mark: Mark;
  /** the headline: "Unusually low", "Tests disagree", … */
  label: string;
  /** one short qualifier: which tests agree */
  note: string;
  /** colour the mark with the anomaly colour (significant) or keep it neutral */
  emphasis: boolean;
  title: string;
}

export function verdictView(d: IntervalDetail | null): VerdictView {
  const v = COPY.verdict;
  if (!d || d.verdict === "insufficient" || !d.direction) {
    return { mark: "–", label: v.insufficient, note: "", emphasis: false, title: v.markTitle.insufficient };
  }
  const both = !!d.test && !!d.empirical;
  if (d.verdict === "significant") {
    return {
      mark: "●", label: v.significant[d.direction], emphasis: true, title: v.markTitle.significant,
      note: both ? v.bothAgree : d.test ? v.zOnly : v.windowOnly,
    };
  }
  if (d.verdict === "mixed") {
    return { mark: "◐", label: v.mixed, note: v.disagree(pValue(d.test?.p), pValue(d.empirical?.p)), emphasis: false, title: v.markTitle.mixed };
  }
  return { mark: "○", label: v.notSignificant, note: both ? v.neitherSignificant : d.test ? v.zOnly : v.windowOnly, emphasis: false, title: v.markTitle["not-significant"] };
}

/** "−1.8σ" */
export const sigmaText = (z: number | null | undefined, digits = 1) => (z == null || !Number.isFinite(z) ? "—" : `${num(z, digits, true)}σ`);

/**
 * Hypothesis chip: "yes" = the selection is unusual in the expected direction, "weak" = right direction
 * but within normal variability (or tests disagree), "no" = the opposite direction. null = nothing to compare.
 */
export function hypothesis(expected: "high" | "low" | undefined, d: IntervalDetail | null): { dir: "high" | "low"; state: "yes" | "weak" | "no" } | null {
  if (!expected || !d?.direction) return null;
  if (expected !== d.direction) return { dir: expected, state: "no" };
  return { dir: expected, state: d.verdict === "significant" ? "yes" : "weak" };
}

/** Month abbreviation of an absolute month index ("Feb"). */
export const monthAbbr = (k: number) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][((k % 12) + 12) % 12];

/** Order lanes: as picked, or by |mean z| of the selection (unknown last, ties keep the picked order). */
export function orderLanes<T>(items: T[], mode: "picked" | "unusual", absZ: (t: T) => number | null): T[] {
  if (mode === "picked") return items;
  return items
    .map((t, i) => ({ t, i, z: absZ(t) }))
    .sort((a, b) => (a.z == null ? (b.z == null ? a.i - b.i : 1) : b.z == null ? -1 : b.z - a.z || a.i - b.i))
    .map((x) => x.t);
}
