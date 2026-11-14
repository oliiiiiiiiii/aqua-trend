// Build the browser-ready data bundle in public/data/gen from the repository's
// GLDAS grid package (web/data) and region layers (web/public/data).
//
//   node scripts/prep-data.mjs            rebuild everything
//   node scripts/prep-data.mjs --if-missing   skip when the bundle already exists
//
// Outputs (all little-endian):
//   catalog.json          slim region catalogue with English names + GLDAS cell counts
//   grid_<layer>.rle      0.25° region-id raster per layer, RLE as (count u16, id u16)
//   land_sdf.u8           0.25° signed distance to the coast (128 = coastline, 16 units per pixel)
//   climate.u8            360x180 RGBA: evapotranspiration, snow, air temperature, valid
//   trend_<var>.f32       360x180 x2 planes: Sen slope per year, Mann-Kendall p
//   series/<id>.f32       area-weighted monthly series, 9 variables x N months (NaN = missing)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data");
const PUB = path.join(ROOT, "public", "data");
const OUT = path.join(PUB, "gen");

if (process.argv.includes("--if-missing") && fs.existsSync(path.join(OUT, "catalog.json"))) {
  console.log("[prep] public/data/gen already built - skipping (run `npm run prep` to rebuild)");
  process.exit(0);
}

