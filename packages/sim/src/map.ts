// The tile map: loaded from content, validated once, then read-only.

import { show } from "./hash.ts";
import { NODE_KINDS } from "./nodes.ts";

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
  "tent",
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
  /** Resource nodes, in the file's order, each a kind's id (see NODE_KINDS) on its tile. None if left out. */
  readonly nodes?: readonly MapNode[];
}

/** A tree or fishing spot of a map: the id of its kind in NODE_KINDS, and its tile. */
export interface MapNode extends Point {
  readonly kind: number;
}

/** The most nodes one map may list. */
export const MAX_MAP_NODES = 64;

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

/** A place of a map, or of a world (in world coordinates), by name. */
export function place(map: Pick<TileMap, "name" | "places">, name: string): Point {
  const found = map.places.find((p) => p.name === name);
  if (!found) throw new RangeError(`map "${map.name}" has no place called "${name}"`);
  return found;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * Turns parsed map content into a TileMap, or throws a MapError that says what
 * is wrong and where. A map is one region of the world; that the world has a
 * camp and that all of it can be reached from there is checked when the
 * regions are put together (see atlas.ts).
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

  const ground: TileMap = { name, width, height, tiles, places: placeList };
  for (const p of placeList) {
    if (!isWalkable(ground, p.x, p.y)) {
      return fail(`place "${p.name}" at (${p.x}, ${p.y}) is not on a walkable tile`);
    }
  }
  return { ...ground, nodes: parseNodes(ground, raw.nodes, fail) };
}

/**
 * A map's `nodes`: a list of { kind, x, y }, each on its kind's terrain, with a
 * walkable tile beside it to work it from, and no two on one tile. Left out, none.
 */
function parseNodes(map: TileMap, raw: unknown, fail: (message: string) => never): MapNode[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_MAP_NODES)
    return fail(`nodes must be a list of at most ${MAX_MAP_NODES}`);
  const taken = new Set<number>();
  const nodes: MapNode[] = [];
  for (let i = 0; i < raw.length; i++) {
    const node: unknown = Object.hasOwn(raw, i) ? raw[i] : undefined;
    if (!isRecord(node)) return fail(`node ${i} must be an object with kind, x and y`);
    const { kind, x, y } = node;
    const id = NODE_KINDS.findIndex((k) => k.name === kind) + 1;
    const type = NODE_KINDS[id - 1];
    if (!type) return fail(`node ${i}: there is no kind of node called ${show(kind).slice(0, 40)}`);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(map, x as number, y as number))
      return fail(`node ${i} needs whole-number x and y on the map`);
    const at = { x: x as number, y: y as number };
    if (terrainAt(map, at.x, at.y) !== type.terrain)
      return fail(`node ${i}: a ${type.name} must stand on ${type.terrain}`);
    if (!NEIGHBOURS.some(([dx, dy]) => isWalkable(map, at.x + dx, at.y + dy)))
      return fail(`node ${i} at (${at.x}, ${at.y}) has no walkable tile beside it`);
    const index = tileIndex(map, at.x, at.y);
    if (taken.has(index)) return fail(`node ${i}: two nodes on (${at.x}, ${at.y})`);
    taken.add(index);
    nodes.push({ kind: id, ...at });
  }
  return nodes;
}

/** Neighbour order is fixed (north, east, south, west); pathfinding ties depend on it. */
export const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** The places of a map or a world as names a program can use: each stands for its x and y. */
export function placeConstants(map: Pick<TileMap, "places">): Record<string, Point> {
  return Object.fromEntries(map.places.map((p) => [p.name, { x: p.x, y: p.y }]));
}
