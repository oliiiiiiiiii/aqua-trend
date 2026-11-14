"use client";
import { useEffect, useState } from "react";
import { researchApi, errorDetail, type ResearchCatalogue } from "@/lib/research";
import { RecordDetails } from "./StudyResults";
export function CatalogueDetails() {
  const [data, setData] = useState<ResearchCatalogue | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    researchApi<ResearchCatalogue>("/api/catalogue", { signal: c.signal }).then(
      (value) => {
        if (!c.signal.aborted) setData(value);
      },
      (cause) => {
        if (!c.signal.aborted) setError(errorDetail(cause).message);
      },
    );
    return () => c.abort();
  }, [attempt]);
  if (error)
    return (
      <div role="alert">
        {error}{" "}
        <button className="text-button" onClick={() => setAttempt((v) => v + 1)}>
          Retry catalogue
        </button>
      </div>
    );
  if (!data) return <p role="status">Loading the current catalogue…</p>;
  return (
    <div className="research research-paper">
      <p>
        {data.variables.length} physical variables ·{" "}
        {data.regions.filter((r) => r.series_available).length.toLocaleString("en-US")} regions with prepared
        series
      </p>
      <ul className="mt-4 divide-y divide-line">
        {data.variables.map((v) => (
          <li className="py-2" key={v.variable_id}>
            <strong>{v.label}</strong> {v.unit && "(" + v.unit + ")"}
            <p>{v.description}</p>
            {v.scientific_refs?.map((s, i) => (
              <a className="text-button mr-3" key={s.id || i} href={s.url}>
                {s.title || s.id}
              </a>
            ))}
          </li>
        ))}
      </ul>
      <RecordDetails title="Approved products and sources" value={data.products} />
      <RecordDetails title="Indicator definitions" value={data.recipes} />
      <RecordDetails title="Catalogue versions" value={data.versions} />
    </div>
  );
}
