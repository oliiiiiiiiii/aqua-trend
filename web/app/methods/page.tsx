import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ContentPage, ExtLink, Part } from "@/components/shell/ContentPage";

export const metadata: Metadata = {
  title: "Methods",
  description:
    "How the Trend Detective decides that an interval is unusual: baseline, seasonal cycle and trend removal, z scores, AR(1)-adjusted and empirical tests, same-season rank, long-term trend, the AI variable selector, and the limits.",
};

/** A formula line: plain text in a quiet box, after the words that explain it. */
function F({ children }: { children: ReactNode }) {
  return (
    <p className="w-fit max-w-full overflow-x-auto rounded-ctl bg-well px-3 py-1.5 font-mono text-[0.875rem] text-ink">
      {children}
    </p>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-lg text-ink">{children}</h3>;
}

const B = ({ children }: { children: ReactNode }) => <span className="font-semibold text-ink">{children}</span>;

const GLOSSARY: [string, string][] = [
  ["Basin", "a river sub-basin (HydroBASINS level 4), the only spatial unit the detective uses."],
  ["Event", "the months you name for a known extreme, e.g. Jul – Sep 2022."],
  ["Baseline", "every month of the record outside the event ± pad; the normal is learned from it."],
  ["Anomaly", "a month’s value minus its expected value (trend + seasonal cycle), in the layer’s unit."],
  ["z (σ)", "an anomaly divided by the typical size of baseline anomalies."],
  ["Interval", "the months you drag on the time axis; all statistics describe it."],
];

export default function MethodsPage() {
  return (
    <ContentPage
      title="Methods"
      lede="How the detective decides that an interval is unusual, what each number on the analysis screen means, and what none of them can tell you."
    >
      <Part id="detective" title="How the detective works">
        <p>
          For each variable you choose, the detective takes the basin’s monthly series, learns what a normal month looks
          like from the years away from the event, and subtracts that normal. What is left, the anomaly, is drawn as a
          lane. Dragging an interval asks one question of every lane: is the average anomaly in these months bigger than
          ordinary month-to-month wobble would produce? All of it runs in your browser from the series files listed
          on <Link href="/data" className="text-link underline underline-offset-2">Data</Link>.
        </p>

        <H>1. Baseline and the exclusion window</H>
        <p>
          The baseline is every month of the record except the event and a pad on each side (12 months by default; the
          Window control sets ±6, ±12 or ±24, and “All” only widens the view). Leaving the event out means a large
          event cannot drag the normal towards itself and hide.
        </p>
        <F>baseline = whole record − [event start − pad, event end + pad]</F>

        <H>2. Seasonal cycle and linear trend</H>
        <p>
          On the baseline months, one least-squares fit estimates a straight-line trend together with a separate level
          for each calendar month (January, February, …). The twelve levels, shifted to average zero, are the seasonal
          cycle. Only calendar years with at least 9 observed months (counted before the event is removed) shape the
          seasonal cycle; holding that cycle fixed, the trend is then refitted on every observed baseline month. If
          fewer than 14 baseline months remain, or some calendar month never appears, the lane says there is not enough
          data.
        </p>
        <F>value(t) = a + b·t + s(month of t) + anomaly(t),   s(Jan) + … + s(Dec) = 0</F>

        <H>3. Anomaly and z</H>
        <p>
          The anomaly is what the trend and the seasonal cycle do not explain. σ is the standard deviation of the
          baseline anomalies (n − 1 in the denominator), so z says how many “typical anomalies” a month is away from
          normal. Missing months stay missing; nothing is interpolated.
        </p>
        <F>anomaly = value − trend − seasonal,   z = anomaly / σ</F>

        <H>4. Statistics for the selected interval</H>
        <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
          <li>
            <B>Mean anomaly</B> over the observed months, in the layer’s unit, and <B>mean z</B>. A percentage of normal is
            shown only for quantities that cannot be negative (every value in the record ≥ 0) and whose expected value is
            above zero, so never for temperatures or storage anomalies.
          </li>
          <li>
            <B>95 % interval and p value.</B> Neighbouring months are not independent: a wet month tends to follow a wet
            month. The standard error therefore uses ρ, the lag-1 autocorrelation of the baseline anomalies (adjacent
            observed months only, kept between 0 and 0.99). The p value is two-sided, from the normal distribution.
          </li>
        </ul>
        <F>se = σ · √( Σᵢ Σⱼ ρ^|tᵢ − tⱼ| ) / n,   z = mean / se,   95 % CI = mean ± 1.96 · se</F>
        <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
          <li>
            <B>Empirical window test.</B> A check that assumes no model of the noise: take every run of the same number of
            months that lies wholly in the baseline and has no missing month, and count how many have an average at least
            as far from zero as the interval’s. With k such windows out of N, p = (k + 1) / (N + 1), the “add-one” form
            that never gives zero. It needs a complete interval and at least 20 windows.
          </li>
          <li>
            <B>Verdict.</B> “Unusually low” or “Unusually high” only when both tests give p &lt; 0.05. “Within normal
            variability” when both give p ≥ 0.05. “Tests disagree” when one is below 0.05 and the other is not. If only
            one test can be computed it decides alone; with neither, “Not enough data”.
          </li>
          <li>
            <B>Same-season rank.</B> The interval’s calendar months are compared with the same months in every other year
            of the record that has them all (e.g. Feb – May of each year): “2nd lowest of 24”. Shown for complete intervals
            of up to 12 months with at least 5 comparable years. It is a description, not a p value: those years include
            the pad years and the interval itself, there are only a few dozen of them, and every record has a lowest year,
            so “1st of 26” for an interval chosen because it looked extreme is far weaker evidence than 1 in 26 suggests.
          </li>
          <li>
            <B>Shape.</B> The peak month (largest |z|), the number of months beyond 2σ, and the share of months with the
            same sign as the mean.
          </li>
        </ul>

        <H>5. Long-term trend</H>
        <p>
          The challenge asks whether each variable has a significant long-term trend, so each lane also reports one,
          for the whole record. Here only the seasonal cycle is removed (same fit as above, on all months); the trend is
          what is being measured, and the event is not left out.
        </p>
        <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
          <li>
            <B>Sen slope</B>: the median of the slopes between every pair of months, per decade. It shrugs off single odd
            months. Its 95 % interval is the rank-based (Sen/Gilbert) interval.
          </li>
          <li>
            <B>Mann–Kendall test</B>: does the series tend to rise (or fall) over time? Monthly values are correlated, so
            the test’s variance is inflated by n / nEff, with nEff from the lag-1 autocorrelation ρ of the detrended
            series (negative ρ treated as 0). Two-sided, normal approximation with continuity correction. The same
            inflation widens the slope interval.
          </li>
        </ul>
        <F>nEff = n · (1 − ρ) / (1 + ρ)</F>
        <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
          <li>
            <B>Years to significance.</B> When a slope is not significant, a rough estimate of how many more years of
            data would make it so if the slope, sampling and autocorrelation stayed the same. Not shown above 50 years.
          </li>
        </ul>
        <F>extra years ≈ record length · ( (1.96 · se / |slope|)^(2/3) − 1 ),   se = CI width / (2 · 1.96)</F>
        <p>
          Sources for the two corrections: the rank interval of{" "}
          <ExtLink href="https://search.r-project.org/CRAN/refmans/EnvStats/html/kendallTrendTest.html">EnvStats kendallTrendTest</ExtLink>{" "}
          and the lag-1 correction of{" "}
          <ExtLink href="https://search.r-project.org/CRAN/refmans/modifiedmk/html/mmky1lag.html">modifiedmk mmky1lag</ExtLink>.
          The annual SO₂ layer gets none of these tests.
        </p>
      </Part>

      <Part id="selector" title="Variable suggestions">
        <p>
          After you describe the event, a small language model running on the project’s own server (OneJev 1.6, 0.8 B
          parameters, no API key) answers one yes/no question per category: is the event related to that category’s
          one-line definition? Categories with probability ≥ 0.5 come pre-ticked, with the probability beside them. A
          deployment may instead be configured to call an online model; the label then says “online AI model”.
        </p>
        <p>
          If the model is not running, errors or takes more than 5 seconds, a keyword table answers instead. The screen
          always says which: “Suggested by the local AI model” or “Suggested by keywords (AI model unavailable)”. The
          three example cases use fixed variables and skip the model. Suggestions are a starting checklist; you can tick
          or untick anything, and categories with no data in the chosen basin are disabled. The model never sees or
          produces a data value.
        </p>
      </Part>

      <Part id="ball" title="The crystal ball">
        <p>
          The open lane shows a crystal ball for one month: the month under your cursor, otherwise the peak month of
          the interval. A switch shows the observed month or the normal for that month (trend + seasonal cycle), so the
          anomaly appears as a change in the ball.
        </p>
        <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
          <li>
            Only five water quantities drive the ball: precipitation, evapotranspiration and runoff (converted to mm per
            day), soil water (the root-zone and top-layer layers only) and snow water equivalent.
          </li>
          <li>
            Every other variable, including air temperature, GRACE storage (an anomaly about an unknown mean) and snow
            cover, gets a gauge beside the ball instead: the month’s value against its normal and its record range.
          </li>
          <li>Hills, trees and clouds are scenery and carry no data.</li>
        </ul>
      </Part>

      <Part id="limits" title="Limits">
        <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
          <li>
            <B>Timing match, not proof of cause.</B> An unusual interval coincides with the event. Whether one caused the
            other needs physical reasoning and independent evidence.
          </li>
          <li>
            <B>Exploratory p values.</B> You pick the interval after seeing the lanes, and you look at several variables
            at once. Both make small p values easier to find by chance, and there is no correction for multiple testing
            yet. Treat p &lt; 0.05 as “worth a closer look”.
          </li>
          <li>
            <B>Months, not days.</B> A flood that peaks for a week is averaged with the rest of its month.
          </li>
          <li>
            <B>Basin averages.</B> One number per basin per month hides differences inside it; a hard-hit valley can
            vanish in a large basin. GRACE storage resolves only about 300 km, so small basins are smoothed.
          </li>
          <li>
            <B>Different kinds of product.</B> GLDAS is a land-surface model and MERRA-2 a reanalysis: physically
            consistent estimates, not direct measurements. IMERG, GRACE, MODIS, CERES and FIRMS come from satellites;
            GPCP blends satellites with rain gauges. Two model variables agreeing is expected, not independent
            confirmation. The <Link href="/data" className="text-link underline underline-offset-2">Data</Link> page lists
            each layer’s type and caveat.
          </li>
          <li>
            <B>The baseline is the record.</B> Records start between 1979 and 2002, so “normal” means normal for those
            decades, and a straight-line trend is an approximation.
          </li>
        </ul>
      </Part>

      <Part id="glossary" title="Words used on screen">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
          {GLOSSARY.map(([t, d]) => (
            <div key={t} className="contents">
              <dt className="font-semibold text-ink">{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </Part>
    </ContentPage>
  );
}
