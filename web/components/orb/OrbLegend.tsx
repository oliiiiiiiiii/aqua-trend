// The legend is the accessible representation of the crystal ball: every channel drawn in the glass has a row here
// with its variable, this month's value and unit, and the encoding in plain words.
import type { CSSProperties } from "react";
import { Provenance } from "@/components/ui/Provenance";
import type { Region, VarId } from "@/lib/types";
import { DATASET, VARIABLES, formatValue } from "@/lib/variables";
import {
  HATCH_CSS, LEAVES_NOTE, TAIR_DOMAIN, TAIR_GRADIENT_CSS, VARIANT_LABEL, encodingWords, monthLabel, sceneHasSoil, sceneryWords, soilCssAt, soilRampCss, tairCssAt,
  type OrbVariant, type Reading, type SceneryPlan,
} from "./encoding";

const hatch: CSSProperties = { background: HATCH_CSS };

export function Glyph({ id, r, tairCss }: { id: VarId; r: Reading; tairCss?: string | null }) {
  if (r.missing) return <span aria-hidden="true" className="mt-0.5 block h-6 w-6 rounded-[6px] border border-line" style={hatch} />;
  const color = `var(${VARIABLES[id].color})`;
  const common = { width: 24, height: 24, viewBox: "0 0 24 24", "aria-hidden": true, className: "mt-0.5 block shrink-0" } as const;
  switch (id) {
    case "precip":
      return <svg {...common}><g stroke={color} strokeWidth="2" strokeLinecap="round"><path d="M7 4l-2 7M13 3l-2.4 8.4M19 5l-2 7M10 13l-2 7M16 14l-2.2 7.4" /></g></svg>;
    case "et": {
      const fill = tairCss ?? "var(--paper)";
      return (
        <svg {...common}>
          <g fill={fill} stroke="var(--ink-3)" strokeWidth="1.2">
            <circle cx="9" cy="15.5" r="4.6" /><circle cx="15.5" cy="12.5" r="4" /><circle cx="11.5" cy="7.5" r="3.2" />
          </g>
        </svg>
      );
    }
    case "runoff":
      return <svg {...common}><g fill={color}><path d="M2 10h9V6.5L19 12l-8 5.5V14H2z" /><path d="M20 10.5l2 1.5-2 1.5z" /></g></svg>;
    case "soil_top":
    case "root_zone": {
      const fill = soilCssAt(r.t);
      const top = id === "soil_top";
      return (
        <svg {...common}>
          <rect x="2" y="3" width="20" height="18" rx="3" fill="var(--well)" stroke="var(--line)" />
          <rect x="2.5" y={top ? 6 : 9} width="19" height={top ? 3 : 8} fill={fill} />
          <g fill="var(--viz-blue)" opacity="0.9" stroke="var(--paper)" strokeWidth="0.5"><circle cx="6" cy={top ? 7.5 : 12} r="1" /><circle cx="12" cy={top ? 7.5 : 14.5} r="1" /><circle cx="17" cy={top ? 7.5 : 11} r="1" /></g>
          <line x1="2.5" x2="21.5" y1={top ? 9 : 9} y2={top ? 9 : 9} stroke="var(--ink-3)" strokeWidth="0.8" />
          {!top && <line x1="2.5" x2="21.5" y1="17" y2="17" stroke="var(--ink-3)" strokeWidth="0.8" />}
        </svg>
      );
    }
    case "swe":
      return <svg {...common}><path d="M2 20l6.5-9 3 3.5L15 9l7 11z" fill="var(--well)" stroke="var(--ink-3)" strokeWidth="1" /><path d="M12.6 12.4L15 9l2.6 3.8c-1.4.9-3.3.9-5 0z" fill="var(--paper)" stroke="var(--ink-3)" strokeWidth="1" /></svg>;
    case "tws":
      return <svg {...common}><rect x="8" y="2.5" width="8" height="19" rx="4" fill="var(--well)" stroke="var(--ink-3)" /><rect x="9" y="10" width="6" height="10.5" rx="3" fill={color} /></svg>;
    case "p_minus_et":
      return (
        <svg {...common}>
          <rect x="8" y="2.5" width="8" height="19" rx="2" fill="var(--well)" stroke="var(--ink-3)" />
          <rect x="9" y="6" width="6" height="6" fill="var(--viz-cool)" />
          <line x1="5" x2="19" y1="12" y2="12" stroke="var(--ink)" strokeWidth="1.5" />
        </svg>
      );
    default:
      return null;
  }
}

