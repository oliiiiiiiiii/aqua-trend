# Batch questions (CSV)

`/batch` answers many questions from one CSV file. Each row is one event, answered the same way as a
single question on `/detective`: for every variable the seasonal cycle and the long-term trend are
removed from the sub-basin's monthly series, and the event period is tested against normal
variability. Every answer links to the full workbench, and all answers download as one CSV.

Try it: open `/batch` and press **Try the example**, or upload
[`docs/examples/batch-questions.csv`](examples/batch-questions.csv).

## The file

```csv
question,time,region,variables,pad
2021 Taiwan spring drought,2021-02..2021-05,b4-4040046370,precip;soil;tws;ndvi,
2022 Pakistan floods,2022-07..2022-09,Indus,,
"2019–20 Australian Black Summer, drought and bushfires",2019-09..2020-01,b4-5040070710,precip;soil;tair;ndvi,24
Heatwave in the Yangtze basin in August 2022,,,,
```

- The **first line names the columns**. Order is free, names are case-insensitive, and columns you
  do not need can be left out.
- **Only `question` is required.** An empty cell means "work it out from the question", exactly as
  the input page does when you type an event.
- One row = one question. At most **200 questions** and **1 MB** per file.

### Columns

| Column | Also accepted as | What goes in it | If empty or absent |
| --- | --- | --- | --- |
| `question` | `event`, `what`, `e` | The event in your own words (English or Chinese), up to 300 characters. Longer text is cut. | **Required.** A row without it is skipped. |
| `time` | `period`, `when`, `t` | The event period, months inclusive. `2021-02..2021-05`, a single month `2021-02`, or words: `Feb–May 2021`, `September 2019 to January 2020`, `2022`, `2021 年 2 月到 5 月`. | Read from the question. A year alone means the whole year (`2022 Pakistan floods` → Jan–Dec 2022). No year anywhere → the row is skipped. |
| `start`, `end` | `from`, `to` | The same period as two cells of `YYYY-MM` (handy in a spreadsheet). `end` empty = one month. Ignored when `time` is filled. | — |
| `region` | `where`, `place`, `basin`, `location`, `r` | A sub-basin id (`b4-4040046370`, shown in the URL of any analysis), or a name: a river (`Indus`, `Murray`), a country in English or Chinese (`Taiwan`, `巴基斯坦`), or words from a basin name. | Read from the question (river names first, then countries). Nothing found → the row is skipped. |
| `variables` | `variable`, `vars`, `categories`, `v` | Category ids or names, separated by `;` (also `\|`, `/`, or spaces between ids): `precip;soil;tws`, `Soil moisture; NDVI`, `降水、土壤水`. `auto` = suggest. | Suggested from the question by the same selector as the input page (the AI model, or the keyword table when it is offline). |
| `pad` | `padmonths` | Months left out of the baseline either side of the event, a whole number 3–60. | 12 |

Any other column is ignored and listed above the table, so you can keep your own notes in the file.

### Variable ids

| id | Variable | id | Variable |
| --- | --- | --- | --- |
| `precip` | Precipitation | `wind` | Wind speed |
| `et` | Evapotranspiration | `ndvi` | Vegetation greenness |
| `soil` | Soil moisture | `sst` | Sea surface temperature |
| `tws` | Terrestrial water storage | `aod` | Aerosol optical depth |
| `runoff` | Runoff | `ozone` | Total-column ozone |
| `snow` | Snow water | `vapor` | Atmospheric water vapour |
| `tair` | Air temperature | `so2` | Annual SO₂ emissions (annual data only: cannot be analysed monthly) |
| `vpd` | Air dryness (VPD) | `fire` | Vegetation-fire detections |
| `energy` | Net radiation | | |

The English and Chinese names shown in the app work too. The ids are listed on the page under
**CSV format**; `web/lib/detective/categories.ts` is the source.

### CSV details

- **Commas inside a cell need quotes**: `"Floods, July 2022"`. A quote inside a quoted cell is
  doubled: `"the ""big"" flood"`. Line breaks inside quotes are allowed.
- **Separator**: comma, semicolon or tab, recognised from the header line (so a `.tsv`, or a CSV
  saved by a spreadsheet in a locale that uses `;`, works as it is). In a comma-separated file, use
  `;` between variables or quote the cell.
- Blank lines and lines starting with `#` are skipped. A UTF-8 byte-order mark and Windows line
  ends are fine. Save the file as **UTF-8**.
- **Spreadsheet tip**: Excel turns `2021-02` into a date. Format the `time` column as *Text*, write
  `2021-02..2021-05`, or use words (`Feb 2021`).

## What happens to each row

1. **Period**: the `time` cell (or `start` / `end`), else read from the question.
2. **Place**: the `region` cell, else read from the question. An id is used as written; a wrong id
   is reported, never replaced by a guess. A name can match several sub-basins (a river has many,
   a country more): the **largest** is used and the others are offered in a drop-down in the
   *Where* column. Pick another and that row is answered again. The row says how the place was
   found (`matched “Indus”`, `from the question`).
