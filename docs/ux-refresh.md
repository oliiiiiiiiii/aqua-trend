# /detective UI/UX refresh — design brief

Branch `ui/ux-refresh`. Scope: the `/detective` route only. Visual language stays the web-demo
one (tokens in `web/app/globals.css`, Fredoka display, Figtree body, `rounded-card` / `rounded-ctl`,
terrarium + night themes). This refresh changes layout, hierarchy, interaction and copy — not the
identity. Use the existing Tailwind token names (`bg-paper`, `text-ink-2`, …); never raw hex.

## Who uses it and for what

A researcher (or a science student) already knows one extreme event: what, when, where. They want
to know whether that event lines up with unusual behaviour of other Earth-system variables **before,
during or after** it — e.g. a temperature drop after volcanic aerosol, or a drought preceded by
months of low rainfall. For each suggested variable we show the anomaly (seasonal cycle and long-term
trend removed) in a window around the event. The user drags a sub-interval and reads whether the
departure from baseline there is statistically significant.

The old page answered this with one variable per tab, a paragraph of instructions and a sentence of
results. It is hard to compare variables, the selection tool is hidden behind Shift-drag, and the
statistics a researcher looks for are either missing or buried.

## Principles

1. **The selection is always there.** It starts on the event period. Its handles, the grab cursor and
   three preset buttons (Before · Event · After) teach the interaction; there is no instruction text.
   The statistics panel is therefore never empty.
2. **One time axis, one selection, every variable.** Variables are stacked lanes sharing the x axis
   and the selection, so leads and lags are read by eye and compared in one table column.
3. **Statistics in order of importance** (see below). Verdict first, method last.
4. **Few words.** Labels are one to three words. Sentences appear only in the verdict line and in
   data caveats. Definitions and methods live behind an info popover or a collapsed section.
5. **English on `/detective`.** The rest of the site shell is English; the mixed Chinese/English
   chart copy goes. Event text typed by the user is shown as typed. Use `CATEGORIES[c].name.en` /
   `.definition.en`.
6. **Colour polarity follows meaning.** "More water" reads cool, "less water / hotter / more fire"
   reads warm — not "above normal is always red". See `anomalyPolarity` below.
7. **Significant ≠ caused.** The UI says an interval is *unusual*; it never says the event caused it.
   One short line near the verdict: "Timing match, not proof of cause."

## Analysis workbench layout (desktop ≥ 1024 px)

