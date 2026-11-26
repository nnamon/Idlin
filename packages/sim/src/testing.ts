// Shared by tests only: loads the shipped map from content/.
import { readFileSync } from "node:fs";
import { parseMap, type TileMap } from "./map.ts";

export const rawFirstLight = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL("../../../content/maps/first-light.json", import.meta.url), "utf8"),
  );

export const firstLight = (): TileMap => parseMap(rawFirstLight());
