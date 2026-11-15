"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Match the home globe's left column, fading in after the route hand-off. */
export function GlobeArrival({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: "ease-out" });
    return () => animation?.cancel();
  }, []);
  return <div ref={ref}>{children}</div>;
}
