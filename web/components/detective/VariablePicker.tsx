"use client";
// Step 4 of the input: the AI (or keyword) vote per category as a grid of pre-ticked toggle chips.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { CategoryId, CategoryVote, SelectResponse } from "@/lib/detective/contracts";
import { CATEGORY_IDS } from "@/lib/detective/url";
import type { CategoryInfo } from "./wiring";
import { COPY } from "./copy/input";
import { CATEGORY_FAMILY, FAMILIES, categoryStyle } from "@/lib/detective/categoryStyle";

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

// frosted glass: the stage colour pulled toward a fixed deep navy, translucent, so the tile reads as part of the sky
const FROST = "bg-[color-mix(in_srgb,var(--stage)_38%,#07142a)]/65";
const FROST_QUIET = "bg-[color-mix(in_srgb,var(--stage)_38%,#07142a)]/45";
// pointy-top hexagon, 100 x 115.47; the clip is the fill, the polygon the outline
const HEX_CLIP = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";
const HEX_PTS = "50,2 98,29.5 98,86 50,113.5 2,86 2,29.5";
const GAP = 3;
// glyph stroke on the solid family chip, picked for >= 3:1 per theme (white vs deep navy)
const DARK = "text-[#07142a]";
const CHIP_STROKE: Partial<Record<string, string>> = {
  "land-water": "text-white",
  "air-water": DARK,
  heat: "text-white",
  life: "text-white",
  air: "text-white [[data-theme=night]_&]:text-[#07142a]",
  wind: DARK,
};

/** rows of k, k-1, k, ... so the odd rows sit half a hex in; k and the hex width follow the column width */
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
  const w = Math.floor((width - GAP * (k - 1)) / k);
  return { ref, k, w, h: w * 1.1547 };
}

export function VariablePicker({ categories, response, loading, checked, onChange, available, unavailableReason, onStart, blocked }: VariablePickerProps) {
  const id = useId();
  const hc = useHoneycomb();
  const T = COPY.picker;
  const votes = new Map<CategoryId, CategoryVote>((response?.votes ?? []).map((v) => [v.category, v]));
  const on = new Set(checked);
  const usable = (c: CategoryId) => !available || available[c];
  const startable = checked.filter(usable);
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

  const chip = (c: CategoryId, quiet: boolean) => {
    const info = categories[c];
    const vote = votes.get(c);
    const ok = usable(c);
    const reason = unavailableReason?.[c] ?? T.noData;
    const pct = vote ? Math.round(Math.max(0, Math.min(1, vote.p)) * 100) : null;
    const checkedNow = ok && on.has(c);
    const fam = categoryStyle(c).color;
    return (
      <li key={c} style={{ width: hc.w, height: hc.h }} className="shrink-0">
        <label
          title={ok ? info.definition.en : `${info.name.en}: ${reason}`}
          className={`relative block h-full w-full text-center leading-tight ${
            !ok ? "cursor-not-allowed text-on-stage-2" : checkedNow ? "cursor-pointer font-semibold text-ink" : `cursor-pointer ${quiet ? "text-on-stage-2" : "text-on-stage"}`
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
            style={{ clipPath: HEX_CLIP }}
            className={`absolute inset-0 backdrop-blur-md ${!ok ? "" : checkedNow ? "bg-paper" : quiet ? FROST_QUIET : FROST}`}
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
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${CHIP_STROKE[categoryStyle(c).family] ?? "text-white"}`}
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
    const rows: CategoryId[][] = [];
    for (let i = 0, n = 0; i < list.length; n++) {
      const len = n % 2 ? hc.k - 1 : hc.k;
      rows.push(list.slice(i, i + len));
      i += len;
    }
    return (
      <div className="flex flex-col items-center">
        {rows.map((r, i) => (
          <ul key={i} className="flex justify-center" style={{ gap: GAP, marginTop: i ? -hc.h * 0.25 + GAP : 0 }}>
            {r.map((c) => chip(c, quiet))}
          </ul>
        ))}
      </div>
    );
  };

  return (
    <section aria-labelledby={`${id}-h`} className="min-w-0 text-on-stage">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-h`} className="flex items-center text-xl">
          {T.heading}
        </h2>
        <p className="text-xs text-on-stage-2" role="status">
          {loading ? T.asking : response ? T.source[response.source] : T.yours}
        </p>
      </div>

      <fieldset className="mt-3 min-w-0">
        <legend className="sr-only">{T.group}</legend>
        <div ref={hc.ref} className="w-full min-w-0 overflow-x-clip">
        {suggested.length > 0 && cluster(suggested, false)}
        {others.length > 0 && (
          <>
            {suggested.length > 0 && <p className="mt-3 mb-1.5 text-xs text-on-stage-2">{T.others}</p>}
            {cluster(others, !!response)}
          </>
        )}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={!!blocked}
          className="rounded-ctl bg-action px-5 py-2 font-semibold text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {T.analyse(startable.length)}
        </button>
        {blocked && <span className="text-sm text-on-stage-2">{blocked}</span>}
      </div>
    </section>
  );
}
