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
  /** the home -> detective hand-off is running */
  entering: boolean;
  /** the input form stays hidden until the planet is well on its way */
  formHidden: boolean;
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

/** Hand-off timing: the planet and the clip travel for TRAVEL_MS; the hand-off state outlives it by a beat. */
const TRAVEL_MS = 1000;
const ENTER_MS = 1100;
const REVEAL_MS = 560;
const EASE = "cubic-bezier(.65,0,.35,1)";

/**
 * Owned by the root layout: route content changes, this scene and its canvas do not.
 *
 * Layers, bottom to top: the page's own background, the stage sky (re-painted here so the planet can sit on it),
 * the planet, then all page content and the headline. The planet therefore can never cover content.
 */
export function SharedGlobeLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState<Picker | null>(null);
  const [entering, setEntering] = useState(false);
  const [formHidden, setFormHidden] = useState(false);
  const [started, setStarted] = useState(0);
  const skip = useCallback(() => { setEntering(false); setFormHidden(false); }, []);
  const enter = useCallback((e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setStarted(performance.now());
    setEntering(!reduced);
    setFormHidden(!reduced);
    router.push("/detective", { scroll: false });
  }, [router]);
  useEffect(() => {
    if (!entering) return;
    const reveal = window.setTimeout(() => setFormHidden(false), Math.max(0, started + REVEAL_MS - performance.now()));
    const end = window.setTimeout(skip, Math.max(0, started + ENTER_MS - performance.now()));
    return () => { window.clearTimeout(reveal); window.clearTimeout(end); };
  }, [entering, started, skip]);
  // The hero is exactly one screen tall: tell it how much of the screen the header takes.
  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    const set = () => host.style.setProperty("--stage-offset", `${Math.round(host.getBoundingClientRect().top + window.scrollY)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return (
    <StageContext.Provider value={{ input, setInput, entering, formHidden, started, enter, skip }}>
      <div ref={root} data-shared-stage-root className="relative isolate overflow-x-clip">
        {children}
        <Suspense fallback={null}><StageScene root={root} /></Suspense>
      </div>
    </StageContext.Provider>
  );
}

type Position = { x: number; y: number; width: number; height: number };
type Positions = { area?: Position; clip?: Position; globe?: Position; copy?: Position };
function StageScene({ root }: { root: React.RefObject<HTMLDivElement | null> }) {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const params = useSearchParams();
  const stage = useSharedStage();
  const home = pathname === "/";
  const inputRoute = pathname === "/detective" && !(params.get("r") && params.get("t") && params.get("v"));
  const visible = home || inputRoute;
  const [positions, setPositions] = useState<Positions>({});
  const [travelling, setTravelling] = useState(false);

  // Anchors keep the shared scene in the page's normal responsive layout. They never own a canvas.
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
      const area = position("[data-stage-area]");
      const next = { area, clip: position("[data-stage-clip]") ?? area, globe: position("[data-stage-globe]"), copy: position("[data-stage-copy]") };
      // Preserve the previous frame while Next replaces the page's anchors.
      setPositions((prev) => {
        const merged: Positions = area ? { area, clip: next.clip, globe: next.globe ?? prev.globe, copy: next.copy ?? prev.copy } : prev;
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

  // Transitions run only for a route change, never while the window is merely being resized.
  const lastPath = useRef(pathname);
  useLayoutEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setTravelling(true);
    const timer = window.setTimeout(() => setTravelling(false), TRAVEL_MS + 150);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  // While the planet is on screen the sections that anchor it hand their sky to the layer below it.
  const hasArea = !!positions.area;
  useLayoutEffect(() => {
    const host = root.current;
    if (!host || !visible || !hasArea) return;
    host.setAttribute("data-stage-active", "");
    return () => host.removeAttribute("data-stage-active");
  }, [root, visible, hasArea]);

  const [question, setQuestion] = useState<string>(COPY.intro);
  useEffect(() => {
    if (!stage.entering) return;
    const tick = () => {
      const elapsed = performance.now() - stage.started;
      const count = Math.floor(Math.max(0, Math.min(1, (elapsed - 200) / 560)) * COPY.intro.length);
      setQuestion(COPY.intro.slice(0, count));
    };
    tick();
    const timer = window.setInterval(tick, 16);
    return () => window.clearInterval(timer);
  }, [stage.entering, stage.started]);

  if (!visible) return null; // GlobeCanvas cleanup disposes the renderer and loses its WebGL context.
  const { area, clip, globe, copy } = positions;
  const move = travelling ? `${TRAVEL_MS}ms ${EASE}` : "0ms";
  const centred = home && !stage.entering;
  return (
    <>
      <style>{`@media(prefers-reduced-motion:reduce){[data-shared-stage],[data-shared-clip]{transition:none !important}}`}</style>
      {area && clip && (
        <div
          data-shared-sky
          className="on-stage stage-sky pointer-events-none absolute -z-10 overflow-hidden"
          style={{ left: area.x, top: area.y, width: area.width, height: area.height }}
        >
          {/* The planet is clipped to the visible part of its hero (the rising half-Earth) or to the whole input stage. */}
          <div
            data-shared-clip
            className="absolute inset-0"
            style={{
              // Right and bottom edges are written against the sky's current size, so the clip stays continuous while the sky
              // itself snaps to the next route's height.
              clipPath: `inset(${Math.max(0, clip.y - area.y)}px calc(100% - ${Math.max(0, clip.x - area.x + clip.width)}px) calc(100% - ${Math.max(0, clip.y - area.y + clip.height)}px) ${Math.max(0, clip.x - area.x)}px)`,
              transition: `clip-path ${move}`,
            }}
          >
            <div
              data-shared-stage
              data-shared-globe
              className="on-stage pointer-events-none absolute left-0 top-0"
              style={{
                width: globe?.width ?? 0,
                transform: `translate(${(globe?.x ?? 0) - area.x}px, ${(globe?.y ?? 0) - area.y}px)`,
                visibility: globe ? "visible" : "hidden",
                transition: `transform ${move}, width ${move}`,
              }}
            >
              <SubBasinGlobe catalog={stage.input?.catalog ?? null} region={stage.input?.region ?? null} onRegion={stage.input?.onRegion ?? (() => {})} interactive={inputRoute} />
            </div>
          </div>
        </div>
      )}
      <div
        data-shared-stage
        data-shared-copy
        className={`on-stage pointer-events-none absolute left-0 top-0 z-10 text-on-stage ${centred ? "text-center" : ""}`}
        style={{
          width: copy?.width ?? 0,
          transform: `translate(${copy?.x ?? 0}px, ${copy?.y ?? 0}px)`,
          visibility: copy ? "visible" : "hidden",
          transition: `transform ${move}, width ${move}`,
        }}
      >
        <p className="text-sm font-semibold text-on-stage-2">Earth System Trend Detective</p>
        <h1 id="hero" className={`mt-3 text-balance leading-tight ${home ? "text-4xl sm:text-6xl" : "text-3xl sm:text-4xl"}`} aria-label={home ? "Was it unusual?" : COPY.intro}>
          {home ? "Was it unusual?" : stage.entering ? question || "\u00a0" : COPY.intro}
        </h1>
        {home && <div className={`transition-[opacity,transform] duration-150 motion-reduce:transition-none ${stage.entering ? "-translate-y-2 opacity-0" : ""}`}>
          <p className={`mt-4 max-w-[38ch] text-xl ${centred ? "mx-auto" : ""}`}>Test an extreme event against decades of Earth records.</p>
          <Link href="/detective" onClick={stage.enter} className="pointer-events-auto mt-6 inline-flex min-h-11 items-center gap-6 rounded-ctl bg-action px-5 py-3 font-semibold text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-4">Detective<span aria-hidden="true">→</span></Link>
        </div>}
      </div>
    </>
  );
}
