import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { ContentPage, ExtLink, Part } from "@/components/shell/ContentPage";
import { CATEGORIES, CATEGORY_ORDER } from "@/lib/detective/categories";
import { formatYm } from "@/lib/detective/url";
import { FAMILY_KIND, readDataLock, readLayerRows, type LayerRow } from "./catalog";

export const metadata: Metadata = {
  title: "Data",
  description:
    "Every data layer the Trend Detective uses: product, agency, unit, period and caveats; how river-basin series are built; how the data bundle is versioned; and credits.",
};

function agency(r: LayerRow): string {
  if (r.nasa) return "NASA";
  return /NOAA/.test(`${r.product} ${r.caveat ?? ""}`) ? "NOAA" : "Not NASA";
}

function period(r: LayerRow): string {
  if (!r.start || !r.end) return "—";
  if (r.resolution === "annual") return `${r.start.slice(0, 4)} – ${r.end.slice(0, 4)}`;
  return `${formatYm(r.start)} – ${formatYm(r.end)}`;
}

const TH = "px-3 py-2.5 font-semibold";
const TD = "px-3 py-3 align-top";

function LayerTable({ rows }: { rows: LayerRow[] }) {
  const categories = CATEGORY_ORDER.filter((c) => rows.some((r) => r.category === c));
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[60rem] border-collapse text-left text-[0.9375rem]">
        <caption className="sr-only">
          Every data layer in the catalogue, grouped by variable category; the default layer of each category is listed first
        </caption>
        <thead className="bg-well text-ink-2">
          <tr>
            <th scope="col" className={TH}>Layer</th>
            <th scope="col" className={TH}>Product</th>
            <th scope="col" className={TH}>Agency</th>
            <th scope="col" className={TH}>Type</th>
            <th scope="col" className={TH}>Unit</th>
            <th scope="col" className={TH}>Period</th>
            <th scope="col" className={TH}>Time step</th>
            <th scope="col" className={`${TH} w-[28%]`}>Caveat</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <Fragment key={c}>
              <tr className="border-t border-line bg-paper">
                <th scope="colgroup" colSpan={8} className="px-3 pt-5 pb-1.5 text-left">
                  <span className="font-display text-lg text-ink">{CATEGORIES[c].name.en}</span>
                  <span className="ml-3 text-sm font-normal text-ink-3">{CATEGORIES[c].definition.en}</span>
                </th>
              </tr>
              {rows.filter((r) => r.category === c).map((r) => (
                <tr key={r.id} className="border-t border-line/60">
                  <th scope="row" className={`${TD} font-medium text-ink`}>
                    {r.name}
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-normal text-ink-3">
                      <code className="text-[0.8125rem]">{r.id}</code>
                      {r.isDefault && (
                        <span className="rounded-full border border-line bg-well px-2 py-px text-xs font-semibold text-ink-2">
                          Default
                        </span>
                      )}
                    </span>
                  </th>
                  <td className={`${TD} text-ink-2`}>{r.product}</td>
                  <td className={`${TD} whitespace-nowrap text-ink-2`}>{agency(r)}</td>
                  <td className={`${TD} text-ink-2`}>{(r.family && FAMILY_KIND[r.family]) ?? "—"}</td>
                  <td className={`${TD} whitespace-nowrap text-ink-2`}>{r.unit || "—"}</td>
                  <td className={`${TD} whitespace-nowrap text-ink-2 tnum`}>{period(r)}</td>
                  <td className={`${TD} text-ink-2`}>
                    {r.resolution === "annual" ? (
                      <>
                        <span className="font-semibold text-ink">Annual</span>
                        <span className="block text-sm">Not used for monthly analysis</span>
                      </>
                    ) : (
                      "Monthly"
                    )}
                  </td>
                  <td className={`${TD} text-sm text-ink-2`}>{r.caveat ?? ""}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DataPage() {
  const [rows, lock] = await Promise.all([readLayerRows(), readDataLock()]);
  const nCategories = rows ? new Set(rows.map((r) => r.category)).size : 17;
  const families = rows ? [...new Set(rows.map((r) => r.family).filter(Boolean))] : [];

  return (
    <ContentPage
      title="Data"
      lede={
        rows
          ? `The Trend Detective reads ${rows.length} data layers in ${nCategories} categories, from ${families.length} NASA and NOAA product families, averaged over river sub-basins month by month. This page lists every layer, how the basin series are made, how the data is versioned and whom to credit.`
          : "The Trend Detective reads NASA and NOAA data layers averaged over river sub-basins month by month. This page lists every layer, how the basin series are made, how the data is versioned and whom to credit."
      }
    >
      <Part id="layers" title="Every layer">
        <p>
          Each of the {nCategories} variable categories has a default layer, used unless you switch product in the
          analysis view. A basin only offers the layers that have a series there: sea-surface temperature, for example,
          is missing over most land basins. Whenever a layer has a caveat, the analysis view shows it too.
        </p>
        <p>
          <span className="font-semibold text-ink">SO₂ is annual. </span>
          The SO₂ layer is a yearly point-source emissions catalogue whose value is repeated in every month of the year.
          It has no monthly variation, so the detective does not offer it for monthly anomaly, rank or trend tests,
          even through a typed URL.
        </p>
        {rows ? (
          <LayerTable rows={rows} />
        ) : (
          <p role="status" className="rounded-card border-l-4 border-[color:var(--status-warning)] bg-well px-4 py-3">
            <span className="font-semibold text-ink">The data catalogue is not installed. </span>
            Developers: run <code>npm run setup</code> in <code>web/</code> to download the pinned data bundle, then
            reload this page.
          </p>
        )}
      </Part>

      <Part id="series" title="How a basin series is made">
        <ol className="list-decimal space-y-2 pl-5 marker:text-ink-3">
          <li>
            Basins are HydroBASINS level-4 river sub-basins; 1,313 of them have series. Their outlines are rasterised once
            onto a 0.5° grid, and every layer uses that same mask.
          </li>
          <li>
            Each gridded product is brought onto the 0.5° grid (finer products such as MODIS at 0.05° are aggregated).
            A basin’s monthly value is the mean over its cells, weighted by the cosine of latitude so each cell counts
            in proportion to its area.
          </li>
          <li>
            If valid data cover less than 30 % of the basin’s area in a month, that month is missing. Missing months
            stay missing: they are never filled in or treated as zero, charts leave a gap, and the statistics skip them.
          </li>
          <li>
            Fire detections are point records: the count of Terra MODIS vegetation-fire detections inside the basin each
            month, with duplicates between country files removed. A zero means no recorded detection, not proof that
            there was no fire. SO₂ sums the catalogued point sources inside the basin for each year.
          </li>
          <li>
            Layers carried over from the project’s first data snapshot were made with an earlier script on the same
            grid. Rebuilding five GLDAS layers and IMERG precipitation with the current pipeline reproduced them
            (median correlation 1.000 for GLDAS, at least 0.999 for IMERG).
          </li>
        </ol>
        <p>
          Nothing is precomputed: the detective downloads the basin’s series file and computes anomalies, tests and
          trends in your browser. See <Link href="/methods" className="text-link underline underline-offset-2">Methods</Link>.
        </p>
      </Part>

      <Part id="versions" title="How the data is versioned">
        <p>
          Processed data is not kept in git. It is published as one archive attached to a GitHub Release, and{" "}
          <code>web/data.lock.json</code> pins which one: repository, release tag, file name and SHA-256 checksum.{" "}
          <code>npm run setup</code> downloads that archive and refuses to unpack it if the checksum differs. Changing
          the data therefore means a new release and a new lock file, visible in the project history.
        </p>
        {lock && (
          <dl className="grid max-w-[68ch] grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt className="font-semibold text-ink">Release</dt>
            <dd>
              <ExtLink href={`https://github.com/${lock.repo}/releases/tag/${lock.tag}`}>{lock.tag}</ExtLink>
            </dd>
            <dt className="font-semibold text-ink">Archive</dt>
            <dd><code>{lock.asset}</code></dd>
            <dt className="font-semibold text-ink">SHA-256</dt>
            <dd><code className="break-all text-sm">{lock.sha256}</code></dd>
          </dl>
        )}
        <p>
          The release manifest checks file structure and index consistency. It does not independently reproduce the
          scientific values; the processing scripts and their inputs are documented in the repository’s{" "}
          <code>pipeline/</code> folder.
        </p>
      </Part>

      <Part id="credits" title="Credits and citations">
        <ul className="list-disc space-y-2 pl-5 marker:text-ink-3">
          <li>
            <span className="font-semibold text-ink">GLDAS: </span>
            Beaudoing, H. and M. Rodell, NASA/GSFC/HSL, GLDAS Noah Land Surface Model L4 monthly V2.1 (0.25°; the 1°
            product for top-layer soil moisture). NASA Goddard Earth Sciences Data and Information Services Center (GES DISC).
          </li>
          <li>
            <span className="font-semibold text-ink">MERRA-2: </span>
            NASA Global Modeling and Assimilation Office reanalysis, monthly collections M2TMNXFLX, M2TMNXLND,
            M2TMNXAER and M2TMNXSLV, from GES DISC.
          </li>
          <li>
            <span className="font-semibold text-ink">GPM IMERG </span> monthly precipitation, NASA, from GES DISC.
          </li>
          <li>
            <span className="font-semibold text-ink">GRACE and GRACE-FO </span> JPL mascon terrestrial water storage, NASA JPL.
          </li>
          <li>
            <span className="font-semibold text-ink">MODIS: </span>
            vegetation index (NDVI), Terra land-surface temperature (MOD11C3) and{" "}
            <ExtLink href="https://nsidc.org/data/mod10cm/versions/61">MOD10CM Collection 6.1 snow cover</ExtLink>.
          </li>
          <li>
            <span className="font-semibold text-ink">CERES </span> EBAF Edition 4.2.1 surface net radiation, NASA.
          </li>
          <li>
            <ExtLink href="https://firms.modaps.eosdis.nasa.gov/download/">NASA FIRMS</ExtLink> MODIS Collection 6.1
            active-fire archive.
          </li>
          <li>
            <ExtLink href="https://data.nasa.gov/dataset/multi-satellite-air-quality-sulfur-dioxide-so2-database-long-term-l4-global-v2-msaqso2l4-a-d5d7e">
              MSAQSO2L4 V2
            </ExtLink>{" "}
            multi-satellite SO₂ emissions catalogue (OMI, OMPS, TROPOMI), NASA.
          </li>
          <li>
            <span className="font-semibold text-ink">NOAA: </span>
            GPCP v2.3 precipitation, published by NOAA PSL, and NOAA OISST v2.1 sea-surface temperature. These are not
            NASA products and are labelled NOAA wherever they appear.
          </li>
          <li>
            <span className="font-semibold text-ink">Basin outlines: </span> HydroBASINS levels 3 and 4.
          </li>
          <li>
            NASA Earthdata (CMR search and DAAC downloads) for the pipeline;{" "}
            <ExtLink href="https://giovanni.gsfc.nasa.gov/">Giovanni</ExtLink> for spot cross-checks of single regions.
          </li>
        </ul>
        <p>
          Software: Next.js, React, three.js and d3 (MIT licence). Fonts: Literata, Public Sans, Fredoka and Figtree
          (SIL Open Font License), self-hosted. Variable suggestions: the{" "}
          <ExtLink href="https://github.com/OmniJev/OneJev">OneJev</ExtLink> 1.6 0.8B model, run locally.
        </p>
        <p>
          This is a NASA Space Apps Challenge 2026 entry, not a NASA product, and it does not use NASA branding.
        </p>
        <p>
          <span className="font-semibold text-ink">AI disclosure. </span>
          The challenge rules ask entrants to disclose AI use. The team set the research questions, product requirements
          and scientific rules. AI tools helped draft and check documentation and wrote much of this site’s code and
          interface copy, which the team reviewed. An AI model suggests which variables to look at; it never produces a
          number. Every anomaly, p value, rank and trend is computed from the data files through the steps on this page
          and on Methods.
        </p>
      </Part>
    </ContentPage>
  );
}
