"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useReducedMotion } from "@/components/explore/hooks";

const GlobeCanvas = dynamic(() => import("@/components/globe/GlobeCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full" aria-hidden="true" />,
});

/** The decorative planet on the landing page: slow rotation, no picking. */
export function HeroGlobe({ className = "" }: { className?: string }) {
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  return (
    <div className={`relative ${className}`}>
      <div role="img" aria-label="Illustrative low-poly globe" className="h-full w-full">
        <GlobeCanvas
          className="h-full w-full"
          interactive={false}
          boundaryLayer={null}
          motionPaused={paused}
        />
      </div>
      {!reduced && (
        <button
          type="button"
          onClick={() => setPaused((v) => !v)}
          className="absolute right-2 bottom-1 rounded-ctl border border-stage-line bg-stage px-3 py-1.5 text-sm"
        >
          {paused ? "Resume globe" : "Pause globe"}
        </button>
      )}
    </div>
  );
}
