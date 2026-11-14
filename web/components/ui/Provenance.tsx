// The one badge that says where a number comes from. Use it on every panel that shows results.
import type { ReactNode } from "react";

const COPY = {
  real: { label: "Real NASA data", tone: "bg-real-bg text-real" },
  synthetic: { label: "Synthetic example", tone: "bg-synthetic-bg text-synthetic" },
  illustrative: { label: "Illustrative scenery", tone: "bg-well text-ink-2" },
} as const;

export type ProvenanceKind = keyof typeof COPY;

export function Provenance({ kind, children, className = "" }: { kind: ProvenanceKind; children?: ReactNode; className?: string }) {
  const c = COPY[kind];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-ctl px-2.5 py-0.5 text-[0.8125rem] font-semibold ${c.tone} ${className}`}>
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-current" />
      {children ?? c.label}
    </span>
  );
}
