"use client";
// Single-select variable dropdown for the analysis workbench (replaces the stacked lane list).
//
// The trigger and every option show the variable's icon chip (family colour), name, product · unit, a sparkline of
// its monthly anomaly over the current window (one shared time axis and σ scale across the list), the selection's
// mean σ and its verdict mark. The open list is the cross-variable comparison.
//
// Accessibility: a button (aria-haspopup="listbox", aria-expanded) opens a listbox that takes focus and tracks the
// active option with aria-activedescendant. ↑ ↓ Home End move, typing a name jumps to it, Enter / Space choose,
// Esc / Tab close; focus returns to the trigger. Options that cannot be chosen stay listed with aria-disabled and
// show why (loading, no data, error).
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CategoryId } from "@/lib/detective/contracts";
import type { IntervalDetail } from "@/lib/detective/intervalDetail";
import { categoryStyle, chipColors } from "@/lib/detective/categoryStyle";
import { formatYm, ymFromIndex } from "@/lib/detective/url";
import { HypothesisChip, VerdictMark } from "../workbench/bits";
import { orderLanes, sigmaText, verdictView, type Span } from "../workbench/model";
import { COPY } from "../copy/picker";
import Sparkline, { SPARK_SCALE } from "./Sparkline";

export interface VariableItem {
  id: CategoryId;
  /** "Soil moisture" */
  name: string;
  /** "GLDAS Noah 2.1" */
  product?: string;
  unit?: string;
  /** override the family style (categoryStyle(id)) */
  icon?: string;
  color?: string;
  polarity: "cool" | "warm";
  /** the monthly anomaly in σ (Decomposition.z) and the absolute month index (ymIndex) of z[0]; null = none yet */
  series: { z: (number | null)[]; base: number } | null;
  /** statistics of the current selection (mean σ, verdict) */
  detail: IntervalDetail | null;
  /** the preset's hypothesis, if any */
  expected?: "high" | "low";
  /** set = listed but cannot be chosen; the text says why ("Loading…", "No data here", an error) */
  disabled?: string;
}

export interface VariableSelectProps {
  items: VariableItem[];
  value: CategoryId;
  onChange: (id: CategoryId) => void;
  /** months shown (inclusive absolute month indices); every sparkline uses it */
  view: Span;
  event: Span;
  /** the shared selection */
  sel: Span;
  /** "picked" keeps `items` as given (pass a pre-sorted list); "unusual" sorts by |mean σ| of the selection */
  order?: "picked" | "unusual";
  /** visible label before the trigger; omit to keep it for screen readers only */
  label?: string;
  className?: string;
}

/* ------------------------------------------------------------------ icon chip */

