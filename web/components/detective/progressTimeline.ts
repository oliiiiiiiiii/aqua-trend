/** A presentation timeline, shared by case links and Analyse. No URL state. */
export const ANALYSIS_MS = 3900;
export const DONE_MS = 250;
export const REDUCED_ANALYSIS_MS = 250;
export const REDUCED_DONE_MS = 100;
export const PROGRESS_STAGES = 6;

export interface ProgressContext {
  basin: string;
  variables: number;
  period: string;
  firstYear?: string;
}

export function progressLines(context: ProgressContext): string[] {
  return [
    `Loading monthly records for ${context.basin}`,
    "Removing the seasonal cycle",
    "Fitting the long-term trend on the baseline",
    `Scoring ${context.variables} ${context.variables === 1 ? "variable" : "variables"} against ${context.period}`,
    context.firstYear ? `Ranking against every year since ${context.firstYear}` : "Ranking against every available year",
    "Preparing the workbench",
  ];
}

export function progressFrame(elapsed: number, reduced = false) {
  const duration = reduced ? REDUCED_ANALYSIS_MS : ANALYSIS_MS;
  const fraction = Math.max(0, Math.min(1, elapsed / duration));
  return {
    fraction,
    stage: Math.min(PROGRESS_STAGES, Math.floor(fraction * PROGRESS_STAGES)),
    done: fraction === 1,
    finished: elapsed >= duration + (reduced ? REDUCED_DONE_MS : DONE_MS),
  };
}
