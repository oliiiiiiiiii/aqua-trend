// Batch questions: read a CSV with one event per row (format: /docs/batch-questions.md) and write the answers back
// out as a CSV. Pure, no DOM: run under `npx tsx --test lib/detective/batchCsv.test.ts`.
//
//   question,time,region,variables,pad
//   2021 Taiwan spring drought,2021-02..2021-05,b4-4040046370,precip;soil;tws;ndvi,
//   2022 Pakistan floods,2022-07..2022-09,Indus,,
//   Heatwave in the Yangtze basin in August 2022,,,,
//
// Only `question` is required. An empty cell means "work it out": the period and the place are read from the
// question text, the variables are suggested exactly as on the input page. Nothing is guessed silently: a row that
// cannot be completed keeps a problem code and is skipped, and the page says why.
import type { CategoryId, TimeRange } from "./contracts";
import type { IntervalDetail } from "./intervalDetail";
import { CATEGORIES, CATEGORY_ORDER } from "./categories";
import { suggestedTime } from "./keywords";
import { DEFAULT_PAD, PAD_MAX, PAD_MIN, encodeRange, isYearMonth, parseRange } from "./url";

export const BATCH_MAX_ROWS = 200;
/** characters; a larger file is refused before parsing */
export const BATCH_MAX_CHARS = 1_000_000;
const MAX_QUESTION_CHARS = 300;

/* ------------------------------------------------------------------ CSV */

export type Delimiter = "," | ";" | "\t";

export interface CsvTable {
  delimiter: Delimiter;
  /** the first record */
  header: string[];
  /** every later record that has at least one non-empty cell; `line` is the 1-based line it starts on */
  rows: { line: number; cells: string[] }[];
  /** line of a quoted cell that is never closed (the rest of the file was read into it); null when all close */
  unclosedQuoteLine: number | null;
}

/** The delimiter of the first data line: whichever of comma, semicolon and tab occurs most outside quotes. */
function detectDelimiter(text: string): Delimiter {
  const first = text.split(/\r\n|\n|\r/).find((l) => l.trim() && !l.trimStart().startsWith("#")) ?? "";
  const count: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of first) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) count[ch]++;
  }
  return count["\t"] > count[","] && count["\t"] >= count[";"] ? "\t" : count[";"] > count[","] ? ";" : ",";
}

/**
 * RFC 4180 with the usual tolerances: a UTF-8 byte-order mark, CRLF / LF / CR line ends, quoted cells with doubled
 * quotes and line breaks inside, blank lines and lines starting with `#` (comments) skipped, cells trimmed.
 */
export function parseCsv(text: string): CsvTable {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(src);
  const records: { line: number; cells: string[] }[] = [];
  let unclosedQuoteLine: number | null = null;
  let i = 0, line = 1;
  const n = src.length;
  const newlineAt = (k: number) => (src[k] === "\r" && src[k + 1] === "\n" ? 2 : src[k] === "\n" || src[k] === "\r" ? 1 : 0);

  while (i < n) {
    // a comment line: skipped whole
    if (src[i] === "#") {
      while (i < n && !newlineAt(i)) i++;
      i += newlineAt(i);
      line++;
      continue;
    }
    const start = line;
    const cells: string[] = [];
    let cell = "";
    let ended = false;
    while (!ended) {
      // one cell
      let k = i;
      while (k < n && (src[k] === " " || (src[k] === "\t" && delimiter !== "\t"))) k++;
      if (src[k] === '"') {
        const quoteLine = line;
        i = k + 1;
        let closed = false;
        while (i < n) {
          if (src[i] === '"') {
            if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
            i++; closed = true; break;
          }
          const nl = newlineAt(i);
          if (nl) { cell += "\n"; i += nl; line++; continue; }
          cell += src[i++];
        }
        if (!closed && unclosedQuoteLine === null) unclosedQuoteLine = quoteLine;
      }
      // the rest of the cell up to the delimiter or the line end (anything after a closing quote is kept as typed)
      while (i < n && src[i] !== delimiter && !newlineAt(i)) cell += src[i++];
      cells.push(cell.trim());
      cell = "";
      if (i >= n) ended = true;
      else if (src[i] === delimiter) { i++; if (i >= n) { cells.push(""); ended = true; } }
      else { i += newlineAt(i); line++; ended = true; }
    }
    if (cells.some((c) => c !== "")) records.push({ line: start, cells });
  }
  const [head, ...rows] = records;
  return { delimiter, header: head?.cells ?? [], rows, unclosedQuoteLine };
}

