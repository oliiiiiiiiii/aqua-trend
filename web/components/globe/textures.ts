// Data textures for the planet shader. All equirectangular rasters: row 0 = north, col 0 = 180°W.
// DataTextures are not flipped (flipY = false), so v = (90 - lat) / 180 samples row 0 at the top.
import * as THREE from "three";
import type { TrendGrid, VarId } from "@/lib/types";
import type { NamedFeature } from "@/lib/data";
import { VARIABLES } from "@/lib/variables";
import type { RGB } from "./palette";

function dataTex(
  data: Uint8Array,
  w: number,
  h: number,
  format: THREE.PixelFormat,
  filter: THREE.MagnificationTextureFilter,
): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, format, THREE.UnsignedByteType);
  t.magFilter = filter;
  t.minFilter = filter; // no mipmaps: they would put a seam where atan() wraps at ±180°
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping; // longitude wraps
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.flipY = false;
  t.unpackAlignment = 1;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 1440 x 720 signed distance to the coast, linear filtering for a smooth shoreline. */
export const sdfTexture = (sdf: Uint8Array) => dataTex(sdf, 1440, 720, THREE.RedFormat, THREE.LinearFilter);

/**
 * Climate RGBA (360 x 180). Ocean cells carry zeros, which would bleed "desert" into every coast under linear
 * filtering, so empty cells are filled from their valid neighbours first (a few dilation passes).
 */
export function dilateClimate(src: Uint8Array): Uint8Array {
  const W = 360, H = 180;
  let cur = new Uint8Array(src);
  for (let pass = 0; pass < 8; pass++) {
    const next = new Uint8Array(cur);
    let changed = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (cur[i + 3] !== 0) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = (x + dx + W) % W;
            const j = (yy * W + xx) * 4;
            if (cur[j + 3] === 0) continue;
            r += cur[j]; g += cur[j + 1]; b += cur[j + 2]; n++;
          }
        }
        if (n) {
          next[i] = r / n; next[i + 1] = g / n; next[i + 2] = b / n; next[i + 3] = 1;
          changed++;
        }
      }
    }
    cur = next;
    if (!changed) break;
  }
  return cur;
}
export const climateTexture = (climate: Uint8Array) => dataTex(climate, 360, 180, THREE.RGBAFormat, THREE.LinearFilter);

/** Region ids (Uint16) as RG8: R = low byte, G = high byte. Nearest only - ids must never be interpolated. */
export function gridTexture(grid: Uint16Array): THREE.DataTexture {
  const bytes = new Uint8Array(grid.buffer, grid.byteOffset, grid.byteLength);
  return dataTex(bytes, 1440, 720, THREE.RGFormat, THREE.NearestFilter);
}

export function blankTexture(): THREE.DataTexture {
  return dataTex(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.NearestFilter);
}

export interface MaskBox { west: number; south: number; east: number; north: number }

/**
 * Rasterise a named study window into a canvas mask covering its (padded) bbox. Rectangles stay exact
 * rectangles because the mask edge coincides with the polygon edge and the shader thresholds at 0.5.
 */
export function namedMaskTexture(f: NamedFeature): { texture: THREE.CanvasTexture; box: MaskBox } {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of f.polygons) for (const ring of poly) for (const [x, y] of ring) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  const padX = Math.max(0.05, (e - w) * 0.08), padY = Math.max(0.05, (n - s) * 0.08);
  const box = { west: w - padX, east: e + padX, south: Math.max(-90, s - padY), north: Math.min(90, n + padY) };
  const aspect = ((box.east - box.west) * Math.cos((((box.north + box.south) / 2) * Math.PI) / 180)) / (box.north - box.south);
  const W = Math.round(Math.min(1024, Math.max(64, 768 * Math.sqrt(Math.max(aspect, 0.05)))));
  const H = Math.round(Math.min(1024, Math.max(64, 768 / Math.sqrt(Math.max(aspect, 0.05)))));
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  const px = (lon: number) => ((lon - box.west) / (box.east - box.west)) * W;
  const py = (lat: number) => ((box.north - lat) / (box.north - box.south)) * H;
  ctx.beginPath();
  for (const poly of f.polygons) for (const ring of poly) {
    ring.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.closePath();
  }
  ctx.fill("evenodd");
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = true; // canvas row 0 (north) -> v = 1, so the shader samples v = (lat - south) / (north - south)
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, box };
}

export interface TrendScale {
  /** symmetric limit of the colour scale, unit per year */
  limit: number;
  validCells: number;
}

/** Robust symmetric limit: 95th percentile of |Sen slope| over cells with data. */
export function trendScale(g: TrendGrid): TrendScale {
  const abs: number[] = [];
  for (let i = 0; i < g.sen.length; i++) { const x = g.sen[i]; if (Number.isFinite(x)) abs.push(Math.abs(x)); }
  abs.sort((a, b) => a - b);
  const limit = abs.length ? abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] : 0;
  return { limit: limit > 0 ? limit : 1e-6, validCells: abs.length };
}

export interface DivergingColors { cool: RGB; warm: RGB; mid: RGB }

/** Per-cell colours for the 1° trend map. A = 0 marks cells without GLDAS data (drawn grey on land). */
export function trendTexture(g: TrendGrid, v: VarId, scale: TrendScale, cols: DivergingColors): THREE.DataTexture {
  const out = new Uint8Array(360 * 180 * 4);
  const incr = VARIABLES[v].increaseReads === "cool" ? cols.cool : cols.warm;
  const decr = VARIABLES[v].increaseReads === "cool" ? cols.warm : cols.cool;
  for (let i = 0; i < 360 * 180; i++) {
    const x = g.sen[i];
    if (!Number.isFinite(x)) continue;
    const t = Math.max(-1, Math.min(1, x / scale.limit));
    const end = t >= 0 ? incr : decr;
    const a = Math.abs(t);
    let c: RGB = [0, 1, 2].map((k) => cols.mid[k] + (end[k] - cols.mid[k]) * a) as RGB;
    const p = g.p[i];
    if (!(p < 0.05)) c = [0, 1, 2].map((k) => c[k] + (cols.mid[k] - c[k]) * 0.72) as RGB; // not significant -> muted
    out[i * 4] = Math.round(c[0] * 255);
    out[i * 4 + 1] = Math.round(c[1] * 255);
    out[i * 4 + 2] = Math.round(c[2] * 255);
    out[i * 4 + 3] = 255;
  }
  return dataTex(out, 360, 180, THREE.RGBAFormat, THREE.NearestFilter);
}
