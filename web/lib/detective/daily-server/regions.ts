import { readFile } from "node:fs/promises";
import path from "node:path";
import { DailyError } from "./errors";

export interface BasinGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

let basins: Promise<Map<string, BasinGeometry>> | undefined;

export async function basinGeometry(id: string): Promise<BasinGeometry> {
  basins ??= loadBasins().catch((error) => { basins = undefined; throw error; });
  const geometry = (await basins).get(id);
  if (!geometry) throw new DailyError("unknown_region", 404, "找不到此流域。");
  return geometry;
}

async function loadBasins(): Promise<Map<string, BasinGeometry>> {
  const file = path.join(process.cwd(), "public", "data", "geo", "basin4.geojson");
  const data = JSON.parse(await readFile(file, "utf8")) as {
    features: { properties: { id: string }; geometry: BasinGeometry }[];
  };
  return new Map(data.features.map((feature) => [feature.properties.id, feature.geometry]));
}
