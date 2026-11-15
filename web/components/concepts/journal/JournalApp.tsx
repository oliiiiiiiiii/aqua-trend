"use client";
import type { ReactNode } from "react";
import TrendPanel from "@/components/evidence/TrendPanel";
import { RegionDialog } from "@/components/explore/RegionDialog";
import { RegionPicker } from "@/components/explore/RegionPicker";
import { RegionSummary } from "@/components/explore/RegionSummary";
import { RetryButton, StatusCard } from "@/components/explore/StatusCard";
import { TargetPicker } from "@/components/explore/TargetPicker";
import { useMediaQuery } from "@/components/explore/hooks";
import { useExploreState } from "@/components/explore/useExploreState";
import LeadsPanel from "@/components/leads/LeadsPanel";
import { Entry } from "./Entry";
import { VapourNote } from "./FieldNotes";
import { Figure } from "./Figure";
import { Landing } from "./Landing";

/**
 * Concept "Field journal": an illustrated naturalist's notebook. Region facts and the target checklist sit in the
 * left margin, the crystal ball is a plate with its values as annotated margin notes, and the timeline is a dated
 * entry with a ruler. All state comes from `useExploreState`.
 */
export default function JournalApp() {
  const s = useExploreState();
  const wide = useMediaQuery("(min-width: 1024px)");
  const { catalog, region, series, targets } = s;

  const dialog = (
    <RegionDialog open={s.pickerOpen} onClose={s.closePicker} title="Change region">
      <RegionPicker state={s} variant="dialog" autoFocusSearch={wide} />
    </RegionDialog>
  );

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

  if (!region) {
    if (s.requestedRegionId && s.catalogStatus === "loading") {
      return (
        <Page>
          <p role="status" className="text-ink-2">Loading the workspace…</p>
        </Page>
      );
    }
    return (
      <>
        <Landing s={s} />
        {dialog}
      </>
    );
  }

  const ready = s.seriesStatus === "ready";

  return (
    <>
      <div className="mx-auto max-w-[100rem] px-4 py-4 sm:px-6 lg:h-[calc(100dvh-3.75rem)] lg:max-h-[64rem] lg:min-h-[38rem] lg:px-8 lg:py-5">
        <div className="flex flex-col gap-6 lg:grid lg:h-full lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_auto] lg:gap-x-8 lg:gap-y-3">
          {/* left margin: the entry's subject, then the checklist */}
          <div className="contents lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col lg:gap-5 lg:overflow-y-auto lg:border-r lg:border-line lg:pr-6">
            <div className="order-1 lg:order-none">
              {catalog && (
                <RegionSummary region={region} catalog={catalog} series={series} alternatives={s.alternatives} onSelect={(r) => s.selectRegion(r)} />
              )}
              <button
                type="button"
                onClick={s.openPicker}
                aria-haspopup="dialog"
                className="mt-3 rounded-ctl bg-action px-4 py-1.5 text-sm font-semibold text-on-action hover:bg-action-hover"
              >
                Change region
              </button>
            </div>
            <div className="order-5 space-y-4 lg:order-none">
              <TargetPicker targets={targets} onChange={s.setTargets} suggestion={s.suggestion} />
              <VapourNote s={s} />
              <nav aria-label="Sections" className="flex gap-4 text-sm">
                {series && <a href="#trends" className="rounded-ctl underline underline-offset-2 hover:no-underline">See trends</a>}
                {ready && <a href="#leads" className="rounded-ctl underline underline-offset-2 hover:no-underline">See leads</a>}
              </nav>
            </div>
          </div>

          <section aria-label="Crystal ball" id="ball" className="order-2 min-h-0 min-w-0 lg:order-none lg:col-start-2 lg:row-start-1">
            <Figure s={s} wide={wide} />
          </section>

          <div className="order-3 min-w-0 lg:order-none lg:col-start-2 lg:row-start-2">
            <Entry s={s} />
          </div>
        </div>
      </div>

      {/* the bench: evidence and leads */}
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
      {dialog}
    </>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[90rem] px-4 pt-6 pb-12 sm:px-6 lg:px-8 lg:pt-8">{children}</div>;
}
