import type { Region, RegionSeries, VarId } from "@/lib/types";
import { DATASET, VARIABLES } from "@/lib/variables";

/** Monthly regional series of the selected targets as CSV. Missing months are empty cells, never zero. */
export function buildCsv(region: Region, series: RegionSeries, targets: VarId[]): string {
  const cells = region.cells ?? 0;
  const lines = [
    `# Aqua Trend export: monthly regional series`,
    `# Region: ${region.id} ${region.name}`,
    `# Product: ${DATASET.long} (${DATASET.short}), ${DATASET.agency}`,
    `# Units: ${targets.map((v) => `${v} = ${VARIABLES[v].unit}`).join("; ")}`,
    `# Contributing 1 degree GLDAS cells: ${cells}${region.cellEquiv != null ? ` (${region.cellEquiv} full-cell equivalents inside the boundary)` : ""}${region.fallback ? "; region is smaller than one cell, so the containing cell is used" : ""}`,
    `# Values are area-weighted means of the 1 degree GLDAS cells inside the region. An empty value is a missing month, not zero.`,
    `# Trend statistics in the app use complete years only (2000-2025); the final year is partial.`,
    ["month", ...targets.map((v) => `${v} (${VARIABLES[v].unit})`)].join(","),
  ];
  for (let i = 0; i < series.months.length; i++) {
    const row = [series.months[i]];
    for (const v of targets) {
      const x = series.values[v][i];
      row.push(Number.isFinite(x) ? String(Number(x.toPrecision(7))) : "");
    }
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
