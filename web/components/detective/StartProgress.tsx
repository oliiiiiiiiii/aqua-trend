"use client";
// A short, honest-looking pause between "Analyse" and the analysis view: named steps tick through, then onDone runs.
import { useEffect, useRef, useState } from "react";
import { COPY } from "./copy/input";

const TOTAL_MS = 1500;
const REDUCED_MS = 250;

export function StartProgress({ onDone }: { onDone: () => void }) {
  const T = COPY.progress;
  const [reduced, setReduced] = useState(false);
  const [step, setStep] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  const fired = useRef(false);
  const finish = () => {
    if (fired.current) return;
    fired.current = true;
    done.current();
  };
  const steps = reduced ? T.steps.slice(-1) : T.steps;
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  useEffect(() => {
    const per = (reduced ? REDUCED_MS : TOTAL_MS) / steps.length;
    const timer = window.setInterval(() => setStep((s) => s + 1), per);
    return () => window.clearInterval(timer);
  }, [reduced, steps.length]);
  useEffect(() => {
    if (step >= steps.length) finish();
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); finish(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div className="flex min-h-full flex-col justify-center py-6 text-on-stage" role="status" aria-live="polite" aria-label={T.label}>
      <h2 className="font-display text-3xl">{T.title}</h2>
      <ol className="mt-5 space-y-3">
        {steps.map((s, i) => {
          const state = i < step ? "done" : i === step ? "now" : "next";
          return (
            <li key={s} className={`flex items-center gap-3 text-lg ${state === "next" ? "text-on-stage-2" : "text-on-stage"}`} aria-current={state === "now" ? "step" : undefined}>
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${state === "done" ? "border-transparent bg-action text-on-action" : "border-stage-line"}`} aria-hidden="true">
                {state === "done" ? (
                  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                ) : state === "now" ? (
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-on-stage motion-reduce:animate-none" />
                ) : null}
              </span>
              <span>{s}</span>
              <span className="sr-only">{state === "done" ? ", done" : state === "now" ? ", in progress" : ""}</span>
            </li>
          );
        })}
      </ol>
      <button type="button" onClick={finish} className="mt-6 self-start rounded-ctl px-1 py-2 text-sm text-on-stage-2 underline hover:text-on-stage focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        {T.skip}
      </button>
    </div>
  );
}
