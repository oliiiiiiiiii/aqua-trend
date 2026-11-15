"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { HeroGlobe } from "@/components/shell/HeroGlobe";

export function InvestigationHero() {
  const router = useRouter();
  const globe = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    animation.current?.cancel();
  }, []);
  function enter(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault();
    if (leaving) return;
    setLeaving(true);
    router.prefetch("/detective");
    animation.current = globe.current?.animate([
      { transform: "scale(1)", opacity: 1 },
      { transform: "scale(1.12)", opacity: 1, offset: 0.7 },
      { transform: "scale(1.15)", opacity: 0 },
    ], { duration: 800, easing: "cubic-bezier(.22,.61,.36,1)", fill: "forwards" }) ?? null;
    timer.current = setTimeout(() => router.push("/detective"), 800);
  }
  return (
    <div className="grid items-center gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)] lg:gap-8">
      <Link href="/detective" onClick={enter} aria-label="Start an investigation with the globe" className="order-2 block rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-on-stage lg:order-1">
        <div ref={globe} className="mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-10rem))]">
          <HeroGlobe className="h-full w-full pointer-events-none" />
        </div>
      </Link>
      <div className="order-1 lg:order-2">
        <p className="text-sm font-semibold text-on-stage-2">Earth System Trend Detective</p>
        <h1 id="hero" className="mt-3 text-4xl leading-tight text-balance sm:text-5xl">Was it unusual?</h1>
        <p className="mt-4 max-w-[38ch] text-xl text-on-stage">Test an extreme event against decades of Earth records.</p>
        <p className="mt-4 max-w-[48ch] text-on-stage-2">Name an event, a river basin and its months. See which NASA variables departed from normal before, during and after it.</p>
        <Link href="/detective" onClick={enter} aria-busy={leaving} className="mt-6 inline-flex min-h-11 items-center gap-6 rounded-ctl bg-action px-5 py-3 font-semibold text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-on-stage">{leaving ? "Opening Detective…" : "Detective"}<span aria-hidden="true">→</span></Link>
        <p className="mt-4 text-sm text-on-stage-2">Monthly records · 1,313 sub-basins · 17 variable categories</p>
      </div>
    </div>
  );
}
