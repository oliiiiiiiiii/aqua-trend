// Instruments beside the glass for the two targets that have no place inside the scenery:
// modelled storage (a tube) and P - ET (a gauge around a zero line, never a storage level).
import type { CSSProperties } from "react";
import { VARIABLES, formatValue } from "@/lib/variables";
import { HATCH_CSS, type Reading } from "./encoding";

const TUBE_H = "h-44";
const tick = "absolute right-0 translate-y-1/2 text-[0.6875rem] leading-none text-ink-3 tnum";

function Shell({ title, children, value, note }: { title: string; children: React.ReactNode; value: React.ReactNode; note: string }) {
  return (
    <figure className="w-[8.5rem] rounded-card bg-paper px-3 py-2.5 text-ink shadow-card">
      <figcaption className="text-[0.8125rem] font-semibold leading-tight">{title}</figcaption>
      {children}
      <div className="mt-1.5 tnum text-sm font-semibold">{value}</div>
      <p className="mt-0.5 text-[0.6875rem] leading-tight text-ink-3">{note}</p>
    </figure>
  );
}

export function StorageGauge({ r, reason }: { r: Reading; reason?: string }) {
  const m = VARIABLES.tws;
  const [lo, hi] = m.domain;
  const ticks = [lo, (lo + hi) / 2, hi];
  const fill: CSSProperties = { height: `${r.t * 100}%`, background: `var(${m.color})` };
  return (
    <Shell
      title="Modelled storage"
      value={r.missing ? <span className="text-ink-2">No data</span> : formatValue("tws", r.value, true)}
      note={r.missing && reason ? reason : "Soil to 2 m + snow + canopy water. Not GRACE, not groundwater."}
    >
      <div className={`mt-2 flex gap-1.5 ${TUBE_H}`} aria-hidden="true">
        <div className="relative w-9">
          {ticks.map((x) => <span key={x} className={tick} style={{ bottom: `${((x - lo) / (hi - lo)) * 100}%` }}>{x}</span>)}
        </div>
        <div className="relative w-8 overflow-hidden rounded-full border border-line bg-well" style={r.missing ? { background: HATCH_CSS } : undefined}>
          {!r.missing && <div className="absolute inset-x-0 bottom-0 transition-[height] duration-300 ease-out" style={fill} />}
        </div>
      </div>
    </Shell>
  );
}

export function NetGauge({ r, reason }: { r: Reading; reason?: string }) {
  const m = VARIABLES.p_minus_et;
  const [lo, hi] = m.domain;
  const pos = (x: number) => ((x - lo) / (hi - lo)) * 100;
  const zero = pos(0);
  const v = r.missing ? 0 : r.drawn;
  const bar: CSSProperties = v >= 0
    ? { bottom: `${zero}%`, height: `${pos(v) - zero}%`, background: "var(--viz-cool)" }
    : { bottom: `${pos(v)}%`, height: `${zero - pos(v)}%`, background: "var(--viz-warm)" };
  const ticks = [hi, 0, lo];
  return (
    <Shell
      title="P − ET"
      value={r.missing ? <span className="text-ink-2">No data</span> : <>{v > 0 ? "+" : ""}{formatValue("p_minus_et", r.value, true)}</>}
      note={r.missing && reason ? reason : "Above zero: more water arrives than ET returns. Not a storage change."}
    >
      <div className={`mt-2 flex gap-1.5 ${TUBE_H}`} aria-hidden="true">
        <div className="relative w-9">
          {ticks.map((x) => <span key={x} className={tick} style={{ bottom: `${pos(x)}%` }}>{x > 0 ? `+${x}` : x < 0 ? `−${-x}` : "0"}</span>)}
        </div>
        <div className="relative w-8 rounded-[5px] border border-line bg-well" style={r.missing ? { background: HATCH_CSS } : undefined}>
          {!r.missing && <div className="absolute inset-x-0 transition-all duration-300 ease-out" style={bar} />}
          <div className="absolute -inset-x-1.5 h-0.5 translate-y-1/2 rounded-full bg-ink" style={{ bottom: `${zero}%` }} />
        </div>
      </div>
    </Shell>
  );
}
