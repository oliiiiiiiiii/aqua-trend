"use client";
// The real monthly anomaly (z) of one picked variable in the chosen sub-basin, for the Time tab: the timeline draws
// it behind its track and the globe tints the basin by the mean over the selected months.
import { useEffect, useState } from "react";
import type { CategoryId, LayerId, RegionId, TimeRange } from "@/lib/detective/contracts";
import type { VarId } from "@/lib/types";
import { decompose } from "@/lib/detective/analysis";
import { CATEGORIES } from "@/lib/detective/categories";
import { anomalyPolarity } from "@/lib/detective/polarity";
import { loadSeries } from "@/lib/detective/series";
import { ymIndex } from "@/lib/detective/url";

/** categories the globe can draw as a 1° long-term trend map */
export const GLOBE_VAR: Partial<Record<CategoryId, VarId>> = {
  precip: "precip", et: "et", soil: "root_zone", tws: "tws", snow: "swe", tair: "tair", runoff: "runoff",
};

export interface AnomalyBars {
  category: CategoryId;
  label: string;
  /** month index of z[0] */
  start: number;
  z: (number | null)[];
  /** above normal reads cool (wetter) or warm (hotter / drier) */
  highCool: boolean;
}

export function useIntervalAnomaly(
  region: RegionId | null, picks: readonly CategoryId[], time: TimeRange | null, padMonths: number,
  layers: Partial<Record<CategoryId, LayerId>> | undefined, available: ReadonlySet<LayerId> | null,
): AnomalyBars | null {
  const [bars, setBars] = useState<AnomalyBars | null>(null);
  const ranked = [...picks].sort((a, b) => Number(!GLOBE_VAR[b]) - Number(!GLOBE_VAR[a]));
  const pick = ranked.find((c) => !available || available.has(layers?.[c] ?? CATEGORIES[c].defaultLayer)) ?? null;
  const layer = pick ? layers?.[pick] ?? CATEGORIES[pick].defaultLayer : null;
  const key = `${region}|${pick}|${layer}|${time?.start}|${time?.end}|${padMonths}`;
  useEffect(() => {
    if (!region || !pick || !layer || !time) { setBars(null); return; }
    let live = true;
    loadSeries(region, layer).then((s) => {
      if (!live) return;
      const d = decompose(s, time, padMonths);
      setBars({ category: pick, label: CATEGORIES[pick].name.en, start: ymIndex(d.months[0]), z: d.z, highCool: anomalyPolarity(pick) === "cool" });
    }, () => live && setBars(null));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return bars;
}

/** mean z over month indices [s, e) */
export function meanZ(b: AnomalyBars, s: number, e: number): number | null {
  let sum = 0, n = 0;
  for (let m = s; m < e; m++) { const z = b.z[m - b.start]; if (z != null) { sum += z; n++; } }
  return n ? sum / n : null;
}

/** the colour token a mean anomaly reads as */
export function anomalyVar(b: AnomalyBars, z: number | null): string {
  if (z == null || Math.abs(z) < 0.5) return "--viz-map-mid";
  return (z > 0) === b.highCool ? "--viz-cool" : "--viz-warm";
}
