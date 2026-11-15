"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { RetryButton, StatusCard } from "@/components/explore/StatusCard";
import type { ExploreState } from "@/components/explore/useExploreState";
import { chooseScenery, encodingWords, monthLabel, readValue, sceneryWords } from "@/components/orb/encoding";
import { Provenance } from "@/components/ui/Provenance";
import type { Region, VarId } from "@/lib/types";
import { DATASET, VARIABLES, formatValue } from "@/lib/variables";

const CrystalBall = dynamic(() => import("@/components/orb/CrystalBall"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-ink-2" role="status">
      Loading the crystal ball…
    </div>
  ),
});

type Side = "l" | "r";
/** Where each channel is drawn inside the ball, in units of the ball radius from its centre (gauges are found in the DOM). */
const SPOT: Record<VarId, { side: Side; x: number; y: number } | { side: Side; gauge: true }> = {
  precip: { side: "r", x: 0.3, y: -0.3 },
  et: { side: "l", x: -0.34, y: -0.3 },
  runoff: { side: "r", x: 0.6, y: 0.2 },
  soil_top: { side: "l", x: -0.6, y: 0.36 },
  root_zone: { side: "l", x: -0.5, y: 0.55 },
  swe: { side: "l", x: -0.28, y: -0.02 },
  tws: { side: "r", gauge: true },
  p_minus_et: { side: "r", gauge: true },
  tair: { side: "l", x: 0, y: 0 },
};
const spotY = (v: VarId) => {
  const s = SPOT[v];
  return "y" in s ? s.y : 2; // gauges sit lowest on the right
};

interface Leader { v: VarId; d: string; tx: number; ty: number; dashed: boolean }

/**
 * The crystal ball as a plate in a notebook: the ball in the middle, this month's values written as margin notes
 * on either side, each joined to the part of the ball it drives by a thin leader line. The numbers and the mapping
 * words come from `components/orb/encoding.ts`, the same code the ball is drawn with.
 */
export function Figure({ s, wide }: { s: ExploreState; wide: boolean }) {
  const { region, series, targets, values } = s;
  const ready = s.seriesStatus === "ready";
  const noData = ready && series === null;

  if (!region) return null;
  if (s.seriesStatus === "loading") {
    return (
      <p role="status" className="grid min-h-[16rem] place-items-center text-center text-ink-2">
        Loading the monthly series for {region.name}…
      </p>
    );
  }
  if (s.seriesStatus === "error") {
    return (
      <div className="grid min-h-[16rem] place-items-center">
        <StatusCard className="max-w-md" title="The monthly series did not load" action={<RetryButton onClick={s.retrySeries} />}>
          <p>{s.seriesError}</p>
          <p>Try again, or change the region.</p>
        </StatusCard>
      </div>
    );
  }
  return <Plate s={s} region={region} noData={noData} wide={wide} targets={targets} values={values} />;
}

