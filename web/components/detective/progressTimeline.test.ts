import { test } from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_MS, DONE_MS, PROGRESS_STAGES, progressFrame, progressLines } from "./progressTimeline";

test("six stages advance in order while progress fills continuously", () => {
  assert.equal(progressFrame(-1).fraction, 0);
  for (let i = 0; i < PROGRESS_STAGES; i++) {
    assert.equal(progressFrame(i * ANALYSIS_MS / PROGRESS_STAGES + 1).stage, i);
  }
  let previous = -1;
  for (let ms = 0; ms <= ANALYSIS_MS; ms += 13) {
    const frame = progressFrame(ms);
    assert.ok(frame.fraction >= previous);
    assert.equal(frame.fraction, ms / ANALYSIS_MS);
    previous = frame.fraction;
  }
  assert.ok(progressFrame(325).fraction > 0);
  assert.ok(progressFrame(325).fraction < 1 / PROGRESS_STAGES);
});

test("Done holds briefly before finishing within the requested duration", () => {
  const done = progressFrame(ANALYSIS_MS);
  assert.equal(done.stage, PROGRESS_STAGES);
  assert.equal(done.fraction, 1);
  assert.equal(done.done, true);
  assert.equal(done.finished, false);
  assert.equal(progressFrame(ANALYSIS_MS + DONE_MS - 1).finished, false);
  assert.equal(progressFrame(ANALYSIS_MS + DONE_MS).finished, true);
  assert.ok(ANALYSIS_MS + DONE_MS >= 3500 && ANALYSIS_MS + DONE_MS <= 4500);
  assert.equal(progressFrame(99999).fraction, 1);
});

test("reduced motion completes in 350ms including the Done state", () => {
  assert.equal(progressFrame(249, true).done, false);
  assert.equal(progressFrame(250, true).done, true);
  assert.equal(progressFrame(349, true).finished, false);
  assert.equal(progressFrame(350, true).finished, true);
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
