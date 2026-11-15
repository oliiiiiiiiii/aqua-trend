import { test } from "node:test";
import assert from "node:assert/strict";
import { DONE_MS, PROGRESS_STAGES, createProgressTimeline, progressFrame, progressLines } from "./progressTimeline";

const timeline = createProgressTimeline(42);
const frame = (ms: number) => progressFrame(ms, false, timeline);

test("seeded progress is deterministic, monotonic and non-linear with six uneven stages", () => {
  assert.deepEqual(createProgressTimeline(42), timeline);
  assert.notDeepEqual(createProgressTimeline(43), timeline);
  assert.equal(frame(-1).fraction, 0);
  let previous = -1, previousStage = 0;
  const stages = new Set<number>();
  for (let ms = 0; ms <= timeline.duration + 20; ms += 10) {
    const f = frame(ms);
    assert.ok(f.fraction >= previous && f.fraction <= 1);
    assert.ok(f.stage >= previousStage && f.stage <= PROGRESS_STAGES);
    stages.add(f.stage);
    previous = f.fraction; previousStage = f.stage;
  }
  assert.deepEqual([...stages], [0, 1, 2, 3, 4, 5, 6]);
  const rates = Array.from({ length: 8 }, (_, i) => (frame((i + 1) * 500).fraction - frame(i * 500).fraction) / 500);
  assert.ok(Math.max(...rates) > Math.min(...rates) * 5);
  assert.notEqual(frame(1000).fraction, 1000 / timeline.duration);
  const boundaries = timeline.points.filter((p, i, all) => i > 0 && p.stage !== all[i - 1].stage).map((p) => p.at);
  const durations = boundaries.map((at, i) => at - (boundaries[i - 1] ?? 0));
  assert.ok(Math.max(...durations) > Math.min(...durations) * 2);
});

test("scoring visibly stalls for about a second, then ends with a quick 90–100% burst", () => {
  for (const seed of [0, 1, 42, 43, 12345, 0xffffffff]) {
    const run = createProgressTimeline(seed);
    const start = run.points.find((p) => p.stage === 3 && p.fraction > 0.67)!;
    const end = run.points[run.points.indexOf(start) + 1];
    assert.equal(end.stage, 3);
    assert.ok(end.at - start.at >= 800 && end.at - start.at <= 1400);
    assert.ok(start.fraction >= 0.60 && end.fraction <= 0.75);
    assert.ok(end.fraction - start.fraction >= 0.01 && end.fraction - start.fraction <= 0.025);
    const final = run.points.at(-2)!;
    assert.ok(Math.abs(final.fraction - 0.9) < 0.003);
    assert.ok(run.duration - final.at < 600);
    assert.ok(run.duration + DONE_MS >= 4000 && run.duration + DONE_MS <= 6000);
  }
});

test("Done holds briefly at 100% before finishing", () => {
  assert.deepEqual(frame(timeline.duration), { stage: PROGRESS_STAGES, fraction: 1, done: true, finished: false });
  assert.equal(frame(timeline.duration + DONE_MS - 1).finished, false);
  assert.equal(frame(timeline.duration + DONE_MS).finished, true);
  assert.equal(frame(99999).fraction, 1);
});

test("reduced motion completes in 350ms including the Done state", () => {
  assert.equal(progressFrame(249, true, timeline).done, false);
  assert.equal(progressFrame(250, true, timeline).done, true);
  assert.equal(progressFrame(349, true, timeline).finished, false);
  assert.equal(progressFrame(350, true, timeline).finished, true);
});

test("stage labels name the basin, variables, event period and actual first year", () => {
  const lines = progressLines({ basin: "Taiwan", variables: 3, period: "Feb–May 2021", firstYear: "2000" });
  assert.equal(lines.length, PROGRESS_STAGES);
  assert.match(lines[0], /Taiwan/);
  assert.match(lines[3], /3 variables.*Feb–May 2021/);
  assert.match(lines[4], /since 2000/);
  const fallback = progressLines({ basin: "Indus", variables: 1, period: "2022" });
  assert.match(fallback[3], /1 variable against/);
  assert.equal(fallback[4], "Ranking against every available year");
});