function RampBar({ id, r }: { id: VarId; r: Reading }) {
  const [lo, hi] = VARIABLES[id].domain;
  return (
    <div className="mt-1.5">
      <div className="relative h-2.5 rounded-full border border-line" style={{ background: soilRampCss() }}>
        {!r.missing && <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${r.t * 100}%` }} />}
      </div>
      <div className="mt-0.5 flex justify-between text-[0.75rem] text-ink-3 tnum">
        <span>{lo} {VARIABLES[id].unit}</span><span>{hi} {VARIABLES[id].unit}</span>
      </div>
    </div>
  );
}

function TempBar({ r }: { r: Reading }) {
  const [lo, hi] = TAIR_DOMAIN;
  const ticks = [-30, -15, 0, 15, 30, 40].filter((x) => x >= lo && x <= hi);
  const pos = (x: number) => ((x - lo) / (hi - lo)) * 100;
  return (
    <div className="mt-2 rounded-[10px] bg-well px-2.5 pb-2 pt-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
        <span className="font-semibold text-ink">Near-surface air temperature (°C)</span>
        <span className="tnum font-semibold whitespace-nowrap">{r.missing ? "No data" : formatValue("tair", r.value, true)}</span>
      </div>
      <div className="relative mt-1.5 h-2.5 rounded-full border border-line" style={r.missing ? hatch : { background: TAIR_GRADIENT_CSS }}>
        {!r.missing && <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${r.t * 100}%` }} />}
      </div>
      <div className="relative mt-0.5 h-4 text-[0.75rem] text-ink-3 tnum" aria-hidden="true">
        {ticks.map((x) => (
          <span key={x} className={`absolute top-0 ${x === lo ? "" : x === hi ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${pos(x)}%` }}>{x}</span>
        ))}
      </div>
      <p className="mt-1 text-[0.75rem] leading-snug text-ink-2">
        {r.missing
          ? "Air temperature is missing this month, so the puffs are grey."
          : "Puff colour encodes this month's regional air temperature. It is not the temperature of the vapour."}
      </p>
    </div>
  );
}

export interface OrbLegendProps {
  className?: string;
  region: Region;
  month: string;
  targets: VarId[];
  readings: Partial<Record<VarId, Reading>>;
  tair: Reading | null;
  scenery: SceneryPlan;
  /** the region has no land-model series: every channel is "no data" */
  noSeries: boolean;
  playing: boolean;
  webglNote?: string | null;
  /** diorama style (default: glass ball) */
  variant?: OrbVariant;
}

