"use client";
// The landing page's one question: what to study. Submitting slides the hero planet into the questionnaire's left
// panel while a paper panel slides in from the right, then swaps the route underneath, so the two pages read as one.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { encodeState, suggestTime } from "@/lib/detective/url";

export function HeroSearch() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [going, setGoing] = useState(false);
  const go = () => {
    const e = text.trim();
    if (!e || going) return;
    setGoing(true);
    const href = `/detective?${encodeState({ query: { event: e, time: suggestTime(e) ?? undefined } })}`;
    router.prefetch(href);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0 });
    document.documentElement.dataset.leaving = "hero";
    try { sessionStorage.setItem("aq-from-landing", "1"); } catch {}
    // the questionnaire's left panel: everything left of a max(28rem, 1/2.15 of the width) column, under the header
    const g = document.getElementById("hero-globe");
    if (g && window.innerWidth >= 1024) {
      const r = g.getBoundingClientRect();
      const top = document.querySelector("header")?.getBoundingClientRect().bottom ?? 64;
      const panelW = window.innerWidth - Math.max(448, window.innerWidth / 2.15);
      const panelH = window.innerHeight - top;
      const s = Math.min(panelW, panelH) / r.width;
      const dx = panelW / 2 - (r.left + r.width / 2);
      const dy = top + panelH / 2 - (r.top + r.height / 2);
      g.classList.remove("rise-in");
      g.style.transformOrigin = "50% 50%";
      g.style.transition = "transform 1s cubic-bezier(.65,0,.25,1)";
      requestAnimationFrame(() => { g.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`; });
    }
    window.setTimeout(() => {
      delete document.documentElement.dataset.leaving;
      router.push(href);
    }, reduced ? 50 : 1050);
  };
  return (
    <>
      <form
        onSubmit={(e) => { e.preventDefault(); go(); }}
        className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-full border border-space-line bg-white/[0.07] p-1.5 pl-6 backdrop-blur-md focus-within:border-white/40"
      >
        <label htmlFor="hero-q" className="sr-only">What do you want to study?</label>
        <input
          id="hero-q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          maxLength={300}
          placeholder="What do you want to study?  e.g. 2022 Pakistan floods"
          className="min-w-0 flex-1 bg-transparent py-2 text-lg text-on-space outline-none placeholder:text-on-space-2/70"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Start the investigation"
          title="Start the investigation"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-action text-on-action transition hover:bg-action-hover disabled:opacity-40"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </form>
      {/* in a portal: the hero copy fades and moves (a transform), which would trap a fixed element inside it */}
      {going && createPortal(
        <div aria-hidden="true" style={{ top: document.querySelector("header")?.getBoundingClientRect().bottom ?? 64 }} className="slide-panel fixed right-0 bottom-0 z-40 hidden w-[max(28rem,calc(100vw/2.15))] bg-paper lg:block" />,
        document.body,
      )}
    </>
  );
}
