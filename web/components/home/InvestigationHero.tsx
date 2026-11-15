"use client";
import Link from "next/link";
import { useSharedStage } from "@/components/shell/HeroGlobe";

/**
 * The "rising Earth" hero: copy above, the layout-owned planet centred on the bottom edge so only its upper half shows.
 * The anchors are empty; the shared stage paints the planet below the page content and the headline above it.
 */
export function InvestigationHero() {
  const { enter } = useSharedStage();
  return (
    <div data-stage-clip data-stage-pass className="relative min-h-[max(calc(100dvh-var(--stage-offset,4.5rem)),38rem)] overflow-hidden">
      <div data-stage-pass className="mx-auto max-w-[90rem] px-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
        <div data-stage-copy data-stage-pass className="mx-auto h-[19rem] max-w-3xl sm:h-[17rem]" />
      </div>
      <Link
        href="/detective"
        onClick={enter}
        aria-label="Start an investigation with the globe"
        className="pointer-events-auto absolute bottom-0 left-1/2 block aspect-square w-[118vw] -translate-x-1/2 translate-y-1/2 rounded-full [clip-path:circle(50%)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-on-stage sm:w-[min(94vw,104dvh)]"
      >
        <span data-stage-globe className="block h-full w-full" />
      </Link>
    </div>
  );
}