/** One CSV cell: quoted when it holds a delimiter, a quote, a line break or a leading `#`; empty for null / NaN. */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = typeof v === "number" ? String(Number(v.toPrecision(6))) : v;
  return /[",;\t\r\n]|^#/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ------------------------------------------------------------------ columns */

export type BatchColumn = "question" | "time" | "start" | "end" | "region" | "variables" | "pad";

const COLUMN_NAMES: Record<BatchColumn, string[]> = {
  question: ["question", "event", "what", "e", "問題", "事件"],
  time: ["time", "period", "when", "t", "時間", "期間"],
  start: ["start", "from", "開始"],
  end: ["end", "to", "結束"],
  region: ["region", "where", "place", "basin", "subbasin", "location", "r", "地點", "流域"],
  variables: ["variables", "variable", "vars", "categories", "v", "變數"],
  pad: ["pad", "padmonths", "baselinepad"],
};
const normKey = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s_\-.]+/g, "");
const COLUMN_BY_KEY = new Map<string, BatchColumn>(
  (Object.entries(COLUMN_NAMES) as [BatchColumn, string[]][]).flatMap(([col, names]) => names.map((nm) => [normKey(nm), col] as const)),
);
export const columnOf = (header: string): BatchColumn | null => COLUMN_BY_KEY.get(normKey(header)) ?? null;

/* ------------------------------------------------------------------ variables cell */

/** id, English name and Chinese name of every category -> the category ("soil moisture", "土壤水", "soil" -> soil) */
const CATEGORY_BY_KEY = new Map<string, CategoryId>(
  CATEGORY_ORDER.flatMap((c) => [c, CATEGORIES[c].name.en, CATEGORIES[c].name.zh].map((nm) => [normKey(nm), c] as const)),
);
const AUTO = new Set(["", "auto", "suggest", "?"]);

/**
 * "precip;soil;tws", "precip | Soil moisture", "降水、土壤水" -> categories in display order. Separators: `;` `|`
 * `,` `/` `、` (and spaces between ids). null = empty or "auto": let the suggester choose.
 */
