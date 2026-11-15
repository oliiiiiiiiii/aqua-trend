"use client";

import { useEffect, useRef, useState } from "react";
import { cssVar } from "@/lib/theme";

/**
 * Airplane cursor with a fading contrail.
 * - One fixed, pointer-events:none canvas; the plane is drawn with its nose on the true pointer position
 *   (the hotspot), only its heading is smoothed.
 * - Heading: unit direction vectors sampled every >=4 px of travel are low-passed, then the drawn angle eases
 *   toward it (time-based, shortest way round). Pointer stops -> last heading is kept.
 * - Trail: timestamped points (coalesced pointer events), drawn as smooth quadratic segments that widen and
 *   soften while their alpha fades over LIFE ms. The rAF loop stops itself once everything has settled.
 * - Opt-in: the plane shows only while the pointer is over an element inside `[data-plane-cursor]` (globe, crystal
 *   ball). Elsewhere the native cursor shows and nothing is drawn or tracked. Inside those areas, buttons, links,
 *   inputs and other controls keep the native cursor. The native cursor is hidden through a class on <html>.
 * - Disabled on touch / coarse / no-hover devices. With prefers-reduced-motion: static plane, no trail.
 */

const LIFE = 1200; // ms a trail point lives
const TAIL_X = 29; // distance from the nose to the tail fin in plane units (see HALF)
const TAIL = 30; // plane length in px (nose at origin, body toward -x)
const REST = -Math.PI * 0.75; // nose up-left, like the arrow it replaces
const HIDE_CLASS = "plane-cursor-on";

const AREA_SEL = "[data-plane-cursor]";
// Controls inside an area keep the native cursor (the area's own canvas is not one of them).
const NATIVE_SEL =
  'a[href],button,summary,select,input,textarea,label,[contenteditable]:not([contenteditable="false" i]),[role="button"],[role="link"],[role="tab"],[role="switch"],[role="slider"],[role="menuitem"],[role="option"],[data-cursor="action"]';

const CSS = `
html.${HIDE_CLASS}, html.${HIDE_CLASS} *, html.${HIDE_CLASS} ::backdrop { cursor: none !important; }
/* The canvas is a manual popover so it can sit in the top layer, above modal <dialog>s. */
canvas.plane-cursor-layer { position: fixed; inset: 0; width: 100vw; height: 100vh; margin: 0; padding: 0; border: 0;
  background: transparent; overflow: visible; pointer-events: none; z-index: 2147483000; max-width: none; max-height: none; }
`;

type Pt = { x: number; y: number; t: number; brk: boolean };

// Plane outline (top half), mirrored for the bottom half. Nose at (0,0), pointing +x.
const HALF: [number, number][] = [
  [-3, -3.1], [-11, -3.3], [-18, -13], [-22.5, -13], [-20, -3], [-26, -2.6], [-28, -7], [-31, -7], [-30, 0],
];
function planePath(): Path2D {
  const p = new Path2D();
  p.moveTo(0, 0);
  p.quadraticCurveTo(HALF[0][0], HALF[0][1], HALF[1][0], HALF[1][1]);
  for (let i = 2; i < HALF.length; i++) p.lineTo(HALF[i][0], HALF[i][1]);
  for (let i = HALF.length - 2; i >= 1; i--) p.lineTo(HALF[i][0], -HALF[i][1]);
  p.quadraticCurveTo(HALF[0][0], -HALF[0][1], 0, 0);
  p.closePath();
  return p;
}

