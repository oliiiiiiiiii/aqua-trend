"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadCatalog } from "@/lib/data";
import { numberText, type Period, type ResearchResult, type VariableResult } from "@/lib/research";
import type { Region } from "@/lib/types";
import { useReducedMotion } from "@/components/explore/hooks";
import StudyOrb, { orbEncoding } from "./StudyOrb";
import styles from "./TrendCrystalBalls.module.css";

interface Props {
  result: ResearchResult;
  variable: VariableResult;
}

type View = "fit" | "observed";
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function monthNumber(date: string) {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function timeline(variable: VariableResult, period: Period | null | undefined) {
  const history = variable.full_history;
  if (!history || !period || !history.times.length) return null;
  const annual = history.times[0].length === 4;
  const first = annual ? Math.ceil(monthNumber(period.start) / 12) : monthNumber(period.start);
  const last = annual ? Math.floor((monthNumber(period.end) - 11) / 12) : monthNumber(period.end);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last) return null;

  const indices = new Map<string, number>();
  const limits = { fit: [Infinity, -Infinity], observed: [Infinity, -Infinity] };
  history.times.forEach((date, index) => {
    const stamp = annual ? Number(date) : monthNumber(date);
    if (stamp < first || stamp > last) return;
    indices.set(date, index);
    for (const view of ["fit", "observed"] as const) {
      const value = (view === "fit" ? history.fitted : history.values)?.[index];
      if (valid(value)) {
        limits[view][0] = Math.min(limits[view][0], value);
        limits[view][1] = Math.max(limits[view][1], value);
      }
    }
  });
  const at = (ordinal: number, mode: View) => {
    const year = annual ? ordinal : Math.floor(ordinal / 12);
    const month = ordinal % 12;
    const date = annual ? String(year) : String(year).padStart(4, "0") + "-" + String(month + 1).padStart(2, "0");
    const position = indices.get(date);
    const value = position === undefined ? null : (mode === "fit" ? history.fitted : history.values)?.[position];
    return { date, label: annual ? date : monthNames[month] + " " + year, value: valid(value) ? value : null };
  };
  return { annual, first, last, limits, at };
}

function scenePosition(value: number | null, low: number, high: number) {
  if (value === null || !valid(low) || !valid(high)) return null;
  const precision = Math.max(1, Math.abs(low), Math.abs(high)) * Number.EPSILON * 16;
  return high - low <= precision ? 0.5 : Math.max(0, Math.min(1, (value - low) / (high - low)));
}

