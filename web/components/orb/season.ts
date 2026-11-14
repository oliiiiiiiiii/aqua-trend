// Illustrative leaf phenology for the crystal ball. A calendar cue built from the region's long-term monthly
// climatology (the same for every year): it is NOT a measured vegetation variable. Pure functions, shared by the
// WebGL scene (leaf size / colour) and the text label (seasonWords).
import type { OrbClimate } from "@/lib/contracts";
import type { Region } from "@/lib/types";

export type RGB = [number, number, number]; // sRGB 0..1

/** What the shader needs: crown scale, deciduous tint, evergreen darkening and snow dusting. */
export interface LeafState {
  /** 0..1 crown scale of deciduous trees (1 = full summer crown) */
  size: number;
  /** deciduous colour that replaces the baked canopy colour, weighted by `amt` (0 = keep the green palette) */
  tint: RGB;
  amt: number;
  /** conifers: slight darkening 0..1 and a snow dusting 0..1 */
  dark: number;
  snow: number;
}
export const NEUTRAL_LEAVES: LeafState = { size: 1, tint: [0.3, 0.6, 0.25], amt: 0, dark: 0, snow: 0 };

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRgb = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function lerpLeaf(a: LeafState, b: LeafState, t: number): LeafState {
  return { size: lerp(a.size, b.size, t), tint: lerpRgb(a.tint, b.tint, t), amt: lerp(a.amt, b.amt, t), dark: lerp(a.dark, b.dark, t), snow: lerp(a.snow, b.snow, t) };
}

/** Temperate keyframes around the year loop, s = 0 coldest -> 0.5 warmest -> 1 coldest again: [s, size, tint, tint weight]. */
const BROWN: RGB = [0.45, 0.3, 0.18];
const LOOP: [number, number, RGB, number][] = [
  [0.0, 0.4, BROWN, 1], // winter: a small, bare-looking brown crown (still clearly visible)
  [0.08, 0.4, BROWN, 1],
  [0.2, 0.55, [0.66, 0.8, 0.24], 0.95], // spring: small, fresh yellow-green
  [0.32, 0.85, [0.45, 0.74, 0.27], 0.55],
  [0.45, 1, [0.2, 0.55, 0.22], 0],      // summer: full size, deep green (palette)
  [0.6, 1, [0.2, 0.55, 0.22], 0],
  [0.68, 0.95, [0.9, 0.72, 0.18], 0.9], // autumn: yellow -> orange -> red / rust, shrinking
  [0.78, 0.75, [0.9, 0.44, 0.1], 1],
  [0.88, 0.45, [0.72, 0.22, 0.09], 1],
  [0.95, 0.45, [0.52, 0.27, 0.13], 1],
  [1.0, 0.4, BROWN, 1],
];

function loopAt(s: number): LeafState {
  let i = 1;
  while (i < LOOP.length - 1 && LOOP[i][0] < s) i++;
  const a = LOOP[i - 1], b = LOOP[i];
  const t = ss(0, 1, (s - a[0]) / (b[0] - a[0]));
  return { size: lerp(a[1], b[1], t), tint: lerpRgb(a[2], b[2], t), amt: lerp(a[3], b[3], t), dark: 0, snow: 0 };
}

export type Phase = "winter" | "spring" | "summer" | "autumn";

export interface SeasonInfo {
  state: LeafState;
  label: string;
  /** 0 = temperature-driven (extratropics) .. 1 = rain-driven (tropics) */
  tropical: number;
}

function monthIndex(month: string): number {
  const m = Number(month.slice(5, 7));
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m - 1 : 0;
}

const good = (a: number[] | undefined): a is number[] => !!a && a.length === 12 && a.every((v) => Number.isFinite(v));

/** A calendar stand-in for tairClim when the series is missing: warmest in July (N) / January (S). */
function calendarTair(lat: number): number[] {
  const peak = lat >= 0 ? 6.7 : 0.7;
  return Array.from({ length: 12 }, (_, m) => Math.cos(((m - peak) / 12) * Math.PI * 2) * 12 + 8);
}

