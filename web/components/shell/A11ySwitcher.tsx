"use client";
// Accessibility option: shows the hover-only hints as text, enlarges type and focus rings. Saved per browser.
import { useEffect, useState } from "react";

const KEY = "aqua-trend-a11y";

export function A11ySwitcher() {
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(document.documentElement.dataset.a11y === "on"); }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    if (next) document.documentElement.dataset.a11y = "on"; else delete document.documentElement.dataset.a11y;
    try { localStorage.setItem(KEY, next ? "on" : "off"); } catch {}
  };
  const label = on ? "Turn off accessibility mode" : "Accessibility mode: larger text and visible hints";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 place-items-center rounded-ctl border border-stage-line text-on-stage hover:bg-stage-line ${on ? "bg-stage-line" : ""}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="4.5" r="1.8" />
        <path d="M5 8.5l7 1.5 7-1.5M12 10v4.5M12 14.5l-3.5 6M12 14.5l3.5 6" />
      </svg>
    </button>
  );
}
