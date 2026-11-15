// Toon material for the canopy mesh: the vertex shader scales each crown about its own pivot and recolours it by
// season, so a month change only updates a few uniforms (no geometry rebuild). Illustrative, see season.ts.
import * as THREE from "three";
import type { LeafState } from "./season";

export interface LeafMaterial {
  material: THREE.MeshToonMaterial;
  /** write a (possibly in-between) leaf state into the uniforms */
  apply(s: LeafState): void;
}

export function makeLeafMaterial(gradientMap: THREE.Texture): LeafMaterial {
  const u = {
    uLeafScale: { value: 1 },
    uLeafTint: { value: new THREE.Color(0.3, 0.6, 0.25) },
    uLeafAmt: { value: 0 },
    uLeafDark: { value: 0 },
    uLeafSnow: { value: 0 },
  };
  const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec4 aPivot;
uniform float uLeafScale; uniform vec3 uLeafTint; uniform float uLeafAmt; uniform float uLeafDark; uniform float uLeafSnow;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
{
  float lk = aPivot.w;
  float sc = lk < 0.5 ? uLeafScale : (lk < 1.5 ? 1.0 : mix(1.0, uLeafScale, 0.3));
  transformed = aPivot.xyz + (transformed - aPivot.xyz) * sc;
}`)
      .replace("#include <color_vertex>", `#include <color_vertex>
#ifdef USE_COLOR
{
  float lk = aPivot.w;
  vec3 base = vColor.rgb;
  if (lk > 0.5 && lk < 1.5) {
    vec3 c = base * (1.0 - uLeafDark);
    vColor.rgb = mix(c, vec3(0.9, 0.95, 1.0), uLeafSnow * 0.8);
  } else {
    float lum = dot(base, vec3(0.3, 0.59, 0.11));
    float j = fract(sin(dot(aPivot.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 t = uLeafTint * clamp(0.6 + lum * 2.0, 0.82, 1.2) * (0.9 + 0.2 * j);
    float a = uLeafAmt * (lk > 1.5 ? 0.45 : 1.0);
    vColor.rgb = mix(base, t, clamp(a, 0.0, 1.0));
  }
}
#endif`);
  };
  return {
    material,
    apply(s) {
      u.uLeafScale.value = s.size;
      u.uLeafTint.value.setRGB(s.tint[0], s.tint[1], s.tint[2], THREE.SRGBColorSpace);
      u.uLeafAmt.value = s.amt;
      u.uLeafDark.value = s.dark;
      u.uLeafSnow.value = s.snow;
    },
  };
}
