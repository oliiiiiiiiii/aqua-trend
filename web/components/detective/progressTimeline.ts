/** A presentation timeline, shared by case links and Analyse. No URL state. */
export const ANALYSIS_MS = 4800; // nominal; each run varies its stage durations slightly
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

interface ProgressPoint { at: number; fraction: number; stage: number; power: number }
export interface ProgressTimeline { points: ProgressPoint[]; duration: number }

/** Seeded timing and easing jitter is sampled once per run, never on animation frames. */
export function createProgressTimeline(seed: number): ProgressTimeline {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const durations = [700, 500, 900, 1450, 750, 500];
  // Each pair is a local time fraction and the overall progress at that point.
  const shapes = [
    [[0.3, 0.14], [1, 0.22]],
    [[0.6, 0.25], [1, 0.36]],
    [[0.45, 0.40], [1, 0.64]],
    [[0.17, 0.68], [0.93, 0.697], [1, 0.71]], // ~1.1 seconds creeping during scoring
    [[0.4, 0.86], [1, 0.90]],
    [[1, 1]],
  ];
  const points: ProgressPoint[] = [{ at: 0, fraction: 0, stage: 0, power: 1 }];
  let at = 0;
  for (let stage = 0; stage < durations.length; stage++) {
    const duration = durations[stage] * (0.92 + random() * 0.16);
    for (const [local, fraction] of shapes[stage]) {
      points.push({
        at: at + local * duration,
        fraction: fraction === 1 ? 1 : fraction + (random() - 0.5) * 0.004,
        stage: local === 1 ? stage + 1 : stage,
        power: 1.4 + random() * 1.4,
      });
    }
    at += duration;
  }
  return { points, duration: at };
}

const DEFAULT_TIMELINE = createProgressTimeline(1);

export function progressFrame(elapsed: number, reduced = false, timeline = DEFAULT_TIMELINE) {
  const duration = reduced ? REDUCED_ANALYSIS_MS : timeline.duration;
  const t = Math.max(0, elapsed);
  let fraction = 1, stage = PROGRESS_STAGES;
  if (t < duration) {
    if (reduced) {
      fraction = t / duration;
      stage = Math.min(PROGRESS_STAGES - 1, Math.floor(fraction * PROGRESS_STAGES));
    } else {
      const i = timeline.points.findIndex((p) => p.at > t);
      const a = timeline.points[i - 1], b = timeline.points[i];
      const x = (t - a.at) / (b.at - a.at);
      // Ease alternate bursts out and crawls in. Interpolation stays monotonic.
      const eased = i % 2 ? 1 - Math.pow(1 - x, b.power) : Math.pow(x, b.power);
      fraction = a.fraction + (b.fraction - a.fraction) * eased;
      stage = a.stage;
    }
  }
  return {
    fraction,
    stage,
    done: t >= duration,
    finished: t >= duration + (reduced ? REDUCED_DONE_MS : DONE_MS),
  };
}
