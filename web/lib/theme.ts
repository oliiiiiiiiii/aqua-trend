"use client";
import { useSyncExternalStore } from "react";

/** Two looks: Terrarium is the light mode, Night shift the dark mode. */
export const THEMES = [
  { id: "terrarium", label: "Terrarium", mode: "light", note: "Light mode: sky-blue stage, toy-planet warmth" },
  { id: "night", label: "Night shift", mode: "dark", note: "Dark mode: deep-ocean dark" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "terrarium";
export const THEME_STORAGE_KEY = "terratrend-theme";

function read(): ThemeId {
  const t = document.documentElement.dataset.theme as ThemeId | undefined;
  return THEMES.some((x) => x.id === t) ? (t as ThemeId) : DEFAULT_THEME;
}
function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
/** Current theme id; re-renders when <html data-theme> changes. */
export function useThemeId(): ThemeId {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_THEME);
}
/** The look the OS asks for. Used until the user picks one by hand. */
export function systemTheme(): ThemeId {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "terrarium";
}
/** The user's saved choice, or null while they have not picked (then the OS preference applies). */
export function savedTheme(): ThemeId | null {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    return THEMES.some((x) => x.id === t) ? (t as ThemeId) : null;
  } catch { return null; }
}
/** Apply a look. `persist` (default) remembers it as the user's choice; pass false to follow the system. */
export function setTheme(id: ThemeId, persist = true) {
  document.documentElement.dataset.theme = id;
  if (!persist) return;
  try { localStorage.setItem(THEME_STORAGE_KEY, id); } catch { /* private mode */ }
}
/** Resolve a CSS custom property (e.g. "--viz-blue") to its current value - for canvas/WebGL code. */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
