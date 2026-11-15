import type { BasinGrid } from "./grid";

/** Hyrax DAP2 ASCII array rows include coordinate labels before their data. */
export function parseGldasAscii(text: string, bands: readonly string[], grid: BasinGrid, expectedTime: number): Map<string, (number | null)[]> {
  const data = text.split(/\r?\n/);
  if (!data[0]?.startsWith("Dataset: GLDAS_NOAH025_3H.")) throw new Error("unexpected ASCII dataset");
  const time = data.find((line) => line.startsWith("time,"))?.split(",").slice(1).map(Number);
  if (time?.length !== 1 || time[0] !== expectedTime) throw new Error("unexpected ASCII time");
  const out = new Map<string, (number | null)[]>();
  for (const band of bands) {
    const rows = data.filter((line) => line.startsWith(`${band}.${band}[`));
    if (rows.length !== grid.lat.length) throw new Error("incomplete ASCII rows");
    const values: (number | null)[] = [];
    rows.forEach((row, index) => {
      const labelEnd = row.lastIndexOf("]");
      const label = row.slice(0, labelEnd + 1);
      const latitude = new RegExp(`\\[${band}\\.lat=([^\\]]+)\\]`).exec(label);
      const timestamp = new RegExp(`\\[${band}\\.time=([^\\]]+)\\]`).exec(label);
      if (!timestamp || Number(timestamp[1]) !== expectedTime) throw new Error("unexpected ASCII sample time");
      if (!latitude || !Number.isFinite(Number(latitude[1])) || Math.abs(Number(latitude[1]) - grid.lat[index]) > 1e-5) throw new Error("unexpected ASCII latitude");
      const fields = row.slice(labelEnd + 1).split(",").slice(1).map((part) => part.trim());
      if (fields.length !== grid.lon.length || fields.some((value) => !value || !Number.isFinite(Number(value)))) {
        throw new Error("invalid ASCII data shape");
      }
      values.push(...fields.map((field) => Number(field) === -9999 ? null : Number(field)));
    });
    const longitude = data.find((line) => line.startsWith(`${band}.lon,`))?.split(",").slice(1).map(Number);
    if (!longitude || longitude.length !== grid.lon.length || longitude.some((value, i) => !Number.isFinite(value) || Math.abs(value - grid.lon[i]) > 1e-5)) {
      throw new Error("unexpected ASCII band longitude grid");
    }
    out.set(band, values);
  }
  for (const [axis, expected] of [["lat", grid.lat], ["lon", grid.lon]] as const) {
    const line = data.find((item) => item.startsWith(`${axis},`));
    if (!line) throw new Error("missing ASCII coordinates");
    const actual = line.split(",").slice(1).map(Number);
    if (actual.length !== expected.length || actual.some((value, i) => !Number.isFinite(value) || Math.abs(value - expected[i]) > 1e-5)) {
      throw new Error("unexpected ASCII grid");
    }
  }
  return out;
}
