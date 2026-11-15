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
//   pad  months shown before and after the event, 3-60 (default 12, left out of the URL)
//   tab  the open variable tab (one of v)
// Extension beyond the contract (see encodeState / decodeState):
//   c    Step 1 checkboxes before "Start" (draft), so a reload keeps the user's picks
//
// Also exports the month helpers and `suggestTime`, the regular-expression reader of T from E (SPEC §3 Step 0).
// Workstream D may re-export `suggestTime` from keywords.ts for `SelectResponse.suggestedTime`.
import type { CategoryId, DetectiveQuery, LayerId, RegionId, TimeRange, UrlCodec, YearMonth } from "./contracts";

/** the 12 categories in display order (mirror of the `CategoryId` type) */
export const CATEGORY_IDS = [
  "precip", "et", "soil", "tws", "runoff", "snow", "tair", "vpd", "energy", "wind", "ndvi", "sst",
] as const satisfies readonly CategoryId[];
// compile-time check that CATEGORY_IDS lists every CategoryId
type MissingCategory = Exclude<CategoryId, (typeof CATEGORY_IDS)[number]>;
const exhaustive: [MissingCategory] extends [never] ? true : false = true;
void exhaustive;

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

/* ------------------------------------------------------------------ codec */

/** Everything the page keeps in its URL: the contract's query plus the Step 1 draft. */
export interface DetectiveUrlState {
  query: Partial<DetectiveQuery>;
  /** checkboxes ticked in Step 1 but not started yet (`c`); null when absent */
  draft: CategoryId[] | null;
  /** a `?r=` value that was dropped because it is not a basin4 id, so the page can say why */
  rejectedRegion: string | null;
}

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
  return {
    query: q,
    draft: c === null ? null : parseList(c),
    rejectedRegion: r && !isRegionId(r) ? r : null,
  };
}

export function encodeState(s: { query: Partial<DetectiveQuery>; draft?: CategoryId[] | null }): string {
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

/* ------------------------------------------------------------------ T from E */

const MONTH_WORDS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
// a month name or its abbreviation, not the start of a longer word ("mar" in "marine")
const MONTH_WORD = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\\.?";
const YEAR = "((?:19|20)\\d{2})";
const DASH = "\\s*(?:\\.\\.|[-–—~～至到]|to|through|until|thru)\\s*";
const NOT_DIGIT_BEFORE = "(?<!\\d)";
const NOT_DIGIT_AFTER = "(?!\\d)";

function make(y0: number, m0: number, y1: number, m1: number): TimeRange | null {
  if (![m0, m1].every((m) => m >= 1 && m <= 12)) return null;
  const a = ym(y0, m0), b = ym(y1, m1);
  return ymIndex(a) <= ymIndex(b) ? { start: a, end: b } : null;
}

/** Each reader returns a range or null; the first hit wins, so the most specific patterns come first. */
const READERS: ((s: string) => TimeRange | null)[] = [
  // 2021-02..2021-05, 2021/2 – 2021/5
  (s) => {
    const m = new RegExp(`${NOT_DIGIT_BEFORE}${YEAR}[-/.](\\d{1,2})${DASH}${YEAR}[-/.](\\d{1,2})${NOT_DIGIT_AFTER}`).exec(s);
    return m ? make(+m[1], +m[2], +m[3], +m[4]) : null;
  },
  // 2021 年 2 月到 5 月, 2019 年 9 月至 2020 年 1 月, 2021年2-5月
  (s) => {
    const m = new RegExp(`${NOT_DIGIT_BEFORE}${YEAR}\\s*年\\s*(\\d{1,2})\\s*月?${DASH}(?:${YEAR}\\s*年\\s*)?(\\d{1,2})\\s*月`).exec(s);
    return m ? make(+m[1], +m[2], m[3] ? +m[3] : +m[1], +m[4]) : null;
  },
  // 2021 年 2 月
  (s) => {
    const m = new RegExp(`${NOT_DIGIT_BEFORE}${YEAR}\\s*年\\s*(\\d{1,2})\\s*月`).exec(s);
    return m ? make(+m[1], +m[2], +m[1], +m[2]) : null;
  },
  // Feb 2021 – May 2021, Feb – May 2021, September 2019 to January 2020
  (s) => {
    const m = new RegExp(`\\b${MONTH_WORD}(?:\\s+${YEAR})?${DASH}${MONTH_WORD}\\s+${YEAR}${NOT_DIGIT_AFTER}`, "i").exec(s);
    if (!m) return null;
    const m0 = MONTH_WORDS[m[1].toLowerCase()], m1 = MONTH_WORDS[m[3].toLowerCase()];
    const y1 = +m[4];
    const y0 = m[2] ? +m[2] : m0 <= m1 ? y1 : y1 - 1;
    return make(y0, m0, y1, m1);
  },
  // 2021-05 (one month)
  (s) => {
    const m = new RegExp(`${NOT_DIGIT_BEFORE}${YEAR}[-/](\\d{1,2})${NOT_DIGIT_AFTER}`).exec(s);
    return m ? make(+m[1], +m[2], +m[1], +m[2]) : null;
  },
  // February 2021
  (s) => {
    const m = new RegExp(`\\b${MONTH_WORD}\\s+${YEAR}${NOT_DIGIT_AFTER}`, "i").exec(s);
    return m ? make(+m[2], MONTH_WORDS[m[1].toLowerCase()], +m[2], MONTH_WORDS[m[1].toLowerCase()]) : null;
  },
  // 2019–20, 2019-2020, 2019 to 2021, 2019 至 2020 年 (whole years, at most 10)
  (s) => {
    const m = new RegExp(`${NOT_DIGIT_BEFORE}${YEAR}${DASH}(\\d{4}|\\d{2})${NOT_DIGIT_AFTER}`).exec(s);
    if (!m) return null;
    const y0 = +m[1];
    const y1 = m[2].length === 2 ? Math.floor(y0 / 100) * 100 + +m[2] : +m[2];
    return y1 > y0 && y1 - y0 <= 10 ? make(y0, 1, y1, 12) : null;
  },
  // 2021 (the whole year)
  (s) => {
    const m = new RegExp(`${NOT_DIGIT_BEFORE}${YEAR}${NOT_DIGIT_AFTER}`).exec(s);
    return m ? make(+m[1], 1, +m[1], 12) : null;
  },
];

/**
 * Suggested event period from the event text: "YYYY" or "YYYY 年 M 月" (and ranges of either, ISO and English month
 * names). A year without a month means the whole calendar year. Returns null when the text names no year.
 * The user's choice in the time picker always wins over this suggestion.
 */
export function suggestTime(text: string): TimeRange | null {
  const s = text.normalize("NFKC");
  for (const read of READERS) {
    const r = read(s);
    if (r) return r;
  }
  return null;
}
