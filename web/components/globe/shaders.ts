// GLSL for the planet and its atmosphere rim. Compiled by three as GLSL ES 3.00 (WebGL2).
// Longitude/latitude come from the object-space position, so there is no UV seam; data textures have no mipmaps.

export const planetVertex = /* glsl */ `
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * position);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const planetFragment = /* glsl */ `
precision highp float;
precision highp int;

uniform sampler2D uSdf;
uniform sampler2D uClimate;
uniform sampler2D uBound;
uniform sampler2D uSel;
uniform sampler2D uMask;
uniform sampler2D uTrend;
uniform int uBoundOn;
uniform int uHoverId;
uniform int uSelMode;   // 0 none, 1 grid id, 2 polygon mask
uniform int uSelId;
uniform vec4 uMaskBox;  // west, south, east, north
uniform float uOverlay; // 0 landscape, 1 trend map
uniform float uTime;
uniform vec3 uLight;

uniform vec3 uWaterShallow, uWaterMid, uWaterDeep, uWaterPolar, uFoam, uSand;
uniform vec3 uDesert, uSavanna, uDryGrass, uGrass, uLush, uTundra, uSnow, uShadow, uNoData;
uniform vec3 uLineCol, uSelCol, uSelHalo, uHoverCol;

varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vPosW;

const float R2D = 57.29577951308232;

vec2 toUV(vec2 ll) { return vec2(ll.x / 360.0 + 0.5, 0.5 - ll.y / 180.0); }

int idAt(sampler2D t, vec2 ll) {
  vec4 c = texture(t, toUV(ll));
  return int(c.r * 255.0 + 0.5) + 256 * int(c.g * 255.0 + 0.5);
}

float selAt(vec2 ll) {
  if (uSelMode == 1) return idAt(uSel, ll) == uSelId ? 1.0 : 0.0;
  if (uSelMode == 2) {
    float dl = mod(ll.x - uMaskBox.x + 360.0, 360.0);
    vec2 uv = vec2(dl / (uMaskBox.z - uMaskBox.x), (ll.y - uMaskBox.y) / (uMaskBox.w - uMaskBox.y));
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return step(0.5, texture(uMask, uv).r);
  }
  return 0.0;
}

