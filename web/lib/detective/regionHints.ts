// Sub-basins that a piece of text seems to name: a river ("Indus") or a country in English ("Pakistan") or Chinese
// ("巴基斯坦"). Shared by the input page (hints under the place search) and the batch CSV (the `region` column, or
// the question itself when that column is empty). Pure: no DOM, runs under `npx tsx --test`.
import type { Region } from "../types";

export interface RegionHintIndex {
  /** English country name (lower case) -> ISO code */
  enToIso: Map<string, string>;
  /** river name (lower case) -> its sub-basins */
  rivers: Map<string, Region[]>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const zhNorm = (s: string) => s.replace(/臺/g, "台");
/** everyday Chinese names that differ from catalog/countries.json */
const ZH_ALIASES: [string, string][] = [["澳洲", "AUS"], ["中國", "CHN"], ["韓國", "KOR"], ["美國", "USA"]];

export function buildRegionHintIndex(regions: readonly Region[]): RegionHintIndex {
  const enToIso = new Map<string, string>();
  const rivers = new Map<string, Region[]>();
  for (const r of regions) {
    // names from scripts/prep-data.mjs: "Indus basin (Pakistan)", "Basin 4370 (Taiwan)", "Island basin 123 (Fiji)";
    // the places in brackets are the first three of r.iso, in the same order
    const places = /\(([^()]*)\)\s*$/.exec(r.name)?.[1].split(", ").filter((s) => s && s !== "…") ?? [];
    places.forEach((name, i) => { const iso = r.iso?.[i]; if (iso && !enToIso.has(name.toLowerCase())) enToIso.set(name.toLowerCase(), iso); });
    const river = /^(.+?) basin\b/.exec(r.name)?.[1];
    if (river && river !== "Island") {
      const k = river.toLowerCase();
      rivers.set(k, [...(rivers.get(k) ?? []), r]);
    }
  }
  return { enToIso, rivers };
}

/** River hits first, then the basins of the countries named, each group largest first; at most `limit`. */
export function regionHints(
  text: string,
  index: RegionHintIndex,
  regions: readonly Region[],
  countryNames: ReadonlyMap<string, string> | null,
  limit = 5,
): Region[] {
  const t = text.trim();
  if (t.length < 2) return [];
  const lower = t.toLowerCase();
  const hit = (name: string) => new RegExp(`(^|[^\\p{L}])${escapeRe(name)}($|[^\\p{L}])`, "iu").test(lower);
  const fromRivers = [...index.rivers.entries()].filter(([k]) => k.length >= 3 && hit(k)).flatMap(([, rs]) => rs);
  const isos = new Set<string>();
  for (const [name, iso] of index.enToIso) if (name.length >= 4 && hit(name)) isos.add(iso);
  const zt = zhNorm(t);
  for (const [zh, iso] of ZH_ALIASES) if (zt.includes(zh)) isos.add(iso);
  if (countryNames) for (const [iso, zh] of countryNames) if (zh.length >= 2 && zt.includes(zhNorm(zh))) isos.add(iso);
  const byArea = (x: Region, y: Region) => y.areaKm2 - x.areaKm2;
  const fromCountries = isos.size ? regions.filter((r) => r.iso?.some((c) => isos.has(c))).sort(byArea) : [];
  const out: Region[] = [];
  for (const r of [...fromRivers.sort(byArea), ...fromCountries]) if (!out.includes(r)) out.push(r);
  return out.slice(0, limit);
}
