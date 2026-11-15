// UI strings of the detective crystal ball (VariableOrb). English, few words.
import type { UnmappedReason } from "../orbMapping";

export const COPY = {
  switchLegend: "Show",
  observed: "Observed",
  normal: "Normal",
  noData: "No data",
  loading: "Loading the ball",
  ballName: (v: string, month: string) => `${v}, ${month}`,
  observedLabel: "Observed",
  normalLabel: "Normal",
  normalShown: "Normal for the month",
  above: (amount: string) => `${amount} above normal`,
  below: (amount: string) => `${amount} below normal`,
  atNormal: "At normal",
  range: (lo: string, hi: string) => `Record ${lo} to ${hi}`,
  drives: (what: string) => `Ball shows ${what}`,
  scenery: "Ball shows the place only",
  unmapped: {
    "no-channel": "",
    temperature: "The ball has no air-temperature view.",
    anomaly: "An anomaly, not the ball's modelled storage.",
    layer: "Not a layer the ball draws.",
    unit: "Unit does not convert to the ball's.",
  } satisfies Record<UnmappedReason, string>,
  channel: {
    precip: "rain",
    et: "vapour",
    runoff: "runoff",
    root_zone: "root-zone water",
    soil_top: "topsoil water",
    swe: "snow",
  },
} as const;
