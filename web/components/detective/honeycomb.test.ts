import { test } from "node:test";
import assert from "node:assert/strict";
import { honeycombLayout, honeycombRows } from "./honeycomb";

test("15 others use three full offset rows, without an extra orphan", () => {
  assert.deepEqual(honeycombRows(15, 5), [5, 5, 5]);
});

test("either cluster balances every count from 0–17 at phone and desktop capacities", () => {
  for (const max of [3, 4, 5]) for (let n = 0; n <= 17; n++) {
    const rows = honeycombRows(n, max);
    assert.equal(rows.reduce((sum, count) => sum + count, 0), n);
    assert.equal(rows.length, Math.ceil(n / max));
    assert.ok(rows.every((count) => count >= (n > 1 ? 2 : 1) && count <= max));
    if (n) assert.ok(Math.max(...rows) - Math.min(...rows) <= 1);
  }
  assert.deepEqual(honeycombRows(0, 5), []);
  assert.deepEqual(honeycombRows(1, 3), [1]);
  assert.throws(() => honeycombRows(5, 0), RangeError);
});

type Point = { x: number; y: number };
// Separating-axis check on actual hexagons, rather than their intersecting bounding boxes.
function overlaps(a: Point[], b: Point[]) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const project = (v: Point) => v.x * (q.y - p.y) - v.y * (q.x - p.x);
    const aa = a.map(project), bb = b.map(project);
    if (Math.max(...aa) <= Math.min(...bb) || Math.max(...bb) <= Math.min(...aa)) return false;
  }
  return true;
}

test("hex polygons never overlap or escape their cluster for any 0–17 split", () => {
  for (const width of [250, 326, 450, 576]) for (const max of [3, 4, 5]) for (let n = 0; n <= 17; n++) {
    const layout = honeycombLayout(n, max, width);
    const { w, h, tiles, height } = layout;
    assert.equal(tiles.length, n);
    const polygons = tiles.map(({ x, y }) => {
      assert.ok(x >= -1e-9 && x + w <= width + 1e-9, `${n}/${max}: horizontal bounds`);
      assert.ok(y >= 0 && y + h <= height + 1e-9, `${n}/${max}: vertical bounds`);
      return [[0.5, 0], [1, 0.25], [1, 0.75], [0.5, 1], [0, 0.75], [0, 0.25]]
        .map(([px, py]) => ({ x: x + px * w, y: y + py * h }));
    });
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      assert.equal(overlaps(polygons[i], polygons[j]), false, `${n}/${max}@${width}: tiles ${i},${j}`);
    }
  }
});


test("the full variable panel stays compact and balances every row without an orphan", () => {
  assert.deepEqual(honeycombRows(17, 4), [4, 4, 3, 3, 3]);
  assert.deepEqual(honeycombRows(17, 5), [5, 4, 4, 4]);
  for (const n of [2, 3, 7, 17]) assert.ok(honeycombLayout(n, 5, 576).w <= 84);
});
