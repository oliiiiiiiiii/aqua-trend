// Imperative three.js core of the globe. GlobeCanvas.tsx owns the React side and talks to this class.
import * as THREE from "three";
import type { Catalog, LayerId, Region, VarId } from "@/lib/types";
import {
  LAYERS, loadCatalog, loadClimate, loadGrid, loadLandSdf, loadNamedGeo, loadTrendGrid, rasterIndex,
} from "@/lib/data";
import { PLANET, luminance, type RGB } from "./palette";
import { atmosphereFragment, atmosphereVertex, planetFragment, planetVertex } from "./shaders";
import {
  blankTexture, climateTexture, dilateClimate, gridTexture, namedMaskTexture, sdfTexture, trendScale, trendTexture,
  type DivergingColors, type TrendScale,
} from "./textures";
import { buildScenery, dirOf, type Scenery } from "./scenery";

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
const FOV = 24;
const LAT_LIMIT = 80;

export interface View { lon: number; lat: number; zoom: number }
export interface ThemeColors { select: RGB; hover: RGB; diverging: DivergingColors }
export interface EngineCallbacks {
  onPick?: (p: { lon: number; lat: number; zoom: number }) => void;
  onHover?: (hit: { lon: number; lat: number; region: Region | null } | null) => void;
  onZoomChange?: (zoom: number) => void;
}
export interface TrendInfo { variable: VarId; scale: TrendScale }

const wrapLon = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Sensible framing for a region: very large -> 1 (whole planet with its rim), small -> up to 4. */
export function zoomForRegion(r: Region): number {
  let extent: number;
  const b = r.bbox;
  if (b && b[2] - b[0] < 180 && b[2] > b[0]) {
    const midLat = (b[1] + b[3]) / 2;
    extent = Math.max((b[2] - b[0]) * Math.cos((midLat * Math.PI) / 180), b[3] - b[1]);
  } else {
    extent = (1.15 * Math.sqrt(Math.max(r.areaKm2, 1))) / 111; // diameter of a disc with that area
  }
  return clamp(48 / Math.max(extent, 0.1), 1, 4);
}