const t0 = Date.now();
const log = (...a) => console.log(`[prep ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const VARS = ["precip", "et", "p_minus_et", "runoff", "soil_top", "root_zone", "tws", "swe", "tair"];
const GRID_LAYERS = ["basin3", "basin4", "hex", "lme", "sea", "ice"];
const W = 1440, H = 720, PX = 0.25; // region raster: row 0 is the northern edge

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "series"), { recursive: true });

// ---------------------------------------------------------------- inputs
const meta = readJson(path.join(SRC, "meta.json"));
const N = meta.cells.length;
const M = meta.months.length;
const catalogSrc = readJson(path.join(PUB, "catalog", "regions.json"));
const countriesSrc = readJson(path.join(PUB, "catalog", "countries.json"));

// ---------------------------------------------------------------- names
const ISO_EN = {
  AFG: "Afghanistan", AGO: "Angola", ALB: "Albania", ARE: "United Arab Emirates", ARG: "Argentina", ARM: "Armenia",
  ATA: "Antarctica", AUS: "Australia", AUT: "Austria", AZE: "Azerbaijan", BDI: "Burundi", BEL: "Belgium", BEN: "Benin",
  BFA: "Burkina Faso", BGD: "Bangladesh", BGR: "Bulgaria", BHS: "Bahamas", BIH: "Bosnia and Herzegovina", BLR: "Belarus",
  BOL: "Bolivia", BRA: "Brazil", BTN: "Bhutan", BWA: "Botswana", CAF: "Central African Republic", CAN: "Canada",
  CHE: "Switzerland", CHL: "Chile", CHN: "China", CIV: "Côte d'Ivoire", CMR: "Cameroon", COD: "DR Congo", COG: "Congo",
  COL: "Colombia", COM: "Comoros", CRI: "Costa Rica", CUB: "Cuba", CZE: "Czechia", DEU: "Germany", DJI: "Djibouti",
  DNK: "Denmark", DOM: "Dominican Republic", DZA: "Algeria", ECU: "Ecuador", EGY: "Egypt", ERI: "Eritrea", ESP: "Spain",
  EST: "Estonia", ETH: "Ethiopia", FIN: "Finland", FJI: "Fiji", FLK: "Falkland Islands", FRA: "France",
  FRO: "Faroe Islands", FSM: "Micronesia", GAB: "Gabon", GBR: "United Kingdom", GEO: "Georgia", GHA: "Ghana",
  GIN: "Guinea", GMB: "Gambia", GNB: "Guinea-Bissau", GNQ: "Equatorial Guinea", GRC: "Greece", GRL: "Greenland",
  GTM: "Guatemala", GUM: "Guam", GUY: "Guyana", HKG: "Hong Kong", HND: "Honduras", HRV: "Croatia", HTI: "Haiti",
  HUN: "Hungary", IDN: "Indonesia", IND: "India", IRL: "Ireland", IRN: "Iran", IRQ: "Iraq", ISL: "Iceland", ITA: "Italy",
  JAM: "Jamaica", JOR: "Jordan", JPN: "Japan", KAZ: "Kazakhstan", KEN: "Kenya", KGZ: "Kyrgyzstan", KHM: "Cambodia",
  KIR: "Kiribati", KOR: "South Korea", KWT: "Kuwait", LAO: "Laos", LBR: "Liberia", LBY: "Libya", LKA: "Sri Lanka",
  LSO: "Lesotho", LTU: "Lithuania", LVA: "Latvia", MAR: "Morocco", MDA: "Moldova", MDG: "Madagascar", MEX: "Mexico",
  MKD: "North Macedonia", MLI: "Mali", MMR: "Myanmar", MNG: "Mongolia", MNP: "Northern Mariana Islands",
  MOZ: "Mozambique", MRT: "Mauritania", MWI: "Malawi", MYS: "Malaysia", NAM: "Namibia", NCL: "New Caledonia",
  NER: "Niger", NFK: "Norfolk Island", NGA: "Nigeria", NIC: "Nicaragua", NLD: "Netherlands", NOR: "Norway", NPL: "Nepal",
  NZL: "New Zealand", OMN: "Oman", PAK: "Pakistan", PAN: "Panama", PER: "Peru", PHL: "Philippines", PLW: "Palau",
  PNG: "Papua New Guinea", POL: "Poland", PRI: "Puerto Rico", PRK: "North Korea", PRT: "Portugal", PRY: "Paraguay",
  QAT: "Qatar", ROU: "Romania", RUS: "Russia", SAH: "Western Sahara", SAU: "Saudi Arabia", SDN: "Sudan",
  SDS: "South Sudan", SEN: "Senegal", SLB: "Solomon Islands", SLE: "Sierra Leone", SOL: "Somaliland", SOM: "Somalia",
  SRB: "Serbia", STP: "São Tomé and Príncipe", SUR: "Suriname", SVK: "Slovakia", SVN: "Slovenia", SWE: "Sweden",
  SWZ: "Eswatini", SYR: "Syria", TCD: "Chad", TGO: "Togo", THA: "Thailand", TJK: "Tajikistan", TKM: "Turkmenistan",
  TLS: "Timor-Leste", TTO: "Trinidad and Tobago", TUN: "Tunisia", TUR: "Türkiye", TWN: "Taiwan", TZA: "Tanzania",
  UGA: "Uganda", UKR: "Ukraine", URY: "Uruguay", USA: "United States", UZB: "Uzbekistan", VEN: "Venezuela",
  VNM: "Vietnam", VUT: "Vanuatu", YEM: "Yemen", ZAF: "South Africa", ZMB: "Zambia", ZWE: "Zimbabwe",
};
const SEA_EN = {
  "sea-CAR": "Caribbean Sea", "sea-MED": "Mediterranean Sea", "sea-SEA": "Southeast Asian seas",
  "sea-ARO": "Arctic Ocean", "sea-NPO": "North Pacific", "sea-EPO": "Equatorial Pacific", "sea-SPO": "South Pacific",
  "sea-NAO": "North Atlantic", "sea-EAO": "Equatorial Atlantic", "sea-SAO": "South Atlantic", "sea-ARS": "Arabian Sea",
  "sea-BOB": "Bay of Bengal", "sea-EIO": "Equatorial Indian Ocean", "sea-SIO": "South Indian Ocean",
  "sea-SOO": "Southern Ocean", "ice-EAN": "East Antarctic Ice Sheet", "ice-WAN": "West Antarctic Ice Sheet",
};
const zhToEn = new Map();
for (const [iso, v] of Object.entries(countriesSrc)) zhToEn.set(v.zh, ISO_EN[iso] ?? iso);
for (const r of catalogSrc.regions) if (SEA_EN[r.id]) zhToEn.set(r.name, SEA_EN[r.id]);
zhToEn.set("中華人民共和國", "China");
const isAscii = (s) => /^[\x00-\x7f]*$/.test(s);
const fmtLatLon = ([lon, lat]) =>
  `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? "E" : "W"}`;

function englishName(r) {
  const places = (r.countries ?? []).slice(0, 3).map((c) => ISO_EN[c.iso] ?? c.iso);
  const where = places.length ? ` (${places.join(", ")}${(r.countries ?? []).length > 3 ? ", …" : ""})` : "";
  if (SEA_EN[r.id]) return SEA_EN[r.id];
  if (r.type === "basin3" || r.type === "basin4") {
    const river = /^(.+?) 流域（/.exec(r.name)?.[1];
    if (river && isAscii(river)) return `${river} basin${where}`;
    if (r.name.startsWith("島嶼")) return `Island basin ${r.pfaf}${where}`;
    return `Basin ${r.pfaf}${where}`;
  }
  if (r.type === "hex") {
    const m = /^(.+?) 六角格 (\w+)$/.exec(r.name);
    const prefix = m ? (isAscii(m[1]) ? m[1] : zhToEn.get(m[1])) : undefined;
    return `${prefix ?? fmtLatLon(r.centroid)} hex ${m ? m[2] : r.id.slice(-6)}`;
  }
  if (r.id === "named-taiwan-main-island") return "Taiwan main island (coastline)";
  if (r.id === "named-taiwan-island") return "Taiwan window (land + sea rectangle)";
  return isAscii(r.name) ? r.name : `${r.type} ${r.id}`;
}

// ---------------------------------------------------------------- rasterise the layers
function rasterise(features, idOf, grid) {
  for (const f of features) {
    const id = idOf(f);
    if (!id) continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of polys) {
      const rows = new Map(); // row -> x crossings (even-odd across the outer ring and its holes)
      for (const ring of rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          let [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
          if (y1 === y2) continue;
          if (y1 > y2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
          // pixel-centre latitudes within [y1, y2)
          const rTop = Math.max(0, Math.ceil((90 - y2) / PX - 0.5 + 1e-9));
          const rBot = Math.min(H - 1, Math.floor((90 - y1) / PX - 0.5));
          for (let r = rTop; r <= rBot; r++) {
            const lat = 90 - (r + 0.5) * PX;
            if (lat < y1 || lat >= y2) continue;
            const x = x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1);
            let a = rows.get(r);
            if (!a) rows.set(r, (a = []));
            a.push(x);
          }
        }
      }
      for (const [r, xs] of rows) {
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const c0 = Math.max(0, Math.ceil((xs[k] + 180) / PX - 0.5));
          const c1 = Math.min(W - 1, Math.floor((xs[k + 1] + 180) / PX - 0.5));
          for (let c = c0; c <= c1; c++) grid[r * W + c] = id;
        }
      }
    }
  }
}
function rle(grid) {
  const out = [];
  let prev = grid[0], n = 1;
  for (let i = 1; i < grid.length; i++) {
    if (grid[i] === prev && n < 65535) n++;
    else { out.push(n, prev); prev = grid[i]; n = 1; }
  }
  out.push(n, prev);
  return Buffer.from(new Uint16Array(out).buffer);
}

const srcById = new Map(catalogSrc.regions.map((r) => [r.id, r]));
const gridIndex = new Map(); // region id -> 1-based index inside its layer raster
const grids = {};
for (const layer of GRID_LAYERS) {
  const gj = readJson(path.join(PUB, "geo", `${layer}.geojson`));
  const grid = new Uint16Array(W * H);
  let next = 1;
  rasterise(gj.features, (f) => {
    const id = f.properties.id;
    if (!srcById.has(id)) return 0;
    if (!gridIndex.has(id)) gridIndex.set(id, next++);
    return gridIndex.get(id);
  }, grid);
  grids[layer] = grid;
  const buf = rle(grid);
  fs.writeFileSync(path.join(OUT, `grid_${layer}.rle`), buf);
  log(`grid ${layer}: ${gj.features.length} features -> ${(buf.length / 1024).toFixed(0)} kB`);
}

// ---------------------------------------------------------------- coastline distance field
const land = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) land[i] = grids.basin3[i] || grids.basin4[i] || grids.ice[i] ? 1 : 0;
{
  const chamfer = (inside) => {
    const d = new Float32Array(W * H).fill(1e6);
    for (let i = 0; i < W * H; i++) if (!!land[i] !== inside) d[i] = 0;
    const A = 1, B = Math.SQRT2;
    const at = (r, c) => (r < 0 || r >= H ? 1e6 : d[r * W + ((c + W) % W)]);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c;
      d[i] = Math.min(d[i], at(r, c - 1) + A, at(r - 1, c) + A, at(r - 1, c - 1) + B, at(r - 1, c + 1) + B);
    }
    for (let r = H - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) {
      const i = r * W + c;
      d[i] = Math.min(d[i], at(r, c + 1) + A, at(r + 1, c) + A, at(r + 1, c + 1) + B, at(r + 1, c - 1) + B);
    }
    return d;
  };
  const dIn = chamfer(true), dOut = chamfer(false);
  const sdf = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = land[i] ? dIn[i] - 0.5 : -(dOut[i] - 0.5);
    sdf[i] = Math.max(0, Math.min(255, Math.round(128 + v * 16)));
  }
  fs.writeFileSync(path.join(OUT, "land_sdf.u8"), sdf);
  log("land_sdf written");
}

// ---------------------------------------------------------------- GLDAS series
const series = {};
for (const v of VARS) {
  const buf = fs.readFileSync(path.join(SRC, "series", `${v}.i16`));
  if (buf.length !== N * M * 2) throw new Error(`${v}.i16 has unexpected size ${buf.length}`);
  series[v] = new Int16Array(buf.buffer, buf.byteOffset, N * M);
}
const decode = (v, raw) => {
  const m = meta.variables[v];
  return (raw - m.series_bias) * m.series_scale + m.series_offset;
};
const trends = Object.fromEntries(VARS.map((v) => [v, readJson(path.join(SRC, "trends", `${v}.json`))]));
{
  // Byte-order / decoding sanity check against the packaged annual means.
  let worst = 0;
  for (const v of VARS) for (const k of [0, 5000, 12000]) {
    let s = 0, n = 0;
    for (let m = 0; m < 12; m++) { const raw = series[v][k * M + m]; if (raw !== -32768) { s += decode(v, raw); n++; } }
    const ref = trends[v].annual[k]?.[0];
    if (n === 12 && ref != null) worst = Math.max(worst, Math.abs(s / n - ref) / (Math.abs(ref) + 1e-3));
  }
  log(`decode check: worst relative gap vs packaged annual means = ${worst.toExponential(2)}`);
  if (worst > 0.05) throw new Error("Decoded series disagree with trends/*.json - check byte order");
}

// 1° cell k covers a 4x4 block of raster pixels starting at (r0, c0)
const cellR0 = new Int32Array(N), cellC0 = new Int32Array(N);
const cellAt = new Int32Array(360 * 180).fill(-1); // dense 1° lookup, row 0 = 89.5°N
for (let k = 0; k < N; k++) {
  const [lat, lon] = meta.cells[k];
  cellR0[k] = Math.round((90 - (lat + 0.5)) / PX);
  cellC0[k] = Math.round((lon - 0.5 + 180) / PX);
  cellAt[Math.round(89.5 - lat) * 360 + Math.round(lon + 179.5)] = k;
}

/** region id -> Map(cell k -> weight) */
const weights = new Map();
const addW = (id, k, w) => {
  let m = weights.get(id);
  if (!m) weights.set(id, (m = new Map()));
  m.set(k, (m.get(k) ?? 0) + w);
};
for (const layer of GRID_LAYERS) {
  const idOfIndex = [];
  for (const [id, gi] of gridIndex) if (srcById.get(id).type === layer) idOfIndex[gi] = id;
  const grid = grids[layer];
  for (let k = 0; k < N; k++) {
    for (let dr = 0; dr < 4; dr++) {
      const r = cellR0[k] + dr;
      const cosw = Math.cos(((90 - (r + 0.5) * PX) * Math.PI) / 180);
      for (let dc = 0; dc < 4; dc++) {
        const gi = grid[r * W + cellC0[k] + dc];
        if (gi) addW(idOfIndex[gi], k, cosw);
      }
    }
  }
}
// "named" windows overlap each other, so they are sampled directly instead of sharing a raster.
const namedGeo = readJson(path.join(PUB, "geo", "named.geojson"));
const pointInRings = (x, y, rings) => {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
for (const f of namedGeo.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (let k = 0; k < N; k++) {
    const [lat, lon] = meta.cells[k];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      const y = lat - 0.375 + a * 0.25, x = lon - 0.375 + b * 0.25;
      if (polys.some((rings) => pointInRings(x, y, rings))) addW(f.properties.id, k, Math.cos((y * Math.PI) / 180));
    }
  }
}
log(`weights for ${weights.size} regions`);

// ---------------------------------------------------------------- catalogue + per-region series
// ---------------------------------------------------------------- coast share
// Share of a region's boundary (0.25° pixel edges) where land meets sea: 0 inland, 1 for an island.
// Lets the crystal ball draw a shore for coastal regions whose polygon is entirely land.
const coastShare = new Map();
function edgeStats(grid, idOfPixel) {
  const tot = new Map(), coast = new Map();
  for (let r = 1; r < H - 1; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c, g = grid[i];
    if (!g) continue;
    for (const j of [i - W, i + W, r * W + ((c + 1) % W), r * W + ((c + W - 1) % W)]) {
      if (grid[j] === g) continue;
      tot.set(g, (tot.get(g) ?? 0) + 1);
      if (land[i] !== land[j]) coast.set(g, (coast.get(g) ?? 0) + 1);
    }
  }
  for (const [g, n] of tot) { const id = idOfPixel(g); if (id) coastShare.set(id, (coast.get(g) ?? 0) / n); }
}
for (const layer of GRID_LAYERS) {
  const idOfIndex = [];
  for (const [id, gi] of gridIndex) if (srcById.get(id).type === layer) idOfIndex[gi] = id;
  edgeStats(grids[layer], (g) => idOfIndex[g]);
}
{
  const tmp = new Uint16Array(W * H);
  for (const f of namedGeo.features) {
    tmp.fill(0);
    rasterise([f], () => 1, tmp);
    edgeStats(tmp, () => f.properties.id);
  }
}
log(`coast share for ${coastShare.size} regions`);

const out = [];
let nSeries = 0, nFallback = 0;
const sample = {};
for (const r of catalogSrc.regions) {
  let w = weights.get(r.id);
  let fallback = false;
  if (!w && r.surface !== "ocean") {
    // Region smaller than the raster pixel: use the 1° cell that contains its centroid, and say so.
    const [lon, lat] = r.centroid;
    const row = Math.floor(90 - lat), col = Math.floor(lon + 180);
    const k = row >= 0 && row < 180 && col >= 0 && col < 360 ? cellAt[row * 360 + col] : -1;
    if (k >= 0) { w = new Map([[k, 1]]); fallback = true; nFallback++; }
  }
  const entry = {
    id: r.id,
    t: r.type,
    n: englishName(r),
    s: r.surface,
    a: r.area_km2,
    c: r.centroid,
  };
  if (r.bbox) entry.b = r.bbox;
  if (r.countries?.length) entry.iso = r.countries.map((c) => c.iso);
  if (r.parent) entry.p = r.parent;
  if (r.pfaf) entry.pf = r.pfaf;
  if (gridIndex.has(r.id)) entry.g = gridIndex.get(r.id);
  if (r.surface_frac) {
    entry.lf = Math.round((r.surface_frac.land + r.surface_frac.ice) * 100) / 100;
    entry.sf = [r.surface_frac.land, r.surface_frac.ocean, r.surface_frac.ice].map((x) => Math.round(x * 1000) / 1000);
  }
  if (r.snow_frac != null) entry.sn = Math.round(r.snow_frac * 1000) / 1000;
  if (coastShare.has(r.id)) entry.cs = Math.round(coastShare.get(r.id) * 100) / 100;
  if (w) {
    let wsum = 0, equiv = 0;
    for (const [k, x] of w) { wsum += x; equiv += x / (16 * Math.cos((meta.cells[k][0] * Math.PI) / 180)); }
    entry.k = w.size; // 1° GLDAS cells touched
    entry.ke = Math.round(equiv * 10) / 10; // full-cell equivalents inside the boundary
    if (fallback) entry.fb = 1;
    const buf = new Float32Array(VARS.length * M);
    VARS.forEach((v, vi) => {
      const s = series[v];
      for (let m = 0; m < M; m++) {
        let num = 0, den = 0;
        for (const [k, x] of w) {
          const raw = s[k * M + m];
          if (raw !== -32768) { num += x * decode(v, raw); den += x; }
        }
        buf[vi * M + m] = den > 0.5 * wsum ? num / den : NaN;
      }
    });
    fs.writeFileSync(path.join(OUT, "series", `${r.id}.f32`), Buffer.from(buf.buffer));
    nSeries++;
    if (r.type === "basin3") VARS.forEach((v, vi) => {
      let sum = 0, n = 0;
      for (let m = 0; m < M; m++) { const x = buf[vi * M + m]; if (!Number.isNaN(x)) { sum += x; n++; } }
      if (n) (sample[v] ??= []).push(sum / n);
    });
  }
  out.push(entry);
}
const leftover = out.filter((r) => !isAscii(r.n.replace(/[°…ôãéíü]/g, ""))).map((r) => r.n);
if (leftover.length) log(`names still containing non-ASCII text: ${leftover.length}`, leftover.slice(0, 5));

const catalog = {
  dataset: "GLDAS_NOAH10_M 2.1",
  grid: "1.0° monthly",
  months: meta.months,
  vars: VARS,
  raster: { w: W, h: H, px: PX, layers: GRID_LAYERS },
  regions: out,
};
fs.writeFileSync(path.join(OUT, "catalog.json"), JSON.stringify(catalog));
log(`catalog: ${out.length} regions, ${nSeries} with GLDAS series (${nFallback} via containing-cell fallback)`);
for (const v of VARS) {
  const a = sample[v].sort((x, y) => x - y);
  const q = (p) => a[Math.floor(p * (a.length - 1))].toFixed(3);
  log(`  ${v.padEnd(10)} basin means  p02=${q(0.02)} p50=${q(0.5)} p98=${q(0.98)}`);
}

// ---------------------------------------------------------------- globe overlays
for (const v of VARS) {
  const planes = new Float32Array(360 * 180 * 2).fill(NaN);
  const t = trends[v];
  for (let k = 0; k < N; k++) {
    const [lat, lon] = meta.cells[k];
    const i = Math.round(89.5 - lat) * 360 + Math.round(lon + 179.5);
    if (t.sen_per_year[k] != null) planes[i] = t.sen_per_year[k];
    if (t.p_value[k] != null) planes[360 * 180 + i] = t.p_value[k];
  }
  fs.writeFileSync(path.join(OUT, `trend_${v}.f32`), Buffer.from(planes.buffer));
}
{
  const clim = new Uint8Array(360 * 180 * 4);
  const u8 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
  for (let k = 0; k < N; k++) {
    const [lat, lon] = meta.cells[k];
    const i = (Math.round(89.5 - lat) * 360 + Math.round(lon + 179.5)) * 4;
    const et = trends.et.mean[k], swe = trends.swe.mean[k], ta = trends.tair.mean[k];
    if (et == null || ta == null) continue;
    clim[i] = u8(et / 3.5);
    clim[i + 1] = u8((swe ?? 0) / 120);
    clim[i + 2] = u8((ta + 30) / 65);
    clim[i + 3] = 255;
  }
  // Grow valid values outward so bilinear sampling near coasts does not blend with empty cells.
  for (let pass = 0; pass < 6; pass++) {
    const src = clim.slice();
    for (let r = 0; r < 180; r++) for (let c = 0; c < 360; c++) {
      const i = (r * 360 + c) * 4;
      if (src[i + 3]) continue;
      let n = 0; const acc = [0, 0, 0];
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const rr = r + dr; if (rr < 0 || rr >= 180) continue;
        const j = (rr * 360 + ((c + dc + 360) % 360)) * 4;
        if (src[j + 3]) { acc[0] += src[j]; acc[1] += src[j + 1]; acc[2] += src[j + 2]; n++; }
      }
      if (n) { clim[i] = acc[0] / n; clim[i + 1] = acc[1] / n; clim[i + 2] = acc[2] / n; clim[i + 3] = 128; }
    }
  }
  for (let r = 150; r < 180; r++) for (let c = 0; c < 360; c++) { // Antarctica is outside the GLDAS domain
    const i = (r * 360 + c) * 4;
    clim[i] = 0; clim[i + 1] = 255; clim[i + 2] = 0; clim[i + 3] = 128;
  }
  fs.writeFileSync(path.join(OUT, "climate.u8"), clim);
}
const du = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((s, e) => s + (e.isDirectory() ? du(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
log(`done - bundle is ${(du(OUT) / 1e6).toFixed(1)} MB`);
