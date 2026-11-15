import type { Metadata } from "next";
import Link from "next/link";
import { AnomalyStrip, StripLegend } from "@/components/home/AnomalyStrip";
import { HeroGlobe } from "@/components/home/HeroGlobe";
import { HeroSearch } from "@/components/home/HeroSearch";
import { Reveal } from "@/components/home/Reveal";
import { presetFigure, type PresetFigure } from "@/components/home/presetFigures";
import { MINUS } from "@/components/charts/time";
import { CATEGORIES } from "@/lib/detective/categories";
import type { PresetEvent } from "@/lib/detective/contracts";
import { PRESET_EVENTS } from "@/lib/detective/presets";
import { encodeState, formatRange } from "@/lib/detective/url";

export const metadata: Metadata = {
  title: { absolute: "Aqua Trend: Earth System Trend Detective" },
  description:
    "Name a known extreme event and a river basin. The Trend Detective removes each variable's seasonal cycle and trend from NASA and NOAA monthly records and shows which ones were unusual before, during and after it.",
};

const PLACE: Record<string, string> = {
  "taiwan-2021-drought": "Taiwan",
  "pakistan-2022-flood": "Indus basin, Pakistan",
  "australia-2019-fire": "South-east Australia",
};

/** A case opens the questionnaire with every answer filled in from the template; the user still presses Submit. */
function caseHref(p: PresetEvent): string {
  return `/detective?${encodeState({
    query: { event: p.event, time: p.time, region: p.region, layers: p.layers, padMonths: p.padMonths },
    draft: p.categories,
  })}`;
}

const signed = (z: number) => `${z < 0 ? MINUS : "+"}${Math.abs(z).toFixed(1)}σ`;

function verdictLine(f: PresetFigure): string {
  if (f.verdict === "significant") return f.direction === "low" ? "Unusually low" : "Unusually high";
  if (f.verdict === "mixed") return "Tests disagree";
  if (f.verdict === "insufficient") return "Not enough data";
  return "Within normal variability";
}

export default async function Home() {
  const figures = await Promise.all(PRESET_EVENTS.map((p) => presetFigure(p)));

  return (
    <div className="bg-space">
      {/* ---------------------------------------------------------------- hero: the planet rising */}
      <section aria-labelledby="hero" className="relative isolate flex min-h-[calc(100dvh-4rem)] flex-col items-center overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "radial-gradient(ellipse 60% 45% at 50% 95%, var(--space-glow), transparent 70%), linear-gradient(180deg, var(--space) 0%, var(--space-2) 100%)" }}
        />
        <div className="hero-copy relative z-10 px-4 pt-16 text-center transition-[opacity,transform] duration-500 sm:pt-24">
          <p className="fade-up text-sm font-semibold tracking-[0.2em] text-on-space-2 uppercase">Earth System Trend Detective</p>
          <h1 id="hero" className="fade-up mt-4 text-[3.25rem] leading-[1.02] text-on-space sm:text-7xl lg:text-[6.5rem]" style={{ animationDelay: "120ms" }}>
            Was it unusual?
          </h1>
          <p className="fade-up mx-auto mt-5 max-w-[42ch] text-lg text-on-space-2 sm:text-xl" style={{ animationDelay: "240ms" }}>
            Test any extreme event against decades of NASA and NOAA records.
          </p>
          <div className="fade-up mt-9" style={{ animationDelay: "360ms" }}>
            <HeroSearch />
            <a href="#cases" className="mt-4 inline-block text-sm text-on-space-2 hover:text-on-space">or open a solved case ↓</a>
          </div>
        </div>
        <HeroGlobe id="hero-globe" className="rise-in relative -mb-[38vmin] mt-6 aspect-square w-[min(115vw,92vmin)] sm:w-[min(95vw,100vmin)]" />
      </section>

      {/* ---------------------------------------------------------------- three cases */}
      <section id="cases" aria-labelledby="cases-h" className="relative z-10 border-t border-space-line px-4 pt-24 pb-10 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-5xl text-center">
          <h2 id="cases-h" className="text-4xl text-on-space sm:text-6xl">Three cases. Solved.</h2>
          <p className="mx-auto mt-4 max-w-[48ch] text-lg text-on-space-2">
            Pick one and the questionnaire comes pre-filled. Change anything, then submit.
          </p>
        </Reveal>

        <ol className="mx-auto mt-16 grid max-w-6xl gap-24 sm:gap-32">
          {PRESET_EVENTS.map((p, i) => {
            const f = figures[i];
            const cat = CATEGORIES[p.active ?? p.categories[0]];
            return (
              <li key={p.id}>
                <Reveal className={`grid items-center gap-10 lg:grid-cols-2 ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}>
                  <div>
                    <p className="text-sm font-semibold tracking-[0.18em] text-on-space-2 uppercase tnum">
                      Case {i + 1} · {PLACE[p.id] ?? p.region}
                    </p>
                    <h3 className="mt-3 text-4xl leading-[1.05] text-on-space sm:text-5xl">{p.title}</h3>
                    <p className="mt-4 max-w-[52ch] text-lg text-on-space-2">{p.blurb}</p>
                    <p className="mt-4 text-on-space-2 tnum">
                      {formatRange(p.time)} · {p.categories.map((c) => CATEGORIES[c].name.en).join(" · ")}
                    </p>
                    <Link
                      href={caseHref(p)}
                      className="mt-7 inline-block rounded-full bg-action px-6 py-3 font-semibold text-on-action hover:bg-action-hover"
                    >
                      Investigate this case →
                    </Link>
                  </div>
                  <div className="rounded-[1.75rem] border border-space-line bg-white/[0.04] p-6 sm:p-8">
                    {f ? (
                      <>
                        <p className="text-sm text-on-space-2">{cat.name.en} · event mean</p>
                        <p className="font-display text-7xl leading-none text-on-space tnum sm:text-8xl">
                          {f.meanZ !== null ? signed(f.meanZ) : "—"}
                        </p>
                        <p className="mt-2 text-xl font-semibold text-on-space">{verdictLine(f)}</p>
                        <div className="mt-6 rounded-xl bg-white/[0.06] px-3 py-3">
                          <AnomalyStrip fig={f} label={`${cat.name.en}, ${p.title}`} />
                        </div>
                        <StripLegend className="mt-3 text-xs text-on-space-2" />
                      </>
                    ) : (
                      <p className="text-on-space-2">Preview unavailable: the data bundle is not installed.</p>
                    )}
                  </div>
                </Reveal>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ---------------------------------------------------------------- close */}
      <section aria-labelledby="close" className="px-4 py-32 text-center sm:px-6">
        <Reveal>
          <h2 id="close" className="mx-auto max-w-[18ch] text-4xl text-on-space sm:text-6xl">Timing match, not proof of cause.</h2>
          <p className="mx-auto mt-5 max-w-[56ch] text-lg text-on-space-2">
            Monthly basin averages from 1,313 river sub-basins and 17 variable categories, with the seasonal cycle and
            long-term trend removed.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-x-8 gap-y-3">
            <a href="#hero" className="rounded-full bg-action px-6 py-3 font-semibold text-on-action hover:bg-action-hover">
              Start an investigation
            </a>
            <Link href="/methods" className="self-center text-on-space underline underline-offset-4">The method</Link>
            <Link href="/data" className="self-center text-on-space underline underline-offset-4">The data</Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
