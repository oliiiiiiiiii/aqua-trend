# TerraTrend demo site — build spec

Front-end-only demo for the NASA Space Apps 2026 entry "TerraTrend" (challenge: *Be An Earth System Trend
Detective!*). The product brief is `../README.md` (Traditional Chinese, long). This file is the working
contract for everyone building the site. Read it fully before writing code.

## 1. What we are building

A researcher picks a region on a cute 3D planet, chooses up to three water-cycle targets, and gets:

1. a **crystal ball** — a 3D glass eco-sphere whose rain, vapour, soil, snow and runoff are driven by that
   region's monthly data, with history playback;
2. **trend evidence** — time series, rate of change per decade and a significance test, from real NASA GLDAS data;
3. **leads** — recommended associations between the water targets and other NASA variables. The research engine
   does not exist yet, so in this demo **every lead is synthetic** and must say so wherever it appears.

Stack: Next.js 16 (App Router, `app/` directory routes), React 19, TypeScript strict, Tailwind CSS v4, three.js
(plain three, no react-three-fiber), d3-scale / d3-shape / d3-array. Static export (`output: "export"`): no server
code, no route handlers, no server actions, no `next/image` optimisation. English UI only.
Next 16 differs from older versions — check `node_modules/next/dist/docs/` when unsure (see `AGENTS.md`).

## 2. Ground rules for working in this tree

Several people are building in the same directory at the same time.

- **Only create or edit files inside your own work package** (section 7). Everything in `lib/types.ts`,
  `lib/contracts.ts`, `lib/data.ts`, `lib/variables.ts`, `lib/theme.ts`, `app/globals.css`,
  `components/ui/Provenance.tsx`, `scripts/` is shared and read-only. If you believe a shared file is wrong or is
  missing something you need, work around it locally and say so in your final report — do not edit it.
- **Do not** run `npm install`, `next build`, `next dev`, or kill any process. One dev server is already running
  at `http://localhost:3000` with hot reload; use it. If it is down, say so in your report.
