// Pure mapping from a detective variable (category + layer + unit) onto a crystal-ball channel, with unit conversion,
// plus the numbers behind the read-out and the generic gauge. No React, no DOM.
//
// The ball draws GLDAS-style variables on fixed domains (web/lib/variables.ts). A detective layer drives a channel only when it
// is the same physical quantity in a convertible unit; otherwise it is "unmapped" and the ball stays scenery.
import type { CategoryId, Decomposition, LayerId } from "@/lib/detective/contracts";

export type BallChannel = "precip" | "et" | "runoff" | "root_zone" | "soil_top" | "swe";
export type UnmappedReason = "no-channel" | "temperature" | "anomaly" | "layer" | "unit";

export type BallMapping =
  | { channel: BallChannel; /** value in the layer unit -> the ball channel's unit; month is "YYYY-MM" */ convert: (v: number, month: string) => number }
  | { channel: null; reason: UnmappedReason };

export function daysInMonth(ym: string): number {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  if (!y || !m) return NaN;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const norm = (u: string) => u.toLowerCase().replace(/\s+/g, "").replace("²", "2").replace("⁻¹", "-1");

/** converters to the ball's flux unit (mm/day); null = not convertible */
function toMmPerDay(unit: string): ((v: number, month: string) => number) | null {
  switch (norm(unit)) {
    case "mm/day": case "mm/d": case "mmday-1": case "mmd-1": return (v) => v;
    case "mm/month": case "mm/mo": case "mmmonth-1": return (v, m) => v / daysInMonth(m);
    case "kg/m2/s": case "kgm-2s-1": case "mm/s": case "mms-1": return (v) => v * 86400;
    case "m/day": case "m/d": return (v) => v * 1000;
    default: return null;
  }
}

/** converters to the ball's storage unit (mm of water) */
function toMm(unit: string): ((v: number, month: string) => number) | null {
  switch (norm(unit)) {
    case "mm": case "kg/m2": case "kgm-2": return (v) => v;
    case "cm": return (v) => v * 10;
    case "m": return (v) => v * 1000;
    default: return null;
  }
}

const FLUX: Partial<Record<CategoryId, BallChannel>> = { precip: "precip", et: "et", runoff: "runoff" };
/** soil layers that are exactly a ball layer; other soil layers (0-2 m total, fraction) are not */
const SOIL_LAYER: Record<string, BallChannel> = { sm_root: "root_zone", g1_soil_top: "soil_top" };

export function mapToBall(category: CategoryId, layer: LayerId, unit: string): BallMapping {
  const flux = FLUX[category];
  if (flux) {
    const f = toMmPerDay(unit);
    return f ? { channel: flux, convert: f } : { channel: null, reason: "unit" };
  }
  if (category === "soil") {
    const ch = SOIL_LAYER[layer];
    if (!ch) return { channel: null, reason: "layer" };
    const f = toMm(unit);
    return f ? { channel: ch, convert: f } : { channel: null, reason: "unit" };
  }
  if (category === "snow") {
    const f = toMm(unit); // snow water equivalent only; snow-cover % fails the unit test
    return f ? { channel: "swe", convert: f } : { channel: null, reason: "unit" };
  }
  // GRACE is an anomaly about an unknown mean; the ball's gauge is the model's absolute storage
  if (category === "tws") return { channel: null, reason: "anomaly" };
  // the vapour tint needs ET puffs to show it, so air temperature cannot be drawn on its own
  if (category === "tair") return { channel: null, reason: "temperature" };
  return { channel: null, reason: "no-channel" };
}

export type OrbMode = "observed" | "normal";

export interface MonthRead {
  month: string | null;
  /** the series' own value, null when the month is missing */
  observed: number | null;
  /** trend + seasonal: what this calendar month is expected to be */
  normal: number | null;
}

const fin = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

export function readMonth(d: Decomposition, i: number): MonthRead {
  const month = d.months[i] ?? null;
  const o = d.raw[i];
  const t = d.trend[i], s = d.seasonal[i];
  return { month, observed: fin(o) ? o : null, normal: fin(t) && fin(s) ? t + s : null };
}

/** the value to show for a mode; Normal never depends on the month being observed */
export const shownValue = (r: MonthRead, mode: OrbMode): number | null => (mode === "normal" ? r.normal : r.observed);

/** value for the ball channel (converted), null when missing or when the conversion is not finite */
export function ballValue(m: BallMapping, r: MonthRead, mode: OrbMode): number | null {
  if (m.channel == null || r.month == null) return null;
  const v = shownValue(r, mode);
  if (v == null) return null;
  const c = m.convert(v, r.month);
  return Number.isFinite(c) ? c : null;
}

export interface GaugeModel {
  lo: number;
  hi: number;
  /** 0..1 on the record range (widened to hold the shown value and the normal) */
  pos: number | null;
  normalPos: number | null;
  /** observed - normal, null when either is missing or in Normal mode's missing months */
  anomaly: number | null;
  sign: "above" | "below" | "at" | null;
}

export function gaugeOf(d: Decomposition, r: MonthRead, mode: OrbMode): GaugeModel | null {
  let lo = Infinity, hi = -Infinity;
  for (const x of d.raw) if (fin(x)) { if (x < lo) lo = x; if (x > hi) hi = x; }
  if (!Number.isFinite(lo)) return null;
  const v = shownValue(r, mode);
  for (const x of [v, r.normal]) if (fin(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  const span = hi - lo || 1;
  const at = (x: number | null) => (x == null ? null : (x - lo) / span);
  const anomaly = r.observed != null && r.normal != null ? r.observed - r.normal : null;
  const sign = anomaly == null ? null : anomaly > 0 ? "above" : anomaly < 0 ? "below" : "at";
  return { lo, hi, pos: at(v), normalPos: at(r.normal), anomaly, sign };
}
