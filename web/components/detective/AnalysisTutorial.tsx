"use client";
import { useEffect, useState } from "react";

const KEY = "terratrend-tutorial";
const STEPS = [
  { title: "Each lane is one variable", body: "Every lane shows how far a variable was from its normal value, month by month, with the seasonal cycle and long-term trend removed. The shaded band marks your event." },
  { title: "Drag to pick an interval", body: "Drag across the timeline to select months before, during or after the event. The statistics of every lane follow your selection." },
  { title: "Read the verdict", body: "Each lane says whether the selected months were unusual, and by how much. Sort by “most unusual” to see which variables reacted most." },
  { title: "Zoom, test and share", body: "Change the window to look wider or down to days and weeks, open a lane to try other statistical tests, and use Share to copy a link to this exact view." },
];

/** A short first-visit walkthrough of the analysis page; dismissed once, remembered in this browser. */
export function AnalysisTutorial() {
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setStep(0); } catch { setStep(0); }
  }, []);
  const close = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* private window */ }
    setStep(null);
  };
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);
  if (step === null) {
    return (
      <button type="button" onClick={() => setStep(0)} className="fixed right-4 bottom-4 z-40 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink shadow-lg hover:bg-well">
        ? How to read this page
      </button>
    );
  }
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="tut-h" onClick={close}>
      <div className="w-full max-w-md rounded-ctl border border-line bg-paper p-6 text-ink shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm text-ink-2">Quick tour · {step + 1} of {STEPS.length}</p>
        <h2 id="tut-h" className="mt-2 text-2xl">{s.title}</h2>
        <p className="mt-3 text-ink-2">{s.body}</p>
        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" onClick={close} className="text-sm text-ink-2 underline underline-offset-2">Skip</button>
          <div className="flex gap-2">
            {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="rounded-ctl border border-line px-4 py-2 font-semibold hover:bg-well">Back</button>}
            <button type="button" autoFocus onClick={() => (last ? close() : setStep(step + 1))} className="rounded-ctl bg-action px-4 py-2 font-semibold text-on-action hover:bg-action-hover">{last ? "Start exploring" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
