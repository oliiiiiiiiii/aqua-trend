// LaneModel (the workbench's per-variable state) -> VariableSelect items. Pure.
import type { LaneModel } from "../workbench/types";
import { COPY } from "../copy/picker";
import type { VariableItem } from "./VariableSelect";

export function itemsFromLanes(lanes: LaneModel[]): VariableItem[] {
  return lanes.map((l) => {
    const r = l.res;
    const base = { id: l.c, polarity: l.polarity, expected: l.expected, detail: l.detail };
    if (r.kind === "ready") {
      return { ...base, name: r.meta.name, product: r.meta.product, unit: r.meta.unit, series: { z: r.d.z, base: r.base } };
    }
    const disabled = r.kind === "loading" ? COPY.loading : r.kind === "nodata" ? (r.reason ?? COPY.noData) : `${COPY.error}: ${r.message}`;
    return { ...base, name: l.name, series: null, detail: null, disabled };
  });
}
