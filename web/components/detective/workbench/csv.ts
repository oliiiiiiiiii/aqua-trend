// Selection statistics of every lane as CSV: one row per variable. Empty cell = not available.
import type { TimeRange } from "@/lib/detective/contracts";
import type { IntervalDetail } from "@/lib/detective/intervalDetail";
import { encodeRange } from "@/lib/detective/url";
import { COPY } from "./copy";

export interface CsvLane {
  category: string;
  name: string;
  product: string;
  layer: string;
  unit: string;
  expected?: "high" | "low";
  d: IntervalDetail | null;
}

const cell = (v: string | number | null | undefined): string => {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = typeof v === "number" ? String(Number(v.toPrecision(6))) : v;
  return /[",\n#]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COLUMNS = [
  "category", "variable", "product", "layer", "unit", "selection", "months", "n",
  "mean_anomaly", "ci95_low", "ci95_high", "percent_of_normal", "mean_z",
  "p_ar1_z_test", "n_eff", "p_empirical", "windows_as_extreme", "windows",
  "season_rank", "season_years", "direction", "verdict", "peak_month", "peak_z",
  "months_beyond_2sigma", "sign_consistency", "expected",
];

export function selectionCsv(meta: { event: string; period: TimeRange; region: string; selection: TimeRange; pad: number }, lanes: CsvLane[]): string {
  const C = COPY.csv;
  const lines = [
    `# ${C.title}`,
    `# ${C.event}: ${meta.event.replace(/[\r\n]+/g, " ")}`,
    `# ${C.period}: ${encodeRange(meta.period)}`,
    `# ${C.region}: ${meta.region}`,
    `# ${C.selection}: ${encodeRange(meta.selection)}`,
    `# ${C.pad}: ${meta.pad}`,
    `# ${C.note}`,
    COLUMNS.join(","),
  ];
  for (const l of lanes) {
    const d = l.d;
    lines.push([
      l.category, l.name, l.product, l.layer, l.unit, encodeRange(meta.selection),
      d?.months, d?.n, d?.meanAnomaly, d?.ci95?.[0], d?.ci95?.[1], d?.percentOfNormal, d?.meanZ,
      d?.test?.p, d?.test?.nEff, d?.empirical?.p, d?.empirical?.asExtreme, d?.empirical?.windows,
      d?.seasonRank?.position, d?.seasonRank?.of, d?.direction, d?.verdict, d?.peak?.month, d?.peak?.z,
      d?.beyond2Sigma, d?.signConsistency, l.expected,
    ].map(cell).join(","));
  }
  return lines.join("\n") + "\n";
}