export function PlaneCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [enabled, setEnabled] = useState(false);

  // Gate: only for a fine pointer that can hover.
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setEnabled(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const root = document.documentElement;
    const rmq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const shape = planePath();

    let reduced = rmq.matches;
    let dpr = 1, w = 0, h = 0;
    let fill = "#fff", line = "#12233a";
    let x = 0, y = 0, seen = false, active = false;
    let vis = 0, alpha = 0;
    let angle = REST, target = REST;
    let svx = 0, svy = 0, sx = 0, sy = 0; // smoothed direction + last heading sample point
    let brk = true;
    let raf = 0, last = 0;
    const trail: Pt[] = [];
    const recorded = trail; // draw() works on a copy that ends at the tail

    const readColors = () => {
      const night = root.dataset.theme === "night";
      const ink = cssVar("--ink") || "#12233a", paper = cssVar("--paper") || "#fff";
      fill = night ? ink : paper;
      line = night ? paper : ink;
    };
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      kick();
    };
    const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

    const setActive = (on: boolean) => {
      if (on === active) return;
      active = on;
      root.classList.toggle(HIDE_CLASS, on);
      if (!on) { vis = 0; kick(); }
    };

    const addPoint = (px: number, py: number, t: number) => {
      const l = trail[trail.length - 1];
      if (l && !brk && Math.hypot(px - l.x, py - l.y) < 2.5) return;
      trail.push({ x: px, y: py, t, brk });
      brk = false;
      if (trail.length > 600) trail.shift();
    };

    const sample = (px: number, py: number) => {
      const dx = px - sx, dy = py - sy, d = Math.hypot(dx, dy);
      if (d < 4) return; // ignore jitter; keep last heading
      svx = svx * 0.65 + (dx / d) * 0.35; svy = svy * 0.65 + (dy / d) * 0.35;
      sx = px; sy = py;
      if (Math.hypot(svx, svy) > 0.05) target = Math.atan2(svy, svx);
    };

    const onMove = (e: PointerEvent) => {
      const el = e.target as Element | null;
      const show = e.pointerType !== "touch" && !!el?.closest?.(AREA_SEL) && !el.closest(NATIVE_SEL);
      if (!show) {
        // Outside the opt-in areas (or over a control): native cursor, plane fades out, no tracking work.
        if (active || vis) { setActive(false); brk = true; }
        return;
      }
      const now = performance.now();
      const evs = e.getCoalescedEvents?.();
      const list = evs && evs.length ? evs : [e];
      if (!seen) { seen = true; sx = e.clientX; sy = e.clientY; }
      for (const c of list) {
        if (!reduced) addPoint(c.clientX, c.clientY, now);
        sample(c.clientX, c.clientY);
      }
      x = e.clientX; y = e.clientY;
      setActive(true);
      vis = 1;
      kick();
    };
    const onLeave = () => { vis = 0; brk = true; kick(); };
    const onTheme = () => { readColors(); kick(); };
    const onReduce = () => { reduced = rmq.matches; if (reduced) { trail.length = 0; angle = target = REST; } kick(); };

    function frame(now: number) {
      raf = 0;
      const dt = Math.min(50, now - last); last = now;
      const k = (ms: number) => 1 - Math.exp(-dt / ms);
      alpha += (vis - alpha) * k(70);

      let diff = 0;
      if (reduced) angle = REST;
      else {
        diff = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
        angle += diff * k(55);
      }
      while (trail.length && now - trail[0].t > LIFE) trail.shift();
      draw(now);
      const busy =
        trail.length > 1 || Math.abs(diff) > 0.003 || Math.abs(vis - alpha) > 0.01;
      if (busy) raf = requestAnimationFrame(frame);
    }

    function draw(now: number) {
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);
      ctx!.lineCap = "butt"; ctx!.lineJoin = "round";
      // Contrail: runs of points split at breaks, quadratic through midpoints.
      // It leaves from the tail, not the nose: drop the recorded points that still lie under the plane
      // (within one body length of the nose) and end the trail at the tail point of the drawn plane.
      const trail = recorded.slice();
      if (trail.length && seen) {
        const L = TAIL_X;
        const tx = x - L * Math.cos(angle), ty = y - L * Math.sin(angle);
        let cut = trail.length;
        while (cut > 0 && !trail[cut - 1].brk && Math.hypot(trail[cut - 1].x - x, trail[cut - 1].y - y) < L) cut--;
        trail.length = cut;
        if (cut > 0) trail.push({ x: tx, y: ty, t: now, brk: false });
      }
      let i = 0;
      while (i < trail.length) {
        let j = i + 1;
        while (j < trail.length && !trail[j].brk) j++;
        for (let n = i + 1; n < j; n++) {
          const p = trail[n], q = trail[n - 1];
          const a = Math.min(1, (now - p.t) / LIFE);
          const al = Math.pow(1 - a, 1.4);
          const wd = 1.6 + 5.4 * a;
          const m0x = n - 1 > i ? (trail[n - 2].x + q.x) / 2 : q.x, m0y = n - 1 > i ? (trail[n - 2].y + q.y) / 2 : q.y;
          const m1x = n + 1 < j ? (p.x + trail[n + 1].x) / 2 : p.x, m1y = n + 1 < j ? (p.y + trail[n + 1].y) / 2 : p.y;
          ctx!.beginPath();
          ctx!.moveTo(m0x, m0y);
          ctx!.quadraticCurveTo(q.x, q.y, (q.x + p.x) / 2, (q.y + p.y) / 2);
          ctx!.quadraticCurveTo(p.x, p.y, m1x, m1y);
          // faint edge so the white trail still reads on white panels
          ctx!.strokeStyle = line; ctx!.globalAlpha = al * 0.14; ctx!.lineWidth = wd + 2.2; ctx!.stroke();
          ctx!.strokeStyle = fill; ctx!.globalAlpha = al * 0.3; ctx!.lineWidth = wd * 2.2; ctx!.stroke();
          ctx!.globalAlpha = al * 0.95; ctx!.lineWidth = wd; ctx!.stroke();
        }
        i = j;
      }
      // Plane, nose on the pointer.
      if (alpha > 0.01 && seen) {
        ctx!.globalAlpha = alpha;
        ctx!.save();
        ctx!.translate(x, y); ctx!.rotate(angle);
        ctx!.shadowColor = "rgba(10,25,50,0.5)"; ctx!.shadowBlur = 6; ctx!.shadowOffsetY = 1.5;
        // No outline and no hover ring (user request): the soft drop shadow alone separates the plane from light panels.
        ctx!.fillStyle = fill; ctx!.fill(shape);
        ctx!.shadowColor = "transparent";
        ctx!.restore();
      }
      ctx!.globalAlpha = 1;
    }

    readColors();
    resize();
    const mo = new MutationObserver(onTheme);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("pointermove", onMove, { passive: true, capture: true });
    window.addEventListener("pointerdown", onMove, { passive: true, capture: true });
    root.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onLeave);
    window.addEventListener("resize", resize);
    rmq.addEventListener("change", onReduce);
    // Keep the cursor above anything in the top layer (modal dialogs, popovers): whenever one opens,
    // re-show the canvas popover so it becomes the newest, topmost top-layer element.
    const raise = () => {
      const c = canvasRef.current;
      if (!c || typeof c.showPopover !== "function") return;
      try { if (c.matches(":popover-open")) c.hidePopover(); c.showPopover(); } catch { /* not supported */ }
    };
    raise();
    const topMo = new MutationObserver((recs) => {
      if (recs.some((r) => r.target !== canvasRef.current && (r.target as Element).hasAttribute?.("open"))) raise();
    });
    topMo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    const onToggle = (e: Event) => { if (e.target !== canvasRef.current && (e as ToggleEvent).newState === "open") raise(); };
    document.addEventListener("toggle", onToggle, true);

    return () => {
      topMo.disconnect();
      document.removeEventListener("toggle", onToggle, true);
      cancelAnimationFrame(raf);
      mo.disconnect();
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerdown", onMove, { capture: true });
      root.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("resize", resize);
      rmq.removeEventListener("change", onReduce);
      root.classList.remove(HIDE_CLASS);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <>
      <style>{CSS}</style>
      <canvas ref={canvasRef} aria-hidden="true" popover="manual" className="plane-cursor-layer" />
    </>
  );
}
