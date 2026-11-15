"use client";
// Numeric alternative to a chart (acceptance §8): the same arrays the chart draws, as a table.
// Missing values are written as "missing", never as 0. Rows are rendered only while the table is open.
import { useState } from "react";
import { fixed, isYm, timeLabel, ymIndex } from "@/lib/research/format";
import type { Period } from "@/lib/research/types";
import { summaryCls, thCls } from "./ui";

export interface SeriesColumn {
  header: string;
  /** value for row i; null = missing */
  value: (i: number) => number | null | undefined;
  decimals: number;
}

export function insidePeriod(t: string, p: Period | null | undefined): boolean {
  if (!p) return false;
  if (isYm(t)) return ymIndex(t) >= ymIndex(p.start) && ymIndex(t) <= ymIndex(p.end);
  // an annual value belongs to the analysis only when the whole calendar year lies inside the period
  return ymIndex(`${t}-01`) >= ymIndex(p.start) && ymIndex(`${t}-12`) <= ymIndex(p.end);
}

export function SeriesTable({
  title,
  times,
  columns,
  analysis,
  inAnalysis,
}: {
  title: string;
  times: string[];
  columns: SeriesColumn[];
  analysis: Period | null | undefined;
  /** the backend's own mask, when it sent one */
  inAnalysis?: boolean[] | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className={summaryCls}>Data table: {title}</summary>
      {open && (
        <div role="region" aria-label={`${title}, scrollable table`} tabIndex={0} className="mt-2 max-h-96 overflow-auto border border-line" style={{ borderRadius: "min(var(--r-ctl), 8px)" }}>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{title}. Empty cells read “missing”; a missing value is not zero.</caption>
            <thead className="sticky top-0 bg-paper">
              <tr className="border-b border-line">
                <th scope="col" className={thCls}>Time</th>
                {columns.map((c) => <th key={c.header} scope="col" className={thCls}>{c.header}</th>)}
                <th scope="col" className={thCls}>In analysis period</th>
              </tr>
            </thead>
            <tbody>
              {times.map((t, i) => {
                const inside = inAnalysis ? !!inAnalysis[i] : insidePeriod(t, analysis);
                return (
                  <tr key={t} className={`border-b border-line ${inside ? "" : "text-ink-3"}`}>
                    <th scope="row" className="px-3 py-1 text-left font-normal whitespace-nowrap tnum">{timeLabel(t)}</th>
                    {columns.map((c) => {
                      const v = c.value(i);
                      return <td key={c.header} className="px-3 py-1 tnum">{v == null ? <span className="text-ink-3">missing</span> : fixed(v, c.decimals)}</td>;
                    })}
                    <td className="px-3 py-1">{inside ? "yes" : "no"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
