"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent } from "react";
import type { Catalog, Region } from "@/lib/types";
import { SubBasinGlobe } from "@/components/globe/StageGlobe";
import { COPY } from "@/components/detective/copy/input";

type Picker = { catalog: Catalog | null; region: Region | null; onRegion: (r: Region) => void };
type Stage = {
  input: Picker | null;
  setInput: (input: Picker | null) => void;
  entering: boolean;
  started: number;
  enter: (e: MouseEvent<HTMLAnchorElement>) => void;
  skip: () => void;
};
const StageContext = createContext<Stage | null>(null);
export function useSharedStage() {
  const stage = useContext(StageContext);
  if (!stage) throw new Error("The investigation stage must live in SharedGlobeLayout");
  return stage;
}

/** Owned by the root layout: route content changes, this scene and its canvas do not. */
export function SharedGlobeLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState<Picker | null>(null);
  const [entering, setEntering] = useState(false);
  const [started, setStarted] = useState(0);
  const skip = useCallback(() => setEntering(false), []);
  const enter = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setStarted(performance.now());
    setEntering(!reduced);
    router.push("/detective", { scroll: false });
  }, [router]);
  useEffect(() => {
    if (!entering) return;
    const timer = window.setTimeout(skip, Math.max(0, started + 800 - performance.now()));
    return () => window.clearTimeout(timer);
  }, [entering, started, skip]);
  return (
    <StageContext.Provider value={{ input, setInput, entering, started, enter, skip }}>
      <div ref={root} className="relative isolate">
        {children}
        <Suspense fallback={null}><StageScene root={root} /></Suspense>
      </div>
    </StageContext.Provider>
  );
}

type Position = { x: number; y: number; width: number; height: number };
function StageScene({ root }: { root: React.RefObject<HTMLDivElement | null> }) {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const params = useSearchParams();
  const stage = useSharedStage();
  const home = pathname === "/";
  const inputRoute = pathname === "/detective" && !(params.get("r") && params.get("t") && params.get("v"));
  const visible = home || inputRoute;
  const [positions, setPositions] = useState<{ globe?: Position; copy?: Position }>({});
  // Anchors keep the shared scene in the page's normal responsive grid. They never own a canvas.
  useLayoutEffect(() => {
    const host = root.current;
    if (!host || !visible) return;
    let frame = 0;
    const measure = () => {
      const origin = host.getBoundingClientRect();
      const position = (selector: string): Position | undefined => {
        const anchor = host.querySelector(selector);
        if (!anchor) return;
        const r = anchor.getBoundingClientRect();
        return { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
      };
      const next = { globe: position("[data-stage-globe]"), copy: position("[data-stage-copy]") };
      // Preserve the previous frame while Next replaces the page's anchors.
      setPositions(prev => {
        const merged = { globe: next.globe ?? prev.globe, copy: next.copy ?? prev.copy };
        return JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged;
      });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    const mutations = new MutationObserver(schedule);
    mutations.observe(host, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    measure();
    return () => { resize.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); };
  }, [root, visible, pathname]);
  const [question, setQuestion] = useState<string>(COPY.intro);
  useEffect(() => {
    if (!stage.entering) return;
    const tick = () => {
      const elapsed = performance.now() - stage.started;
      const count = Math.floor(Math.max(0, Math.min(1, (elapsed - 160) / 480)) * COPY.intro.length);
      setQuestion(COPY.intro.slice(0, count));
    };
    tick();
    const timer = window.setInterval(tick, 16);
    return () => window.clearInterval(timer);
  }, [stage.entering, stage.started]);
  const positionStyle = (p?: Position): CSSProperties => ({
    position: "absolute", top: 0, left: 0, width: p?.width ?? 0,
    transform: `translate(${p?.x ?? 0}px, ${p?.y ?? 0}px)`,
    visibility: p ? "visible" : "hidden",
  });
  if (!visible) return null; // GlobeCanvas cleanup disposes the renderer and loses its WebGL context.
  return (
    <>
      <style>{`[data-shared-stage] { transition: transform 650ms cubic-bezier(.23,1,.32,1); } @media(prefers-reduced-motion:reduce) { [data-shared-stage] { transition:none; } }`}</style>
      <div data-shared-stage data-shared-globe className={`on-stage z-10 ${home ? "pointer-events-none" : ""}`} style={positionStyle(positions.globe)}>
        <SubBasinGlobe catalog={stage.input?.catalog ?? null} region={stage.input?.region ?? null} onRegion={stage.input?.onRegion ?? (() => {})} interactive={inputRoute} />
      </div>
      <div data-shared-stage data-shared-copy className="on-stage z-10 text-on-stage" style={positionStyle(positions.copy)}>
        <p className="text-sm font-semibold text-on-stage-2">Earth System Trend Detective</p>
        <h1 id="hero" className={`mt-3 text-balance leading-tight ${home ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl"}`} aria-label={home ? "Was it unusual?" : COPY.intro}>
          {home ? "Was it unusual?" : stage.entering ? question || "\u00a0" : COPY.intro}
        </h1>
        {home && <div className={`transition-[opacity,transform] duration-150 motion-reduce:transition-none ${stage.entering ? "-translate-y-2 opacity-0" : ""}`}>
          <p className="mt-4 max-w-[38ch] text-xl">Test an extreme event against decades of Earth records.</p>
          <p className="mt-4 max-w-[48ch] text-on-stage-2">Name an event, a river basin and its months. See which NASA variables departed from normal before, during and after it.</p>
          <Link href="/detective" onClick={stage.enter} className="mt-6 inline-flex min-h-11 items-center gap-6 rounded-ctl bg-action px-5 py-3 font-semibold text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-4">Detective<span aria-hidden="true">→</span></Link>
          <p className="mt-4 text-sm text-on-stage-2">Monthly records · 1,313 sub-basins · 17 variable categories</p>
        </div>}
      </div>
    </>
  );
}
