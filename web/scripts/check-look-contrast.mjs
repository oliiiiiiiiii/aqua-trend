// Contrast check for every look x theme.
//   node scripts/check-look-contrast.mjs
// Reads the baseline tokens from app/globals.css and the overrides from app/looks.css, resolves them the way the
// cascade does (baseline of the theme, then `:root[data-look]`, then `:root[data-look][data-theme]`) and prints a
// pass/fail table. Exit code 1 if a required pair fails in a look other than the Terrarium baseline.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** [{ selectors: string[], decls: {--token: value} }] for rules whose selector starts with :root. */
function parse(file) {
  const css = strip(fs.readFileSync(path.join(app, file), "utf8"));
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(",").map((s) => s.trim()).filter((s) => s.startsWith(":root"));
    if (!selectors.length) continue;
    const decls = {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
    rules.push({ selectors, decls });
  }
  return rules;
}
const globals = parse("globals.css");
const looks = parse("looks.css");

const find = (rules, sel) => rules.filter((r) => r.selectors.includes(sel)).map((r) => r.decls);
const merge = (...ds) => Object.assign({}, ...ds.flat());

function tokens(look, theme) {
  const base = merge(find(globals, ":root"), find(globals, ':root[data-theme="terrarium"]'));
  const themed = theme === "night" ? merge(base, find(globals, ':root[data-theme="night"]')) : base;
  if (look === "terrarium") return themed;
  return merge(themed, find(looks, `:root[data-look="${look}"]`), find(looks, `:root[data-look="${look}"][data-theme="${theme}"]`));
}

const hex = (v) => {
  const m = /^#([0-9a-f]{6})$/i.exec(v ?? "");
  if (!m) throw new Error(`not a #rrggbb colour: ${v}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const hue = (v) => {
  const [r, g, b] = hex(v).map((c) => c / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

// [label, foreground token, background token, minimum]
const PAIRS = [
  ["ink / paper", "--ink", "--paper", 4.5],
  ["ink-2 / paper", "--ink-2", "--paper", 4.5],
  ["ink-3 / paper", "--ink-3", "--paper", 4.5],
  ["ink-3 / well", "--ink-3", "--well", 4.5],
  ["link / paper", "--link", "--paper", 4.5],
  ["on-action / action", "--on-action", "--action", 4.5],
  ["on-action / action-hover", "--on-action", "--action-hover", 4.5],
  ["on-stage / stage", "--on-stage", "--stage", 4.5],
  ["on-stage / stage-2", "--on-stage", "--stage-2", 4.5],
  ["on-stage-2 / stage", "--on-stage-2", "--stage", 4.5],
  ["focus / paper (non-text)", "--focus", "--paper", 3],
  ["viz-cool / paper (non-text)", "--viz-cool", "--paper", 3],
  ["viz-warm / paper (non-text)", "--viz-warm", "--paper", 3],
];

const LOOKS = ["minimal", "terrarium", "strip", "console", "atlas"];
let failures = 0;
for (const look of LOOKS) {
  for (const theme of ["terrarium", "night"]) {
    const t = tokens(look, theme);
    console.log(`\n${look} / ${theme === "night" ? "dark" : "light"}${look === "terrarium" ? "  (baseline, informational)" : ""}`);
    for (const [label, fg, bg, min] of PAIRS) {
      const r = ratio(t[fg], t[bg]);
      const ok = r >= min;
      if (!ok && look !== "terrarium") failures++;
      console.log(`  ${ok ? "pass" : look === "terrarium" ? "warn" : "FAIL"}  ${label.padEnd(30)} ${r.toFixed(2).padStart(5)}  (need ${min})  ${t[fg]} on ${t[bg]}`);
    }
    // rules that are not ratios
    // the event band is drawn with --event, which is --action unless the look sets its own
    const event = /^#[0-9a-f]{6}$/i.test(t["--event"] ?? "") ? t["--event"] : t["--action"];
    const h = hue(event);
    const notBlueRed = !(h >= 190 && h <= 260) && !(h >= 345 || h <= 12);
    const differs = event.toLowerCase() !== t["--focus"].toLowerCase();
    for (const [label, ok] of [["event band is not blue/red (hue " + Math.round(h) + ")", notBlueRed], ["focus differs from event band", differs]]) {
      if (!ok && look !== "terrarium") failures++;
      console.log(`  ${ok ? "pass" : "FAIL"}  ${label}`);
    }
  }
}
console.log(failures ? `\n${failures} failure(s)` : "\nall required pairs pass");
process.exit(failures ? 1 : 0);
