"use client";
import { useEffect, useRef, useState } from "react";

/** Width of an element in CSS px, kept current with a ResizeObserver. Returns 0 until first measured. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
