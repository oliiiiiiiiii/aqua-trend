import type { BasinGeometry } from "./regions";
import { DailyError } from "./errors";

export interface GridSpec { lat0: number; lon0: number; step: number; rows: number; cols: number }
export const GLDAS_GRID: GridSpec = { lat0: -59.875, lon0: -179.875, step: 0.25, rows: 600, cols: 1440 };
export interface BasinGrid {
  row0: number; row1: number; col0: number; col1: number;
  lat: number[]; lon: number[]; weights: number[]; totalWeight: number;
}

export function basinGrid(geometry: BasinGeometry, spec = GLDAS_GRID): BasinGrid | null {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates as number[][][]] : geometry.coordinates as number[][][][];
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const rings of polygons) for (const ring of rings) for (const [x, y] of ring) {
    west = Math.min(west, x); east = Math.max(east, x);
    south = Math.min(south, y); north = Math.max(north, y);
  }
  const row0 = Math.max(0, Math.ceil((south - spec.lat0) / spec.step));
  const row1 = Math.min(spec.rows - 1, Math.floor((north - spec.lat0) / spec.step));
  const col0 = Math.max(0, Math.ceil((west - spec.lon0) / spec.step));
  const col1 = Math.min(spec.cols - 1, Math.floor((east - spec.lon0) / spec.step));
  if (row0 > row1 || col0 > col1) return null;
  if ((row1 - row0 + 1) * (col1 - col0 + 1) > 65_536) {
    throw new DailyError("invalid_request", 400, "此流域的日資料網格過大，請選擇較小的流域。");
  }
  const lat = Array.from({ length: row1 - row0 + 1 }, (_, i) => spec.lat0 + (row0 + i) * spec.step);
  const lon = Array.from({ length: col1 - col0 + 1 }, (_, i) => spec.lon0 + (col0 + i) * spec.step);
  const weights = lat.flatMap((y) => lon.map((x) => polygons.some((rings) => inRings(x, y, rings))
    ? Math.cos(y * Math.PI / 180) : 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return totalWeight > 0 ? { row0, row1, col0, col1, lat, lon, weights, totalWeight } : null;
}

function inRings(x: number, y: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function regionalMean(values: readonly (number | null)[], grid: BasinGrid): number | null {
  if (values.length !== grid.weights.length) throw new Error("grid shape mismatch");
  let sum = 0, valid = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i], weight = grid.weights[i];
    if (value !== null && Number.isFinite(value) && weight > 0) { sum += value * weight; valid += weight; }
  }
  return valid > 0 && valid / grid.totalWeight >= 0.3 ? sum / valid : null;
}
