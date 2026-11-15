import type { Metadata } from "next";
import Link from "next/link";
import { CaseLink } from "@/components/home/CaseLink";
import { InvestigationHero } from "@/components/home/InvestigationHero";
import { categoryStyle } from "@/lib/detective/categoryStyle";
import { AnomalyStrip } from "@/components/home/AnomalyStrip";
import { presetFigure, type PresetFigure } from "@/components/home/presetFigures";
import { MINUS } from "@/components/charts/time";
import { CATEGORIES } from "@/lib/detective/categories";
import type { PresetEvent } from "@/lib/detective/contracts";
import type { Verdict } from "@/lib/detective/intervalDetail";
import { PRESET_EVENTS } from "@/lib/detective/presets";
import { encodeQuery, formatRange } from "@/lib/detective/url";

export const metadata: Metadata = {
  title: { absolute: "Aqua Trend: Earth System Trend Detective" },
  description:
    "Name a known extreme event and a river basin. The Trend Detective removes each variable's seasonal cycle and trend from NASA and NOAA monthly records and shows which ones were unusual before, during and after it.",
};

/** English place names for the preset basins (the catalogue names are Chinese). */
const PLACE: Record<string, string> = {
  "taiwan-2021-drought": "Taiwan",
  "pakistan-2022-flood": "Indus basin, Pakistan",
  "australia-2019-fire": "South-east Australia",
};

const VERDICT: Record<Verdict, string> = {
  significant: "Unusual",
  mixed: "Tests disagree",
  "not-significant": "Within normal variability",
  insufficient: "Not enough data",
};

/** The analysis URL a preset opens: the same state the detective writes when its preset button is pressed. */
function presetHref(p: PresetEvent): string {
  return `/detective?${encodeQuery({
    event: p.event,
    time: p.time,
    region: p.region,
    categories: p.categories,
    layers: p.layers,
    padMonths: p.padMonths,
    active: p.active ?? p.categories[0],
  })}`;
}

const signed = (z: number) => `${z < 0 ? MINUS : "+"}${Math.abs(z).toFixed(1)}σ`;
const pText = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);

function verdictText(f: PresetFigure): string {
  if (f.verdict === "significant") return f.direction === "low" ? "Unusually low" : "Unusually high";
  return VERDICT[f.verdict];
}

const STEPS = [
  { title: "Name the event", body: "What happened, in your own words: “2022 Pakistan floods”. Years and months in the text become a suggested period." },
  { title: "Set place and time", body: "Pick one of 1,313 river sub-basins on the globe or by name, and confirm the event months." },
  { title: "Choose variables", body: "A local AI model suggests which of 17 categories relate to the event (a keyword table steps in when it is offline). Tick or untick any." },
  { title: "Read the lanes", body: "Each variable’s anomaly is a lane on one shared time axis. Drag an interval before, during or after the event; every lane’s statistics follow." },
];

const UNUSUAL = [
  { term: "Baseline", body: "every month outside the event ± 12 months. The seasonal cycle and linear trend are fitted on it, so the event cannot hide itself." },
  { term: "Anomaly, z", body: "value − trend − seasonal cycle; z divides it by σ, the typical size of a baseline anomaly." },
  { term: "p value", body: "how often ordinary noise, with month-to-month memory, gives an interval mean this far from zero. A second test against every same-length baseline window must agree before we say “unusually low/high”." },
  { term: "Rank", body: "where the interval sits among the same months of every year (“1st lowest of 26”). A description, not a p value." },
];

