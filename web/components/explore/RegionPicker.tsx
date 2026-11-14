"use client";
import { FEATURED_SHORT } from "@/components/shell/featured";
import { GlobePane } from "./GlobePane";
import { RegionSearch } from "./RegionSearch";
import type { ExploreState } from "./useExploreState";

/**
 * Globe (interactive, boundary-layer control, trend-map overlay) beside the name search and featured list.
 * `page`: the main content of /explore while no region is chosen. `dialog`: the body of the change-region overlay.
 */
export function RegionPicker({
  state,
  variant,
  autoFocusSearch = false,
}: {
  state: ExploreState;
  variant: "page" | "dialog";
  autoFocusSearch?: boolean;
}) {
  const { catalog, region, unknownRegionId, selectRegion } = state;
  const dialog = variant === "dialog";
  return (
    <div className={`grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:gap-8 ${dialog ? "" : "lg:gap-10"}`}>
      <GlobePane
        layer={state.layer}
        onLayerChange={state.setLayer}
        selected={region}
        overlay={state.overlay}
        onOverlayChange={state.setOverlay}
        overlayChoices={state.overlayChoices}
        onPick={state.onPick}
        onZoomChange={state.onZoomChange}
        pickStatus={state.pickStatus}
        canvasClassName={`mx-auto aspect-square w-full min-w-0 ${
          dialog ? "max-w-[min(100%,calc(92dvh-17rem))] min-h-[16rem]" : "max-w-[min(100%,calc(100dvh-14rem))]"
        }`}
      />
      <div className="space-y-4 lg:sticky lg:top-0">
        <div className="rounded-card bg-paper p-5 text-ink shadow-card sm:p-6">
          {!dialog && <h1 className="text-[1.75rem]">Choose a region</h1>}
          <p className={dialog ? "text-ink-2" : "mt-1 text-ink-2"}>
            Click the planet, or find a region by name. Every boundary has the same monthly NASA data behind it, averaged over its area.
          </p>
          {unknownRegionId && (
            <p role="status" className="mt-3 border-l-4 border-[color:var(--status-warning)] bg-well py-1.5 pr-2 pl-3 text-sm text-ink-2">
              The link asked for a region called “{unknownRegionId}”, which is not in the catalogue. Choose another one.
            </p>
          )}
          <div className="mt-4">
            {catalog ? (
              <RegionSearch catalog={catalog} onSelect={(r) => selectRegion(r)} autoFocus={autoFocusSearch} />
            ) : state.catalogStatus === "error" ? (
              <p role="alert" className="rounded-ctl bg-well px-4 py-2.5 text-ink-2">The region catalogue did not load.</p>
            ) : (
              <p role="status" className="rounded-ctl bg-well px-4 py-2.5 text-ink-3">Loading 7,641 regions…</p>
            )}
          </div>
          <div className="mt-5">
            <h2 className="text-base font-semibold">Featured regions</h2>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {FEATURED_SHORT.map((f) => {
                const r = catalog?.byId.get(f.id);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      disabled={!r}
                      onClick={() => r && selectRegion(r)}
                      className="flex w-full flex-col py-2 text-left hover:bg-well disabled:opacity-60 sm:px-1"
                    >
                      <span className="font-medium text-link">{f.name}</span>
                      <span className="text-sm text-ink-3">{f.kind}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
