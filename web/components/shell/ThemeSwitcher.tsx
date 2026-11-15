"use client";
import { useEffect } from "react";
import { savedTheme, setTheme, systemTheme, useThemeId } from "@/lib/theme";

/**
 * Light / dark toggle: Terrarium is light, Night shift is dark. Until the user picks, the look follows the OS
 * (the inline script in layout.tsx sets it before first paint; this keeps it in step if the OS flips later).
 */
export function ThemeSwitcher() {
  const theme = useThemeId();
  const dark = theme === "night";

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => { if (!savedTheme()) setTheme(systemTheme(), false); };
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);

  const label = dark ? "Switch to light mode (Terrarium)" : "Switch to dark mode (Night shift)";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "terrarium" : "night")}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-ctl border border-stage-line text-on-stage hover:bg-stage-line"
    >
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
        </svg>
      )}
    </button>
  );
}
