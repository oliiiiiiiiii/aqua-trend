"use client";
// Step 4 of the input: the AI (or keyword) vote per category as a grid of pre-ticked toggle chips.
import { useId } from "react";
import type { CategoryId, CategoryVote, SelectResponse } from "@/lib/detective/contracts";
import { CATEGORY_IDS } from "@/lib/detective/url";
import type { CategoryInfo } from "./wiring";
import { COPY } from "./copy/input";

export interface VariablePickerProps {
  categories: Readonly<Record<CategoryId, CategoryInfo>>;
  /** the vote; null while it is being asked or when the picks came from a link */
  response: SelectResponse | null;
  loading: boolean;
  checked: readonly CategoryId[];
  onChange: (checked: CategoryId[]) => void;
  /** which categories the chosen sub-basin has data for; null = no sub-basin yet (all enabled) */
  available: Readonly<Record<CategoryId, boolean>> | null;
  unavailableReason?: Partial<Record<CategoryId, string>>;
  onStart: () => void;
  /** why Start is disabled, or null when it can run */
  blocked: string | null;
}

export function VariablePicker({ categories, response, loading, checked, onChange, available, unavailableReason, onStart, blocked }: VariablePickerProps) {
  const id = useId();
  const T = COPY.picker;
  const votes = new Map<CategoryId, CategoryVote>((response?.votes ?? []).map((v) => [v.category, v]));
  const on = new Set(checked);
  const usable = (c: CategoryId) => !available || available[c];
  const startable = checked.filter(usable);
  const toggle = (c: CategoryId, v: boolean) => {
    const next = new Set(on);
    if (v) next.add(c); else next.delete(c);
    onChange(CATEGORY_IDS.filter((x) => next.has(x)));
  };
  const keyword = response?.source === "keyword-fallback";
  // with a vote: its picks first, the rest quieter; without one (link, still asking) a single plain grid
  const suggested = response ? CATEGORY_IDS.filter((c) => votes.get(c)?.selected) : [];
  const others = CATEGORY_IDS.filter((c) => !suggested.includes(c));

  const chip = (c: CategoryId, quiet: boolean) => {
    const info = categories[c];
    const vote = votes.get(c);
    const ok = usable(c);
    const reason = unavailableReason?.[c] ?? T.noData;
    const pct = vote ? Math.round(Math.max(0, Math.min(1, vote.p)) * 100) : null;
    const checkedNow = ok && on.has(c);
    return (
      <li key={c}>
        <label
          title={ok ? info.definition.en : `${info.name.en}: ${reason}`}
          className={`relative flex h-full items-center gap-2 rounded-ctl border px-2.5 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color:var(--link)] ${
            !ok
              ? "cursor-not-allowed border-dashed border-line text-ink-3 opacity-55"
              : checkedNow
                ? "cursor-pointer border-link bg-well font-semibold text-ink"
                : `cursor-pointer border-line hover:border-link ${quiet ? "text-ink-2" : "text-ink"}`
          }`}
        >
          <input
            type="checkbox"
            checked={checkedNow}
            disabled={!ok}
            onChange={(e) => toggle(c, e.target.checked)}
            className="sr-only"
          />
          <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${checkedNow ? "text-link" : ""}`} aria-hidden="true">
            <path d={info.icon} />
          </svg>
          <span className="min-w-0 flex-1 leading-tight">{info.name.en}</span>
          {checkedNow && (
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-link" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          )}
          {ok && pct !== null && !keyword && !quiet && (
            <span className="absolute inset-x-2 bottom-0.5 h-[3px] overflow-hidden rounded-full bg-line" title={T.probability(pct)} aria-hidden="true">
              <span className="block h-full rounded-full bg-water" style={{ width: `${pct}%` }} />
            </span>
          )}
          <span className="sr-only">
            {!ok ? `. ${reason}` : `. ${info.definition.en}${pct !== null && !keyword ? ` Probability ${pct}%.` : ""}${keyword && vote && vote.p >= 0.5 ? ` ${T.keyword}.` : ""}`}
          </span>
        </label>
      </li>
    );
  };
  const grid = "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2";

  return (
    <section aria-labelledby={`${id}-h`} className="rounded-card bg-paper p-5 text-ink shadow-card sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-h`} className="flex items-center text-xl">
          <span className="mr-2 inline-grid h-6 min-w-6 place-items-center rounded-full bg-well px-1.5 font-display text-sm tnum" aria-hidden="true">4</span>
          {T.heading}
        </h2>
        <p className="text-xs text-ink-3" role="status">
          {loading ? T.asking : response ? T.source[response.source] : T.yours}
        </p>
      </div>

      <fieldset className="mt-3">
        <legend className="sr-only">{T.group}</legend>
        {suggested.length > 0 && <ul className={grid}>{suggested.map((c) => chip(c, false))}</ul>}
        {others.length > 0 && (
          <>
            {suggested.length > 0 && <p className="mt-3 mb-1.5 text-xs text-ink-3">{T.others}</p>}
            <ul className={grid}>{others.map((c) => chip(c, !!response))}</ul>
          </>
        )}
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={!!blocked}
          className="rounded-ctl bg-action px-5 py-2 font-semibold text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {T.analyse(startable.length)}
        </button>
        {blocked && <span className="text-sm text-ink-3">{blocked}</span>}
      </div>
    </section>
  );
}
