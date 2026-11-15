"use client";
import { useSyncExternalStore } from "react";

/**
 * Visual looks. Orthogonal to light/dark (lib/theme.ts): <html data-look="..." data-theme="...">.
 * The token overrides live in app/looks.css; Terrarium is the CSS baseline and has none. Atlas is the default look.
 */
export const LOOKS = [
  { id: "terrarium", label: "Terrarium", note: "Toy-planet warmth: rounded type, pill controls, sky-blue stage" },
  { id: "strip", label: "Strip chart", note: "Instrument chart paper: graph-paper grid, condensed type, highlighter yellow" },
  { id: "console", label: "Console", note: "Operations room: blue-graphite, wide technical type, signal amber, dense 1 px lines" },
  { id: "atlas", label: "Atlas", note: "Physical atlas: sea-to-upland tints, contour lines, bookish serif, teal-green" },
] as const;
export type LookId = (typeof LOOKS)[number]["id"];
export const DEFAULT_LOOK: LookId = "atlas";
export const LOOK_STORAGE_KEY = "aqua-trend-look";

function read(): LookId {
  const l = document.documentElement.dataset.look as LookId | undefined;
  return LOOKS.some((x) => x.id === l) ? (l as LookId) : DEFAULT_LOOK;
}
function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-look"] });
  return () => mo.disconnect();
}
/** Current look id; re-renders when <html data-look> changes. */
export function useLookId(): LookId {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_LOOK);
}
/** Apply a look and remember it (also used by the pre-paint script for ?look=<id>). */
export function setLook(id: LookId) {
  document.documentElement.dataset.look = id;
  try { localStorage.setItem(LOOK_STORAGE_KEY, id); } catch { /* private mode */ }
}
