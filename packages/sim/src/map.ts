// The tile map: loaded from content, validated once, then read-only.

import { show } from "./hash.ts";

/** Every terrain a map may use. The order is part of the world hash; append only. */
export const TERRAINS = [
  "grass",
  "path",
  "camp",
  "shore",
  "deep_grass",
  "den",
  "bridge",
  "tree",
  "dark_tree",
  "water",
  "rock",
  "lantern",
  "campfire",
  "bank",
] as const;

export type Terrain = (typeof TERRAINS)[number];

const WALKABLE: ReadonlySet<Terrain> = new Set<Terrain>([
  "grass",
  "path",
  "camp",
  "shore",
  "deep_grass",
  "den",
  "bridge",
]);

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface TileMap {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Terrain index (into TERRAINS) per tile, row by row. */
  readonly tiles: readonly number[];
  /** Named places, sorted by name so iteration order never depends on the file. */
  readonly places: readonly (Point & { readonly name: string })[];
}

/** The largest map that still fits the fixed frame (see docs/decisions/0003). */
export const MAX_MAP_WIDTH = 30;
export const MAX_MAP_HEIGHT = 21;

export class MapError extends Error {
  override name = "MapError";
}

export const tileIndex = (map: TileMap, x: number, y: number): number => y * map.width + x;

export const inBounds = (map: TileMap, x: number, y: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;

export function terrainAt(map: TileMap, x: number, y: number): Terrain {
  const terrain = TERRAINS[map.tiles[tileIndex(map, x, y)] ?? -1];
  if (!inBounds(map, x, y) || terrain === undefined) {
    throw new RangeError(`tile (${x}, ${y}) is outside the map`);
  }
  return terrain;
}

export const isWalkable = (map: TileMap, x: number, y: number): boolean =>
  inBounds(map, x, y) && WALKABLE.has(terrainAt(map, x, y));

export function place(map: TileMap, name: string): Point {
  const found = map.places.find((p) => p.name === name);
  if (!found) throw new RangeError(`map "${map.name}" has no place called "${name}"`);
  return found;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * Turns parsed map content into a TileMap, or throws a MapError that says what
 * is wrong and where. A map must have a place called "camp", and every walkable
 * tile must be reachable from it.
 */
export function parseMap(raw: unknown): TileMap {
  if (!isRecord(raw)) throw new MapError("a map must be an object");
  const { name, width, height, legend, rows, places } = raw;
  if (typeof name !== "string" || name === "") throw new MapError("a map needs a name");
  const fail = (message: string): never => {
    throw new MapError(`map "${name}": ${message}`);
  };

  if (!isCount(width) || !isCount(height)) return fail("width and height must be whole numbers");
  if (width > MAX_MAP_WIDTH || height > MAX_MAP_HEIGHT) {
    return fail(
      `${width}x${height} does not fit the frame (at most ${MAX_MAP_WIDTH}x${MAX_MAP_HEIGHT})`,
    );
  }

  if (!isRecord(legend)) return fail("legend must map one character to a terrain");
  const terrainOf = new Map<string, number>();
  for (const [symbol, terrain] of Object.entries(legend)) {
    const index = TERRAINS.indexOf(terrain as Terrain);
    if (symbol.length !== 1) return fail(`legend key "${symbol}" must be a single character`);
    if (index < 0) return fail(`legend maps "${symbol}" to unknown terrain ${show(terrain)}`);
    terrainOf.set(symbol, index);
  }

  if (!Array.isArray(rows) || rows.length !== height) {
    return fail(`expected ${height} rows, found ${Array.isArray(rows) ? rows.length : "none"}`);
  }
  const tiles: number[] = [];
  for (let y = 0; y < height; y++) {
    const row: unknown = rows[y];
    if (typeof row !== "string" || row.length !== width) {
      return fail(`row ${y} must be ${width} characters long`);
    }
    for (let x = 0; x < width; x++) {
      const terrain = terrainOf.get(row.charAt(x));
      if (terrain === undefined) {
        return fail(`row ${y}, column ${x}: "${row.charAt(x)}" is not in the legend`);
      }
      tiles.push(terrain);
    }
  }

  if (!isRecord(places)) return fail("places must map a name to a position");
  const placeList = Object.keys(places)
    .sort()
    .map((placeName) => {
      const at = places[placeName];
      // Programs refer to places by name, so a place name has to be a plain word.
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(placeName)) {
        return fail(
          `place name "${placeName.slice(0, 40)}" must be a lower-case letter followed by letters, digits or underscores`,
        );
      }
      if (!isRecord(at) || !Number.isInteger(at.x) || !Number.isInteger(at.y)) {
        return fail(`place "${placeName}" needs whole-number x and y`);
      }
      return { name: placeName, x: at.x as number, y: at.y as number };
    });

  const map: TileMap = { name, width, height, tiles, places: placeList };
  for (const p of placeList) {
    if (!isWalkable(map, p.x, p.y)) {
      return fail(`place "${p.name}" at (${p.x}, ${p.y}) is not on a walkable tile`);
    }
  }
  const camp = placeList.find((p) => p.name === "camp");
  if (!camp) return fail('a place called "camp" is required');

  // Every walkable tile must be reachable from camp, or an actor could be stranded.
  const seen = new Set<number>([tileIndex(map, camp.x, camp.y)]);
  const queue: Point[] = [camp];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as Point;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!isWalkable(map, x, y) || seen.has(tileIndex(map, x, y))) continue;
      seen.add(tileIndex(map, x, y));
      queue.push({ x, y });
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isWalkable(map, x, y) && !seen.has(tileIndex(map, x, y))) {
        return fail(`walkable tile (${x}, ${y}) cannot be reached from camp`);
      }
    }
  }
  return map;
}

/** Neighbour order is fixed (north, east, south, west); pathfinding ties depend on it. */
export const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** The map's places as names a program can use: each stands for its x and y. */
export function placeConstants(map: TileMap): Record<string, Point> {
  return Object.fromEntries(map.places.map((p) => [p.name, { x: p.x, y: p.y }]));
}
