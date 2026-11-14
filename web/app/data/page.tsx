import type { Metadata } from "next";
import { ContentPage, Part } from "@/components/shell/ContentPage";
import { LayerTable } from "@/components/shell/LayerTable";
import { CatalogueDetails } from "@/components/research/CatalogueDetails";
export const metadata: Metadata = {
  title: "Data",
  description: "Prepared regional datasets, offline scientific references and analysis coverage.",
};
export default function DataPage() {
  return (
    <ContentPage
      title="Data and sources"
      lede="The catalogue identifies the prepared datasets, scientific definitions and reference periods available to a study."
    >
      <Part id="catalogue" title="Research catalogue">
        <CatalogueDetails />
      </Part>
      <Part id="regions" title="Region layers">
        <p>
          The globe, searchable region list and research engine use the same boundary IDs. A point can lie
          inside several boundaries. Each study uses one of them.
        </p>
        <LayerTable />
      </Part>
      <Part id="coverage" title="Coverage and missing data">
        <p>
          Each study reports its selected product, fixed reference period and observations available in the
          requested interval. Prepared series cover only a subset of the selectable regions. Indicator records
          identify missing event catalogues, calibration data and other requirements.
        </p>
      </Part>
      <Part id="credits" title="Credits">
        <p>
          Aqua Trend was built for the NASA Space Apps Challenge. The team used AI assistance for development
          and documentation. The globe’s landscape illustrates the region picker. Source and method records
          accompany each scientific result.
        </p>
      </Part>
    </ContentPage>
  );
}
