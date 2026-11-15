// Batch questions: turn one parsed CSV row into an answer. The same steps as the single-question flow, without the
// screens: find the sub-basin, choose the variables (the row's, else the suggester's), decompose each monthly series
// around the event and summarise the event period. Everything that touches the network is passed in (`BatchDeps`), so
// this runs under `npx tsx --test lib/detective/batchRun.test.ts`.
import type { Region } from "../types";
import type { CategoryId, LayerId, MonthlySeries, RegionId, SelectResponse, TimeRange } from "./contracts";
import { decompose } from "./analysis";
import { baselineInfo, intervalDetail, type IntervalDetail } from "./intervalDetail";
import { buildRegionHintIndex, regionHints, type RegionHintIndex } from "./regionHints";
import { categoryAvailability, type VariableCatalog } from "./series";
import { isRegionId, ymIndex } from "./url";

/* ------------------------------------------------------------------ where */

export interface RegionLookup {
  /** every region of the catalogue, to tell "unknown id" from "no data here" */
  byId: ReadonlyMap<string, Region>;
  /** sub-basins that have a monthly series: the only ones a question can be asked about */
  searchable: readonly Region[];
  hints: RegionHintIndex;
  countryNames: ReadonlyMap<string, string> | null;
}

export function makeRegionLookup(
  byId: ReadonlyMap<string, Region>, searchable: readonly Region[], countryNames: ReadonlyMap<string, string> | null,
): RegionLookup {
  return { byId, searchable, hints: buildRegionHintIndex(searchable), countryNames };
}

export type RegionProblem =
  | "unknown-id"  // a b4-… id that is not in the catalogue
  | "no-series"   // a catalogue region without a monthly series (or not a sub-basin)
  | "not-found"   // the region cell names nothing we know
  | "no-place";   // no region cell and no river or country in the question

export interface RegionResolution {
  region: Region | null;
  /** id = the cell is a sub-basin id; name = matched from the cell's text; question = read from the question */
  via: "id" | "name" | "question" | null;
  /** every sub-basin the text matches, best first (`region` is the first); the reader may pick another */
  candidates: Region[];
  problem: RegionProblem | null;
}

const MAX_CANDIDATES = 8;

/** sub-basins whose name, id or country codes contain every word of `text`, largest first */
function searchByWords(text: string, regions: readonly Region[]): Region[] {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return regions
    .filter((r) => { const hay = `${r.name} ${r.id} ${(r.iso ?? []).join(" ")}`.toLowerCase(); return terms.every((t) => hay.includes(t)); })
    .sort((a, b) => b.areaKm2 - a.areaKm2);
}

/**
 * The sub-basin of a row. A `b4-…` id is taken as written. Any other text is matched as on the input page (a river,
 * a country in English or Chinese), then by words of the basin name; the largest match is used and the others are
 * returned as candidates. With an empty cell the question itself is read the same way.
 */
export function resolveRegion(row: { region: string; question: string }, lookup: RegionLookup): RegionResolution {
  const none = (problem: RegionProblem): RegionResolution => ({ region: null, via: null, candidates: [], problem });
  const cell = row.region.trim();
  if (isRegionId(cell.toLowerCase())) {
    const id = cell.toLowerCase();
    const r = lookup.searchable.find((x) => x.id === id);
    if (r) return { region: r, via: "id", candidates: [r], problem: null };
    return none(lookup.byId.has(id) ? "no-series" : "unknown-id");
  }
  if (cell) {
    const exact = lookup.byId.get(cell);
    if (exact && !lookup.searchable.includes(exact)) return none("no-series");
    let found = regionHints(cell, lookup.hints, lookup.searchable, lookup.countryNames, MAX_CANDIDATES);
    if (!found.length) found = searchByWords(cell, lookup.searchable).slice(0, MAX_CANDIDATES);
    return found.length ? { region: found[0], via: "name", candidates: found, problem: null } : none("not-found");
  }
  const found = regionHints(row.question, lookup.hints, lookup.searchable, lookup.countryNames, MAX_CANDIDATES);
  return found.length ? { region: found[0], via: "question", candidates: found, problem: null } : none("no-place");
}

