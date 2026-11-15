"use client";
import dynamic from "next/dynamic";
import { useRef, useState, type ReactNode } from "react";
import TrendPanel from "@/components/evidence/TrendPanel";
import LeadsPanel from "@/components/leads/LeadsPanel";
import type { Region, VarId } from "@/lib/types";
import type { OrbAnchors, OrbClimate } from "@/lib/contracts";
import { VAR_ORDER } from "@/lib/variables";
import { seasonWords } from "@/components/orb/encoding";
import { LeaderLines } from "./LeaderLines";
import { OrbReadout } from "./OrbReadout";
import { PlaybackBar } from "./PlaybackBar";
import { RegionDialog } from "./RegionDialog";
import { RegionPicker } from "./RegionPicker";
import { RegionSummary } from "./RegionSummary";
import { formatMonth, sameMonthIn, valuesAt } from "./regionUtils";
import { RetryButton, StatusCard } from "./StatusCard";
import { TargetPicker } from "./TargetPicker";
import { useMediaQuery } from "./hooks";
import { useExploreState, type OrbStyle } from "./useExploreState";

const ORB_STYLES: { id: OrbStyle; label: string; variant: "glass" | "hex-glass" | "hex-island" }[] = [
  { id: "glass", label: "Glass ball", variant: "glass" },
  { id: "hex", label: "Hex board", variant: "hex-glass" },
  { id: "island", label: "Sky island", variant: "hex-island" },
];