export default function TrendCrystalBalls({ result, variable }: Props) {
  const period = variable.analysis_period ?? result.comparison?.period ?? result.resolved?.period;
  const series = useMemo(() => timeline(variable, period), [variable, period]);
  const reduced = useReducedMotion();
  const regionId = result.resolved?.region_id;
  const [geography, setGeography] = useState<Region | null>(null);
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    if (regionId) {
      loadCatalog().then(catalog => { if (active) setGeography(catalog.byId.get(regionId) ?? null); })
        .catch(() => { if (active) setGeography(null); });
    }
    return () => { active = false; };
  }, [regionId]);
  const region = geography?.id === regionId ? geography : null;
  const key = result.identity.id + "/" + variable.variable_id;
  const [control, setControl] = useState({ key, view: "fit" as View, cursor: null as number | null, playing: false });
  if (control.key !== key) {
    setControl({ key, view: "fit", cursor: null, playing: false });
  }
  const hasFit = !!series && valid(series.limits.fit[0]);
  const view = hasFit ? control.view : "observed";
  const first = series?.first ?? 0;
  const last = series?.last ?? 0;
  const cursor = Math.max(first, Math.min(last, control.cursor ?? Math.floor((first + last) / 2)));

  useEffect(() => {
    if (!control.playing) return;
    const interval = window.setInterval(() => {
      setControl(previous => {
        const next = (previous.cursor ?? Math.floor((first + last) / 2)) + 1;
        return { ...previous, cursor: Math.min(next, last), playing: next < last };
      });
    }, 230);
    const pause = () => setControl(previous => ({ ...previous, playing: false }));
    const onVisibility = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", onVisibility);
    const observer = new IntersectionObserver(entries => { if (!entries[0]?.isIntersecting) pause(); });
    if (section.current) observer.observe(section.current);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
    };
  }, [control.playing, first, last]);

  const { channel, legend } = orbEncoding(variable.variable_id);
  const hasValues = !!series && (hasFit || valid(series.limits.observed[0]));
  if (!hasValues || !series) return (
    <section className={styles.section} aria-label="Crystal ball timeline">
      <h3>Crystal ball timeline</h3>
      <p className={styles.note}>{variable.label} has no supported values in this period.</p>
    </section>
  );

  const [low, high] = series.limits[view];
  const unit = variable.unit ?? "";
  const zero = low < 0 && high > 0 ? scenePosition(0, low, high) : null;
  const flat = scenePosition(low, low, high) === 0.5;
  const basis = view === "fit" && !series.annual ? "fitted anomaly" : view === "fit" ? "fitted value" : "value";
  const current = series.at(cursor, view);
  const observedLabel = series.annual ? "Annual values" : "Monthly values";
  return (
    <section className={styles.section} aria-label="Crystal ball timeline" ref={section}>
      <div className={styles.topline}>
        <h3>Crystal ball timeline</h3>
        <div role="group" aria-label="Crystal ball values" className={styles.modes}>
          <button type="button" aria-pressed={view === "fit"} disabled={!hasFit}
            onClick={() => setControl({ ...control, view: "fit", playing: false })}>Fitted trend</button>
          <button type="button" aria-pressed={view === "observed"} disabled={!valid(series.limits.observed[0])}
            onClick={() => setControl({ ...control, view: "observed", playing: false })}>{observedLabel}</button>
        </div>
      </div>
      <div className={styles.stage}>
        <div className={styles.figures}>
          {(["Start", "Playback", "End"] as const).map((label, index) => {
            const frame = series.at([first, cursor, last][index], view);
            return (
              <figure key={label} className={styles.figure} aria-label={label} data-stage={label} data-month={frame.date}>
                <div className={styles.tag}>{label}</div>
                <StudyOrb region={region} channel={channel} level={scenePosition(frame.value, low, high)} zero={zero}
                  observed={view === "observed" ? frame.value : null}
                  animate={index === 1 && control.playing && !reduced} />
                <figcaption className={styles.reading}>
                  <time dateTime={frame.date}>{frame.label}</time>
                  <span>{frame.value === null ? "Unavailable" : numberText(frame.value)} {frame.value !== null && unit}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
        <div className={styles.controls}>
          <button type="button" disabled={first === last} aria-label={control.playing ? "Pause timeline" : "Play timeline"}
            onClick={() => setControl({ ...control, cursor: cursor === last ? first : cursor, playing: !control.playing })}>
            <span className={control.playing ? styles.pause : styles.play} aria-hidden="true" />
            {control.playing ? "Pause" : "Play"}
          </button>
          <input aria-label={series.annual ? "Timeline year" : "Timeline month"} type="range"
            aria-valuetext={current.label} min={first} max={last} step={1} value={cursor} disabled={first === last}
            onChange={event => setControl({ ...control, playing: false, cursor: Number(event.target.value) })} />
          <output>{current.label}</output>
        </div>
      </div>
      <div className={styles.key}>
        <p><strong>{variable.label}</strong> · {flat
          ? "Constant " + basis + " at " + numberText(low) + " " + unit
          : "Shared " + basis + " scale from " + numberText(low) + " to " + numberText(high) + " " + unit}</p>
        <p>The gold marker shows each value on this scale. {legend && "In 3D, " + legend[0].toLowerCase() + legend.slice(1) + " "}{view === "fit" && !series.annual
          ? "The fitted anomaly is the estimated departure from the reference average for that month."
          : view === "observed" ? "Each frame uses the reported regional value." : "Frames follow the annual fitted trend."} Terrain is illustrative.</p>
        {!hasFit && <p>{variable.reason || "This period has no supported trend estimate."}</p>}
      </div>
    </section>
  );
}