```
┌ stage header ────────────────────────────────────────────────────────────────────┐
│ ‹ Edit    2021 Taiwan spring drought     Feb – May 2021    Taiwan basin    Share │
└──────────────────────────────────────────────────────────────────────────────────┘
┌ toolbar (paper, sticky) ─────────────────────────────────────────────────────────┐
│ Selection [Before][Event][After]  Nov 2020 – Jan 2021 · 3 mo · ends 1 mo before  │
│                                             Window [±6][±12][±24][All]   Sort ▾  │
└──────────────────────────────────────────────────────────────────────────────────┘
┌ lanes (shared x axis on top; event band and selection run through every lane) ───┐
│ Precipitation        │ ▁▂▁▃▅▂▁ anomaly strip, ±2σ guides │ −1.8σ   p 0.03   ●   │
│ GPM IMERG · mm/day   │                                    │                      │
├──────────────────────┴────────────────────────────────────┴──────────────────────┤
│ ▾ Soil moisture   GLDAS Noah 2.1 · mm                       [product ▾]          │
│ ┌ crystal ball ┐ ┌ chart: [Anomaly][Observed][Seasonal][Trend] ───────────────┐  │
│ │  May 2021    │ │  bars, ±1σ/±2σ, event band, selection with handles         │  │
│ │ [Obs][Normal]│ │                                                            │  │
│ └──────────────┘ └────────────────────────────────────────────────────────────┘  │
│ ┌ statistics for the selection ───────────────────────────────────────────────┐  │
│ │ ● Unusually low — both tests agree.              Timing match, not proof…   │  │
│ │ Mean anomaly      Standardised     Significance     Rank                    │  │
│ │ −31 mm (−8 %)     −1.7 σ           p = 0.03         2nd lowest of 24        │  │
│ │ 95 % CI −50…−12                    3 of 290 windows  Feb–May periods        │  │
│ │ Peak May 2021 −2.6σ · 2 of 4 months beyond 2σ · 4 of 4 below normal · n = 4 │  │
│ │ ▸ Long-term trend  −5.3 mm/decade, p = 0.07, not significant                │  │
│ │ ▸ Baseline and method                                                       │  │
│ └─────────────────────────────────────────────────────────────────────────────┘  │
├───────────────────────────────────────────────────────────────────────────────────┤
│ Terrestrial water storage │ strip …                        │ −1.3σ  p 0.21  ○    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- Exactly one lane is expanded (the URL `tab`). Clicking a collapsed lane expands it.
- Collapsed lanes are ~64 px tall: name + product/unit, the anomaly strip, and three numbers for the
  current selection (mean z, p, verdict mark). The lane list is the comparison table.
- Phones: lane header, strip and numbers stack; in the expanded lane the ball sits above the chart.

## Interaction

| Gesture | Result |
| --- | --- |
| Drag on empty chart/strip | new selection |
| Drag a selection edge (handle) | resize |
| Drag inside the selection | move it |
| Before / Event / After | selection = window start … event start − 1 / the event / event end + 1 … window end |
| Hover | crosshair on every lane + tooltip; the crystal ball shows that month |
| Window ±6 / ±12 / ±24 / All | months shown either side of the event (this is the URL `pad`, which also sets the baseline exclusion; "All" shows the full record without changing `pad`) |
| ← → on a focused chart | move selection one month; Shift + ← → resize; Esc = back to the event |

No wheel zoom (it hijacks page scroll). The selection is shared by all lanes and stored in the URL
as `sel=YYYY-MM..YYYY-MM` (omitted when it equals the event).

## Statistics, by importance

All from `web/lib/detective/intervalDetail.ts` (`intervalDetail`, `baselineInfo`, `relationToEvent`)
plus the existing `trendStats`.

| Tier | Shown | Field |
| --- | --- | --- |
| 1 Verdict | "Unusually low / high" · "Tests disagree" · "Within normal variability" · "Not enough data", with a status mark (never colour alone) | `verdict`, `direction` |
| 1 Effect | mean anomaly in units, % of normal when meaningful, 95 % CI | `meanAnomaly`, `percentOfNormal`, `ci95` |
| 1 Standardised | mean z in σ | `meanZ` |
| 1 Significance | p (AR(1)-adjusted z test); under it "k of N baseline windows as extreme" | `test.p`, `empirical` |
| 1 Rank | "2nd lowest of 24 Feb–May periods" | `seasonRank` |
| 2 Shape | peak month and z; months beyond 2σ; share with the same sign; n and missing months; position relative to the event | `peak`, `beyond2Sigma`, `signConsistency`, `n`/`months`, `relationToEvent` |
| 3 Trend (official challenge requirement, one line + expandable) | Sen slope per decade, 95 % CI, Mann–Kendall p, significant or not, years of data still needed | `TrendStats` |
| 3 Method (collapsed) | baseline period and n, σ, lag-1 autocorrelation, effective n, what was removed, a note that p values for hand-picked intervals are exploratory | `BaselineInfo`, `test.nEff` |

Number formatting: `num`, `pValue`, `pct` in `components/detective/format.ts`; tabular numerals
(`tnum`); a real minus sign.

## Colour

- Diverging anomaly fill: `--viz-cool` / `--viz-warm`, chosen by `anomalyPolarity(category)`:
  high reads **cool** for `precip, et, soil, tws, runoff, snow, vapor, ndvi`;
  high reads **warm** for `tair, vpd, energy, sst, aod, fire, so2`; `wind, ozone` high = warm (arbitrary, stated in the legend).
  The legend always spells out "above normal / below normal" next to the swatches.
- Event band: `--action` at low opacity with a solid top edge and the word "Event".
- Selection: `--focus` outline, light fill, visible handles (≥ 8 px wide hit area ≥ 24 px).
- Text never wears the series colour. Status marks ship with a label.
- Missing months: hatched/tinted column, never zero, never bridged.

## Crystal ball

The expanded lane shows the web-demo crystal ball for the month under the cursor (default: the peak
month of the selection). Variables the ball already draws (rain, vapour, runoff, soil water, snow,
storage, temperature) drive their channel; every other variable gets a generic gauge beside the ball
(value against its normal for that month and its record range). A two-way switch shows
"Observed" or "Normal for this month", so the anomaly is visible as a change in the ball.
SPEC §7 excluded the ball from the detective page; this brief reverses that at the product owner's request.