/* ------------------------------------------------------------------ answer */

export interface BatchDeps {
  vc: VariableCatalog;
  /** layers that have a series for a region (empty set when it has none) */
  layersOf: (region: RegionId) => ReadonlySet<LayerId>;
  loadSeries: (region: RegionId, layer: LayerId) => Promise<MonthlySeries>;
  /** the variable suggester of the input page (model, else keywords) */
  suggest: (event: string, signal: AbortSignal) => Promise<SelectResponse>;
}

export interface BatchJob {
  question: string;
  time: TimeRange;
  region: RegionId;
  /** null = suggest */
  categories: CategoryId[] | null;
  padMonths: number;
}

export type VariableStatus =
  | "ok"
  | "no-data"   // the sub-basin has no monthly series of this category
  | "outside"   // the product does not cover the event period
  | "error";    // the series did not load or cannot be decomposed

export interface VariableAnswer {
  category: CategoryId;
  layer: LayerId | null;
  /** unit of the series; null without one */
  unit: string | null;
  status: VariableStatus;
  /** the reason for no-data / error, when there is one to show */
  message: string | null;
  /** statistics of the event period; null unless ok */
  detail: IntervalDetail | null;
}

export interface BatchAnswer {
  /** who chose the variables */
  chosenBy: "csv" | SelectResponse["source"];
  /** suggested categories left out because the sub-basin has no data for them */
  dropped: CategoryId[];
  variables: VariableAnswer[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function answerQuestion(job: BatchJob, deps: BatchDeps, signal: AbortSignal): Promise<BatchAnswer> {
  signal.throwIfAborted();
  const avail = categoryAvailability(deps.vc, deps.layersOf(job.region));

  let categories = job.categories;
  let chosenBy: BatchAnswer["chosenBy"] = "csv";
  let dropped: CategoryId[] = [];
  if (!categories) {
    const res = await deps.suggest(job.question, signal);
    signal.throwIfAborted();
    chosenBy = res.source;
    const picked = res.votes.filter((v) => v.selected).map((v) => v.category);
    // a suggestion the sub-basin cannot answer is left out (as the picker greys it out); a category the CSV names is kept and reported
    categories = picked.filter((c) => avail.layer[c] !== null);
    dropped = picked.filter((c) => avail.layer[c] === null);
  }

  const variables = await Promise.all(categories.map(async (category): Promise<VariableAnswer> => {
    const layer = avail.layer[category];
    const blank = { category, layer, unit: layer ? deps.vc.layers[layer]?.unit ?? null : null, detail: null };
    if (!layer) return { ...blank, status: "no-data", message: avail.unavailableReason[category] ?? null };
    try {
      const series = await deps.loadSeries(job.region, layer);
      const d = decompose(series, job.time, job.padMonths);
      const first = ymIndex(d.months[0]), last = first + d.months.length - 1;
      const unit = series.unit || blank.unit;
      if (ymIndex(job.time.end) < first || ymIndex(job.time.start) > last) return { ...blank, unit, status: "outside", message: null };
      const detail = intervalDetail(d, job.time, baselineInfo(d));
      if (detail.n === 0) return { ...blank, unit, status: "outside", message: null };
      return { ...blank, unit, status: "ok", message: null, detail };
    } catch (e) {
      return { ...blank, status: "error", message: message(e) };
    }
  }));
  signal.throwIfAborted();
  return { chosenBy, dropped, variables };
}

/** The variables whose event period is unusual (both tests, or the only available one, below 0.05). */
export const unusualVariables = (a: BatchAnswer): VariableAnswer[] => a.variables.filter((v) => v.detail?.verdict === "significant");

/** A stable identity for a job, so finished answers can be kept while the file is edited or re-read. */
export const jobKey = (j: BatchJob): string =>
  [j.question, j.time.start, j.time.end, j.region, j.categories?.join(",") ?? "auto", j.padMonths].join("|");
