"use client";
import { useId, useState } from "react";
import type { VarId } from "@/lib/types";
import { MAX_TARGETS, TARGET_VARS, VARIABLES } from "@/lib/variables";
import { KIND_WORDS, type Suggestion } from "./regionUtils";

/**
 * The eight water targets as compact toggle chips (max 3), drawn for the stage. A closed disclosure holds what each
 * one means and its caveat; the suggested set is one click away.
 */
export function TargetPicker({
  targets,
  onChange,
  suggestion,
  className = "",
}: {
  targets: VarId[];
  onChange: (t: VarId[]) => void;
  suggestion: Suggestion;
  className?: string;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const full = targets.length >= MAX_TARGETS;
  const isSuggested = sameSet(targets, suggestion.targets);

  function toggle(v: VarId) {
    if (targets.includes(v)) {
      if (targets.length === 1) { setNote("Keep at least one target. Choose another first."); return; }
      setNote("");
      onChange(targets.filter((t) => t !== v));
    } else if (!full) {
      setNote("");
      onChange(TARGET_VARS.filter((t) => t === v || targets.includes(t)));
    } else {
      setNote(`That is the maximum (${MAX_TARGETS}). Clear one to choose another.`);
    }
  }

  return (
    <section id="targets" aria-labelledby={`${id}-h`} className={`on-stage ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`${id}-h`} className="text-base">Water targets</h2>
        <p className="text-sm text-on-stage-2 tnum" aria-live="polite">{targets.length} of {MAX_TARGETS}</p>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-1.5">
        {TARGET_VARS.map((v) => {
          const m = VARIABLES[v];
          const on = targets.includes(v);
          const blocked = !on && full;
          return (
            <li key={v}>
              <label
                title={`${m.label}, ${m.unit}, ${KIND_WORDS[m.kind]}`}
                className={`flex items-center gap-2 rounded-ctl border px-2.5 py-1 text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-on-stage ${
                  on
                    ? "cursor-pointer border-on-stage bg-on-stage font-semibold text-stage"
                    : blocked
                      ? "cursor-not-allowed border-stage-line text-on-stage-2 opacity-60"
                      : "cursor-pointer border-stage-line text-on-stage hover:bg-stage-line"
                }`}
              >
                <input type="checkbox" checked={on} aria-disabled={blocked || undefined} onChange={() => toggle(v)} className="sr-only" />
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/70" style={{ background: `var(${m.color})` }} />
                <span className="min-w-0 truncate">{m.short}</span>
                <span className="sr-only">{`, ${m.label}, ${m.unit}`}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[0.8125rem] leading-snug text-on-stage-2 empty:hidden" role="status">
        {note || (full ? "At the maximum. Clear one to choose another." : "")}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <button
          type="button"
          onClick={() => { setNote(""); onChange(suggestion.targets); }}
          disabled={isSuggested}
          title={suggestion.reason}
          className="rounded-ctl underline underline-offset-2 hover:no-underline disabled:cursor-default disabled:no-underline disabled:opacity-70"
        >
          {isSuggested ? "Suggested set in use" : `Use suggested set: ${suggestion.targets.map((t) => VARIABLES[t].short).join(", ")}`}
        </button>
      </div>
      <details className="mt-1.5 text-sm">
        <summary className="cursor-pointer rounded-ctl text-on-stage-2 hover:text-on-stage">About the targets</summary>
        <ul className="mt-1.5 max-h-52 space-y-2 overflow-y-auto pr-1 text-[0.8125rem] leading-snug text-on-stage-2">
          {TARGET_VARS.map((v) => (
            <li key={v}>
              <span className="font-semibold text-on-stage">{VARIABLES[v].label}</span> ({VARIABLES[v].unit}). {VARIABLES[v].what}{" "}
              <span className="text-on-stage">Keep in mind:</span> {VARIABLES[v].caveat}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function sameSet(a: VarId[], b: VarId[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
