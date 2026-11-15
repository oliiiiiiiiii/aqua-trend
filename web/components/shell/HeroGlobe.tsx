"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const GlobeCanvas = dynamic(() => import("@/components/globe/GlobeCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full" aria-hidden="true" />,
});

/** Defer the decorative planet until after first paint. */
export function HeroGlobe({ className = "" }: { className?: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 100);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className={className} aria-hidden="true">
      {ready && <GlobeCanvas className="h-full w-full" interactive={false} boundaryLayer="basin4" />}
    </div>
  );
}