/** quiet switch for the diorama style of the crystal ball */
function DioramaSwitch({ value, onChange }: { value: OrbStyle; onChange: (v: OrbStyle) => void }) {
  return (
    <div role="group" aria-label="Diorama" className="inline-flex items-center gap-0.5 rounded-ctl border border-stage-line p-0.5 text-xs">
      <span className="px-2 text-on-stage-2">Diorama</span>
      {ORB_STYLES.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-ctl px-2.5 py-1 font-semibold ${value === o.id ? "bg-paper text-ink" : "text-on-stage-2 hover:text-on-stage"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** quiet switch for the leader lines from the read-out to the ball */
function LeadersSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={value}
      onClick={() => onChange(!value)}
      className={`rounded-ctl border border-stage-line px-2.5 py-1.5 text-xs font-semibold ${value ? "bg-paper text-ink" : "text-on-stage-2 hover:text-on-stage"}`}
    >
      Leader lines
    </button>
  );
}

const CrystalBall = dynamic(() => import("@/components/orb/CrystalBall"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-on-stage-2" role="status">
      Loading the crystal ball…
    </div>
  ),
});

const NO_VALUES = Object.fromEntries(VAR_ORDER.map((v) => [v, null])) as Partial<Record<VarId, number | null>>;

/** small season-matched orb for the first or last year of the playback window */
function SideOrb({
  role, month, missing, region, climate, values, targets, colorBy, variant, className = "",
}: {
  role: "Start year" | "End year";
  month: string;
  missing: boolean;
  region: Region;
  climate: OrbClimate | null;
  values: Partial<Record<VarId, number | null>>;
  targets: VarId[];
  colorBy: VarId | null;
  variant: "glass" | "hex-glass" | "hex-island";
  className?: string;
}) {
  return (
    <figure aria-label={`${role} orb, ${formatMonth(month)}`} className={`flex min-w-0 flex-col items-center ${className}`}>
      <div className="aspect-square w-full max-w-[10.5rem]">
        <CrystalBall
          compact
          className="h-full w-full"
          region={region}
          climate={climate}
          month={month}
          values={values}
          targets={targets}
          colorBy={colorBy}
          variant={variant}
          showLegend={false}
        />
      </div>
      <figcaption className="-mt-1 text-center leading-tight">
        <span className="block text-xs text-on-stage-2">{role}</span>
        <span className="block font-display text-base tnum">{formatMonth(month)}</span>
        {missing && <span className="block text-xs text-on-stage-2">No data for {formatMonth(month)}</span>}
      </figcaption>
    </figure>
  );
}

/**
 * Workspace layout "Stage": the crystal ball is the centrepiece of a one-screen stage (region text and target toggles
 * on the left, the read-out on the right, playback docked along the bottom). Trends and leads sit below on paper.
 * All state comes from `useExploreState`.
 */
export default function ExploreApp() {
  const s = useExploreState();
  const wide = useMediaQuery("(min-width: 1024px)");
  const { catalog, region, series, targets } = s;
  const stageRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLElement>(null);
  const rows = useRef<Partial<Record<VarId, HTMLElement | null>>>({});
  const [anchors, setAnchors] = useState<OrbAnchors>({});

  if (s.catalogStatus === "error") {
    return (
      <Page>
        <StatusCard className="mx-auto max-w-xl" title="The region catalogue did not load" action={<RetryButton onClick={s.retryCatalog} />}>
          <p>{s.catalogError}</p>
          <p>Without it the workspace cannot list or select regions. Check your connection and try again.</p>
        </StatusCard>
      </Page>
    );
  }

  /* -------- no region: the picker is the page */
  if (!region) {
    if (s.requestedRegionId && s.catalogStatus === "loading") {
      return (
        <Page>
          <p role="status" className="text-on-stage-2">Loading the workspace…</p>
        </Page>
      );
    }
    return (
      <Page>
        <RegionPicker state={s} variant="page" />
      </Page>
    );
  }

  /* -------- region selected */
  const ready = s.seriesStatus === "ready";
  const noData = ready && series === null;
  const leadColor = s.selectedLead?.orbColorBy ?? null;
  const orbVariant = ORB_STYLES.find((o) => o.id === s.orbVariant)!.variant;
  // the same calendar month in the first and last year of the window (missing is not zero)
  const frame = (year: number) => {
    const ym = sameMonthIn(s.month, year);
    const i = series ? s.months.indexOf(ym) : -1;
    const values = series && i >= 0 ? valuesAt(series, i) : NO_VALUES;
    return { ym, values, missing: i < 0 || targets.every((t) => values[t] == null) };
  };
  const start = ready && series ? frame(s.window.from) : null;
  const end = ready && series ? frame(s.window.to) : null;

  return (
    <>
      <div className="on-stage stage-sky">
        <div className="mx-auto max-w-[100rem] px-4 py-4 sm:px-6 lg:h-[calc(100dvh-3.75rem)] lg:max-h-[68rem] lg:min-h-[34rem] lg:px-8">
          <div ref={stageRef} className="relative flex flex-wrap gap-4 lg:grid lg:h-full lg:grid-cols-[minmax(15rem,17.5rem)_minmax(0,1fr)_minmax(18rem,21rem)] lg:grid-rows-[minmax(0,1fr)_auto] lg:gap-x-4 lg:gap-y-3">
            {/* left: region facts as plain text, then the toggles */}
            <div className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-3 lg:overflow-y-auto lg:pr-1">
              {start && (
                <SideOrb
                  role="Start year" month={start.ym} missing={start.missing} region={region} climate={s.climate}
                  values={start.values} targets={targets} colorBy={s.colorBy} variant={orbVariant}
                  className="order-3 w-[calc(50%-0.5rem)] lg:order-none lg:w-full lg:shrink-0"
                />
              )}
              <div className="order-1 w-full lg:order-none">
                {catalog && (
                  <RegionSummary
                    region={region}
                    catalog={catalog}
                    series={series}
                    alternatives={s.alternatives}
                    onSelect={(r) => s.selectRegion(r)}
                  />
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <button
                    type="button"
                    onClick={s.openPicker}
                    aria-haspopup="dialog"
                    className="rounded-ctl bg-action px-4 py-1.5 text-sm font-semibold text-on-action hover:bg-action-hover"
                  >
                    Change region
                  </button>
            <nav aria-label="Sections" className="flex gap-3 text-sm">
              {series && <a href="#trends" className="rounded-ctl underline underline-offset-2 hover:no-underline">Trends</a>}
              {ready && <a href="#leads" className="rounded-ctl underline underline-offset-2 hover:no-underline">Leads</a>}
            </nav>
                </div>
              </div>

              <div className="order-6 w-full space-y-3 lg:order-none">
                <TargetPicker targets={targets} onChange={s.setTargets} suggestion={s.suggestion} />
              </div>
            </div>

            {/* centre: the ball */}
            <section ref={ballRef} aria-label="Crystal ball" id="ball" className="relative order-2 h-[min(30rem,92vw)] w-full min-w-0 lg:order-none lg:h-auto lg:min-h-0">
              {ready && (
                <div className="absolute left-0 top-0 z-20 flex flex-wrap items-center gap-2">
                  <DioramaSwitch value={s.orbVariant} onChange={s.setOrbVariant} />
                  {wide && <LeadersSwitch value={s.leaders} onChange={s.setLeaders} />}
                </div>
              )}
              {s.seriesStatus === "loading" && (
                <p role="status" className="grid h-full place-items-center text-center text-on-stage-2">
                  Loading the monthly series for {region.name}…
                </p>
              )}
              {s.seriesStatus === "error" && (
                <div className="grid h-full place-items-center">
                  <StatusCard className="max-w-md" title="The monthly series did not load" action={<RetryButton onClick={s.retrySeries} />}>
                    <p>{s.seriesError}</p>
                    <p>Try again, or change the region.</p>
                  </StatusCard>
                </div>
              )}
              {ready && (
                <CrystalBall
                  className="h-full w-full"
                  region={region}
                  climate={s.climate}
                  month={s.month}
                  values={s.values}
                  targets={targets}
                  colorBy={s.colorBy}
                  playing={s.playing}
                  variant={orbVariant}
                  showLegend={false}
                  legendPlacement="side"
                  onAnchors={wide && s.leaders ? setAnchors : undefined}
                />
              )}
            </section>

            {/* right: the read-out */}
            <div className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-3 lg:overflow-y-auto">
              {end && (
                <SideOrb
                  role="End year" month={end.ym} missing={end.missing} region={region} climate={s.climate}
                  values={end.values} targets={targets} colorBy={s.colorBy} variant={orbVariant}
                  className="order-3 w-[calc(50%-0.5rem)] lg:order-none lg:w-full lg:shrink-0"
                />
              )}
              {ready && (
                <OrbReadout
                  region={region}
                  climate={s.climate}
                  month={s.month}
                  targets={targets}
                  values={s.values}
                  colorBy={s.colorBy}
                  tairColour={s.tairColour}
                  onTairColourChange={s.setTairColour}
                  leadColorBy={leadColor}
                  noSeries={noData}
                  playing={s.playing}
                  variant={orbVariant}
                  rowRef={(v, el) => { rows.current[v] = el; }}
                  className="order-5 w-full lg:order-none"
                />
              )}
            </div>

            {ready && wide && s.leaders && (
              <LeaderLines stageRef={stageRef} ballRef={ballRef} rows={rows} anchors={anchors} targets={targets} values={s.values} missing={noData} />
            )}

            {/* bottom: playback docked along the stage */}
            <div className="order-4 w-full lg:order-none lg:col-span-3">
              {series ? (
                <PlaybackBar
                  series={series}
                  monthIndex={s.monthIndex}
                  onMonthChange={s.setMonthIndex}
                  playing={s.playing}
                  onPlayingChange={s.setPlaying}
                  speed={s.speed}
                  onSpeedChange={s.setSpeed}
                  reducedMotion={s.reducedMotion}
                  sequence={s.sequence}
                  window={s.window}
                  yearRange={s.yearRange}
                  onWindowChange={s.setWindow}
                  seasonNote={s.climate ? seasonWords(region, s.climate, s.month) : undefined}
                />
              ) : (
                <div className="flex min-h-[3.5rem] items-center rounded-card bg-paper px-4 py-2 text-sm text-ink-2 shadow-card" role={ready ? undefined : "status"}>
                  {noData
                    ? "No monthly series for this region, so history playback is unavailable. Missing data is not a dry or frozen result."
                    : s.seriesStatus === "error"
                      ? "History playback needs the monthly series."
                      : "Loading the monthly series…"}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* the bench: evidence and leads on paper */}
      <div className="mx-auto max-w-[90rem] space-y-14 px-4 py-10 sm:px-6 lg:px-8">
        {series && (
          <section id="trends" aria-label="Trends" className="scroll-mt-6">
            <TrendPanel region={region} series={series} targets={targets} monthIndex={s.monthIndex} onMonthChange={s.setMonthIndex} />
          </section>
        )}
        {ready && (
          <section id="leads" aria-labelledby="leads-h" className="scroll-mt-6">
            <div className="mb-5 max-w-3xl">
              <h2 id="leads-h" className="text-3xl">Leads</h2>
              <p className="mt-1 text-ink-2">Other variables worth checking against each target. In this demo every lead is a synthetic example.</p>
            </div>
            <LeadsPanel
              region={region}
              series={series ?? null}
              targets={targets}
              selectedLeadId={s.selectedLead?.id ?? null}
              onSelectLead={s.setSelectedLead}
            />
          </section>
        )}
      </div>

      <RegionDialog open={s.pickerOpen} onClose={s.closePicker} title="Change region">
        <RegionPicker state={s} variant="dialog" autoFocusSearch={wide} />
      </RegionDialog>
    </>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="on-stage stage-sky">
      <div className="mx-auto max-w-[90rem] px-4 pt-4 pb-12 sm:px-6 lg:px-8 lg:pt-8">{children}</div>
    </div>
  );
}
