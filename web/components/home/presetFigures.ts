// Server-only: the real numbers behind the home page's preset cards. Reads the same series files the
// detective reads (web/public/data/series/<basin>.json) and runs the same in-browser statistics, so each
// card's mini anomaly strip is exactly what the analysis view shows for that preset's open lane.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { decompose } from "@/lib/detective/analysis";
import { CATEGORIES } from "@/lib/detective/categories";
import type { CategoryId, PresetEvent, YearMonth } from "@/lib/detective/contracts";
import { intervalDetail, type Verdict } from "@/lib/detective/intervalDetail";
import { addMonths, ymIndex } from "@/lib/detective/url";

export interface PresetFigure {
  firstYear: string;
  category: CategoryId;
  layer: string;
  /** months shown: event start − pad … event end + pad */
  months: YearMonth[];
  /** monthly z (null = missing) for those months */
  z: (number | null)[];
  /** index range of the event within `months` */
  event: [number, number];
  meanZ: number | null;
  p: number | null;
  verdict: Verdict;
  direction: "low" | "high" | null;
}

const DATA = path.join(process.cwd(), "public", "data");

type SeriesFile = { layers?: Record<string, { start?: string; values?: (number | null)[] }> };

/** null when the data bundle is not installed or the preset's layer cannot be analysed. */
export async function presetFigure(p: PresetEvent): Promise<PresetFigure | null> {
  const category = p.active ?? p.categories[0];
  const layer = p.layers?.[category] ?? CATEGORIES[category].defaultLayer;
  let file: SeriesFile;
  try {
    file = JSON.parse(await readFile(path.join(DATA, "series", `${p.region}.json`), "utf8")) as SeriesFile;
  } catch {
    return null;
  }
  const raw = file.layers?.[layer];
  if (!raw?.start || !Array.isArray(raw.values)) return null;
  const pad = p.padMonths ?? 12;
  try {
    const d = decompose({ layer, start: raw.start as YearMonth, values: raw.values, unit: "" }, p.time, pad);
    const detail = intervalDetail(d, p.time);
    const first = addMonths(p.time.start, -pad);
    const count = ymIndex(p.time.end) - ymIndex(first) + 1 + pad;
    const months: YearMonth[] = Array.from({ length: count }, (_, i) => addMonths(first, i));
    const at = new Map(d.months.map((m, i) => [m, d.z[i]]));
    return {
      firstYear: raw.start.slice(0, 4),
      category,
      layer,
      months,
      z: months.map((m) => at.get(m) ?? null),
      event: [pad, pad + ymIndex(p.time.end) - ymIndex(p.time.start)],
      meanZ: detail.meanZ,
      p: detail.test?.p ?? null,
      verdict: detail.verdict,
      direction: detail.direction,
    };
  } catch {
    return null;
  }
}
