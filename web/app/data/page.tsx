import type { Metadata } from "next";
import Link from "next/link";
import { ContentPage, ExtLink, Part } from "@/components/shell/ContentPage";
import { LayerTable } from "@/components/shell/LayerTable";
import { Provenance } from "@/components/ui/Provenance";
import { DATASET, VAR_ORDER, VARIABLES } from "@/lib/variables";
import { KIND_WORDS } from "@/components/explore/regionUtils";

export const metadata: Metadata = {
  title: "Data",
  description: "The NASA GLDAS package behind Aqua Trend, its nine variables, the region layers and how regional series are built.",
};

const RESOURCES = [
  {
    name: "Giovanni",
    href: "https://giovanni.gsfc.nasa.gov/",
    agency: "NASA GES DISC",
    use: "Cross-domain Earth-science variables, regional time series and maps. Planned as the catalogue of candidate variables for leads.",
  },
  {
    name: "GES DISC hydrology time series",
    href: "https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series",
    agency: "NASA GES DISC",
    use: "Entry point for hydrology model time series, including GLDAS. To be de-duplicated against the same products in other portals.",
  },
  {
    name: "AppEEARS",
    href: "https://appeears.earthdatacloud.nasa.gov/",
    agency: "NASA LP DAAC",
    use: "Area and point extraction with quality layers for many land products. Planned as a source of candidate variables.",
  },
  {
    name: "Climate Data Online",
    href: "https://www.ncei.noaa.gov/cdo-web/",
    agency: "NOAA NCEI",
    use: "Station and historical climate data. Listed among the challenge resources, but it is NOAA data, not NASA data, and is labelled that way.",
  },
];