3. **Variables**: the `variables` cell, else suggested. A *suggested* variable the sub-basin has no
   data for is left out (and named under the answer); a variable *you* listed is always kept and
   shown as `no data`, `outside the record` or `failed`.
4. **Analysis**, three rows at a time, in your browser: `decompose` (seasonal cycle + linear trend
   fitted on the baseline, i.e. the record without the event ± `pad`), then the statistics of the
   event period (`intervalDetail`): mean anomaly, mean σ, the AR(1) z test, the empirical window
   test and the same-season rank. These are the numbers the workbench shows when it opens on the
   event.

The **answer** of a row is the count of unusual variables ("2 of 4 unusual") and one chip per
variable with its verdict mark and mean σ over the event period:

| Mark | Meaning |
| --- | --- |
| ● (coloured) | Unusual: the tests that apply are below p = 0.05 |
| ◐ | The two tests disagree |
| ○ | Within normal variability |
| – | Not enough data |

Unusual is a timing match, not proof of cause. **Open →** takes the row to the workbench (the usual
`/detective?e=…&t=…&r=…&v=…` link, with the most unusual variable in front) to look at the series,
move the selection, switch to the daily view or run more tests. Coming back shows the table as it
was.

### Rows that are skipped

A row that cannot be completed is listed with the reason and is not analysed; the others run.

| Message | Fix |
| --- | --- |
| No question in this row. | Fill the `question` cell. |
| No period. Add a time cell or put the year in the question. | Add `time`, or a year in the text. |
| “…” is not a period. | Use `2021-02..2021-05`, `2021-02`, or words like `Feb–May 2021`. |
| No place. Add a region cell, or name a river or country in the question. | Add `region`. |
| No sub-basin matches “…”. | Use a river, a country, or a `b4-…` id (search on `/detective`). |
| Sub-basin b4-… is not in the catalogue. / … has no monthly series. | Check the id; only basin-4 sub-basins with a monthly series can be analysed. |
| No known variable in “…”. | Use the ids above, or leave the cell empty. |

Smaller faults do not stop a row and are noted under its answer: an unknown name among known
variables (left out), a `pad` that is not 3–60 (12 is used), a question longer than 300 characters.

## The answers file

**Download answers (CSV)** writes `<your file>-answers.csv`: three `#` comment lines (source file,
time, note), a header, then **one line per question × variable** so it opens as a flat table. A
question that was skipped, failed or has no variable still gets one line, with the reason in
`status`.

| Column | Content |
| --- | --- |
| `row` | Line of the question in your file |
| `question`, `period`, `region`, `region_name`, `pad` | The question as it was answered (period as `YYYY-MM..YYYY-MM`, the sub-basin actually used) |
| `variables_from` | `csv`, `local-model`, `online-model` or `keyword-fallback` |
| `status` | `answered`, or why the row was skipped or failed |
| `category`, `variable`, `product`, `layer`, `unit` | The variable and the data product used |
| `variable_status` | `ok`, `no data`, `outside the record`, or `failed: …` |
| `months`, `n` | Calendar months in the period; months with an observation |
| `mean_anomaly`, `ci95_low`, `ci95_high`, `percent_of_normal` | Mean anomaly of the period in the layer's unit, its 95 % interval, and as a share of normal where that makes sense |
| `mean_z` | Mean anomaly in σ |
| `p_ar1_z_test`, `p_empirical` | The two tests (see Methods) |
| `season_rank`, `season_years` | Rank of this period among the same calendar months of every year |
| `direction`, `verdict` | `low` / `high`; `significant`, `mixed`, `not-significant`, `insufficient` |
| `peak_month`, `peak_z`, `months_beyond_2sigma` | The most extreme month and how many months pass 2σ |
| `link` | Opens this question in the workbench |

Empty cell = not available. The file can be read back by any CSV reader that skips `#` lines
(`pandas.read_csv(path, comment="#")`).

## Privacy and limits

- The file is read in the browser and is not uploaded. For rows without a `variables` cell, the
  **question text** is sent to this site's `/api/select-variables` (the same request the input page
  makes); with an online selector backend configured, that text goes to the configured service.
  Fill `variables` to keep a row entirely local.
- The file and your sub-basin choices are kept in the tab's session storage so Back from a
  workbench restores the table; **Clear** removes them, and closing the tab does too.
- Batch answers use monthly data only. Daily data is loaded on demand in the workbench.
- The statistics describe the **event period as written**. To test the months before or after an
  event, open the row and move the selection, or add a row with that period.

## Code

| Piece | File |
| --- | --- |
| CSV reader, column and variable names, template, answers CSV | `web/lib/detective/batchCsv.ts` (+ `batchCsv.test.ts`) |
| Place lookup, per-row analysis | `web/lib/detective/batchRun.ts` (+ `batchRun.test.ts`) |
| River / country names in text (shared with the input page) | `web/lib/detective/regionHints.ts` |
| Page | `web/app/batch/page.tsx`, `web/components/detective/batch/BatchApp.tsx`, strings in `web/components/detective/copy/batch.ts` |

```bash
cd web && npx tsx --test lib/detective/batchCsv.test.ts lib/detective/batchRun.test.ts
```
