# Aqua Trend — web front-end

Next.js (App Router) site, built as a **static export** (`next.config.ts`: `output: "export"`). Read
`AGENTS.md` before changing code: this Next.js version differs from older ones.

| Route | What it is |
| --- | --- |
| `/research` | **The main tool.** Describe a phenomenon, choose one region and an optional period, read trends, uncertainty, corrected significance, standard indicators and the evidence record. Needs the analysis backend. |
| `/explore` | The earlier GLDAS demo, kept for reference and labelled as such. Its leads are synthetic examples and its trends use their own method and period. Works without the backend. |
| `/concepts`, `/methods`, `/data` | Background pages. |

## Run the front-end and the backend together

The research page shows only numbers computed by the backend. There is no mock and no offline fallback: when
the backend is not reachable the page says so, keeps what you entered and offers a retry.

```bash
# 1. backend (Python >= 3.11, see ../backend/README.md for install and options)
cd backend
AQUA_SELECTOR=catalogue_lexical .venv/bin/python -m aqua_trend      # http://127.0.0.1:8000

# 2. front-end, development
cd web
npm install
npm run dev                                                         # http://localhost:3000/research
```

`AQUA_SELECTOR=catalogue_lexical` is the explicit offline variable selector. It is a deterministic catalogue
matcher, not a language model, and every result says so. With a language model configured
(`ANTHROPIC_API_KEY`, or `AQUA_SELECTOR=claude_cli`) leave it out. Without any selector the backend answers
`503 selector_unavailable` and the page shows that error.

### Configuration

Copy `.env.example` to `.env.local` to change it.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8000` | Base URL of the backend. Baked into the bundle at build time. |

The backend only accepts browser calls from the origins in `AQUA_CORS_ORIGINS` (default: `localhost` and
`127.0.0.1` on ports 3000, 3001 and 5000). Serve the site from one of them or set that variable on the backend.

### Static build

```bash
cd web
npm run typecheck
npm run build            # writes ./out
npx serve out -l 3000    # any static file server works; keep trailing-slash URLs (/research/)
```

`npm run prep` regenerates the bundled demo data for `/explore` (it runs automatically when the data is missing).

## How the research page is put together

```
app/research/page.tsx            static shell; everything dynamic is in the client component
components/research/
  ResearchApp.tsx                layout: inputs -> progress and results -> globe (results before the globe on phones)
  useResearch.ts                 form, job and URL state; only the current job may update the page
  InputPanel, RegionFinder       phenomenon text, one region (globe or search), optional period
  ProgressPanel                  eight stages, cancel, failed / partial / cancelled / unreachable states
  ConditionsPanel                region and period with "You chose" / "Suggested preset", preset reasons and
                                 score, common comparison period, fixed reference periods, selector information
  ResultPanels                   summary, variable set by role, notes and shortfalls
  TimeControls                   view range, cursor and "Apply as analysis period"
  VariableCard, TrendBlock       product decision, periods, three linked charts, trend numbers, test details
  HistoryChart, CycleChart       charts (gaps are breaks, never zero); SeriesTable is the numeric alternative
  IndicatorPanel                 derived indicators and recorded events, tagged apart, with data states
  EvidencePanel                  comparison families, versions, JSON / CSV export
lib/research/
  types.ts                       TypeScript mirror of backend/aqua_trend/contracts.py
  api.ts                         API client: typed errors, AbortController, polling with backoff
  format.ts                      labels and number formatting only
```

Rules the page keeps:

- The browser never computes a slope, a confidence interval, a p-value or a significance label. Selecting a
  range on a chart and pressing "Apply as analysis period" sends a **new** research request with that range as
  the user's period (`context.parent_research_id` set, `preset_ref` cleared); the backend recomputes everything.
- `region_id` and `period` in a request are only what the user picked with the selectors. A value suggested by a
  preset is shown with its source and becomes a user value only after "Keep this … as my choice" (or the
  "keep region" box when applying a selected period).
- Place names and dates typed into the phenomenon box do not set the region or the period.
- The view range, the cursor and the analysis period are three separate states.
- "Undetermined" (no valid test) is never worded as "not significant". A status such as "data not delivered yet"
  is shown as a state, never as zero events.
- The crystal ball is not used on this page: its channels are water-cycle imagery and an arbitrary phenomenon
  must not be mapped onto it.

URL state: `q`, `region`, `from`, `to`, `id` (research id; reloading the link reopens the stored result) and
`preset` (`<preset id>@<version>`, opens a preset).

## End-to-end check

`scripts/e2e-research.mjs` drives the built site in a real browser against a running backend. It never fakes
the backend's numbers; it only forwards, delays or blocks real requests.

```bash
cd web
npm run build
npx playwright-core install firefox        # once; the system Firefox cannot be driven by playwright-core
(cd ../backend && AQUA_SELECTOR=catalogue_lexical .venv/bin/python -m aqua_trend) &
node scripts/e2e-research.mjs              # screenshots in ./test-results (git-ignored)
```

Scenarios: both fields filled, indicators and export, a period selected on a chart and applied, keyboard
selection, region only, nothing filled, invalid period, stale responses, cancel, backend down and retry, a
region without prepared series, mobile layout, navigation and the labelled old demo. Options
(`E2E_API_BASE`, `E2E_PORT`, `E2E_ONLY`, …) are described at the top of the script.