export function VariableIcon({ icon, color, size = 28, className = "" }: { icon: string; color: string; size?: number; className?: string }) {
  const c = chipColors(color);
  return (
    <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center rounded-[7px] ${className}`} style={{ width: size, height: size, background: c.background }}>
      <svg width={size * 0.68} height={size * 0.68} viewBox="0 0 24 24" fill="none" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: c.stroke }}>
        <path d={icon} />
      </svg>
    </span>
  );
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--ink-2)" }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/* ------------------------------------------------------------------ the dropdown */

const TYPEAHEAD_MS = 600;

export default function VariableSelect({ items: given, value, onChange, view, event, sel, order = "picked", label, className = "" }: VariableSelectProps) {
  const uid = useId();
  const listId = `${uid}-list`, labelId = `${uid}-label`;
  const optId = (c: CategoryId) => `${uid}-opt-${c}`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<CategoryId>(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const items = useMemo(
    () => orderLanes(given, order, (it) => (it.detail?.meanZ == null ? null : Math.abs(it.detail.meanZ))),
    [given, order],
  );
  // one fixed symmetric scale for every sparkline, so heights compare across variables; larger |z| is clipped
  const scale = SPARK_SCALE;
  const current = items.find((it) => it.id === value) ?? items[0];

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);
  const openList = (at: CategoryId = value) => { setActive(at); setOpen(true); };
  const choose = (it: VariableItem) => {
    if (it.disabled) return;
    if (it.id !== value) onChange(it.id);
    close(true);
  };

  // the list takes focus when it opens; keep the active option in view
  useEffect(() => { if (open) listRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    document.getElementById(optId(active))?.scrollIntoView({ block: "nearest" });
  }, [open, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // a pointer press outside closes without moving focus
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, close]);

  const move = (from: CategoryId, d: 1 | -1 | "home" | "end") => {
    const i = items.findIndex((it) => it.id === from);
    const j = d === "home" ? 0 : d === "end" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + d));
    return items[j]?.id ?? from;
  };

  const typeahead = (ch: string) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > TYPEAHEAD_MS ? ch.toLowerCase() : t.text + ch.toLowerCase();
    t.at = now;
    const i = items.findIndex((it) => it.id === active);
    const rotated = [...items.slice(i + (t.text.length === 1 ? 1 : 0)), ...items.slice(0, i + (t.text.length === 1 ? 1 : 0))];
    return rotated.find((it) => it.name.toLowerCase().startsWith(t.text))?.id ?? null;
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openList(value); }
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const hit = typeahead(e.key);
      if (hit) { e.preventDefault(); openList(hit); }
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const k = e.key;
    if (k === "ArrowDown") setActive((a) => move(a, 1));
    else if (k === "ArrowUp") setActive((a) => move(a, -1));
    else if (k === "Home" || k === "PageUp") setActive((a) => move(a, "home"));
    else if (k === "End" || k === "PageDown") setActive((a) => move(a, "end"));
    else if (k === "Enter" || k === " ") { const it = items.find((x) => x.id === active); if (it) choose(it); }
    else if (k === "Escape") close(true);
    else if (k === "Tab") { close(false); return; }
    else if (k.length === 1 && /\S/.test(k) && !e.metaKey && !e.ctrlKey && !e.altKey) { const hit = typeahead(k); if (hit) setActive(hit); }
    else return;
    e.preventDefault();
  };

  if (!current) return null;
  const st = (it: VariableItem) => {
    const s = categoryStyle(it.id);
    return { icon: it.icon ?? s.icon, color: it.color ?? s.color };
  };
  const cs = st(current);
  const sub = (it: VariableItem) => [it.product, it.unit].filter(Boolean).join(" · ");

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <span id={labelId} className={label ? "mb-1 block text-sm text-ink-2" : "sr-only"}>{label ?? COPY.label}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${uid}-current`}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onTriggerKey}
        className={`grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 border-b border-line py-1.5 pr-1 text-left hover:border-ink-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(7.5rem,10rem)_3.5rem_auto_auto] ${open ? "border-ink-3" : ""}`}
      >
        <VariableIcon icon={cs.icon} color={cs.color} size={32} />
        <span id={`${uid}-current`} className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-lg font-semibold text-ink">{current.name}</span>
          {sub(current) && <span className="hidden truncate text-xs text-ink-2 sm:block">{sub(current)}</span>}
        </span>
        <span className="hidden min-w-0 sm:block">
          {current.series ? (
            <Sparkline z={current.series.z} base={current.series.base} view={view} event={event} sel={sel} polarity={current.polarity} scale={scale} />
          ) : <span className="text-xs text-ink-3">{current.disabled}</span>}
        </span>
        <span className="text-right text-sm font-semibold text-ink tnum" title={COPY.meanZTitle}>{sigmaText(current.detail?.meanZ)}</span>
        <span className="hidden sm:inline-flex"><VerdictMark d={current.detail} polarity={current.polarity} /></span>
        <Chevron open={open} />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 left-0 z-40 mt-1 min-w-[min(100vw-2rem,22rem)] border border-line bg-paper py-1 shadow-card"
          style={{ borderRadius: "min(var(--r-ctl), 12px)" }}
        >
          {/* shared column heads: the window's first and last month over the sparklines */}
          <div aria-hidden="true" className="grid grid-cols-[2rem_minmax(0,1fr)_3.25rem_1rem] gap-x-3 px-2.5 pt-1 pb-1.5 text-[0.6875rem] leading-none text-ink-3 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(7.5rem,10rem)_3.25rem_1rem]">
            <span />
            <span />
            <span className="hidden justify-between tnum sm:flex"><span>{formatYm(ymFromIndex(view.s))}</span><span>{formatYm(ymFromIndex(view.e))}</span></span>
            <span className="text-right">{COPY.meanZ}</span>
            <span />
          </div>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={labelId}
            aria-activedescendant={optId(active)}
            onKeyDown={onListKey}
            className="max-h-[min(70vh,34rem)] overflow-y-auto outline-none"
          >
            {items.map((it) => {
              const s = st(it);
              const selected = it.id === value;
              const isActive = it.id === active;
              const v = verdictView(it.detail);
              return (
                <li
                  key={it.id}
                  id={optId(it.id)}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={it.disabled ? true : undefined}
                  aria-label={COPY.optionLabel(it.name, it.disabled ?? sigmaText(it.detail?.meanZ), it.disabled ? "" : v.title)}
                  onPointerMove={() => !isActive && setActive(it.id)}
                  onClick={() => choose(it)}
                  className={`grid grid-cols-[2rem_minmax(0,1fr)_3.25rem_1rem] items-center gap-x-3 gap-y-1 px-2.5 py-1.5 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(7.5rem,10rem)_3.25rem_1rem] ${
                    it.disabled ? "cursor-default" : "cursor-pointer"
                  } ${isActive ? "bg-well" : ""} ${isActive && open ? "outline-2 -outline-offset-2 outline-focus/60" : ""}`}
                >
                  <span className="relative">
                    {selected && <span aria-hidden="true" className="absolute top-0.5 bottom-0.5 -left-2.5 w-[3px] rounded-r-full bg-focus" />}
                    <VariableIcon icon={s.icon} color={s.color} size={28} className={it.disabled ? "opacity-50" : ""} />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className={`flex min-w-0 items-center gap-1.5 ${it.disabled ? "text-ink-2" : "text-ink"}`}>
                      <span className={`truncate ${selected ? "font-semibold" : ""}`}>{it.name}</span>
                      {it.expected && !it.disabled && <HypothesisChip expected={it.expected} d={it.detail} />}
                    </span>
                    <span className="truncate text-xs text-ink-2">{it.disabled ?? sub(it)}</span>
                  </span>
                  {/* phones: the sparkline gets its own row under the name */}
                  <span className="col-span-3 col-start-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1">
                    {it.series && !it.disabled ? (
                      <span className="block max-w-[11.25rem] sm:max-w-none">
                        <Sparkline z={it.series.z} base={it.series.base} view={view} event={event} sel={sel} polarity={it.polarity} scale={scale} />
                      </span>
                    ) : null}
                  </span>
                  <span className={`text-right text-sm tnum ${it.disabled ? "text-ink-3" : "font-semibold text-ink"}`}>{it.disabled ? "" : sigmaText(it.detail?.meanZ)}</span>
                  <span className="flex items-center justify-end">
                    {!it.disabled && <VerdictMark d={it.detail} polarity={it.polarity} />}
                  </span>
                </li>
              );
            })}
          </ul>
          <p aria-hidden="true" className="flex items-center gap-2 border-t border-line px-2.5 pt-1.5 pb-1 text-[0.6875rem] text-ink-3">
            <span className="inline-block h-2 w-3" style={{ background: "var(--action)", opacity: 0.5 }} />{COPY.event}
            <span className="ml-2 inline-block h-2 w-3 border-[1.25px] border-focus" />{COPY.selection}
            <span className="ml-auto tnum">{COPY.scale(scale)} · {COPY.guides}</span>
          </p>
        </div>
      )}
    </div>
  );
}
