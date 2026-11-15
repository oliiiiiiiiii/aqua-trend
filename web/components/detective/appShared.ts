// Helpers shared by the input stage (DetectiveApp.tsx) and the analysis workbench (AnalysisView.tsx).
import type { CategoryId, DetectiveQuery, LayerId, PresetEvent } from "@/lib/detective/contracts";
import { decodeState, encodeState, sameRange, type DetectiveUrlState } from "@/lib/detective/url";
import { PRESETS } from "./wiring";

export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type UrlPatch = (s: DetectiveUrlState) => { query: Partial<DetectiveQuery>; draft?: CategoryId[] | null };

/** Apply a patch to the URL as it is now. "push" for steps (so Back works), "replace" for edits within a step. */
export function writeUrl(patch: UrlPatch, how: "push" | "replace" = "replace") {
  const cur = decodeState(window.location.search);
  const qs = encodeState(patch(cur));
  const href = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  if (href === `${window.location.pathname}${window.location.search}`) return;
  if (how === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
}

export const presetFor = (q: Partial<DetectiveQuery>): PresetEvent | undefined =>
  PRESETS.find((p) => p.event === q.event && p.region === q.region && sameRange(p.time, q.time));

/** one shared empty set, so memos keyed on "layers of this region" stay stable for regions without a series */
export const NO_LAYERS: ReadonlySet<LayerId> = new Set();
