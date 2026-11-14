// Illustrative props: instanced low-poly trees / cacti / rocks placed from the climate proxy, drifting clouds,
// and the pin used for a selected region smaller than one raster pixel. None of this is data.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PLANET, type RGB } from "./palette";

const srgb = (c: RGB) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

function paint(g: THREE.BufferGeometry, c: RGB): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const col = srgb(c);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute("uv");
  return geo;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
  g.scale(sx, sy, sz); g.translate(x, y, z); return g;
};
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

/** Local space: base at origin, +Y up, about 1 unit tall. */
function roundTree(): THREE.BufferGeometry {
  return merge([
    paint(at(new THREE.CylinderGeometry(0.07, 0.1, 0.42, 6), 0, 0.21, 0), PLANET.trunk),
    paint(at(new THREE.IcosahedronGeometry(0.34, 0), 0, 0.64, 0), PLANET.canopy),
    paint(at(new THREE.IcosahedronGeometry(0.22, 0), 0.12, 0.86, 0.05), PLANET.canopy),
  ]);
}
function conifer(): THREE.BufferGeometry {
  return merge([
    paint(at(new THREE.CylinderGeometry(0.05, 0.07, 0.25, 5), 0, 0.12, 0), PLANET.trunk),
    paint(at(new THREE.ConeGeometry(0.3, 0.5, 6), 0, 0.42, 0), PLANET.conifer),
    paint(at(new THREE.ConeGeometry(0.22, 0.42, 6), 0, 0.72, 0), PLANET.conifer),
  ]);
}
function cactus(): THREE.BufferGeometry {
  return merge([
    paint(at(new THREE.CylinderGeometry(0.09, 0.1, 0.75, 6), 0, 0.37, 0), PLANET.cactus),
    paint(at(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6), 0.2, 0.5, 0), PLANET.cactus),
    paint(at(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 6), 0.12, 0.36, 0, 1, 1, 1).rotateZ(Math.PI / 2), PLANET.cactus),
    paint(at(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 6), -0.19, 0.62, 0), PLANET.cactus),
  ]);
}
function rock(): THREE.BufferGeometry {
  return merge([
    paint(at(new THREE.DodecahedronGeometry(0.26, 0), 0, 0.1, 0, 1.2, 0.7, 1), PLANET.rock),
    paint(at(new THREE.DodecahedronGeometry(0.16, 0), 0.26, 0.05, 0.1, 1, 0.8, 1), PLANET.rock),
  ]);
}