export default function DataPage() {
  return (
    <ContentPage
      title="Data"
      lede="Everything numeric on this site comes from one NASA land-surface model product. This page lists what it contains, how regional series are made from it, and what is still undocumented."
    >
      <Part id="package" title="The GLDAS package">
        <div className="flex flex-wrap gap-2"><Provenance kind="real" /></div>
        <dl className="grid max-w-[68ch] grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="font-semibold text-ink">Product</dt>
          <dd>{DATASET.long} (<span className="whitespace-nowrap">{DATASET.short}</span>)</dd>
          <dt className="font-semibold text-ink">Provider</dt>
          <dd>{DATASET.agency}</dd>
          <dt className="font-semibold text-ink">Months</dt>
          <dd className="tnum">{DATASET.period}, 319 months</dd>
          <dt className="font-semibold text-ink">Trend period</dt>
          <dd className="tnum">{DATASET.trendPeriod}; 2026 is partial and is never fitted</dd>
          <dt className="font-semibold text-ink">Grid</dt>
          <dd>1° × 1° over land between 60°S and 90°N</dd>
          <dt className="font-semibold text-ink">Nature</dt>
          <dd>{DATASET.nature}</dd>
        </dl>
      </Part>

      <Part id="variables" title="Nine variables">
        <p>
          Eight can be chosen as water targets, at most three at a time. Near-surface air temperature is context only:
          it can colour the vapour in the crystal ball but is not a water target.
        </p>
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[64rem] border-collapse text-left text-[0.9375rem]">
            <caption className="sr-only">GLDAS variables used on this site</caption>
            <thead className="bg-well text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Variable</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Unit</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Kind</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Source fields</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">What it is</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Keep in mind</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {VAR_ORDER.map((v) => {
                const m = VARIABLES[v];
                return (
                  <tr key={v} className="align-top">
                    <th scope="row" className="px-4 py-3 font-medium text-ink">
                      <span className="flex items-start gap-2">
                        <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: `var(${m.color})` }} />
                        <span>
                          {m.label}
                          {!m.target && <span className="block text-sm font-normal text-ink-3">Context only</span>}
                        </span>
                      </span>
                    </th>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-2">{m.unit}</td>
                    <td className="px-4 py-3 text-ink-2">{KIND_WORDS[m.kind]}</td>
                    <td className="px-4 py-3 text-ink-2">
                      {m.source.map((s) => (
                        <span key={s} className="block whitespace-nowrap text-sm">{s}</span>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-ink-2">{m.what}</td>
                    <td className="px-4 py-3 text-ink-2">{m.caveat}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Part>

      <Part id="regions" title="Region layers">
        <p>
          The catalogue holds several layers of analysis boundaries that overlap: one point on Earth can sit inside a
          large basin, a sub-basin, a hexagon and a named window at once. They are different scopes of the same place,
          never independent evidence. Counts below are computed from the catalogue this page loads.
        </p>
        <LayerTable />
        <p className="rounded-card border-l-4 border-[color:var(--status-warning)] bg-well px-4 py-3">
          <span className="font-semibold text-ink">Still to be documented: </span>
          the upstream source, licence, version and generation date of each region layer. The catalogue records only
          the script that produced it. Until those records exist, the boundaries should be cited as project-derived and
          the repository licence does not cover the upstream geometry.
        </p>
      </Part>

      <Part id="series" title="How a regional series is built">
        <ol className="list-decimal space-y-2 pl-5 marker:text-ink-3">
          <li>Each boundary is rasterised onto a 0.25° grid.</li>
          <li>For every 1° GLDAS cell, the fraction of its 0.25° pixels that fall inside the boundary is counted.</li>
          <li>That fraction is multiplied by the cosine of the cell’s latitude, so each weight is proportional to real area.</li>
          <li>Each month’s regional value is the weighted mean over those cells.</li>
          <li>Cells with a missing value that month are left out. If less than half of the total weight is present, the whole month is marked missing, shown grey, and never treated as zero.</li>
        </ol>
        <p>
          A region smaller than one grid cell takes the value of the 1° cell that contains it, and the workspace says
          so. Mixed land and sea regions only have land-model values for their land part.
        </p>
      </Part>

      <Part id="resources" title="Challenge resources">
        <p>
          The official resources of the Space Apps 2026 challenge “Be An Earth System Trend Detective!” that this
          project draws on or plans to. Only GLDAS data is used in this demo; the others are where candidate variables for
          the leads will come from.
        </p>
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[40rem] border-collapse text-left text-[0.9375rem]">
            <caption className="sr-only">Official challenge resources</caption>
            <thead className="bg-well text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Resource</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Agency</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Role here</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {RESOURCES.map((r) => (
                <tr key={r.name} className="align-top">
                  <th scope="row" className="px-4 py-3 font-medium"><ExtLink href={r.href}>{r.name}</ExtLink></th>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-2">{r.agency}</td>
                  <td className="px-4 py-3 text-ink-2">{r.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Part>

      <Part id="credits" title="Credits and AI use">
        <p>
          GLDAS data: Beaudoing, H. and M. Rodell, NASA/GSFC/HSL, GLDAS Noah Land Surface Model L4 monthly 1.0 × 1.0
          degree V2.1, Goddard Earth Sciences Data and Information Services Center (GES DISC). Accessed through NASA
          Earthdata.
        </p>
        <p>
          Fonts: Fredoka, Figtree and IBM Plex Sans, under the SIL Open Font License, self-hosted. 3D rendering with
          three.js; charts with d3 (both MIT licensed).
        </p>
        <p>
          This is a NASA Space Apps Challenge 2026 entry, not a NASA product, and it does not use NASA branding.
          The leads are synthetic examples; see <Link href="/methods#leads" className="text-link underline underline-offset-2">Methods</Link>.
        </p>
        <p>
          <span className="font-semibold text-ink">AI disclosure. </span>
          The challenge rules ask entrants to disclose AI use. The team set the research questions, product requirements
          and scientific rules. AI tools helped draft and check documentation and wrote much of this site’s code and
          interface copy, which the team reviewed. No research data, trend result or significance value was generated by
          AI; every number comes from the GLDAS files through the steps on this page.
        </p>
      </Part>
    </ContentPage>
  );
}
