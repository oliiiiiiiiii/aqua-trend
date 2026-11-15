"use client";
import dynamic from "next/dynamic";

const GlobeCanvas = dynamic(() => import("@/components/globe/GlobeCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full" aria-hidden="true" />,
});

/** The decorative planet on the landing page: slow rotation, no picking. */
export function HeroGlobe({ className = "" }: { className?: string }) {
  return (
    <div className={className} role="img" aria-label="A low-poly planet slowly turning">
      <GlobeCanvas className="h-full w-full" interactive={false} boundaryLayer={null} />
    </div>
  );
}