export default function OrbLegend({ className = "", region, month, targets, readings, tair, scenery, noSeries, playing, webglNote, variant = "glass" }: OrbLegendProps) {
  const hasSoil = sceneHasSoil(scenery, variant);
  const hasLand = scenery.kind !== "sea" || scenery.islet;
  const soilish = hasSoil && targets.some((t) => t === "soil_top" || t === "root_zone" || t === "tws");
  const reason = scenery.kind === "land" ? "No GLDAS series for this region." : "GLDAS Noah is a land model: no data over open ocean / ice sheets.";
  return (
    <section aria-label="Crystal ball legend" className={`rounded-card bg-paper p-4 text-ink shadow-card ${className}`}>
      <header>
        <h3 className="font-display text-lg text-ink">{region.name}</h3>
        <p className="tnum text-sm font-semibold text-ink-2" aria-live={playing ? "off" : "polite"}>{monthLabel(month)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {noSeries ? (
            <span className="text-[0.8125rem] text-ink-2">No land-model values for this region</span>
          ) : (
            <>
              <Provenance kind="real" />
              <span className="text-[0.8125rem] text-ink-2">Regional monthly means, {DATASET.short}</span>
            </>
          )}
        </div>
      </header>

      {webglNote && <p className="mt-3 rounded-[10px] bg-well px-3 py-2 text-[0.8125rem] text-ink-2">{webglNote}</p>}

      {targets.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">Choose up to three water targets to drive the ball.</p>
      ) : (
        <ul className="mt-3">
          {targets.map((id) => {
            const r = readings[id]!;
            const m = VARIABLES[id];
            const tairCss = id === "et" && tair ? (tair.missing ? null : tairCssAt(tair.t)) : null;
            return (
              <li key={id} className="grid grid-cols-[1.5rem_1fr] gap-x-2.5 border-t border-line py-2.5 first:border-t-0 first:pt-0">
                <Glyph id={id} r={r} tairCss={tairCss} />
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold leading-snug">{m.label}</span>
                    <span className="tnum whitespace-nowrap text-base font-semibold">
                      {r.missing ? <span className="text-ink-2">No data</span> : <>{formatValue(id, r.value)} <span className="text-sm font-normal text-ink-2">{m.unit}</span></>}
                    </span>
                  </div>
                  {r.missing ? (
                    <p className="text-[0.8125rem] leading-snug text-ink-2">
                      {noSeries ? reason : `No value in the regional series for ${monthLabel(month)}.`} Drawn grey and hatched, not as zero.
                    </p>
                  ) : (
                    <p className="text-[0.8125rem] leading-snug text-ink-2">{encodingWords(id, r, scenery, variant)}</p>
                  )}
                  {r.flag && (
                    <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink">
                      <span className="font-semibold">Clamped:</span> {r.flag === "above" ? "above" : "below"} the shared display range
                      ({m.domain[0]} to {m.domain[1]} {m.unit}), drawn at the {r.flag === "above" ? "maximum" : "minimum"}.
                    </p>
                  )}
                  {id === "runoff" && <p className="text-[0.75rem] leading-snug text-ink-3">Modelled runoff generation, not a river or gauged streamflow.</p>}
                  {!r.missing && (id === "soil_top" || id === "root_zone") && !hasSoil && (
                    <p className="text-[0.75rem] leading-snug text-ink-3">This scene has no soil layer, so the value is listed here and not drawn.</p>
                  )}
                  {!r.missing && (id === "swe" || id === "runoff") && !hasLand && (
                    <p className="text-[0.75rem] leading-snug text-ink-3">This scene has no land, so the value is listed here and not drawn.</p>
                  )}
                  {id === "swe" && <p className="text-[0.75rem] leading-snug text-ink-3">Water equivalent, not snow depth or snow cover.</p>}
                  {(id === "soil_top" || id === "root_zone") && <RampBar id={id} r={r} />}
                  {id === "et" && tair && <TempBar r={tair} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="mt-3 border-t border-line pt-3 text-[0.8125rem] leading-snug text-ink-2">
        <Provenance kind="illustrative" />
        <p className="mt-1.5">
          <span className="font-semibold text-ink">{variant === "glass" ? scenery.label : `${scenery.label}, ${VARIANT_LABEL[variant].toLowerCase()}`}.</span> {sceneryWords(scenery, variant)} Cloud, ground and plants are
          decoration. Particles encode monthly rates moving at a fixed speed, not tracked water.
          {scenery.kind !== "land" && !noSeries && " Values are for the land cells GLDAS covers in this region, not for the sea or ice."}
          {soilish && " The deepest layer is not covered: GLDAS Noah has no groundwater."}
        </p>
        {hasLand && scenery.kind !== "ice" && !noSeries && <p className="mt-1">{LEAVES_NOTE}</p>}
        <p className="mt-1 text-ink-3">Drag the ball to turn it.</p>
      </footer>
    </section>
  );
}