function Plate({ s, region, noData, wide, targets, values }: { s: ExploreState; region: Region; noData: boolean; wide: boolean; targets: VarId[]; values: ExploreState["values"] }) {
  const plan = useMemo(() => chooseScenery(region, s.climate), [region, s.climate]);
  const hasSoil = plan.kind === "land" || (plan.kind === "coast" && plan.landSide === "land");
  const boxRef = useRef<HTMLDivElement>(null);
  const notes = useRef<Partial<Record<VarId, HTMLElement | null>>>({});
  const [geo, setGeo] = useState<{ w: number; h: number; leaders: Leader[] }>({ w: 0, h: 0, leaders: [] });
  const lastKey = useRef("");

  const left = targets.filter((v) => SPOT[v].side === "l").sort((a, b) => spotY(a) - spotY(b));
  const right = targets.filter((v) => SPOT[v].side === "r").sort((a, b) => spotY(a) - spotY(b));

  // Measure the callouts and the ball, then draw the leaders in the figure's own pixel space.
  useEffect(() => {
    const measure = () => {
      const box = boxRef.current;
      if (!box) return;
      const b = box.getBoundingClientRect();
      const host = box.querySelector<HTMLElement>("[data-ball] [role='img']");
      let leaders: Leader[] = [];
      if (wide && host && b.width > 0) {
        const h = host.getBoundingClientRect();
        const R = Math.min(h.width * 0.4, h.height * 0.372);
        const cx = h.left + h.width / 2 - b.left;
        const cy = h.top + h.height * 0.38 - b.top;
        const gaugeEls = Array.from(host.nextElementSibling?.children ?? []);
        const gaugeIds = targets.filter((t) => t === "tws" || t === "p_minus_et");
        for (const v of targets) {
          const el = notes.current[v];
          const spot = SPOT[v];
          if (!el) continue;
          if ((v === "soil_top" || v === "root_zone") && !hasSoil) continue;
          const e = el.getBoundingClientRect();
          const x1 = (spot.side === "l" ? e.right : e.left) - b.left + (spot.side === "l" ? 6 : -6);
          const y1 = e.bottom - b.top;
          let tx: number, ty: number;
          if ("gauge" in spot) {
            const g = gaugeEls[gaugeIds.indexOf(v as "tws" | "p_minus_et")]?.getBoundingClientRect();
            if (!g) continue;
            tx = g.left - b.left;
            ty = g.top + g.height * 0.4 - b.top;
          } else {
            tx = cx + spot.x * R;
            ty = cy + spot.y * R;
          }
          // horizontal run along the note's underline, then a 45-degree finish onto the target
          const dir = tx >= x1 ? 1 : -1;
          const dy = ty - y1;
          const xe = tx - dir * Math.min(Math.abs(dy), Math.abs(tx - x1) * 0.7);
          const d = `M${x1.toFixed(1)} ${y1.toFixed(1)}H${xe.toFixed(1)}L${tx.toFixed(1)} ${ty.toFixed(1)}`;
          leaders.push({ v, d, tx, ty, dashed: readValue(v, s.series ? values[v] : null).missing });
        }
      }
      const key = `${Math.round(b.width)}x${Math.round(b.height)}|${leaders.map((l) => l.d + l.dashed).join("|")}`;
      if (key === lastKey.current) return;
      lastKey.current = key;
      setGeo({ w: b.width, h: b.height, leaders });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    // the ball mounts late (dynamic import) and note heights change with the text, so check lightly
    const t = window.setInterval(measure, 300);
    return () => { ro.disconnect(); window.clearInterval(t); };
  }, [wide, targets, values, hasSoil, s.series]);

  const note = (v: VarId, side: Side) => (
    <Note
      key={v}
      v={v}
      side={side}
      reading={readValue(v, noData || !s.series ? null : values[v])}
      plan={plan}
      setEl={(el) => { notes.current[v] = el; }}
    />
  );

  return (
    <figure className="flex h-full min-h-0 flex-col" aria-labelledby="plate-cap">
      <div ref={boxRef} className="relative grid min-h-0 flex-1 gap-x-4 gap-y-4 lg:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)_minmax(11rem,15rem)]">
        <ul aria-label="Notes on the left of the figure" className="order-2 grid gap-5 sm:grid-cols-2 lg:order-none lg:flex lg:flex-col lg:justify-around lg:gap-4 lg:py-6">
          {left.map((v) => note(v, "l"))}
        </ul>
        <div data-ball className="order-1 h-[min(30rem,92vw)] min-w-0 lg:order-none lg:h-auto lg:min-h-0">
          <CrystalBall
            className="h-full w-full"
            region={region}
            climate={s.climate}
            month={s.month}
            values={values}
            targets={targets}
            colorBy={s.colorBy}
            playing={s.playing}
            showLegend={false}
            legendPlacement="side"
          />
        </div>
        <ul aria-label="Notes on the right of the figure" className="order-3 grid gap-5 sm:grid-cols-2 lg:order-none lg:flex lg:flex-col lg:justify-around lg:gap-4 lg:py-6">
          {right.map((v) => note(v, "r"))}
        </ul>
        {wide && (
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-visible" width={geo.w} height={geo.h}>
            {geo.leaders.map((l) => (
              <g key={l.v}>
                <path d={l.d} fill="none" stroke="var(--stage)" strokeWidth={4} strokeOpacity={0.7} strokeLinejoin="round" />
                <path
                  d={l.d}
                  className="j-leader"
                  pathLength={l.dashed ? undefined : 1}
                  data-dashed={l.dashed}
                  fill="none"
                  stroke="var(--on-stage)"
                  strokeWidth={1.25}
                  strokeLinejoin="round"
                />
                <circle cx={l.tx} cy={l.ty} r={5} fill="var(--stage)" fillOpacity={0.7} />
                <circle cx={l.tx} cy={l.ty} r={3} fill={l.dashed ? "var(--stage)" : `var(${VARIABLES[l.v].color})`} stroke="var(--on-stage)" strokeWidth={1.25} />
              </g>
            ))}
          </svg>
        )}
      </div>

      <figcaption id="plate-cap" className="mx-auto mt-2 max-w-[44rem] text-center text-[0.9375rem] leading-snug text-ink-2">
        <span className="font-display italic text-ink">Plate. </span>
        {region.name}, {s.month ? monthLabel(s.month) : ""}. {noData ? "No land-model series here, so every value is missing, not zero." : `Regional monthly means from ${DATASET.short}.`}{" "}
        {sceneryWords(plan)}
        <span className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {!noData && <Provenance kind="real" className="!py-0 text-xs" />}
          <Provenance kind="illustrative" className="!py-0 text-xs" />
          <span className="text-xs text-ink-3">Particles encode rates at a fixed speed, not tracked water.</span>
        </span>
      </figcaption>
    </figure>
  );
}

function Note({ v, side, reading: r, plan, setEl }: { v: VarId; side: Side; reading: ReturnType<typeof readValue>; plan: ReturnType<typeof chooseScenery>; setEl: (el: HTMLElement | null) => void }) {
  const m = VARIABLES[v];
  const right = side === "r";
  return (
    <li className={`j-callout min-w-0 ${right ? "lg:text-left" : "lg:text-right"}`}>
      <h3 ref={setEl} className={`flex items-center gap-2 border-b border-[var(--on-stage)] pb-0.5 ${right ? "" : "lg:flex-row-reverse"}`}>
        <span aria-hidden="true" className="h-[3px] w-4 shrink-0 rounded-full" style={{ background: `var(${m.color})` }} />
        <span className="min-w-0">{m.label}</span>
      </h3>
      <p className="j-value mt-1.5 tnum">
        {r.missing ? (
          <span className="text-[1.375rem] text-ink-2">No data</span>
        ) : (
          <>
            {formatValue(v, r.value)} <span className="font-sans text-sm font-normal tracking-normal text-ink-2">{m.unit}</span>
          </>
        )}
      </p>
      <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-2">
        {r.missing ? "Not in the series this month. Drawn grey and hatched, not as zero." : encodingWords(v, r, plan)}
        {r.flag && ` Clamped: ${r.flag} the shared display range.`}
      </p>
      {v === "runoff" && !r.missing && <p className="text-[0.8125rem] leading-snug text-ink-3">Modelled runoff generation, not a river.</p>}
      {v === "swe" && !r.missing && <p className="text-[0.8125rem] leading-snug text-ink-3">Water equivalent, not snow depth.</p>}
    </li>
  );
}
