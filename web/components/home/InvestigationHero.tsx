"use client";
import Link from "next/link";
import { useSharedStage } from "@/components/shell/HeroGlobe";

/** Responsive anchors for the layout-owned planet and headline. */
export function InvestigationHero() {
  const { enter } = useSharedStage();
  return (
    <div className="grid items-center gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)] lg:gap-8">
      <Link href="/detective" onClick={enter} aria-label="Start an investigation with the globe" className="order-2 block rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-on-stage lg:order-1">
        <div data-stage-globe className="mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-10rem))]" />
      </Link>
      <div data-stage-copy className="order-1 min-h-[24rem] lg:order-2" />
    </div>
  );
}
