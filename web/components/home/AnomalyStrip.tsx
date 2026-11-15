import { anomalyPolarity } from "@/lib/detective/polarity";
import { formatYm } from "@/lib/detective/url";
import { MINUS } from "@/components/charts/time";
import type { PresetFigure } from "./presetFigures";

const W = 300;
const H = 64;

const fmtZ = (z: number) => `${z < 0 ? MINUS : "+"}${Math.abs(z).toFixed(1)}σ`;

/**
 * A static, server-rendered strip of monthly z scores around a preset's event: the same bars the detective's lane
 * strip draws. Bars are coloured by what "above normal" means for the category (see lib/detective/polarity.ts);
 * missing months are a tinted column, never a zero bar.
 */
export function AnomalyStrip({ fig, label }: { fig: PresetFigure; label: string }) {
  const n = fig.months.length;
  const step = W / n;
  const gap = Math.min(2, step * 0.25);
  const peak = fig.z.reduce<number>((m, z) => (z === null ? m : Math.max(m, Math.abs(z))), 0);
  const lim = Math.max(3, peak) * 1.08;
  const y = (z: number) => H / 2 - (z / lim) * (H / 2);
  const highCool = anomalyPolarity(fig.category) === "cool";
  const colour = (z: number) => ((z > 0) === highCool ? "var(--viz-cool)" : "var(--viz-warm)");
  const [e0, e1] = fig.event;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block h-16 w-full overflow-visible"
      role="img"
      aria-label={`${label}: monthly anomaly in standard deviations, ${formatYm(fig.months[0])} to ${formatYm(fig.months[n - 1])}, event months shaded.`}
    >
      <rect x={e0 * step} y={0} width={(e1 - e0 + 1) * step} height={H} fill="var(--action)" opacity={0.2} />
      <line x1={e0 * step} x2={(e1 + 1) * step} y1={0.75} y2={0.75} stroke="var(--action)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {[2, -2].map((g) => (
        <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="var(--viz-axis)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      ))}
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--viz-axis)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {fig.z.map((z, i) => {
        const x = i * step + gap / 2;
        const w = step - gap;
        const month = formatYm(fig.months[i]);
        if (z === null) {
          return (
            <rect key={i} x={x} y={0} width={w} height={H} fill="var(--viz-mid)" opacity={0.6}>
              <title>{`${month}: missing`}</title>
            </rect>
          );
        }
        const top = Math.min(y(z), H / 2);
        return (
          <rect key={i} x={x} y={top} width={w} height={Math.max(0.75, Math.abs(y(z) - H / 2))} fill={colour(z)}>
            <title>{`${month}: ${fmtZ(z)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** The two swatches, spelled out (colour is never the only cue). */
export function StripLegend({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-[var(--viz-cool)]" />
        wetter than normal
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-[var(--viz-warm)]" />
        drier than normal
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-3 bg-[color-mix(in_srgb,var(--action)_35%,transparent)]" />
        event
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="w-3 border-t border-dashed border-[var(--viz-axis)]" />
        ±2σ
      </span>
    </span>
  );
}