- Type-check with `npx tsc --noEmit` and look only at errors in your own files (others' files may be mid-edit).
- Look at your work. `node scripts/shot.mjs <path> <out.png> [--w --h --wait --theme --click --drag --wheel --eval …]`
  takes a headless-Chromium screenshot with WebGL enabled (read the header of that file for options), then open
  the PNG with your image-reading tool. Save screenshots under
  `/tmp/claude-1000/-home-rainple-aqua-trend/49b6efeb-1539-41b6-a162-eca33161bbdd/scratchpad/shots/<your-package>/`.
  Check both themes (`--theme terrarium|night`), a 390 px wide viewport, and that the browser console is
  clean. Headless WebGL is software-rendered and slow; give 3D scenes `--wait 4000` or more.
- Each package has a harness route `app/dev/<package>/page.tsx` for developing in isolation with real data.
- No new dependencies. No external network requests at runtime (fonts come through `next/font`).
- Do not commit. Do not touch git.

## 3. Data you can use (all real, already built)

`lib/data.ts` loads everything; read its doc comments. Summary:

| Loader | Gives you |
| --- | --- |
| `loadCatalog()` | 7,641 regions (`Region` in `lib/types.ts`), `months` (319: 2000-01…2026-07), lookup maps |
| `loadRegionSeries(region, catalog)` | area-weighted monthly series of the nine GLDAS variables for that region, or `null` when the region has no land-model cells (`region.cells` undefined: open ocean, Antarctica) |
| `loadGrid(layer)` | 1440×720 region-id raster for a layer (0.25°, row 0 north, col 0 at 180°W) |
| `loadLandSdf()` | 1440×720 signed distance to the coast (128 = shoreline, >128 land) — sample with linear filtering for a smooth coast |
| `loadClimate()` | 360×180 RGBA: mean ET, mean snow, mean air temperature, validity — for biome colours |
| `loadTrendGrid(v)` | 360×180 Sen slope per year + Mann–Kendall p per 1° cell (packaged, 2000–2025 annual means) |
| `loadNamedGeo()` | polygons of the 42 "named" study windows (41 are rectangles; `named-taiwan-main-island` is a coastline) |
| `pickRegions(lon, lat, zoom)` | point → primary region + overlapping alternatives across all layers |

Variables (`lib/variables.ts`, `VARIABLES`): `precip`, `et`, `p_minus_et`, `runoff`, `soil_top`, `root_zone`,
`tws`, `swe` are selectable water targets (max 3 at once, `MAX_TARGETS`); `tair` is context only. Each has label,
unit, kind (stock / flux / net / temperature), source fields, a `caveat`, a fixed shared `domain`, a colour token,
and `increaseReads` (which way "more" points on a diverging scale).

Everything comes from **one product, GLDAS_NOAH10_M 2.1** (1° monthly, observation-forced land-surface model).
See `DATASET` in `lib/variables.ts`.

Regions worth using in harnesses and as featured picks (all verified to exist):

| id | name | note |
| --- | --- | --- |
| `named-california-central-valley` | California Central Valley | 21 cells |
| `named-sahel` | Sahel | semi-arid, 361 cells |
| `named-high-mountain-asia` | High Mountain Asia | snow |
| `named-indo-gangetic-plain` | Indo-Gangetic Plain | monsoon |
| `named-amazon-deforestation-arc` | Amazon deforestation arc | wet tropics |
| `named-arabian-aquifers-saudi` | Arabian aquifers (Saudi) | desert, no perennial river |
| `named-aral-sea` | Aral Sea | |
| `named-taiwan-main-island` | Taiwan main island (coastline) | only 4 cells (2.6 cell-equivalents): small-region warning |
| `named-greenland` | Greenland | 81 % land/ice, mixed |
| `b3-6030007000` | Amazonas basin | 535 cells |
| `b3-1030034260` | Nile basin | |
| `b3-7030047060` | Missouri basin | |
| `b3-3030009130` | Lena basin | cold, snow |
| `ice-EAN` | East Antarctic Ice Sheet | **no GLDAS data** — the "no data" state |
| `sea-NPO` | North Pacific | ocean; only coastal slivers have land-model data |

## 4. Scientific honesty rules (from the README — these are product requirements, not suggestions)

1. **Provenance is always visible.** Real GLDAS results carry `<Provenance kind="real" />`; anything invented
   carries `<Provenance kind="synthetic" />`; decorative 3D scenery is "illustrative". Never present a synthetic
   number without the synthetic mark in the same panel.
2. **Missing is not zero.** Missing months / no-data regions render grey with a reason. Never draw missing data
   as zero, as drought, or as "flow stopped".
3. **Stocks, fluxes and indirect indicators are different things.** A flux has a direction and a per-time unit;
   a stock is an amount. Do not mix them on one unit-less "water" scale. One y-axis per chart, never dual axes.
4. **Name things exactly.** `tws` is *modelled* soil + snow + canopy storage, not GRACE and not groundwater.
   `precip` is the GLDAS forcing field, not GPM IMERG. `tair` is near-surface *air* temperature, not land-surface
   temperature and not the temperature of the vapour. `runoff` is modelled runoff generation, not streamflow.
   `p_minus_et` is not a storage change. Use each variable's `caveat`.
5. **Trend ≠ association.** The significance of a target's own trend and the significance of its relationship
   with another variable are reported separately.
6. **The real trend numbers are preliminary.** Mann–Kendall on annual means without autocorrelation or
   multiple-testing correction; say so next to the result. Use complete years only (2000–2025); 2026 is partial.
   Sen slope is the rate; the OLS 95 % interval belongs to the OLS slope, do not attach it to the Sen slope.
   Never report a p-value as 0 — use "< 0.001". No percent change for °C or for P − ET (mean near zero).
7. **Regions are analysis boundaries, and layers overlap.** Show the region's type, area and how many 1° GLDAS
   cells actually feed the series (`cells`, `cellEquiv`). If `fallback` is true the region is smaller than the
   grid and the containing cell is shown instead — say so. If `landFrac` is well below 1, only the land part has
   land-model data — say so. 41 of the 42 named windows are rectangles: draw them as rectangles.
8. **Crystal-ball encodings carry a legend.** Every data-driven element names its variable, unit and month.
   Particle *count* (or arrow width) maps to the value on the shared domain; particle *speed* is fixed and means
   nothing. Particles are an encoding, not tracked water. Scenery (hills, trees, cloud shape) is illustrative.
   No river is drawn (there is no river data). Cloud size is never driven by data.
9. **No cause, no forecast.** Lead/lag order is a statistical clue; playback is history, not prediction.
10. **No reliable association is a valid result.** That state keeps the ball and trends and says
    "No reliable association found" — it is never padded with weak results.

## 5. Design direction

The subject is a toy-like low-poly planet and a glass eco-sphere doing serious hydrology. The signature is the
3D pair (planet + ball) floating in a calm sky; everything around them is quiet, legible research furniture.

- Two surfaces. **Stage** = the sky (`bg-stage`, `.stage-sky` gradient, text `text-on-stage` / `text-on-stage-2`,
  hairlines `border-stage-line`). **Paper** = the bench where numbers live (`bg-paper`, insets `bg-well`, text
  `text-ink` / `text-ink-2` / `text-ink-3`, hairlines `border-line`).
- One action colour: `bg-action text-on-action` (hover `bg-action-hover`). Links `text-link`.
- Shape: `rounded-card` for panels, `rounded-ctl` for buttons/chips/inputs (pills).
  `shadow-card` for floating panels.
- Type: `font-display` for headings (Fredoka), `font-sans` for the rest
  (Figtree). Use `.tnum` on numbers that must align. Sentence case everywhere.
- Two themes on `<html data-theme>`: `terrarium` (light) and `night` (dark); the default follows `prefers-color-scheme` until the user picks. **Only use
  the token classes / CSS variables from `app/globals.css`; no raw hex in components**, so both themes work.
  WebGL/canvas code reads colours with `cssVar()` and reacts to `useThemeId()` from `lib/theme.ts`.
  3D canvases have a transparent background so the stage shows through.
- Chart colours: each variable has an identity colour token (`VARIABLES[v].color`, e.g. `--viz-blue`); diverging
  scales use `--viz-cool` / `--viz-warm` around `--viz-mid`; chrome uses `--viz-grid` / `--viz-axis`. Chart text
  wears ink tokens, never the series colour.

Avoid the tells of a generated page: no all-caps tracked eyebrow labels above headings, no "A · B · C" meta
strings, no `→` appended to buttons/links, no monospace for small data labels, no grid of identical cards with
the same shadow, no fade-and-slide-up on every section, no hover animation on everything, no decorative
gradients, no emoji. Numbered markers only for real sequences. Motion only where it means something (the 3D
scenes, playback, a state change the user caused). Respect `prefers-reduced-motion`.

Copy: written for a researcher, plain verbs, sentence case, no selling. Buttons say what happens ("Play history",
"Download CSV"). Errors say what went wrong and what to do. Empty states invite the next action.

Quality floor: responsive from 360 px, keyboard operable with visible focus, sufficient contrast in both
themes, table/text alternatives for every chart and for the globe, playback can be paused.

## 6. Page map (App Router)

| Route | Purpose |
| --- | --- |
| `/` | Landing: the planet as hero, what the tool does, what is real vs synthetic in this demo, featured regions |
| `/explore` | The workspace: globe, region picker, targets, crystal ball, playback, trends, leads. State in the query string (`?region=<id>&targets=precip,et&month=2015-07`) |
| `/data` | Sources: the GLDAS package and its nine variables, region layers, official challenge resources, credits |
| `/methods` | How trends are computed, how the ball encodes data, what is synthetic, known limits |
| `/dev/*` | Harness pages per work package (not linked from the nav) |

## 7. Work packages and file ownership

| Package | Owns | Entry point (contract in `lib/contracts.ts`) |
| --- | --- | --- |
| globe | `components/globe/**`, `app/dev/globe/**` | `components/globe/GlobeCanvas.tsx` default export, `GlobeCanvasProps` |
| orb | `components/orb/**`, `app/dev/orb/**` | `components/orb/CrystalBall.tsx` default export, `CrystalBallProps` |
| evidence | `lib/stats.ts`, `components/evidence/**`, `components/charts/**`, `app/dev/evidence/**` | `components/evidence/TrendPanel.tsx` default export, `TrendPanelProps` |
| leads | `lib/synthetic.ts`, `components/leads/**`, `app/dev/leads/**` | `components/leads/LeadsPanel.tsx` default export, `LeadsPanelProps` |
| shell | `app/**` except `app/dev/**` and `app/globals.css`; `components/shell/**`, `components/explore/**`, `public/` icons | pages + `components/explore/ExploreApp.tsx` |

The four entry-point files currently contain stubs; the owning package replaces them. The shell imports them by
those paths, so keep the default export and the prop names.