export default async function Home() {
  const figures = await Promise.all(PRESET_EVENTS.map((p) => presetFigure(p)));

  return (
    <>
      <section data-stage-area data-stage-through data-stage-pass className="on-stage stage-sky overflow-hidden" aria-labelledby="hero">
        <InvestigationHero>
          <div data-home-cases className="pointer-events-auto mx-auto max-w-6xl rounded-card bg-stage/45 px-6 pt-12 pb-16 backdrop-blur-xl sm:px-10 lg:px-12 lg:pt-16 lg:pb-20">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 id="cases" className="text-3xl text-on-stage sm:text-4xl">Open a solved case</h2>
            </div>
            <ul className="mt-12 grid gap-16 lg:gap-20">
              {PRESET_EVENTS.map((p, i) => {
                const f = figures[i];
                const cat = CATEGORIES[p.active ?? p.categories[0]];
                return (
                  <li key={p.id}>
                    <CaseLink
                      href={presetHref(p)}
                      context={{ basin: PLACE[p.id] ?? p.region, variables: p.categories.length, period: formatRange(p.time), firstYear: f?.firstYear }}
                      className="group grid gap-x-12 text-on-stage lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                    >
                      <span className="min-w-0">
                      <span className="block font-display text-3xl leading-tight group-hover:underline sm:text-4xl">{p.title}</span>
                      <span className="mt-3 block text-base text-on-stage-2 sm:text-lg">
                        {PLACE[p.id] ?? p.region} · <span className="tnum">{formatRange(p.time)}</span>
                      </span>
                      <span className="mt-4 block max-w-[56ch] text-base leading-relaxed text-on-stage-2 sm:text-lg">{p.blurb}</span>
                      <span className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:text-base">
                        {p.categories.map((c) => {
                          const colour = categoryStyle(c).color;
                          return <span key={c} className="flex items-center gap-2">
                            <span
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-ctl"
                              style={{ background: `color-mix(in srgb, ${colour} 26%, transparent)`, color: `color-mix(in srgb, ${colour} 70%, var(--on-stage))` }}
                            >
                              <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={CATEGORIES[c].icon} /></svg>
                            </span>{CATEGORIES[c].name.en}
                          </span>;
                        })}
                      </span>
                      <span className="mt-6 inline-flex min-h-11 items-center gap-4 text-base font-semibold underline-offset-4 group-hover:underline">Open the analysis <span aria-hidden="true">→</span></span>
                      </span>
                      {f && (
                        <span className="mt-6 flex min-w-0 flex-col justify-center lg:mt-0">
                          <span className="block text-sm text-on-stage-2">
                            {cat.name.en}, monthly anomaly ± {p.padMonths ?? 12} months
                          </span>
                          <span className="mt-4 block py-3">
                            <AnomalyStrip fig={f} label={`${cat.name.en}, ${p.title}`} />
                          </span>
                          <span className="mt-4 block text-base sm:text-lg">
                            <span className="font-semibold">{verdictText(f)}</span>
                            {f.meanZ !== null && (
                              <span className="text-on-stage-2 tnum">
                                {" "}· event mean {signed(f.meanZ)}
                                {f.p !== null && `, ${pText(f.p)}`}
                              </span>
                            )}
                          </span>
                        </span>
                      )}
                    </CaseLink>
                  </li>
                );
              })}
            </ul>
          </div>
        </InvestigationHero>
      </section>

      <div className="mx-auto max-w-[90rem] px-4 py-12 sm:px-6 lg:px-8">
        <section aria-labelledby="flow" className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
          <h2 id="flow" className="text-2xl lg:text-[1.625rem]">How an investigation runs</h2>
          <ol className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="max-w-sm">
                <span
                  aria-hidden="true"
                  className="font-display grid h-8 w-8 place-items-center rounded-full bg-well text-base text-ink tnum"
                >
                  {i + 1}
                </span>
                <h3 className="mt-2 text-lg">{s.title}</h3>
                <p className="mt-1 text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="unusual"
          className="mt-12 grid gap-6 border-t border-line pt-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12"
        >
          <div>
            <h2 id="unusual" className="text-2xl lg:text-[1.625rem]">What counts as unusual</h2>
            <Link href="/methods" className="mt-3 inline-block text-link underline underline-offset-2">
              The full method
            </Link>
          </div>
          <dl className="divide-y divide-line">
            {UNUSUAL.map((u) => (
              <div key={u.term} className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
                <dt className="font-semibold text-ink">{u.term}</dt>
                <dd className="max-w-[72ch] text-ink-2">{u.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="limits"
          className="mt-12 grid gap-6 border-t border-line pt-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12"
        >
          <h2 id="limits" className="text-2xl lg:text-[1.625rem]">What it cannot tell you</h2>
          <div>
            <ul className="grid gap-4 sm:grid-cols-3">
              <li className="border-t border-line pt-4">
                <p className="font-semibold text-ink">Timing match, not proof of cause.</p>
                <p className="mt-1 text-ink-2">An unusual interval lines up with the event. Why it happened needs physics and other evidence.</p>
              </li>
              <li className="border-t border-line pt-4">
                <p className="font-semibold text-ink">Monthly basin averages.</p>
                <p className="mt-1 text-ink-2">A week-long flood or one hard-hit valley is diluted: most basins cover 7,000 to 240,000 km².</p>
              </li>
              <li className="border-t border-line pt-4">
                <p className="font-semibold text-ink">Models, reanalyses, satellites.</p>
                <p className="mt-1 text-ink-2">Most layers are model or reanalysis output; others are satellite retrievals. Every layer names its product.</p>
              </li>
            </ul>
            <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/data" className="text-link underline underline-offset-2">Every dataset and its caveats</Link>
              <Link href="/methods#limits" className="text-link underline underline-offset-2">Limits of the statistics</Link>
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