export class GlobeEngine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 50);
  private planet!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private atmosphere!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private light = new THREE.DirectionalLight(0xffffff, 2.2);
  private ambient = new THREE.HemisphereLight(0xffffff, 0xb9c8e8, 1.15);
  private scenery: Scenery | null = null;
  private uniforms: Record<string, THREE.IUniform> = {};
  private blank = blankTexture();
  private gridTex = new Map<LayerId, THREE.DataTexture>();
  private trendTex: THREE.DataTexture | null = null;
  private maskTex: THREE.CanvasTexture | null = null;
  private baseTex: THREE.Texture[] = [];
  private catalog: Catalog | null = null;
  private disposed = false;
  private raf = 0;
  private lastT = 0;
  private time = 0;
  private visible = true;
  private onScreen = true;
  private dirty = true;
  private width = 1;
  private height = 1;
  private d1 = 4;

  // view state: current and eased target
  private cur: View;
  private tgt: View;
  private home: View;
  private vel = { lon: 0, lat: 0 };
  private lastReportedZoom: number;

  // inputs
  private interactive: boolean;
  private reduced: boolean;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: boolean; lastT: number } | null = null;
  private pinch: { dist: number; zoom: number } | null = null;
  private hoverPos: { x: number; y: number } | null = null;
  private hoverDirty = false;
  private lastHoverSent = 0;
  private lastHoverRegion: Region | null | undefined = undefined;
  private boundaryLayer: LayerId | null = null;
  private overlayVar: VarId | null = null;
  private overlayAmt = 0;
  private selected: Region | null = null;
  private selToken = 0;
  private overlayToken = 0;
  private boundToken = 0;
  private theme: ThemeColors;
  cb: EngineCallbacks = {};
  onTrend: (info: TrendInfo | null) => void = () => {};
  onCursor: (c: string) => void = () => {};

  private io: IntersectionObserver;
  private ro: ResizeObserver;

  readonly canvas: HTMLCanvasElement;

  constructor(
    private host: HTMLElement,
    opts: { interactive: boolean; reducedMotion: boolean; initialView: View; theme: ThemeColors },
  ) {
    this.interactive = opts.interactive;
    this.reduced = opts.reducedMotion;
    this.home = { ...opts.initialView };
    this.cur = { ...opts.initialView };
    this.tgt = { ...opts.initialView };
    this.lastReportedZoom = opts.initialView.zoom;
    this.theme = opts.theme;

    // a fresh canvas per engine: React strict mode remounts must not inherit a lost context
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;outline:none";
    this.canvas = canvas;
    this.applyTouchAction();
    // throws when WebGL2 is unavailable; the caller turns that into a readable message
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch (e) {
      throw new Error(`WebGL 2 is not available in this browser (${e instanceof Error ? e.message : String(e)})`);
    }
    host.prepend(canvas);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene.add(this.camera, this.light, this.light.target, this.ambient);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.io = new IntersectionObserver((es) => {
      this.onScreen = es.some((e) => e.isIntersecting);
      this.kick();
    });
    this.io.observe(host);
    document.addEventListener("visibilitychange", this.onVisibility);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.resize();
  }

  /** Load the base data and build the scene. Rejects with a readable message. */
  async load(): Promise<void> {
    const [sdf, climateRaw, catalog] = await Promise.all([loadLandSdf(), loadClimate(), loadCatalog()]);
    if (this.disposed) return;
    this.catalog = catalog;
    const climate = dilateClimate(climateRaw);
    const sdfT = sdfTexture(sdf), climT = climateTexture(climate);
    this.baseTex.push(sdfT, climT);

    const c3 = (c: RGB) => new THREE.Vector3(c[0], c[1], c[2]);
    this.uniforms = {
      uSdf: { value: sdfT }, uClimate: { value: climT },
      uBound: { value: this.blank }, uSel: { value: this.blank }, uMask: { value: this.blank }, uTrend: { value: this.blank },
      uBoundOn: { value: 0 }, uHoverId: { value: 0 }, uSelMode: { value: 0 }, uSelId: { value: 0 },
      uMaskBox: { value: new THREE.Vector4(0, 0, 1, 1) },
      uOverlay: { value: 0 }, uTime: { value: 0 }, uLight: { value: new THREE.Vector3(0, 0, 1) },
      uWaterShallow: { value: c3(PLANET.waterShallow) }, uWaterMid: { value: c3(PLANET.waterMid) },
      uWaterDeep: { value: c3(PLANET.waterDeep) }, uWaterPolar: { value: c3(PLANET.waterPolar) },
      uFoam: { value: c3(PLANET.foam) }, uSand: { value: c3(PLANET.sand) }, uDesert: { value: c3(PLANET.desert) },
      uSavanna: { value: c3(PLANET.savanna) }, uDryGrass: { value: c3(PLANET.dryGrass) }, uGrass: { value: c3(PLANET.grass) },
      uLush: { value: c3(PLANET.lush) }, uTundra: { value: c3(PLANET.tundra) }, uSnow: { value: c3(PLANET.snow) },
      uShadow: { value: c3(PLANET.shadow) }, uNoData: { value: c3(PLANET.noData) },
      uLineCol: { value: c3(PLANET.line) }, uSelCol: { value: new THREE.Vector3() }, uSelHalo: { value: new THREE.Vector3() },
      uHoverCol: { value: new THREE.Vector3() },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: planetVertex, fragmentShader: planetFragment, uniforms: this.uniforms });
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 112), mat);
    this.scene.add(this.planet);

    const atmoMat = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertex, fragmentShader: atmosphereFragment, side: THREE.BackSide, transparent: true, depthWrite: false,
      uniforms: { uColor: { value: c3(PLANET.atmosphere) }, uStrength: { value: 0.55 }, uInner: { value: Math.sqrt(1 - 1 / 1.055 ** 2) } },
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.055, 96, 64), atmoMat);
    this.scene.add(this.atmosphere);

    this.scenery = buildScenery(sdf, climate, this.theme.select);
    this.scene.add(this.scenery.props, this.scenery.clouds, this.scenery.pin);

    this.applyTheme();
    if (this.boundaryLayer) void this.setBoundaryLayer(this.boundaryLayer);
    if (this.overlayVar) void this.setOverlay(this.overlayVar);
    if (this.selected) void this.setSelected(this.selected, false);
    this.dirty = true;
    this.kick();
  }

  // ------------------------------------------------------------------ public setters

  setCallbacks(cb: EngineCallbacks) { this.cb = cb; }

  private applyTouchAction() {
    this.canvas.style.touchAction = this.interactive ? "none" : "auto";
  }

  setInteractive(v: boolean) {
    this.interactive = v;
    this.applyTouchAction();
    if (!v) { this.pointers.clear(); this.drag = null; this.pinch = null; this.setHover(null); }
    this.kick();
  }

  setReducedMotion(v: boolean) { this.reduced = v; this.dirty = true; this.kick(); }

  setTheme(t: ThemeColors) {
    this.theme = t;
    this.applyTheme();
    if (this.overlayVar) void this.setOverlay(this.overlayVar);
  }

  private applyTheme() {
    if (!this.uniforms.uSelCol) return;
    const s = this.theme.select;
    (this.uniforms.uSelCol.value as THREE.Vector3).set(...s);
    const halo = luminance(s) > 0.45 ? PLANET.haloDark : PLANET.haloLight;
    (this.uniforms.uSelHalo.value as THREE.Vector3).set(...halo);
    (this.uniforms.uHoverCol.value as THREE.Vector3).set(...this.theme.hover);
    this.scenery?.setPinColor(s);
    this.dirty = true;
    this.kick();
  }

  private async grid(layer: LayerId): Promise<THREE.DataTexture | null> {
    if (this.disposed) return null;
    let t = this.gridTex.get(layer);
    if (!t) {
      const g = await loadGrid(layer);
      if (this.disposed) return null;
      t = this.gridTex.get(layer) ?? gridTexture(g);
      this.gridTex.set(layer, t);
    }
    return t;
  }

  async setBoundaryLayer(layer: LayerId | null) {
    this.boundaryLayer = layer;
    const token = ++this.boundToken;
    this.lastHoverRegion = undefined;
    if (!this.uniforms.uBoundOn) return;
    this.uniforms.uHoverId.value = 0;
    if (!layer) { this.uniforms.uBoundOn.value = 0; this.dirty = true; this.kick(); return; }
    const t = await this.grid(layer);
    if (!t || token !== this.boundToken || this.disposed) return;
    this.uniforms.uBound.value = t;
    this.uniforms.uBoundOn.value = 1;
    this.hoverDirty = true;
    this.dirty = true;
    this.kick();
  }

  async setOverlay(v: VarId | null) {
    this.overlayVar = v;
    const token = ++this.overlayToken;
    if (!this.uniforms.uTrend) return;
    if (!v) { this.onTrend(null); this.kick(); return; }
    const g = await loadTrendGrid(v);
    if (token !== this.overlayToken || this.disposed) return;
    const scale = trendScale(g);
    const tex = trendTexture(g, v, scale, this.theme.diverging);
    this.trendTex?.dispose();
    this.trendTex = tex;
    this.uniforms.uTrend.value = tex;
    this.onTrend({ variable: v, scale });
    this.dirty = true;
    this.kick();
  }

  async setSelected(r: Region | null, moveCamera = true) {
    this.selected = r;
    const token = ++this.selToken;
    if (r && moveCamera) this.flyTo({ lon: r.centroid[0], lat: r.centroid[1], zoom: zoomForRegion(r) });
    if (!this.uniforms.uSelMode) return;
    const pin = this.scenery?.pin;
    if (pin) pin.visible = false;
    if (!r) { this.uniforms.uSelMode.value = 0; this.dirty = true; this.kick(); return; }
    if (r.type === "named") {
      const named = await loadNamedGeo();
      if (token !== this.selToken || this.disposed) return;
      const f = named.find((x) => x.id === r.id);
      if (!f) { this.showPin(r); return; }
      const { texture, box } = namedMaskTexture(f);
      this.maskTex?.dispose();
      this.maskTex = texture;
      this.uniforms.uMask.value = texture;
      (this.uniforms.uMaskBox.value as THREE.Vector4).set(box.west, box.south, box.east, box.north);
      this.uniforms.uSelMode.value = 2;
    } else if (r.gridIndex) {
      const t = await this.grid(r.type);
      if (!t || token !== this.selToken || this.disposed) return;
      this.uniforms.uSel.value = t;
      this.uniforms.uSelId.value = r.gridIndex;
      this.uniforms.uSelMode.value = 1;
    } else {
      this.showPin(r);
    }
    this.dirty = true;
    this.kick();
  }

  private showPin(r: Region) {
    this.uniforms.uSelMode.value = 0;
    const pin = this.scenery?.pin;
    if (!pin) return;
    const n = dirOf(r.centroid[0], r.centroid[1]);
    pin.position.copy(n);
    pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    pin.visible = true;
    this.dirty = true;
    this.kick();
  }

  flyTo(v: View) {
    this.tgt = { lon: v.lon, lat: clamp(v.lat, -LAT_LIMIT, LAT_LIMIT), zoom: clamp(v.zoom, ZOOM_MIN, ZOOM_MAX) };
    this.vel = { lon: 0, lat: 0 };
    if (this.reduced) this.cur = { ...this.tgt };
    this.dirty = true;
    this.kick();
  }

  zoomBy(f: number) { this.flyTo({ ...this.tgt, zoom: this.tgt.zoom * f }); }
  resetView() { this.flyTo(this.home); }
  get view(): View { return { ...this.cur, lon: wrapLon(this.cur.lon) }; }

  /** Keyboard control on the focused wrapper. Returns true when the key was handled. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.interactive) return false;
    const step = 12 / this.tgt.zoom;
    switch (e.key) {
      case "ArrowLeft": this.flyTo({ ...this.tgt, lon: this.tgt.lon - step }); return true;
      case "ArrowRight": this.flyTo({ ...this.tgt, lon: this.tgt.lon + step }); return true;
      case "ArrowUp": this.flyTo({ ...this.tgt, lat: this.tgt.lat + step }); return true;
      case "ArrowDown": this.flyTo({ ...this.tgt, lat: this.tgt.lat - step }); return true;
      case "+": case "=": this.zoomBy(1.35); return true;
      case "-": case "_": this.zoomBy(1 / 1.35); return true;
      case "Home": case "0": this.resetView(); return true;
      case "Enter": case " ": {
        const v = this.tgt;
        this.cb.onPick?.({ lon: wrapLon(v.lon), lat: v.lat, zoom: round2(v.zoom) });
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ geometry helpers

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.width = Math.max(1, Math.round(r.width));
    this.height = Math.max(1, Math.round(r.height));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    const halfV = (FOV / 2) * (Math.PI / 180);
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    // whole planet plus its rim in view at zoom 1
    this.d1 = 1.1 / Math.sin(Math.min(halfV, halfH));
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.kick();
  }

  private altitude(zoom: number) { return (this.d1 - 1) / zoom; }

  /** degrees of arc per screen pixel at the centre of the view */
  private degPerPx() {
    return ((this.altitude(this.cur.zoom) * Math.tan(((FOV / 2) * Math.PI) / 180)) / (this.height / 2)) * (180 / Math.PI);
  }

  private hit(clientX: number, clientY: number): { lon: number; lat: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
    if (!p) return null;
    p.normalize();
    return { lon: (Math.atan2(p.x, p.z) * 180) / Math.PI, lat: (Math.asin(clamp(p.y, -1, 1)) * 180) / Math.PI };
  }

  // ------------------------------------------------------------------ pointer input

  private onPointerDown = (e: PointerEvent) => {
    if (!this.interactive) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.drag = { x: e.clientX, y: e.clientY, moved: false, lastT: performance.now() };
      this.vel = { lon: 0, lat: 0 };
      this.tgt = { ...this.cur };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.tgt.zoom };
      if (this.drag) this.drag.moved = true;
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.interactive) return;
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType !== "touch") { this.hoverPos = { x: e.clientX, y: e.clientY }; this.hoverDirty = true; this.kick(); }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const z = clamp(this.pinch.zoom * (d / Math.max(1, this.pinch.dist)), ZOOM_MIN, ZOOM_MAX);
      this.tgt.zoom = z; this.cur.zoom = z;
      this.dirty = true; this.kick();
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
      drag.moved = true;
      this.onCursor("grabbing");
      this.setHover(null);
    }
    if (!drag.moved) return;
    const k = this.degPerPx();
    const dLon = (-dx * k) / Math.max(Math.cos((this.cur.lat * Math.PI) / 180), 0.35);
    const dLat = dy * k;
    this.cur.lon += dLon;
    this.cur.lat = clamp(this.cur.lat + dLat, -LAT_LIMIT, LAT_LIMIT);
    this.tgt = { ...this.cur };
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT) / 1000;
    drag.lastT = now;
    this.vel = { lon: 0.6 * this.vel.lon + 0.4 * (dLon / dt), lat: 0.6 * this.vel.lat + 0.4 * (dLat / dt) };
    this.dirty = true;
    this.kick();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.canvas.releasePointerCapture?.(e.pointerId);
    if (this.pointers.size >= 1) return;
    const drag = this.drag;
    this.drag = null;
    this.pinch = null;
    this.onCursor("");
    if (!drag) return;
    if (!drag.moved && e.type === "pointerup") {
      const h = this.hit(e.clientX, e.clientY);
      if (h) this.cb.onPick?.({ lon: wrapLon(h.lon), lat: h.lat, zoom: round2(this.cur.zoom) });
    } else if (this.reduced || performance.now() - drag.lastT > 120) {
      this.vel = { lon: 0, lat: 0 };
    }
    if (e.pointerType !== "touch") { this.hoverPos = { x: e.clientX, y: e.clientY }; this.hoverDirty = true; }
    this.kick();
  };

  private onPointerLeave = () => {
    this.hoverPos = null;
    if (!this.drag) this.setHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.interactive) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.tgt.zoom = clamp(this.tgt.zoom * Math.exp(-dy * 0.0016), ZOOM_MIN, ZOOM_MAX);
    if (this.reduced) this.cur.zoom = this.tgt.zoom;
    this.dirty = true;
    this.kick();
  };

  private setHover(h: { lon: number; lat: number; region: Region | null } | null) {
    const id = h?.region?.gridIndex ?? 0;
    if (this.uniforms.uHoverId && this.uniforms.uHoverId.value !== id) { this.uniforms.uHoverId.value = id; this.dirty = true; }
    if (!h) {
      if (this.lastHoverRegion !== null || this.lastHoverSent) this.cb.onHover?.(null);
      this.lastHoverRegion = null;
      this.lastHoverSent = 0;
      this.onCursor("");
      return;
    }
    const now = performance.now();
    if (h.region !== this.lastHoverRegion || now - this.lastHoverSent > 80) {
      this.cb.onHover?.(h);
      this.lastHoverRegion = h.region;
      this.lastHoverSent = now;
    }
  }

  private updateHover() {
    this.hoverDirty = false;
    if (!this.interactive || !this.hoverPos || this.drag || !this.catalog) return;
    const h = this.hit(this.hoverPos.x, this.hoverPos.y);
    if (!h) { this.setHover(null); return; }
    const lon = wrapLon(h.lon);
    let region: Region | null = null;
    const layer = this.boundaryLayer;
    const grid = layer ? this.gridTex.get(layer) : undefined;
    if (layer && grid) {
      const g = (grid.image.data as Uint8Array);
      const i = rasterIndex(lon, h.lat);
      const id = g[i * 2] | (g[i * 2 + 1] << 8);
      region = id ? this.catalog.byGrid[layer][id] ?? null : null;
    }
    const sdf = this.baseTex[0] as THREE.DataTexture;
    const land = (sdf.image.data as Uint8Array)[rasterIndex(lon, h.lat)] > 128;
    this.onCursor(region || land ? "pointer" : "");
    this.setHover({ lon, lat: h.lat, region });
  }

  // ------------------------------------------------------------------ loop

  private onVisibility = () => { this.visible = document.visibilityState !== "hidden"; this.kick(); };

  private get running() { return this.visible && this.onScreen && !this.disposed; }

  private animating() {
    if (!this.reduced && this.planet) return true; // foam, clouds, auto-rotation
    const d = Math.abs(this.cur.lon - this.tgt.lon) + Math.abs(this.cur.lat - this.tgt.lat) + Math.abs(this.cur.zoom - this.tgt.zoom);
    return d > 1e-4 || Math.abs(this.vel.lon) + Math.abs(this.vel.lat) > 0.01 || Math.abs(this.overlayAmt - (this.overlayVar ? 1 : 0)) > 1e-3;
  }

  kick() {
    if (!this.raf && this.running) {
      this.lastT = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.running) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    this.step(dt);
    if (this.hoverDirty) this.updateHover();
    if (this.dirty || this.animating()) { this.render(); this.dirty = false; }
    if (this.animating() || this.dirty) this.raf = requestAnimationFrame(this.frame);
    else this.reportZoom();
  };

  private step(dt: number) {
    const motion = !this.reduced;
    if (motion) this.time += dt;
    if (!this.interactive && motion) this.tgt.lon += dt * 5;
    // inertia
    if (!this.drag && (this.vel.lon || this.vel.lat)) {
      if (!motion) this.vel = { lon: 0, lat: 0 };
      this.tgt.lon += this.vel.lon * dt;
      this.tgt.lat = clamp(this.tgt.lat + this.vel.lat * dt, -LAT_LIMIT, LAT_LIMIT);
      const decay = Math.exp(-dt * 4.5);
      this.vel.lon *= decay; this.vel.lat *= decay;
      if (Math.abs(this.vel.lon) + Math.abs(this.vel.lat) < 0.05) this.vel = { lon: 0, lat: 0 };
    }
    // ease the view toward the target (shortest way round in longitude)
    const k = motion ? 1 - Math.exp(-dt * 5) : 1;
    const dl = wrapLon(this.tgt.lon - this.cur.lon);
    this.cur.lon += dl * k;
    this.tgt.lon = this.cur.lon + dl * (1 - k);
    this.cur.lat += (this.tgt.lat - this.cur.lat) * k;
    this.cur.zoom += (this.tgt.zoom - this.cur.zoom) * k;
    if (Math.abs(this.tgt.zoom - this.cur.zoom) < 1e-4) this.cur.zoom = this.tgt.zoom;
    const ov = this.overlayVar && this.trendTex ? 1 : 0;
    this.overlayAmt = motion ? this.overlayAmt + (ov - this.overlayAmt) * (1 - Math.exp(-dt * 8)) : ov;
    if (Math.abs(this.overlayAmt - ov) < 1e-3) this.overlayAmt = ov;
    if (this.cur.zoom === this.tgt.zoom && !this.drag && !this.pinch) this.reportZoom();
  }

  private reportZoom() {
    const z = round2(this.cur.zoom);
    if (Math.abs(this.cur.zoom - this.tgt.zoom) < 1e-3 && Math.abs(z - this.lastReportedZoom) >= 0.01) {
      this.lastReportedZoom = z;
      this.cb.onZoomChange?.(z);
    }
  }

  private render() {
    if (!this.planet) { this.renderer.clear(); return; }
    const { lon, lat, zoom } = this.cur;
    const dist = 1 + this.altitude(zoom);
    this.camera.position.copy(dirOf(lon, lat, dist));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = Math.max(0.005, this.altitude(zoom) * 0.2);
    this.camera.far = dist + 2;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    // key light from the upper left of the viewer, so the facing hemisphere is lit and the terminator sits at the limb
    const L = new THREE.Vector3(-0.55, 0.6, 0.62).normalize().applyQuaternion(this.camera.quaternion);
    (this.uniforms.uLight.value as THREE.Vector3).copy(L);
    this.light.position.copy(L).multiplyScalar(5);
    this.uniforms.uTime.value = this.time;
    this.uniforms.uOverlay.value = this.overlayAmt;

    const sc = this.scenery;
    if (sc) {
      sc.uniforms.uPropScale.value = Math.pow(zoom, -0.75);
      sc.props.visible = this.overlayAmt < 0.5;
      sc.setCloudFade((1 - smooth(0, 1, this.overlayAmt)) * (1 - smooth(1.6, 2.4, zoom)));
      if (!this.reduced) sc.clouds.rotation.y = this.time * 0.012;
      if (sc.pin.visible) sc.pin.scale.setScalar(0.07 * Math.pow(zoom, -0.75));
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerUp);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    c.removeEventListener("wheel", this.onWheel);
    this.planet?.geometry.dispose();
    this.planet?.material.dispose();
    this.atmosphere?.geometry.dispose();
    this.atmosphere?.material.dispose();
    this.scenery?.dispose();
    for (const t of this.gridTex.values()) t.dispose();
    for (const t of this.baseTex) t.dispose();
    this.trendTex?.dispose();
    this.maskTex?.dispose();
    this.blank.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    c.remove();
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export { LAYERS };
