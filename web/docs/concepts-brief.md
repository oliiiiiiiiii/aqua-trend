# UI-direction concepts — shared brief

The user wants to compare **whole-interface style directions** (layout, typography, colour, shape, motion,
tone of the chrome) before committing. The current design ("Terrarium", `/explore`) stays as option A. You build
one alternative direction as a self-contained route that a person can click through with real data.

## What each concept must contain

Route `app/concepts/<slug>/page.tsx` (one page, client component inside a Suspense boundary is fine) that shows:

1. **A landing moment** at the top or as the empty state: how this direction would greet a researcher (headline,
   one or two sentences, the planet `GlobeCanvas interactive={false}` or another treatment, one primary action).
2. **The workspace with a region selected**, built on `useExploreState()` from
   `components/explore/useExploreState.ts` (read its `ExploreState` interface — it owns catalogue, URL sync of
   `?region=&targets=&month=`, series, playback, targets, colour-by, overlay, picker open/close, picking). Use the
   real `CrystalBall` (`components/orb/CrystalBall.tsx`; `showLegend={false}` plus your own read-out is allowed —
   reuse `components/orb/encoding.ts` exports for mapping text, as `components/explore/OrbReadout.tsx` does),
   the real `GlobeCanvas` for choosing regions (in whatever form suits the direction), and a playback control,
   target toggles (max 3) and the colour-vapour-by-temperature toggle. The same laptop rule as the main design
   applies: at 1440×900 the ball, its values, the playback control and the target toggles are visible together
   without scrolling. Changing region is a pop-up / overlay / drawer.
3. Below or beside it, `TrendPanel` and `LeadsPanel` (real components) restyled only through CSS variables.
   Mounting both is enough; they do not need bespoke layouts.

The URL query string works the same as `/explore`, so `/concepts/<slug>?region=named-sahel&targets=precip,et,soil_top&month=2012-08`
opens straight into the workspace.

## Rules

- **Files you own**: `app/concepts/<slug>/**` and `components/concepts/<slug>/**` only. Do not edit any shared
  file or other component (`components/explore/**`, `components/orb/**`, `components/globe/**`, `lib/**`,
  `app/globals.css`, `app/layout.tsx`, …). Reuse the presentational components in `components/explore/` when they
  fit (they take props), or write your own under your folder.
- **Restyle by scoping tokens**: wrap your route in an element with your own class/`data-concept` attribute and
  redefine the design tokens from `app/globals.css` (`--stage`, `--paper`, `--ink`, `--action`, `--r-card`,
  `--font-display-active`, `--viz-*` …) in a CSS file next to your page (`app/concepts/<slug>/concept.css`,
  imported by the page). The shared components read those variables, so they re-skin automatically. Provide both
  a light and a dark version keyed off `:root[data-theme="terrarium"]` / `:root[data-theme="night"]` ancestors
  (the header toggle switches `data-theme` on `<html>`). Keep data colours accessible (check contrast by eye at least).
- Fonts: load at most two families with `next/font/google` in your page file and set them on your wrapper.
  Pick faces that fit the direction; avoid defaulting to Inter/Roboto/Space Grotesk.
- The site header, footer and airplane cursor stay as they are (they come from the root layout).
- Honesty rules from `docs/build-spec.md` section 4 still hold: provenance badges (real / synthetic /
  illustrative) visible, missing ≠ zero, units and caveats shown.
- Avoid generic AI-page tells listed in `docs/build-spec.md` section 5 (all-caps eyebrows, "A · B · C" meta
  strings, `→` on buttons, identical card grids, decorative gradients, emoji). Spend boldness in one place.
- Responsive to 390 px (it can stack), keyboard operable, `prefers-reduced-motion` respected.
- Work economically: read only what you need, at most ~6 screenshots, no open-ended polish loops. Dev server is
  running at http://localhost:3000; screenshot helper `node scripts/shot.mjs` (read its header). Save shots under
  `/tmp/claude-1000/-home-rainple-aqua-trend/49b6efeb-1539-41b6-a162-eca33161bbdd/scratchpad/shots/concepts/<slug>/`.
  Don't touch git, don't npm install, don't start/stop servers. `npx tsc --noEmit` clean for your files.

## Report back

Two or three sentences on the direction's idea, the token choices (palette hexes, fonts, shape), the files, and
the paths of 3 screenshots: landing at 1440×900, workspace (Sahel) at 1440×900 light, workspace dark or 390 px.