function extratropic(lat: number, tair: number[], m: number, calendar: boolean) {
  const tmin = Math.min(...tair), tmax = Math.max(...tair), range = tmax - tmin;
  const t = tair[m], prev = tair[(m + 11) % 12], next = tair[(m + 1) % 12];
  const w = range > 1e-6 ? (t - tmin) / range : 0.5;
  const rising = next - prev >= 0;
  const s = rising ? 0.5 * w : 1 - 0.5 * w;
  const amp = calendar ? 1 : ss(3, 10, range); // a nearly flat temperature year barely changes the leaves
  const base = loopAt(s);
  const state = lerpLeaf(NEUTRAL_LEAVES, base, amp);
  // conifers keep their needles: a touch darker when cold, a snow dusting in deep winter at higher latitudes
  const cold = 1 - w;
  state.dark = 0.16 * cold * amp;
  state.snow = 0.4 * ss(0.3, 0.05, w) * amp * ss(35, 50, Math.abs(lat));
  let label: string;
  if (amp < 0.25) label = "Evergreen, little seasonality";
  else {
    const hemi = lat >= 0 ? "N. Hemisphere" : "S. Hemisphere";
    const phase: Phase = w < 0.28 ? "winter" : w > 0.8 ? "summer" : rising ? "spring" : "autumn";
    label = `${phase[0].toUpperCase()}${phase.slice(1)} (${hemi})`;
  }
  return { state, label };
}

function tropic(precip: number[], m: number) {
  const pmin = Math.min(...precip), pmax = Math.max(...precip);
  const seas = pmax > 1e-6 ? (pmax - pmin) / pmax : 0;
  const amp = ss(0.4, 0.9, seas); // an always-wet rainforest is evergreen: barely changes
  // leaves follow the soil water of the last couple of months more than this month's rain
  const p = 0.6 * precip[m] + 0.4 * precip[(m + 11) % 12];
  const wet = pmax - pmin > 1e-6 ? Math.min(1, Math.max(0, (p - pmin) / (pmax - pmin))) : 1;
  const dry: LeafState = { size: 0.42, tint: [0.62, 0.55, 0.2], amt: 0.9, dark: 0, snow: 0 };
  const green: LeafState = { size: 1, tint: [0.2, 0.6, 0.2], amt: 0, dark: 0, snow: 0 };
  const raw = lerpLeaf(dry, green, ss(0.1, 0.65, wet));
  const state = lerpLeaf(NEUTRAL_LEAVES, raw, amp);
  const label = amp < 0.25 ? "Evergreen, little seasonality" : wet >= 0.5 ? "Wet season" : "Dry season";
  return { state, label };
}

/** Per-frame leaf target for a region and month, from its climatology. null climate -> no cue (neutral). */
export function seasonOf(region: Pick<Region, "centroid">, climate: OrbClimate | null, month: string): SeasonInfo {
  const lat = region.centroid?.[1] ?? 0;
  const m = monthIndex(month);
  const aLat = Math.abs(lat);
  const tw = 1 - ss(18, 28, aLat); // tropical weight, blended across 18-28 degrees
  const hasT = good(climate?.tairClim), hasP = good(climate?.precipClim);
  const ext = tw < 1 ? extratropic(lat, hasT ? climate!.tairClim! : calendarTair(lat), m, !hasT) : null;
  const trop = tw > 0 && hasP ? tropic(climate!.precipClim!, m) : null;
  if (tw > 0 && !trop) {
    // tropics without a rain climatology: fall back to temperature if it is there, otherwise no cue
    if (!hasT) return { state: NEUTRAL_LEAVES, label: "No seasonal cue", tropical: tw };
    const e = extratropic(lat, climate!.tairClim!, m, false);
    return { state: e.state, label: e.label, tropical: tw };
  }
  if (ext && trop) return { state: lerpLeaf(ext.state, trop.state, tw), label: tw >= 0.5 ? trop.label : ext.label, tropical: tw };
  const one = (trop ?? ext)!;
  return { state: one.state, label: one.label, tropical: tw };
}

/** Short label of the illustrative season shown for a month, e.g. "Autumn (N. Hemisphere)", "Dry season". */
export function seasonLabel(region: Pick<Region, "centroid">, climate: OrbClimate | null, month: string): string {
  return seasonOf(region, climate, month).label;
}
