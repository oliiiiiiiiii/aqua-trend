// Component contracts between the work packages. Owned by the PM.
// Implementations may ADD optional props, but must not rename or remove anything here.
import type { Lead, LayerId, Region, RegionSeries, VarId } from "./types";

/* ---------------------------------------------------------------- globe  (components/globe/GlobeCanvas.tsx) */
export interface GlobePoint { lon: number; lat: number }
export interface GlobeCanvasProps {
  className?: string;
  /** false = decorative hero: slow auto-rotation, no picking, no controls */
  interactive?: boolean;
  /** which layer's region outlines are drawn and hover-highlighted; null = none */
  boundaryLayer?: LayerId | null;
  /** highlighted analysis boundary; the camera eases to it whenever it changes */
  selected?: Region | null;
  /** null = cute landscape; otherwise the 1° per-cell trend map of that variable */
  overlay?: VarId | null;
  /** click on the planet (not fired after a drag) */
  onPick?: (point: GlobePoint & { zoom: number }) => void;
  /** pointer moved over the planet; region = the boundaryLayer region under the pointer */
  onHover?: (hit: (GlobePoint & { region: Region | null }) | null) => void;
  /** 1 = whole planet in view, larger = closer. Fired when it settles on a new value. */
  onZoomChange?: (zoom: number) => void;
}

/* ---------------------------------------------------------------- crystal ball  (components/orb/CrystalBall.tsx) */
export interface OrbClimate {
  /** long-term regional means used only to choose the illustrative scenery */
  precip: number; et: number; swe: number; tair: number;
  /** 12-value monthly climatology (index 0 = January), NaN-free means over all years; drives the illustrative leaf phenology */
  precipClim?: number[];
  tairClim?: number[];
}
/** Where each channel is drawn, in CSS px relative to the CrystalBall root element; visible=false when it is hidden (far side, absent in this scenery). */
export type OrbAnchors = Partial<Record<VarId, { x: number; y: number; visible: boolean }>>;
export interface CrystalBallProps {
  className?: string;
  /** scenery follows region.surface / region.surfaceFrac (ocean, coast, ice sheet, land) - see README section 15 */
  region: Region;
  /** long-term regional means; null when the region has no land-model series (open ocean, Antarctica) */
  climate: OrbClimate | null;
  /** "YYYY-MM" of the frame being shown */
  month: string;
  /** this month's regional values; null/NaN = missing (must render as "no data", never as zero) */
  values: Partial<Record<VarId, number | null>>;
  /** the 1-3 selected water targets: only their channels are driven by data */
  targets: VarId[];
  /** variable that colours the ET vapour, or null for neutral vapour */
  colorBy: VarId | null;
  /** history playback is running (particles keep moving either way; this is for subtle cues) */
  playing?: boolean;
  /** small static comparison orb (start/end year beside the main one): no camera buttons, no legend, lighter particles and frame rate */
  compact?: boolean;
  /** called (throttled, only when something moved > 1 px) with the on-screen anchor of each channel's drawing; never called when `compact` */
  onAnchors?: (a: OrbAnchors) => void;
}

/* ---------------------------------------------------------------- evidence  (components/evidence/TrendPanel.tsx) */
export interface TrendPanelProps {
  region: Region;
  series: RegionSeries;
  targets: VarId[];
  /** index into series.months for the playback cursor */
  monthIndex: number;
  onMonthChange: (index: number) => void;
}

/* ---------------------------------------------------------------- leads  (components/leads/LeadsPanel.tsx) */
export interface LeadsPanelProps {
  region: Region;
  /** null when the region has no GLDAS series (ocean, Antarctica) */
  series: RegionSeries | null;
  targets: VarId[];
  selectedLeadId: string | null;
  onSelectLead: (lead: Lead | null) => void;
}
