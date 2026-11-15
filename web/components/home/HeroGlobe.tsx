"use client";
// The landing page's planet: the decorative (non-interactive) globe, which turns slowly on its own.
import dynamic from "next/dynamic";

const GlobeCanvas = dynamic(() => import("@/components/globe/GlobeCanvas"), { ssr: false });

export function HeroGlobe({ className = "", id }: { className?: string; id?: string }) {
  return (
    <div id={id} className={className}>
      <GlobeCanvas className="h-full w-full cursor-grab active:cursor-grabbing" interactive autoSpin wheelZoom={false} showControls={false} initialView={{ lon: 60, lat: 15, zoom: 1 }} ariaLabel="The planet. Drag to turn it." />
    </div>
  );
}
