// 24 × 24 stroke icons of the lab's 24 tests (drawn with currentColor, round caps and joins, ≈ 1.8 px).
import type { TestId } from "./tests";

export const TEST_ICON: Record<TestId, string> = {
  ols: "M4 19L20 5M6 15.5h.01M10 13h.01M14 10.5h.01M18 9h.01",
  mk: "M4 19h4v-4h4v-4h4V7h4",
  piecewise: "M3 18l8-3.5L21 5M11 14.5v5",
  permutation: "M3 7h4l10 10h4M3 17h4L17 7h4M18 4l3 3-3 3M18 14l3 3-3 3",
  bootstrap: "M19.5 12A7.5 7.5 0 1 1 17 6.4M20 3.5v4h-4M9 12h6",
  mean: "M3 17h18M12 17V6M8.5 9.5L12 6l3.5 3.5",
  wilcoxon: "M4 8h6M7 5v6M14 16h6M5 20h14",
  compare: "M5 20V10h5v10M14 20V5h5v15M3 20h18",
  variance: "M12 3v18M8.5 6.5L12 3l3.5 3.5M8.5 17.5L12 21l3.5-3.5M5 12h14",
  normality: "M3 19c4.5 0 5-13 9-13s4.5 13 9 13M3 19h18",
  monthly: "M4 6h16v14H4zM4 10.5h16M9.5 6v14M14.5 6v14M8 3v3M16 3v3",
  cusum: "M4 5c3 0 5 1 7 4.5S15 19 20 19M4 5v15h16",
  runs: "M4 9h.01M8 9h.01M12 9h.01M16 15h.01M20 15h.01M3 12h18",
  extremes: "M3 7h3M9 7h3M15 7h3M3 17h3M9 17h3M15 17h3M20 3v18",
  pettitt: "M3 7h8v10h10M11 3v18",
  acf: "M5 20V4M10 20V9M15 20v-6M20 20v-3M3 20h18",
  spectrum: "M2 12c2-7 4-7 6 0s4 7 6 0 4-7 6 0",
  analog: "M3 8c2.5-4 5-4 7.5 0s5 4 7.5 0M6 18c2.5-4 5-4 7.5 0s5 4 7.5 0M12 11v3",
  hmm: "M3 16h4v-8h5v8h3v-8h6M3 20h18",
  forecast: "M3 16l3.5-3 3 2 3.5-5M13 10l8-5M13 10l8 6M21 5v11",
  discord: "M3 15h4l2.5-9 3 14 2-5h6.5",
  iforest: "M4 15a1 1 0 1 0 2 0a1 1 0 1 0-2 0M8 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M7 18a1 1 0 1 0 2 0a1 1 0 1 0-2 0M11.5 16a1 1 0 1 0 2 0a1 1 0 1 0-2 0M14.5 6.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  bocpd: "M3 17h5v-5h6V8h7M8 20v-3M14 20v-8",
  gp: "M3 11c3-6 6-6 9-1.5s6 3 9-2M3 18c3-6 6-6 9-1.5s6 3 9-2",
};
