"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createProgressTimeline, progressFrame, progressLines, type ProgressContext } from "./progressTimeline";

/** Mounted only by an explicit Analyse/case action; deep links never run this sequence. */
export function StartProgress({ context, onDone, onCancel }: {
  context: ProgressContext;
  onDone: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const callbacks = useRef({ onDone, onCancel });
  callbacks.current = { onDone, onCancel };
  const fired = useRef(false);
  const [timeline] = useState(() => createProgressTimeline(Math.floor(Math.random() * 0x100000000)));
  const [frame, setFrame] = useState(() => progressFrame(0));
  const [mounted, setMounted] = useState(false);
  const finish = () => {
    if (fired.current) return;
    fired.current = true;
    callbacks.current.onDone();
  };
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted) return;
    const el = dialog.current;
    if (!el) return;
    fired.current = false;
    const focus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    el.showModal();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      if (fired.current) return;
      const next = progressFrame(performance.now() - start, reduced, timeline);
      setFrame(next);
      if (next.finished) finish();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const cancel = () => {
      if (fired.current) return;
      fired.current = true;
      cancelAnimationFrame(raf);
      callbacks.current.onCancel();
    };
    window.addEventListener("popstate", cancel);
    return () => {
      fired.current = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("popstate", cancel);
      el.close();
      document.body.style.overflow = overflow;
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus({ preventScroll: true });
    };
  }, [mounted, timeline]);
  if (!mounted) return null;
  const lines = progressLines(context);
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      className="on-stage fixed inset-0 m-auto h-dvh max-h-none w-full max-w-none overflow-y-auto border-0 bg-stage/75 p-4 text-on-stage backdrop-blur-xl backdrop:bg-stage/60 sm:p-8"
      onCancel={(e) => { e.preventDefault(); finish(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(); }
      }}
    >
      <div className="flex min-h-full items-center justify-center">
        <div className="w-full max-w-2xl rounded-card border border-stage-line bg-stage/80 p-6 shadow-card sm:p-12">
          <h2 id={`${id}-title`} className="text-balance font-display text-3xl leading-tight sm:text-4xl">Running the investigation</h2>
          <div className="mt-7 flex items-center justify-between text-sm text-on-stage-2">
            <p role="status" aria-live="polite">{frame.done ? "Done" : `Stage ${frame.stage + 1} of ${lines.length}`}</p>
            <span className="tnum" aria-hidden="true">{Math.round(frame.fraction * 100)}%</span>
          </div>
          <div role="progressbar" aria-label="Investigation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frame.fraction * 100)} className="mt-3 h-2 overflow-hidden rounded-full bg-on-stage/15">
            <div className="h-full origin-left rounded-full bg-action" style={{ transform: `scaleX(${frame.fraction})` }} />
          </div>
          <ol className="mt-8 space-y-4">
            {lines.map((line, i) => (
              <li key={line} aria-current={i === frame.stage ? "step" : undefined} className={`flex items-start gap-3 transition-opacity duration-200 ${i > frame.stage ? "opacity-80" : "opacity-100"}`}>
                <span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${i <= frame.stage ? "border-action text-action" : "border-stage-line text-on-stage-2"}`}>
                  {i < frame.stage ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg> : i === frame.stage ? <span className="h-2 w-2 rounded-full bg-action" /> : null}
                </span>
                <span className={i === frame.stage ? "font-semibold" : "text-on-stage-2"}>{line}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