/** A three-step ramp for MeshToonMaterial (soft cel bands). */
function toonRamp(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export interface PropUniforms { uPropScale: { value: number } }

export function toonMaterial(u: PropUniforms, opts: { vertexColors?: boolean; color?: RGB; transparent?: boolean; ramp: THREE.Texture }) {
  const m = new THREE.MeshToonMaterial({
    vertexColors: opts.vertexColors ?? false,
    color: opts.color ? srgb(opts.color) : 0xffffff,
    gradientMap: opts.ramp,
    transparent: opts.transparent ?? false,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPropScale = u.uPropScale;
    shader.vertexShader = "uniform float uPropScale;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\ntransformed *= uPropScale;",
    );
  };
  m.customProgramCacheKey = () => "aqua-prop";
  return m;
}

// ---------------------------------------------------------------- deterministic placement

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dirOf = (lon: number, lat: number, r = 1) => {
  const a = (lon * Math.PI) / 180, b = (lat * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(b) * Math.sin(a) * r, Math.sin(b) * r, Math.cos(b) * Math.cos(a) * r);
};

interface Placement { lon: number; lat: number; s: number; spin: number; tint: number }

export function placeProps(sdf: Uint8Array, climate: Uint8Array) {
  const rnd = mulberry32(20260517);
  const sdfAt = (lon: number, lat: number) => {
    const c = Math.min(1439, Math.max(0, Math.floor((lon + 180) * 4)));
    const r = Math.min(719, Math.max(0, Math.floor((90 - lat) * 4)));
    return sdf[r * 1440 + c];
  };
  const climAt = (lon: number, lat: number) => {
    const c = Math.min(359, Math.max(0, Math.floor(lon + 180)));
    const r = Math.min(179, Math.max(0, Math.floor(90 - lat)));
    const i = (r * 360 + c) * 4;
    return [climate[i] / 255, climate[i + 1] / 255, climate[i + 2] / 255] as const;
  };
  const grove = (v: THREE.Vector3) =>
    0.5 + 0.5 * Math.sin(v.x * 7.1 + 1.3) * Math.sin(v.y * 6.3 + 0.2) * Math.sin(v.z * 7.7 + 2.1);

  const round: Placement[] = [], cone: Placement[] = [], cacti: Placement[] = [], rocks: Placement[] = [];
  for (let k = 0; k < 26000; k++) {
    const z = rnd() * 2 - 1, phi = rnd() * Math.PI * 2;
    const lat = (Math.asin(z) * 180) / Math.PI;
    const lon = (phi * 180) / Math.PI - 180;
    const pick = rnd(), size = rnd(), spin = rnd() * Math.PI * 2, tint = rnd();
    if (lat < -58) continue;
    const s = sdfAt(lon, lat);
    if (s < 128 + 14) continue; // keep off the beach (about 0.2° inland)
    const [wet, snow, temp] = climAt(lon, lat);
    if (snow > 0.3) continue;
    const g = grove(dirOf(lon, lat));
    const p: Placement = { lon, lat, s: 0.8 + size * 0.45, spin, tint };
    if (temp < 0.43) {
      if (pick < 0.09 * g * (0.4 + wet)) cone.push(p);
    } else if (wet < 0.09) {
      if (pick < 0.012) (rnd() < 0.45 && temp > 0.6 ? cacti : rocks).push(p);
    } else if (pick < (0.015 + 0.13 * wet * wet) * (0.3 + 1.4 * g)) {
      round.push(p);
    }
  }
  return { round, cone, cacti, rocks };
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: Placement[], base: number, tintRange: number) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.count = list.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), spin = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  list.forEach((p, i) => {
    const n = dirOf(p.lon, p.lat);
    q.setFromUnitVectors(up, n);
    spin.setFromAxisAngle(up, p.spin);
    q.multiply(spin);
    const s = base * p.s;
    m.compose(n.clone().multiplyScalar(0.999), q, new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, m);
    const k = 1 - tintRange / 2 + p.tint * tintRange;
    mesh.setColorAt(i, c.setRGB(k, k, k));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

export interface Scenery {
  props: THREE.Group;
  clouds: THREE.Group;
  pin: THREE.Group;
  uniforms: PropUniforms;
  setCloudFade(f: number): void;
  setPinColor(c: RGB): void;
  dispose(): void;
}

export const TREE_SIZE = 0.045;

export function buildScenery(sdf: Uint8Array, climate: Uint8Array, pinColor: RGB): Scenery {
  const ramp = toonRamp();
  const uniforms: PropUniforms = { uPropScale: { value: 1 } };
  const disposables: { dispose(): void }[] = [ramp];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };

  const propMat = track(toonMaterial(uniforms, { vertexColors: true, ramp }));
  const place = placeProps(sdf, climate);
  const props = new THREE.Group();
  props.add(
    instanced(track(roundTree()), propMat, place.round, TREE_SIZE, 0.3),
    instanced(track(conifer()), propMat, place.cone, TREE_SIZE * 1.05, 0.25),
    instanced(track(cactus()), propMat, place.cacti, TREE_SIZE * 0.8, 0.15),
    instanced(track(rock()), propMat, place.rocks, TREE_SIZE * 0.75, 0.2),
  );

  // clouds: puffy merged blobs on a slowly turning shell, each with a soft blob shadow on the ground
  const clouds = new THREE.Group();
  const cloudMat = track(new THREE.MeshToonMaterial({ color: srgb(PLANET.cloud), gradientMap: ramp }));
  const rnd = mulberry32(7);
  const cloudSpots: [number, number][] = [
    [-30, 32], [12, -8], [62, 24], [118, 46], [160, -22], [-118, 12], [-72, -36], [-158, 40], [96, -4], [36, 52], [-10, -48], [140, 8],
  ];
  for (const [lon, lat] of cloudSpots) {
    const blobs: THREE.BufferGeometry[] = [];
    const nBlobs = 4 + Math.floor(rnd() * 3);
    for (let b = 0; b < nBlobs; b++) {
      const r = 0.55 + rnd() * 0.4;
      const x = (b - (nBlobs - 1) / 2) * 0.62 + (rnd() - 0.5) * 0.2;
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.translate(x, r * 0.35 + (b % 2) * 0.15, (rnd() - 0.5) * 0.5);
      blobs.push(g);
    }
    const geo = track(mergeGeometries(blobs.map((g) => { g.deleteAttribute("uv"); return g; }), false)!);
    geo.scale(1, 0.62, 0.8); // icosahedra with detail > 0 carry smooth normals: puffy toon shading
    const size = 0.034 + rnd() * 0.014;
    const n = dirOf(lon, lat);
    const mesh = new THREE.Mesh(geo, cloudMat);
    mesh.position.copy(n.clone().multiplyScalar(1.075 + rnd() * 0.03));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI));
    mesh.scale.setScalar(size);
    mesh.userData.size = size;
    clouds.add(mesh);
  }
  // clouds shrink away (no transparency, so overlapping puffs never show their insides)
  const setCloudFade = (f: number) => {
    clouds.visible = f > 0.01;
    for (const c of clouds.children) c.scale.setScalar((c.userData.size as number) * f);
  };

  // pin for selections smaller than one raster pixel
  const pin = new THREE.Group();
  const pinMat = track(new THREE.MeshToonMaterial({ color: srgb(pinColor), gradientMap: ramp }));
  const stem = new THREE.Mesh(track(new THREE.CylinderGeometry(0.06, 0.02, 1, 6).translate(0, 0.5, 0)), pinMat);
  const head = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.28, 1).translate(0, 1.15, 0)), pinMat);
  pin.add(stem, head);
  pin.visible = false;

  return {
    props, clouds, pin, uniforms, setCloudFade,
    setPinColor(c: RGB) { pinMat.color.copy(srgb(c)); },
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
