// URL state for /detective (workstream C). Implements `UrlCodec` from ./contracts.ts.
//
//   /detective?e=<event>&t=2021-02..2021-05&r=b4-4040046370&v=precip,soil,tws&pad=12&tab=precip
//
// Keys (all optional; junk is dropped, never guessed):
//   e    event text (E)
//   t    event period "YYYY-MM..YYYY-MM" (T); a single "YYYY-MM" means one month
//   r    basin4 sub-basin id (L); only "b4-<digits>" is accepted in the MVP
//   v    analysed categories, written only by "Start"; r + t + v together open the analysis tabs
//   l    non-default layer per category, "precip:p_gpcp,soil:sm_m2"  (DetectiveQuery.layers)
//   pad  months kept out of the baseline either side of the event, 3-60 (default 12, left out of the URL)
//   tab  the open variable tab (one of v)
// Extension beyond the contract (see encodeState / decodeState):
//   c    Step 1 checkboxes before "Start" (draft), so a reload keeps the user's picks
//   sel  the workbench selection "YYYY-MM..YYYY-MM"; left out when it equals the event period (t)
//   test the method of the expanded row of the workbench's Tests table (one of TEST_IDS); absent = no row expanded
//   win  the view window around the event ("2w", "8m", "3y", "all"; lib/detective/window.ts). Left out when it equals
//        the window the URL implies without it: DEFAULT_WINDOW, or for older links that only carry `pad` (which used to
//        set the view too) windowFromPad(pad), so those links still open on the same view.
//
// The time suggestion is shared with the API's keyword selector.
import type { CategoryId, DetectiveQuery, LayerId, RegionId, TimeRange, UrlCodec, YearMonth } from "./contracts";
import { CATEGORY_ORDER } from "./categories";
import { DEFAULT_WINDOW, decodeWindow, encodeWindow, sameWindow, windowFromPad, type ViewWindow } from "./window";

export const CATEGORY_IDS = CATEGORY_ORDER;

export const DEFAULT_PAD = 12;
export const PAD_MIN = 3;
export const PAD_MAX = 60;
const MAX_EVENT_CHARS = 300;

const CATEGORY_SET = new Set<string>(CATEGORY_IDS);
export const isCategory = (s: string): s is CategoryId => CATEGORY_SET.has(s);
export const isRegionId = (s: string): s is RegionId => /^b4-\d+$/.test(s);
const isLayerId = (s: string): s is LayerId => /^[a-z0-9_]{1,40}$/.test(s);

/* ------------------------------------------------------------------ months */

const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isYearMonth = (s: string): s is YearMonth => YM_RE.test(s);
/** "2021-02" -> 2021 * 12 + 1 */
export const ymIndex = (ym: YearMonth): number => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
export const ymFromIndex = (i: number): YearMonth => `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}`;
export const ym = (year: number, month: number): YearMonth => ymFromIndex(year * 12 + month - 1);
export const addMonths = (m: YearMonth, n: number): YearMonth => ymFromIndex(ymIndex(m) + n);
/** number of months in an inclusive range */
export const rangeLength = (r: TimeRange): number => ymIndex(r.end) - ymIndex(r.start) + 1;
export const sameRange = (a: TimeRange | null | undefined, b: TimeRange | null | undefined): boolean =>
  !!a && !!b && a.start === b.start && a.end === b.end;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2021-02" -> "Feb 2021" (fixed English names, no locale-dependent output) */
