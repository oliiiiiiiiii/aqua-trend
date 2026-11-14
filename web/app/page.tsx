import Link from "next/link";
import { HeroGlobe } from "@/components/shell/HeroGlobe";
import { FEATURED } from "@/components/shell/featured";

export default function Home() {
  return (
    <>
      <section className="on-stage stage-sky overflow-hidden">
        <div className="mx-auto grid max-w-[90rem] items-center gap-6 px-4 pt-6 pb-12 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:px-8 lg:pt-10 lg:pb-20">
          <div className="max-w-xl">
            <h1 className="text-[2.5rem] leading-[1.05] sm:text-[3.25rem]">
              How is Earth changing in the place you study?
            </h1>
            <p className="mt-5 text-lg text-on-stage-2">
              Describe a phenomenon, from drought to changing snow cover. Explore the regional time series,
              rates of change and statistical evidence behind it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link
                href="/explore"
                className="rounded-ctl bg-action px-6 py-3 text-lg font-semibold text-on-action hover:bg-action-hover"
              >
                Start a study
              </Link>
              <Link href="/methods" className="text-on-stage underline underline-offset-4">
                How trends are measured
              </Link>
            </div>
          </div>
          <HeroGlobe className="mx-auto aspect-square w-full max-w-[22rem] sm:max-w-[30rem] lg:max-w-[42rem]" />
        </div>
      </section>
      <section className="mx-auto grid max-w-[90rem] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:px-8">
        <div>
          <h2 className="text-3xl">Start from a region</h2>
          <p className="mt-3 max-w-sm text-ink-2">
            Open a study with one boundary selected. You can also leave the region and period open for a
            preset.
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
                <span className="text-sm text-ink-2">{f.kind}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
