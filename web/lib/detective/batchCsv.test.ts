// Run from web/: npx tsx --test lib/detective/batchCsv.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BATCH_MAX_ROWS, BATCH_TEMPLATE, batchResultsCsv, columnOf, csvCell, parseBatchCsv, parseCsv, parseVariables } from "./batchCsv";
import type { IntervalDetail } from "./intervalDetail";

test("CSV: quotes, doubled quotes, line breaks in a cell, CRLF, BOM, comments and blank lines", () => {
  const t = parseCsv('﻿question,time\r\n# a comment, with a comma\r\n\r\n"Floods, ""the big one""",2022-07\r\n"two\nlines", 2021 \r\nlast,');
  assert.equal(t.delimiter, ",");
  assert.deepEqual(t.header, ["question", "time"]);
  assert.deepEqual(t.rows, [
    { line: 4, cells: ['Floods, "the big one"', "2022-07"] },
    { line: 5, cells: ["two\nlines", "2021"] },
    { line: 7, cells: ["last", ""] },
  ]);
  assert.equal(t.unclosedQuoteLine, null);
  assert.equal(parseCsv('question\n"never closed\nmore').unclosedQuoteLine, 2);
  assert.deepEqual(parseCsv("").header, []);
});

test("CSV: semicolon and tab files are recognised from the header line", () => {
  assert.equal(parseCsv("question;time;region\nA flood, a big one;2022;Indus").delimiter, ";");
  assert.deepEqual(parseCsv("question;time;region\nA flood, a big one;2022;Indus").rows[0].cells, ["A flood, a big one", "2022", "Indus"]);
  const tab = parseCsv("question\ttime\nDrought in 2021\t2021-02..2021-05\n");
  assert.equal(tab.delimiter, "\t");
  assert.deepEqual(tab.rows[0].cells, ["Drought in 2021", "2021-02..2021-05"]);
});

test("column names: aliases, case and spacing; unknown names are not columns", () => {
  assert.equal(columnOf("Question"), "question");
  assert.equal(columnOf(" EVENT "), "question");
  assert.equal(columnOf("When"), "time");
  assert.equal(columnOf("sub-basin"), "region");
  assert.equal(columnOf("Pad months"), "pad");
  assert.equal(columnOf("事件"), "question");
  assert.equal(columnOf("notes"), null);
});

test("variables cell: ids, names in English and Chinese, several separators, auto", () => {
  assert.deepEqual(parseVariables("precip;soil;tws"), { categories: ["precip", "soil", "tws"], unknown: [] });
  assert.deepEqual(parseVariables("tws | Soil moisture | PRECIP"), { categories: ["precip", "soil", "tws"], unknown: [] });
  assert.deepEqual(parseVariables("降水、土壤水"), { categories: ["precip", "soil"], unknown: [] });
  assert.deepEqual(parseVariables("precip soil ndvi"), { categories: ["precip", "soil", "ndvi"], unknown: [] });
  assert.deepEqual(parseVariables("precip; rainfall; soil"), { categories: ["precip", "soil"], unknown: ["rainfall"] });
  assert.deepEqual(parseVariables(""), { categories: null, unknown: [] });
  assert.deepEqual(parseVariables(" Auto "), { categories: null, unknown: [] });
});

test("a full row is taken as written; an empty cell is worked out from the question", () => {
  const p = parseBatchCsv([
    "question,time,region,variables,pad",
    "2021 Taiwan spring drought,2021-02..2021-05,b4-4040046370,precip;soil,24",
    "Pakistan floods July–September 2022,,,,",
    "Texas freeze,February 2021,Texas,tair,",
    "Dry year,2015,,,",
  ].join("\n"));
  assert.equal(p.error, null);
  assert.deepEqual(p.ignoredColumns, []);
  assert.deepEqual(p.questions[0], {
    line: 2, question: "2021 Taiwan spring drought", time: { start: "2021-02", end: "2021-05" }, timeSource: "column",
    region: "b4-4040046370", categories: ["precip", "soil"], padMonths: 24, problems: [], notes: [],
  });
  assert.deepEqual(p.questions[1].time, { start: "2022-07", end: "2022-09" });
  assert.equal(p.questions[1].timeSource, "question");
  assert.equal(p.questions[1].region, "");
  assert.equal(p.questions[1].categories, null);
  assert.equal(p.questions[1].padMonths, 12);
  assert.deepEqual(p.questions[2].time, { start: "2021-02", end: "2021-02" });   // a free-text period in the time cell
  assert.deepEqual(p.questions[3].time, { start: "2015-01", end: "2015-12" });   // a bare year = the whole year
  assert.ok(p.questions.every((q) => !q.problems.length));
});

test("start and end columns work in place of time", () => {
  const p = parseBatchCsv("event,from,to\nDrought,2021-02,2021-05\nOne month,2022-08,\nBackwards,2021-05,2021-02");
  assert.deepEqual(p.questions[0].time, { start: "2021-02", end: "2021-05" });
  assert.deepEqual(p.questions[1].time, { start: "2022-08", end: "2022-08" });
  assert.deepEqual(p.questions[2].problems, [{ code: "bad-time", detail: "2021-05 – 2021-02" }]);
});

