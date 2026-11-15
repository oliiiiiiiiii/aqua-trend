"use client";
// One disclosure over the globe: a compact picked-variable bar or the complete honeycomb.
import { useEffect, useId, useRef, useState } from "react";
import type { CategoryId, CategoryVote, SelectResponse } from "@/lib/detective/contracts";
import { CATEGORY_IDS } from "@/lib/detective/url";
import type { CategoryInfo } from "./wiring";
import { COPY, VARIABLE_LABELS } from "./copy/input";
import { CATEGORY_FAMILY, FAMILIES, categoryStyle } from "@/lib/detective/categoryStyle";
import { honeycombLayout } from "./honeycomb";

export interface VariablePickerProps {
  categories: Readonly<Record<CategoryId, CategoryInfo>>;
  /** the vote; null while it is being asked or when the picks came from a link */
  response: SelectResponse | null;
  loading: boolean;
  checked: readonly CategoryId[];
  onChange: (checked: CategoryId[]) => void;
  /** which categories the chosen sub-basin has data for; null = no sub-basin yet (all enabled) */
  available: Readonly<Record<CategoryId, boolean>> | null;
  unavailableReason?: Partial<Record<CategoryId, string>>;
  onStart: () => void;
  /** why Start is disabled, or null when it can run */
  blocked: string | null;
}

/** how many ticked categories the chosen sub-basin can run */
export function startableCount(p: Pick<VariablePickerProps, "checked" | "available">): number {
  return p.checked.filter((c) => !p.available || p.available[c]).length;
}