export const formatYm = (m: YearMonth): string => `${MONTH_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** "Feb – May 2021", "Sep 2019 – Jan 2020", "May 2021", "2021" for a whole calendar year */
export function formatRange(r: TimeRange): string {
  const [y0, m0, y1, m1] = [r.start.slice(0, 4), r.start.slice(5, 7), r.end.slice(0, 4), r.end.slice(5, 7)];
  if (r.start === r.end) return formatYm(r.start);
  if (y0 === y1 && m0 === "01" && m1 === "12") return y0;
  if (y0 === y1) return `${MONTH_SHORT[Number(m0) - 1]} – ${formatYm(r.end)}`;
  if (m0 === "01" && m1 === "12") return `${y0} – ${y1}`;
  return `${formatYm(r.start)} – ${formatYm(r.end)}`;
}

/** "2021-02..2021-05" (or a single "2021-02") -> range; anything else -> null */
export function parseRange(raw: string | null | undefined): TimeRange | null {
  if (!raw) return null;
  const [a, b = a, extra] = raw.trim().split("..");
  if (extra !== undefined || !isYearMonth(a) || !isYearMonth(b)) return null;
  return ymIndex(a) <= ymIndex(b) ? { start: a, end: b } : null;
}
export const encodeRange = (r: TimeRange): string => `${r.start}..${r.end}`;

/** keep known categories once each, in display order */
export function cleanCategories(list: Iterable<string>): CategoryId[] {
  const want = new Set(list);
  return CATEGORY_IDS.filter((c) => want.has(c));
}
const parseList = (raw: string | null): CategoryId[] => (raw ? cleanCategories(raw.split(",").map((s) => s.trim())) : []);

/* ------------------------------------------------------------------ workbench tests (`test`) */

/** Tests of the workbench "Tests" area: the lab's tool ids (lib/detective/lab.ts LAB_TOOLS, same order). */
export const TEST_IDS = [
  "ols", "mk", "piecewise", "permutation", "bootstrap",
  "mean", "wilcoxon", "compare", "variance", "normality", "monthly",
  "cusum", "runs", "extremes", "pettitt",
  "acf", "spectrum",
  "analog", "hmm", "forecast", "discord", "iforest", "bocpd", "gp",
] as const;
export type TestId = (typeof TEST_IDS)[number];
const TEST_SET = new Set<string>(TEST_IDS);
export const isTestId = (s: string): s is TestId => TEST_SET.has(s);

/* ------------------------------------------------------------------ codec */

/** Everything the page keeps in its URL: the contract's query plus the Step 1 draft. */
export interface DetectiveUrlState {
  query: Partial<DetectiveQuery>;
  /** checkboxes ticked in Step 1 but not started yet (`c`); null when absent */
  draft: CategoryId[] | null;
  /** a `?r=` value that was dropped because it is not a basin4 id, so the page can say why */
  rejectedRegion: string | null;
  /** the analysis workbench's selected sub-interval (`sel`); absent when it is the event period */
  selection?: TimeRange;
  /** the method of the expanded Tests row (`test`); absent when no row is expanded */
  test?: TestId;
  /** the view window (`win`) as written; absent when the URL has none (see impliedWindow) */
  window?: ViewWindow;
}

/** The view window a URL without `win` stands for: older links set the view with `pad`. */
export function impliedWindow(padMonths?: number | null): ViewWindow {
  return padMonths != null && padMonths !== DEFAULT_PAD ? windowFromPad(padMonths) : DEFAULT_WINDOW;
}
/** The view window of a decoded URL. */
export const windowOf = (s: Pick<DetectiveUrlState, "query" | "window">): ViewWindow => s.window ?? impliedWindow(s.query.padMonths);

export function decodeState(search: string): DetectiveUrlState {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const q: Partial<DetectiveQuery> = {};

  const e = p.get("e")?.trim();
  if (e) q.event = e.slice(0, MAX_EVENT_CHARS);

  const t = parseRange(p.get("t"));
  if (t) q.time = t;

  const r = p.get("r")?.trim() ?? "";
  if (isRegionId(r)) q.region = r;

  const v = parseList(p.get("v"));
  if (v.length) q.categories = v;

  const layers: Partial<Record<CategoryId, LayerId>> = {};
  for (const pair of (p.get("l") ?? "").split(",")) {
    const [c, l, extra] = pair.split(":").map((s) => s.trim());
    if (extra === undefined && c && l && isCategory(c) && isLayerId(l)) layers[c] = l;
  }
  if (Object.keys(layers).length) q.layers = layers;

  const pad = p.get("pad");
  if (pad && /^\d{1,3}$/.test(pad)) q.padMonths = Math.max(PAD_MIN, Math.min(PAD_MAX, Number(pad)));

  const tab = p.get("tab") ?? "";
  if (isCategory(tab) && (!q.categories || q.categories.includes(tab))) q.active = tab;

  const c = p.get("c");
  const out: DetectiveUrlState = {
    query: q,
    draft: c === null ? null : parseList(c),
    rejectedRegion: r && !isRegionId(r) ? r : null,
  };
  const sel = parseRange(p.get("sel"));
  if (sel && !sameRange(sel, q.time)) out.selection = sel;
  const test = p.get("test")?.trim() ?? "";
  if (isTestId(test)) out.test = test;
  const win = decodeWindow(p.get("win"));
  if (win) out.window = win;
  return out;
}

export function encodeState(s: {
  query: Partial<DetectiveQuery>; draft?: CategoryId[] | null; selection?: TimeRange | null; test?: TestId | null; window?: ViewWindow | null;
}): string {
  const q = s.query;
  const p = new URLSearchParams();
  const e = q.event?.trim();
  if (e) p.set("e", e.slice(0, MAX_EVENT_CHARS));
  if (q.time && parseRange(encodeRange(q.time))) p.set("t", encodeRange(q.time));
  if (q.region && isRegionId(q.region)) p.set("r", q.region);
  const v = cleanCategories(q.categories ?? []);
  if (v.length) p.set("v", v.join(","));
  const layers = Object.entries(q.layers ?? {})
    .filter((kv): kv is [CategoryId, LayerId] => isCategory(kv[0]) && typeof kv[1] === "string" && isLayerId(kv[1]))
    .filter(([c]) => !v.length || v.includes(c))
    .sort(([a], [b]) => CATEGORY_IDS.indexOf(a) - CATEGORY_IDS.indexOf(b));
  if (layers.length) p.set("l", layers.map(([c, l]) => `${c}:${l}`).join(","));
  if (q.padMonths != null && q.padMonths !== DEFAULT_PAD) {
    p.set("pad", String(Math.max(PAD_MIN, Math.min(PAD_MAX, Math.round(q.padMonths)))));
  }
  if (q.active && v.includes(q.active)) p.set("tab", q.active);
  if (s.selection && parseRange(encodeRange(s.selection)) && !sameRange(s.selection, q.time)) p.set("sel", encodeRange(s.selection));
  if (s.test && isTestId(s.test)) p.set("test", s.test);
  if (s.window && !sameWindow(s.window, impliedWindow(q.padMonths))) p.set("win", encodeWindow(s.window));
  if (s.draft) p.set("c", cleanCategories(s.draft).join(","));
  // commas, colons and dots stay readable in shared links
  return p.toString().replace(/%2C/gi, ",").replace(/%3A/gi, ":");
}

/** `UrlCodec` from contracts.ts. `decodeQuery` ignores the Step 1 draft (`c`). */
export const urlCodec: UrlCodec = {
  encodeQuery: (q) => encodeState({ query: q }),
  decodeQuery: (search) => decodeState(search).query,
};
export const { encodeQuery, decodeQuery } = urlCodec;

export { suggestedTime as suggestTime } from "./keywords";
