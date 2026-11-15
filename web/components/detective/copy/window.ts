// UI strings of the view-window slider and the baseline exclusion stepper. English, few words.
export const COPY = {
  window: "Window",
  windowTitle: "How much is shown around the event. The baseline does not change.",
  unit: "Unit",
  units: { week: "Weeks", month: "Months", year: "Years" },
  unitTitle: { week: "Daily data around the event, where available", month: "Months around the event", year: "Years around the event" },
  all: "All",
  allTitle: "Show the whole record",
  slider: "Window either side of the event",
  dailyHint: "Daily data",
  baseline: "Exclude",
  baselineAfter: "months from baseline",
  baselineLabel: "Months either side of the event left out of the baseline",
  baselineTitle: "These months are not used to compute the normal and its variability.",
  less: "Fewer",
  more: "More",
} as const;
