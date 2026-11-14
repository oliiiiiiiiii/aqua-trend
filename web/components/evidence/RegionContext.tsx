import type { Region } from "@/lib/types";
import { LAYER_LABEL } from "@/lib/data";

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="mt-[3px] shrink-0">
        <path d="M8 1.8 15 14H1z" fill="none" strokeWidth="1.6" strokeLinejoin="round" style={{ stroke: "var(--ink)" }} />
        <path d="M8 6.2v4M8 11.6v.2" strokeWidth="1.6" strokeLinecap="round" style={{ stroke: "var(--ink)" }} />
      </svg>
      <span>{children}</span>
    </li>
  );
}

/** How many 1 degree cells feed the series, and what that means for how far it can be trusted for this region. */
export default function RegionContext({ region }: { region: Region }) {
  const cells = region.cells ?? 0;
  const equiv = region.cellEquiv;
  const warns: React.ReactNode[] = [];
  if (region.fallback) {
    warns.push(<Warn key="fb">This region is smaller than one 1° grid cell, so the series shown is the whole cell that contains it, an area much larger than the region itself.</Warn>);
  } else if (equiv != null && equiv < 4) {
    warns.push(<Warn key="few">Only {equiv.toLocaleString("en-US")} cell-equivalents feed this series. With so few cells, local features dominate and the trend is less representative of the region.</Warn>);
  }
  const lf = region.landFrac;
  if (lf != null && lf < 0.9) {
    const pct = Math.round(lf * 100);
    warns.push(
      <Warn key="lf">
        {lf < 0.8 ? "Only " : "About "}{pct} % of this boundary is land or ice.{" "}
        {lf === 0 ? "There is no land surface to model, so any series comes from coastal slivers only." : "The land-surface model has no values over water, so the series describes the land and ice part only."}
      </Warn>,
    );
  }
  return (
    <div className="rounded-card bg-well px-4 py-3 text-sm text-ink-2" style={{ borderRadius: "min(var(--r-card), 14px)" }}>
      <p>
        <span className="font-semibold text-ink">{region.name}</span>
        <span>{`, ${LAYER_LABEL[region.type].toLowerCase()}, ${Math.round(region.areaKm2).toLocaleString("en-US")} km². `}</span>
        <span>
          The series is the area-weighted mean of <span className="tnum font-semibold text-ink">{cells.toLocaleString("en-US")}</span> 1° GLDAS {cells === 1 ? "cell" : "cells"}
          {equiv != null ? <> (<span className="tnum">{equiv.toLocaleString("en-US")}</span> full-cell equivalents inside the boundary)</> : null}.
        </span>
      </p>
      {warns.length > 0 && <ul className="mt-2 space-y-1.5 text-ink">{warns}</ul>}
    </div>
  );
}
