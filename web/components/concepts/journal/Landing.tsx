"use client";
import type { ExploreState } from "@/components/explore/useExploreState";
import { FEATURED_SHORT } from "@/components/shell/featured";
import { HeroGlobe } from "@/components/shell/HeroGlobe";
import { Provenance } from "@/components/ui/Provenance";

/**
 * The opening page of the notebook: a headline, the planet as "plate 0" inside a ruled frame, one primary action,
 * and a contents list of regions worth opening first.
 */
export function Landing({ s }: { s: ExploreState }) {
  const { catalog, unknownRegionId } = s;
  return (
    <div className="mx-auto grid max-w-[88rem] items-center gap-10 px-4 py-8 sm:px-6 lg:min-h-[calc(100dvh-3.75rem)] lg:max-h-[60rem] lg:grid-cols-[minmax(0,1fr)_minmax(20rem,36rem)] lg:gap-16 lg:px-8 lg:py-10">
      <div className="max-w-[38rem]">
        <h1 className="text-[clamp(2.6rem,5.4vw,4.4rem)] leading-[1.02]">Every region keeps a water diary.</h1>
        <p className="mt-5 max-w-[34rem] text-[1.1875rem] leading-[1.6] text-ink-2">
          Choose a place on the planet and read its water cycle one month at a time, from 26 years of NASA land-model data. The glass ball draws the month; the margin notes say exactly what each number is.
        </p>
        {unknownRegionId && (
          <p role="status" className="mt-4 border-l-4 border-[color:var(--leaf)] bg-well py-1.5 pr-2 pl-3 text-sm text-ink-2">
            The link asked for a region called “{unknownRegionId}”, which is not in the catalogue. Choose another one.
          </p>
        )}
        <button
          type="button"
          onClick={s.openPicker}
          aria-haspopup="dialog"
          className="mt-6 rounded-ctl bg-action px-6 py-2.5 text-lg font-semibold text-on-action hover:bg-action-hover"
        >
          Choose a region
        </button>

        <h2 className="mt-9 text-xl italic">Regions worth opening first</h2>
        <ul className="j-contents mt-2 max-w-[34rem] border-t border-[var(--on-stage)]">
          {FEATURED_SHORT.map((f) => {
            const r = catalog?.byId.get(f.id);
            return (
              <li key={f.id}>
                <button type="button" disabled={!r} onClick={() => r && s.selectRegion(r)} className="disabled:opacity-60">
                  <span className="name font-semibold text-link">{f.name}</span>
                  <span aria-hidden="true" className="dots" />
                  <span className="text-right text-sm text-ink-2">{f.kind}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <figure className="mx-auto w-full max-w-[34rem]">
        <div className="relative aspect-square">
          <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-ink-2" fill="none" stroke="currentColor" strokeWidth={0.25}>
            <circle cx={50} cy={50} r={49} strokeOpacity={0.7} />
            <circle cx={50} cy={50} r={44} strokeDasharray="0.8 1.4" strokeOpacity={0.7} />
            <circle cx={50} cy={50} r={33} strokeOpacity={0.35} />
            <path d="M50 0V7M50 93V100M0 50H7M93 50H100" strokeWidth={0.4} />
            <path d="M3 3H9M3 3V9M97 3H91M97 3V9M3 97H9M3 97V91M97 97H91M97 97V91" strokeWidth={0.4} />
          </svg>
          <HeroGlobe className="absolute inset-[7%]" />
        </div>
        <figcaption className="mt-3 text-center text-[0.9375rem] leading-snug text-ink-2">
          <span className="font-display italic text-ink">Plate 0. </span>
          The planet used to choose a region. Pick any of 7,641 analysis boundaries, from river basins to named study windows.
          <span className="mt-1.5 flex justify-center">
            <Provenance kind="illustrative" className="!py-0 text-xs" />
          </span>
        </figcaption>
      </figure>
    </div>
  );
}