test("rows that cannot be answered say why; small faults become notes and the row still runs", () => {
  const p = parseBatchCsv([
    "question,time,region,variables,pad,owner",
    ",2021-02,b4-1,precip,,amy",                       // no question
    "A flood somewhere,,,,,",                          // no period anywhere
    "A flood,sometime last spring,,,,",                // a time cell that is not a period
    "A flood in 2022,,,rainfall,,",                    // variables: nothing known
    "A flood in 2022,,,precip;rainfall,99,",           // one unknown variable, a pad out of range
  ].join("\n"));
  assert.deepEqual(p.ignoredColumns, ["owner"]);
  assert.deepEqual(p.questions.map((q) => q.problems.map((x) => x.code)), [["no-question"], ["no-time"], ["bad-time"], ["no-variables"], []]);
  assert.deepEqual(p.questions[2].problems[0].detail, "sometime last spring");
  assert.deepEqual(p.questions[4].notes, [{ code: "unknown-variables", detail: "rainfall" }, { code: "bad-pad", detail: "99" }]);
  assert.deepEqual(p.questions[4].categories, ["precip"]);
  assert.equal(p.questions[4].padMonths, 12);
});

test("files that cannot be read at all", () => {
  assert.equal(parseBatchCsv("").error, "empty");
  assert.equal(parseBatchCsv("# only a comment\n").error, "empty");
  assert.equal(parseBatchCsv("time,region\n2021,Indus").error, "no-question-column");
  assert.equal(parseBatchCsv("question,time\n").error, "no-rows");
  assert.equal(parseBatchCsv("question\n" + "x".repeat(1_000_001)).error, "too-large");
});

test("at most 200 questions are read; the rest are counted, not silently lost", () => {
  const p = parseBatchCsv("question\n" + Array.from({ length: BATCH_MAX_ROWS + 7 }, (_, i) => `Flood ${2000 + (i % 20)} number ${i}`).join("\n"));
  assert.equal(p.questions.length, BATCH_MAX_ROWS);
  assert.equal(p.dropped, 7);
});

test("the template parses cleanly and matches the copy in docs/examples", () => {
  const p = parseBatchCsv(BATCH_TEMPLATE);
  assert.equal(p.error, null);
  assert.equal(p.questions.length, 4);
  assert.ok(p.questions.every((q) => !q.problems.length && !q.notes.length));
  assert.equal(p.questions[2].question, "2019–20 Australian Black Summer, drought and bushfires");
  assert.equal(p.questions[2].padMonths, 24);
  assert.deepEqual(p.questions[3], {
    line: 5, question: "Heatwave in the Yangtze basin in August 2022", time: { start: "2022-08", end: "2022-08" }, timeSource: "question",
    region: "", categories: null, padMonths: 12, problems: [], notes: [],
  });
  assert.equal(readFileSync(new URL("../../../docs/examples/batch-questions.csv", import.meta.url), "utf8"), BATCH_TEMPLATE);
});

test("results CSV: one line per question and variable, cells quoted when needed, and it reads back", () => {
  assert.equal(csvCell('a "b", c'), '"a ""b"", c"');
  assert.equal(csvCell(1.23456789), "1.23457");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(NaN), "");
  const detail = { months: 4, n: 4, meanAnomaly: -31.2, ci95: [-50, -12], percentOfNormal: -8, meanZ: -1.7, test: { p: 0.03 }, empirical: { p: 0.01 },
    seasonRank: { position: 2, of: 24 }, direction: "low", verdict: "significant", peak: { month: "2021-05", z: -2.6 }, beyond2Sigma: 2 } as unknown as IntervalDetail;
  const csv = batchResultsCsv({ source: "my file.csv", generated: "2026-11-15T00:00:00Z", note: "note" }, [
    { line: 2, question: "Drought, Taiwan", time: { start: "2021-02", end: "2021-05" }, regionId: "b4-1", regionName: "Basin (Taiwan)", padMonths: 12,
      variablesFrom: "csv", status: "answered", link: "https://x/detective/?e=1", variables: [
        { category: "soil", name: "Soil moisture", product: "GLDAS", layer: "sm_root", unit: "mm", status: "ok", detail },
        { category: "snow", name: "Snow", product: "", layer: "", unit: "", status: "no data", detail: null },
      ] },
    { line: 3, question: "No period", time: null, regionId: "", regionName: "", padMonths: 12, variablesFrom: "", status: "No period", variables: [], link: "" },
  ]);
  const t = parseCsv(csv);
  assert.equal(t.header[0], "row");
  assert.equal(t.rows.length, 3);
  const col = (name: string) => t.header.indexOf(name);
  assert.equal(t.rows[0].cells[col("question")], "Drought, Taiwan");
  assert.equal(t.rows[0].cells[col("mean_z")], "-1.7");
  assert.equal(t.rows[0].cells[col("verdict")], "significant");
  assert.equal(t.rows[0].cells[col("season_rank")], "2");
  assert.equal(t.rows[1].cells[col("variable_status")], "no data");
  assert.equal(t.rows[1].cells[col("mean_z")], "");
  assert.equal(t.rows[2].cells[col("status")], "No period");
  assert.equal(t.rows[2].cells[col("category")], "");
});
