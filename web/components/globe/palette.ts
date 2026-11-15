// Natural colours of the toy planet. The planet keeps these in every theme (the build spec allows that);
// everything theme-dependent (outlines, highlights, the diverging trend scale) is read from CSS tokens.
// Values are sRGB 0-1 triples, written straight into the shader (which outputs sRGB without conversion).

export type RGB = [number, number, number];

export const PLANET = {
  waterShallow: [0.42, 0.88, 0.86] as RGB,
  waterMid: [0.16, 0.74, 0.86] as RGB,
  waterDeep: [0.12, 0.56, 0.82] as RGB,
  waterPolar: [0.2, 0.52, 0.72] as RGB,
  foam: [0.97, 1.0, 1.0] as RGB,
  sand: [0.97, 0.88, 0.62] as RGB,
  desert: [0.95, 0.79, 0.51] as RGB,
  savanna: [0.86, 0.8, 0.43] as RGB,
  dryGrass: [0.66, 0.79, 0.33] as RGB,
  grass: [0.42, 0.76, 0.29] as RGB,
  lush: [0.2, 0.62, 0.27] as RGB,
  tundra: [0.6, 0.71, 0.52] as RGB,
  snow: [0.95, 0.97, 1.0] as RGB,
  /** cool tint multiplied into the shadow side (cartoon shading, never black) */
  shadow: [0.62, 0.68, 0.86] as RGB,
  /** neutral grey for land without GLDAS trend data; also used by the legend swatch */
  noData: [0.62, 0.63, 0.65] as RGB,
  /** region outline ink, drawn at low alpha */
  line: [0.07, 0.14, 0.24] as RGB,
  /** dark halo around bright highlight lines */
  haloDark: [0.05, 0.1, 0.2] as RGB,
  haloLight: [1, 1, 1] as RGB,
  atmosphere: [0.86, 0.95, 1.0] as RGB,
  trunk: [0.55, 0.36, 0.22] as RGB,
  canopy: [0.33, 0.72, 0.27] as RGB,
  canopyLush: [0.2, 0.6, 0.26] as RGB,
  conifer: [0.16, 0.5, 0.36] as RGB,
  cactus: [0.42, 0.66, 0.3] as RGB,
  rock: [0.68, 0.62, 0.56] as RGB,
  cloud: [1, 1, 1] as RGB,
};

export const rgbCss = (c: RGB) => `rgb(${c.map((x) => Math.round(x * 255)).join(" ")})`;

/** Parse a resolved CSS colour (#rgb, #rrggbb, #rrggbbaa, rgb()/rgba()) into sRGB 0-1. */
export function parseCssColor(s: string, fallback: RGB = [0.5, 0.5, 0.5]): RGB {
  s = s.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length >= 6) {
      const n = parseInt(h.slice(0, 6), 16);
      if (!Number.isNaN(n)) return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    return fallback;
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x));
    if (p.length >= 3 && p.slice(0, 3).every((x) => !Number.isNaN(x))) return [p[0] / 255, p[1] / 255, p[2] / 255];
  }
  return fallback;
}

export const luminance = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
