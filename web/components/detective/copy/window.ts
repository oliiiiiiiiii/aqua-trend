// UI strings of the view-window slider and the baseline exclusion stepper. English, few words.
export const COPY = {
  window: "Window",
  windowTitle: "How much is shown: months and years around the event, days and weeks around the selection. The baseline does not change.",
  unit: "Unit",
  units: { day: "Days", week: "Weeks", month: "Months", year: "Years" },
  unitTitle: { day: "Daily anomaly, a few days either side of the selection", week: "Daily anomaly, a few weeks either side of the selection", month: "Months around the event", year: "Years around the event" },
  all: "All",
  allTitle: "Show the whole record",
  slider: "Window either side of the event (days and weeks: of the selection)",
  dailyHint: "Daily data",
  baseline: "Exclude",
  baselineAfter: "months from baseline",
  baselineLabel: "Months either side of the event left out of the baseline",
  baselineTitle: "These months are not used to compute the normal and its variability.",
  less: "Fewer",
  more: "More",
} as const;
