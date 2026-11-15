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

/** Height of an element in CSS px, kept current with a ResizeObserver. Returns 0 until first measured.
 *  Uses a callback ref, so an element that mounts later (after a loading state) is still observed. */
export function useElementHeight<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!el) return;
    setHeight(Math.round(el.getBoundingClientRect().height));
    const ro = new ResizeObserver((entries) => {
      const h = Math.round(entries[0].contentRect.height);
      setHeight((prev) => (prev === h ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, height];
}
