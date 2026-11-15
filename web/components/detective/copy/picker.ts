// UI strings of the variable dropdown (picker/VariableSelect). English, few words.
export const COPY = {
  label: "Variable",
  listLabel: "Variables",
  /** header of the sparkline column: the shared window */
  window: (from: string, to: string) => `${from} – ${to}`,
  event: "Event",
  selection: "Selection",
  guides: "±2σ dashed",
  meanZ: "Mean σ",
  verdict: "Verdict",
  loading: "Loading…",
  noData: "No data here",
  error: "Did not load",
  sparkTitle: (name: string) => `${name}: anomaly in σ over the window; event band and selection marked`,
  meanZTitle: "Mean anomaly of the selection, in standard deviations",
  optionLabel: (name: string, z: string, verdict: string) => `${name}, ${z}, ${verdict}`,
  scale: (m: number) => `±${m}σ`,
} as const;
