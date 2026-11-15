"use client";
// Everything the Days and Weeks windows show and test, in one place (AnalysisView calls it; DailyView draws it; the
// statistics panel and the Tests area read it):
//
//   1. the span [month selection − reach, month selection + reach]; daily values are fetched for the selected days
//      only (useDailyRange), the rest of the span shows days fetched before
//   2. the daily normal (monthly trend + seasonal cycle at each day) at the daily product's level, and the anomaly
//   3. one point per day, or per 7-day block (lib/detective/fine.ts)
//   4. the reader's own selection of points (URL `dsel`; default the month selection's days)
//   5. the baseline: the surrounding loaded points, or the same days of earlier years (fetched on request)
//   6. the selection's statistics (fineDetail) and the series the lab's tools run on (fineDecomposition)
import { useMemo } from "react";
import type { Decomposition, LayerId, RegionId, TimeRange } from "@/lib/detective/contracts";
import {
  baselineSpans, dailySeries, daysOfPoints, dayNum, dayStr, fineDecomposition, fineDetail, pointsOf, weeklySeries,
  windowBaseline, yearsBack, yearsBaseline,
  type DayRange, type FineBaseline, type FineDetail, type FineSeries, type FineStep, type PointRange,
} from "@/lib/detective/fine";
import { dailySpan, eventDays, type DailyUnit } from "@/lib/detective/window";
import type { LabSource } from "../workbench/lab/useLabRun";
import { pointAxis, type LabAxis } from "../workbench/lab/step";
import { dailyAnomaly, dailyLevel, dailyNormal, levelledNormal, sameUnit, type DailyLevel } from "./plan";
import { useDailyRange, type DailyState } from "./useDailyRange";
import { useYearsBaseline, type YearsState } from "./useYearsBaseline";

export type BaselineKind = FineBaseline["kind"];

export interface FineModel {
  step: FineStep;
  /** the loaded span and its loading state (days) */
  span: { start: string; end: string; days: number };
  st: DailyState;
  /** the monthly model covers these days (so an anomaly is possible once days have loaded) */
  hasModel: boolean;
  level: DailyLevel | null;
  /** daily normal and anomaly, aligned with st.dates */
  normal: (number | null)[];
  anomaly: (number | null)[];
  /** the points drawn and tested (days, or weeks) */
  series: FineSeries;
  /** per point: every day of it has been fetched */
  loaded: boolean[];
  /** the selected points, and their days; null before anything is loaded */
  sel: PointRange | null;
  selDays: DayRange;
  /** the reader chose the selection (URL dsel) rather than the month selection's days */
  custom: boolean;
  baselineKind: BaselineKind;
  years: YearsState;
  /** how many earlier years were asked for, and how many the record allows */
  yearsAsked: number;
  yearsPossible: number;
  /** the baseline the statistics use (falls back to the surrounding points until earlier years are in) */
  baselineInUse: BaselineKind;
  detail: FineDetail | null;
  lab: (LabSource & { sel: { s: number; e: number }; axis: LabAxis; level: number }) | null;
}

