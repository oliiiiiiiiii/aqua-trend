import type { Metadata } from "next";
import Link from "next/link";
import { ContentPage, Part } from "@/components/shell/ContentPage";
import { Provenance } from "@/components/ui/Provenance";
import { VAR_ORDER, VARIABLES } from "@/lib/variables";

export const metadata: Metadata = {
  title: "Methods",
  description: "How Aqua Trend computes trend numbers, how the crystal ball encodes data, what is synthetic, and what the tool does not claim.",
};

export default function MethodsPage() {
  return (
    <ContentPage
      title="Methods"
      lede="How the trend numbers are produced, how the crystal ball turns them into a picture, what is still synthetic, and the limits of all three."
    >
      <Part id="research" title="Research page">
        <p>
          This page describes the earlier GLDAS demo. The <Link href="/research" className="text-link underline underline-offset-2">Research page</Link>{" "}
          uses a different method, computed by the analysis service: monthly anomalies from a fixed, registered reference
          period, a least-squares slope with an autocorrelation-robust (HAC) 95 % interval, and significance labels corrected
          for multiple comparisons with the Benjamini–Yekutieli procedure. When the data do not support a test, the result
          says “undetermined”, not “not significant”.
        </p>
        <p>
          Each research result lists its own method, policy versions, reference periods and comparison families under
          “Evidence and record”. Numbers from this demo and from a research result are not interchangeable.
        </p>
      </Part>

      <Part id="trends" title="Trend numbers">
        <div className="flex flex-wrap gap-2"><Provenance kind="real" /></div>
        <ol className="list-decimal space-y-2 pl-5 marker:text-ink-3">
          <li>
            Monthly regional values are averaged into annual means. Only complete calendar years count: a year with any
            missing month is dropped, and 2026, which is partial, is shown but never fitted. That leaves at most 26
            years, 2000 to 2025.
          </li>
          <li>
            The rate of change is the Sen slope, the median of the slopes between every pair of years, shown per decade.
            It resists single odd years better than a straight-line fit. Its 95 % interval is the rank-based interval of
            the Sen slope itself.
          </li>
          <li>
            Whether there is a trend at all is tested with the Mann–Kendall test on the same annual means. Very small
            p-values are written as “&lt; 0.001”, never as 0.
          </li>
          <li>
            An ordinary least-squares slope is computed as a cross-check. Its 95 % interval belongs to that OLS slope and
            is never attached to the Sen slope.
          </li>
          <li>
            Percent change is given only where it means something: not for air temperature in °C, and not for P − ET,
            whose mean can sit near zero.
          </li>
        </ol>
        <p>
          <span className="font-semibold text-ink">These results are preliminary. </span>
          The Mann–Kendall test here assumes the yearly values are independent; it is not corrected for serial
          correlation (the lag-1 autocorrelation of the residuals is shown so you can judge), and there is no correction
          for testing many variables and many regions. A p-value below 0.05 is a reason to look closer, not a finding.
        </p>
        <p>
          The trend map on the globe uses the same method per 1° cell: Sen slope per year and Mann–Kendall p from the
          2000–2025 annual means of each cell.
        </p>
      </Part>

      <Part id="ball" title="How the crystal ball encodes data">
        <p>
          The ball shows one region and one month. Only the channels of your chosen targets are driven by data; the
          others rest. Every data-driven element in the ball’s legend names its variable, unit and month.
        </p>
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[36rem] border-collapse text-left text-[0.9375rem]">
            <caption className="sr-only">Crystal ball channels</caption>
            <thead className="bg-well text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Variable</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">In the ball</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Shared scale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {VAR_ORDER.map((v) => {
                const m = VARIABLES[v];
                return (
                  <tr key={v} className="align-top">
                    <th scope="row" className="px-4 py-3 font-medium text-ink">{m.label}</th>
                    <td className="px-4 py-3 text-ink-2">{m.orbChannel}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-2 tnum">
                      {m.domain[0]} to {m.domain[1]} {m.unit}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
          <li>
            Every region uses the same scale for a variable, so balls can be compared. Values outside the scale are
            clamped and flagged.
          </li>
          <li>
            Particle <em>count</em> carries the value. Particle <em>speed</em> is fixed and means nothing. Particles are
            an encoding of a monthly average, not tracked drops of water.
          </li>
          <li>
            Missing is not zero. A missing month turns its channel grey with a note; it is never drawn as an empty
            sky, a dry soil or a stopped flow.
          </li>
          <li>
            <Provenance kind="illustrative" className="mr-1" /> Hills, trees, sand and cloud shapes are chosen from the
            region’s long-term climate to make the place recognisable. They carry no monthly data. Cloud size is never
            driven by data, and no river is drawn because there is no river data.
          </li>
          <li>
            Vapour colour can carry near-surface air temperature. That is the temperature of the air, not of the vapour
            and not of the land surface.
          </li>
        </ul>
      </Part>

      <Part id="leads" title="Leads">
        <div className="flex flex-wrap gap-2"><Provenance kind="synthetic" /></div>
        <p>
          <span className="font-semibold text-ink">What the engine will do. </span>
          For each water target, compare it with every eligible variable from the NASA resources of the challenge:
          temperature, radiation, vegetation, clouds, aerosols, terrain, land cover and more. The system, not the user,
          picks the method for each pair: anomaly links after removing the seasonal cycle and the long-term trend,
          lagged links with an automatically chosen range of lags, and spatial links between trend rates across
          locations. Each pair uses its own common period and resolution, and the whole search is corrected for multiple
          testing before anything is recommended. “No reliable association found” is a valid, reported result.
        </p>
        <p>
          <span className="font-semibold text-ink">What this demo shows. </span>
          That engine does not exist yet. Every lead here is a synthetic example, generated deterministically from the
          region and targets. The candidate product names are real so the layout is realistic, but the associations,
          lags and p-values are invented and say nothing about the region. Each lead is marked as synthetic wherever it
          appears.
        </p>
      </Part>

      <Part id="limits" title="What this tool does not claim">
        <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
          <li><span className="font-semibold text-ink">No causation.</span> A trend says how something changed, not why. A lead says two things moved together; which one comes first is a statistical clue, not a cause.</li>
          <li><span className="font-semibold text-ink">No forecast.</span> Playback replays past months. Nothing on this site predicts future months.</li>
          <li><span className="font-semibold text-ink">No closed water budget.</span> P − ET leaves out runoff and lateral flow, so it is not a storage change. Modelled storage leaves out deep groundwater and surface water, so it is not GRACE.</li>
          <li><span className="font-semibold text-ink">No drop tracking.</span> The model reports amounts and rates per grid cell. It does not follow water from one place to another.</li>
          <li><span className="font-semibold text-ink">No independent confirmation.</span> All nine variables come from one model product. Agreement between them is expected, not independent evidence.</li>
        </ul>
      </Part>
    </ContentPage>
  );
}