// small value noise for organic patches (object space, smooth, seam-free)
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  vec3 n = normalize(vObj);
  vec2 ll = vec2(atan(n.x, n.z), asin(clamp(n.y, -1.0, 1.0))) * R2D; // lon, lat in degrees
  vec2 uv = toUV(ll);

  // screen pixel size in degrees (smooth everywhere, unlike derivatives of longitude)
  float px = max(length(dFdx(vObj)), length(dFdy(vObj))) * R2D;
  float unit = max(px, 0.028);
  float coslat = max(cos(radians(ll.y)), 0.04);

  // ---- coast: signed distance in degrees, positive on land
  // 4 bilinear taps a little under a texel apart round off the staircase of the 0.25° land raster
  vec2 tx = vec2(0.7 / 1440.0, 0.7 / 720.0);
  float sd = texture(uSdf, uv + vec2(tx.x, tx.y)).r + texture(uSdf, uv + vec2(-tx.x, tx.y)).r
           + texture(uSdf, uv + vec2(tx.x, -tx.y)).r + texture(uSdf, uv + vec2(-tx.x, -tx.y)).r;
  float d = (sd * 0.25 * 255.0 - 128.0) / 16.0 * 0.25;
  float aa = max(px * 0.7, 1e-4);
  float land = smoothstep(-aa, aa, d);

  // ---- biome colours from the climate proxy
  vec4 cl = texture(uClimate, uv);
  float nz = noise(n * 9.0) - 0.5;
  float nz2 = noise(n * 31.0) - 0.5;
  float wet = cl.r + nz * 0.12 + nz2 * 0.05;
  float temp = cl.b + nz * 0.04;
  vec3 lc = uDesert;
  lc = mix(lc, uSavanna, smoothstep(0.075, 0.095, wet));
  lc = mix(lc, uDryGrass, smoothstep(0.19, 0.21, wet));
  lc = mix(lc, uGrass, smoothstep(0.34, 0.36, wet));
  lc = mix(lc, uLush, smoothstep(0.62, 0.64, wet));
  float cold = 1.0 - smoothstep(0.38, 0.40, temp); // mean air temperature below about -5 °C
  lc = mix(lc, uTundra, cold * 0.75);
  float snowAmt = smoothstep(0.32, 0.36, cl.g + nz * 0.1);
  snowAmt = max(snowAmt, 1.0 - smoothstep(-61.0, -59.5, ll.y));
  lc = mix(lc, uSnow, snowAmt);

  // sand band just inside the shore (not on ice)
  float sandW = 1.6 * unit + 0.05;
  float sand = (1.0 - smoothstep(sandW - aa, sandW + aa, d)) * (1.0 - snowAmt);
  lc = mix(lc, uSand, sand);
  // ice shelves get a faint blue lip instead of a beach
  lc = mix(lc, uSnow * vec3(0.86, 0.93, 1.0), (1.0 - smoothstep(sandW * 0.6 - aa, sandW * 0.6 + aa, d)) * snowAmt);

  // ---- water: shallow turquoise at the coast, deeper offshore
  float dw = -d;
  vec3 wc = mix(uWaterShallow, uWaterMid, smoothstep(0.0, 0.45, dw));
  wc = mix(wc, uWaterDeep, smoothstep(0.35, 1.9, dw));
  wc = mix(wc, uWaterPolar, smoothstep(55.0, 75.0, abs(ll.y)) * 0.6);
  wc *= 1.0 + nz * 0.06;
  // foam: a steady line hugging the shore and a wave ring travelling outward
  float fu = unit + 0.02;
  float foamLine = 1.0 - smoothstep(0.45 * fu - aa, 0.45 * fu + aa, abs(dw - 1.2 * fu));
  float ph = fract(uTime * 0.16);
  float waveD = mix(2.1, 4.8, ph) * fu;
  float wave = (1.0 - smoothstep(0.36 * fu - aa, 0.36 * fu + aa, abs(dw - waveD))) * (1.0 - ph) * smoothstep(0.0, 0.15, ph);
  float foam = max(foamLine * 0.95, wave * 0.8) * (1.0 - uOverlay * 0.6);
  wc = mix(wc, uFoam, foam);

  // ---- trend overlay: honest 1° blocks on land, grey where there is no GLDAS data
  vec4 tr = texture(uTrend, uv);
  vec3 dataCol = tr.a > 0.5 ? tr.rgb : uNoData;
  lc = mix(lc, dataCol, uOverlay);
  wc = mix(wc, mix(wc, vec3(dot(wc, vec3(0.3, 0.55, 0.15))), 0.35), uOverlay);

  vec3 col = mix(wc, lc, land);

  // ---- region outlines and highlights
  vec2 ox = vec2(0.75 * px / coslat, 0.0);
  vec2 oy = vec2(0.0, 0.75 * px);
  if (uBoundOn == 1) {
    int c0 = idAt(uBound, ll);
    int a1 = idAt(uBound, ll + ox), a2 = idAt(uBound, ll - ox), a3 = idAt(uBound, ll + oy), a4 = idAt(uBound, ll - oy);
    float diff = 0.0;
    if (c0 != 0) {
      diff += (a1 != c0 && a1 != 0) ? 1.0 : 0.0;
      diff += (a2 != c0 && a2 != 0) ? 1.0 : 0.0;
      diff += (a3 != c0 && a3 != 0) ? 1.0 : 0.0;
      diff += (a4 != c0 && a4 != 0) ? 1.0 : 0.0;
    }
    col = mix(col, uLineCol, min(diff, 2.0) * 0.16);
    if (uHoverId > 0) {
      float h0 = c0 == uHoverId ? 1.0 : 0.0;
      vec2 ox2 = ox * 1.6, oy2 = oy * 1.6;
      float hd = 0.0;
      hd += abs(h0 - (idAt(uBound, ll + ox2) == uHoverId ? 1.0 : 0.0));
      hd += abs(h0 - (idAt(uBound, ll - ox2) == uHoverId ? 1.0 : 0.0));
      hd += abs(h0 - (idAt(uBound, ll + oy2) == uHoverId ? 1.0 : 0.0));
      hd += abs(h0 - (idAt(uBound, ll - oy2) == uHoverId ? 1.0 : 0.0));
      col = mix(col, uHoverCol, h0 * 0.22);
      col = mix(col, uHoverCol, min(hd, 1.0) * 0.9);
    }
  }
  if (uSelMode > 0) {
    float s0 = selAt(ll);
    vec2 o1x = ox * 1.5, o1y = oy * 1.5, o2x = ox * 3.6, o2y = oy * 3.6;
    float e1 = abs(s0 - selAt(ll + o1x)) + abs(s0 - selAt(ll - o1x)) + abs(s0 - selAt(ll + o1y)) + abs(s0 - selAt(ll - o1y));
    float e2 = abs(s0 - selAt(ll + o2x)) + abs(s0 - selAt(ll - o2x)) + abs(s0 - selAt(ll + o2y)) + abs(s0 - selAt(ll - o2y));
    col = mix(col, uSelCol, s0 * 0.12 * (1.0 - uOverlay)); // no tint over trend colours
    col = mix(col, uSelHalo, min(e2, 1.0) * 0.55);
    col = mix(col, uSelCol, min(e1, 1.0));
  }

  // ---- toon lighting: soft terminator, two flat bands, readable shadow side
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float ndl = dot(N, uLight);
  float lit = smoothstep(-0.02, 0.14, ndl);
  float top = smoothstep(0.62, 0.7, ndl);
  vec3 shade = mix(uShadow, vec3(1.0), lit) * (0.94 + 0.08 * top);
  shade = mix(shade, mix(vec3(0.9), vec3(1.0), lit), uOverlay * 0.7);
  col *= shade;
  // soft bright rim
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col = mix(col, vec3(0.92, 0.97, 1.0), rim * 0.35);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const atmosphereVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const atmosphereFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform float uInner; // dot value at the planet limb
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = -dot(normalize(vN), normalize(vV)); // back faces: 0 at the outer edge, uInner at the planet limb
  float a = smoothstep(0.0, uInner, f);
  gl_FragColor = vec4(uColor, a * a * uStrength);
}
`;
