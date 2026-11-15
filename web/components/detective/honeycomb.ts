/** Balance the minimum number of rows. A lone item is only possible when n itself is one
 * (or the caller's capacity makes it unavoidable, e.g. n=3, maxPerRow=2). */
export function honeycombRows(n: number, maxPerRow: number): number[] {
  if (!Number.isInteger(n) || n < 0 || !Number.isInteger(maxPerRow) || maxPerRow < 1) {
    throw new RangeError("Expected a nonnegative count and a positive row capacity");
  }
  const count = Math.ceil(n / maxPerRow);
  return Array.from({ length: count }, (_, i) => Math.floor(n / count) + (i < n % count ? 1 : 0));
}

/** Pointy hexes on one lattice: alternate half-column offsets, including full rows.
 * Reserve that half column in the width; never centre rows independently (which can
 * align their points and cause collisions). The returned height prevents flex shrink. */
export function honeycombLayout(n: number, maxPerRow: number, width: number, gap = 4) {
  const rows = honeycombRows(n, maxPerRow);
  const extent = maxPerRow + 0.5;
  // Keep small clusters at the same compact scale as the complete set.
  const w = Math.max(1, Math.min(84, (width - gap * (extent - 1)) / extent));
  const h = w * 2 / Math.sqrt(3);
  const pitch = w + gap;
  const rowPitch = h * 0.75 + gap;
  const tiles = rows.flatMap((count, row) => Array.from({ length: count }, (_, col) => ({
    x: (col + (row % 2) * 0.5) * pitch,
    y: row * rowPitch,
    row,
  })));
  const used = tiles.reduce((right, t) => Math.max(right, t.x + w), 0);
  const inset = (width - used) / 2;
  return { rows, w, h, height: rows.length ? (rows.length - 1) * rowPitch + h : 0,
    tiles: tiles.map((t) => ({ ...t, x: t.x + inset })) };
}