export function useFineModel(p: {
  region: RegionId;
  layer: LayerId;
  d: Decomposition | null;
  /** unit of the monthly series */
  unit: string;
  /** the workbench's month selection: the span is built around it */
  monthSel: TimeRange;
  reach: { unit: DailyUnit; n: number };
  /** URL dsel */
  daySel: DayRange | null;
  baseline: { kind: BaselineKind; years: number };
  enabled: boolean;
}): FineModel {
  const step: FineStep = p.reach.unit === "week" ? "week" : "day";
  const span = useMemo(() => dailySpan(p.monthSel, p.reach.n, p.reach.unit), [p.monthSel.start, p.monthSel.end, p.reach.n, p.reach.unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthDays = useMemo(() => eventDays(p.monthSel), [p.monthSel.start, p.monthSel.end]); // eslint-disable-line react-hooks/exhaustive-deps

  // the selection: the reader's days, else the month selection's, clipped to the span (whole points)
  const wanted = p.daySel && p.daySel.end >= span.start && p.daySel.start <= span.end ? p.daySel : monthDays;
  const custom = wanted === p.daySel;

  // earlier years are fetched around the selection's days (the margin is counted from there)
  const earliest = p.d?.months[0] ? `${p.d.months[0]}-01` : "2000-01-01";
  const clip = (r: DayRange): DayRange => ({ start: r.start < span.start ? span.start : r.start, end: r.end > span.end ? span.end : r.end });
  // weeks: the selection snaps to whole 7-day blocks from the span's first day
  const snapped = (() => {
    const r = clip(wanted);
    if (step !== "week") return r;
    const s0 = dayNum(span.start), a = dayNum(r.start), b = dayNum(r.end);
    return { start: dayStr(s0 + Math.floor((a - s0) / 7) * 7), end: dayStr(Math.min(dayNum(span.end), s0 + Math.floor((b - s0) / 7) * 7 + 6)) };
  })();
  // only the selected days are fetched; the selection's change restarts loading (useDailyRange)
  const st = useDailyRange({ region: p.region, layer: p.layer, start: span.start, end: span.end, fetch: snapped, enabled: p.enabled });
  const comparable = !!p.d && sameUnit(st.unit ?? p.unit, p.unit);
  const model = useMemo(() => (comparable ? dailyNormal(p.d, st.dates) : st.dates.map(() => null)), [comparable, p.d, st.dates]);
  const hasModel = model.some((v) => v != null);
  const yearsWanted = p.baseline.kind === "years" ? p.baseline.years : 0;
  const spans = useMemo(
    () => (yearsWanted ? baselineSpans(snapped, step, yearsWanted, earliest) : []),
    [yearsWanted, snapped.start, snapped.end, step, earliest], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const yearsPossible = useMemo(() => baselineSpans(snapped, step, 40, earliest).length, [snapped.start, snapped.end, step, earliest]); // eslint-disable-line react-hooks/exhaustive-deps
  const years = useYearsBaseline({ region: p.region, layer: p.layer, spans, enabled: p.enabled && comparable });
  const yearsIn = p.baseline.kind === "years" && years.phase === "done" && years.years.length > 0;

  // one level for this year and the earlier ones: the daily product's offset from the monthly series
  const pastModels = years.years.map((y) => (comparable ? dailyNormal(p.d, y.dates) : y.dates.map(() => null)));
  const level = dailyLevel(
    p.d,
    [...st.dates, ...(yearsIn ? years.years.flatMap((y) => y.dates) : [])],
    [...st.values, ...(yearsIn ? years.years.flatMap((y) => y.values) : [])],
    [...model, ...(yearsIn ? pastModels.flat() : [])],
  );
  const normal = levelledNormal(model, level);
  const anomaly = dailyAnomaly(st.values, normal);

  const days = dailySeries(st.dates, st.values, normal, anomaly);
  const series = step === "week" ? weeklySeries(days) : days;
  const loaded = series.start.map((s, i) => {
    const a = st.dates.indexOf(s), b = st.dates.indexOf(series.end[i]);
    return a >= 0 && b >= a && st.loaded.slice(a, b + 1).every(Boolean);
  });
  const sel = series.start.length ? pointsOf(series, snapped) : null;
  const selDays = sel ? daysOfPoints(series, sel) : snapped;

  let baseline: FineBaseline | null = null;
  if (sel) {
    if (yearsIn) {
      baseline = yearsBaseline(years.years.map((y, i) => {
        const nrm = levelledNormal(pastModels[i], level);
        const pd = dailySeries(y.dates, y.values, nrm, dailyAnomaly(y.values, nrm));
        const ps = step === "week" ? weeklySeries(pd) : pd;
        const k = Number(selDays.start.slice(0, 4)) - y.year;
        return { year: y.year, series: ps, sel: pointsOf(ps, yearsBack(selDays, k)) };
      }));
    } else baseline = windowBaseline(series, sel);
  }
  const detail = sel && baseline && level ? fineDetail(series, sel, baseline) : null;
  let lab: FineModel["lab"] = null;
  if (sel && baseline && level) {
    const { d, extremeRate } = fineDecomposition(series, sel, baseline);
    lab = {
      d, base: 0, record: { s: 0, e: series.start.length - 1 }, meta: { layer: p.layer }, step, extremeRate,
      key: `${baseline.kind}|${span.start}|${level.offset.toPrecision(6)}|${baseline.kind === "years" ? years.years.length : ""}`,
      sel: { s: sel.a, e: sel.b }, axis: pointAxis(step, series.start, series.end), level: detail?.reference ?? 0,
    };
  }

  return {
    step, span, st, hasModel, level, normal, anomaly, series, loaded, sel, selDays, custom,
    baselineKind: p.baseline.kind, years, yearsAsked: spans.length, yearsPossible,
    baselineInUse: yearsIn ? "years" : "window", detail, lab,
  };
}