/** One primary action at the foot of the input column. */
export function AnalyseButton({ picker, className = "" }: { picker: VariablePickerProps; className?: string }) {
  return (
    <button
      type="button"
      onClick={picker.onStart}
      disabled={!!picker.blocked}
      className={`min-h-11 rounded-ctl bg-action px-5 py-2 font-semibold text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {COPY.picker.analyse(startableCount(picker))}
    </button>
  );
}

// Frosted tiles share the stage tokens in every look.
const FROST = "bg-stage/65";
const FROST_QUIET = "bg-stage/45";
// pointy-top hexagon, 100 x 115.47; the clip is the fill, the polygon the outline
const HEX_CLIP = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";
const HEX_PTS = "50,2 98,29.5 98,86 50,113.5 2,86 2,29.5";
// Glyphs use the semantic foreground appropriate to the family chip.
const DARK = "text-on-action";
const CHIP_STROKE: Partial<Record<string, string>> = {
  "land-water": "text-on-stage",
  "air-water": DARK,
  heat: "text-on-stage",
  life: "text-on-stage",
  air: "text-on-action",
  wind: DARK,
};

/** Row capacity follows the available cluster width. */
function useHoneycomb() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(540);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth > 0) setWidth(el.clientWidth); };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const k = width < 360 ? 3 : width < 420 ? 4 : 5;
  return { ref, k, width };
}

export function VariablePicker(props: VariablePickerProps) {
  const { categories, response, loading, checked, onChange, available, unavailableReason } = props;
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const arrived = useRef(false);
  useEffect(() => {
    if (response && !arrived.current) { arrived.current = true; setExpanded(true); }
  }, [response]);
  const hc = useHoneycomb();
  const T = COPY.picker;
  const votes = new Map<CategoryId, CategoryVote>((response?.votes ?? []).map((v) => [v.category, v]));
  const on = new Set(checked);
  const usable = (c: CategoryId) => !available || available[c];
  const toggle = (c: CategoryId, v: boolean) => {
    const next = new Set(on);
    if (v) next.add(c); else next.delete(c);
    onChange(CATEGORY_IDS.filter((x) => next.has(x)));
  };
  const keyword = response?.source === "keyword-fallback";
  // Keep one stable family-grouped lattice when suggestions or selections change.
  const familyRank = Object.keys(FAMILIES);
  const byFamily = [...CATEGORY_IDS].sort((a, b) => familyRank.indexOf(CATEGORY_FAMILY[a]) - familyRank.indexOf(CATEGORY_FAMILY[b]));

  const chip = (c: CategoryId, quiet: boolean, box: { x: number; y: number; w: number; h: number }) => {
    const info = categories[c];
    const vote = votes.get(c);
    const ok = usable(c);
    const reason = unavailableReason?.[c] ?? T.noData;
    const pct = vote ? Math.round(Math.max(0, Math.min(1, vote.p)) * 100) : null;
    const checkedNow = ok && on.has(c);
    const fam = categoryStyle(c).color;
    return (
      <li key={c} style={{ left: box.x, top: box.y, width: box.w, height: box.h }} className="absolute">
        <label
          style={{ clipPath: HEX_CLIP }}
          title={`${info.name.en}: ${ok ? info.definition.en : reason}`}
          className={`relative block h-full w-full text-center leading-tight ${
            !ok ? "cursor-not-allowed text-on-stage-2" : checkedNow ? "cursor-pointer font-semibold text-on-stage" : `cursor-pointer ${quiet ? "text-on-stage-2" : "text-on-stage"}`
          }`}
        >
          <input
            type="checkbox"
            checked={checkedNow}
            disabled={!ok}
            onChange={(e) => toggle(c, e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            style={{ clipPath: HEX_CLIP, ...(checkedNow ? { background: `color-mix(in srgb, ${fam} 34%, var(--stage))` } : null) }}
            className={`absolute inset-0 backdrop-blur-md ${!ok || checkedNow ? "" : quiet ? FROST_QUIET : FROST}`}
          />
          <svg viewBox="0 0 100 115.47" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <polygon
              points={HEX_PTS}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeWidth={checkedNow ? 3 : 1}
              strokeDasharray={!ok ? "5 4" : undefined}
              stroke={checkedNow ? fam : !ok ? "var(--on-stage-2)" : "var(--stage-line)"}
              className={ok && !checkedNow ? "[label:hover_&]:stroke-[var(--on-stage)]" : undefined}
            />
            <polygon
              points={HEX_PTS}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeWidth={5}
              stroke="var(--on-stage)"
              className="opacity-0 [.peer:focus-visible~svg_&]:opacity-100"
            />
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-[10%] pt-[4%]">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${CHIP_STROKE[categoryStyle(c).family] ?? "text-on-stage"}`}
              style={{ background: fam, opacity: ok ? 1 : 0.6 }}
            >
              <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={info.icon} />
              </svg>
            </span>
            <span className="min-w-0 max-w-full text-[10px] leading-tight [overflow-wrap:anywhere] min-[420px]:text-[11px]">{VARIABLE_LABELS[c] ?? info.name.en}</span>
          </span>
          {checkedNow && (
            <span className="absolute grid h-4 w-4 place-items-center rounded-full text-paper" style={{ background: fam, right: "21%", top: "10%" }} aria-hidden="true">
              <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
          )}
          <span className="sr-only">
            {`. ${info.name.en}. `}{!ok ? reason : `${info.definition.en}${pct !== null && !keyword ? ` Probability ${pct}%.` : ""}${keyword && vote && vote.p >= 0.5 ? ` ${T.keyword}.` : ""}`}
          </span>
        </label>
      </li>
    );
  };
  const geometry = honeycombLayout(byFamily.length, hc.k, hc.width);
  const sourceLine = response ? T.source[response.source] : null;
  return (
    <section
      data-variable-panel
      data-expanded={expanded}
      aria-labelledby={`${id}-h`}
      className={`pointer-events-auto min-w-0 overflow-hidden border border-stage-line bg-stage/65 text-on-stage backdrop-blur-md ${expanded ? "rounded-card" : "rounded-ctl"}`}
    >
      <h2 id={`${id}-h`}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={`${id}-tiles`}
          title={expanded ? T.collapse : T.expand}
          className="flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-on-stage/5"
        >
          <span className="flex shrink-0 items-baseline gap-2">
            <span className="text-sm font-semibold">{T.heading}</span>
            {sourceLine && <span className="text-[10px] font-normal text-on-stage-2">{sourceLine}</span>}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" aria-hidden="true">
            {!expanded && byFamily.filter((c) => on.has(c)).map((c) => (
              <span key={c} title={categories[c].name.en} className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${CHIP_STROKE[categoryStyle(c).family]}`} style={{ background: categoryStyle(c).color }}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={categories[c].icon}/></svg>
              </span>
            ))}
          </span>
          {loading ? <span role="status" className="shrink-0 text-xs font-normal text-on-stage-2">{T.asking}</span> : <span className="text-xs font-normal text-on-stage-2 tnum">{checked.length}</span>}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </button>
      </h2>
      <div id={`${id}-tiles`} hidden={!expanded} className="px-3 pt-2 pb-5 sm:px-5">
        <fieldset className="min-w-0">
          <legend className="sr-only">{T.group}</legend>
          <div ref={hc.ref} className="w-full min-w-0">
            <ul aria-label={T.group} className="relative" style={{ height: geometry.height }}>
              {byFamily.map((c, i) => chip(c, !on.has(c) && !votes.get(c)?.selected, { ...geometry.tiles[i], w: geometry.w, h: geometry.h }))}
            </ul>
          </div>
        </fieldset>
      </div>
    </section>
  );
}
