"use client";
// Step 1 of the Trend Detective: the AI (or keyword) vote per category as pre-ticked checkboxes. Workstream C.
import { useId } from "react";
import type { CategoryId, CategoryVote, SelectResponse } from "@/lib/detective/contracts";
import { CATEGORY_IDS } from "@/lib/detective/url";
import type { CategoryInfo } from "./wiring";

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

const SOURCE_LABEL: Record<SelectResponse["source"], string> = {
  "local-model": "Suggested by the local AI model",
  "online-model": "Suggested by the online AI model",
  "keyword-fallback": "Suggested by the keyword list (the AI model is not available)",
};

export function VariablePicker({ categories, response, loading, checked, onChange, available, unavailableReason, onStart, blocked }: VariablePickerProps) {
  const id = useId();
  const votes = new Map<CategoryId, CategoryVote>((response?.votes ?? []).map((v) => [v.category, v]));
  const on = new Set(checked);
  const usable = (c: CategoryId) => !available || available[c];
  const startable = checked.filter(usable);
  const toggle = (c: CategoryId, v: boolean) => {
    const next = new Set(on);
    if (v) next.add(c); else next.delete(c);
    onChange(CATEGORY_IDS.filter((x) => next.has(x)));
  };

  return (
    <section aria-labelledby={`${id}-h`} className="rounded-card bg-paper p-5 text-ink shadow-card sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-h`} className="text-xl">Variables to check</h2>
        <p className="text-sm text-ink-3" role="status">
          {loading ? "Asking the model…" : response ? SOURCE_LABEL[response.source] : "Your picks"}
        </p>
      </div>
      <p className="mt-1 text-sm text-ink-2">Tick what to analyse. Each one opens as its own tab.</p>

      <fieldset className="mt-3" aria-describedby={`${id}-h`}>
        <legend className="sr-only">Variable categories</legend>
        <ul className="divide-y divide-line border-y border-line">
          {CATEGORY_IDS.map((c) => {
            const info = categories[c];
            const vote = votes.get(c);
            const ok = usable(c);
            return (
              <li key={c}>
                <label className={`flex items-start gap-3 py-2 ${ok ? "cursor-pointer" : "cursor-not-allowed opacity-55"}`}>
                  <input
                    type="checkbox"
                    checked={ok && on.has(c)}
                    disabled={!ok}
                    onChange={(e) => toggle(c, e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--link)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center justify-between gap-x-3">
                      <span className="font-semibold">{info.name.en}</span>
                      {ok ? vote && <Probability p={vote.p} keyword={response?.source === "keyword-fallback"} /> : <span className="text-xs text-ink-3">{unavailableReason?.[c] ?? "No data for this sub-basin"}</span>}
                    </span>
                    <span className="block text-sm text-ink-3">{info.definition.en}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={!!blocked}
          className="rounded-ctl bg-action px-5 py-2 font-semibold text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start analysis{startable.length ? ` (${startable.length})` : ""}
        </button>
        {blocked && <span className="text-sm text-ink-3">{blocked}</span>}
      </div>
    </section>
  );
}

/** a small bar for the model's "related" probability (0–1); the keyword list only says yes or no */
function Probability({ p, keyword }: { p: number; keyword: boolean }) {
  if (keyword) return <span className="text-xs text-ink-3">{p >= 0.5 ? "keyword match" : ""}</span>;
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
  return (
    <span className="flex items-center gap-2 text-xs text-ink-3" title={`Model probability that this is related: ${pct}%`}>
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-well" aria-hidden="true">
        <span className="absolute inset-y-0 left-0 rounded-full bg-water" style={{ width: `${pct}%` }} />
      </span>
      <span className="tnum">{pct}%</span>
    </span>
  );
}
