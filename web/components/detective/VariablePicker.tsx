"use client";
// Step 4 of the input: the AI (or keyword) vote per category as a grid of pre-ticked toggle chips.
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import type { CategoryId, CategoryVote, SelectResponse } from "@/lib/detective/contracts";
import { CATEGORY_IDS } from "@/lib/detective/url";
import type { CategoryInfo } from "./wiring";
import { COPY } from "./copy/input";
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

/** The primary action; the overlay and the column each render one, never both at once. */
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
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const k = width < 470 ? 3 : 5;
  return { ref, k, width };
}

export function VariablePicker({ layout = "inline", onClose, closeRef, ...props }: VariablePickerProps & {
  /** "overlay": no card of its own, a larger title and a close button; the parent supplies the frosted panel */
  layout?: "inline" | "overlay";
  onClose?: () => void;
  closeRef?: Ref<HTMLButtonElement>;
}) {
  const { categories, response, loading, checked, onChange, available, unavailableReason, blocked } = props;
  const id = useId();
  const hc = useHoneycomb();
  const overlay = layout === "overlay";
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
  // with a vote: its picks first, the rest quieter; without one (link, still asking) a single plain grid
  // same-family tiles sit next to each other (family order from FAMILIES, then the usual category order)
  const familyRank = Object.keys(FAMILIES);
  const byFamily = [...CATEGORY_IDS].sort((a, b) => familyRank.indexOf(CATEGORY_FAMILY[a]) - familyRank.indexOf(CATEGORY_FAMILY[b]));
  const suggested = response ? byFamily.filter((c) => votes.get(c)?.selected) : [];
  const others = byFamily.filter((c) => !suggested.includes(c));

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
          title={ok ? info.definition.en : `${info.name.en}: ${reason}`}
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
            className={`absolute inset-0 ${overlay ? "" : "backdrop-blur-md"} ${!ok || checkedNow ? "" : quiet ? FROST_QUIET : FROST}`}
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
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-[16%] pt-[4%]">
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${CHIP_STROKE[categoryStyle(c).family] ?? "text-on-stage"}`}
              style={{ background: fam, opacity: ok ? 1 : 0.6 }}
            >
              <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={info.icon} />
              </svg>
            </span>
            <span className="line-clamp-2 min-w-0 text-[10.5px] min-[420px]:text-[11px]">{info.name.en}</span>
          </span>
          {checkedNow && (
            <span className="absolute grid h-4 w-4 place-items-center rounded-full text-paper" style={{ background: fam, right: "21%", top: "10%" }} aria-hidden="true">
              <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
          )}
          <span className="sr-only">
            {!ok ? `. ${reason}` : `. ${info.definition.en}${pct !== null && !keyword ? ` Probability ${pct}%.` : ""}${keyword && vote && vote.p >= 0.5 ? ` ${T.keyword}.` : ""}`}
          </span>
        </label>
      </li>
    );
  };
  const cluster = (list: CategoryId[], quiet: boolean): ReactNode => {
    const geometry = honeycombLayout(list.length, hc.k, hc.width);
    return (
      <ul aria-label={quiet ? T.others : T.suggested} className="relative" style={{ height: geometry.height }}>
        {list.map((c, i) => chip(c, quiet, { ...geometry.tiles[i], w: geometry.w, h: geometry.h }))}
      </ul>
    );
  };

  const Root = overlay ? "div" : "section";
  const sourceLine = loading ? T.asking : response ? T.source[response.source] : T.yours;
  return (
    <Root {...(overlay ? {} : { "aria-labelledby": `${id}-h` })} className="min-w-0 text-on-stage">
      <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${overlay ? "pr-12" : ""}`}>
        <h2 id={`${id}-h`} className={`flex items-center ${overlay ? "font-display text-3xl" : "text-xl"}`}>
          {T.heading}
        </h2>
        <span className="text-[10px] text-on-stage-2" role="status">{sourceLine}</span>
      </div>
      {overlay && onClose && (
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={T.close}
          title={`${T.close} (Esc)`}
          className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-on-stage hover:bg-on-stage/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}

      <fieldset className={`min-w-0 ${overlay ? "py-4" : "mt-3"}`}>
        <legend className="sr-only">{T.group}</legend>
        <div ref={hc.ref} className={`w-full min-w-0 overflow-x-clip ${overlay ? "mx-auto max-w-[36rem]" : ""}`}>
        {suggested.length > 0 && cluster(suggested, false)}
        {others.length > 0 && (
          <>
            {suggested.length > 0 && <p className="mt-3 mb-1.5 text-xs text-on-stage-2">{T.others}</p>}
            {cluster(others, !!response)}
          </>
        )}
        </div>
      </fieldset>

      <div className={`flex flex-wrap items-center gap-3 ${overlay ? "mt-2 justify-center" : "mt-4"}`}>
        <AnalyseButton picker={props} />
        {blocked && <span className="text-sm text-on-stage-2">{blocked}</span>}
      </div>
    </Root>
  );
}