export function parseVariables(cell: string): { categories: CategoryId[] | null; unknown: string[] } {
  if (AUTO.has(normKey(cell))) return { categories: null, unknown: [] };
  const found = new Set<CategoryId>();
  const unknown: string[] = [];
  for (const token of cell.split(/[;|,/、，；\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const whole = CATEGORY_BY_KEY.get(normKey(token));
    if (whole) { found.add(whole); continue; }
    // "precip soil tws": ids separated by spaces
    for (const word of token.split(/\s+/)) {
      const c = CATEGORY_BY_KEY.get(normKey(word));
      if (c) found.add(c); else unknown.push(word);
    }
  }
  return { categories: CATEGORY_ORDER.filter((c) => found.has(c)), unknown };
}

/* ------------------------------------------------------------------ questions */

export type BatchProblemCode =
  | "no-question"   // the row has other cells but no question
  | "bad-time"      // the time (or start / end) cell is there but is not a period
  | "no-time"       // no time cell and no year in the question
  | "no-variables"; // the variables cell names nothing known

export type BatchNoteCode =
  | "unknown-variables" // some names in the variables cell are not categories (the others are used)
  | "bad-pad"           // pad is not a whole number 3–60: the default is used
  | "question-cut";     // the question was longer than 300 characters

export interface BatchRemark<C extends string> { code: C; detail?: string }

export interface BatchQuestion {
  /** 1-based line of the file the row starts on */
  line: number;
  question: string;
  /** the event period; null = none could be read */
  time: TimeRange | null;
  /** where the period came from: its own cell(s), or the question text */
  timeSource: "column" | "question" | null;
  /** the region cell as written; "" = read the place from the question */
  region: string;
  /** categories of the variables cell; null = suggest them */
  categories: CategoryId[] | null;
  padMonths: number;
  /** why the row cannot be answered; non-empty = skipped */
  problems: BatchRemark<BatchProblemCode>[];
  /** things the reader should know about a row that is answered anyway */
  notes: BatchRemark<BatchNoteCode>[];
}

export type BatchFileError =
  | "empty"            // no header line
  | "no-question-column"
  | "no-rows"          // a header but nothing under it
  | "too-large";

export interface BatchParse {
  questions: BatchQuestion[];
  /** nothing can be read from this file */
  error: BatchFileError | null;
  delimiter: Delimiter;
  /** header cells that are not columns of the format: ignored, and reported */
  ignoredColumns: string[];
  /** rows beyond BATCH_MAX_ROWS, not read */
  dropped: number;
  unclosedQuoteLine: number | null;
}

function readTime(time: string, start: string, end: string, question: string): Pick<BatchQuestion, "time" | "timeSource"> & { bad: string | null } {
  if (time) {
    const t = parseRange(time) ?? suggestedTime(time);
    return t ? { time: t, timeSource: "column", bad: null } : { time: null, timeSource: null, bad: time };
  }
  if (start || end) {
    const a = start || end, b = end || start;
    const t = isYearMonth(a) && isYearMonth(b) ? parseRange(`${a}..${b}`) : suggestedTime(`${a} to ${b}`);
    return t ? { time: t, timeSource: "column", bad: null } : { time: null, timeSource: null, bad: [start, end].filter(Boolean).join(" – ") };
  }
  const t = suggestedTime(question);
  return { time: t, timeSource: t ? "question" : null, bad: null };
}

export function parseBatchCsv(text: string): BatchParse {
  const empty = (error: BatchFileError): BatchParse =>
    ({ questions: [], error, delimiter: ",", ignoredColumns: [], dropped: 0, unclosedQuoteLine: null });
  if (text.length > BATCH_MAX_CHARS) return empty("too-large");
  const table = parseCsv(text);
  if (!table.header.length) return empty("empty");

  const at: Partial<Record<BatchColumn, number>> = {};
  const ignoredColumns: string[] = [];
  table.header.forEach((h, i) => {
    const col = columnOf(h);
    if (col && at[col] === undefined) at[col] = i;
    else if (h) ignoredColumns.push(h);
  });
  const base = { delimiter: table.delimiter, ignoredColumns, unclosedQuoteLine: table.unclosedQuoteLine };
  if (at.question === undefined) return { ...base, questions: [], error: "no-question-column", dropped: 0 };
  if (!table.rows.length) return { ...base, questions: [], error: "no-rows", dropped: 0 };

  const kept = table.rows.slice(0, BATCH_MAX_ROWS);
  const questions = kept.map(({ line, cells }): BatchQuestion => {
    const cell = (c: BatchColumn) => (at[c] === undefined ? "" : (cells[at[c]!] ?? "").trim());
    const problems: BatchQuestion["problems"] = [];
    const notes: BatchQuestion["notes"] = [];

    let question = cell("question").replace(/\s+/g, " ");
    if (!question) problems.push({ code: "no-question" });
    if (question.length > MAX_QUESTION_CHARS) { question = question.slice(0, MAX_QUESTION_CHARS); notes.push({ code: "question-cut" }); }

    const t = readTime(cell("time"), cell("start"), cell("end"), question);
    if (t.bad !== null) problems.push({ code: "bad-time", detail: t.bad });
    else if (!t.time && question) problems.push({ code: "no-time" });

    const vars = parseVariables(cell("variables"));
    if (vars.categories && !vars.categories.length) problems.push({ code: "no-variables", detail: cell("variables") });
    else if (vars.unknown.length) notes.push({ code: "unknown-variables", detail: vars.unknown.join(", ") });

    let padMonths = DEFAULT_PAD;
    const pad = cell("pad");
    if (pad) {
      if (/^\d{1,3}$/.test(pad) && Number(pad) >= PAD_MIN && Number(pad) <= PAD_MAX) padMonths = Number(pad);
      else notes.push({ code: "bad-pad", detail: pad });
    }

    return {
      line, question, time: t.time, timeSource: t.timeSource, region: cell("region"),
      categories: vars.categories?.length ? vars.categories : null, padMonths, problems, notes,
    };
  });
  return { ...base, questions, error: null, dropped: table.rows.length - kept.length };
}

/* ------------------------------------------------------------------ template */

/** The example offered for download and loaded by "Try the example"; a copy lives in /docs/examples. */
export const BATCH_TEMPLATE = `question,time,region,variables,pad
2021 Taiwan spring drought,2021-02..2021-05,b4-4040046370,precip;soil;tws;ndvi,
2022 Pakistan floods,2022-07..2022-09,Indus,,
"2019–20 Australian Black Summer, drought and bushfires",2019-09..2020-01,b4-5040070710,precip;soil;tair;ndvi,24
Heatwave in the Yangtze basin in August 2022,,,,
`;

/* ------------------------------------------------------------------ results */

export interface BatchResultVariable {
  category: string;
  /** "Soil moisture" */
  name: string;
  product: string;
  layer: string;
  unit: string;
  /** "ok", or why there is no number: "no data", "outside the record", an error */
  status: string;
  detail: IntervalDetail | null;
}

export interface BatchResultRow {
  line: number;
  question: string;
  time: TimeRange | null;
  regionId: string;
  regionName: string;
  padMonths: number;
  /** who chose the variables: "csv", "local-model", "online-model", "keyword-fallback"; "" when the row was not answered */
  variablesFrom: string;
  /** "answered", or why the row was skipped / failed */
  status: string;
  variables: BatchResultVariable[];
  /** link that opens the row in the workbench */
  link: string;
}

const RESULT_COLUMNS = [
  "row", "question", "period", "region", "region_name", "pad", "variables_from", "status",
  "category", "variable", "product", "layer", "unit", "variable_status",
  "months", "n", "mean_anomaly", "ci95_low", "ci95_high", "percent_of_normal", "mean_z",
  "p_ar1_z_test", "p_empirical", "season_rank", "season_years", "direction", "verdict",
  "peak_month", "peak_z", "months_beyond_2sigma", "link",
];

/**
 * One line per question × variable (a question without variables still gets one line, with its status), so the file
 * opens as a flat table. Statistics are those of the event period, the same numbers the workbench shows on arrival.
 */
export function batchResultsCsv(meta: { source: string; generated: string; note: string }, rows: BatchResultRow[]): string {
  const lines = [
    `# Aqua Trend batch questions: ${meta.source.replace(/[\r\n]+/g, " ")}`,
    `# generated: ${meta.generated}`,
    `# ${meta.note}`,
    RESULT_COLUMNS.join(","),
  ];
  for (const r of rows) {
    const head = [r.line, r.question, r.time ? encodeRange(r.time) : "", r.regionId, r.regionName, r.padMonths, r.variablesFrom, r.status];
    const vars: (BatchResultVariable | null)[] = r.variables.length ? r.variables : [null];
    for (const v of vars) {
      const d = v?.detail;
      lines.push([
        ...head,
        v?.category, v?.name, v?.product, v?.layer, v?.unit, v?.status,
        d?.months, d?.n, d?.meanAnomaly, d?.ci95?.[0], d?.ci95?.[1], d?.percentOfNormal, d?.meanZ,
        d?.test?.p, d?.empirical?.p, d?.seasonRank?.position, d?.seasonRank?.of, d?.direction, d?.verdict,
        d?.peak?.month, d?.peak?.z, d?.beyond2Sigma, r.link,
      ].map(csvCell).join(","));
    }
  }
  return lines.join("\n") + "\n";
}
