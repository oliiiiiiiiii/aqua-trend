// Small presentational pieces shared by the research panels. Every state is carried by words; colour and
// glyphs only support the words (acceptance §8).
import type { ReactNode } from "react";
import { itemStatusLabel, SIGNIFICANCE } from "@/lib/research/format";
import type { FieldSource, ScientificRef, SignificanceLabel } from "@/lib/research/types";

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} className={`min-w-0 rounded-card bg-paper p-5 text-ink shadow-card sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function Pill({ children, tone = "plain", className = "" }: { children: ReactNode; tone?: "plain" | "real" | "warn"; className?: string }) {
  const tones = {
    plain: "bg-well text-ink-2",
    real: "bg-real-bg text-real",
    warn: "bg-synthetic-bg text-synthetic",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-ctl px-2.5 py-0.5 text-[0.8125rem] font-semibold whitespace-nowrap ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Who set a condition: the user's selector, or a preset that filled a blank (spec §8.3). */
export function SourceBadge({ source }: { source: FieldSource }) {
  return source === "user" ? (
    <Pill tone="real"><span aria-hidden="true">✓</span> You chose</Pill>
  ) : (
    <Pill tone="warn"><span aria-hidden="true">★</span> Suggested preset</Pill>
  );
}

/** Status of one data item. "ok" is quiet; everything else is spelled out and stays visible. */
export function ItemStatusPill({ status }: { status: string }) {
  return status === "ok" ? (
    <Pill tone="real"><span aria-hidden="true">✓</span> {itemStatusLabel(status)}</Pill>
  ) : (
    <Pill tone="warn"><span aria-hidden="true">!</span> {itemStatusLabel(status)}</Pill>
  );
}

/** The main corrected label, as text with an icon and a coloured edge. */
export function SignificanceBadge({ label }: { label: SignificanceLabel }) {
  const c = SIGNIFICANCE[label] ?? SIGNIFICANCE.undetermined;
  return (
    <span
      data-testid="significance"
      data-label={label}
      className="inline-flex items-center gap-2 rounded-ctl border-2 bg-paper px-3 py-1 text-sm font-semibold text-ink"
      style={{ borderColor: `var(${c.tone})` }}
    >
      <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full text-[0.8125rem] leading-none" style={{ background: `var(${c.tone})`, color: "var(--paper)" }}>
        {c.icon}
      </span>
      {c.label}
    </span>
  );
}

export function Notice({ tone = "info", children, role, className = "" }: { tone?: "info" | "warn" | "error"; children: ReactNode; role?: "status" | "alert"; className?: string }) {
  const edge = tone === "error" ? "--status-critical" : tone === "warn" ? "--status-warning" : "--link";
  return (
    <div role={role} className={`border-l-4 bg-well py-2 pr-3 pl-3 text-sm text-ink-2 ${className}`} style={{ borderColor: `var(${edge})` }}>
      {children}
    </div>
  );
}

export function RefList({ refs, title = "Catalogue references" }: { refs: ScientificRef[]; title?: string }) {
  if (!refs.length) return null;
  return (
    <div className="text-sm">
      <p className="font-semibold text-ink-2">{title}</p>
      <ul className="mt-1 space-y-1">
        {refs.map((r) => (
          <li key={r.ref_id} className="text-ink-2">
            {r.url || r.doi ? (
              <a className="text-link underline underline-offset-2" href={r.url ?? `https://doi.org/${r.doi}`} rel="noreferrer">{r.title}</a>
            ) : (
              r.title
            )}
            {r.applies_to ? <span className="text-ink-3">. Supports: {r.applies_to}</span> : null}
            <span className="text-ink-3"> ({r.ref_id})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Definition rows: label left, value right; stacks on narrow screens. */
export function Facts({ rows, className = "" }: { rows: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={`grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)] ${className}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const btnPrimary = "rounded-ctl bg-action px-5 py-2.5 font-semibold text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60";
export const btnQuiet = "rounded-ctl border border-line bg-paper px-4 py-1.5 text-sm font-semibold text-ink hover:bg-well disabled:cursor-not-allowed disabled:opacity-60";
export const summaryCls = "cursor-pointer rounded-ctl py-1 text-sm font-semibold text-link";
export const thCls = "px-3 py-2 text-left align-bottom text-[0.8125rem] font-semibold text-ink-2";
export const tdCls = "px-3 py-1.5 align-top tnum";
