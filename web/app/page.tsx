import Link from "next/link";
import { HeroGlobe } from "@/components/shell/HeroGlobe";
import { FEATURED } from "@/components/shell/featured";
import { Provenance } from "@/components/ui/Provenance";

const STEPS = [
  {
    title: "Choose a region",
    body: "Click the planet, or search 7,641 analysis boundaries by name: large river basins, sub-basins, an even hexagon grid, named study windows, seas and ice sheets.",
  },
  {
    title: "Choose up to three water targets",
    body: "Precipitation, evapotranspiration, soil moisture, snow, runoff and more. The tool suggests a set from the region’s climate; change it as you like.",
  },
  {
    title: "Read the trends and the leads",
    body: "Monthly series, rate of change per decade and a significance test for each target, then leads: other variables worth checking against it.",
  },
];

const REAL = [
  {
    kind: "real" as const,
    body: "Regional monthly series of nine GLDAS Noah variables, 2000-01 to 2026-07, area-weighted over each boundary. The trend numbers computed from them. The region layers themselves.",
  },
  {
    kind: "synthetic" as const,
    body: "Every lead. The engine that searches other NASA datasets for associations does not exist yet, so the leads are made-up examples that show what a result will look like.",
  },
  {
    kind: "illustrative" as const,
    body: "The scenery on the planet and inside the crystal ball: hills, trees, cloud shapes. Only the particles, bands and gauges named in the ball’s legend carry data.",
  },
];

export default function Home() {
  return (
    <>
      <section className="on-stage stage-sky overflow-hidden">
        <div className="mx-auto grid max-w-[90rem] items-center gap-6 px-4 pt-6 pb-12 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:px-8 lg:pt-10 lg:pb-20">
          <div className="max-w-xl">
            <h1 className="text-[2.5rem] leading-[1.05] sm:text-[3.25rem]">
              How is the water changing in the place you study?
            </h1>
            <p className="mt-5 text-lg text-on-stage-2">
              Pick a region on the planet, choose up to three parts of the water cycle, and read 26 years of NASA
              land-model trends for exactly that boundary. A glass crystal ball replays the same months so the numbers
              have a picture.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link
                href="/explore"
                className="rounded-ctl bg-action px-6 py-3 text-lg font-semibold text-on-action hover:bg-action-hover"
              >
                Open the globe
              </Link>
              <Link href="/methods" className="text-on-stage underline underline-offset-4">
                How the numbers are made
              </Link>
            </div>
          </div>
          <HeroGlobe className="order-first mx-auto aspect-square w-full max-w-[22rem] sm:max-w-[30rem] lg:order-none lg:max-w-[42rem]" />
        </div>
      </section>

      <div className="mx-auto max-w-[90rem] px-4 py-14 sm:px-6 lg:px-8">
        <section aria-labelledby="flow" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <h2 id="flow" className="text-3xl">Three steps</h2>
          <ol className="grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="max-w-sm">
                <span
                  aria-hidden="true"
                  className="font-display grid h-9 w-9 place-items-center rounded-full bg-well text-lg text-ink tnum"
                >
                  {i + 1}
                </span>
                <h3 className="mt-3 text-xl">{s.title}</h3>
                <p className="mt-2 text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="real" className="mt-16 grid gap-8 border-t border-line pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <h2 id="real" className="text-3xl">What is real in this demo</h2>
            <p className="mt-3 max-w-sm text-ink-2">
              Every panel carries one of these marks, so you always know which kind of thing you are looking at.
            </p>
          </div>
          <dl className="divide-y divide-line">
            {REAL.map((r) => (
              <div key={r.kind} className="grid gap-2 py-4 first:pt-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
                <dt><Provenance kind={r.kind} /></dt>
                <dd className="max-w-prose text-ink-2">{r.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="featured" className="mt-16 grid gap-8 border-t border-line pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <h2 id="featured" className="text-3xl">Start from a region</h2>
            <p className="mt-3 max-w-sm text-ink-2">
              Places with distinct water stories. Each link opens the workspace with that region selected.
            </p>
          </div>
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {FEATURED.map((f) => (
              <li key={f.id} className="border-b border-line">
                <Link
                  href={`/explore?region=${f.id}`}
                  className="group flex flex-col py-3 hover:bg-well sm:px-2"
                >
                  <span className="font-semibold text-link group-hover:underline">{f.name}</span>
                  <span className="text-sm text-ink-3">{f.kind}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
